// Рендер всех .mmd из src/ в SVG (+PNG) docs/specs/diagrams/.
// Стилистика «как в примере»: системы #438DD5/#E8F1FA, внешние серые, хранилища жёлтые.
import { readdirSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');
const outDir = resolve(here, '../../docs/specs/diagrams');
mkdirSync(outDir, { recursive: true });

const theme = {
  theme: 'base',
  themeVariables: {
    primaryColor: '#E8F1FA',
    primaryBorderColor: '#438DD5',
    primaryTextColor: '#1F1F1F',
    lineColor: '#4A4A4A',
    fontSize: '14px',
    fontFamily: '-apple-system, Segoe UI, Roboto, Arial, sans-serif',
    clusterBkg: '#F8F9FB',
    clusterBorder: '#B9C4DD',
    actorBkg: '#08427B',
    actorBorder: '#052E56',
    actorTextColor: '#ffffff',
    signalColor: '#333333',
    signalTextColor: '#333333',
    noteBkgColor: '#FFF8DC',
    noteBorderColor: '#D9C27A',
  },
  flowchart: { curve: 'basis', htmlLabels: true },
  sequence: { useMaxWidth: true, mirrorActors: false },
};

const tmp = mkdtempSync(join(tmpdir(), 'vp-diagrams-'));
const themeFile = join(tmp, 'theme.json');
writeFileSync(themeFile, JSON.stringify(theme));
const puppeteerConfig = join(here, 'puppeteer.json');
const mmdc = join(here, 'node_modules', '.bin', 'mmdc');

const files = readdirSync(srcDir).filter((f) => f.endsWith('.mmd'));
for (const f of files) {
  const name = basename(f, '.mmd');
  for (const ext of ['svg', 'png']) {
    execFileSync(mmdc, [
      '-i', join(srcDir, f),
      '-o', join(outDir, `${name}.${ext}`),
      '-b', 'white',
      '-c', themeFile,
      '-p', puppeteerConfig,
      ...(ext === 'png' ? ['--scale', '2'] : []),
    ], { stdio: 'pipe' });
  }
  console.log('rendered', name, '→ svg+png');
}
console.log(`Готово: ${files.length} схем в ${outDir}`);
