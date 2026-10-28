// Живые обновления (E40-04): поток событий сервера (SSE) вместо опроса раз в 30 секунд.
// Несколько процессов и экземпляров: каждый раз в 2 секунды одним запросом проверяет новые
// уведомления и версию данных в PostgreSQL — общий источник, без отдельного брокера сообщений.
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../infra/prisma.service';
import { DataVersionService } from '../infra/data-version';

const POLL_MS = Number(process.env.EVENTS_POLL_MS ?? 2000);
const HEARTBEAT_MS = 25_000; // меньше таймаута простоя прокси: соединение не рвётся
// При 5000 пользователях данные меняются несколько раз в секунду: «данные изменились» — не чаще 15 с
const DATA_EVERY_MS = 15_000;

@Injectable()
export class EventsService implements OnApplicationShutdown {
  private readonly log = new Logger('Events');
  private readonly clients = new Map<number, Set<Response>>();
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastNotificationId = -1;
  private lastVersion: bigint | null = null;
  private polling = false;
  private lastDataSent = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly version: DataVersionService,
  ) {}

  get connections(): number {
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  /** Подключение: заголовки SSE, начальное состояние, учёт до закрытия соединения. */
  async connect(userId: number, res: Response, onClose: (cb: () => void) => void): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx: не буферизовать поток
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    let set = this.clients.get(userId);
    if (!set) this.clients.set(userId, (set = new Set()));
    set.add(res);
    onClose(() => {
      set!.delete(res);
      if (!set!.size) this.clients.delete(userId);
      if (!this.clients.size) this.stop();
    });
    // Отсчёт новых уведомлений — с момента подключения: иначе созданные до первого опроса терялись бы
    if (this.lastNotificationId < 0) {
      const last = await this.prisma.notification.aggregate({ _max: { id: true } });
      this.lastNotificationId = last._max.id ?? 0;
    }
    this.start();
    const [unread, version] = await Promise.all([this.unread([userId]), this.version.current()]);
    this.send(res, 'hello', { unread: unread.get(userId) ?? 0, version: String(version) });
  }

  private send(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
    this.heartbeat = setInterval(() => {
      for (const set of this.clients.values()) for (const res of set) res.write(': ping\n\n');
    }, HEARTBEAT_MS);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = null;
    this.heartbeat = null;
  }

  private async unread(ids: number[]): Promise<Map<number, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.notification.groupBy({
      by: ['employeeId'], where: { employeeId: { in: ids }, isRead: false }, _count: true,
    });
    return new Map(rows.map((r) => [r.employeeId, r._count]));
  }

  /** Новые уведомления — их получателям; изменение данных графика — всем подключённым. */
  async poll(): Promise<void> {
    if (this.polling || !this.clients.size) return;
    this.polling = true;
    try {
      const fresh = await this.prisma.notification.groupBy({
        by: ['employeeId'], where: { id: { gt: this.lastNotificationId } }, _max: { id: true },
      });
      for (const r of fresh) this.lastNotificationId = Math.max(this.lastNotificationId, r._max.id ?? 0);
      const targets = fresh.map((r) => r.employeeId).filter((id) => this.clients.has(id));
      const counts = await this.unread(targets);
      for (const id of targets) {
        for (const res of this.clients.get(id) ?? []) this.send(res, 'notifications', { unread: counts.get(id) ?? 0 });
      }
      const now = Date.now();
      if (now - this.lastDataSent >= DATA_EVERY_MS) {
        const v = await this.version.current();
        if (this.lastVersion !== null && v !== this.lastVersion) {
          for (const set of this.clients.values()) for (const res of set) this.send(res, 'data', { version: String(v) });
          this.lastDataSent = now;
        }
        this.lastVersion = v;
      }
    } catch (e) {
      this.log.warn(`Опрос событий: ${(e as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** Остановка процесса: клиенты переподключатся к другому процессу сами (retry). */
  onApplicationShutdown(): void {
    this.stop();
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}
