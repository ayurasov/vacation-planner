// Журнал входов (v0.6.0, E62-01): успешные и неуспешные попытки, блокировки, повтор refresh-токена.
// Отдельно от audit_events: входов на порядки больше, у журнала свой срок хранения.
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { ClientInfo } from './client-info';
import { describeAgent } from './client-info';

export type LoginResultCode =
  | 'success' | 'bad_password' | 'unknown_login' | 'locked' | 'rate_limited' | 'password_disabled'
  | 'sso_success' | 'sso_unknown' | 'refresh_reuse';

export const LOGIN_RESULTS: LoginResultCode[] = [
  'success', 'bad_password', 'unknown_login', 'locked', 'rate_limited', 'password_disabled',
  'sso_success', 'sso_unknown', 'refresh_reuse',
];

export interface LoginEventInput extends ClientInfo {
  employeeId?: number | null;
  login: string;
  result: LoginResultCode;
  method: 'password' | 'oidc' | 'refresh';
}

@Injectable()
export class LoginJournal {
  private readonly log = new Logger('LoginJournal');

  constructor(private readonly prisma: PrismaService) {}

  /** Запись не должна мешать входу: ошибка журнала пишется в лог сервера, вход продолжается. */
  async record(e: LoginEventInput): Promise<void> {
    try {
      await this.prisma.loginEvent.create({
        data: {
          employeeId: e.employeeId ?? null, login: e.login.trim().slice(0, 64), result: e.result, method: e.method,
          ip: e.ip ?? null, userAgent: e.userAgent ?? null,
        },
      });
    } catch (err) {
      this.log.error(`Журнал входов: ${(err as Error).message}`);
    }
  }

  async list(params: {
    employee?: number; login?: string; result?: LoginResultCode; failedOnly?: boolean;
    from?: string; to?: string; page: number; perPage: number;
  }) {
    const where: Prisma.LoginEventWhereInput = {
      ...(params.employee ? { employeeId: params.employee } : {}),
      ...(params.login ? { login: { contains: params.login.trim(), mode: 'insensitive' } } : {}),
      ...(params.result ? { result: params.result } : {}),
      ...(params.failedOnly ? { result: { notIn: ['success', 'sso_success'] } } : {}),
      ...(params.from || params.to ? {
        ts: {
          ...(params.from ? { gte: new Date(`${params.from}T00:00:00Z`) } : {}),
          ...(params.to ? { lt: new Date(new Date(`${params.to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
        },
      } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loginEvent.findMany({
        where, orderBy: { ts: 'desc' }, skip: (params.page - 1) * params.perPage, take: params.perPage,
        include: { employee: { select: { name: true } } },
      }),
      this.prisma.loginEvent.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: Number(r.id), ts: r.ts.toISOString(), employeeId: r.employeeId, employeeName: r.employee?.name ?? null,
        login: r.login, result: r.result, method: r.method, ip: r.ip, device: describeAgent(r.userAgent),
      })),
      meta: { page: params.page, perPage: params.perPage, total },
    };
  }

  /** Срок хранения — правило организации; удаление пачками, чтобы не держать долгую блокировку. */
  async purge(retentionDays: number): Promise<number> {
    let removed = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM login_events WHERE id IN (
          SELECT id FROM login_events WHERE ts < now() - ${retentionDays}::int * interval '1 day' LIMIT 5000)`;
      removed += n;
      if (n < 5000) return removed;
    }
  }
}
