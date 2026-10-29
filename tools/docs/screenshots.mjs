// Снимки экрана для руководств (docs/images/ui-*.png) с работающего стенда.
//   node screenshots.mjs [baseURL]   — по умолчанию http://127.0.0.1:4173 (vite preview + API с демо-данными)
// API стенда — с JOBS_POLL_SECONDS=3: снимок извещения ждёт плановую задачу.
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

// ── Экран входа с единым входом: ответ настроек подменяется, провайдер не нужен
const sso = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'ru-RU', colorScheme: 'light' })
await sso.route('**/api/v1/auth/oidc/config', (r) => r.fulfill({ json: { enabled: true, label: 'корпоративную учётную запись', localLogin: true } }))
await sso.goto(`${base}/login`)
await sso.waitForSelector('text=Войти через')
await shot(sso, 'login-sso')
await sso.close()

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
// Импорт: предпросмотр файла с изменением, новым сотрудником и ошибкой — без применения
await page.getByRole('button', { name: 'Импорт' }).click()
await page.locator('.dropzone input[type=file]').setInputFiles({
  name: 'sotrudniki.csv', mimeType: 'text/csv',
  buffer: Buffer.from([
    'ФИО;Логин;Должность;Отдел;Руководитель;Норма дней;Перенос;Тип занятости;Email',
    'Балашова Анастасия Владимировна;balashova.av;;;;;5;;balashova@example.ru',
    'Новикова Ольга Игоревна;;Аналитик;Служба персонала;balashova.av;28;0;штат;novikova@example.ru',
    'Петров;;;;;много;;;',
  ].join('\n')),
})
await page.waitForSelector('.summary')
await page.waitForTimeout(300)
await shot(page, 'import')
await page.getByRole('button', { name: 'Отмена' }).click()
await go(page, '/directories')
await page.getByRole('button', { name: 'Производственный календарь' }).click()
await page.waitForTimeout(400)
await shot(page, 'calendar')
await page.getByRole('button', { name: 'Изменить' }).click()
await page.waitForTimeout(300)
await shot(page, 'calendar-edit')
await page.getByRole('button', { name: 'Отмена' }).click()
await go(page, '/settings')
await shot(page, 'settings')
await page.locator('[aria-labelledby="sessions-title"]').screenshot({ path: join(out, 'ui-settings-sessions.png') })
console.log('  ui-settings-sessions.png')
await go(page, '/audit')
await shot(page, 'audit')
await page.getByRole('button', { name: 'Входы' }).click()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(500)
await shot(page, 'audit-logins')

// ── Кадровый учёт (v0.6.0): кампания следующего года открывается, если график ещё не утверждён
const api = page.request
const token = (await (await api.post(`${base}/api/v1/auth/login`, { data: LOGIN })).json()).accessToken
const headers = { Authorization: `Bearer ${token}` }
const year = new Date().getFullYear() + 1
const iso = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
await api.post(`${base}/api/v1/planning/${year}/open`, { headers, data: { deadline: iso(25) } })
await go(page, '/hr')
await page.getByRole('button', { name: String(year), exact: true }).click()
await page.waitForTimeout(600)
await page.locator('.link-btn').nth(2).click()
await page.waitForTimeout(600)
await shot(page, 'hr-planning')
await go(page, '/hr?tab=notices')
await shot(page, 'hr-notices')

// ── Первый вход нового сотрудника, извещение и приглашение в «Моём отпуске»
const newbie = { login: `docs.shot${Date.now() % 10000}`, password: 'Ym3-copper-dawn', fresh: 'Vb5-silent-harbor' }
const created = await (await api.post(`${base}/api/v1/employees`, { headers, data: { name: 'Новикова Ольга Сергеевна', login: newbie.login, password: newbie.password, position: 'Экономист' } })).json()
await api.post(`${base}/api/v1/vacation-requests`, { headers, data: { employee: created.employee.id, start: iso(9), end: iso(15) } })
const first = await session({ colorScheme: 'light' })
await first.fill('#login', newbie.login)
await first.fill('#password', newbie.password)
await first.keyboard.press('Enter')
await first.waitForURL(/change-password/)
await first.waitForTimeout(500)
await shot(first, 'change-password')
await first.getByLabel('Пароль от кадровой службы').fill(newbie.password)
await first.getByLabel('Новый пароль', { exact: true }).fill(newbie.fresh)
await first.getByLabel('Повторите новый пароль').fill(newbie.fresh)
await first.getByRole('button', { name: 'Сохранить пароль' }).click()
await first.waitForURL(/login/)
await first.fill('#login', newbie.login)
await first.fill('#password', newbie.fresh)
await first.keyboard.press('Enter')
await first.waitForSelector('.g-row', { timeout: 15000 })
// Извещение отправляет плановая задача сервера (стенд документации — JOBS_POLL_SECONDS=3)
for (let i = 0; i < 20; i++) {
  await go(first, '/my')
  if (await first.locator('.notice-card').count()) break
  await first.waitForTimeout(1000)
}
await shot(first, 'my-notice')
await first.locator('.planning-card').screenshot({ path: join(out, 'ui-my-planning.png') })
console.log('  ui-my-planning.png')
await first.close()
await api.delete(`${base}/api/v1/employees/${created.employee.id}`, { headers })
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
