// E2E: импорт сотрудников и остатков (E30-01 файл, E30-02 JSON для кадровой системы).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';

let t: TestApp;
let hr: string;
let emp: string;

beforeAll(async () => {
  t = await createTestApp();
  hr = await login(t, t.hr);
  emp = await login(t, t.employee);
});

afterAll(async () => {
  await destroyTestApp(t);
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const CSV = [
  'ФИО;Логин;Должность;Отдел;Руководитель;Норма дней;Перенос;Тип занятости;Email',
  'Складов Семён Семёнович;;Начальник склада;Склад;;28;0;штат;sklad@corp.test',
  'Грузова Галина Игоревна;;Кладовщик;Склад;Складов Семён Семёнович;28;4,5;штат;',
  'Сотрудников Тест;employee.test;;;;;7;;',
].join('\n');

describe('импорт сотрудников', () => {
  it('предпросмотр ничего не меняет и показывает план по строкам', async () => {
    const res = await t.http().post('/api/v1/imports/employees?dryRun=true').set(auth(hr))
      .attach('file', Buffer.from(CSV), 'staff.csv');
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.summary).toEqual({ create: 2, update: 1, unchanged: 0, error: 0 });
    expect(res.body.newDepartments).toEqual(['Склад']);
    expect(res.body.rows[2].changes).toEqual({ carryOver: { before: 0, after: 7 } });
    expect(await t.prisma.employee.count({ where: { login: 'skladov.ss' } })).toBe(0);
  });

  it('применение — одна транзакция: отдел, сотрудники, руководитель из того же файла, аудит; пароли один раз', async () => {
    const res = await t.http().post('/api/v1/imports/employees?dryRun=false').set(auth(hr))
      .attach('file', Buffer.from(CSV), 'staff.csv');
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.credentials.map((c: { login: string }) => c.login)).toEqual(['skladov.ss', 'gruzova.gi']);
    const boss = await t.prisma.employee.findUniqueOrThrow({ where: { login: 'skladov.ss' }, include: { dept: true } });
    const clerk = await t.prisma.employee.findUniqueOrThrow({ where: { login: 'gruzova.gi' } });
    expect(boss.dept?.name).toBe('Склад');
    expect(boss.email).toBe('sklad@corp.test');
    expect(clerk.managerId).toBe(boss.id);
    expect(clerk.carryOver).toBe(4.5);
    expect((await t.prisma.employee.findUniqueOrThrow({ where: { id: t.employee.id } })).carryOver).toBe(7);
    const actions = (await t.prisma.auditEvent.findMany({ where: { actorId: t.hr.id } })).map((a) => a.action);
    expect(actions.filter((a) => a === 'employee.created')).toHaveLength(2);
    expect(actions).toEqual(expect.arrayContaining(['department.created', 'employee.updated', 'import.applied']));
    // созданный импортом сотрудник входит с выданным паролем
    const pass = res.body.credentials[0].password as string;
    expect((await t.http().post('/api/v1/auth/login').send({ login: 'skladov.ss', password: pass })).status).toBe(200);
  });

  it('повторная загрузка того же файла ничего не меняет', async () => {
    const res = await t.http().post('/api/v1/imports/employees?dryRun=false').set(auth(hr))
      .attach('file', Buffer.from(CSV), 'staff.csv');
    expect(res.body.summary).toEqual({ create: 0, update: 0, unchanged: 3, error: 0 });
    expect(await t.prisma.employee.count({ where: { name: 'Складов Семён Семёнович' } })).toBe(1);
  });

  it('файл с ошибками не применяется ни частично, ни целиком', async () => {
    const bad = 'ФИО;Норма дней\nХорошев Хорь Хорьевич;28\nПлохов Пётр Петрович;много';
    const res = await t.http().post('/api/v1/imports/employees?dryRun=false').set(auth(hr))
      .attach('file', Buffer.from(bad), 'bad.csv');
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/строках 3/);
    expect(await t.prisma.employee.count({ where: { name: 'Хорошев Хорь Хорьевич' } })).toBe(0);
  });

  it('XLSX-шаблон скачивается и принимается обратно', async () => {
    const tpl = await t.http().get('/api/v1/imports/employees/template').set(auth(hr))
      .buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as ArrayBuffer);
    const ws = wb.worksheets[0];
    ws.spliceRows(2, 1, ['Шаблонов Шамиль Шамилевич', '', 'Аналитик', 'Тестовый отдел', 'manager.test', 28, 0, 'штат', '']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await t.http().post('/api/v1/imports/employees?dryRun=true').set(auth(hr)).attach('file', file, 'tpl.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toMatchObject({ action: 'create', login: 'shablonov.shsh' });
    expect(res.body.rows[0].values.manager).toEqual({ id: t.manager.id });
  });

  it('JSON-импорт для синхронизации с кадровой системой', async () => {
    const res = await t.http().post('/api/v1/imports/employees?dryRun=false').set(auth(hr))
      .send({ rows: [{ login: 'employee.test', name: 'Сотрудников Тест', carryOver: 2, position: 'Инженер' }] });
    expect(res.status).toBe(200);
    expect(res.body.summary.update).toBe(1);
    const e = await t.prisma.employee.findUniqueOrThrow({ where: { id: t.employee.id } });
    expect([e.carryOver, e.position]).toEqual([2, 'Инженер']);
  });

  it('сотруднику импорт недоступен; без колонки ФИО — понятная ошибка', async () => {
    expect((await t.http().post('/api/v1/imports/employees').set(auth(emp)).send({ rows: [] })).status).toBe(403);
    const res = await t.http().post('/api/v1/imports/employees').set(auth(hr)).attach('file', Buffer.from('Логин\nx'), 'x.csv');
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/ФИО/);
  });
});
