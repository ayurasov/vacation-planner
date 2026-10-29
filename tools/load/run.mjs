// Нагрузочный генератор «Планировщика отпусков» (E40-02, E51-01). Без зависимостей — Node 20+ (fetch).
// Данные — server/prisma/load-seed.ts (логины load.uNNNNN, пароль load-pass-12345).
//
//   node tools/load/run.mjs --url http://127.0.0.1:8080 --profile average --population 2000
//   node tools/load/run.mjs --url http://127.0.0.1:8080 --users 500 --duration 300 --ramp 60 --sse
//
// Профили модели рабочего дня (docs/performance/workday-model.md) задают число работающих,
// «простаивающих» вкладок, паузы, ступени и прибытия по численности организации (--population):
//   smoke    — 10 пользователей, минута: проверка контракта и стенда;
//   average  — час пик в последний день кампании планирования: 5,75 % сотрудников работают,
//              30 % держат вкладку открытой (поток событий), пауза между действиями ~8 с;
//   spike    — утренний приход после письма об открытии кампании: вся организация входит за 15 минут,
//              открывает «Мой отпуск» и график, делает несколько действий и закрывает вкладку; на фоне — average;
//   stress   — ступени ×1, ×2, ×4, ×8, ×16 от average по 5 минут: где кончается запас;
//   soak     — average в течение --duration (по умолчанию 8 ч), лента по минутам.
// Любой параметр профиля можно переопределить (--users, --idle, --think, --duration, ...).
// --slo — проверить требования (p95 чтения ≤ 300 мс, записи ≤ 500 мс, без ошибок; --max-read, --max-write):
// при нарушении код завершения 1 — так прогон работает в CI.
//
// Каждый пользователь входит со своего адреса (X-Forwarded-For — как за nginx; лимит входа
// считается по адресу) и действует по своей роли: сотрудник, согласующий (есть очередь),
// кадровая служба. Итог — таблица p50/p95/p99 по операциям, ступени, лента по минутам; JSON — в --out.
import { writeFileSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const has = (name) => process.argv.includes(`--${name}`);

const URL_BASE = arg('url', 'http://127.0.0.1:8080').replace(/\/+$/, '');
const POPULATION = Number(arg('population', 5000));
const PROFILE = arg('profile', '');
const PASSWORD = arg('password', 'load-pass-12345');
const OUT = arg('out', '');

/** Параметры профиля по модели рабочего дня (docs/performance/workday-model.md). */
function profile(name, pop) {
  const active = Math.max(5, Math.round(pop * 0.0575));
  const idle = Math.round(pop * 0.3);
  switch (name) {
    case 'smoke': return { users: 10, idle: 0, think: 2000, ramp: 10, duration: 60, sse: true };
    case 'average': return { users: active, idle, think: 8000, ramp: 120, duration: 900, sse: true };
    case 'spike': return { users: active, idle, think: 8000, ramp: 60, duration: 900, sse: true, arrivals: pop, window: 900 };
    case 'stress': return { users: active, idle, think: 8000, ramp: 60, sse: true, stages: [1, 2, 4, 8, 16].map((k) => ({ users: active * k, sec: 300 })) };
    case 'soak': return { users: active, idle, think: 8000, ramp: 120, duration: 8 * 3600, sse: true, tick: 300 };
    case '': return { users: 100, idle: 0, think: 3000, ramp: 20, duration: 60, sse: false };
    default: throw new Error(`Неизвестный профиль ${name}: smoke, average, spike, stress, soak`);
  }
}
const base = profile(PROFILE, POPULATION);
const USERS = Number(arg('users', base.users));
const IDLE = Number(arg('idle', base.idle));
const THINK = Number(arg('think', base.think)); // средняя пауза между действиями, мс
const RAMP = Number(arg('ramp', base.ramp)) * 1000;
const SSE = has('sse') || (base.sse && !has('no-sse'));
const ARRIVALS = Number(arg('arrivals', base.arrivals ?? 0));
const WINDOW = Number(arg('window', base.window ?? 900)) * 1000;
const TICK = Number(arg('tick', base.tick ?? 60)) * 1000; // шаг ленты, мс
const HR_USERS = Number(arg('hr', Math.min(10, Math.max(1, Math.round(USERS * 0.02))))); // кадровая служба среди работающих
// Клиент до v1.0.0 перечитывал график по событию сразу: --no-jitter воспроизводит прежнее поведение
const JITTER = !has('no-jitter');
// Ступени: «пользователей:секунд,…»; без них — одна ступень USERS на DURATION
const STAGES = arg('stages')
  ? arg('stages').split(',').map((s) => { const [u, sec] = s.split(':').map(Number); return { users: u, sec }; })
  : base.stages ?? [{ users: USERS, sec: Number(arg('duration', base.duration)) }];
const DURATION = STAGES.reduce((n, s) => n + s.sec, 0) * 1000;

const sse = { open: 0, events: { hello: 0, notifications: 0, data: 0 }, failed: 0 };
const year = new Date().getFullYear();
const today = new Date().toISOString().slice(0, 10);

// ── Учёт: по операциям, по ступеням и по шагам ленты
const stats = new Map(); // операция → { ms: [], errors, rejected, codes }
const stageStats = []; // ступень → { reads: [], writes: [], errors, count }
const ticks = []; // шаг ленты → { reads: [], writes: [], errors, count }
let stageIndex = 0;
let started = 0;
const isWrite = (op) => /^(POST|PUT|PATCH|DELETE) \/(?!auth\/|events)/.test(op);
const isRead = (op) => op.startsWith('GET') && !op.startsWith('GET /reports');
const bucket = (arr, i) => (arr[i] ??= { reads: [], writes: [], errors: 0, count: 0 });
// 409 — отказ по правилам (пересечение с собственным отпуском, лимит), не сбой: считается отдельно
const record = (op, ms, ok, code) => {
  let s = stats.get(op);
  if (!s) stats.set(op, (s = { ms: [], errors: 0, rejected: 0, codes: {} }));
  s.ms.push(ms);
  const failed = !ok && code !== 409;
  if (code === 409) s.rejected++;
  else if (!ok) { s.errors++; s.codes[code] = (s.codes[code] ?? 0) + 1; }
  for (const b of [bucket(stageStats, stageIndex), bucket(ticks, Math.floor((performance.now() - started) / TICK))]) {
    b.count++;
    if (failed) b.errors++;
    if (isRead(op)) b.reads.push(ms);
    else if (isWrite(op)) b.writes.push(ms);
  }
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
    const binary = (res.headers.get('content-type') ?? '').includes('spreadsheet');
    const body = status === 204 || status === 304 ? null : binary ? (await res.arrayBuffer(), null) : await res.text();
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

// ── Действия по ролям: вес и что делает человек на экране
const schedule = (vu) => call(vu, 'GET /schedule (отдел)', `/schedule?from=${year}-01-01&to=${year}-12-31&dept=${encodeURIComponent(vu.dept)}`);
const myVacation = async (vu) => {
  // Экран «Мой отпуск» v0.6.0: баланс, заявки, извещения, приглашение кампании
  await Promise.all([
    call(vu, 'GET /balance', `/employees/${vu.id}/balance?year=${year}`),
    call(vu, 'GET /vacation-requests (мои)', '/vacation-requests?scope=mine&per_page=200'),
    call(vu, 'GET /notices/mine', '/notices/mine'),
    call(vu, 'GET /planning/mine', '/planning/mine'),
  ]);
};
const EMPLOYEE = [
  [25, 'график отдела', schedule],
  [3, 'график организации', (vu) => call(vu, 'GET /schedule (организация)', `/schedule?from=${year}-01-01&to=${year}-12-31`)],
  [20, 'мой отпуск', myVacation],
  [15, 'колокольчик', (vu) => call(vu, 'GET /notifications', '/notifications?unread=true'), { poll: true }],
  [8, 'команда сегодня', (vu) => call(vu, 'GET /analytics/team', `/analytics/team?dept=${encodeURIComponent(vu.dept)}&date=${today}`)],
  [4, 'аналитика года', (vu) => call(vu, 'GET /analytics/overview', `/analytics/overview?dept=${encodeURIComponent(vu.dept)}&year=${year}`)],
  [4, 'подбор дат', (vu) => call(vu, 'GET /analytics/suggestions', `/analytics/suggestions?days=14&from=${year + 1}-06-01&to=${year + 1}-09-30`)],
  [6, 'подать и отменить заявку', async (vu) => {
    const day = 1 + Math.floor(Math.random() * 25);
    const start = `${year + 1}-12-${String(day).padStart(2, '0')}`;
    const end = `${year + 1}-12-${String(day + 2).padStart(2, '0')}`;
    const r = await call(vu, 'POST /vacation-requests', '/vacation-requests', { method: 'POST', body: JSON.stringify({ start, end }) });
    if (r.json?.id) await call(vu, 'DELETE /vacation-requests/:id', `/vacation-requests/${r.json.id}`, { method: 'DELETE' });
  }],
  [2, 'профиль: сеансы', (vu) => call(vu, 'GET /auth/sessions', '/auth/sessions')],
];
const APPROVER = [
  [10, 'очередь согласования', async (vu) => {
    const q = await call(vu, 'GET /vacation-requests (очередь)', '/vacation-requests?scope=approvals&status=pending&per_page=200');
    vu.queue = (q.json?.items ?? []).map((r) => r.id);
  }],
  [2, 'согласовать заявку', async (vu) => {
    const id = vu.queue?.shift();
    if (id) await call(vu, 'POST /vacation-requests/:id/approve', `/vacation-requests/${id}/approve`, { method: 'POST', body: '{}' });
  }],
];
const HR = [
  [5, 'кадровый учёт: планирование', (vu) => call(vu, 'GET /planning/:year', `/planning/${year + 1}`)],
  [3, 'журнал извещений', (vu) => call(vu, 'GET /notices', `/notices?from=${today}&to=${year}-12-31&per_page=50`)],
  [3, 'сотрудники: поиск', (vu) => call(vu, 'GET /employees (поиск)', `/employees?search=${encodeURIComponent('Иван')}&per_page=50`)],
  [1, 'журнал входов', (vu) => call(vu, 'GET /login-events', '/login-events?per_page=50')],
  [1, 'выгрузка Т-7', (vu) => call(vu, 'GET /reports/t7', `/reports/t7?year=${year + 1}`)],
  [1, 'выгрузка графика', (vu) => call(vu, 'GET /reports/vacations', `/reports/vacations?from=${year}-01-01&to=${year}-12-31`)],
];

function actionsFor(vu) {
  const list = [...EMPLOYEE, ...(vu.approver ? APPROVER : []), ...(vu.hr ? HR : [])]
    .filter(([, , , opts]) => !(SSE && opts?.poll)); // с потоком событий колокольчик перечитывает событие
  const total = list.reduce((n, [w]) => n + w, 0);
  return () => {
    let r = Math.random() * total;
    for (const a of list) { r -= a[0]; if (r <= 0) return a; }
    return list[0];
  };
}

/** Поток событий пользователя до deadline: билет → GET /events, разбор text/event-stream. */
async function stream(vu, deadline, onNotifications = true) {
  const ticket = await call(vu, 'POST /events/ticket', '/events/ticket', { method: 'POST' });
  if (!ticket.json?.ticket) { sse.failed++; return; }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - performance.now()));
  vu.abort = abort;
  const t0 = performance.now();
  let pendingSchedule = null;
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
        if (name === 'notifications' && onNotifications) void call(vu, 'GET /notifications', '/notifications?unread=true');
        // Как ScheduleView: видимая вкладка перечитывает график не чаще раза в минуту, через 0–10 с
        if (name === 'data' && visible && !pendingSchedule && performance.now() - lastSchedule > 60_000) {
          pendingSchedule = setTimeout(() => {
            pendingSchedule = null;
            lastSchedule = performance.now();
            if (performance.now() < deadline) void schedule(vu);
          }, JITTER ? Math.random() * 10_000 : 0);
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') sse.failed++;
  } finally {
    clearTimeout(timer);
    clearTimeout(pendingSchedule); // вкладка закрыта — отложенного перечитывания нет
    sse.open--;
  }
}

