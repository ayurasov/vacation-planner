// Модульные тесты паролей: асинхронный scrypt не блокирует процесс, неизвестный логин проверяется так же долго.
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/passwords';

describe('пароли', () => {
  it('хеш проверяется; другой пароль и пустой хеш — нет', async () => {
    const h = await hashPassword('correct horse');
    expect(h).toMatch(/^scrypt\$16384\$/);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong horse', h)).toBe(false);
    expect(await verifyPassword('correct horse', undefined)).toBe(false);
  });

  it('проверка неизвестного логина занимает столько же, сколько известного (scrypt по заглушке)', async () => {
    const h = await hashPassword('x');
    const time = async (stored: string | undefined) => {
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) await verifyPassword('y', stored);
      return performance.now() - t0;
    };
    const known = await time(h);
    const unknown = await time(undefined);
    expect(unknown).toBeGreaterThan(known * 0.5);
  });

  it('хеширование не блокирует цикл событий: таймер срабатывает во время scrypt', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    await Promise.all(Array.from({ length: 4 }, () => hashPassword('p')));
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(5);
  });
});
