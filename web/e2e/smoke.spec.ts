// e2e интерфейса: ключевые сценарии сотрудника, руководителя и администратора.
// Одна страница и один вход на весь прогон: вход ограничен 10 попытками в минуту с адреса,
// а refresh-токен ротируется — общий storageState между контекстами не работает.
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, login, nextYear } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;
const cspViolations: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
});

test.afterAll(async () => {
  await page.close();
});

test('вход: неверный пароль — понятная ошибка, верный — график', async () => {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(ADMIN.login);
  await page.getByLabel('Пароль', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toContainText('Неверный логин или пароль');
  await login(page);
});

test('график: отделы, масштаб и сравнение сотрудников', async () => {
  await expect(page.locator('.g-group').first()).toBeVisible();
  await page.getByRole('button', { name: 'Месяц' }).click();
  await expect(page.locator('.g-day small').first()).toBeVisible(); // дни недели в крупном масштабе
  const rows = page.locator('.g-row');
  await rows.nth(0).hover();
  await rows.nth(0).locator('.g-pick').click();
  await rows.nth(1).hover();
  await rows.nth(1).locator('.g-pick').click();
  await expect(page.locator('.compare')).toContainText('Сравнение');
});

test('заявка: подбор дат, отправка, согласование, удаление', async () => {
  await page.goto('/my');
  await page.getByRole('button', { name: 'Запланировать отпуск' }).click();

  // Подбор дат возвращает варианты с объяснением
  await page.getByRole('button', { name: 'Подобрать лучшие даты' }).click();
  await expect(page.locator('.option').first()).toBeVisible({ timeout: 15000 });

  // Конкретные даты следующего года — детерминированно
  await page.getByLabel('Первый день').fill(nextYear('08-03'));
  await page.getByLabel('Последний день').fill(nextYear('08-07'));
  await expect(page.locator('.preview')).toContainText('5');
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.locator('.toast')).toContainText('Заявка отправлена');

  // Администратор согласует в очереди всей организации
  await page.goto('/approvals');
  const card = page.locator('article.request', { hasText: ADMIN.name }).filter({ hasText: '3–7 августа' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Согласовать' }).click();
  await expect(page.locator('.toast').last()).toContainText('Согласовано');

  // Уборка: запрос удаления и его согласование
  await page.goto('/my');
  await page.locator('.year-switch').getByRole('button', { name: 'Следующий год' }).click();
  const row = page.locator('.period', { hasText: '3–7 августа' });
  await expect(row).toContainText('согласован');
  await row.getByRole('button', { name: 'Запросить удаление' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Запросить удаление' }).click();
  await page.goto('/approvals');
  await page.locator('article.request', { hasText: '3–7 августа' }).getByRole('button', { name: 'Согласовать удаление' }).click();
  await expect(page.locator('.toast').last()).toContainText('Удаление отпуска согласовано');
});

test('команда: статус на сегодня и аналитика года с графиком', async () => {
  await page.goto('/team');
  await expect(page.locator('.status-tile').first()).toBeVisible();
  await page.getByRole('button', { name: 'Аналитика года' }).click();
  await expect(page.getByRole('img', { name: 'Доля отдела в отпуске по месяцам' })).toBeVisible();
  await expect(page.locator('.insight').first()).toBeVisible();
});

test('график работы: шаблон меняется и сохраняется', async () => {
  await page.goto('/work-schedule');
  const monday = page.locator('.day-btn').first();
  const before = (await monday.getAttribute('class')) ?? '';
  // Полный цикл из трёх нажатий возвращает исходный режим — тест не меняет данные
  await monday.click();
  await expect(monday).not.toHaveAttribute('class', before);
  await monday.click();
  await monday.click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.toast')).toContainText('Недельный график сохранён');
});

test('CSP стенда не нарушается ни на одном экране', async () => {
  for (const path of ['/schedule', '/my', '/approvals', '/employees', '/directories', '/settings', '/audit']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(cspViolations).toEqual([]);
});
