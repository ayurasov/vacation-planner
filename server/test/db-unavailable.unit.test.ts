// Недоступность БД — 503 с Retry-After, а не 500 (v1.0.0, прогон отказов под нагрузкой): сырые запросы
// ($queryRaw) при перезапуске PostgreSQL падают с P2010 и кодом PostgreSQL 57P01, а не с P1017.
import { describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { ProblemFilter } from '../src/infra/problems';

function handle(exception: unknown): { status: number; headers: Record<string, string>; type?: string } {
  const headers: Record<string, string> = {};
  let status = 0;
  let body: { type?: string } = {};
  const res = {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status(s: number) { status = s; return this; },
    contentType() { return this; },
    json(b: object) { body = b; return this; },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ originalUrl: '/api/v1/schedule' }) }) } as unknown as ArgumentsHost;
  new ProblemFilter().catch(exception, host);
  return { status, headers, type: body.type };
}

const rawFailed = (pg: string, meta = true) => Object.assign(
  new Error(`Invalid \`prisma.$queryRaw()\` invocation:\n\nRaw query failed. Code: \`${pg}\`. Message: \`FATAL: terminating connection\``),
  { code: 'P2010', ...(meta ? { meta: { code: pg, message: 'FATAL: terminating connection' } } : {}) },
);

describe('недоступность БД в сырых запросах', () => {
  it('перезапуск PostgreSQL (P2010, 57P01) — 503 service-unavailable с Retry-After', () => {
    const r = handle(rawFailed('57P01'));
    expect(r.status).toBe(503);
    expect(r.headers['Retry-After']).toBe('5');
    expect(r.type).toMatch(/service-unavailable$/);
  });

  it('код PostgreSQL берётся и из текста ошибки, если meta нет; обрыв соединения 08006 — тоже 503', () => {
    expect(handle(rawFailed('57P01', false)).status).toBe(503);
    expect(handle(rawFailed('08006')).status).toBe(503);
  });

  it('ошибка запроса, а не доступности (42P01 — нет таблицы), остаётся 500', () => {
    expect(handle(rawFailed('42P01')).status).toBe(500);
  });
});
