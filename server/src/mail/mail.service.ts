// Письма: постановка в очередь в транзакции события (outbox), фоновая отправка с повторами,
// еженедельная сводка руководителям. Несколько экземпляров сервера не отправят письмо дважды:
// письма разбираются с FOR UPDATE SKIP LOCKED и арендой, сводка — по строке job_runs.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { directReports } from '../requests/approval-scope';
import { toIso } from '../requests/balance';
import { mailConfig, type MailConfig } from './mail.config';
import { backoffMinutes, digestLetter, digestWeek, letterFor, MAX_ATTEMPTS, type Letter } from './letters';

/** Транспорт отправки: nodemailer в работе, подмена в тестах. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

type Db = Prisma.TransactionClient | PrismaService;

interface Claimed { id: number; to_address: string; subject: string; body: string; attempts: number }

@Injectable()
export class MailService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Mail');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  get config(): MailConfig {
    return mailConfig();
  }

  onApplicationBootstrap(): void {
    const cfg = this.config;
    if (!cfg.enabled || !cfg.pollSeconds) return;
    this.timer = setInterval(() => { void this.tick(); }, cfg.pollSeconds * 1000);
    this.timer.unref();
    this.log.log(`Почта: ${cfg.host}:${cfg.port}, опрос очереди раз в ${cfg.pollSeconds} с`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runDigest(new Date());
      await this.drain();
    } catch (e) {
      this.log.error(`Очередь писем: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Письмо к уведомлению — в той же транзакции; без адреса, при отписке или без SMTP — ничего. */
  async enqueueFor(tx: Db, employeeId: number, kind: string, text: string): Promise<void> {
    const cfg = this.config;
    if (!cfg.enabled) return;
    const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { name: true, email: true, emailNotifications: true, isActive: true } });
    if (!e?.email || !e.emailNotifications || !e.isActive) return;
    await this.enqueue(tx, employeeId, e.email, kind, letterFor(kind, text, e.name, cfg.appUrl));
  }

  /** Письма многим сотрудникам одним запросом (кампания планирования: тысяча адресатов). */
  async enqueueMany(tx: Db, items: Array<{ employeeId: number; text: string }>, kind: string): Promise<void> {
    const cfg = this.config;
    if (!cfg.enabled || !items.length) return;
    const recipients = await tx.employee.findMany({
      where: { id: { in: items.map((i) => i.employeeId) }, isActive: true, emailNotifications: true, email: { not: null } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(recipients.map((r) => [r.id, r]));
    const data = items.flatMap((i) => {
      const r = byId.get(i.employeeId);
      if (!r?.email) return [];
      const letter = letterFor(kind, i.text, r.name, cfg.appUrl);
      return [{ employeeId: r.id, to: r.email, kind, subject: letter.subject, body: letter.body }];
    });
    if (data.length) await tx.emailOutbox.createMany({ data });
  }

  async enqueue(tx: Db, employeeId: number | null, to: string, kind: string, letter: Letter): Promise<void> {
    await tx.emailOutbox.create({ data: { employeeId, to, kind, subject: letter.subject, body: letter.body } });
  }

  /**
   * Разбор очереди за проход: пачками, пока есть письма и не вышло время прохода. Одна пачка в 15 секунд
   * давала 1,3 письма в секунду на процесс — 2000 приглашений кампании уходили бы полчаса (E51-03);
   * ограничение по времени не даёт проходу задержать сводку и не держит процесс занятым сколь угодно долго.
   */
  async drain(budgetMs = 10_000): Promise<{ sent: number; failed: number }> {
    const t0 = Date.now();
    const total = { sent: 0, failed: 0 };
    for (;;) {
      const r = await this.flush();
      total.sent += r.sent;
      total.failed += r.failed;
      if (r.sent + r.failed < 20 || r.sent === 0 || Date.now() - t0 >= budgetMs) return total;
    }
  }

  /**
   * Отправка ожидающих писем. Аренда: выбранные письма откладываются на 5 минут и получают
   * попытку ещё до отправки — упавший процесс не держит их, параллельный их не возьмёт.
   */
  async flush(limit = 20): Promise<{ sent: number; failed: number }> {
    const claimed = await this.prisma.$queryRaw<Claimed[]>`
      UPDATE email_outbox SET next_attempt_at = now() + interval '5 minutes', attempts = attempts + 1
       WHERE id IN (SELECT id FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= now()
                     ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, to_address, subject, body, attempts`;
    let sent = 0;
    let failed = 0;
    const from = this.config.from;
    for (const m of claimed) {
      try {
        await this.transport.sendMail({ from, to: m.to_address, subject: m.subject, text: m.body });
        await this.prisma.emailOutbox.update({ where: { id: m.id }, data: { status: 'sent', sentAt: new Date(), lastError: null } });
        sent++;
      } catch (e) {
        failed++;
        const last = m.attempts >= MAX_ATTEMPTS;
        await this.prisma.emailOutbox.update({
          where: { id: m.id },
          data: {
            status: last ? 'failed' : 'pending',
            lastError: String((e as Error).message ?? e).slice(0, 500),
            nextAttemptAt: new Date(Date.now() + backoffMinutes(m.attempts) * 60_000),
          },
        });
        this.log.warn(`Письмо #${m.id}: попытка ${m.attempts} не удалась${last ? ', больше не повторяем' : ''}`);
      }
    }
    return { sent, failed };
  }

  /** Еженедельная сводка: в пятницу после 12:00 по времени организации, один раз за неделю. */
  async runDigest(now: Date): Promise<number> {
    const cfg = this.config;
    if (!cfg.enabled) return 0;
    const settings = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    const week = digestWeek(now, settings?.timezone ?? 'Europe/Moscow');
    if (!week) return 0;
    const claimed = await this.prisma.$queryRaw<Array<{ name: string }>>`
      INSERT INTO job_runs (name, period) VALUES ('weekly-digest', ${week.weekStart})
      ON CONFLICT DO NOTHING RETURNING name`;
    if (!claimed.length) return 0; // этот период уже разослан (другим экземпляром или раньше)
    return this.sendDigests(week.weekStart, week.weekEnd);
  }

  /** Сводки руководителям: подчинённые по правилу руководителя и сотрудники руководимых подразделений. */
  async sendDigests(weekStart: string, weekEnd: string): Promise<number> {
    const cfg = this.config;
    const managers = await this.prisma.employee.findMany({
      where: {
        isActive: true, emailNotifications: true, email: { not: null },
        OR: [{ subordinates: { some: { isActive: true } } }, { managedDepts: { some: {} } }],
      },
      select: { id: true, name: true, email: true, managedDepts: { select: { id: true } } },
    });
    let queued = 0;
    for (const m of managers) {
      const reports = await directReports(this.prisma, m.id);
      const team = await this.prisma.employee.findMany({
        where: {
          isActive: true, id: { not: m.id },
          OR: [{ id: { in: reports } }, { deptId: { in: m.managedDepts.map((d) => d.id) } }],
        },
        select: { id: true, name: true },
      });
      const ids = team.map((e) => e.id);
      const [vacations, pending] = await Promise.all([
        this.prisma.vacationRequest.findMany({
          where: { employeeId: { in: ids }, status: 'approved', startDate: { lte: new Date(weekEnd) }, endDate: { gte: new Date(weekStart) } },
          select: { employeeId: true, startDate: true, endDate: true },
        }),
        // ждут решения именно этого руководителя — его подчинённые по правилу руководителя
        this.prisma.vacationRequest.count({ where: { status: 'pending', employeeId: { in: reports } } }),
      ]);
      const names = new Map(team.map((e) => [e.id, e.name]));
      const letter = digestLetter({
        recipient: m.name, weekStart, weekEnd, pending, appUrl: cfg.appUrl,
        absences: vacations.map((v) => ({ name: names.get(v.employeeId)!, start: toIso(v.startDate), end: toIso(v.endDate) })),
      });
      if (!letter) continue;
      await this.enqueue(this.prisma, m.id, m.email!, 'weekly_digest', letter);
      queued++;
    }
    return queued;
  }
}
