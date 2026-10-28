// Рендер схем docs/diagrams в PNG (docs/images/):
// *.mmd — Mermaid в фирменной палитре, *.html — послойные схемы на HTML/CSS (снимается блок .wrap).
//
//   cd tools/docs && npm ci && node render_diagrams.mjs [имя ...]
//
// PNG выбран сознательно: одинаковый вид в Gitea, GitHub, PDF и DOCX (SVG с HTML-подписями
// санитайзеры репозиториев показывают пустыми). Mermaid и Playwright — devDependencies tools/docs.
import { chromium } from 'playwright'
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..', '..')
const src = join(root, 'docs', 'diagrams')
const out = join(root, 'docs', 'images')
const mermaidJs = process.env.MERMAID_JS || join(import.meta.dirname, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')
if (!existsSync(mermaidJs)) {
  console.error(`Не найден Mermaid: ${mermaidJs}. Выполните npm ci в tools/docs или укажите MERMAID_JS.`)
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const config = {
  startOnLoad: false,
  theme: 'base',
  fontFamily: 'Inter, Arial, sans-serif',
  themeVariables: {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: '15px',
    primaryColor: '#f2f5ff',
    primaryBorderColor: '#4f7cff',
    primaryTextColor: '#1d2433',
    secondaryColor: '#effaf4',
    tertiaryColor: '#fafbfe',
    lineColor: '#5b6b8c',
    clusterBkg: '#fafbfe',
    clusterBorder: '#c7cfdf',
    actorBkg: '#f2f5ff',
    actorBorder: '#4f7cff',
    noteBkgColor: '#fff8ec',
    noteBorderColor: '#e8a13a',
    signalColor: '#1d2433',
    labelBoxBkgColor: '#f2f5ff',
    labelBoxBorderColor: '#4f7cff',
    activationBkgColor: '#e3e9ff',
    activationBorderColor: '#4f7cff',
  },
  flowchart: { htmlLabels: true, curve: 'basis', padding: 14, nodeSpacing: 40, rankSpacing: 55, wrappingWidth: 420 },
  sequence: { mirrorActors: false, messageMargin: 34, boxMargin: 8, noteMargin: 8, actorMargin: 60, wrap: true, width: 170 },
  er: { layoutDirection: 'TB', minEntityWidth: 120, fontSize: 13 },
  state: { padding: 10 },
}

const names = process.argv.slice(2)
const files = readdirSync(src).filter((f) => f.endsWith('.mmd')).filter((f) => !names.length || names.includes(basename(f, '.mmd')))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 })
await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><div id="d" style="display:inline-block;padding:16px;background:#fff"></div></body>')
await page.addScriptTag({ path: mermaidJs })
await page.evaluate((cfg) => window.mermaid.initialize(cfg), config)
for (const file of files) {
  const name = basename(file, '.mmd')
  const text = readFileSync(join(src, file), 'utf8')
  const ok = await page.evaluate(async ({ text, name }) => {
    const box = document.getElementById('d')
    try {
      const { svg } = await window.mermaid.render(`m-${name}`, text)
      box.innerHTML = svg
      const el = box.querySelector('svg')
      // Ширина по содержимому, но не больше полосы набора; широкие ER-схемы — крупнее
      const vb = el.viewBox.baseVal
      const width = Math.min(vb.width, name.startsWith('er-') ? 1700 : 1100)
      el.style.maxWidth = 'none'
      el.setAttribute('width', String(width))
      el.setAttribute('height', String((vb.height * width) / vb.width))
      return true
    } catch (e) {
      box.textContent = String(e)
      return String(e)
    }
  }, { text, name })
  if (ok !== true) {
    console.error(`${name}: ${ok}`)
    process.exitCode = 1
    continue
  }
  await page.locator('#d').screenshot({ path: join(out, `${name}.png`) })
  console.log(`  ${name}.png`)
}
const htmlFiles = readdirSync(src).filter((f) => f.endsWith('.html')).filter((f) => !names.length || names.includes(basename(f, '.html')))
const htmlPage = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 })
for (const file of htmlFiles) {
  await htmlPage.goto(pathToFileURL(join(src, file)).href)
  await htmlPage.waitForLoadState('networkidle')
  await htmlPage.locator('.wrap').screenshot({ path: join(out, `${basename(file, '.html')}.png`) })
  console.log(`  ${basename(file, '.html')}.png`)
}
await browser.close()
