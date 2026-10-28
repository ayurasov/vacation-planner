// Пароли: scrypt (N=16384) + сравнение constant-time (ADR-003).
// Хеширование асинхронное — в пуле потоков libuv: синхронный scrypt (~50 мс) останавливал
// весь процесс на каждом входе, и утренний поток входов задерживал всех остальных (v0.5.0).
import { randomBytes, scrypt, timingSafeEqual, type BinaryLike, type ScryptOptions } from 'node:crypto';

const SCRYPT_N = 16384;
const KEY_LEN = 64;

function scryptAsync(password: BinaryLike, salt: BinaryLike, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64');
  const hash = (await scryptAsync(password, salt, { N: SCRYPT_N, r: 8, p: 1 })).toString('base64');
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

/** Хеш-заглушка: неизвестный логин проверяется так же долго, как известный — время ответа не выдаёт, есть ли учётная запись. */
const DUMMY = `scrypt$${SCRYPT_N}$${randomBytes(16).toString('base64')}$${randomBytes(KEY_LEN).toString('base64')}`;

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? DUMMY).split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, n, salt, expected] = parts;
  const actual = await scryptAsync(password, salt, { N: Number(n), r: 8, p: 1 });
  const expectedBuf = Buffer.from(expected, 'base64');
  if (expectedBuf.length !== actual.length) return false;
  return timingSafeEqual(actual, expectedBuf) && stored !== null && stored !== undefined;
}
