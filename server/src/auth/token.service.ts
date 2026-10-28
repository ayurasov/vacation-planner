// JWT: access 15 минут; refresh — записывается хешем в БД с ротацией (ADR-003).
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import jwt, { type TokenExpiredError } from 'jsonwebtoken';

export interface AccessClaims {
  sub: number;
  login: string;
  isAdmin: boolean;
  pwv: number; // версия пароля: смена пароля убивает все access-токены
}

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;

@Injectable()
export class TokenService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    const s = config.get<string>('JWT_SECRET');
    if (!s || s.length < 32) {
      throw new Error('JWT_SECRET не задан или короче 32 символов (см. .env.example)');
    }
    this.secret = s;
  }

  signAccess(claims: AccessClaims): { token: string; expiresAt: Date } {
    const token = jwt.sign(claims, this.secret, { expiresIn: ACCESS_TTL });
    return { token, expiresAt: new Date(Date.now() + 15 * 60 * 1000) };
  }

  verifyAccess(token: string): AccessClaims {
    try {
      return jwt.verify(token, this.secret) as unknown as AccessClaims;
    } catch (e) {
      const code = (e as TokenExpiredError)?.name === 'TokenExpiredError'
        ? 'auth/token-expired' : 'auth/invalid-credentials';
      throw new UnauthorizedException({ code });
    }
  }

  /**
   * Короткоживущий подписанный контейнер со своей аудиторией: состояние входа OIDC в cookie
   * (10 минут), билет потока событий (60 секунд). Аудитория не даёт подставить один вместо другого.
   */
  signTransient(payload: object, audience = 'vp-oidc-state', expiresIn: jwt.SignOptions['expiresIn'] = '10m'): string {
    return jwt.sign(payload, this.secret, { expiresIn, audience });
  }

  verifyTransient<T>(token: string, audience = 'vp-oidc-state'): T | null {
    try {
      return jwt.verify(token, this.secret, { audience }) as T;
    } catch {
      return null;
    }
  }

  newRefresh(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashRefresh(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000),
    };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
