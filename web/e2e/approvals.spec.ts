// e2e согласования (v0.6.0): замещение руководителя на время отсутствия.
import { expect, test } from '@playwright/test';

const MANAGER = { login: 'vachaeva.ta', password: 'tHWCHX5c' };
const DEPUTY = { login: 'budylina.sb', password: 'iXAsTk8P', surname: 'Будылина' };

async function signIn(page: import('@playwright/test').Page, who: { login: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(who.login);
  await page.getByLabel('Пароль', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'График отпусков' })).toBeVisible();
}

test('замещение: руководитель передаёт согласование, заместитель видит раздел «Заявки», руководитель отменяет', async ({ browser }) => {
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await signIn(mgr, MANAGER);
  await mgr.goto('/settings');
  const card = mgr.getByRole('region', { name: 'Замещение на время отсутствия' });
  await card.getByLabel('Заместитель').fill(DEPUTY.surname);
  await card.getByRole('option').first().getByRole('button').click();
  await card.getByRole('button', { name: 'Передать согласование' }).click();
  await expect(mgr.locator('.toast').last()).toContainText('Согласование передано');
  await expect(card.getByText('действует')).toBeVisible();

  const depCtx = await browser.newContext();
  const dep = await depCtx.newPage();
  try {
    await signIn(dep, DEPUTY);
    const menu = dep.getByRole('complementary', { name: 'Главное меню' });
    await menu.getByRole('link', { name: /Заявки/ }).click();
    await expect(dep.locator('.banner-info')).toContainText('Вы замещаете');
  } finally {
    await card.getByRole('button', { name: /Отменить замещение/ }).click();
    await mgr.getByRole('dialog').getByRole('button', { name: 'Отменить замещение' }).click();
    await expect(mgr.locator('.toast').last()).toContainText('Замещение отменено');
    await depCtx.close();
    await mgrCtx.close();
  }
});
