// Размер пула соединений на процесс: несколько процессов не исчерпывают max_connections.
import { afterEach, describe, expect, it } from 'vitest';
import { databaseUrl, workers } from '../src/infra/concurrency';

const URL = 'postgresql://u:p@db:5432/vacation';
const saved = { ...process.env };

afterEach(() => {
  for (const k of ['WEB_CONCURRENCY', 'DB_POOL_SIZE']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('пул соединений на процесс', () => {
  it('один процесс — 10 соединений', () => {
    delete process.env.WEB_CONCURRENCY;
    expect(workers()).toBe(1);
    expect(databaseUrl(URL)).toBe(`${URL}?connection_limit=10`);
  });

  it('много процессов — бюджет экземпляра делится, но не меньше 3 на процесс', () => {
    process.env.WEB_CONCURRENCY = '8';
    expect(databaseUrl(URL)).toBe(`${URL}?connection_limit=5`);
    process.env.WEB_CONCURRENCY = '16';
    expect(databaseUrl(`${URL}?schema=public`)).toBe(`${URL}?schema=public&connection_limit=3`);
    // 16 × 3 = 48 — в пределах max_connections = 100 даже для двух экземпляров
  });

  it('явные настройки имеют приоритет', () => {
    process.env.WEB_CONCURRENCY = '16';
    process.env.DB_POOL_SIZE = '7';
    expect(databaseUrl(URL)).toBe(`${URL}?connection_limit=7`);
    expect(databaseUrl(`${URL}?connection_limit=20`)).toBe(`${URL}?connection_limit=20`);
  });

  it('WEB_CONCURRENCY: auto, мусор и предел 32', () => {
    process.env.WEB_CONCURRENCY = 'abc';
    expect(workers()).toBe(1);
    process.env.WEB_CONCURRENCY = '100';
    expect(workers()).toBe(32);
    process.env.WEB_CONCURRENCY = 'auto';
    expect(workers()).toBeGreaterThanOrEqual(1);
  });
});
