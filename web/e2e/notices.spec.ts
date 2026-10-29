// e2e кадрового цикла (v0.6.0): извещение о начале отпуска — сотрудник подтверждает ознакомление,
// кадровая служба видит подпись в журнале и открывает лист для печати.
import { expect, test } from '@playwright/test';
import { ADMIN, HR, login } from './helpers';

const iso = (d: Date) => d.toISOString().slice(0, 10);

test('извещение: отпуск через 5 дней — карточка «Ознакомлен» в «Моём отпуске», отметка в журнале кадровой службы', async ({ browser, request }) => {
  const admin = await (await request.post('/api/v1/auth/login', { data: { login: ADMIN.login, password: ADMIN.password } })).json();
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  const loginName = `e2e.notice${Date.now() % 100000}`;
  const created = await request.post('/api/v1/employees', { headers, data: { name: 'Извещенцева Ирина Игоревна', login: loginName, password: 'Ym3-copper-dawn' } });
  expect(created.status()).toBe(201);
  const employeeId = (await created.json()).employee.id as number;
  // Оформлено администратором — согласовано сразу; до начала меньше двух недель — извещение «позднее»
  const start = iso(new Date(Date.now() + 5 * 86_400_000));
  const end = iso(new Date(Date.now() + 7 * 86_400_000));
  const vacation = await request.post('/api/v1/vacation-requests', { headers, data: { employee: employeeId, start, end } });
  expect(vacation.status()).toBe(201);

  const ctx = await browser.newContext();
  const tab = await ctx.newPage();
  try {
    // Первый вход — смена одноразового пароля
    await tab.goto('/login');
    await tab.getByLabel('Логин').fill(loginName);
    await tab.getByLabel('Пароль', { exact: true }).fill('Ym3-copper-dawn');
    await tab.getByRole('button', { name: 'Войти' }).click();
    await tab.getByLabel('Пароль от кадровой службы').fill('Ym3-copper-dawn');
    await tab.getByLabel('Новый пароль', { exact: true }).fill('Vb5-silent-harbor');
    await tab.getByLabel('Повторите новый пароль').fill('Vb5-silent-harbor');
    await tab.getByRole('button', { name: 'Сохранить пароль' }).click();
    await tab.getByLabel('Логин').fill(loginName);
    await tab.getByLabel('Пароль', { exact: true }).fill('Vb5-silent-harbor');
    await tab.getByRole('button', { name: 'Войти' }).click();
    await expect(tab.getByRole('heading', { level: 1, name: 'График отпусков' })).toBeVisible();

    // Извещение отправляет плановая задача сервера — ждём её прохода
    const card = tab.getByRole('region', { name: 'Извещение о начале отпуска' });
    await expect(async () => {
      await tab.goto('/my');
      await expect(card).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(card).toContainText('ст. 124 ТК РФ');

    await card.getByRole('link', { name: 'Для печати' }).click();
    await expect(tab.getByRole('heading', { name: /Извещение/ })).toBeVisible();
    await expect(tab.getByText('Извещенцева И. И.')).toBeVisible();
    await tab.getByRole('button', { name: 'Назад' }).click();

    await card.getByRole('button', { name: 'Ознакомлен' }).click();
    await expect(tab.locator('.toast').last()).toContainText('Ознакомление подтверждено');
    await expect(card).toHaveCount(0);
    await expect(tab.getByText(/С извещением об отпуске .+ ознакомлены/)).toBeVisible();

    // Кадровая служба: подпись в журнале
    const hrPage = await browser.newPage();
    try {
      await login(hrPage, HR);
      await hrPage.getByRole('complementary', { name: 'Главное меню' }).getByRole('link', { name: 'Кадровый учёт' }).click();
      // Прошлые прогоны на той же БД: их сотрудники уволены, извещения отозваны
      const row = hrPage.getByRole('row').filter({ hasText: 'Извещенцева Ирина Игоревна' }).filter({ hasNotText: 'Отозвано' });
      await expect(row).toContainText('Ознакомлен');
      await expect(row).toContainText('позже 14 дней');
    } finally {
      await hrPage.close();
    }
  } finally {
    await request.delete(`/api/v1/employees/${employeeId}`, { headers });
    await ctx.close();
  }
});
