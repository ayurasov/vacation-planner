// E2E и модульные тесты метрик (E40-01): формат Prometheus, шаблоны маршрутов, показатели БД,
// слияние снимков процессов кластера, 503 при перегрузке БД.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import { type Family, merge, render } from '../src/infra/metrics';
import { ProblemFilter } from '../src/infra/problems';

let t: TestApp;
let emp: string;

beforeAll(async () => {
  t = await createTestApp();
  emp = await login(t, t.employee);
});

afterAll(async () => {
  await destroyTestApp(t);
});

afterEach(() => {
  delete process.env.METRICS_TOKEN;
});

/** Значение ряда `name{labels}` из текста экспозиции. */
function value(text: string, series: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(series + ' '));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

describe('/metrics', () => {
  it('задержки и коды — по шаблону маршрута, а не по пути', async () => {
    await t.http().get('/api/v1/vacation-requests/999999').set('Authorization', `Bearer ${emp}`);
    await t.http().get('/api/v1/vacation-requests/999998').set('Authorization', `Bearer ${emp}`);
    const res = await t.http().get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
    const route = 'method="GET",route="/api/v1/vacation-requests/:id"';
    expect(value(res.text, `vp_http_requests_total{${route},code="404"}`)).toBeGreaterThanOrEqual(2);
    expect(res.text).not.toContain('999999');
    // Корзины накопительные, +Inf равна числу наблюдений
    const inf = value(res.text, `vp_http_request_duration_seconds_bucket{${route},le="+Inf"}`);
    expect(inf).toBe(value(res.text, `vp_http_request_duration_seconds_count{${route}}`));
    const buckets = res.text.split('\n')
      .filter((l) => l.startsWith(`vp_http_request_duration_seconds_bucket{${route},`))
      .map((l) => Number(l.split(' ').pop()));
    expect(buckets).toEqual([...buckets].sort((a, b) => a - b));
  });

  it('неизвестный путь не создаёт новых рядов', async () => {
    await t.http().get('/api/v1/no-such-thing/abc');
    const res = await t.http().get('/metrics');
    expect(res.text).toContain('route="unmatched"');
    expect(res.text).not.toContain('no-such-thing');
  });

  it('показатели БД и процесса', async () => {
    const res = await t.http().get('/metrics');
    expect(value(res.text, 'vp_db_up')).toBe(1);
    expect(value(res.text, 'vp_db_connections{state="active"}')).toBeGreaterThanOrEqual(1);
    expect(value(res.text, 'vp_db_max_connections')).toBeGreaterThan(0);
    expect(value(res.text, 'vp_mail_outbox{status="pending"}')).toBeGreaterThanOrEqual(0);
    expect(value(res.text, 'vp_employees_active')).toBeGreaterThan(0);
    expect(value(res.text, 'vp_process_count')).toBe(1);
    expect(value(res.text, 'vp_sse_connections')).toBe(0);
    expect(value(res.text, 'vp_eventloop_lag_p99_seconds')).toBeGreaterThanOrEqual(0);
    expect(res.text).toContain('# TYPE process_cpu_seconds_total counter');
  });

  it('панель Grafana и правила оповещений ссылаются только на существующие метрики', async () => {
    const res = await t.http().get('/metrics');
    const exposed = new Set(res.text.split('\n').filter((l) => l.startsWith('# TYPE ')).map((l) => l.split(' ')[2]));
    const dir = join(__dirname, '..', '..', 'deploy', 'monitoring');
    const used = new Set<string>();
    for (const f of ['grafana-dashboard.json', 'alerts.yml']) {
      // vp_db_* в комментариях — шаблон, а не метрика: имя на «_» пропускается
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\b((?:vp|process|nodejs)_[a-z0-9_]*[a-z0-9])\b/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    const known = (name: string) => exposed.has(name) || exposed.has(name.replace(/_(bucket|sum|count)$/, ''));
    expect([...used].filter((name) => !known(name))).toEqual([]);
  });

  it('слоты репликации и архив WAL: отключённая реплика видна, архив без сбоев', async () => {
    // Слот без реплики удерживает WAL — удаляется в finally; оставшийся от прерванного прогона — до создания
    await t.prisma.$queryRaw`SELECT pg_drop_replication_slot(slot_name)::text FROM pg_replication_slots WHERE slot_name = 'vp_test_slot'`;
    try {
      await t.prisma.$queryRaw`SELECT slot_name::text FROM pg_create_physical_replication_slot('vp_test_slot', true)`;
      const res = await t.http().get('/metrics');
      expect(value(res.text, 'vp_db_up')).toBe(1);
      expect(value(res.text, 'vp_db_replication_slot_active{slot="vp_test_slot"}')).toBe(0);
      expect(value(res.text, 'vp_db_replication_slot_retained_bytes{slot="vp_test_slot"}')).toBeGreaterThanOrEqual(0);
      expect(value(res.text, 'vp_db_wal_archive_failing')).toBe(0);
      expect(res.text).toContain('# TYPE vp_db_replica_lag_seconds gauge'); // семейство есть и без реплик
    } finally {
      await t.prisma.$queryRaw`SELECT pg_drop_replication_slot(slot_name)::text FROM pg_replication_slots WHERE slot_name = 'vp_test_slot'`;
    }
  });

  it('METRICS_TOKEN: без верного токена — 401', async () => {
    process.env.METRICS_TOKEN = 'scrape-secret';
    expect((await t.http().get('/metrics')).status).toBe(401);
    expect((await t.http().get('/metrics').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await t.http().get('/metrics').set('Authorization', 'Bearer scrape-secret')).status).toBe(200);
  });
});

describe('слияние снимков процессов', () => {
  const part = (n: number, lag: number): Family[] => [
    { name: 'c_total', help: 'h', type: 'counter', agg: 'sum', samples: [{ labels: { route: '/a' }, value: n }] },
    { name: 'lag', help: 'h', type: 'gauge', agg: 'max', samples: [{ labels: {}, value: lag }] },
    { name: 'd', help: 'h', type: 'histogram', agg: 'sum', buckets: [0.1, 1], samples: [{ labels: { route: '/a' }, counts: [n, 1], sum: n, count: n + 1 }] },
  ];

  it('счётчики и гистограммы складываются, показатель max — максимум', () => {
    const out = render(merge([part(1, 0.2), part(2, 0.05), [{ name: 'c_total', help: 'h', type: 'counter', agg: 'sum', samples: [{ labels: { route: '/b' }, value: 7 }] }]]));
    expect(value(out, 'c_total{route="/a"}')).toBe(3);
    expect(value(out, 'c_total{route="/b"}')).toBe(7);
    expect(value(out, 'lag')).toBe(0.2);
    expect(value(out, 'd_bucket{route="/a",le="0.1"}')).toBe(3);
    expect(value(out, 'd_bucket{route="/a",le="1"}')).toBe(5);
    expect(value(out, 'd_bucket{route="/a",le="+Inf"}')).toBe(5);
    expect(value(out, 'd_count{route="/a"}')).toBe(5);
  });

  it('значения меток экранируются', () => {
    const out = render([{ name: 'x', help: 'h', type: 'gauge', agg: 'sum', samples: [{ labels: { v: 'a"b\\c\nd' }, value: 1 }] }]);
    expect(out).toContain('x{v="a\\"b\\\\c\\nd"} 1');
  });
});

describe('перегрузка БД', () => {
  it('нет соединения в пуле (P2024) — 503 service-unavailable с Retry-After и счётчиком', async () => {
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
    new ProblemFilter().catch(Object.assign(new Error('Timed out fetching a new connection'), { code: 'P2024' }), host);
    expect(status).toBe(503);
    expect(headers['Retry-After']).toBe('5');
    expect(body.type).toMatch(/service-unavailable$/);
    const m = await t.http().get('/metrics');
    expect(value(m.text, 'vp_db_errors_total{code="P2024"}')).toBeGreaterThanOrEqual(1);
  });
});
