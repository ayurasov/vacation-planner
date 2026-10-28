// E2E: роль кадровой службы (E33-01) и производственный календарь в интерфейсе (E33-02).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';

let t: TestApp;
let hr: string;
let emp: string;
let adm: string;

beforeAll(async () => {
  t = await createTestApp();
  hr = await login(t, t.hr);
  emp = await login(t, t.employee);
  adm = await login(t, t.admin);
});

afterAll(async () => {
  await destroyTestApp(t);
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('кадровая служба', () => {
  it('профиль сообщает кадровые права без права менять настройки', async () => {
    const res = await t.http().get('/api/v1/auth/me').set(auth(hr));
    expect(res.status).toBe(200);
    expect(res.body.permissions).toMatchObject({ isAdmin: false, isHr: true, manageStaff: true, manageSettings: false });
  });

  it('заводит, меняет и увольняет сотрудника; всё попадает в аудит', async () => {
    const created = await t.http().post('/api/v1/employees').set(auth(hr))
      .send({ name: 'Новиков Пётр Ильич', plannedDays: 28 });
    expect(created.status).toBe(201);
    const id = created.body.employee.id as number;
    expect((await t.http().patch(`/api/v1/employees/${id}`).set(auth(hr)).send({ carryOver: 3 })).status).toBe(200);
    expect((await t.http().delete(`/api/v1/employees/${id}`).set(auth(hr))).status).toBe(204);
    const audit = await t.http().get(`/api/v1/audit-events?entity=employee`).set(auth(hr));
    expect(audit.status).toBe(200);
    const actions = (audit.body.items as Array<{ action: string; entityId: string }>)
      .filter((e) => e.entityId === String(id)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['employee.created', 'employee.updated', 'employee.deactivated']));
  });

  it('не выдаёт служебные права ни при создании, ни при изменении', async () => {
    const asAdmin = await t.http().post('/api/v1/employees').set(auth(hr)).send({ name: 'Захаров Иван Петрович', isAdmin: true });
    expect(asAdmin.status).toBe(403);
    const toHr = await t.http().patch(`/api/v1/employees/${t.employee.id}`).set(auth(hr)).send({ isHr: true });
    expect(toHr.status).toBe(403);
  });

  it('не трогает учётную запись администратора: ни карточку, ни пароль, ни увольнение', async () => {
    expect((await t.http().patch(`/api/v1/employees/${t.admin.id}`).set(auth(hr)).send({ position: 'x' })).status).toBe(403);
    expect((await t.http().put(`/api/v1/employees/${t.admin.id}/password`).set(auth(hr)).send({ newPassword: 'takeover-123' })).status).toBe(403);
    expect((await t.http().delete(`/api/v1/employees/${t.admin.id}`).set(auth(hr))).status).toBe(403);
  });

  it('сбрасывает пароль обычному сотруднику; сброс в аудите без самого пароля', async () => {
    const res = await t.http().put(`/api/v1/employees/${t.employee.id}/password`).set(auth(hr)).send({ newPassword: 'employee-pass-123' });
    expect(res.status).toBe(204);
    emp = await login(t, t.employee);
    const audit = await t.http().get('/api/v1/audit-events?entity=employee').set(auth(hr));
    const reset = (audit.body.items as Array<{ action: string; entityId: string; after: unknown }>)
      .find((e) => e.action === 'employee.password_reset' && e.entityId === String(t.employee.id));
    expect(reset).toBeDefined();
    expect(JSON.stringify(reset)).not.toContain('employee-pass-123');
  });

  it('не меняет настройки организации и не согласует заявки', async () => {
    expect((await t.http().patch('/api/v1/settings').set(auth(hr)).send({ conflictThreshold: 30 })).status).toBe(403);
    expect((await t.http().get('/api/v1/vacation-requests?scope=all').set(auth(hr))).status).toBe(403);
  });

  it('видит аналитику любого отдела и выгружает отпуска всей организации', async () => {
    const res = await t.http().get(`/api/v1/analytics/overview?dept=${encodeURIComponent('Тестовый отдел')}&year=${NEXT_YEAR}`).set(auth(hr));
    expect(res.status).toBe(200);
    const xlsx = await t.http().get(`/api/v1/reports/vacations?from=${NEXT_YEAR}-01-01&to=${NEXT_YEAR}-12-31`).set(auth(hr));
    expect(xlsx.status).toBe(200);
  });

  it('email: задаётся, уникален без учёта регистра и очищается', async () => {
    const set = await t.http().patch(`/api/v1/employees/${t.employee.id}`).set(auth(hr)).send({ email: 'Employee@Corp.test' });
    expect(set.body.email).toBe('employee@corp.test');
    const dup = await t.http().patch(`/api/v1/employees/${t.manager.id}`).set(auth(hr)).send({ email: 'EMPLOYEE@corp.test' });
    expect(dup.status).toBe(400);
    const clear = await t.http().patch(`/api/v1/employees/${t.employee.id}`).set(auth(hr)).send({ email: null });
    expect(clear.body.email).toBeNull();
  });

  it('администратор назначает кадровую службу', async () => {
    const res = await t.http().patch(`/api/v1/employees/${t.employee.id}`).set(auth(adm)).send({ isHr: true });
    expect(res.status).toBe(200);
    expect(res.body.isHr).toBe(true);
    await t.http().patch(`/api/v1/employees/${t.employee.id}`).set(auth(adm)).send({ isHr: false });
  });

  it('роль снимается сразу, не дожидаясь истечения токена', async () => {
    const other = await t.http().post('/api/v1/employees').set(auth(adm))
      .send({ name: 'Временная Анна Сергеевна', login: 'hr.temp', password: 'hr-temp-1234', isHr: true });
    const token = await login(t, { login: 'hr.temp', password: 'hr-temp-1234' });
    expect((await t.http().get('/api/v1/audit-events').set(auth(token))).status).toBe(200);
    await t.http().patch(`/api/v1/employees/${other.body.employee.id}`).set(auth(adm)).send({ isHr: false });
    expect((await t.http().get('/api/v1/audit-events').set(auth(token))).status).toBe(403);
  });
});

describe('производственный календарь', () => {
  const year = NEXT_YEAR + 1;

  it('кадровая служба загружает календарь года: даты сортируются, повторы убираются, изменение в аудите', async () => {
    const res = await t.http().put(`/api/v1/calendar/holidays/${year}`).set(auth(hr)).send({
      holidays: [`${year}-05-09`, `${year}-01-01`, `${year}-05-09`],
      transfers: [{ from: `${year}-01-04`, to: `${year}-05-11` }],
    });
    expect(res.status).toBe(200);
    expect(res.body.holidays).toEqual([`${year}-01-01`, `${year}-05-09`]);
    const pub = await t.http().get(`/api/v1/calendar/holidays/${year}`);
    expect(pub.body.transfers).toEqual([{ from: `${year}-01-04`, to: `${year}-05-11` }]);
    const audit = await t.http().get('/api/v1/audit-events?entity=calendar').set(auth(hr));
    expect(audit.body.items[0]).toMatchObject({ action: 'calendar.created', entityId: String(year) });
  });

  it('праздник другого года и неверная дата отклоняются (400)', async () => {
    const other = await t.http().put(`/api/v1/calendar/holidays/${year}`).set(auth(hr)).send({ holidays: [`${year + 1}-01-01`], transfers: [] });
    expect(other.status).toBe(400);
    const bad = await t.http().put(`/api/v1/calendar/holidays/${year}`).set(auth(hr)).send({ holidays: [`${year}-13-01`], transfers: [] });
    expect(bad.status).toBe(400);
  });

  it('сотрудник календарь не меняет (403)', async () => {
    const res = await t.http().put(`/api/v1/calendar/holidays/${year}`).set(auth(emp)).send({ holidays: [], transfers: [] });
    expect(res.status).toBe(403);
  });

  it('праздник из нового календаря сразу учитывается в балансе', async () => {
    await t.http().put(`/api/v1/calendar/holidays/${NEXT_YEAR}`).set(auth(hr)).send({ holidays: [`${NEXT_YEAR}-08-05`], transfers: [] });
    await t.http().post('/api/v1/vacation-requests').set(auth(adm))
      .send({ employee: t.employee.id, start: `${NEXT_YEAR}-08-03`, end: `${NEXT_YEAR}-08-09` });
    const bal = await t.http().get(`/api/v1/employees/${t.employee.id}/balance?year=${NEXT_YEAR}`).set(auth(hr));
    expect(bal.status).toBe(200);
    expect(bal.body.used).toBe(6);
  });
});
