// E2E: жизненный цикл заявок — конечный автомат, пересечения, лимиты, права, аудит
// (критерии E03-xx, E04-xx, E05-xx; таблица состояний — docs/specs/01-architecture.md раздел 8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { hashPassword } from '../src/auth/passwords';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';

let t: TestApp;
let emp: string;
let mgr: string;
let adm: string;

const range = (s: string, e: string) => ({ start: `${NEXT_YEAR}-${s}`, end: `${NEXT_YEAR}-${e}` });

beforeAll(async () => {
  t = await createTestApp();
  emp = await login(t, t.employee);
  mgr = await login(t, t.manager);
  adm = await login(t, t.admin);
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('создание и согласование', () => {
  it('сотрудник подаёт заявку → pending; руководитель видит и согласовывает', async () => {
    const created = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send(range('06-01', '06-14'));
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    const id = created.body.id;

    // в очереди подчинённых руководителя
    const queue = await t.http().get('/api/v1/vacation-requests?scope=subordinates&status=pending')
      .set('Authorization', `Bearer ${mgr}`);
    expect(queue.body.items.some((r: { id: number }) => r.id === id)).toBe(true);

    // сотрудник не может согласовать свою заявку
    const selfApprove = await t.http().post(`/api/v1/vacation-requests/${id}/approve`)
      .set('Authorization', `Bearer ${emp}`).send({});
    expect(selfApprove.status).toBe(403);

    // руководитель согласует
    const approved = await t.http().post(`/api/v1/vacation-requests/${id}/approve`)
      .set('Authorization', `Bearer ${mgr}`).send({ comment: 'хорошо' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    // у сотрудника появилось уведомление о согласовании
    const notes = await t.http().get('/api/v1/notifications').set('Authorization', `Bearer ${emp}`);
    expect(notes.body.items.some((n: { kind: string }) => n.kind === 'request_approved')).toBe(true);
  });

  it('даты в прошлом отклоняются (400 bad-date-range)', async () => {
    const res = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send({ start: '2020-01-01', end: '2020-01-10' });
    expect(res.status).toBe(400);
    expect(res.body.type).toMatch(/validation\/bad-date-range$/);
  });

  it('пересечение периодов → 409 overlapping-request', async () => {
    const res = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send(range('06-10', '06-20'));
    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/overlapping-request$/);
  });

  it('жёсткий лимит: заявка сверх остатка → 409 limit-exceeded', async () => {
    const res = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send(range('09-01', '10-31'));
    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/limit-exceeded$/);
  });

  it('за подчинённого руководитель оформляет отпуск сразу approved', async () => {
    const res = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${mgr}`)
      .send({ employee: t.employee.id, ...range('03-02', '03-05'), comment: 'за подчинённого' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');
  });

  it('чужому сотруднику (не подчинённому) заявку создать нельзя', async () => {
    const res = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send({ employee: t.admin.id, ...range('04-01', '04-05') });
    expect(res.status).toBe(403);
  });
});

describe('перенос и удаление', () => {
  it('перенос approved: → pending с changeFrom; отклонение возвращает прежние даты', async () => {
    const created = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send(range('07-01', '07-07'));
    await t.http().post(`/api/v1/vacation-requests/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${mgr}`).send({});

    const transfer = await t.http().patch(`/api/v1/vacation-requests/${created.body.id}`)
      .set('Authorization', `Bearer ${emp}`).send(range('08-02', '08-08'));
    expect(transfer.status).toBe(200);
    expect(transfer.body.status).toBe('pending');
    expect(transfer.body.changeFrom).toMatchObject({ start: `${NEXT_YEAR}-07-01`, end: `${NEXT_YEAR}-07-07` });

    const rejected = await t.http().post(`/api/v1/vacation-requests/${created.body.id}/reject`)
      .set('Authorization', `Bearer ${mgr}`).send({ comment: 'август занят проектом' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('approved');
    expect(rejected.body.start).toBe(`${NEXT_YEAR}-07-01`);
    expect(rejected.body.rejectionComment).toBe('август занят проектом');
  });

  it('отклонение без комментария → 400', async () => {
    const created = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send(range('10-05', '10-08'));
    const res = await t.http().post(`/api/v1/vacation-requests/${created.body.id}/reject`)
      .set('Authorization', `Bearer ${mgr}`).send({});
    expect(res.status).toBe(400);
  });

  it('удаление approved: pendingDeletion → одобрение удаляет заявку', async () => {
    const created = await t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send(range('11-02', '11-06'));
    await t.http().post(`/api/v1/vacation-requests/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${mgr}`).send({});

    const del = await t.http().delete(`/api/v1/vacation-requests/${created.body.id}`)
      .set('Authorization', `Bearer ${emp}`);
    expect(del.status).toBe(204);

    const after = await t.http().get(`/api/v1/vacation-requests/${created.body.id}`)
      .set('Authorization', `Bearer ${emp}`);
    expect(after.body.pendingDeletion).toBe(true);

    const approved = await t.http().post(`/api/v1/vacation-requests/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${mgr}`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.deleted).toBe(true);

    const gone = await t.http().get(`/api/v1/vacation-requests/${created.body.id}`)
      .set('Authorization', `Bearer ${emp}`);
    expect(gone.status).toBe(404);
  });
});

describe('баланс и аудит', () => {
  it('баланс отражает использованные дни и 14-дневную часть', async () => {
    const res = await t.http().get(`/api/v1/employees/${t.employee.id}/balance?year=${NEXT_YEAR}`)
      .set('Authorization', `Bearer ${emp}`);
    expect(res.status).toBe(200);
    expect(res.body.used).toBeGreaterThan(0);
    expect(res.body.hasFourteenDayStretch).toBe(true); // была заявка 06-01..06-14
  });

  it('праздник внутри отпуска не уменьшает остаток (ТК РФ ст. 120)', async () => {
    const url = `/api/v1/employees/${t.employee.id}/balance?year=${NEXT_YEAR}`;
    const before = await t.http().get(url).set('Authorization', `Bearer ${emp}`);
    // 12 июня попадает в согласованный отпуск 06-01..06-14
    await t.prisma.productionCalendar.upsert({
      where: { year: NEXT_YEAR },
      update: { holidays: [`${NEXT_YEAR}-06-12`] },
      create: { year: NEXT_YEAR, holidays: [`${NEXT_YEAR}-06-12`], transfers: [] },
    });
    const after = await t.http().get(url).set('Authorization', `Bearer ${emp}`);
    expect(after.body.used).toBe(before.body.used - 1);
    expect(after.body.remaining).toBe(before.body.remaining + 1);
    await t.prisma.productionCalendar.delete({ where: { year: NEXT_YEAR } });
  });

  it('аудит доступен только администратору и содержит действия', async () => {
    const forbidden = await t.http().get('/api/v1/audit-events').set('Authorization', `Bearer ${emp}`);
    expect(forbidden.status).toBe(403);

    const res = await t.http().get('/api/v1/audit-events?per_page=100').set('Authorization', `Bearer ${adm}`);
    expect(res.status).toBe(200);
    const actions = res.body.items.map((e: { action: string }) => e.action);
    for (const expected of ['request.created', 'request.approved', 'request.rejected', 'request.deleted']) {
      expect(actions).toContain(expected);
    }
  });

  it('график отдаёт интервалы и согласован с балансом', async () => {
    const res = await t.http().get(`/api/v1/schedule?from=${NEXT_YEAR}-01-01&to=${NEXT_YEAR}-12-31`)
      .set('Authorization', `Bearer ${emp}`);
    expect(res.status).toBe(200);
    const row = res.body.employees.find((e: { id: number }) => e.id === t.employee.id);
    expect(row.vacations.length).toBeGreaterThan(0);
  });
});

describe('XLSX-выгрузка отпусков', () => {
  it('администратор получает xlsx с данными; сотрудник — 403', async () => {
    const Y = NEXT_YEAR;
    const res = await t.http().get(`/api/v1/reports/vacations?from=${Y}-01-01&to=${Y}-12-31`)
      .set('Authorization', `Bearer ${adm}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(Buffer.isBuffer(res.body) || typeof res.body === 'object').toBe(true);

    const forbidden = await t.http().get(`/api/v1/reports/vacations?from=${Y}-01-01&to=${Y}-12-31`)
      .set('Authorization', `Bearer ${emp}`);
    expect(forbidden.status).toBe(403);
  });

  it('руководитель без отдела в подчинении выгружает только своих подчинённых', async () => {
    const Y = NEXT_YEAR;
    const dept = await t.prisma.department.create({ data: { name: 'Отдел без руководителя' } });
    const mgrB = { login: 'mgr.b', password: 'manager-b-pass-123' };
    const boss = await t.prisma.employee.create({
      data: { login: mgrB.login, passwordHash: await hashPassword(mgrB.password), name: 'Начальников Бэ', role: 'manager', deptId: dept.id },
    });
    const sub = await t.prisma.employee.create({
      data: { login: 'sub.b', passwordHash: await hashPassword('sub-b-pass-1234'), name: 'Подчинённый Бэ', deptId: dept.id, managerId: boss.id },
    });
    const outsider = await t.prisma.employee.create({
      data: { login: 'out.b', passwordHash: await hashPassword('out-b-pass-1234'), name: 'Посторонний Бэ', deptId: dept.id },
    });
    for (const id of [sub.id, outsider.id]) {
      await t.http().post('/api/v1/vacation-requests').set('Authorization', `Bearer ${adm}`)
        .send({ employee: id, start: `${Y}-10-05`, end: `${Y}-10-09` });
    }
    const token = await login(t, mgrB);
    const res = await t.http().get(`/api/v1/reports/vacations?from=${Y}-01-01&to=${Y}-12-31`)
      .set('Authorization', `Bearer ${token}`).buffer(true)
      .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const names: string[] = [];
    wb.worksheets[0].eachRow((row, i) => { if (i > 1) names.push(String(row.getCell(1).value)); });
    expect(names).toContain('Подчинённый Бэ');
    expect(names).not.toContain('Посторонний Бэ');
    expect(names).not.toContain('Сотрудников Тест');
  });

  it('from > to → 400 bad-date-range', async () => {
    const res = await t.http().get('/api/v1/reports/vacations?from=2027-12-31&to=2027-01-01')
      .set('Authorization', `Bearer ${adm}`);
    expect(res.status).toBe(400);
  });
});
