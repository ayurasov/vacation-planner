// Пароли: scrypt (N=16384) + сравнение constant-time (ADR-003).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64');
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N, r: 8, p: 1 }).toString('base64');
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, n, salt, expected] = parts;
  const actual = scryptSync(password, salt, 64, { N: Number(n), r: 8, p: 1 });
  const expectedBuf = Buffer.from(expected, 'base64');
  if (expectedBuf.length !== actual.length) return false;
  return timingSafeEqual(actual, expectedBuf);
}
