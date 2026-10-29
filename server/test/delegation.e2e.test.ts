// Замещение руководителя и эскалация заявок (v0.6.0, E61).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import { hashPassword } from '../src/auth/passwords';
import { EscalationService } from '../src/requests/escalation.service';

let t: TestApp;
let adm: string;
let mgr: string;
let emp: string;
let hr: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const Y = new Date().getFullYear() + 1;
const today = new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Сотрудник напрямую в БД (пароль не одноразовый). */
async function person(name: string, loginName: string, data: Record<string, unknown> = {}) {
  const password = 'Qz4-person-pass';
  const row = await t.prisma.employee.create({ data: { name, login: loginName, passwordHash: await hashPassword(password), ...data } });
  return { id: row.id, login: loginName, password, token: '' };
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
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('замещение руководителя', () => {
  let deputy: Awaited<ReturnType<typeof person>>;
  let delegationId: number;

  it('руководитель передаёт согласование коллеге; заместитель получает уведомление; назначение — в аудите', async () => {
    const other = await t.prisma.department.create({ data: { name: 'Соседний отдел' } });
    deputy = await person('Заместителев Захар Захарович', 'deputy.zz', { deptId: other.id });
    deputy.token = await login(t, deputy);
    expect((await t.http().get('/api/v1/auth/me').set(auth(deputy.token))).body.permissions.approvals).toBe(false);

    const res = await t.http().post('/api/v1/delegations').set(auth(mgr)).send({ deputyId: deputy.id, start: today, end: inDays(7) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ managerId: t.manager.id, deputyId: deputy.id, active: true, deputyName: 'Заместителев Захар Захарович' });
    delegationId = res.body.id;

    const note = await t.prisma.notification.findFirst({ where: { employeeId: deputy.id, kind: 'delegation_assigned' } });
    expect(note?.text).toMatch(/Руководителев Тест передаёт вам согласование/);
    expect(await t.prisma.auditEvent.findFirst({ where: { action: 'delegation.created', entityId: String(delegationId) } })).not.toBeNull();

    const mine = await t.http().get('/api/v1/delegations').set(auth(deputy.token));
    expect(mine.body.received).toHaveLength(1);
    expect((await t.http().get('/api/v1/auth/me').set(auth(deputy.token))).body.permissions.approvals).toBe(true);
  });

  it('заместитель видит заявки сотрудников руководителя в очереди и согласует их; новые заявки приходят и ему', async () => {
    const id = await request(emp, `${Y}-03-02`, `${Y}-03-06`);
    const note = await t.prisma.notification.findFirst({ where: { employeeId: deputy.id, kind: 'request_created' } });
    expect(note?.text).toMatch(/замещение/);
    expect(await t.prisma.notification.count({ where: { employeeId: t.manager.id, kind: 'request_created' } })).toBeGreaterThan(0);

    const queue = await t.http().get('/api/v1/vacation-requests?scope=approvals&status=pending').set(auth(deputy.token));
    expect(queue.status).toBe(200);
    expect((queue.body.items as Array<{ id: number }>).map((r) => r.id)).toContain(id);
    expect((await t.http().get(`/api/v1/vacation-requests/${id}`).set(auth(deputy.token))).status).toBe(200);
    expect((await t.http().post(`/api/v1/vacation-requests/${id}/approve`).set(auth(deputy.token)).send({})).status).toBe(200);
  });

  it('второе замещение на пересекающиеся даты, прошлый период, сам себе, руководитель без команды — отказ', async () => {
    const clash = await t.http().post('/api/v1/delegations').set(auth(mgr)).send({ deputyId: t.admin.id, start: inDays(3), end: inDays(10) });
    expect(clash.status).toBe(400);
    expect(clash.body.detail).toMatch(/уже передано: Заместителев/);
    expect((await t.http().post('/api/v1/delegations').set(auth(mgr)).send({ deputyId: deputy.id, start: '2020-01-01', end: '2020-01-10' })).status).toBe(400);
    expect((await t.http().post('/api/v1/delegations').set(auth(mgr)).send({ deputyId: t.manager.id, start: inDays(20), end: inDays(21) })).status).toBe(400);
    const lonely = await t.http().post('/api/v1/delegations').set(auth(emp)).send({ deputyId: deputy.id, start: inDays(20), end: inDays(21) });
    expect(lonely.status).toBe(400);
    expect(lonely.body.detail).toMatch(/нет подчинённых/);
  });

  it('за другого руководителя замещение назначает только кадровая служба', async () => {
    expect((await t.http().post('/api/v1/delegations').set(auth(emp)).send({ managerId: t.manager.id, deputyId: t.admin.id, start: inDays(30), end: inDays(31) })).status).toBe(403);
    const byHr = await t.http().post('/api/v1/delegations').set(auth(hr)).send({ managerId: t.manager.id, deputyId: t.admin.id, start: inDays(30), end: inDays(31) });
    expect(byHr.status).toBe(201);
    const managerNote = await t.prisma.notification.findFirst({ where: { employeeId: t.manager.id, kind: 'delegation_assigned' } });
    expect(managerNote?.text).toMatch(/Кадровая служба передала/);
    expect((await t.http().get(`/api/v1/delegations?manager=${t.manager.id}`).set(auth(hr))).body.given).toHaveLength(2);
    expect((await t.http().get(`/api/v1/delegations?manager=${t.manager.id}`).set(auth(emp))).status).toBe(403);
    expect((await t.http().delete(`/api/v1/delegations/${byHr.body.id}`).set(auth(hr))).status).toBe(204);
  });

  it('после отмены заместитель больше не решает и не видит очередь', async () => {
    const id = await request(emp, `${Y}-04-06`, `${Y}-04-08`);
    expect((await t.http().delete(`/api/v1/delegations/${delegationId}`).set(auth(deputy.token))).status).toBe(403); // отменяет руководитель
    expect((await t.http().delete(`/api/v1/delegations/${delegationId}`).set(auth(mgr))).status).toBe(204);
    expect((await t.http().post(`/api/v1/vacation-requests/${id}/approve`).set(auth(deputy.token)).send({})).status).toBe(403);
    const queue = await t.http().get('/api/v1/vacation-requests?scope=approvals&status=pending').set(auth(deputy.token));
    expect(queue.body.items).toHaveLength(0);
    expect(await t.prisma.auditEvent.findFirst({ where: { action: 'delegation.revoked', entityId: String(delegationId) } })).not.toBeNull();
    expect((await t.http().post(`/api/v1/vacation-requests/${id}/approve`).set(auth(mgr)).send({})).status).toBe(200);
  });

  it('заместитель из команды руководителя не согласует собственную заявку', async () => {
    const insider = await person('Подчинённый Инна Ивановна', 'insider.ii', { managerId: t.manager.id, deptId: (await t.prisma.employee.findUnique({ where: { id: t.manager.id } }))!.deptId });
    insider.token = await login(t, insider);
    expect((await t.http().post('/api/v1/delegations').set(auth(mgr)).send({ deputyId: insider.id, start: today, end: inDays(5) })).status).toBe(201);
    const own = await request(insider.token, `${Y}-05-11`, `${Y}-05-13`);
    const res = await t.http().post(`/api/v1/vacation-requests/${own}/approve`).set(auth(insider.token)).send({});
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/Свою заявку согласует руководитель/);
    const queue = await t.http().get('/api/v1/vacation-requests?scope=approvals&status=pending').set(auth(insider.token));
    expect((queue.body.items as Array<{ employee: number }>).some((r) => r.employee === insider.id)).toBe(false);
  });
});

