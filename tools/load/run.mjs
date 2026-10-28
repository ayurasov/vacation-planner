// Нагрузочный прогон (E40-02): виртуальные пользователи проходят типовой утренний сценарий.
// Без зависимостей — Node 20+ (fetch). Данные — server/prisma/load-seed.ts (логины load.uNNNNN).
//
//   node tools/load/run.mjs --url http://127.0.0.1:8080 --users 500 --duration 300 --ramp 60
//
// Каждый пользователь входит со своего адреса (X-Forwarded-For — как за nginx; лимит входа
// считается по адресу), затем в цикле выбирает действие по весам и «думает» think мс.
// Итог — таблица p50/p95/p99 по операциям в stdout и JSON в --out.
//
// --sse: как клиент v0.5.0 — каждый пользователь держит поток событий (вкладка браузера),
// колокольчик не опрашивается, а перечитывается по событию notifications; по событию data
// график перечитывается не чаще раза в минуту и только «на видимой вкладке» (треть пользователей).
// Без --sse — режим опроса, как клиент при недоступном потоке: худший случай для сервера.
import { writeFileSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL_BASE = arg('url', 'http://127.0.0.1:8080').replace(/\/+$/, '');
const USERS = Number(arg('users', 100));
const DURATION = Number(arg('duration', 60)) * 1000;
const RAMP = Number(arg('ramp', 20)) * 1000;
const THINK = Number(arg('think', 3000)); // средняя пауза между действиями, мс
const POPULATION = Number(arg('population', 5000));
const OUT = arg('out', '');
const PASSWORD = arg('password', 'load-pass-12345');
const SSE = process.argv.includes('--sse');
const sse = { open: 0, events: { hello: 0, notifications: 0, data: 0 }, failed: 0 };

const year = new Date().getFullYear();
const today = new Date().toISOString().slice(0, 10);
const stats = new Map(); // операция → { ms: [], errors, codes }
// 409 — отказ по правилам (пересечение с собственным отпуском, лимит), не сбой: считается отдельно
const record = (op, ms, ok, code) => {
  let s = stats.get(op);
  if (!s) stats.set(op, (s = { ms: [], errors: 0, rejected: 0, codes: {} }));
  s.ms.push(ms);
  if (code === 409) s.rejected++;
  else if (!ok) { s.errors++; s.codes[code] = (s.codes[code] ?? 0) + 1; }
};

/** Новый access-токен по refresh-cookie — как клиент при 401 (токен живёт 15 минут). */
async function refresh(vu) {
  vu.refreshing ??= (async () => {
    const t0 = performance.now();
    try {
      const res = await fetch(`${URL_BASE}/api/v1/auth/refresh`, {
        method: 'POST', headers: { 'X-Forwarded-For': vu.ip, Cookie: liveCookie(vu) },
      });
      const body = res.ok ? await res.json() : null;
      record('POST /auth/refresh', performance.now() - t0, res.ok, res.status);
      takeCookie(vu, res);
      if (body?.accessToken) vu.token = body.accessToken;
      return !!body?.accessToken;
    } catch (e) {
      record('POST /auth/refresh', performance.now() - t0, false, e.cause?.code ?? 'network');
      return false;
    } finally {
      vu.refreshing = null;
    }
  })();
  return vu.refreshing;
}

// Cookie хранится с Expires и, как в браузере, не отправляется после истечения: так генератор
// видит ошибку срока cookie (до v0.5.0 она жила 15 минут вместо 30 дней)
const takeCookie = (vu, res) => {
  const c = res.headers.getSetCookie().find((h) => h.startsWith('vp_refresh='));
  if (!c) return;
  vu.cookie = c.split(';')[0];
  const expires = /;\s*Expires=([^;]+)/i.exec(c)?.[1];
  vu.cookieExpires = expires ? Date.parse(expires) : Infinity;
};
const liveCookie = (vu) => (vu.cookie && Date.now() < (vu.cookieExpires ?? Infinity) ? vu.cookie : '');

async function call(vu, op, path, init = {}, retry = true) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${URL_BASE}/api/v1${path}`, {
      ...init,
      headers: {
        'X-Forwarded-For': vu.ip, 'Accept-Encoding': 'gzip',
        ...(vu.token ? { Authorization: `Bearer ${vu.token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(vu.etags?.[path] ? { 'If-None-Match': vu.etags[path] } : {}),
        ...init.headers,
      },
    });
    status = res.status;
    if (status === 401 && retry && vu.cookie && !path.startsWith('/auth/')) {
      await res.body?.cancel();
      if (await refresh(vu)) return call(vu, op, path, init, false);
    }
    if (path === '/auth/login') takeCookie(vu, res);
    const body = status === 204 || status === 304 ? null : await res.text();
    const etag = res.headers.get('etag');
    if (etag && init.method === undefined) (vu.etags ??= {})[path] = etag; // браузер тоже кэширует по ETag
    record(op, performance.now() - t0, res.ok || status === 304, status);
    return { status, json: body ? JSON.parse(body) : null };
  } catch (e) {
    record(op, performance.now() - t0, false, e.cause?.code ?? 'network');
    return { status, json: null };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => THINK * (0.5 + Math.random());

/** Действия сценария и их веса: что делает человек утром в планировщике. */
const ACTIONS = [
  [30, 'график отдела', (vu) => call(vu, 'GET /schedule (отдел)', `/schedule?from=${year}-01-01&to=${year}-12-31&dept=${encodeURIComponent(vu.dept)}`)],
  [4, 'график организации', (vu) => call(vu, 'GET /schedule (организация)', `/schedule?from=${year}-01-01&to=${year}-12-31`)],
  [20, 'мой отпуск', async (vu) => {
    await call(vu, 'GET /balance', `/employees/${vu.id}/balance?year=${year}`);
    await call(vu, 'GET /vacation-requests (мои)', `/vacation-requests?scope=mine&per_page=50`);
  }],
  [15, 'колокольчик', (vu) => call(vu, 'GET /notifications', '/notifications?unread=true')],
  [10, 'команда сегодня', (vu) => call(vu, 'GET /analytics/team', `/analytics/team?dept=${encodeURIComponent(vu.dept)}&date=${today}`)],
  [5, 'аналитика года', (vu) => call(vu, 'GET /analytics/overview', `/analytics/overview?dept=${encodeURIComponent(vu.dept)}&year=${year}`)],
  [4, 'подбор дат', (vu) => call(vu, 'GET /analytics/suggestions', `/analytics/suggestions?days=14&from=${year + 1}-06-01&to=${year + 1}-09-30`)],
  [6, 'заявки на согласование', (vu) => call(vu, 'GET /vacation-requests (подчинённых)', '/vacation-requests?scope=subordinates&status=pending&per_page=200')],
  [6, 'подать и отменить заявку', async (vu) => {
    const day = 1 + Math.floor(Math.random() * 25);
    const start = `${year + 1}-12-${String(day).padStart(2, '0')}`;
    const end = `${year + 1}-12-${String(day + 2).padStart(2, '0')}`;
    const r = await call(vu, 'POST /vacation-requests', '/vacation-requests', { method: 'POST', body: JSON.stringify({ start, end }) });
    if (r.json?.id) await call(vu, 'DELETE /vacation-requests/:id', `/vacation-requests/${r.json.id}`, { method: 'DELETE' });
  }],
];
// С потоком событий колокольчик не опрашивается — его перечитывает событие notifications
if (SSE) ACTIONS.splice(ACTIONS.findIndex(([, name]) => name === 'колокольчик'), 1);
const TOTAL_W = ACTIONS.reduce((n, [w]) => n + w, 0);
const pickAction = () => {
  let r = Math.random() * TOTAL_W;
  for (const a of ACTIONS) { r -= a[0]; if (r <= 0) return a; }
  return ACTIONS[0];
};

/** Поток событий пользователя до deadline: билет → GET /events, разбор text/event-stream. */
async function stream(vu, deadline) {
  const ticket = await call(vu, 'POST /events/ticket', '/events/ticket', { method: 'POST' });
  if (!ticket.json?.ticket) { sse.failed++; return; }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - performance.now()));
  const t0 = performance.now();
  try {
    const res = await fetch(`${URL_BASE}/api/v1/events?ticket=${encodeURIComponent(ticket.json.ticket)}`, {
      headers: { 'X-Forwarded-For': vu.ip }, signal: abort.signal,
    });
    if (!res.ok || !res.body) { sse.failed++; return; }
    sse.open++;
    const decoder = new TextDecoder();
    let buf = '';
    let lastSchedule = 0;
    const visible = Math.random() < 1 / 3;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const name = /^event: (\w+)/m.exec(buf.slice(0, i))?.[1];
        buf = buf.slice(i + 2);
        if (!name) continue;
        sse.events[name] = (sse.events[name] ?? 0) + 1;
        if (name === 'hello') record('SSE: подключение до hello', performance.now() - t0, true, 200);
        if (name === 'notifications') void call(vu, 'GET /notifications', '/notifications?unread=true');
        if (name === 'data' && visible && performance.now() - lastSchedule > 60_000) {
          lastSchedule = performance.now();
          void call(vu, 'GET /schedule (отдел)', `/schedule?from=${year}-01-01&to=${year}-12-31&dept=${encodeURIComponent(vu.dept)}`);
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') sse.failed++;
  } finally {
    clearTimeout(timer);
    sse.open--;
  }
}

