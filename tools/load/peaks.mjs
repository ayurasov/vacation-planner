// Пики, которые создаёт сервер по действию кадровой службы или по расписанию (E51-03, модель —
// docs/performance/workday-model.md, «Пики, которые создаёт сервер»). Запускается на фоне профиля average.
// Без зависимостей: Node 20+ (fetch) и psql.
//
//   node tools/load/peaks.mjs --url http://127.0.0.1:8097 --db postgresql://…/vacation_load --out peaks.json
//
// Шаги: открытие кампании с приглашением всем (время ответа, уведомления и письма, разбор очереди писем —
// если сервер направлен на SMTP, например tools/load/smtp-sink.mjs), напоминание, выгрузки Т-7 и графика
// за год, волна извещений (--notices N отпусков с одного дня), утверждение графика (--approve — меняет
// данные необратимо). Данные — стенд нагрузки (load-seed.ts): кадровая служба — load.u00001.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const has = (name) => process.argv.includes(`--${name}`);
const URL_BASE = arg('url', 'http://127.0.0.1:8097').replace(/\/+$/, '');
const DB = arg('db', '');
const NOTICES = Number(arg('notices', 400));
const MAIL_TIMEOUT = Number(arg('mail-timeout', 1800)) * 1000;
const year = new Date().getFullYear();
const next = year + 1;
const iso = (d) => d.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync('psql', [DB, '-Atc', q], { encoding: 'utf8' }).trim();
const result = {};

async function api(token, method, path, body) {
  const t0 = performance.now();
  const res = await fetch(`${URL_BASE}/api/v1${path}`, {
    method,
    headers: { 'X-Forwarded-For': '10.250.0.1', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ms: Math.round(performance.now() - t0), bytes: buf.length, json: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(buf.toString() || 'null') : null };
}

/** Ждёт, пока условие станет истинным; возвращает секунды или null по таймауту. */
async function until(check, timeoutMs, every = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (check()) return Math.round((Date.now() - t0) / 100) / 10;
    await sleep(every);
  }
  return null;
}

async function main() {
  const login = await fetch(`${URL_BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.250.0.1' },
    body: JSON.stringify({ login: 'load.u00001', password: arg('password', 'load-pass-12345') }),
  });
  const token = (await login.json()).accessToken;
  const outbox = () => Number(sql("SELECT count(*) FROM email_outbox WHERE status = 'pending'"));

  // 1. Открытие кампании: приглашение всем штатным сотрудникам — уведомления и письма одной транзакцией
  const before = Number(sql("SELECT count(*) FROM notifications WHERE kind = 'planning_open'"));
  const mailBefore = outbox();
  const open = await api(token, 'POST', `/planning/${next}/open`, { deadline: `${year}-12-15` });
  const invited = Number(sql("SELECT count(*) FROM notifications WHERE kind = 'planning_open'")) - before;
  result.open = { status: open.status, ms: open.ms, invited, letters: outbox() - mailBefore };
  console.log(`Открытие кампании: ${open.status}, ${open.ms} мс; приглашений ${invited}, писем в очереди ${result.open.letters}`);

  // 2. Разбор очереди писем (если почта настроена — SMTP_HOST у сервера)
  if (result.open.letters > 0 && !has('no-mail')) {
    const drain = await until(() => outbox() === 0, MAIL_TIMEOUT, 5000);
    result.mailDrainSec = drain;
    console.log(drain === null ? `Очередь писем не разобрана за ${MAIL_TIMEOUT / 1000} с, осталось ${outbox()}` : `Очередь писем разобрана за ${drain} с`);
  }

  // 3. Напоминание незапланировавшим
  const remind = await api(token, 'POST', `/planning/${next}/remind`);
  result.remind = { status: remind.status, ms: remind.ms, reminded: remind.json?.reminded ?? remind.json?.count ?? null };
  console.log(`Напоминание: ${remind.status}, ${remind.ms} мс`);

  // 4. Выгрузки: Т-7 на следующий год и график за текущий — по три раза
  for (const [name, path] of [['t7', `/reports/t7?year=${next}`], ['vacations', `/reports/vacations?from=${year}-01-01&to=${year}-12-31`]]) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await api(token, 'GET', path));
    result[name] = { status: runs[0].status, ms: runs.map((r) => r.ms), kb: Math.round(runs[0].bytes / 1024) };
    console.log(`Выгрузка ${name}: ${runs.map((r) => r.ms).join(', ')} мс, ${result[name].kb} КБ`);
  }

  // 5. Волна извещений: N согласованных отпусков с одного дня через 14 дней — задача извещает за один проход
  if (NOTICES > 0) {
    const start = new Date(Date.now() + 14 * 86_400_000);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const [s, e] = [iso(start), iso(end)];
    const noticesBefore = Number(sql('SELECT count(*) FROM vacation_notices'));
    sql(`INSERT INTO vacation_requests (employee_id, start_date, end_date, type, status, created_by, updated_at)
         SELECT em.id, '${s}', '${e}', 'vacation', 'approved', em.id, now() FROM employees em
          WHERE em.is_active AND em.emp_type = 'staff' AND NOT EXISTS (
                SELECT 1 FROM vacation_requests r WHERE r.employee_id = em.id AND r.status IN ('approved', 'pending')
                   AND r.start_date <= '${e}' AND r.end_date >= '${s}')
          ORDER BY em.id LIMIT ${NOTICES}`);
    const done = await until(() => Number(sql('SELECT count(*) FROM vacation_notices')) - noticesBefore >= NOTICES, 300_000);
    result.notices = { count: NOTICES, sec: done };
    console.log(done === null ? 'Извещения не отправлены за 5 минут' : `Извещения ${NOTICES} сотрудникам: ${done} с от появления отпусков`);
  }

  // 6. Утверждение графика: снимок графика всей организации (необратимо — только по флагу)
  if (has('approve')) {
    const approve = await api(token, 'POST', `/planning/${next}/approve`, { docNumber: 'НГ-1', docDate: iso(new Date()) });
    result.approve = { status: approve.status, ms: approve.ms };
    console.log(`Утверждение графика: ${approve.status}, ${approve.ms} мс`);
  }

  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(result, null, 2));
}

main();