describe('руководитель отдела без своего руководителя', () => {
  it('не получает уведомление о своей заявке и не согласует её сам; администратор — может', async () => {
    const before = await t.prisma.notification.count({ where: { employeeId: t.manager.id, kind: 'request_created' } });
    const own = await request(mgr, `${Y}-06-01`, `${Y}-06-05`);
    expect(await t.prisma.notification.count({ where: { employeeId: t.manager.id, kind: 'request_created' } })).toBe(before);
    expect((await t.http().post(`/api/v1/vacation-requests/${own}/approve`).set(auth(mgr)).send({})).status).toBe(403);
    expect((await t.http().post(`/api/v1/vacation-requests/${own}/approve`).set(auth(adm)).send({})).status).toBe(200);
  });

  it('очередь руководителя отдела — и сотрудники отдела без своего руководителя', async () => {
    // Администратор состоит в тестовом отделе и руководителя не имеет: его заявку решает руководитель отдела
    const id = await request(adm, `${Y}-07-06`, `${Y}-07-08`);
    const queue = await t.http().get('/api/v1/vacation-requests?scope=approvals&status=pending').set(auth(mgr));
    expect((queue.body.items as Array<{ id: number }>).map((r) => r.id)).toContain(id);
    expect((await t.http().get('/api/v1/vacation-requests?scope=subordinates&status=pending').set(auth(mgr))).body.items
      .some((r: { id: number }) => r.id === id)).toBe(false);
  });
});

