// Лимит частоты входа (docs/specs/02-api-spec.md, «Общие правила»):
//  • 10 попыток в минуту на пару «адрес + логин» — подбор пароля к одной учётной записи;
//  • 60 попыток в минуту на адрес — перебор логинов; офис за NAT не блокируется целиком.
// Адрес клиента — req.ip с учётом trust proxy (app.setup.ts).
// Счётчики — в PostgreSQL (v0.5.0): общие для всех процессов и экземпляров сервера; раньше
// каждый процесс считал отдельно, и при N экземплярах лимит фактически умножался на N.
// Окно — календарная минута по часам СУБД (одни часы на все экземпляры) со скользящей оценкой:
// попытки текущей минуты + доля попыток предыдущей, ещё попадающая в последние 60 секунд.
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { LoginJournal } from './login-journal.service';
import { clientInfo } from './client-info';

export const MAX_PER_LOGIN = 10;
export const MAX_PER_ADDRESS = 60;

interface Counter { key: string; hits: number; prev: number; elapsed: number }

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private lastCleanup = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: LoginJournal,
  ) {}

  /** Только для тестов: сброс счётчиков. */
  static async resetForTests(prisma: PrismaService): Promise<void> {
    await prisma.$executeRaw`DELETE FROM login_attempts`;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ ip?: string; headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string }; body?: { login?: unknown } }>();
    const address = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const login = typeof req.body?.login === 'string' ? req.body.login.trim().toLowerCase().slice(0, 64) : '';
    const byAddress = `a:${address}`;
    const byLogin = `l:${address}:${login}`;
    // Обе попытки учитываются одним запросом; отклонённые попытки тоже считаются — подбор не продолжится
    const rows = await this.prisma.$queryRaw<Counter[]>`
      WITH w AS (SELECT date_trunc('minute', now()) AS start,
                        extract(epoch FROM now() - date_trunc('minute', now())) / 60.0 AS elapsed),
           up AS (
             INSERT INTO login_attempts (key, window_start, hits)
             SELECT k, w.start, 1 FROM w, unnest(ARRAY[${byAddress}, ${byLogin}]::text[]) AS k
             ON CONFLICT (key, window_start) DO UPDATE SET hits = login_attempts.hits + 1
             RETURNING key, hits)
      SELECT up.key, up.hits, coalesce(p.hits, 0) AS prev, w.elapsed::float8 AS elapsed
        FROM up CROSS JOIN w
        LEFT JOIN login_attempts p ON p.key = up.key AND p.window_start = w.start - interval '1 minute'`;
    const over = rows.some((r) => {
      const estimate = r.hits + r.prev * (1 - r.elapsed);
      return estimate > (r.key === byAddress ? MAX_PER_ADDRESS : MAX_PER_LOGIN);
    });
    void this.cleanup();
    if (over) {
      // Отказ по частоте тоже виден ИБ: так выглядит подбор пароля
      await this.journal.record({ login, method: 'password', result: 'rate_limited', ...clientInfo(req as never) });
      throw new ProblemException('rate-limited', 'Повторите попытку через минуту');
    }
    return true;
  }

  /** Старые окна удаляются не чаще раза в 5 минут; ошибка уборки не мешает входу. */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < 5 * 60_000) return;
    this.lastCleanup = now;
    try {
      await this.prisma.$executeRaw`DELETE FROM login_attempts WHERE window_start < now() - interval '5 minutes'`;
    } catch { /* следующая попытка через 5 минут */ }
  }
}
