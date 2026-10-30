// Уведомления о сторонних компонентах для комплекта реестра российского ПО и перечень компонентов SBOM.
// Читает sbom/server.cdx.json и sbom/web.cdx.json (CycloneDX 1.5 от cyclonedx-npm, `make sbom`),
// пишет docs/registry/third-party-notices.md («Сторонние компоненты и лицензии») и
// docs/sbom/sbom-components.csv (package, name, version, license, scope, purl).
//
//   node scripts/third-party-notices.mjs
//
// Перезапускайте после `make sbom` (при любом изменении зависимостей); результат вручную не правится.
// В поставку (scope = runtime) входят:
//   - server: всё, что остаётся после `npm prune --omit=dev` в server/Dockerfile, — компоненты SBOM
//     без признака cdx:npm:package:development; состав сверяется с замыканием dependencies
//     из server/package.json по графу зависимостей SBOM;
//   - web: только то, что Vite собирает в SPA, — замыкание dependencies из web/package.json без
//     пакетов, которые работают лишь при сборке (WEB_NOT_BUNDLED); при наличии web/dist заголовки
//     лицензий сборки сверяются с перечнем.
// Остальное (scope = dev) нужно только для сборки, разработки и тестов и в поставку не входит.
// Строки об авторском праве берутся из файлов LICENSE пакетов в server/node_modules и
// web/node_modules, если зависимости установлены (`npm ci`); в SBOM таких сведений нет.
// Образы контейнеров читаются из Dockerfile и docker-compose*.yml (раздел «Среда выполнения»).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_MD = join(root, 'docs', 'registry', 'third-party-notices.md');
const OUT_CSV = join(root, 'docs', 'sbom', 'sbom-components.csv');
const PRODUCT = 'Планировщик отпусков';
const PARTS = [
  { id: 'server', title: 'сервер', sbom: 'sbom/server.cdx.json' },
  { id: 'web', title: 'веб-интерфейс', sbom: 'sbom/web.cdx.json' },
];

// Зависимости web из package.json, которые не попадают в сборку SPA (и всё, что достижимо только через них).
const WEB_NOT_BUNDLED = {
  '@vue/compiler-sfc': 'компилятор однофайловых компонентов: шаблоны компилируются при сборке (@vitejs/plugin-vue), в браузер уходит runtime-сборка Vue',
  '@vue/compiler-dom': 'компилятор шаблонов — работает только при сборке',
  '@vue/compiler-core': 'компилятор шаблонов — работает только при сборке',
  '@vue/compiler-ssr': 'компилятор серверного рендеринга — серверный рендеринг не используется',
  '@vue/server-renderer': 'серверный рендеринг не используется',
  '@vue/devtools-api': 'интеграция с Vue Devtools: код исключается из production-сборки',
  csstype: 'только объявления типов TypeScript, исполняемого кода нет',
};

// Лицензия установлена по тексту LICENSE-файла (поле license в манифесте не заполнено) —
// та же таблица исключений, что в scripts/license-report.mjs.
const MANUAL_LICENSES = { busboy: 'MIT', streamsearch: 'MIT', buffers: 'MIT' };

