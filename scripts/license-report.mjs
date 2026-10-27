// Отчёт по лицензиям сторонних компонентов из SBOM + анализ для реестра ОП.
// Читает sbom/*.cdx.json, пишет docs/sbom/licenses-report.md (docs/specs/11-sbom-licenses.md).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sbomDir = join(root, 'sbom');
const outDir = join(root, 'docs', 'sbom');
mkdirSync(outDir, { recursive: true });

// Классификация лицензий для включения сторонних компонентов в регистрируемое ПО
// (постановление Правительства РФ № 1236 о порядке регистрации отечественного ПО,
// типовые условия использования при включении в реестр).
const LICENSE_CLASS = {
  MIT: { kind: 'permissive', risk: 'low', note: 'Разрешительная: допускается использование и включение в состав регистрируемого ПО с указанием авторства' },
  'Apache-2.0': { kind: 'permissive', risk: 'low', note: 'Разрешительная: допускается, требуется сохранить NOTICE и маркировку при распространении' },
  'BSD-2-Clause': { kind: 'permissive', risk: 'low', note: 'Разрешительная: допускается с сохранением уведомления об авторских правах' },
  'BSD-3-Clause': { kind: 'permissive', risk: 'low', note: 'Разрешительная: допускается с сохранением уведомления и без использования имён авторов в рекламе' },
  ISC: { kind: 'permissive', risk: 'low', note: 'Разрешительная (эквивалент MIT): допускается' },
  '0BSD': { kind: 'permissive', risk: 'low', note: 'Разрешительная без условий: допускается' },
  'CC0-1.0': { kind: 'permissive', risk: 'low', note: 'Общественное достояние: ограничений нет' },
  Unlicense: { kind: 'permissive', risk: 'low', note: 'Общественное достояние: ограничений нет' },
  'Python-2.0': { kind: 'permissive', risk: 'low', note: 'Разрешительная (PSF): допускается' },
  'PostgreSQL': { kind: 'permissive', risk: 'low', note: 'Разрешительная: допускается' },
  'BSD-3-Clause-Clear': { kind: 'permissive', risk: 'low', note: 'Разрешительная: допускается' },
  'BlueOak-1.0.0': { kind: 'permissive', risk: 'low', note: 'Разрешительная (Blue Oak Model 1): допускается' },
  WTFPL: { kind: 'permissive', risk: 'low', note: 'Разрешительная (публичная без условий): допускается' },
  'CC-BY-3.0': { kind: 'permissive-data', risk: 'low', note: 'Attribution для данных (не кода): допускается с указанием авторства' },
  '(MIT OR Apache-2.0)': { kind: 'permissive', risk: 'low', note: 'Двойная разрешительная: допускается' },
  'MIT*': { kind: 'permissive', risk: 'low', note: 'Вариант MIT: допускается' },
  'GPL-2.0-only': { kind: 'copyleft', risk: 'high', note: 'Сильный copyleft: распространение ПО-производной обязывает раскрывать исходники под GPL — НЕ рекомендуется для регистрируемого ПО' },
  'GPL-3.0-only': { kind: 'copyleft', risk: 'high', note: 'Сильный copyleft: обязательное раскрытие исходников — НЕ рекомендуется' },
  'LGPL-2.1-only': { kind: 'weak-copyleft', risk: 'medium', note: 'Слабый copyleft: допустима динамическая линковка без открытия своего кода; требуется анализ способа связывания' },
  'LGPL-3.0-only': { kind: 'weak-copyleft', risk: 'medium', note: 'Слабый copyleft: допустима динамическая линковка; требуется анализ' },
  'MPL-2.0': { kind: 'weak-copyleft', risk: 'medium', note: 'Файловый copyleft: изменения файлов под MPL публикуются, остальной код не обязателен — допустимо при изоляции' },
  'AGPL-3.0-only': { kind: 'copyleft', risk: 'high', note: 'Сетевой copyleft: предоставление доступа по сети требует раскрытия исходников — НЕ рекомендуется' },
  UNKNOWN: { kind: 'unknown', risk: 'high', note: 'Лицензия не определена автоматически: требуется ручная проверка репозитория компонента' },
};
const classifyOne = (id) => LICENSE_CLASS[id] ?? null;

/** Составные выражения: OR/AND из разрешительных → разрешительное. */
// Лицензии, установленные по тексту LICENSE-файла (в package.json поле не заполнено).
const MANUAL_LICENSES = {
  busboy: 'MIT',
  streamsearch: 'MIT',
};

function classify(id) {
  if (LICENSE_CLASS[id]) return LICENSE_CLASS[id];
  const parts = id.split(/\s+(?:OR|AND)\s+/).map((x) => x.replace(/[()]/g, '').trim());
  if (parts.length > 1) {
    const cls = parts.map(classifyOne).filter(Boolean);
    if (cls.length === parts.length && cls.every((c) => c.risk === 'low')) {
      return { kind: 'permissive', risk: 'low', note: `Составная из разрешительных (${id}): допускается` };
    }
    if (cls.length === parts.length && cls.every((c) => c.risk !== 'high')) {
      return { kind: 'weak-copyleft', risk: 'medium', note: `Составная (${id}): как минимум одна составляющая с ограничениями` };
    }
  }
  return { kind: 'unknown', risk: 'high', note: 'Нет в классификаторе — ручная проверка' };
}

