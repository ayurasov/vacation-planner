// e2e кадрового цикла (v0.6.0): кампания планирования на следующий год — приглашение сотруднику,
// прогресс по отделам, утверждение графика и форма Т-7.
import { expect, test } from '@playwright/test';
import { ADMIN, HR, login } from './helpers';

const EMPLOYEE = { login: 'budylina.sb', password: 'iXAsTk8P' };
const Y = new Date().getFullYear() + 1;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('планирование: кадровая служба открывает год, сотрудник видит приглашение, график утверждается, Т-7 выгружается', async ({ browser, request }) => {
  const hrApi = await (await request.post('/api/v1/auth/login', { data: { login: HR.login, password: HR.password } })).json();
  const state = await (await request.get(`/api/v1/planning/${Y}`, { headers: { Authorization: `Bearer ${hrApi.accessToken}` } })).json();
  test.skip(!!state.approval, `График на ${Y} год уже утверждён в этой БД — сценарий проверяется на чистой БД`);

  // Согласованный отпуск следующего года: оформленный администратором согласуется сразу
  const admin = await (await request.post('/api/v1/auth/login', { data: { login: ADMIN.login, password: ADMIN.password } })).json();
  const adminHeaders = { Authorization: `Bearer ${admin.accessToken}` };
  const found = await (await request.get('/api/v1/employees?search=Будылина', { headers: adminHeaders })).json();
  const vacation = await request.post('/api/v1/vacation-requests', {
    headers: adminHeaders, data: { employee: found.items[0].id, start: `${Y}-10-05`, end: `${Y}-10-11` },
  });
  expect([201, 409]).toContain(vacation.status()); // 409 — уже есть с прошлого прогона

  const hr = await browser.newPage();
  await login(hr, HR);
  await hr.getByRole('complementary', { name: 'Главное меню' }).getByRole('link', { name: 'Кадровый учёт' }).click();
  await hr.getByRole('button', { name: String(Y), exact: true }).click();
  const campaign = hr.getByRole('region', { name: `Планирование на ${Y} год` });
  await campaign.getByLabel('Срок').fill(inDays(20));
  const openBtn = campaign.getByRole('button', { name: /Открыть планирование|Открыть снова|Изменить срок/ });
  const firstOpen = /Открыть/.test(await openBtn.innerText());
  await openBtn.click();
  if (firstOpen) await hr.getByRole('dialog').getByRole('button', { name: 'Открыть и пригласить' }).click();
  await expect(campaign.getByText('открыто', { exact: true })).toBeVisible();

  // Отделы: раскрыть первый — список сотрудников с состоянием плана
  const depts = hr.getByRole('region', { name: 'По отделам' });
  await depts.getByRole('button', { expanded: false }).first().click();
  await expect(depts.locator('.people li').first()).toBeVisible();

  // Сотрудник: приглашение в «Моём отпуске» открывает форму заявки на год кампании
  const ctx = await browser.newContext();
  const emp = await ctx.newPage();
  try {
    await login(emp, EMPLOYEE);
    await emp.goto('/my');
    const banner = emp.getByRole('region', { name: new RegExp(`отпуск на ${Y} год`) });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Одна из частей — не короче 14 календарных дней');
    const plan = banner.getByRole('button', { name: `Запланировать на ${Y}` });
    if (await plan.count()) {
      await plan.click();
      await expect(emp.getByRole('dialog')).toBeVisible();
      await emp.keyboard.press('Escape');
    }
  } finally {
    await ctx.close();
  }

  // Утверждение и форма Т-7
  const approveCard = hr.getByRole('region', { name: 'Утверждение графика' });
  await approveCard.getByLabel('Номер документа').fill('E2E-1');
  await approveCard.getByRole('button', { name: `Утвердить график на ${Y} год` }).click();
  await hr.getByRole('dialog').getByRole('button', { name: 'Утвердить график' }).click();
  await expect(hr.locator('.toast').last()).toContainText('График утверждён');
  await expect(campaign).toContainText('документ № E2E-1');

  const download = hr.waitForEvent('download');
  await hr.getByRole('button', { name: 'Форма Т-7' }).click();
  expect((await download).suggestedFilename()).toBe(`grafik-otpuskov-T7-${Y}.xlsx`);
  await hr.close();
});
