// Guard аутентификации (глобальный, APP_GUARD) и права по матрице docs/specs/02-api-spec.md раздел 8.
import {
  type CanActivate, type ExecutionContext, Injectable, SetMetadata, UnauthorizedException, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AccessClaims } from './token.service';
import { TokenService } from './token.service';
import { PrismaService } from '../infra/prisma.service';

/**
 * Сеанс действителен, пока не сменился пароль (pw_version) и сотрудник не уволен. Раньше проверялась
 * только подпись access-токена: после смены пароля или увольнения токен работал ещё до 15 минут.
 * Кэш на процесс — 10 секунд; в процессе, где сменили пароль или уволили, запись сбрасывается сразу.
 */
const SESSION_TTL_MS = 10_000;
const sessions = new Map<number, { pwv: number; active: boolean; at: number }>();

export function invalidateSession(userId: number): void {
  sessions.delete(userId);
}

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
    const now = Date.now();
    let s = sessions.get(claims.sub);
    if (!s || now - s.at > SESSION_TTL_MS) {
      const e = await this.prisma.employee.findUnique({ where: { id: claims.sub }, select: { pwVersion: true, isActive: true } });
      s = { pwv: e?.pwVersion ?? -1, active: !!e?.isActive, at: now };
      if (sessions.size > 50_000) sessions.clear(); // защита от роста
      sessions.set(claims.sub, s);
    }
    if (!s.active || s.pwv !== claims.pwv) throw new UnauthorizedException({ code: 'auth/token-expired' });
    req.user = claims;
    return true;
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