const PERMISSIVE = 'Разрешительная';
const NOTICE_DUTY = 'Сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях';
const BSD_DUTY = 'Сохранять уведомление об авторском праве, перечень условий и отказ от гарантий; при распространении в двоичном виде — воспроизводить их в документации';
const NO_DUTY = 'Условий нет; сведения приводятся для полноты';
const LICENSES = {
  MIT: { title: 'MIT License', spdx: ['MIT'], kind: PERMISSIVE, duty: NOTICE_DUTY },
  'MIT/X11': { title: 'MIT/X11 (ранняя редакция MIT License)', spdx: ['MIT'], kind: PERMISSIVE, duty: NOTICE_DUTY },
  ISC: { title: 'ISC License', spdx: ['ISC'], kind: PERMISSIVE, duty: NOTICE_DUTY },
  'BSD-2-Clause': { title: 'BSD 2-Clause License', spdx: ['BSD-2-Clause'], kind: PERMISSIVE, duty: BSD_DUTY },
  'BSD-3-Clause': { title: 'BSD 3-Clause License', spdx: ['BSD-3-Clause'], kind: PERMISSIVE, duty: `${BSD_DUTY}; не использовать имена авторов для продвижения без их разрешения` },
  'Apache-2.0': { title: 'Apache License 2.0', spdx: ['Apache-2.0'], kind: PERMISSIVE, duty: 'Передавать копию лицензии; сохранять уведомления об авторском праве, патентах и товарных знаках и файл NOTICE (если есть); помечать изменённые файлы' },
  'PSF-2.0': { title: 'Python Software Foundation License 2.0', spdx: ['PSF-2.0'], kind: PERMISSIVE, duty: 'Сохранять уведомление об авторском праве PSF и текст лицензии' },
  'Python-2.0': { title: 'Python License 2.0', spdx: ['Python-2.0'], kind: PERMISSIVE, duty: 'Сохранять уведомление об авторском праве PSF и текст лицензии' },
  'BlueOak-1.0.0': { title: 'Blue Oak Model License 1.0.0', spdx: ['BlueOak-1.0.0'], kind: PERMISSIVE, duty: 'Передавать получателям текст лицензии или ссылку на него' },
  Zlib: { title: 'zlib License', spdx: ['Zlib'], kind: PERMISSIVE, duty: 'Не искажать происхождение; изменённые версии явно помечать; не удалять уведомление' },
  '0BSD': { title: 'BSD Zero Clause License', spdx: ['0BSD'], kind: 'Разрешительная без условий', duty: NO_DUTY },
  'MIT-0': { title: 'MIT No Attribution', spdx: ['MIT-0'], kind: 'Разрешительная без условий', duty: NO_DUTY },
  'CC0-1.0': { title: 'Creative Commons Zero 1.0', spdx: ['CC0-1.0'], kind: 'Общественное достояние', duty: NO_DUTY },
  Unlicense: { title: 'The Unlicense', spdx: ['Unlicense'], kind: 'Общественное достояние', duty: NO_DUTY },
  '(MIT AND Zlib)': { title: 'MIT License и zlib License одновременно', spdx: ['MIT', 'Zlib'], kind: PERMISSIVE, duty: 'Выполнять условия обеих лицензий: сохранять уведомления, не искажать происхождение, помечать изменённые версии' },
  '(MIT OR GPL-3.0-or-later)': { title: 'MIT License или GNU GPL 3.0 и выше — по выбору', spdx: ['MIT'], kind: 'Двойная: применяется MIT', duty: `Используется на условиях MIT: ${NOTICE_DUTY.toLowerCase()}` },
};

// Особенности отдельных компонентов поставки.
const COMPONENT_NOTES = {
  jszip: 'Двойная лицензия `MIT OR GPL-3.0-or-later`: программа использует компонент на условиях MIT; GPL не применяется.',
  'swagger-ui-dist': 'Собранный пакет интерфейса документации API (`/api/docs`): включает React (MIT), DOMPurify (`MPL-2.0 OR Apache-2.0`, применяется Apache-2.0) и другие библиотеки; их уведомления — в файлах `swagger-ui-*.js.LICENSE.txt` и `NOTICE` пакета, которые остаются в образе.',
  prisma: 'Командная строка Prisma: применяет миграции при старте контейнера `server` (`prisma migrate deploy`). Пакет поставляется собранным и включает код сторонних библиотек.',
  '@prisma/engines': 'При сборке образа загружает исполняемые движки Prisma (query engine, schema engine; Apache-2.0) под платформу образа; они остаются в `node_modules`.',
  '@scarf/scarf': 'Зависимость swagger-ui-dist для статистики установок: сценарий `postinstall` при `npm ci` отправляет событие на scarf.sh, если сбор не отключён (`SCARF_ANALYTICS=false` или `scarfSettings.enabled: false`). Во время работы программы не используется.',
  nodemailer: 'Отправка писем через почтовый релей организации (`SMTP_HOST`); без настройки почты не используется.',
};

// Образы контейнеров: что в них главное и на каких лицензиях. Ключ — имя образа без тега.
const ALPINE = 'Alpine Linux: musl (MIT), BusyBox (GPL-2.0-only), apk-tools (GPL-2.0-only), OpenSSL (Apache-2.0), zlib (Zlib), ca-certificates (MPL-2.0 AND MIT)';
const IMAGES = {
  node: { software: 'Node.js — MIT (в составе — V8, libuv, OpenSSL, ICU и др. на условиях их лицензий); npm — Artistic-2.0 (входит в образ, программой при работе не вызывается)', base: ALPINE },
  nginx: { software: 'nginx — BSD-2-Clause; envsubst из GNU gettext (GPL-3.0-or-later) подставляет переменные в шаблон конфигурации при старте как отдельная программа', base: ALPINE },
  postgres: { software: 'PostgreSQL — PostgreSQL License; расширение pg_stat_statements (PostgreSQL License); сценарий входа образа — bash (GPL-3.0-or-later)', base: ALPINE },
  'prom/prometheus': { software: 'Prometheus — Apache-2.0', base: 'BusyBox (GPL-2.0-only)' },
};

