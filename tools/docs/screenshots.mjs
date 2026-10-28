// Снимки экрана для руководств (docs/images/ui-*.png) с работающего стенда.
//   node screenshots.mjs [baseURL]   — по умолчанию http://127.0.0.1:4173 (vite preview + API с демо-данными)
// Вход — демо-администратор (README). Снимки делаются в светлой теме, отдельные — в тёмной и на телефоне.
import { chromium } from 'playwright'
import { join, resolve } from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:4173'
const out = resolve(import.meta.dirname, '..', '..', 'docs', 'images')
const LOGIN = { login: 'yurasov.av', password: 'j2ENXpPi' }

const browser = await chromium.launch()

async function session(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'ru-RU', ...opts })
  await page.goto(`${base}/login`)
  await page.waitForTimeout(400)
  return page
}

async function login(page) {
  await page.fill('#login', LOGIN.login)
  await page.fill('#password', LOGIN.password)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.g-row', { timeout: 15000 })
  await page.waitForTimeout(500)
}

const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: join(out, `ui-${name}.png`), ...opts })
  console.log(`  ui-${name}.png`)
}
const go = async (page, path) => { await page.goto(`${base}${path}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(600) }

// ── Светлая тема, рабочий стол
const page = await session({ colorScheme: 'light' })
await shot(page, 'login')
await login(page)
await shot(page, 'schedule')
await page.getByRole('button', { name: 'Месяц' }).click()
await page.waitForTimeout(500)
const rows = page.locator('.g-row')
for (const i of [3, 4]) { await rows.nth(i).hover(); await rows.nth(i).locator('.g-pick').click() }
await page.waitForTimeout(300)
await shot(page, 'schedule-compare')
await page.getByRole('button', { name: 'Квартал' }).click()

await go(page, '/my')
await shot(page, 'my')
await page.getByRole('button', { name: 'Запланировать отпуск' }).click()
await page.getByRole('button', { name: 'Подобрать лучшие даты' }).click()
await page.waitForSelector('.option', { timeout: 15000 })
await page.waitForTimeout(400)
await shot(page, 'request-suggest')
await page.locator('.option').first().click()
await page.waitForTimeout(300)
await shot(page, 'request-form')
await page.keyboard.press('Escape')

await go(page, '/approvals')
await shot(page, 'approvals')
await go(page, '/team')
await shot(page, 'team-today')
await page.getByRole('button', { name: 'Аналитика года' }).click()
await page.waitForSelector('.insight')
await page.waitForTimeout(500)
await shot(page, 'team-year')
await go(page, '/work-schedule')
await shot(page, 'work-schedule')
await go(page, '/employees')
await shot(page, 'employees')
await go(page, '/directories')
await page.getByRole('button', { name: 'Производственный календарь' }).click()
await page.waitForTimeout(400)
await shot(page, 'calendar')
await go(page, '/settings')
await shot(page, 'settings')
await go(page, '/audit')
await shot(page, 'audit')
await page.close()

// ── Тёмная тема
const dark = await session({ colorScheme: 'dark' })
await login(dark)
await shot(dark, 'schedule-dark')
await dark.close()

// ── Телефон
const phone = await session({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', isMobile: true, hasTouch: true })
await login(phone)
await go(phone, '/my')
await shot(phone, 'mobile-my')
await phone.close()

await browser.close()
