// Лимит частоты входа (docs/specs/02-api-spec.md, «Общие правила»):
//  • 10 попыток в минуту на пару «адрес + логин» — подбор пароля к одной учётной записи;
//  • 60 попыток в минуту на адрес — перебор логинов; офис за NAT не блокируется целиком.
// Адрес клиента — req.ip с учётом trust proxy (main.ts): за nginx без него у всех был бы
// адрес контейнера nginx и лимит стал бы общим на всю компанию.
// Счётчики в памяти процесса; для нескольких экземпляров — общий стор (бэклог v0.5).
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ProblemException } from '../infra/problems';

const WINDOW_MS = 60_000;
export const MAX_PER_LOGIN = 10;
export const MAX_PER_ADDRESS = 60;

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  // Статическое хранилище: единое окно на процесс независимо от числа экземпляров guard'а
  private static readonly attempts = new Map<string, number[]>();

  /** Только для тестов: сброс окна. */
  static resetForTests(): void {
    LoginRateLimitGuard.attempts.clear();
  }

  private static hit(key: string, max: number, now: number): boolean {
    const store = LoginRateLimitGuard.attempts;
    const hits = (store.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
    if (hits.length >= max) return false;
    hits.push(now);
    store.set(key, hits);
    return true;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string }; body?: { login?: unknown } }>();
    const address = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const login = typeof req.body?.login === 'string' ? req.body.login.trim().toLowerCase().slice(0, 64) : '';
    const now = Date.now();
    if (LoginRateLimitGuard.attempts.size > 20_000) LoginRateLimitGuard.attempts.clear(); // защита от роста
    const ok = LoginRateLimitGuard.hit(`a:${address}`, MAX_PER_ADDRESS, now)
      && LoginRateLimitGuard.hit(`l:${address}:${login}`, MAX_PER_LOGIN, now);
    if (!ok) throw new ProblemException('rate-limited', 'Повторите попытку через минуту');
    return true;
  }
}
