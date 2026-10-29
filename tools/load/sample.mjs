// Ресурсы стенда во время нагрузочного прогона (E51-01): строка CSV каждые --interval секунд.
// Без зависимостей — читает /proc (Linux) и вызывает psql.
//
//   node tools/load/sample.mjs --db postgresql://vacation:vacation@localhost:5432/vacation_load --out resources.csv
//
// Процессор — в ядрах (1,0 = одно ядро занято полностью) отдельно для процессов API (`dist/main.js`),
// PostgreSQL и генератора: так видно, что упирается первым. Память — RSS процессов API (сумма и
// наибольший — утечка видна как рост наибольшего в длительном прогоне). Соединения — из pg_stat_activity.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const DB = arg('db', '');
const INTERVAL = Number(arg('interval', 5)) * 1000;
const OUT = arg('out', '');
const TICK = 100; // USER_HZ: тиков процессора в секунду в /proc

const read = (path) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };

/** Тики процессора и RSS по группам процессов. */
function snapshot() {
  const groups = { api: { ticks: 0, rss: [] }, pg: { ticks: 0, rss: [] }, gen: { ticks: 0, rss: [] } };
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    const cmd = read(`/proc/${pid}/cmdline`).replace(/\0/g, ' ');
    const stat = read(`/proc/${pid}/stat`);
    if (!cmd || !stat) continue;
    const group = cmd.includes('dist/main.js') ? 'api'
      : /^postgres(:| )|\/postgres /.test(cmd) ? 'pg'
        : cmd.includes('tools/load/run.mjs') ? 'gen' : null;
    if (!group) continue;
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' '); // поля после имени: utime — 12-е, stime — 13-е
    groups[group].ticks += Number(f[11]) + Number(f[12]);
    const rss = /VmRSS:\s+(\d+)/.exec(read(`/proc/${pid}/status`))?.[1];
    if (rss) groups[group].rss.push(Number(rss) / 1024);
  }
  const cpu = read('/proc/stat').split('\n')[0].split(/\s+/).slice(1).map(Number);
  return { at: Date.now(), groups, busy: cpu.reduce((a, b) => a + b, 0) - cpu[3] - (cpu[4] ?? 0), total: cpu.reduce((a, b) => a + b, 0) };
}

function connections() {
  if (!DB) return ['', ''];
  try {
    const out = execFileSync('psql', [DB, '-Atc',
      "SELECT count(*), count(*) FILTER (WHERE state = 'active' AND pid <> pg_backend_pid()) FROM pg_stat_activity WHERE datname = current_database()"],
    { encoding: 'utf8', timeout: 3000 });
    return out.trim().split('|');
  } catch {
    return ['', ''];
  }
}

const header = 'time,node_busy_pct,api_cores,pg_cores,gen_cores,api_rss_mb_sum,api_rss_mb_max,api_procs,db_conn,db_active,load1';
if (OUT) writeFileSync(OUT, `${header}\n`);
else console.log(header);

let prev = snapshot();
setInterval(() => {
  const cur = snapshot();
  const sec = (cur.at - prev.at) / 1000;
  const cores = (g) => ((cur.groups[g].ticks - prev.groups[g].ticks) / TICK / sec).toFixed(2);
  const busy = ((100 * (cur.busy - prev.busy)) / Math.max(1, cur.total - prev.total)).toFixed(1);
  const rss = cur.groups.api.rss;
  const [conn, active] = connections();
  const line = [
    new Date(cur.at).toISOString(), busy, cores('api'), cores('pg'), cores('gen'),
    Math.round(rss.reduce((a, b) => a + b, 0)), Math.round(Math.max(0, ...rss)), rss.length,
    conn, active, read('/proc/loadavg').split(' ')[0],
  ].join(',');
  if (OUT) appendFileSync(OUT, `${line}\n`);
  else console.log(line);
  prev = cur;
}, INTERVAL);
