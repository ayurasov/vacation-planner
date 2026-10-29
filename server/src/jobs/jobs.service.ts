// Плановые задачи (v0.6.0): общий планировщик, не зависящий от почты. Каждый процесс кластера
// раз в минуту проходит задачи; ежедневная задача выполняется один раз за сутки по времени
// организации (строка в job_runs), остальные идемпотентны сами — их повтор ничего не дублирует.
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { LoginJournal } from '../auth/login-journal.service';
import { dateIn } from '../infra/clock';

export type Job = (now: Date) => Promise<unknown>;

/**
 * Сроки хранения служебных данных (v1.0.0, E51-08): без них таблицы растут без предела — refresh-токен
 * добавляется при каждом обновлении сеанса, письмо и уведомление — при каждом событии. Документы
 * кадрового учёта (заявки, история, извещения, утверждённые графики, аудит) не удаляются.
 */
export const RETENTION = {
  /** Письма отправленные и не отправленные после всех попыток — для разбора жалоб «письмо не пришло». */
  mailDays: 90,
  /** Прочитанные уведомления — их список в колокольчике. */
  notificationDays: 365,
  /** Отметки ежедневных задач. */
  jobRunDays: 90,
};

@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Jobs');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly extra = new Map<string, Job>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: LoginJournal,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = Number(process.env.JOBS_POLL_SECONDS ?? 60);
    if (!seconds) return; // тесты вызывают tick() сами
    this.timer = setInterval(() => { void this.tick(); }, seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Задачи других модулей (извещения, эскалация, кампания планирования) регистрируются при старте. */
  register(name: string, job: Job): void {
    this.extra.set(name, job);
  }

  /** Один проход всех задач; ошибка одной не останавливает остальные. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const jobs: Array<[string, Job]> = [
        ['login-retention', (n) => this.loginRetention(n)],
        ['data-retention', (n) => this.dataRetention(n)],
        ...this.extra,
      ];
      for (const [name, job] of jobs) {
        try {
          await job(now);
        } catch (e) {
          this.log.error(`Задача ${name}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Раз в сутки по времени организации; true — эта задача за эти сутки досталась этому вызову. */
  async daily(name: string, now: Date): Promise<boolean> {
    const settings = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    const period = dateIn(settings?.timezone ?? 'Europe/Moscow', now);
    const claimed = await this.prisma.$queryRaw<Array<{ name: string }>>`
      INSERT INTO job_runs (name, period) VALUES (${name}, ${period}) ON CONFLICT DO NOTHING RETURNING name`;
    return claimed.length > 0;
  }

  /** Удаление пачками: долгий DELETE не держит блокировки и не раздувает WAL одной транзакцией. */
  private async purge(sql: (limit: number) => Prisma.Sql): Promise<number> {
    let removed = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw(sql(5000));
      removed += n;
      if (n < 5000) return removed;
    }
  }

  async dataRetention(now: Date): Promise<Record<string, number> | undefined> {
    if (!(await this.daily('data-retention', now))) return undefined;
    const removed = {
      // Истёкший токен отклоняется и без строки. Отозванный токен живого сеанса хранится до истечения:
      // его повторное предъявление — признак кражи, по нему сеанс завершается (AuthService.refresh)
      refreshTokens: await this.purge((limit) => Prisma.sql`
        DELETE FROM refresh_tokens WHERE id IN (
          SELECT r.id FROM refresh_tokens r
           WHERE r.expires_at < now() - interval '1 day'
              OR (r.revoked_at < now() - interval '1 day' AND NOT EXISTS (
                    SELECT 1 FROM refresh_tokens l
                     WHERE l.session_id = r.session_id AND l.revoked_at IS NULL AND l.expires_at > now()))
           LIMIT ${limit})`),
      mail: await this.purge((limit) => Prisma.sql`
        DELETE FROM email_outbox WHERE id IN (
          SELECT id FROM email_outbox
           WHERE status IN ('sent', 'failed') AND coalesce(sent_at, created_at) < now() - ${RETENTION.mailDays}::int * interval '1 day'
           LIMIT ${limit})`),
      notifications: await this.purge((limit) => Prisma.sql`
        DELETE FROM notifications WHERE id IN (
          SELECT id FROM notifications
           WHERE is_read AND created_at < now() - ${RETENTION.notificationDays}::int * interval '1 day'
           LIMIT ${limit})`),
      // Последняя отметка каждой задачи остаётся: по ней метрика vp_job_last_run_timestamp_seconds
      jobRuns: await this.prisma.$executeRaw`
        DELETE FROM job_runs j WHERE ran_at < now() - ${RETENTION.jobRunDays}::int * interval '1 day'
           AND ran_at < (SELECT max(ran_at) FROM job_runs k WHERE k.name = j.name)`,
    };
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    if (total) this.log.log(`Сроки хранения: удалено ${JSON.stringify(removed)}`);
    return removed;
  }

  private async loginRetention(now: Date): Promise<void> {
    if (!(await this.daily('login-retention', now))) return;
    const settings = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    const removed = await this.journal.purge(settings?.loginRetentionDays ?? 365);
    if (removed) this.log.log(`Журнал входов: удалено записей старше срока хранения — ${removed}`);
  }
}
