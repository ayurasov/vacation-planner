// Плановые задачи (v0.6.0): общий планировщик, не зависящий от почты. Каждый процесс кластера
// раз в минуту проходит задачи; ежедневная задача выполняется один раз за сутки по времени
// организации (строка в job_runs), остальные идемпотентны сами — их повтор ничего не дублирует.
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { LoginJournal } from '../auth/login-journal.service';
import { dateIn } from '../infra/clock';

export type Job = (now: Date) => Promise<unknown>;

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
      const jobs: Array<[string, Job]> = [['login-retention', (n) => this.loginRetention(n)], ...this.extra];
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

  private async loginRetention(now: Date): Promise<void> {
    if (!(await this.daily('login-retention', now))) return;
    const settings = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    const removed = await this.journal.purge(settings?.loginRetentionDays ?? 365);
    if (removed) this.log.log(`Журнал входов: удалено записей старше срока хранения — ${removed}`);
  }
}
