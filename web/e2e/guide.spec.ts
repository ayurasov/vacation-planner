// e2e руководства внутри приложения (v1.1.0, E71): пункт меню, оглавление, поиск, ссылки на главы,
// увеличение рисунков, знаки «?» на экранах, PDF и узкий экран. Один вход на файл — как в smoke.spec.ts.
// Кадровая служба: видит и руководство пользователя, и руководство администратора.
import { expect, test, type Page } from '@playwright/test';
import { HR, login } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;
const cspViolations: string[] = [];

const hash = () => decodeURIComponent(new URL(page.url()).hash);
const toc = () => page.getByRole('navigation', { name: 'Содержание руководства' });
const chapter = (name: string) => page.locator('.guide-content').getByRole('heading', { name, exact: true });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
  await login(page, HR);
});

test.afterAll(async () => {
  await page.close();
});

test('меню: «Руководство пользователя» над «Настройками» открывает руководство с оглавлением', async () => {
  const items = page.locator('.sidebar-bottom .nav-item');
  await expect(items.nth(0)).toHaveText('Руководство пользователя');
  await expect(items.nth(1)).toHaveText('Настройки');

  // Свёрнутое меню: подпись пункта — во всплывающей подсказке
  await page.getByRole('button', { name: 'Свернуть меню' }).click();
  await expect(items.nth(0)).toHaveAttribute('title', 'Руководство пользователя');
  await page.getByRole('button', { name: 'Развернуть меню' }).click();

  await items.nth(0).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Руководство пользователя' })).toBeVisible();
  await expect(page.locator('.view-subtitle')).toHaveText(/^Версия \d+\.\d+\.\d+ · Сотрудник и руководитель$/);
  await expect(toc().getByRole('link', { name: 'График отпусков', exact: true })).toBeVisible();
  await expect(toc().getByRole('link', { name: 'Руководство в приложении', exact: true })).toBeVisible();
  await expect(chapter('О руководстве')).toBeVisible();
  await expect(toc().locator('li.active')).toHaveText('О руководстве');
});

test('поиск оставляет разделы с искомыми словами; без совпадений — «Ничего не найдено»', async () => {
  const links = toc().getByRole('link');
  const all = await links.count();
  const search = page.getByLabel('Найти в руководстве');

  await search.fill('Эскалация');
  await expect(toc().getByRole('link', { name: 'Согласование заявок (руководителям)' })).toBeVisible();
  await expect(toc().getByRole('link', { name: 'Вход в систему' })).toHaveCount(0);
  expect(await links.count()).toBeLessThan(all);

  // Совпадение в тексте подраздела: подсказка — глава, в которую он входит
  await search.fill('лучшие даты');
  await expect(toc().getByRole('link', { name: /Подбор лучших дат/ })).toContainText('Мой отпуск');

  await search.fill('несуществующее слово');
  await expect(toc().getByText('Ничего не найдено')).toBeVisible();
  await expect(links).toHaveCount(0);

  await search.fill('');
  await expect(links).toHaveCount(all);
});

test('ссылка на главу /guide#… открывает её; щелчок в оглавлении меняет адрес', async () => {
  await page.goto('/guide#подбор-лучших-дат');
  await expect(chapter('Подбор лучших дат')).toBeInViewport();
  await expect(toc().locator('li.active')).toHaveText('Подбор лучших дат');

  await toc().getByRole('link', { name: 'График работы', exact: true }).click();
  await expect.poll(hash).toBe('#график-работы');
  await expect(chapter('График работы')).toBeInViewport();
  await expect(toc().locator('li.active')).toHaveText('График работы');
});

test('рисунок открывается крупно и закрывается Esc, фокус возвращается', async () => {
  const figure = page.getByRole('button', { name: 'Увеличить рисунок: График работы' });
  await figure.click();
  const dialog = page.getByRole('dialog', { name: 'График работы' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Закрыть' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(figure).toBeFocused();

  await figure.click();
  await dialog.click({ position: { x: 10, y: 10 } });
  await expect(dialog).toBeHidden();
});

test('«?» на графике отпусков открывает главу «График отпусков»', async () => {
  await page.goto('/schedule');
  await page.getByRole('link', { name: 'Справка: График отпусков' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Руководство пользователя' })).toBeVisible();
  await expect.poll(hash).toBe('#график-отпусков');
  await expect(chapter('График отпусков')).toBeInViewport();
});

test('«?» в «Кадровом учёте» ведёт в руководство администратора; из него — обратно', async () => {
  await page.goto('/hr');
  await page.getByRole('link', { name: 'Справка: Планирование и утверждение графика' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Руководство администратора' })).toBeVisible();
  await expect.poll(hash).toBe('#планирование-и-утверждение-графика');
  await expect(chapter('Планирование и утверждение графика')).toBeInViewport();

  await page.locator('.guide-actions').getByRole('link', { name: 'Руководство пользователя' }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(chapter('О руководстве')).toBeInViewport();
});

test('PDF: «Открыть PDF» — в новой вкладке, «Скачать PDF» — файл с именем латиницей', async () => {
  const open = page.getByRole('link', { name: 'Открыть PDF' });
  await expect(open).toHaveAttribute('target', '_blank');
  const href = await open.getAttribute('href');
  expect(href).toMatch(/^\/assets\/user-guide-[\w-]+\.pdf$/);
  const response = await page.request.get(href as string);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');

  const download = page.waitForEvent('download');
  await page.getByTestId('guide-download').click();
  expect((await download).suggestedFilename()).toMatch(/^planirovshchik-otpuskov-\d+\.\d+\.\d+-rukovodstvo-polzovatelya\.pdf$/);
});

test('узкий экран: оглавление — список «Перейти к разделу»', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await expect(toc()).toBeHidden();
    await page.getByLabel('Перейти к разделу').selectOption({ label: 'Команда' });
    await expect.poll(hash).toBe('#команда');
    await expect(chapter('Команда')).toBeInViewport();
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test('CSP стенда не нарушается на страницах руководства', async () => {
  expect(cspViolations).toEqual([]);
});