const read = (p) => readFileSync(join(root, p), 'utf-8');
const readJson = (p) => JSON.parse(read(p));
const warn = (msg) => console.warn(`  внимание: ${msg}`);

// ---------------------------------------------------------------- SBOM
function loadPart(part) {
  if (!existsSync(join(root, part.sbom))) {
    console.error(`Нет ${part.sbom}. Сформируйте SBOM: make sbom (или cd ${part.id} && npm run sbom).`);
    process.exit(1);
  }
  const bom = readJson(part.sbom);
  const pkg = readJson(`${part.id}/package.json`);
  const fullName = (c) => (c.group ? `${c.group}/${c.name}` : c.name);
  const components = (bom.components ?? []).filter((c) => c.type === 'library' || c.type === 'application').map((c) => {
    const name = fullName(c);
    const ids = [...new Set((c.licenses ?? []).map((l) => l.expression ?? l.license?.id ?? l.license?.name).filter(Boolean))];
    return {
      ref: c['bom-ref'],
      name,
      version: c.version,
      purl: c.purl ?? '',
      license: ids.length ? ids.join(' AND ') : MANUAL_LICENSES[name] ?? 'UNKNOWN',
      manual: !ids.length && !!MANUAL_LICENSES[name],
      path: c.properties?.find((p) => p.name === 'cdx:npm:package:path')?.value ?? '',
      dev: !!c.properties?.some((p) => p.name === 'cdx:npm:package:development' && p.value === 'true'),
    };
  });
  const byRef = new Map(components.map((c) => [c.ref, c]));
  const deps = new Map((bom.dependencies ?? []).map((d) => [d.ref, d.dependsOn ?? []]));
  const rootRef = bom.metadata?.component?.['bom-ref'];
  const direct = (deps.get(rootRef) ?? []).filter((r) => byRef.has(r) && pkg.dependencies?.[byRef.get(r).name]);
  return { ...part, bom, pkg, components, byRef, deps, direct, sbomVersion: bom.metadata?.component?.version };
}

/** Замыкание зависимостей от прямых runtime-зависимостей; skip — пакеты, через которые не идём. */
function closure(p, skip = () => false) {
  const seen = new Set();
  const viaDev = new Set();
  const stack = [...p.direct];
  while (stack.length) {
    const ref = stack.pop();
    const c = p.byRef.get(ref);
    if (!c || seen.has(ref) || skip(c)) continue;
    if (c.dev) { viaDev.add(`${c.name}@${c.version}`); continue; } // необязательные peer-зависимости, удовлетворённые dev-пакетами
    seen.add(ref);
    stack.push(...(p.deps.get(ref) ?? []));
  }
  return { refs: seen, viaDev: [...viaDev] };
}

/** Сверка состава SBOM с package-lock.json (SBOM мог быть сформирован до смены номера версии). */
function lockCheck(p) {
  const lock = readJson(`${p.id}/package-lock.json`);
  const inLock = new Set(Object.entries(lock.packages ?? {}).filter(([k]) => k)
    .map(([k, v]) => `${v.name ?? k.split('node_modules/').pop()}@${v.version}`));
  const inSbom = new Set(p.components.map((c) => `${c.name}@${c.version}`));
  const diff = [...inSbom].filter((x) => !inLock.has(x)).concat([...inLock].filter((x) => !inSbom.has(x)));
  return { ok: diff.length === 0, size: inSbom.size, diff };
}

// ---------------------------------------------------------------- авторское право
// Строка уведомления начинается с «Copyright», «(c)» или «©»; строчное «copyright …» — это текст лицензии.
const COPYRIGHT = /^(Copyright\b|COPYRIGHT\b|\([cC]\)|©)/;
// Шаблоны и фрагменты самих текстов лицензий: «(c) You must retain…» в Apache-2.0, уведомление FSF в тексте GPL.
const TEMPLATE = /\[yyyy\]|\{yyyy\}|<year>|\[year\]|<copyright holders?>|copyright (notice|holder|owner|statement|license|and license)s?\b|^\([cC]\)\s+you\b|Free Software Foundation, Inc|^copyright and related rights/i;

function copyrightOf(partId, c) {
  const dir = join(root, partId, c.path);
  if (!c.path || !existsSync(join(dir, 'package.json'))) return { lines: [], installed: false };
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
  if (manifest.version !== c.version) return { lines: [], installed: false };
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice|copyrightnotice)/i.test(f) && statSync(join(dir, f)).isFile());
  const lines = [];
  const quoted = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf-8');
    for (const raw of text.split(/\r?\n/)) {
      const s = raw.trim().replace(/\s+/g, ' ');
      if (COPYRIGHT.test(s) && !TEMPLATE.test(s) && s.length < 200) lines.push(s);
    }
    // Уведомление внутри текста лицензии в кавычках (PSF): i.e., "Copyright (c) 2001, … Python Software Foundation…"
    for (const m of text.matchAll(/"(Copyright \(c\)[^"]{1,300})"/g)) quoted.push(m[1].replace(/\s+/g, ' ').trim());
  }
  const unique = [...new Set(lines.length ? lines : quoted)];
  if (!unique.length && manifest.author) {
    const a = typeof manifest.author === 'string' ? manifest.author : manifest.author.name;
    if (a) unique.push(`Автор: ${a}`);
  }
  return { lines: unique, installed: true, notice: files.some((f) => /^notice/i.test(f)) };
}

