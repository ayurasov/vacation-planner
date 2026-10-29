import { Injectable } from '@nestjs/common';
import type { Prisma, Employee } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { hashPassword, verifyPassword } from './passwords';
import { TokenService } from './token.service';
import { oidcConfig } from './oidc';
import { invalidateSession } from './guards';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoginJournal } from './login-journal.service';
import { type ClientInfo, describeAgent } from './client-info';
import { weakPasswordReason } from './password-policy';
import { generatePassword } from '../employees/employees.service';

export interface LoginResult {
  accessToken: string;
  expiresAt: Date; // срок access-токена
  refreshToken: string; // выставляется контроллером в httpOnly cookie
  // Срок refresh-токена и cookie (30 дней). До v0.5.0 cookie получала срок access-токена (15 минут):
  // браузер удалял её вместе с истечением токена, и через 15 минут работы сотрудника выбрасывало на вход
  refreshExpiresAt: Date;
  user: Employee & { subordinates: number[] };
}

/** Сеанс — цепочка refresh-токенов одного входа (v0.6.0). */
interface SessionSeed extends ClientInfo {
  sessionId?: string;
  startedAt?: Date;
  method: 'password' | 'oidc';
}

/**
 * Окно, в котором уже отозванный ротацией refresh-токен ещё принимается: две вкладки обновляют
 * токен одновременно с одной cookie, и вторая не должна выбрасывать сотрудника на вход.
 * Позже предъявленный отозванный токен — признак кражи: сеанс завершается целиком.
 */
const ROTATION_GRACE_MS = 30_000;

type Db = PrismaService | Prisma.TransactionClient;