/** Вход под случайным сотрудником; роль — по профилю ответа. Первые HR работающих — кадровая служба
 *  (в сиде это load.u00001–u00010): в день кампании она работает всегда, случайный выбор её почти не находит.
 *  kind разводит адреса работающих, вкладок и утреннего прихода. */
async function signIn(n, kind) {
  const num = kind === 0 && n <= HR_USERS ? n : 11 + Math.floor(Math.random() * (POPULATION - 11));
  const vu = { n, ip: `10.${kind * 64 + ((n >> 16) & 63)}.${(n >> 8) & 255}.${n & 255}`, token: null, id: 0, dept: '' };
  const login = await call(vu, 'POST /auth/login', '/auth/login', {
    method: 'POST', body: JSON.stringify({ login: `load.u${String(num).padStart(5, '0')}`, password: PASSWORD }),
  });
  if (!login.json?.accessToken) return null;
  vu.token = login.json.accessToken;
  vu.id = login.json.user.employee.id;
  vu.approver = !!login.json.user.permissions?.approvals;
  vu.hr = !!login.json.user.employee.isHr;
  const me = await call(vu, 'GET /employees/:id', `/employees/${vu.id}`);
  vu.dept = me.json?.deptName ?? '';
  return vu;
}

// Работающие пользователи: пользователь n работает, пока n ≤ цели текущей ступени
let target = 0;
async function activeUser(n, deadline) {
  const vu = await signIn(n, 0);
  if (!vu) return;
  const live = SSE ? stream(vu, deadline) : null;
  const next = actionsFor(vu);
  while (performance.now() < deadline && n <= target) {
    await sleep(jitter());
    if (performance.now() >= deadline || n > target) break;
    await next()[2](vu);
  }
  vu.abort?.abort();
  await live;
}

