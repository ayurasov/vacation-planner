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
