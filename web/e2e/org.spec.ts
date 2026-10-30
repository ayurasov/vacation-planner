// Структура компании и «Импорт и экспорт» (v1.1.0, E70): дерево в справочниках, план загрузки
// структуры «По Делу» и коллизии при загрузке сотрудников.
import { expect, test } from '@playwright/test';
import { HR, login } from './helpers';

const stamp = Date.now().toString(36);

test('подразделение создаётся вложенным: путь, вид уровня, удаление пустого', async ({ page }) => {
  await login(page);
  await page.goto('/directories');
  await expect(page.getByRole('button', { name: /Подразделения/ })).toBeVisible();
  const parent = page.getByRole('row', { name: /ИТ служба/ });
  await parent.getByRole('button', { name: 'Добавить подразделение в «ИТ служба»' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Новое подразделение')).toBeVisible();
  await expect(dialog.getByLabel('Входит в')).toHaveValue(/\d+/);
  await dialog.getByLabel('Название').fill(`Группа ${stamp}`);
  await dialog.getByLabel('Вид').selectOption({ label: 'Группа' });
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Подразделение создано')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(`Группа ${stamp}`) });
  await expect(row).toBeVisible();
  await expect(row.locator('td').first()).toHaveAttribute('title', `ИТ служба / Группа ${stamp}`);

  // Удаление пустого вложенного — без вопросов о сотрудниках
  await row.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('button', { name: 'Удалить' }).last().click();
  await expect(row).toHaveCount(0);
});

test('импорт и экспорт: выгрузка структуры и план повторной загрузки без изменений', async ({ page }) => {
  await login(page, HR);
  await page.getByRole('link', { name: 'Импорт и экспорт' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Импорт и экспорт' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать структуру (JSON)' }).click();
  const file = await (await download).path();
  expect(file).toBeTruthy();

  // Кадровая служба не меняет настройки организации — флажок недоступен
  await expect(page.getByLabel('Применить виды уровней и глубину из файла')).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles(file!);
  await expect(page.getByText('Что изменится')).toBeVisible();
  await expect(page.getByText('новых 0')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить структуру' })).toBeEnabled();
});

test('загрузка сотрудников: коллизия по умолчанию — значение планировщика, выбор «из файла»', async ({ page }) => {
  await login(page, HR);
  await page.goto('/exchange');
  await page.getByRole('tab', { name: 'Сотрудники' }).click();
  const csv = `email;Логин;Должность\r\n;abdullin.ru;Должность ${stamp}\r\n`;
  await page.locator('input[type=file]').setInputFiles({ name: 'employees.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Что изменится')).toBeVisible();
  const record = page.locator('article.record').filter({ hasText: 'abdullin' }).first();
  await expect(record.getByText('сопоставлен по логину «abdullin.ru»')).toBeVisible();
  const group = record.getByRole('radiogroup', { name: /Должность/ });
  await expect(group.getByRole('radio', { name: /как в планировщике/ })).toBeChecked();
  await group.getByText('из файла').click();
  await expect(group.getByRole('radio', { name: /из файла/ })).toBeChecked();
});
