// Журнал и идентификатор запроса (v1.0.0, E50-03, E51-05).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Строки, записанные сервером в stdout и stderr за время fn. */
async function captured(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => { lines.push(...String(chunk).split('\n').filter(Boolean)); return true; };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    await fn();
    await new Promise((r) => setTimeout(r, 50)); // запись журнала — по событию finish ответа
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return lines;
}

const json = (lines: string[]) => lines.flatMap((l) => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });

describe('идентификатор запроса и журнал', () => {
  let t: TestApp;
  let emp: string;

  beforeAll(async () => {
    t = await createTestApp();
    emp = await login(t, t.employee);
  });
  afterAll(async () => { await destroyTestApp(t); });
  afterEach(() => {
    delete process.env.LOG_FORMAT;
    delete process.env.REQUEST_LOG;
    delete process.env.SLOW_REQUEST_MS;
  });

  it('каждый ответ несёт X-Request-Id; корректный идентификатор прокси сохраняется, чужой формат заменяется', async () => {
    const own = await t.http().get('/api/v1/auth/me').set(auth(emp));
    expect(own.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const proxied = await t.http().get('/api/v1/auth/me').set(auth(emp)).set('X-Request-Id', 'nginx-0123456789abcdef');
    expect(proxied.headers['x-request-id']).toBe('nginx-0123456789abcdef');
    const bad = await t.http().get('/api/v1/auth/me').set(auth(emp)).set('X-Request-Id', 'x"; DROP');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ошибка содержит requestId — тот же, что в заголовке', async () => {
    const res = await t.http().get('/api/v1/vacation-requests/999999').set(auth(emp));
    expect(res.status).toBe(404);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('REQUEST_LOG=all: строка JSON с маршрутом, кодом, длительностью и сотрудником; пароль в журнал не попадает', async () => {
    process.env.LOG_FORMAT = 'json';
    process.env.REQUEST_LOG = 'all';
    let reqId = '';
    const lines = await captured(async () => {
      const res = await t.http().get('/api/v1/vacation-requests?scope=mine').set(auth(emp));
      reqId = res.headers['x-request-id'];
      await t.http().post('/api/v1/auth/login').send({ login: t.employee.login, password: t.employee.password });
    });
    const entry = json(lines).find((l) => l.reqId === reqId);
    expect(entry).toMatchObject({ level: 'info', msg: 'request', method: 'GET', route: '/api/v1/vacation-requests', status: 200, user: t.employee.id });
    expect(typeof entry?.ms).toBe('number');
    expect(lines.join('\n')).not.toContain(t.employee.password);
    expect(json(lines).find((l) => l.route === '/api/v1/auth/login')).toMatchObject({ status: 200 });
  });

  it('по умолчанию пишутся только медленные запросы и ответы 5xx', async () => {
    process.env.LOG_FORMAT = 'json';
    const quiet = await captured(async () => { await t.http().get('/api/v1/auth/me').set(auth(emp)); });
    expect(json(quiet).filter((l) => l.msg === 'request' || l.msg === 'slow request')).toHaveLength(0);
    process.env.SLOW_REQUEST_MS = '0';
    const slow = await captured(async () => { await t.http().get('/api/v1/auth/me').set(auth(emp)); });
    expect(json(slow).find((l) => l.msg === 'slow request')).toMatchObject({ level: 'warn', route: '/api/v1/auth/me' });
  });
});

describe('медленный SQL', () => {
  let t: TestApp;

  beforeAll(async () => {
    process.env.SLOW_QUERY_MS = '0.0001'; // все запросы «медленные»: проверяется связь с запросом API
    t = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.SLOW_QUERY_MS;
    delete process.env.LOG_FORMAT;
    await destroyTestApp(t);
  });

  it('пишется с идентификатором запроса API, без параметров', async () => {
    const token = await login(t, t.employee);
    process.env.LOG_FORMAT = 'json';
    let reqId = '';
    const lines = await captured(async () => {
      const res = await t.http().get('/api/v1/vacation-requests?scope=mine').set(auth(token));
      reqId = res.headers['x-request-id'];
    });
    const queries = json(lines).filter((l) => l.msg === 'slow query' && l.reqId === reqId);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.find((q) => q.model === 'VacationRequest')).toMatchObject({ operation: 'findMany' });
    // Параметры не пишутся: ни значений фильтра, ни аргументов операции
    expect(queries.every((q) => !('args' in q))).toBe(true);
  });
});
