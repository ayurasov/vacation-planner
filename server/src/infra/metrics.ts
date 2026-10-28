// Метрики Prometheus (E40-01) без сторонних библиотек: счётчики, показатели и гистограммы,
// текстовый формат экспозиции 0.0.4. Решение и причины — docs/decisions.md.
//
// Кластер (WEB_CONCURRENCY > 1): Prometheus опрашивает /metrics, запрос попадает в один из
// процессов. Он просит главный процесс собрать снимки всех процессов по IPC и складывает их:
// счётчики и гистограммы — суммой, показатели — суммой или максимумом (задаётся при объявлении).
import cluster, { type Worker } from 'node:cluster';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';

type Labels = Record<string, string>;
type Kind = 'counter' | 'gauge' | 'histogram';

export interface Sample { labels: Labels; value: number }
export interface HistSample { labels: Labels; counts: number[]; sum: number; count: number }
export interface Family {
  name: string;
  help: string;
  type: Kind;
  agg: 'sum' | 'max';
  buckets?: number[];
  samples: Array<Sample | HistSample>;
}

const keyOf = (labels: Labels): string => JSON.stringify(labels);

abstract class Metric<S> {
  protected readonly data = new Map<string, S>();
  constructor(readonly name: string, readonly help: string) {
    registry.push(this as unknown as Metric<unknown>);
  }
  abstract snapshot(): Family;
}

export class Counter extends Metric<Sample> {
  inc(labels: Labels = {}, by = 1): void {
    const k = keyOf(labels);
    const s = this.data.get(k);
    if (s) s.value += by;
    else this.data.set(k, { labels, value: by });
  }
  snapshot(): Family {
    return { name: this.name, help: this.help, type: 'counter', agg: 'sum', samples: [...this.data.values()].map((s) => ({ ...s })) };
  }
}

export class Gauge extends Metric<Sample> {
  constructor(
    name: string, help: string,
    private readonly agg: 'sum' | 'max' = 'sum',
    private readonly collect?: (g: Gauge) => void,
    private readonly kind: 'gauge' | 'counter' = 'gauge', // counter — накопительное значение, читаемое при сборе
  ) {
    super(name, help);
  }
  set(labels: Labels, value: number): void {
    this.data.set(keyOf(labels), { labels, value });
  }
  snapshot(): Family {
    this.collect?.(this);
    return { name: this.name, help: this.help, type: this.kind, agg: this.agg, samples: [...this.data.values()].map((s) => ({ ...s })) };
  }
}

export class Histogram extends Metric<HistSample> {
  constructor(name: string, help: string, readonly buckets: number[]) {
    super(name, help);
  }
  observe(labels: Labels, value: number): void {
    const k = keyOf(labels);
    let s = this.data.get(k);
    if (!s) this.data.set(k, (s = { labels, counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 }));
    // Счётчики корзин хранятся не накопленными; накопление — при выводе
    const i = this.buckets.findIndex((b) => value <= b);
    if (i >= 0) s.counts[i]++;
    s.sum += value;
    s.count++;
  }
  snapshot(): Family {
    return {
      name: this.name, help: this.help, type: 'histogram', agg: 'sum', buckets: this.buckets,
      samples: [...this.data.values()].map((s) => ({ ...s, counts: [...s.counts] })),
    };
  }
}

const registry: Array<Metric<unknown>> = [];

// ---------------------------------------------------------------- Метрики процесса

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

new Gauge('vp_process_count', 'Число процессов API, ответивших на сбор метрик', 'sum', (g) => g.set({}, 1));
new Gauge('process_resident_memory_bytes', 'Резидентная память процессов API, байт', 'sum', (g) => g.set({}, process.memoryUsage().rss));
new Gauge('nodejs_heap_used_bytes', 'Занятая куча V8, байт', 'sum', (g) => g.set({}, process.memoryUsage().heapUsed));
new Gauge('process_cpu_seconds_total', 'Процессорное время процессов API, секунд (накопительно)', 'sum', (g) => {
  const u = process.cpuUsage();
  g.set({}, (u.user + u.system) / 1e6);
}, 'counter');
// Задержка цикла событий: окно — между двумя сборами. Долгий синхронный код (хеш пароля,
// большой JSON) виден здесь раньше, чем в задержках запросов.
new Gauge('vp_eventloop_lag_p99_seconds', 'Задержка цикла событий, 99-й процентиль за интервал сбора (худший процесс)', 'max', (g) => {
  g.set({}, loop.count ? loop.percentile(99) / 1e9 : 0);
});
new Gauge('vp_eventloop_lag_max_seconds', 'Задержка цикла событий, максимум за интервал сбора (худший процесс)', 'max', (g) => {
  g.set({}, loop.count ? loop.max / 1e9 : 0);
  loop.reset();
});

// ---------------------------------------------------------------- HTTP

export const httpRequests = new Counter('vp_http_requests_total', 'Запросы API по маршруту и коду ответа');
export const httpDuration = new Histogram(
  'vp_http_request_duration_seconds',
  'Длительность запросов API по маршруту, секунд',
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);
export const dbErrors = new Counter('vp_db_errors_total', 'Ошибки доступа к БД по коду Prisma: P2024 — нет свободного соединения в пуле, P2028 — транзакция не началась вовремя, P1001/P1017 — БД недоступна');
export const sseConnections = new Gauge('vp_sse_connections', 'Открытые потоки событий (SSE)', 'sum');
sseConnections.set({}, 0);

