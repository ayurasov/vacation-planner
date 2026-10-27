// Лимит частоты входа: 10 попыток/мин с одного адреса (docs/specs/02-api-spec.md, раздел 3).
// Счётчик в памяти процесса; для многонодовой конфигурации заменяется на общий стор (backlog v0.4).
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ProblemException } from '../infra/problems';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  // Статическое хранилище: единое окно на процесс независимо от числа инстансов guard'а
  private static readonly attempts = new Map<string, number[]>();

  /** Только для тестов: сброс окна. */
  static resetForTests(): void {
    LoginRateLimitGuard.attempts.clear();
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const store = LoginRateLimitGuard.attempts;
    const hits = (store.get(key) ?? []).filter((t) => t > windowStart);
    if (hits.length >= MAX_ATTEMPTS) {
      throw new ProblemException('rate-limited', 'Повторите попытку через минуту');
    }
    hits.push(now);
    store.set(key, hits);
    if (store.size > 10_000) store.clear(); // защита от роста
    return true;
  }
}
