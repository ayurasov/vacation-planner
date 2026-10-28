import { expect, type Page } from '@playwright/test';

/** Администратор из демо-данных (server/prisma/seed-data) — см. README, «Быстрый старт». */
export const ADMIN = { login: 'yurasov.av', password: 'j2ENXpPi', name: 'Юрасов Александр Валерьевич' };

/** Кадровая служба из демо-данных: сотрудники «Службы персонала» получают признак при seed. */
export const HR = { login: 'balashova.av', password: 'zp5Gg57M', name: 'Балашова Анастасия Владимировна' };

export async function login(page: Page, user = ADMIN): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(user.login);
  await page.getByLabel('Пароль', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'График отпусков' })).toBeVisible();
}

/** Дата следующего года (MM-DD) — тесты не зависят от «сегодня» и не упираются в прошлые даты. */
export const nextYear = (mmdd: string) => `${new Date().getFullYear() + 1}-${mmdd}`;
