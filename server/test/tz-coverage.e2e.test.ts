// Требования ТЗ, которые до v1.0.0 подтверждались только кодом (ПМИ, приложение А, E50-01):
// последний администратор, непустой отдел, мягкий лимит, правила организации в журнале изменений
// и их границы, выгрузка без логинов и паролей, отпуск для ИП и самозанятых, секрет подписи токенов.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { ConfigService } from '@nestjs/config';
import { TokenService } from '../src/auth/token.service';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';

let t: TestApp;
let adm: string;
let emp: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await createTestApp();
  adm = await login(t, t.admin);
  emp = await login(t, t.employee);
});
afterAll(async () => { await destroyTestApp(t); });

describe('СП-8, FR-10: сотрудники и оргструктура', () => {
  it('последнего администратора нельзя уволить или лишить роли — 409 last-admin', async () => {
    const del = await t.http().delete(`/api/v1/employees/${t.admin.id}`).set(auth(adm));
    expect(del.status).toBe(409);
    expect(del.body.type).toMatch(/last-admin$/);
    const demote = await t.http().patch(`/api/v1/employees/${t.admin.id}`).set(auth(adm)).send({ isAdmin: false });
    expect(demote.status).toBe(409);
    expect(demote.body.type).toMatch(/last-admin$/);
  });

  it('отдел с сотрудниками не удаляется — 409 department-not-empty', async () => {
    const res = await t.http().delete(`/api/v1/departments/${encodeURIComponent('Тестовый отдел')}`).set(auth(adm));
    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/department-not-empty$/);
  });
});

describe('СП-9, FR-11: правила организации', () => {
  it('изменение правил — в журнале изменений со значениями до и после', async () => {
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ conflictThreshold: 45 })).status).toBe(200);
    const event = await t.prisma.auditEvent.findFirst({ where: { action: 'settings.updated' }, orderBy: { id: 'desc' } });
    expect(event?.actorId).toBe(t.admin.id);
    expect(event?.after).toMatchObject({ conflictThreshold: 45 });
    expect(event?.before).toHaveProperty('conflictThreshold');
  });

  it('границы: порог конфликтов 20–80 %, норма дней 20–60', async () => {
    for (const body of [{ conflictThreshold: 19 }, { conflictThreshold: 81 }, { defaultPlannedDays: 19 }, { defaultPlannedDays: 61 }]) {
      expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send(body)).status).toBe(400);
    }
  });
});

describe('СП-5: политика лимита', () => {
  it('мягкий лимит пропускает заявку сверх остатка, жёсткий — нет', async () => {
    const long = { start: `${NEXT_YEAR}-09-01`, end: `${NEXT_YEAR}-10-31` };
    expect((await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send(long)).status).toBe(409);
    await t.http().patch('/api/v1/settings').set(auth(adm)).send({ limitPolicy: 'soft' });
    try {
      const soft = await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send(long);
      expect(soft.status).toBe(201);
      await t.http().delete(`/api/v1/vacation-requests/${soft.body.id}`).set(auth(emp));
    } finally {
      await t.http().patch('/api/v1/settings').set(auth(adm)).send({ limitPolicy: 'hard' });
    }
  });

  it('ИП и самозанятым отпуск не оформляется — 400', async () => {
    const res = await t.http().post('/api/v1/employees').set(auth(adm)).send({ name: 'Самозанятый Подрядчиков', empType: 'ipsz' });
    expect(res.status).toBe(201);
    const id = res.body.employee.id as number;
    const req = await t.http().post('/api/v1/vacation-requests').set(auth(adm))
      .send({ employee: id, start: `${NEXT_YEAR}-08-03`, end: `${NEXT_YEAR}-08-07` });
    expect(req.status).toBe(400);
    expect(req.body.detail).toMatch(/ИП\/самозанятых/);
  });
});

describe('СП-10, FR-13: выгрузка', () => {
  it('в выгрузке графика нет логинов и паролей', async () => {
    const res = await t.http().get(`/api/v1/reports/vacations?from=${NEXT_YEAR}-01-01&to=${NEXT_YEAR}-12-31`).set(auth(adm))
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const header = (wb.worksheets[0].getRow(1).values as unknown[]).filter(Boolean).map(String);
    expect(header).toContain('Сотрудник');
    expect(header.some((h) => /логин|пароль|login|password/i.test(h))).toBe(false);
    const text = JSON.stringify(wb.worksheets[0].getSheetValues());
    expect(text).not.toContain(t.employee.login);
    expect(text).not.toContain(t.employee.password);
  });
});

describe('ТБ-6: секрет подписи токенов', () => {
  it('сервер не запускается без JWT_SECRET или с секретом короче 32 символов', () => {
    const config = (value?: string) => ({ get: () => value }) as unknown as ConfigService;
    expect(() => new TokenService(config(undefined))).toThrow(/JWT_SECRET/);
    expect(() => new TokenService(config('short-secret'))).toThrow(/32 символов/);
    expect(() => new TokenService(config('x'.repeat(32)))).not.toThrow();
  });
});
