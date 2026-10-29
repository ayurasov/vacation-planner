// Живые обновления (E40-04): поток событий сервера (SSE) вместо опроса раз в 30 секунд.
// Несколько процессов и экземпляров: каждый раз в 2 секунды одним запросом проверяет новые
// уведомления и версию данных в PostgreSQL — общий источник, без отдельного брокера сообщений.
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../infra/prisma.service';
import { DataVersionService } from '../infra/data-version';
import { sseConnections } from '../infra/metrics';

const POLL_MS = Number(process.env.EVENTS_POLL_MS ?? 2000);
const HEARTBEAT_MS = 25_000; // меньше таймаута простоя прокси: соединение не рвётся
// При 5000 пользователях данные меняются несколько раз в секунду: «данные изменились» — не чаще 15 с
const DATA_EVERY_MS = 15_000;
// Отзыв сеанса (смена пароля, увольнение) закрывает открытые потоки — не позже чем через 10 с,
// как и кэш сеанса в JwtAuthGuard
const SESSION_CHECK_MS = 10_000;

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
  private lastSessionCheck = 0;
  /** Версия пароля, с которой открыт поток. */
  // Версия пароля и сеанс, с которыми открыт поток: по ним поток закрывается при отзыве
  private readonly auth = new WeakMap<Response, { pwv: number; sid?: string }>();

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
  async connect(userId: number, pwVersion: number, res: Response, onClose: (cb: () => void) => void, sid?: string): Promise<void> {
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
    this.auth.set(res, { pwv: pwVersion, sid });
    sseConnections.set({}, this.connections);
    onClose(() => this.drop(userId, res));
    // Отсчёт новых уведомлений — с момента подключения: иначе созданные до первого опроса терялись бы
    if (this.lastNotificationId < 0) {
      const last = await this.prisma.notification.aggregate({ _max: { id: true } });
      this.lastNotificationId = last._max.id ?? 0;
    }
    this.start();
    const [unread, version] = await Promise.all([this.unread([userId]), this.version.current()]);
    this.send(res, 'hello', { unread: unread.get(userId) ?? 0, version: String(version) });
  }

  /** Поток больше не учитывается: клиент отключился или сеанс отозван (повторный вызов безвреден). */
  private drop(userId: number, res: Response): void {
    const set = this.clients.get(userId);
    if (!set?.delete(res)) return;
    if (!set.size) this.clients.delete(userId);
    sseConnections.set({}, this.connections);
    if (!this.clients.size) this.stop();
  }

  private send(res: Response, event: string, data: unknown): void {
    if (res.writableEnded) return; // поток закрыт (отзыв), пока готовился hello
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
      if (now - this.lastSessionCheck >= SESSION_CHECK_MS) {
        this.lastSessionCheck = now;
        await this.closeRevoked();
      }
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

  /**
   * Потоки сотрудников, чей сеанс отозван (пароль, увольнение, завершённый сеанс): revoked и закрытие.
   * Проверяются только потоки из снимка до запросов к БД: до v1.0.0 после запросов перебирались
   * текущие потоки, и подключившийся за это время (его сеанса не было в запросе) получал ложный
   * revoked — клиент выводил сотрудника на экран входа (прогоны spike и stress, 1 и 199 потоков).
   */
  private async closeRevoked(): Promise<void> {
    const streams = [...this.clients].flatMap(([id, set]) => [...set].map((res) => ({ id, res, auth: this.auth.get(res) })));
    if (!streams.length) return;
    const ids = [...new Set(streams.map((s) => s.id))];
    const sids = [...new Set(streams.map((s) => s.auth?.sid).filter((s): s is string => !!s))];
    const [rows, alive] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true, pwVersion: true } }),
      sids.length
        ? this.prisma.refreshToken.findMany({ where: { sessionId: { in: sids }, revokedAt: null, expiresAt: { gt: new Date() } }, select: { sessionId: true }, distinct: ['sessionId'] })
        : Promise.resolve([] as Array<{ sessionId: string }>),
    ]);
    const state = new Map(rows.map((r) => [r.id, r]));
    const aliveSids = new Set(alive.map((r) => r.sessionId));
    for (const { id, res, auth } of streams) {
      if (!this.clients.get(id)?.has(res)) continue; // закрыт, пока шли запросы
      const e = state.get(id);
      if (e?.isActive && e.pwVersion === auth?.pwv && (!auth.sid || aliveSids.has(auth.sid))) continue;
      this.send(res, 'revoked', {});
      res.end();
      this.drop(id, res);
    }
  }

  /** Остановка процесса: клиенты переподключатся к другому процессу сами (retry). */
  onApplicationShutdown(): void {
    this.stop();
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}
