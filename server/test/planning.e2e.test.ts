// Кампания планирования, утверждение графика и форма Т-7 (v0.6.0, E60-01/02; ТК РФ, ст. 123, 125).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import { PlanningService } from '../src/planning/planning.service';
import { orgToday } from '../src/infra/clock';

let t: TestApp;
let adm: string;
let mgr: string;
let emp: string;
let hr: string;
let today: string;
let Y: number;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const binary = (r: NodeJS.ReadableStream & { on: (e: string, cb: (c?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c?: Buffer) => chunks.push(c!));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function t7(year: number): Promise<ExcelJS.Worksheet> {
  const res = await t.http().get(`/api/v1/reports/t7?year=${year}`).set(auth(hr)).buffer(true).parse(binary);
  expect(res.status, String(res.body)).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  return wb.worksheets[0];
}

async function request(token: string, start: string, end: string): Promise<number> {
  const res = await t.http().post('/api/v1/vacation-requests').set(auth(token)).send({ start, end });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as number;
}

beforeAll(async () => {
  t = await createTestApp();
  adm = await login(t, t.admin);
  mgr = await login(t, t.manager);
  emp = await login(t, t.employee);
  hr = await login(t, t.hr);
  today = await orgToday(t.prisma);
  Y = Number(today.slice(0, 4)) + 1;
  await t.prisma.employee.update({ where: { id: t.employee.id }, data: { plannedDays: 28 } });
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('кампания планирования', () => {
  it('кадровая служба открывает планирование на следующий год; все штатные сотрудники приглашены; в аудите', async () => {
    expect((await t.http().post(`/api/v1/planning/${Y}/open`).set(auth(emp)).send({ deadline: plus(today, 20) })).status).toBe(403);
    expect((await t.http().post(`/api/v1/planning/${Y + 3}/open`).set(auth(hr)).send({ deadline: plus(today, 20) })).status).toBe(400);
    expect((await t.http().post(`/api/v1/planning/${Y}/open`).set(auth(hr)).send({ deadline: plus(today, -1) })).status).toBe(400);

    const res = await t.http().post(`/api/v1/planning/${Y}/open`).set(auth(hr)).send({ deadline: plus(today, 20) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.campaign).toMatchObject({ year: Y, deadline: plus(today, 20), open: true, openedBy: 'Кадровикова Тест' });
    const staff = await t.prisma.employee.count({ where: { isActive: true, empType: 'staff' } });
    expect(await t.prisma.notification.count({ where: { kind: 'planning_open' } })).toBe(staff);
    const note = await t.prisma.notification.findFirstOrThrow({ where: { kind: 'planning_open', employeeId: t.employee.id } });
    expect(note.text).toMatch(new RegExp(`на ${Y} год — до .+в году 28 дн\\., одна из частей — не короче 14 календарных дней`));
    expect(await t.prisma.auditEvent.findFirst({ where: { action: 'planning.opened', entityId: String(Y) } })).not.toBeNull();

    // Изменение срока открытой кампании — без повторного приглашения
    expect((await t.http().post(`/api/v1/planning/${Y}/open`).set(auth(hr)).send({ deadline: plus(today, 25) })).status).toBe(200);
    expect(await t.prisma.notification.count({ where: { kind: 'planning_open' } })).toBe(staff);
    expect(await t.prisma.auditEvent.findFirst({ where: { action: 'planning.updated' } })).not.toBeNull();
  });

  it('сотрудник видит приглашение и свой прогресс: ничего → меньше нормы → норма с частью ≥ 14 дней', async () => {
    const mine = await t.http().get('/api/v1/planning/mine').set(auth(emp));
    expect(mine.status).toBe(200);
    expect(mine.body.campaign).toMatchObject({ year: Y, deadline: plus(today, 25), overdue: false });
    expect(mine.body.plan).toMatchObject({ norm: 28, plannedDays: 0, status: 'none' });

    const first = await request(emp, `${Y}-03-02`, `${Y}-03-08`); // 7 дней, на согласовании
    let plan = (await t.http().get('/api/v1/planning/mine').set(auth(emp))).body.plan;
    expect(plan).toMatchObject({ plannedDays: 7, pendingDays: 7, approvedDays: 0, hasFourteen: false, status: 'partial' });

    expect((await t.http().post(`/api/v1/vacation-requests/${first}/approve`).set(auth(mgr)).send({})).status).toBe(200);
    const second = await request(emp, `${Y}-07-06`, `${Y}-07-26`); // 21 день
    expect((await t.http().post(`/api/v1/vacation-requests/${second}/approve`).set(auth(mgr)).send({})).status).toBe(200);
    plan = (await t.http().get('/api/v1/planning/mine').set(auth(emp))).body.plan;
    expect(plan).toMatchObject({ plannedDays: 28, approvedDays: 28, hasFourteen: true, status: 'done', parts: 2 });
  });

  it('прогресс по отделам и сотрудникам — только кадровой службе', async () => {
    expect((await t.http().get(`/api/v1/planning/${Y}`).set(auth(mgr))).status).toBe(403);
    const res = await t.http().get(`/api/v1/planning/${Y}`).set(auth(hr));
    expect(res.status).toBe(200);
    const dept = (res.body.departments as Array<{ dept: string; deptId: number }>).find((d) => d.dept === 'Тестовый отдел')!;
    expect(dept).toMatchObject({ employees: 3, planned: 1, done: 1, withFourteen: 1, plannedDays: 28 });
    expect(res.body.totals).toMatchObject({ planned: 1, done: 1 });
    expect(res.body.warnings).toMatchObject({ pendingRequests: 0, missingPersonnelNumbers: 1 });
    expect(res.body.approvedParts).toBe(2);
    expect(res.body.warnings.missingRequisites).toContain('наименование организации');

    const none = await t.http().get(`/api/v1/planning/${Y}/employees?deptId=${dept.deptId}&status=none`).set(auth(hr));
    expect((none.body.items as Array<{ name: string }>).map((e) => e.name).sort()).toEqual(['Админов Тест', 'Руководителев Тест']);
  });

  it('напоминание не спланировавшим: вручную — не чаще раза в час; автоматически — один раз за три дня до срока', async () => {
    const res = await t.http().post(`/api/v1/planning/${Y}/remind`).set(auth(hr));
    expect(res.status).toBe(200);
    const staff = await t.prisma.employee.count({ where: { isActive: true, empType: 'staff' } });
    expect(res.body.sent).toBe(staff - 1); // все, кроме спланировавшего полностью
    expect(await t.prisma.notification.count({ where: { kind: 'planning_reminder', employeeId: t.employee.id } })).toBe(0);
    const note = await t.prisma.notification.findFirstOrThrow({ where: { kind: 'planning_reminder', employeeId: t.manager.id } });
    expect(note.text).toMatch(/Сейчас запланировано 0 из 28 дн\. Нужна часть не короче 14 календарных дней\./);
    expect((await t.http().post(`/api/v1/planning/${Y}/remind`).set(auth(hr))).status).toBe(400);

    const planning = t.app.get(PlanningService);
    expect(await planning.autoRemind()).toBe(0); // до срока ещё далеко
    await t.prisma.planningCampaign.update({ where: { year: Y }, data: { deadline: new Date(`${plus(today, 2)}T00:00:00Z`) } });
    expect(await planning.autoRemind()).toBe(staff - 1);
    expect(await planning.autoRemind()).toBe(0);
    expect(await t.prisma.auditEvent.count({ where: { action: 'planning.reminded' } })).toBe(2);
  });

  it('закрыть и открыть снова; закрытая кампания не приглашает сотрудника', async () => {
    const closed = await t.http().post(`/api/v1/planning/${Y}/close`).set(auth(hr));
    expect(closed.body.campaign.open).toBe(false);
    expect((await t.http().get('/api/v1/planning/mine').set(auth(emp))).body.campaign).toBeNull();
    expect((await t.http().post(`/api/v1/planning/${Y}/remind`).set(auth(hr))).status).toBe(400);
    const reopened = await t.http().post(`/api/v1/planning/${Y}/open`).set(auth(hr)).send({ deadline: plus(today, 10) });
    expect(reopened.body.campaign.open).toBe(true);
  });
});

describe('табельный номер и реквизиты', () => {
  it('табельный номер — в карточке, уникален, ищется; реквизиты организации — в настройках', async () => {
    const res = await t.http().patch(`/api/v1/employees/${t.employee.id}`).set(auth(hr)).send({ personnelNumber: '00123' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.personnelNumber).toBe('00123');
    const dup = await t.http().patch(`/api/v1/employees/${t.manager.id}`).set(auth(hr)).send({ personnelNumber: '00123' });
    expect(dup.status).toBe(400);
    expect(dup.body.detail).toMatch(/уже у сотрудника Сотрудников Тест/);
    expect((await t.http().patch(`/api/v1/employees/${t.manager.id}`).set(auth(hr)).send({ personnelNumber: 'плохой номер!' })).status).toBe(400);
    const found = await t.http().get('/api/v1/employees?search=00123').set(auth(hr));
    expect((found.body.items as Array<{ id: number }>).map((e) => e.id)).toEqual([t.employee.id]);

    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ orgOkpo: '123' })).status).toBe(400);
    const s = await t.http().patch('/api/v1/settings').set(auth(adm)).send({
      orgName: 'ООО «Тестовая организация»', orgOkpo: '12345678', headPosition: 'Генеральный директор', headName: 'Директоров Д. Д.',
      hrHeadPosition: 'Начальник отдела кадров', hrHeadName: 'Кадровикова Т.', escalationDays: 0,
    });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ orgName: 'ООО «Тестовая организация»', orgOkpo: '12345678' });
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ headName: '' })).body.headName).toBeNull();
    await t.http().patch('/api/v1/settings').set(auth(adm)).send({ headName: 'Директоров Д. Д.' });
  });

  it('табельный номер в импорте: новый, изменение, повтор в файле и чужой номер — ошибки', async () => {
    const res = await t.http().post('/api/v1/imports/employees?dryRun=true').set(auth(hr)).send({
      rows: [
        { name: 'Табельнов Тимур Тимурович', personnelNumber: '00500' },
        { name: 'Сотрудников Тест', login: 'employee.test', personnelNumber: '00124' },
        { name: 'Повторов Пётр Петрович', personnelNumber: '00500' },
        { name: 'Чужов Чеслав Чеславович', personnelNumber: '00123' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rows.map((r: { action: string }) => r.action)).toEqual(['create', 'update', 'error', 'error']);
    expect(res.body.rows[1].changes).toEqual({ personnelNumber: { before: '00123', after: '00124' } });
    expect(res.body.rows[2].errors[0]).toMatch(/повторяется в файле/);
    expect(res.body.rows[3].errors[0]).toMatch(/уже у сотрудника Сотрудников Тест/);
  });
});

describe('утверждение графика и форма Т-7', () => {
  it('проект Т-7 до утверждения: заголовок «ПРОЕКТ», строки согласованных отпусков', async () => {
    const ws = await t7(Y);
    expect(ws.getCell('J4').value).toBe('0301020');
    expect(ws.getCell('J5').value).toBe('12345678');
    expect(ws.getCell('A4').value).toBe('ООО «Тестовая организация»');
    expect(String(ws.getCell('A12').value)).toMatch(/ПРОЕКТ/);
    expect(ws.getCell('A17').value).toBe(1);
    expect(ws.getCell('J17').value).toBe(10);
    expect([18, 19].map((r) => [ws.getCell(`C${r}`).value, ws.getCell(`D${r}`).value, ws.getCell(`E${r}`).value, ws.getCell(`F${r}`).value]))
      .toEqual([['Сотрудников Тест', '00123', 7, `02.03.${Y}`], ['Сотрудников Тест', '00123', 21, `06.07.${Y}`]]);
  });

  it('утверждение: реквизиты документа, снимок, кампания закрыта, в аудите; второй раз и после начала года — нельзя', async () => {
    expect((await t.http().post(`/api/v1/planning/${Y}/approve`).set(auth(emp)).send({ docNumber: '1', docDate: today })).status).toBe(403);
    expect((await t.http().post(`/api/v1/planning/${Y}/approve`).set(auth(hr)).send({ docDate: today })).status).toBe(400);
    expect((await t.http().post(`/api/v1/planning/${Y}/approve`).set(auth(hr)).send({ docNumber: '1', docDate: plus(today, 1) })).status).toBe(400);
    expect((await t.http().post(`/api/v1/planning/${Y - 1}/approve`).set(auth(hr)).send({ docNumber: '1', docDate: today })).status).toBe(400);

    const res = await t.http().post(`/api/v1/planning/${Y}/approve`).set(auth(hr))
      .send({ docNumber: '12-О', docDate: today, unionOpinionDate: plus(today, -2), unionOpinionNumber: '7' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.approval).toMatchObject({ year: Y, docNumber: '12-О', docDate: today, unionOpinionNumber: '7', rows: 2, approvedBy: 'Кадровикова Тест' });
    expect(res.body.campaign.open).toBe(false);
    expect(await t.prisma.auditEvent.findFirst({ where: { action: 'schedule.approved', entityId: String(Y) } })).not.toBeNull();

    const again = await t.http().post(`/api/v1/planning/${Y}/approve`).set(auth(hr)).send({ docNumber: '13', docDate: today });
    expect(again.status).toBe(400);
    expect(again.body.detail).toMatch(/уже утверждён: № 12-О/);
    expect((await t.http().post(`/api/v1/planning/${Y}/open`).set(auth(hr)).send({ deadline: plus(today, 5) })).status).toBe(400);
  });

  it('Т-7 утверждённого графика: номер и дата документа; перенос — графы 8–9; отмена — в примечании', async () => {
    const [moved, cancelled] = await t.prisma.vacationRequest.findMany({ where: { employeeId: t.employee.id }, orderBy: { startDate: 'asc' } });
    // Перенос после утверждения: заявка согласована на новые даты; отмена второй части
    await t.prisma.vacationRequest.update({ where: { id: moved.id }, data: { startDate: new Date(`${Y}-04-06T00:00:00Z`), endDate: new Date(`${Y}-04-12T00:00:00Z`) } });
    await t.prisma.requestEvent.create({ data: { requestId: moved.id, actorId: t.manager.id, action: 'approved', ts: new Date(Date.now() + 1000) } });
    await t.prisma.vacationRequest.update({ where: { id: cancelled.id }, data: { status: 'cancelled' } });

    const ws = await t7(Y);
    expect(ws.getCell('A12').value).toBe('ГРАФИК ОТПУСКОВ');
    expect(ws.getCell('E8').value).toBe('12-О');
    expect(ws.getCell('G8').value).toBe(Y);
    expect(String(ws.getCell('A7').value)).toMatch(/№ 7 учтено/);
    expect(String(ws.getCell('H9').value)).toMatch(/Директоров Д\. Д\./);
    expect(ws.getCell('F18').value).toBe(`02.03.${Y}`); // запланированная дата — из утверждённого графика
    expect(String(ws.getCell('H18').value)).toMatch(new RegExp(`^Заявка № ${moved.id} от \\d{2}\\.\\d{2}\\.\\d{4}$`));
    expect(ws.getCell('I18').value).toBe(`06.04.${Y}`);
    expect(ws.getCell('J19').value).toBe('Отпуск отменён');
    expect(ws.getCell('B21').value).toBe('Начальник отдела кадров');
    expect(await t.prisma.auditEvent.count({ where: { action: 'report.exported', entityId: 't7' } })).toBe(2);
  });

  it('пустой график не утверждается', async () => {
    await t.prisma.scheduleApproval.delete({ where: { year: Y } });
    await t.prisma.vacationRequest.updateMany({ where: { employeeId: t.employee.id }, data: { status: 'cancelled' } });
    const res = await t.http().post(`/api/v1/planning/${Y}/approve`).set(auth(hr)).send({ docNumber: '14', docDate: today });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/Нет согласованных отпусков/);
  });

  it('текущий год утвердить нельзя — он уже начался', async () => {
    const res = await t.http().post(`/api/v1/planning/${Y - 1}/approve`).set(auth(hr)).send({ docNumber: '1', docDate: today });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/до начала года/);
  });
});
