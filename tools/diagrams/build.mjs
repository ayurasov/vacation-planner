// Рендер всех .mmd из src/ в SVG (+PNG) docs/specs/diagrams/.
// Ключевые требования отображения (уроки v0.2.0):
//  1. htmlLabels: false — подписи как SVG <text>: Gitea/GitHub не вырезают их из SVG
//     (foreignObject санитизируется и диаграммы выглядят «пустыми»).
//  2. Крупные шрифты, увеличенные отступы, фиксированная ширина — читаемо в доке и PDF.
import { readdirSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');
const outDir = resolve(here, '../../docs/specs/diagrams');
mkdirSync(outDir, { recursive: true });

// Палитра примера: персоны #08427B, наша система #438DD5/#E8F1FA, внешние #999999,
// хранилища #F5E29B, информационные #FFF8DC.
const FONT = "-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const theme = {
  theme: 'base',
  themeVariables: {
    fontFamily: FONT,
    fontSize: '15px',
    // ноды
    primaryColor: '#E8F1FA',
    primaryBorderColor: '#438DD5',
    primaryTextColor: '#1F1F1F',
    // кластеры
    clusterBkg: '#F8F9FB',
    clusterBorder: '#B9C4DD',
    // линии и текст
    lineColor: '#4A4A4A',
    edgeLabelBackground: '#ffffff',
    // sequence
    actorBkg: '#E8F1FA',
    actorBorder: '#438DD5',
    actorTextColor: '#1F1F1F',
    actorLineColor: '#8C8C8C',
    signalColor: '#333333',
    signalTextColor: '#333333',
    labelBoxBkgColor: '#E8F1FA',
    labelBoxBorderColor: '#438DD5',
    labelTextColor: '#1F1F1F',
    loopTextColor: '#1F1F1F',
    noteBkgColor: '#FFF8DC',
    noteBorderColor: '#D9C27A',
    noteTextColor: '#333333',
    activationBkgColor: '#dde8f5',
    // state
    attributeBackgroundColorOdd: '#ffffff',
    attributeBackgroundColorEven: '#f6f8fb',
  },
  flowchart: { htmlLabels: false, curve: 'basis', nodeSpacing: 55, rankSpacing: 65, padding: 14 },
  sequence: { useMaxWidth: false, mirrorActors: false, wrap: false, boxMargin: 12, noteMargin: 10, messageMargin: 42, actorMargin: 60, width: 200 },
  gantt: { useMaxWidth: false },
  er: { useMaxWidth: false, fontSize: 13 },
  state: { useMaxWidth: false, padding: 12 },
};

const tmp = mkdtempSync(join(tmpdir(), 'vp-diagrams-'));
const themeFile = join(tmp, 'theme.json');
writeFileSync(themeFile, JSON.stringify(theme));
const puppeteerConfig = join(here, 'puppeteer.json');
const mmdc = join(here, 'node_modules', '.bin', 'mmdc');

// Ширина подбирается под тип: ER и sequence шире
const WIDTHS = { '04-er-model': 1500 };
const files = readdirSync(srcDir).filter((f) => f.endsWith('.mmd'));
for (const f of files) {
  const name = basename(f, '.mmd');
  const width = WIDTHS[name] ?? 1250;
  for (const ext of ['svg', 'png']) {
    execFileSync(mmdc, [
      '-i', join(srcDir, f),
      '-o', join(outDir, `${name}.${ext}`),
      '-b', 'white',
      '-w', String(width),
      '-H', '900',
      '-c', themeFile,
      '-p', puppeteerConfig,
      ...(ext === 'png' ? ['--scale', '2'] : []),
    ], { stdio: 'pipe' });
  }
  console.log('rendered', name, '→ svg+png');
}
console.log(`Готово: ${files.length} схем в ${outDir}`);