/** Шаблон маршрута (`/api/v1/vacation-requests/:id`), а не путь: иначе число рядов метрики не ограничено. */
function routeOf(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  if (route && typeof route.path === 'string') return (req.baseUrl ?? '') + route.path;
  return 'unmatched';
}

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    const route = routeOf(req);
    const method = req.method;
    httpRequests.inc({ method, route, code: String(res.statusCode) });
    // Поток событий живёт часами — в гистограмме длительностей он только исказил бы процентили
    if (String(res.getHeader('content-type') ?? '').startsWith('text/event-stream')) return;
    httpDuration.observe({ method, route }, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}

// ---------------------------------------------------------------- Сбор и слияние

export function snapshot(): Family[] {
  return registry.map((m) => m.snapshot());
}

export function merge(parts: Family[][]): Family[] {
  const out = new Map<string, Family>();
  for (const part of parts) {
    for (const f of part) {
      const acc = out.get(f.name);
      if (!acc) {
        out.set(f.name, { ...f, samples: f.samples.map((s) => ('counts' in s ? { ...s, counts: [...s.counts] } : { ...s })) });
        continue;
      }
      const byKey = new Map(acc.samples.map((s) => [keyOf(s.labels), s]));
      for (const s of f.samples) {
        const have = byKey.get(keyOf(s.labels));
        if (!have) {
          const copy = 'counts' in s ? { ...s, counts: [...s.counts] } : { ...s };
          acc.samples.push(copy);
          byKey.set(keyOf(s.labels), copy);
        } else if ('counts' in s && 'counts' in have) {
          s.counts.forEach((c, i) => { have.counts[i] += c; });
          have.sum += s.sum;
          have.count += s.count;
        } else if ('value' in s && 'value' in have) {
          have.value = f.agg === 'max' ? Math.max(have.value, s.value) : have.value + s.value;
        }
      }
    }
  }
  return [...out.values()];
}

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const fmtLabels = (labels: Labels, extra?: [string, string]): string => {
  const pairs = Object.entries(labels);
  if (extra) pairs.push(extra);
  return pairs.length ? `{${pairs.map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : '';
};
const num = (v: number): string => (Number.isFinite(v) ? String(v) : v > 0 ? '+Inf' : v < 0 ? '-Inf' : 'NaN');

/** Текстовый формат экспозиции Prometheus 0.0.4. */
export function render(families: Family[]): string {
  const lines: string[] = [];
  for (const f of families) {
    lines.push(`# HELP ${f.name} ${f.help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}`);
    lines.push(`# TYPE ${f.name} ${f.type}`);
    for (const s of f.samples) {
      if ('counts' in s) {
        let acc = 0;
        f.buckets!.forEach((b, i) => {
          acc += s.counts[i];
          lines.push(`${f.name}_bucket${fmtLabels(s.labels, ['le', String(b)])} ${acc}`);
        });
        lines.push(`${f.name}_bucket${fmtLabels(s.labels, ['le', '+Inf'])} ${s.count}`);
        lines.push(`${f.name}_sum${fmtLabels(s.labels)} ${num(s.sum)}`);
        lines.push(`${f.name}_count${fmtLabels(s.labels)} ${s.count}`);
      } else {
        lines.push(`${f.name}${fmtLabels(s.labels)} ${num(s.value)}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- Кластер

interface MetricsMessage { vpMetrics: 'collect' | 'snapshot' | 'part' | 'result'; id: number; data?: unknown }
const isMsg = (m: unknown): m is MetricsMessage => typeof m === 'object' && m !== null && 'vpMetrics' in m;

const waiting = new Map<number, (parts: Family[][]) => void>();
let seq = 0;

if (cluster.isWorker) {
  process.on('message', (m: unknown) => {
    if (!isMsg(m)) return;
    if (m.vpMetrics === 'snapshot') process.send?.({ vpMetrics: 'part', id: m.id, data: snapshot() });
    else if (m.vpMetrics === 'result') waiting.get(m.id)?.(m.data as Family[][]);
  });
}

/** Метрики всех процессов API. Вне кластера и если главный процесс не ответил — только свои. */
export async function collectAll(): Promise<Family[]> {
  if (!cluster.isWorker || !process.send) return snapshot();
  const id = ++seq;
  const parts = await new Promise<Family[][] | null>((resolve) => {
    const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, 2000);
    waiting.set(id, (p) => { clearTimeout(timer); waiting.delete(id); resolve(p); });
    process.send!({ vpMetrics: 'collect', id });
  });
  return parts?.length ? merge(parts) : snapshot();
}

/** Главный процесс кластера: на запрос одного процесса рассылает сбор всем и возвращает ответы. */
export function aggregateInPrimary(): void {
  let next = 0;
  const open = new Map<number, { from: Worker; id: number; want: number; parts: Family[][]; timer: NodeJS.Timeout }>();
  const finish = (reqId: number): void => {
    const r = open.get(reqId);
    if (!r) return;
    open.delete(reqId);
    clearTimeout(r.timer);
    if (r.from.isConnected()) r.from.send({ vpMetrics: 'result', id: r.id, data: r.parts });
  };
  cluster.on('message', (worker: Worker, m: unknown) => {
    if (!isMsg(m)) return;
    if (m.vpMetrics === 'collect') {
      const reqId = ++next;
      const all = Object.values(cluster.workers ?? {}).filter((w): w is Worker => !!w && w.isConnected());
      // Процесс, который не ответил за секунду (занят долгим запросом), пропускается в этом сборе
      open.set(reqId, { from: worker, id: m.id, want: all.length, parts: [], timer: setTimeout(() => finish(reqId), 1000) });
      for (const w of all) w.send({ vpMetrics: 'snapshot', id: reqId });
    } else if (m.vpMetrics === 'part') {
      const r = open.get(m.id);
      if (!r) return;
      r.parts.push(m.data as Family[]);
      if (r.parts.length >= r.want) finish(m.id);
    }
  });
}