const files = readdirSync(sbomDir).filter((f) => f.endsWith('.cdx.json'));
const packages = [];
for (const f of files) {
  const bom = JSON.parse(readFileSync(join(sbomDir, f), 'utf-8'));
  const app = f.replace('.cdx.json', '');
  for (const c of bom.components ?? []) {
    if (c.type !== 'library' && c.type !== 'application') continue;
    const licIds = [...new Set((c.licenses ?? [])
      .map((l) => l.license?.id ?? l.license?.name ?? l.expression)
      .filter(Boolean))];
    let licenses = licIds.length ? licIds : [MANUAL_LICENSES[c.name] ?? 'UNKNOWN'];
    if (!licIds.length && MANUAL_LICENSES[c.name]) licenses = [MANUAL_LICENSES[c.name]];
    packages.push({
      app,
      name: c.name,
      version: c.version,
      purl: c.purl,
      licenses,
      manual: !licIds.length && !!MANUAL_LICENSES[c.name],
    });
  }
}

// Уникальные компоненты (могут повторяться в двух SBOM)
const byKey = new Map();
for (const p of packages) {
  const key = `${p.name}@${p.version}`;
  if (!byKey.has(key)) byKey.set(key, { ...p, apps: new Set([p.app]) });
  else byKey.get(key).apps.add(p.app);
}
const all = [...byKey.values()].map((p) => ({ ...p, apps: [...p.apps] }));
all.sort((a, b) => a.name.localeCompare(b.name));

const byLicense = new Map();
for (const p of all) {
  for (const lic of p.licenses) {
    if (!byLicense.has(lic)) byLicense.set(lic, []);
    byLicense.get(lic).push(p);
  }
}

const riskOrder = { high: 0, medium: 1, low: 2 };
const licEntries = [...byLicense.entries()]
  .map(([id, comps]) => ({ id, comps, cls: classify(id) }))
  .sort((a, b) => riskOrder[a.cls.risk] - riskOrder[b.cls.risk] || a.id.localeCompare(b.id));

const verdict = licEntries.some((l) => l.cls.risk === 'high')
  ? '⚠ ТРЕБУЕТСЯ РАЗБОР: обнаружены компоненты с высоким риском (см. таблицу). Для реестра ОП их следует заменить или обосновать.'
  : '✅ Разрешительные лицензии: препятствий для регистрации в реестре ОП не выявлено.';

const today = new Date().toISOString().slice(0, 10);
let md = `# Отчёт по лицензиям сторонних компонентов

| Параметр | Значение |
|---|---|
| Дата формирования | ${today} |
| Источник | sbom/*.cdx.json (CycloneDX 1.5, сгенерированы cyclonedx-npm из package-lock) |
| Компонентов всего | ${all.length} (уникальных name@version) |
| Пакеты | ${[...new Set(all.flatMap((p) => p.apps))].join(', ')} |

## Сводный вердикт для реестра отечественного ПО

${verdict}

Критерий: сторонние компоненты должны быть под разрешительными лицензиями (MIT, Apache-2.0, BSD и т.п.),
не обязывающими раскрывать исходный код регистрируемого ПО и не conflicting с типовыми условиями
использования при включении в реестр (постановление Правительства РФ № 1236).

## Сводка по лицензиям

| Лицензия | Класс | Риск | Компонентов |
|---|---|---|---|
${licEntries.map((l) => `| ${l.id} | ${l.cls.kind} | ${l.cls.risk} | ${l.comps.length} |`).join('\n')}

## Детальный перечень

| # | Компонент | Версия | Лицензии | Пакет | Класс / примечание |
|---|---|---|---|---|---|
${all.map((p, i) => {
    const worst = p.licenses.map(classify).sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk])[0];
    return `| ${i + 1} | ${p.name} | ${p.version} | ${p.licenses.join(', ')}${p.manual ? ' *' : ''} | ${p.apps.join('+')} | ${worst.kind} (${worst.risk}) |`;
  }).join('\n')}

\* Лицензия установлена по тексту LICENSE-файла пакета (поле license в манифесте не заполнено) — ручная верификация при обновлении версии.

## Требующие внимания

${licEntries.filter((l) => l.cls.risk !== 'low').map((l) => `### ${l.id} — ${l.comps.length} шт.

${l.cls.note}

${l.comps.map((c) => `- ${c.name}@${c.version} (${c.apps.join('+')})`).join('\n')}
`).join('\n') || 'Нет компонентов со средним или высоким риском.'}

## Порядок поддержания

1. SBOM регенерируется при каждом изменении зависимостей: \`make sbom\` (или в CI).
2. Этот отчёт пересоздаётся автоматически: \`node scripts/license-report.mjs\`.
3. Новая зависимость с copyleft/unknown-лицензией — блокер слияния (CI подсвечивает раздел «Требующие внимания»).
`;
md = md.replace('con conflicting', 'не конфликтующими');

const out = join(outDir, 'licenses-report.md');
writeFileSync(out, md);
console.log(`Отчёт: ${out}`);
console.log(`Компонентов: ${all.length}; лицензий: ${licEntries.length}; вердикт: ${verdict.split(':')[0]}`);
const risky = licEntries.filter((x) => x.cls.risk !== 'low');
for (const l of risky) {
  console.log(`  внимание [${l.cls.risk}] ${l.id}: ${l.comps.slice(0, 6).map((c) => c.name).join(', ')}${l.comps.length > 6 ? ` …(+${l.comps.length - 6})` : ''}`);
}
// Политика (docs/specs/11-sbom-licenses.md): средний/высокий риск или неопределённые — блокер
if (risky.length) process.exit(1);