interface SecuritySettings { passwordMinLength: number; lockoutThreshold: number; lockoutMinutes: number; timezone: string }

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly journal: LoginJournal,
  ) {}

  async login(login: string, password: string, client: ClientInfo = {}): Promise<LoginResult> {
    const employee = await this.prisma.employee.findFirst({
      where: { login: { equals: login, mode: 'insensitive' }, isActive: true },
    });
    // Единая ошибка: не раскрываем, что именно неверно
    // Пароль проверяется и для неизвестного логина (заглушкой) — по времени ответа логин не угадать
    const valid = await verifyPassword(password, employee?.passwordHash);
    const event = { login, method: 'password' as const, ...client };
    if (!employee) {
      await this.journal.record({ ...event, result: 'unknown_login' });
      throw new ProblemException('auth/invalid-credentials');
    }
    const settings = await this.securitySettings();
    const state = await this.prisma.loginState.findUnique({ where: { employeeId: employee.id } });
    if (state?.lockedUntil && state.lockedUntil > new Date()) {
      await this.journal.record({ ...event, employeeId: employee.id, result: 'locked' });
      // О блокировке узнаёт только тот, кто знает пароль; подбирающий видит обычный отказ
      if (valid) {
        throw new ProblemException('auth/account-locked',
          `Учётная запись заблокирована до ${clock(state.lockedUntil, settings.timezone)} после неудачных попыток входа. Повторите позже или обратитесь в кадровую службу`);
      }
      throw new ProblemException('auth/invalid-credentials');
    }
    if (!valid) {
      await this.registerFailure(employee, settings, event);
      throw new ProblemException('auth/invalid-credentials');
    }
    // С единым входом пароль можно отключить; администраторам он остаётся — аварийный доступ
    const sso = oidcConfig();
    if (sso.enabled && !sso.localLogin && !employee.isAdmin) {
      await this.journal.record({ ...event, employeeId: employee.id, result: 'password_disabled' });
      throw new ProblemException('auth/forbidden', 'Вход по паролю отключён — войдите через корпоративную учётную запись');
    }
    await this.prisma.loginState.upsert({
      where: { employeeId: employee.id },
      update: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
      create: { employeeId: employee.id, lastLoginAt: new Date() },
    });
    await this.journal.record({ ...event, employeeId: employee.id, result: 'success' });
    return this.issueFor(this.prisma, employee.id, { method: 'password', ...client });
  }

  /**
   * Неудачная попытка: счётчик подряд идущих ошибок растёт атомарно (параллельные попытки не теряются);
   * на пороге — блокировка на заданное время и уведомление сотруднику.
   */
  private async registerFailure(
    employee: Employee, settings: SecuritySettings, event: { login: string; method: 'password' } & ClientInfo,
  ): Promise<void> {
    const [row] = await this.prisma.$queryRaw<Array<{ failed: number }>>`
      INSERT INTO login_state (employee_id, failed_logins) VALUES (${employee.id}, 1)
      ON CONFLICT (employee_id) DO UPDATE SET failed_logins = login_state.failed_logins + 1
      RETURNING failed_logins AS failed`;
    if (!settings.lockoutThreshold || row.failed < settings.lockoutThreshold) {
      await this.journal.record({ ...event, employeeId: employee.id, result: 'bad_password' });
      return;
    }
    const until = new Date(Date.now() + settings.lockoutMinutes * 60_000);
    await this.prisma.loginState.update({ where: { employeeId: employee.id }, data: { failedLogins: 0, lockedUntil: until } });
    await this.journal.record({ ...event, employeeId: employee.id, result: 'locked' });
    await this.notify.notify(this.prisma, employee.id, 'account_locked',
      `После ${row.failed} неудачных попыток входа подряд учётная запись заблокирована до ${clock(until, settings.timezone)}. Если это были не вы — смените пароль и сообщите в службу информационной безопасности.`);
  }

  /** Вход через единый вход: сотрудник найден по логину из утверждений провайдера. */
  async loginByLogin(login: string, client: ClientInfo = {}): Promise<LoginResult | null> {
    const employee = await this.prisma.employee.findFirst({
      where: { login: { equals: login, mode: 'insensitive' }, isActive: true }, select: { id: true },
    });
    await this.journal.record({ login, method: 'oidc', ...client, employeeId: employee?.id ?? null, result: employee ? 'sso_success' : 'sso_unknown' });
    if (!employee) return null;
    await this.prisma.loginState.upsert({
      where: { employeeId: employee.id },
      update: { lastLoginAt: new Date() },
      create: { employeeId: employee.id, lastLoginAt: new Date() },
    });
    return this.issueFor(this.prisma, employee.id, { method: 'oidc', ...client });
  }

  /**
   * Ротация refresh в одной транзакции: старый отзывается, только если он ещё действителен
   * (раньше проверка и отзыв шли двумя запросами, и два параллельных обновления одним токеном
   * получали две пары). Сеанс переносится в новую запись.
   */
  async refresh(token: string, client: ClientInfo = {}): Promise<LoginResult> {
    const hash = this.tokens.hashRefresh(token);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [rotated] = await tx.$queryRaw<Array<{ user_id: number; session_id: string; session_started_at: Date; method: string }>>`
        UPDATE refresh_tokens SET revoked_at = now()
         WHERE token_hash = ${hash} AND revoked_at IS NULL AND expires_at > now()
        RETURNING user_id, session_id::text AS session_id, session_started_at, method`;
      if (rotated) return { result: await this.issueFor(tx, rotated.user_id, seedOf(rotated, client)) };

      const stored = await tx.refreshToken.findUnique({ where: { tokenHash: hash } });
      if (!stored || stored.expiresAt < new Date() || !stored.revokedAt) return { invalid: true as const };
      const alive = await tx.refreshToken.count({ where: { sessionId: stored.sessionId, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!alive) return { invalid: true as const }; // сеанс завершён: выход, смена пароля, завершение из списка
      if (Date.now() - stored.revokedAt.getTime() <= ROTATION_GRACE_MS) {
        // Параллельная вкладка с той же cookie: ещё одна пара в том же сеансе
        return { result: await this.issueFor(tx, stored.userId, seedOf({ session_id: stored.sessionId, session_started_at: stored.sessionStartedAt, method: stored.method }, client)) };
      }
      // Старый токен предъявлен повторно — его могли украсть: сеанс завершается целиком
      await tx.refreshToken.updateMany({ where: { sessionId: stored.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
      return { reuse: stored.userId };
    });
    if ('result' in outcome && outcome.result) return outcome.result;
    if ('reuse' in outcome && outcome.reuse !== undefined) {
      invalidateSession(outcome.reuse);
      const who = await this.prisma.employee.findUnique({ where: { id: outcome.reuse }, select: { login: true } });
      await this.journal.record({ login: who?.login ?? '', employeeId: outcome.reuse, method: 'refresh', result: 'refresh_reuse', ...client });
    }
    throw new ProblemException('auth/invalid-credentials', 'Refresh-токен недействителен');
  }

  /** Выход завершает сеанс целиком — вместе с токенами параллельных вкладок. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.tokens.hashRefresh(token) } });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({ where: { sessionId: stored.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    invalidateSession(stored.userId);
  }

  // ── Сеансы (E62-03) ──

  /** Активные сеансы: у каждого — один действующий refresh-токен (последний в цепочке). */
  async sessions(userId: number, currentSid?: string) {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.sessionId) && seen.add(r.sessionId)).map((r) => ({
      id: r.sessionId, current: r.sessionId === currentSid, method: r.method,
      startedAt: r.sessionStartedAt.toISOString(), lastActiveAt: r.createdAt.toISOString(),
      ip: r.ip, device: describeAgent(r.userAgent),
    }));
  }

  async revokeSession(userId: number, sessionId: string): Promise<boolean> {
    const r = await this.prisma.refreshToken.updateMany({ where: { userId, sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    invalidateSession(userId);
    return r.count > 0;
  }

  /** Все сеансы, кроме текущего; без текущего (staff, `except` не задан) — все. */
  async revokeSessions(userId: number, opts: { except?: string; actorId?: number } = {}): Promise<number> {
    const r = await this.prisma.$transaction(async (tx) => {
      const res = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null, ...(opts.except ? { sessionId: { not: opts.except } } : {}) },
        data: { revokedAt: new Date() },
      });
      if (opts.actorId !== undefined && opts.actorId !== userId) {
        await this.audit.record(tx, { actorId: opts.actorId, action: 'employee.sessions_revoked', entity: 'employee', entityId: userId, after: { sessions: res.count } });
      }
      return res;
    });
    invalidateSession(userId);
    return r.count;
  }

  // ── Пароли (E62-04) ──

  async passwordPolicy(): Promise<{ minLength: number }> {
    return { minLength: (await this.securitySettings()).passwordMinLength };
  }

  async changeOwnPassword(userId: number, oldPassword: string, newPassword: string): Promise<void> {
    const me = await this.prisma.employee.findUnique({ where: { id: userId } });
    if (!me || !(await verifyPassword(oldPassword, me.passwordHash))) {
      throw new ProblemException('auth/invalid-credentials', 'Старый пароль неверен');
    }
    if (oldPassword === newPassword) throw new ProblemException('validation/weak-password', 'Новый пароль совпадает с текущим');
    await this.assertStrong(newPassword, me);
    await this.setPassword(userId, newPassword, { oneTime: false });
  }

  /** Пароль, который задаёт кадровая служба, проверяется политикой и действует до первого входа. */
  async setPasswordByStaff(userId: number, newPassword: string, actorId: number): Promise<void> {
    const target = await this.prisma.employee.findUnique({ where: { id: userId } });
    if (!target) throw new ProblemException('not-found');
    await this.assertStrong(newPassword, target);
    await this.setPassword(userId, newPassword, { resetBy: actorId, oneTime: true });
  }

  /** Сброс: сервер сам выдаёт случайный пароль длиной не меньше политики; сменить — при первом входе. */
  async resetPassword(userId: number, actorId: number): Promise<string> {
    const { passwordMinLength } = await this.securitySettings();
    const password = generatePassword(Math.max(passwordMinLength, 10));
    await this.setPassword(userId, password, { resetBy: actorId, oneTime: true });
    return password;
  }

  async assertStrong(password: string, who: { login: string; name: string }): Promise<void> {
    const reason = weakPasswordReason(password, { minLength: (await this.securitySettings()).passwordMinLength, login: who.login, name: who.name });
    if (reason) throw new ProblemException('validation/weak-password', reason);
  }

  /** Смена пароля завершает все сеансы; `resetBy` — кто сбросил чужой пароль (в аудит, сам пароль — нет). */
  async setPassword(userId: number, newPassword: string, opts: { resetBy?: number; oneTime: boolean }): Promise<void> {
    const passwordHash = await hashPassword(newPassword); // до транзакции: хеш не держит соединение БД
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: userId },
        data: { passwordHash, pwVersion: { increment: 1 }, mustChangePassword: opts.oneTime, passwordChangedAt: new Date() },
      });
      // Смена пароля отзывает все refresh-токены
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (opts.resetBy !== undefined) {
        await this.audit.record(tx, {
          actorId: opts.resetBy, action: 'employee.password_reset', entity: 'employee', entityId: userId,
        });
      }
    });
    invalidateSession(userId); // после фиксации — см. EmployeesService.remove
  }

  /** Снять блокировку после неудачных попыток (кадровая служба). */
  async unlock(userId: number, actorId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.loginState.findUnique({ where: { employeeId: userId } });
      await tx.loginState.upsert({
        where: { employeeId: userId }, update: { failedLogins: 0, lockedUntil: null }, create: { employeeId: userId },
      });
      await this.audit.record(tx, {
        actorId, action: 'employee.unlocked', entity: 'employee', entityId: userId,
        before: { lockedUntil: before?.lockedUntil?.toISOString() ?? null, failedLogins: before?.failedLogins ?? 0 }, after: { lockedUntil: null },
      });
    });
  }

  /** Состояние учётной записи для карточки сотрудника (кадровая служба). */
  async securityOf(userId: number) {
    const [state, emp, sessions] = await Promise.all([
      this.prisma.loginState.findUnique({ where: { employeeId: userId } }),
      this.prisma.employee.findUnique({ where: { id: userId }, select: { mustChangePassword: true, passwordChangedAt: true } }),
      this.prisma.refreshToken.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { sessionId: true } }),
    ]);
    const locked = state?.lockedUntil && state.lockedUntil > new Date() ? state.lockedUntil.toISOString() : null;
    return {
      lastLoginAt: state?.lastLoginAt?.toISOString() ?? null,
      lockedUntil: locked,
      failedLogins: state?.failedLogins ?? 0,
      mustChangePassword: emp?.mustChangePassword ?? false,
      passwordChangedAt: emp?.passwordChangedAt?.toISOString() ?? null,
      activeSessions: new Set(sessions.map((s) => s.sessionId)).size,
    };
  }

  async setPreferences(userId: number, emailNotifications: boolean): Promise<Employee & { subordinates: number[] }> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.employee.findUniqueOrThrow({ where: { id: userId } });
      if (before.emailNotifications === emailNotifications) return;
      await tx.employee.update({ where: { id: userId }, data: { emailNotifications } });
      await this.audit.record(tx, {
        actorId: userId, action: 'employee.preferences_updated', entity: 'employee', entityId: userId,
        before: { emailNotifications: before.emailNotifications }, after: { emailNotifications },
      });
    });
    return this.me(userId);
  }

  async me(userId: number): Promise<Employee & { subordinates: number[] }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: userId },
      include: { subordinates: { where: { isActive: true }, select: { id: true } } },
    });
    if (!employee || !employee.isActive) throw new ProblemException('not-found');
    return { ...employee, subordinates: employee.subordinates.map((s) => s.id) };
  }

  private async securitySettings(): Promise<SecuritySettings> {
    const s = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    return {
      passwordMinLength: s?.passwordMinLength ?? 8,
      lockoutThreshold: s?.lockoutThreshold ?? 10,
      lockoutMinutes: s?.lockoutMinutes ?? 15,
      timezone: s?.timezone ?? 'Europe/Moscow',
    };
  }

  private async issueFor(db: Db, userId: number, seed: SessionSeed): Promise<LoginResult> {
    const employee = await db.employee.findUnique({
      where: { id: userId },
      include: { subordinates: { where: { isActive: true }, select: { id: true } } },
    });
    if (!employee || !employee.isActive) throw new ProblemException('auth/invalid-credentials');
    const sessionId = seed.sessionId ?? randomUUID();
    const access = this.tokens.signAccess({
      sub: employee.id, login: employee.login, isAdmin: employee.isAdmin, pwv: employee.pwVersion,
      sid: sessionId, amr: seed.method === 'oidc' ? 'sso' : 'pwd',
    });
    const refresh = this.tokens.newRefresh();
    await db.refreshToken.create({
      data: {
        userId: employee.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt,
        sessionId, sessionStartedAt: seed.startedAt ?? new Date(), method: seed.method,
        ip: seed.ip ?? null, userAgent: seed.userAgent ?? null,
      },
    });
    return {
      accessToken: access.token, expiresAt: access.expiresAt, refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user: { ...employee, subordinates: employee.subordinates.map((s) => s.id) },
    };
  }
}

function seedOf(r: { session_id: string; session_started_at: Date; method: string }, client: ClientInfo): SessionSeed {
  return { sessionId: r.session_id, startedAt: r.session_started_at, method: r.method === 'oidc' ? 'oidc' : 'password', ...client };
}

/** «10:45» по времени организации; если блокировка переходит через полночь — «10:45 29 октября». */
function clock(d: Date, timezone: string): string {
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(d);
  const day = (x: Date) => new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, day: 'numeric', month: 'long' }).format(x);
  return day(d) === day(new Date()) ? time : `${time} ${day(d)}`;
}

export type EmployeeWithSubs = Employee & { subordinates: number[] };
export type PrismaTx = Prisma.TransactionClient;