async function virtualUser(n, deadline) {
  const num = 1 + Math.floor(Math.random() * (POPULATION - 1));
  const vu = { ip: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, token: null, id: 0, dept: '' };
  const login = await call(vu, 'POST /auth/login', '/auth/login', {
    method: 'POST', body: JSON.stringify({ login: `load.u${String(num).padStart(5, '0')}`, password: PASSWORD }),
  });
  if (!login.json?.accessToken) return;
  vu.token = login.json.accessToken;
  vu.id = login.json.user.employee.id;
  const me = await call(vu, 'GET /employees/:id', `/employees/${vu.id}`);
  vu.dept = me.json?.deptName ?? '';
  const live = SSE ? stream(vu, deadline) : null;
  while (performance.now() < deadline) {
    await sleep(jitter());
    if (performance.now() >= deadline) break;
    await pickAction()[2](vu);
  }
  await live;
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

async function main() {
  console.log(`Нагрузка: ${URL_BASE}, пользователей ${USERS}, разгон ${RAMP / 1000} с, длительность ${DURATION / 1000} с, пауза ~${THINK} мс${SSE ? ', поток событий' : ', опрос уведомлений'}`);
  // Пик одновременно открытых потоков — раз в секунду
  let peak = 0;
  const peakTimer = SSE ? setInterval(() => { peak = Math.max(peak, sse.open); }, 1000) : null;
  const started = performance.now();
  const deadline = started + RAMP + DURATION;
  const vus = [];
  for (let i = 0; i < USERS; i++) {
    vus.push(virtualUser(i + 1, deadline));
    await sleep(RAMP / USERS);
  }
  await Promise.all(vus);
  const elapsed = (performance.now() - started) / 1000;
  if (peakTimer) clearInterval(peakTimer);

  const rows = [...stats].map(([op, s]) => {
    const ms = s.ms.sort((a, b) => a - b);
    return {
      op, count: ms.length, errors: s.errors, rejected: s.rejected, codes: s.codes,
      p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(ms[ms.length - 1] ?? 0),
    };
  }).sort((a, b) => b.count - a.count);
  const all = [...stats.values()].flatMap((s) => s.ms).sort((a, b) => a - b);
  const reads = rows.filter((r) => r.op.startsWith('GET')).flatMap((r) => stats.get(r.op).ms).sort((a, b) => a - b);
  // Запись — изменение данных: без входа, билета и подключения потока
  const writes = rows.filter((r) => /^(POST|PUT|PATCH|DELETE) \/(?!auth\/|events)/.test(r.op)).flatMap((r) => stats.get(r.op).ms).sort((a, b) => a - b);
  const errors = rows.reduce((n, r) => n + r.errors, 0);
  const summary = {
    users: USERS, durationSec: Math.round(elapsed), requests: all.length, rps: Math.round(all.length / elapsed),
    errors, errorRate: all.length ? Math.round((errors / all.length) * 10000) / 100 : 0,
    readP95: Math.round(pct(reads, 95)), writeP95: Math.round(pct(writes, 95)),
    ...(SSE ? { sse: { peakOpen: peak, failed: sse.failed, events: sse.events } } : {}),
  };

  console.log('\n| Операция | Запросов | Ошибок | Отказов 409 | p50, мс | p95, мс | p99, мс | max, мс |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.op} | ${r.count} | ${r.errors}${r.errors ? ` ${JSON.stringify(r.codes)}` : ''} | ${r.rejected} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} |`);
  console.log(`\nИтого: ${summary.requests} запросов за ${summary.durationSec} с (${summary.rps}/с), ошибок ${summary.errors} (${summary.errorRate} %), p95 чтения ${summary.readP95} мс, p95 записи ${summary.writeP95} мс`);
  if (SSE) console.log(`Поток событий: одновременно открыто до ${peak}, сбоев ${sse.failed}, событий ${JSON.stringify(sse.events)}`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
}

main();