describe('эскалация заявок без решения', () => {
  let boss: Awaited<ReturnType<typeof person>>;

  it('выключена по умолчанию (0 дней)', async () => {
    const id = await request(emp, `${Y}-08-03`, `${Y}-08-05`);
    await t.prisma.vacationRequest.update({ where: { id }, data: { pendingSince: new Date(Date.now() - 30 * 86_400_000) } });
    expect(await t.app.get(EscalationService).run()).toBe(0);
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ escalationDays: 3 })).status).toBe(200);
  });

  it('заявка дольше срока передаётся вышестоящему: он видит её в очереди и решает; повторно не передаётся', async () => {
    boss = await person('Начальников Борис Борисович', 'boss.bb');
    boss.token = await login(t, boss);
    await t.prisma.employee.update({ where: { id: t.manager.id }, data: { managerId: boss.id } });
    const pending = await t.prisma.vacationRequest.findMany({ where: { employeeId: t.employee.id, status: 'pending' } });
    await t.prisma.vacationRequest.updateMany({ where: { id: { in: pending.map((r) => r.id) } }, data: { pendingSince: new Date(Date.now() - 4 * 86_400_000) } });
    const fresh = await request(emp, `${Y}-09-07`, `${Y}-09-09`); // ждёт меньше срока — остаётся

    const escalated = await t.app.get(EscalationService).run();
    expect(escalated).toBe(pending.length);
    const r = await t.prisma.vacationRequest.findUnique({ where: { id: pending[0].id } });
    expect(r).toMatchObject({ escalatedTo: boss.id });
    expect((await t.prisma.vacationRequest.findUnique({ where: { id: fresh } }))?.escalatedAt).toBeNull();

    const note = await t.prisma.notification.findFirst({ where: { employeeId: boss.id, kind: 'request_escalated' } });
    expect(note?.text).toMatch(/больше 3 дней и передана вам/);
    expect(await t.prisma.notification.findFirst({ where: { employeeId: t.manager.id, kind: 'request_escalated' } })).not.toBeNull();
    expect(await t.prisma.auditEvent.findFirst({ where: { action: 'request.escalated', entityId: String(pending[0].id) } })).not.toBeNull();

    const queue = await t.http().get('/api/v1/vacation-requests?scope=approvals&status=pending').set(auth(boss.token));
    const item = (queue.body.items as Array<{ id: number; escalatedTo: number | null; escalatedAt: string | null }>).find((x) => x.id === pending[0].id);
    expect(item).toMatchObject({ escalatedTo: boss.id });
    expect(item?.escalatedAt).toBeTruthy();
    expect((await t.http().get('/api/v1/auth/me').set(auth(boss.token))).body.permissions.approvals).toBe(true);
    const decided = await t.http().post(`/api/v1/vacation-requests/${pending[0].id}/approve`).set(auth(boss.token)).send({});
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);

    expect(await t.app.get(EscalationService).run()).toBe(0); // отмеченные не передаются снова
  });

  it('без вышестоящего — уведомление кадровой службе, право решения не передаётся', async () => {
    await t.prisma.employee.update({ where: { id: t.manager.id }, data: { managerId: null } });
    const id = await request(emp, `${Y}-10-05`, `${Y}-10-07`);
    await t.prisma.vacationRequest.update({ where: { id }, data: { pendingSince: new Date(Date.now() - 5 * 86_400_000) } });
    expect(await t.app.get(EscalationService).run()).toBeGreaterThanOrEqual(1);
    const r = await t.prisma.vacationRequest.findUnique({ where: { id } });
    expect(r?.escalatedTo).toBeNull();
    expect(r?.escalatedAt).not.toBeNull();
    const note = await t.prisma.notification.findFirst({ where: { employeeId: t.hr.id, kind: 'request_stalled' } });
    expect(note?.text).toMatch(/вышестоящего руководителя нет/);
    expect(await t.app.get(EscalationService).run()).toBe(0);
  });

  it('перенос — новый запрос: отсчёт до эскалации начинается заново', async () => {
    const id = await request(emp, `${Y}-11-02`, `${Y}-11-04`);
    expect((await t.http().post(`/api/v1/vacation-requests/${id}/approve`).set(auth(mgr)).send({})).status).toBe(200);
    const moved = await t.http().patch(`/api/v1/vacation-requests/${id}`).set(auth(emp)).send({ start: `${Y}-11-09`, end: `${Y}-11-11` });
    expect(moved.status).toBe(200);
    const r = await t.prisma.vacationRequest.findUnique({ where: { id } });
    expect(r?.escalatedAt).toBeNull();
    expect(Date.now() - (r?.pendingSince?.getTime() ?? 0)).toBeLessThan(60_000);
  });
});