const md = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\*/g, '\\*').replace(/\[/g, '\\[')
  .replace(/\]/g, '\\]').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csv = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const npmUrl = (name) => `https://www.npmjs.com/package/${name}`;
const spdxUrl = (id) => `https://spdx.org/licenses/${id}.html`;
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};

function licenseInfo(id) {
  if (LICENSES[id]) return LICENSES[id];
  const parts = id.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
  if (parts.length > 1 && parts.every((x) => LICENSES[x]?.kind === PERMISSIVE)) {
    return { title: `Составная: ${id}`, spdx: parts, kind: PERMISSIVE, duty: 'Выполнять условия каждой из лицензий' };
  }
  return { title: id, spdx: [], kind: 'Требует разбора', duty: 'Определить лицензию и условия до выпуска (политика документа 11)' };
}

// ---------------------------------------------------------------- образы контейнеров
function images() {
  const rows = [];
  for (const [file, label] of [['server/Dockerfile', 'server'], ['web/Dockerfile', 'web']]) {
    const froms = [...read(file).matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)];
    froms.forEach((m, i) => rows.push({
      image: m[1],
      where: `${file}: ${i === froms.length - 1 ? `рабочий образ \`${label}\`` : `стадия сборки «${m[2] ?? i}»`}`,
      shipped: i === froms.length - 1,
    }));
  }
  const apk = [...read('server/Dockerfile').matchAll(/apk add (?:--no-cache )?([^\n&]+)/g)].map((m) => m[1].trim());
  for (const file of composeFiles()) {
    let service = null;
    for (const line of read(file).split('\n')) {
      const s = line.match(/^ {2}([\w.-]+):\s*$/);
      if (s) service = s[1];
      const im = line.match(/^ {4}image:\s*(\S+)/);
      if (im && service) rows.push({ image: im[1], where: `${file}: сервис \`${service}\``, shipped: true });
    }
  }
  return { rows, apk };
}

function composeFiles() {
  // основной docker-compose.yml — первым, дополнения — за ним
  return readdirSync(root).filter((f) => /^docker-compose.*\.ya?ml$/.test(f))
    .sort((a, b) => (a === 'docker-compose.yml' ? -1 : b === 'docker-compose.yml' ? 1 : a.localeCompare(b)));
}