/** Вкладка открыта, человек занят другим: только поток событий и колокольчик по событию. */
async function idleUser(n, deadline) {
  const vu = await signIn(n, 1);
  if (vu) await stream(vu, deadline);
}

/** Утренний приход: вход, поток событий, «Мой отпуск» и график, несколько действий — и вкладка закрыта
 *  (оставшиеся открытыми вкладки — это --idle). */
async function arrival(n) {
  const vu = await signIn(n, 2);
  if (!vu) return;
  const live = SSE ? stream(vu, performance.now() + 600_000) : null;
  await myVacation(vu);
  await schedule(vu);
  const next = actionsFor(vu);
  for (let k = 0; k < 3; k++) {
    await sleep(jitter());
    await next()[2](vu);
  }
  vu.abort?.abort();
  await live;
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
const p95 = (arr) => Math.round(pct([...arr].sort((a, b) => a - b), 95));

async function main() {
  console.log(`Нагрузка: ${URL_BASE}, профиль ${PROFILE || '—'}, численность ${POPULATION}; работают ${STAGES.map((s) => `${s.users}×${s.sec} с`).join(' → ')}, `
    + `вкладок без действий ${IDLE}, приход ${ARRIVALS} за ${WINDOW / 1000} с, разгон ${RAMP / 1000} с, пауза ~${THINK} мс, ${SSE ? 'поток событий' : 'опрос уведомлений'}`);
  let peak = 0;
  const peakTimer = setInterval(() => { peak = Math.max(peak, sse.open); }, 1000);
  started = performance.now();
  const deadline = started + RAMP + DURATION;
  const tasks = [];
  let spawned = 0;
  let n = 0;

  // Вкладки без действий — разгоном вместе с работающими
  for (let i = 0; i < IDLE; i++) tasks.push((async () => { await sleep((RAMP * i) / Math.max(1, IDLE)); await idleUser(++n, deadline); })());
  // Утренний приход — равномерно в окне после разгона
  for (let i = 0; i < ARRIVALS; i++) tasks.push((async () => { await sleep(RAMP + (WINDOW * i) / ARRIVALS); await arrival(++n); })());

  // Ступени: цель растёт — новые пользователи входят равномерно (первая ступень — за разгон)
  for (let s = 0; s < STAGES.length; s++) {
    stageIndex = s;
    target = STAGES[s].users;
    const spread = s === 0 ? RAMP : Math.min(60_000, STAGES[s].sec * 200);
    const add = Math.max(0, target - spawned);
    for (let i = 0; i < add; i++) {
      const id = ++spawned;
      tasks.push((async () => { await sleep((spread * i) / Math.max(1, add)); await activeUser(id, deadline); })());
    }
    const stageEnd = (s === 0 ? RAMP : 0) + STAGES[s].sec * 1000;
    if (STAGES.length > 1) {
      await sleep(stageEnd);
      const st = stageStats[s] ?? { reads: [], writes: [], errors: 0, count: 0 };
      console.log(`  ступень ${s + 1}: ${STAGES[s].users} работают — ${st.count} запросов, ошибок ${st.errors}, p95 чтения ${p95(st.reads)} мс, записи ${p95(st.writes)} мс`);
    }
  }
  if (STAGES.length > 1) target = 0; // все ступени пройдены — работающие уходят
  await Promise.all(tasks);
  const elapsed = (performance.now() - started) / 1000;
  clearInterval(peakTimer);

  const rows = [...stats].map(([op, s]) => {
    const ms = s.ms.sort((a, b) => a - b);
    return {
      op, count: ms.length, errors: s.errors, rejected: s.rejected, codes: s.codes,
      p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(ms[ms.length - 1] ?? 0),
    };
  }).sort((a, b) => b.count - a.count);
  const all = [...stats.values()].flatMap((s) => s.ms);
  const reads = rows.filter((r) => isRead(r.op)).flatMap((r) => stats.get(r.op).ms);
  // Запись — изменение данных: без входа, билета и подключения потока
  const writes = rows.filter((r) => isWrite(r.op)).flatMap((r) => stats.get(r.op).ms);
  const errors = rows.reduce((k, r) => k + r.errors, 0);
  const summary = {
    profile: PROFILE || null, population: POPULATION, users: STAGES.map((s) => s.users), idle: IDLE, arrivals: ARRIVALS,
    durationSec: Math.round(elapsed), requests: all.length, rps: Math.round(all.length / elapsed),
    errors, errorRate: all.length ? Math.round((errors / all.length) * 10000) / 100 : 0,
    readP95: p95(reads), writeP95: p95(writes),
    ...(SSE ? { sse: { peakOpen: peak, failed: sse.failed, events: sse.events } } : {}),
  };
  const stageRows = STAGES.map((s, i) => {
    const st = stageStats[i] ?? { reads: [], writes: [], errors: 0, count: 0 };
    return { users: s.users, requests: st.count, errors: st.errors, readP95: p95(st.reads), writeP95: p95(st.writes) };
  });
  const timeline = ticks.map((t, i) => ({ at: Math.round((i * TICK) / 1000), requests: t?.count ?? 0, errors: t?.errors ?? 0, readP95: p95(t?.reads ?? []), writeP95: p95(t?.writes ?? []) }));

  console.log('\n| Операция | Запросов | Ошибок | Отказов 409 | p50, мс | p95, мс | p99, мс | max, мс |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.op} | ${r.count} | ${r.errors}${r.errors ? ` ${JSON.stringify(r.codes)}` : ''} | ${r.rejected} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} |`);
  if (STAGES.length > 1) {
    console.log('\n| Работают | Запросов | Ошибок | p95 чтения, мс | p95 записи, мс |\n|---|---|---|---|---|');
    for (const s of stageRows) console.log(`| ${s.users} | ${s.requests} | ${s.errors} | ${s.readP95} | ${s.writeP95} |`);
  }
  console.log(`\nИтого: ${summary.requests} запросов за ${summary.durationSec} с (${summary.rps}/с), ошибок ${summary.errors} (${summary.errorRate} %), p95 чтения ${summary.readP95} мс, p95 записи ${summary.writeP95} мс`);
  if (SSE) console.log(`Поток событий: одновременно открыто до ${peak}, сбоев ${sse.failed}, событий ${JSON.stringify(sse.events)}`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ summary, rows, stages: stageRows, timeline }, null, 2));

  // --slo: требования модели (docs/performance/workday-model.md) — нарушение завершает процесс с кодом 1 (CI)
  if (has('slo')) {
    const maxRead = Number(arg('max-read', 300));
    const maxWrite = Number(arg('max-write', 500));
    const broken = [
      summary.readP95 > maxRead && `p95 чтения ${summary.readP95} мс > ${maxRead}`,
      summary.writeP95 > maxWrite && `p95 записи ${summary.writeP95} мс > ${maxWrite}`,
      summary.errors > 0 && `ошибок ${summary.errors}`,
      SSE && sse.failed > 0 && `сбоев потока событий ${sse.failed}`,
    ].filter(Boolean);
    console.log(broken.length ? `Требования нарушены: ${broken.join('; ')}` : 'Требования выполнены');
    if (broken.length) process.exitCode = 1;
  }
}

main();
