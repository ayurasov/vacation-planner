#!/usr/bin/env node
// Копия руководств для чтения внутри приложения (v1.1.0, E71).
//
// Образ web собирается с контекстом ./web (web/Dockerfile, docker-compose.yml): файлы из ../docs
// в сборку не попадают. Поэтому руководства (docs/manuals/*.md), их рисунки (docs/images) и PDF
// (docs/pdf) копируются в web/src/guide/content и коммитятся вместе с кодом; размеры рисунков
// пишутся в images.json — по ним браузер заранее резервирует место и переход к разделу не «уезжает»
// при загрузке картинок. Устаревшую копию ловит тест web/src/guide/sync.spec.ts.
//
//   npm run guide:sync           — обновить копию после правки руководства или пересборки PDF
//   node scripts/sync-guide.mjs --check — только проверить (код выхода 1 при расхождении)
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(WEB, '..');
const DOCS = join(ROOT, 'docs');
const IMAGES = join(DOCS, 'images');

/** Каталог копии внутри клиента. */
export const CONTENT = join(WEB, 'src', 'guide', 'content');
/** Руководства, которые читаются в приложении: docs/manuals/<имя>.md и docs/pdf/<имя>.pdf. */
export const GUIDE_NAMES = ['user-guide', 'admin-guide'];
const MANIFEST = join(CONTENT, 'images.json');

const IMAGE_REF = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Пути рисунков, на которые ссылается Markdown, без повторов и в порядке появления. */
export function referencedImages(markdown) {
  return [...new Set([...markdown.matchAll(IMAGE_REF)].map((m) => m[1]))];
}

/** Ширина и высота PNG из заголовка IHDR; для других форматов — null. */
export function pngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** Что и куда копируется: [{ source, target }] и размеры рисунков. */
export function plan() {
  const files = [];
  const images = new Map();
  for (const name of GUIDE_NAMES) {
    const markdown = join(DOCS, 'manuals', `${name}.md`);
    files.push({ source: markdown, target: join(CONTENT, `${name}.md`) });
    files.push({ source: join(DOCS, 'pdf', `${name}.pdf`), target: join(CONTENT, `${name}.pdf`) });
    for (const src of referencedImages(readFileSync(markdown, 'utf8'))) {
      const path = /^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('/') ? null : resolve(dirname(markdown), src);
      if (!path || !path.startsWith(IMAGES + sep) || !existsSync(path)) {
        throw new Error(`docs/manuals/${name}.md: рисунок «${src}» не найден в docs/images`);
      }
      images.set(basename(path), path);
    }
  }
  const sizes = {};
  for (const [file, path] of [...images].sort(([a], [b]) => a.localeCompare(b))) {
    files.push({ source: path, target: join(CONTENT, 'images', file) });
    const size = pngSize(path);
    if (size) sizes[file] = size;
  }
  return { files, sizes };
}

// Рисунок на строку: { "ui-login.png": [ширина, высота], … }
const manifestText = (sizes) => `{\n${Object.entries(sizes).map(([file, [w, h]]) => `  ${JSON.stringify(file)}: [${w}, ${h}]`).join(',\n')}\n}\n`;
const rel = (path) => relative(ROOT, path).split(sep).join('/');

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

/** Расхождения копии с docs/: пустой список — копия актуальна. */
export function check() {
  const { files, sizes } = plan();
  const problems = [];
  for (const { source, target } of files) {
    if (!existsSync(target)) problems.push(`нет ${rel(target)}`);
    else if (!readFileSync(source).equals(readFileSync(target))) problems.push(`${rel(target)} отличается от ${rel(source)}`);
  }
  if (!existsSync(MANIFEST) || readFileSync(MANIFEST, 'utf8') !== manifestText(sizes)) problems.push(`${rel(MANIFEST)} устарел`);
  const expected = new Set([...files.map((f) => f.target), MANIFEST]);
  for (const file of listFiles(CONTENT)) if (!expected.has(file)) problems.push(`лишний файл ${rel(file)}`);
  return problems;
}

/** Пересоздаёт копию целиком: удалённые из руководства рисунки не остаются в сборке. */
export function sync() {
  const { files, sizes } = plan();
  rmSync(CONTENT, { recursive: true, force: true });
  for (const { source, target } of files) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  writeFileSync(MANIFEST, manifestText(sizes));
  return files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = check();
    for (const problem of problems) console.error(`  ${problem}`);
    if (problems.length) {
      console.error('Копия руководств устарела — выполните npm run guide:sync');
      process.exit(1);
    }
    console.log('Копия руководств совпадает с docs/');
  } else {
    const count = sync();
    console.log(`Руководства скопированы в ${rel(CONTENT)}: файлов — ${count + 1}`);
  }
}