/** Профили сервисов compose (ключ «файл:сервис»): profiles может стоять в описании сервиса после image. */
function composeProfiles() {
  const map = new Map();
  for (const file of composeFiles()) {
    let service = null;
    for (const line of read(file).split('\n')) {
      const s = line.match(/^ {2}([\w.-]+):\s*$/);
      if (s) service = s[1];
      const pr = line.match(/^ {4}profiles:\s*\[(.*)\]/);
      if (pr && service) map.set(`${file}:${service}`, pr[1].replace(/["' ]/g, ''));
    }
  }
  return map;
}

// ---------------------------------------------------------------- main
const parts = PARTS.map(loadPart);
const version = parts[0].pkg.version;
const shipped = new Map(); // part id → Set(ref)
const checks = [];

for (const p of parts) {
  const lc = lockCheck(p);
  p.lock = lc;
  if (!lc.ok) warn(`${p.sbom}: состав расходится с ${p.id}/package-lock.json (${lc.diff.slice(0, 5).join(', ')}…) — обновите SBOM (make sbom)`);
  if (p.sbomVersion !== p.pkg.version) warn(`${p.sbom}: версия в метаданных SBOM ${p.sbomVersion}, в ${p.id}/package.json — ${p.pkg.version}; перед подачей сформируйте SBOM заново`);
  if (p.direct.length !== Object.keys(p.pkg.dependencies ?? {}).length) warn(`${p.id}: не все dependencies из package.json найдены в SBOM`);
}

// server: всё без признака development; сверка с замыканием dependencies
{
  const p = parts.find((x) => x.id === 'server');
  const prod = new Set(p.components.filter((c) => !c.dev).map((c) => c.ref));
  const { refs, viaDev } = closure(p);
  const extra = [...prod].filter((r) => !refs.has(r)).map((r) => p.byRef.get(r).name);
  const missing = [...refs].filter((r) => !prod.has(r)).map((r) => p.byRef.get(r).name);
  if (extra.length || missing.length) warn(`server: признак development в SBOM расходится с замыканием dependencies (лишние: ${extra.join(', ') || '—'}; недостающие: ${missing.join(', ') || '—'})`);
  shipped.set('server', prod);
  checks.push({ part: p, rule: '`npm prune --omit=dev` в `server/Dockerfile`: в образ входят компоненты SBOM без признака `cdx:npm:package:development`', verified: !extra.length && !missing.length, viaDev });
}

// web: замыкание dependencies без пакетов, работающих только при сборке
const webExcluded = new Map();
{
  const p = parts.find((x) => x.id === 'web');
  const { refs, viaDev } = closure(p, (c) => {
    if (!WEB_NOT_BUNDLED[c.name]) return false;
    webExcluded.set(c.name, c.version);
    return true;
  });
  shipped.set('web', refs);
  // транзитивные зависимости исключённых пакетов: runtime по npm, но в сборку не попадают
  const prod = p.components.filter((c) => !c.dev && !refs.has(c.ref));
  p.buildOnly = [...new Set(prod.map((c) => `${c.name}@${c.version}`))].sort();
  // сверка со сборкой, если она есть: заголовки «/*! name vX.Y.Z … @license»
  let distCheck = 'сборки `web/dist` при формировании не было — со сборкой не сверялось';
  const assets = join(root, 'web', 'dist', 'assets');
  if (existsSync(assets)) {
    const names = new Set([...refs].map((r) => p.byRef.get(r).name));
    const seen = new Set();
    for (const f of readdirSync(assets).filter((x) => x.endsWith('.js'))) {
      for (const m of readFileSync(join(assets, f), 'utf-8').matchAll(/\/\*[*!]\s*\*?\s*(@?[\w./-]+) v(\d[\w.-]*)[\s\S]{0,200}?@license/g)) seen.add(m[1]);
    }
    const stray = [...seen].filter((n) => !names.has(n));
    const list = [...seen].sort().map((n) => `\`${n}\``).join(', ');
    if (stray.length) {
      warn(`web/dist содержит заголовки лицензий пакетов вне перечня: ${stray.join(', ')}`);
      distCheck = `в сборке \`web/dist\` есть заголовки лицензий пакетов вне перечня: ${stray.join(', ')}`;
    } else {
      distCheck = `сверено со сборкой \`web/dist\`: заголовки лицензий ${list} — все в перечне`;
    }
    console.log(`  ${distCheck.replace(/`/g, '')}`);
  } else {
    console.log('  web/dist нет — сверка со сборкой пропущена (cd web && npm run build)');
  }
  checks.push({ part: p, rule: 'Vite собирает в SPA только импортируемый код: замыкание `dependencies` из `web/package.json` без пакетов, работающих лишь при сборке (раздел «Веб-интерфейс: состав сборки»)', distCheck, viaDev });
}

// Компоненты поставки: уникальные name@version в каждой части
const rows = [];
let installed = 0;
let withCopyright = 0;
const notices = [];
for (const p of parts) {
  const seen = new Set();
  for (const ref of shipped.get(p.id)) {
    const c = p.byRef.get(ref);
    const key = `${c.name}@${c.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cr = copyrightOf(p.id, c);
    if (cr.installed) installed++;
    if (cr.lines.length) withCopyright++;
    if (cr.notice) notices.push(`${c.name}`);
    rows.push({ part: p, ...c, copyright: cr.lines });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.part.id.localeCompare(b.part.id));

const byLicense = new Map();
for (const r of rows) {
  if (!byLicense.has(r.license)) byLicense.set(r.license, []);
  byLicense.get(r.license).push(r);
}
const licenseOrder = [...byLicense.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
const unknown = licenseOrder.filter(([id]) => licenseInfo(id).kind === 'Требует разбора');
const strongCopyleft = rows.filter((r) => /(^|[^L])A?GPL-/.test(r.license) && !/\bOR\b/.test(r.license));
const dualGpl = rows.filter((r) => /GPL-/.test(r.license) && /\bOR\b/.test(r.license));
const weakCopyleft = rows.filter((r) => /\b(LGPL|MPL|EPL|CDDL)-/.test(r.license) && !/\bOR\b/.test(r.license));
const count = (list, partId) => list.filter((r) => r.part.id === partId).length;
const total = { server: count(rows, 'server'), web: count(rows, 'web') };

// ---------------------------------------------------------------- документ
const today = new Date().toISOString().slice(0, 10);
const L = [];
L.push(
  '# О документе',
  '',
  `Программа «${PRODUCT}» включает свободные компоненты третьих лиц. Документ перечисляет компоненты, которые входят в поставку версии ${version}: библиотеки серверной части в образе \`server\` и библиотеки, собранные в веб-интерфейс (образ \`web\`), — с версиями, лицензиями и уведомлениями об авторском праве, а также программы в образах контейнеров, которые поставляются вместе с программой. Компоненты, нужные только для сборки, разработки и тестирования, в поставку не входят; они перечислены в отчёте «SBOM и анализ лицензий» (\`docs/sbom/licenses-report.md\`) и в перечне \`docs/sbom/sbom-components.csv\` со значением \`dev\` в колонке \`scope\`.`,
  '',
  'Документ сформирован автоматически скриптом `scripts/third-party-notices.mjs` из SBOM и вручную не правится. Полные тексты лицензий приведены в реестре SPDX (ссылки в разделах ниже) и поставляются в составе образа `server` в каталогах самих пакетов (`node_modules/<пакет>/LICENSE`, `NOTICE`); для веб-интерфейса, где библиотеки собраны в один файл, этот документ входит в комплект поставки.',
  '',
  '| Параметр | Значение |',
  '| --- | --- |',
  `| Программа, версия | «${PRODUCT}» ${version} |`,
  `| Источник | ${parts.map((p) => `\`${p.sbom}\``).join(', ')} — CycloneDX ${parts[0].bom.specVersion}, cyclonedx-npm по \`package-lock.json\` |`,
  `| Дата формирования | ${today} |`,
  `| Компонентов в SBOM (уникальных name@version) | ${parts.map((p) => `${p.id} — ${p.lock.size}`).join(', ')} |`,
  `| Сверка SBOM с \`package-lock.json\` | ${parts.map((p) => `${p.id} — ${p.lock.ok ? 'совпадает' : 'расходится'}`).join(', ')}${parts.some((p) => p.sbomVersion !== p.pkg.version) ? `; в метаданных SBOM указана версия ${[...new Set(parts.map((p) => p.sbomVersion))].join(', ')}: SBOM сформирован до смены номера версии, состав зависимостей тот же` : ''} |`,
  `| В поставке | ${rows.length}: сервер — ${total.server}, веб-интерфейс — ${total.web} |`,
  `| Строки об авторском праве | Из файлов LICENSE пакетов: найдены для ${withCopyright} из ${rows.length} компонентов${installed < rows.length ? ` (зависимости установлены для ${installed}; для полноты выполните \`npm ci\` в \`server/\` и \`web/\` и перезапустите скрипт)` : ''} |`,
  '',
  '## Как определён состав поставки',
  '',
  '| Часть | Правило | Проверка |',
  '| --- | --- | --- |',
  ...checks.map((c) => `| ${c.part.title[0].toUpperCase()}${c.part.title.slice(1)} | ${c.rule} | ${c.part.id === 'server'
    ? `${c.verified ? 'Совпадает' : 'Расходится'} с замыканием \`dependencies\` из \`server/package.json\` по графу зависимостей SBOM`
    : `Прямые зависимости: ${Object.keys(c.part.pkg.dependencies).join(', ')}; ${c.distCheck}`}${c.viaDev.length ? `; необязательные peer-зависимости ${c.viaDev.map((x) => `\`${x}\``).join(', ')} удовлетворяются пакетами разработки и в поставку не входят` : ''} |`),
  '',
  '# Сводка по лицензиям',
  '',
  '| Лицензия (SPDX) | Категория | Сервер | Веб-интерфейс | Обязанности |',
  '| --- | --- | --- | --- | --- |',
  ...licenseOrder.map(([id, list]) => {
    const info = licenseInfo(id);
    return `| \`${id}\` | ${info.kind} | ${count(list, 'server')} | ${count(list, 'web')} | ${info.duty} |`;
  }),
  `| **Всего** | | **${total.server}** | **${total.web}** | |`,
  '',
  [
    strongCopyleft.length
      ? `**Внимание:** компоненты с сильным копилефтом в поставке: ${strongCopyleft.map((r) => r.name).join(', ')} — требуется разбор до выпуска.`
      : 'Компонентов с сильным копилефтом (GPL, AGPL) среди библиотек, связываемых с кодом программы, нет.',
    dualGpl.length
      ? `${dualGpl.length === 1 ? 'Компонент' : 'Компоненты'} с двойной лицензией, включающей GPL (${dualGpl.map((r) => r.name).join(', ')}), ${dualGpl.length === 1 ? 'используется' : 'используются'} на условиях разрешительной альтернативы.`
      : '',
    weakCopyleft.length
      ? `Компоненты со слабым копилефтом: ${weakCopyleft.map((r) => `${r.name} (\`${r.license}\`)`).join(', ')} — используются без изменений.`
      : 'Компонентов со слабым копилефтом (LGPL, MPL) среди библиотек нет.',
    'Лицензионные платежи за компоненты не требуются.',
  ].filter(Boolean).join(' '),
  '',
);
if (unknown.length) L.push(`**Внимание:** лицензия не определена: ${unknown.map(([id, l]) => `${l.map((r) => r.name).join(', ')} (\`${id}\`)`).join('; ')}.`, '');

L.push('# Компоненты по лицензиям', '');
for (const [id, list] of licenseOrder) {
  const info = licenseInfo(id);
  L.push(
    `## ${id} — ${info.title}`,
    '',
    `${info.kind}. ${info.duty}. Текст лицензии: ${info.spdx.length ? info.spdx.map((s) => `<${spdxUrl(s)}>`).join(', ') : 'определить вручную'}.`,
    '',
    '| Компонент | Версия | Часть | Уведомление об авторском праве |',
    '| --- | --- | --- | --- |',
  );
  for (const r of list) {
    const cr = r.copyright.length > 3 ? [...r.copyright.slice(0, 3), 'и др. — см. LICENSE пакета'] : r.copyright;
    L.push(`| [${md(r.name)}](${npmUrl(r.name)})${r.manual ? ' \\*' : ''} | ${r.version} | ${r.part.title} | ${cr.length ? cr.map(md).join('; ') : '—'} |`);
  }
  L.push('');
  if (list.some((r) => r.manual)) L.push('\\* Поле `license` в манифесте пакета не заполнено; лицензия установлена по тексту файла LICENSE (как в отчёте «SBOM и анализ лицензий»). При обновлении версии проверяется вручную.', '');
  if (id === 'Apache-2.0' && notices.length) L.push(`Файлы NOTICE есть у пакетов: ${[...new Set(notices)].map((n) => `\`${n}\``).join(', ')}; они остаются в образе \`server\` в каталогах пакетов.`, '');
}

