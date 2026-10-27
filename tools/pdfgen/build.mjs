// Генерация PDF комплекта документов: docs/specs/*.md + версии → docs/pdf/*.pdf.
// Chromium скачивается puppeteer при установке (userspace, без sudo).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import puppeteer from 'puppeteer';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const specsDir = join(root, 'docs', 'specs');
const pdfDir = join(root, 'docs', 'pdf');
mkdirSync(pdfDir, { recursive: true });

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, 'Segoe UI', Roboto, 'Inter', 'Helvetica Neue', Arial, sans-serif;
       font-size: 10.5pt; line-height: 1.5; color: #1c2331; }
h1 { font-size: 17pt; color: #1c2331; border-bottom: 2.5px solid #4f7cff; padding-bottom: 6px; margin: 0 0 10px; }
h2 { font-size: 13pt; margin-top: 20px; border-left: 3.5px solid #4f7cff; padding-left: 8px; }
h3 { font-size: 11.5pt; margin-top: 14px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9pt; }
th { background: #eef1f7; text-align: left; }
th, td { border: 1px solid #d9dde8; padding: 4px 7px; vertical-align: top; }
tr:nth-child(even) td { background: #fafbfe; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8.7pt;
       background: #eef1f7; border-radius: 3px; padding: 1px 4px; }
pre { background: #f4f6fa; border: 1px solid #e3e6ee; border-radius: 6px; padding: 9px 12px; overflow-x: auto; }
pre code { background: none; font-size: 8.2pt; line-height: 1.42; }
blockquote { border-left: 3px solid #b9c4dd; margin: 8px 0; padding: 2px 12px; color: #4b5563; }
a { color: #3860e0; text-decoration: none; }
hr { border: none; border-top: 1px solid #e3e6ee; margin: 14px 0; }
.page-break { page-break-before: always; }
footer-pdf { display: none; }
`;

function render(md) {
  const html = marked.parse(md, { gfm: true, breaks: false });
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>${html}</body></html>`;
}

const sources = [];
for (const f of readdirSync(specsDir).filter((x) => x.endsWith('.md')).sort()) {
  sources.push({ file: f, md: readFileSync(join(specsDir, f), 'utf-8') });
}
sources.push({ file: 'versions.md', md: readFileSync(join(root, 'docs', 'versions.md'), 'utf-8') });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
});
try {
  const page = await browser.newPage();
  for (const src of sources) {
    await page.setContent(render(src.md), { waitUntil: 'load', timeout: 60000 });
    const out = join(pdfDir, basename(src.file, '.md') + '.pdf');
    await page.pdf({
      path: out,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-family:Arial;font-size:7.5pt;color:#8a93a5;width:100%;text-align:center;">
        ${basename(src.file, '.md')} · Планировщик отпусков · <span class="pageNumber"></span>/<span class="totalPages"></span>
      </div>`,
    });
    console.log('PDF:', basename(out));
  }
} finally {
  await browser.close();
}
console.log(`Готово: ${sources.length} PDF в ${pdfDir}`);
