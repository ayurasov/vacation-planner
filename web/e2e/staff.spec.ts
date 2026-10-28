// e2e кадровой службы: свой раздел меню, производственный календарь, защита учётных записей.
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, HR, login } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;
const year = new Date().getFullYear() + 1;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, HR);
});

test.afterAll(async () => {
  await page.close();
});

test('кадровая служба: свой раздел меню, без правил организации', async () => {
  const menu = page.getByRole('complementary', { name: 'Главное меню' });
  await expect(menu.getByText('Кадровая служба')).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Сотрудники' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Журнал аудита' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText('Правила организации')).toHaveCount(0);
});

test('учётную запись администратора кадровая служба не меняет', async () => {
  await page.goto('/employees');
  await page.getByPlaceholder('ФИО или должность').fill(ADMIN.name.split(' ')[0]);
  const row = page.getByRole('row', { name: new RegExp(ADMIN.name.split(' ')[0]) });
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
});

test('производственный календарь: отметить праздник, сохранить и вернуть', async () => {
  await page.goto('/directories');
  await page.getByRole('button', { name: /Производственный календарь/ }).click();
  await page.getByRole('button', { name: 'Следующий год' }).click();
  const title = page.getByText(`Нерабочие праздничные дни ${year}`);
  await expect(title).toBeVisible();
  const before = Number(await title.locator('.count').textContent());

  const toggle = async () => {
    await page.getByRole('button', { name: 'Изменить' }).click();
    // 4 августа — среда: обычный рабочий день в любом календаре
    await page.locator('.cal-month', { hasText: 'Август' }).getByRole('button', { name: '4', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('.toast').last()).toContainText(`Календарь ${year} сохранён`);
  };
  await toggle();
  await expect(title.locator('.count')).toHaveText(String(before + 1));
  await toggle();
  await expect(title.locator('.count')).toHaveText(String(before));
});

test('импорт: предпросмотр показывает новых, изменения и ошибки по строкам; с ошибками не применяется', async () => {
  await page.goto('/employees');
  await page.getByRole('button', { name: 'Импорт' }).click();
  const csv = [
    'ФИО;Логин;Должность;Отдел;Руководитель;Норма дней',
    `${HR.name};${HR.login};Руководитель службы персонала;;;`,
    'Тестовая Евгения Импортовна;;Аналитик;Служба персонала;balashova.av;28',
    'Ошибкин Олег;;;;;много',
  ].join('\n');
  await page.locator('.dropzone input[type=file]').setInputFiles({ name: 'staff.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const dialog = page.getByRole('dialog', { name: 'Импорт сотрудников и остатков' });
  await expect(dialog.locator('.summary')).toContainText('1 новый');
  await expect(dialog.locator('.summary')).toContainText('1 ошибка');
  await expect(dialog.getByText('Норма дней: «много» — нужно число от 0 до 365')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Применить/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);
});

test('сброс пароля: открытая вкладка сотрудника сама уходит на экран входа', async ({ browser, request }) => {
  const employee = { login: 'budylina.sb', password: 'iXAsTk8P' };
  const ctx = await browser.newContext();
  const tab = await ctx.newPage();
  await login(tab, { ...employee, name: '' });
  // Кадровая служба сбрасывает пароль — как кнопкой «Сбросить пароль», но по API: значение известно тесту
  const hr = await (await request.post('/api/v1/auth/login', { data: { login: HR.login, password: HR.password } })).json();
  const headers = { Authorization: `Bearer ${hr.accessToken}` };
  const found = await (await request.get(`/api/v1/employees?search=${encodeURIComponent('Будылина')}`, { headers })).json();
  const id = found.items[0].id;
  expect((await request.put(`/api/v1/employees/${id}/password`, { headers, data: { newPassword: 'e2e-temp-password-1' } })).status()).toBe(204);
  try {
    // Вкладка ничего не делает: поток событий получает revoked (сервер сверяет сеансы раз в 10 с)
    await expect(tab).toHaveURL(/\/login\?ended=1/, { timeout: 20000 });
    await expect(tab.getByRole('alert')).toContainText('Сеанс завершён');
  } finally {
    await request.put(`/api/v1/employees/${id}/password`, { headers, data: { newPassword: employee.password } });
    await ctx.close();
  }
});