const notes = rows.filter((r) => COMPONENT_NOTES[r.name]);
if (notes.length) {
  L.push('## Примечания к отдельным компонентам', '', '| Компонент | Примечание |', '| --- | --- |');
  for (const name of [...new Set(notes.map((r) => r.name))]) L.push(`| ${name} | ${COMPONENT_NOTES[name]} |`);
  L.push('');
}

{
  const p = parts.find((x) => x.id === 'web');
  L.push(
    '# Веб-интерфейс: состав сборки',
    '',
    `Веб-интерфейс поставляется как статическая сборка Vite в образе \`web\` (nginx). В браузер уходит только импортируемый код библиотек; прямые зависимости — ${Object.keys(p.pkg.dependencies).map((n) => `\`${n}\``).join(', ')}. Шрифты, иконки и стили собственные или системные; внешних CDN и шрифтовых сервисов нет. Пакеты, которые npm считает рабочими зависимостями, но которые в сборку не попадают:`,
    '',
    '| Пакет | Версия | Почему не входит в сборку |',
    '| --- | --- | --- |',
    ...[...webExcluded.entries()].sort().map(([n, v]) => `| ${n} | ${v} | ${WEB_NOT_BUNDLED[n]} |`),
    '',
  );
  const rest = p.buildOnly.filter((x) => !webExcluded.has(x.replace(/@[^@]+$/, '')));
  if (rest.length) L.push(`Их собственные зависимости в сборку тоже не входят: ${rest.map((x) => `\`${x}\``).join(', ')}.`, '');
}

{
  const { rows: imgs, apk } = images();
  const prof = composeProfiles();
  const byImage = new Map();
  for (const r of imgs) {
    const svc = r.where.match(/^(docker-compose[^:]*): сервис `([^`]+)`/);
    const profile = svc ? prof.get(`${svc[1]}:${svc[2]}`) : '';
    const where = profile ? `${r.where} (профиль \`${profile}\`)` : r.where;
    if (!byImage.has(r.image)) byImage.set(r.image, { image: r.image, where: [], shipped: false, optional: true });
    const e = byImage.get(r.image);
    e.where.push(where);
    e.shipped ||= r.shipped;
    if (r.shipped && (!profile || profile.split(',').includes('full'))) e.optional = false;
  }
  const loadModule = /^\s*load_module\b/m.test(read('web/nginx-main.conf'));
  L.push(
    '# Среда выполнения: образы контейнеров',
    '',
    'Программа поставляется в контейнерах Docker. Образы строятся на официальных образах Docker Hub, которые содержат отдельные программы — среду Node.js, веб-сервер nginx, СУБД PostgreSQL, систему мониторинга Prometheus — и пакеты базового дистрибутива Linux. Эти программы распространяются вместе с программой «' + PRODUCT + '», но не связываются с её кодом: они работают как самостоятельные процессы и взаимодействуют с программой через сеть, файлы и командную строку.',
    '',
    '| Образ | Где используется | Основное ПО и лицензия | Базовая ОС и пакеты | В поставке |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const e of byImage.values()) {
    const key = e.image.replace(/:.*$/, '');
    const info = IMAGES[key];
    if (!info) warn(`образ ${e.image} не описан в IMAGES — добавьте описание лицензий`);
    const status = !e.shipped ? 'Нет — только сборка' : e.optional ? 'Необязательный (профиль мониторинга)' : 'Да';
    L.push(`| \`${e.image}\` | ${e.where.join('; ')} | ${info?.software ?? 'описать'} | ${info?.base ?? 'описать'} | ${status} |`);
  }
  L.push('');
  if (apk.length) L.push(`В рабочий образ \`server\` дополнительно устанавливаются пакеты Alpine: ${apk.map((a) => `\`${a}\``).join(', ')} (OpenSSL — Apache-2.0; нужен движку Prisma).`, '');
  L.push(
    `Конфигурация nginx программы ${loadModule ? 'загружает динамические модули директивой `load_module` — их лицензии нужно описать отдельно' : 'не загружает динамические модули (нет директив `load_module` в `web/nginx-main.conf`): дополнительные модули официального образа не используются'}.`,
    '',
    '## Агрегирование и исходные тексты',
    '',
    'Лицензии GPL встречаются только у программ базовых образов (BusyBox, apk-tools, bash, envsubst). Они поставляются рядом с программой как отдельные программы — это агрегирование, а не связывание: код программы «' + PRODUCT + '» не компонуется с ними и не является их производным произведением, поэтому условия GPL на программу не распространяются. Обязанности по этим лицензиям — сохранить их тексты (они есть в образах) и обеспечить доступ к исходным текстам: исходные тексты пакетов Alpine Linux опубликованы в репозитории aports (<https://gitlab.alpinelinux.org/alpine/aports>), сценарии сборки официальных образов — в репозиториях `docker-library` (<https://github.com/docker-library>) и `nginx/docker-nginx` (<https://github.com/nginx/docker-nginx>); правообладатель предоставляет копию по запросу.',
    '',
    'Образы указаны по тегам без фиксированного дайджеста, поэтому точный перечень пакетов базовой ОС определяется на дату сборки. Для поставки фиксируйте дайджесты образов и формируйте их SBOM средствами сканирования образов (например, `syft <образ> -o cyclonedx-json`).',
    '',
    '# Уведомление',
    '',
    `Права на перечисленные компоненты принадлежат их авторам. Компоненты распространяются на условиях их лицензий; лицензионный договор на программу «${PRODUCT}» не ограничивает прав, предоставленных этими лицензиями. Тексты лицензий передаются в составе поставки; исходные тексты компонентов доступны по ссылкам в таблицах, а правообладатель предоставляет их копию по запросу.`,
  );

  mkdirSync(dirname(OUT_MD), { recursive: true });
  writeFileSync(OUT_MD, `${L.join('\n')}\n`);
}

// ---------------------------------------------------------------- CSV
const csvRows = [];
for (const p of parts) {
  const seen = new Set();
  const ship = shipped.get(p.id);
  const shipKeys = new Set([...ship].map((r) => p.byRef.get(r).purl));
  for (const c of p.components) {
    const key = c.purl || `${c.name}@${c.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    csvRows.push([p.id, c.name, c.version, c.license, shipKeys.has(c.purl) ? 'runtime' : 'dev', c.purl]);
  }
}
csvRows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
mkdirSync(dirname(OUT_CSV), { recursive: true });
writeFileSync(OUT_CSV, `${['package,name,version,license,scope,purl', ...csvRows.map((r) => r.map(csv).join(','))].join('\n')}\n`);

console.log(`Уведомления: ${OUT_MD}`);
console.log(`Перечень: ${OUT_CSV} (${csvRows.length} строк, runtime — ${csvRows.filter((r) => r[4] === 'runtime').length})`);
console.log(`В поставке: ${rows.length} (сервер — ${total.server}, веб-интерфейс — ${total.web}); лицензий: ${licenseOrder.length}; строки об авторском праве — ${withCopyright} из ${rows.length}`);
for (const [id, list] of licenseOrder) console.log(`  ${id}: ${list.length} ${plural(list.length, 'компонент', 'компонента', 'компонентов')}`);
if (unknown.length || strongCopyleft.length) process.exit(1);
