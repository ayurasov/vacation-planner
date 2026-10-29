// Guard аутентификации (глобальный, APP_GUARD) и права по матрице docs/specs/02-api-spec.md раздел 8.
import {
  type CanActivate, type ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AccessClaims } from './token.service';
import { TokenService } from './token.service';
import { PrismaService } from '../infra/prisma.service';

/**
 * Сеанс действителен, пока не сменился пароль (pw_version), сотрудник не уволен и сам сеанс не завершён
 * (v0.6.0: выход, завершение из списка сеансов, кадровая служба). Раньше проверялась только подпись
 * access-токена: после смены пароля или увольнения токен работал ещё до 15 минут.
 * Кэш на процесс — 10 секунд; в процессе, где сменили пароль, уволили или завершили сеанс,
 * запись сбрасывается сразу.
 */
const SESSION_TTL_MS = 10_000;
interface UserState { pwv: number; active: boolean; mustChange: boolean; at: number; sids: Map<string, { alive: boolean; at: number }> }
const users = new Map<number, UserState>();

export function invalidateSession(userId: number): void {
  users.delete(userId);
}

/**
 * Пока сотрудник не сменил одноразовый пароль, API отвечает только на эти операции:
 * профиль, смена пароля, выход (v0.6.0, E62-04).
 */
export const PASSWORD_CHANGE_OK = 'vp_pw_change_ok';
export const AllowedBeforePasswordChange = () => SetMetadata(PASSWORD_CHANGE_OK, true);

export interface AuthedRequest extends Request {
  user?: AccessClaims;
}

export const IS_PUBLIC_KEY = 'vp_public';
/** Эндпоинт без аутентификации: health, производственный календарь, login. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'auth/invalid-credentials' });
    }
    const claims = this.tokens.verifyAccess(header.slice(7));
    const s = await this.state(claims.sub, claims.sid);
    const sessionAlive = !claims.sid || s.sids.get(claims.sid)?.alive;
    if (!s.active || s.pwv !== claims.pwv || !sessionAlive) throw new UnauthorizedException({ code: 'auth/token-expired' });
    // Вход по паролю, выданному кадровой службой: до смены доступны только профиль, смена пароля и выход
    if (s.mustChange && claims.amr !== 'sso'
      && !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_OK, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException({ code: 'auth/password-change-required' });
    }
    req.user = claims;
    return true;
  }

  /** Состояние сотрудника и сеанса одним запросом; кэш — 10 секунд на процесс. */
  private async state(userId: number, sid: string | undefined): Promise<UserState> {
    const now = Date.now();
    const cached = users.get(userId);
    const fresh = cached && now - cached.at <= SESSION_TTL_MS;
    const sidAt = sid ? cached?.sids.get(sid)?.at : undefined;
    if (fresh && (!sid || (sidAt !== undefined && now - sidAt <= SESSION_TTL_MS))) return cached;
    const [row] = await this.prisma.$queryRaw<Array<{ pwv: number; active: boolean; must_change: boolean; alive: boolean }>>`
      SELECT e.pw_version AS pwv, e.is_active AS active, e.must_change_password AS must_change,
             (${sid ?? null}::uuid IS NULL OR EXISTS (
               SELECT 1 FROM refresh_tokens r
                WHERE r.session_id = ${sid ?? null}::uuid AND r.revoked_at IS NULL AND r.expires_at > now())) AS alive
        FROM employees e WHERE e.id = ${userId}`;
    const s: UserState = fresh ? cached : {
      pwv: row?.pwv ?? -1, active: !!row?.active, mustChange: !!row?.must_change, at: now, sids: new Map(),
    };
    if (sid) s.sids.set(sid, { alive: !!row?.alive, at: now });
    if (users.size > 50_000) users.clear(); // защита от роста
    users.set(userId, s);
    return s;
  }
}

export const ROLES_KEY = 'vp_roles';

/** Ограничение эндпоинта ролями; без декоратора — любой аутентифицированный. */
export const Roles = (...roles: Array<'admin' | 'manager'>) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Array<'admin' | 'manager'> | undefined>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!roles?.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (req.user && roles.includes('admin') && req.user.isAdmin) return true;
    // manager-эндпоинты доступны всем аутентифицированным; проверка «мой подчинённый» — в сервисах
    if (req.user && roles.includes('manager')) return true;
    throw new UnauthorizedException({ code: 'auth/forbidden' });
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessClaims => ctx.switchToHttp().getRequest<AuthedRequest>().user!,
);
