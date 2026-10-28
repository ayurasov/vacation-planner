// E2E: исправления аудита функциональности v0.5.0 — подчинённые фильтром сервера, отдел в заявках,
// дробные дни в карточке сотрудника, все уведомления прочитаны одним запросом.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';

let t: TestApp;
let hr: string;
let mgr: string;
let emp: string;

beforeAll(async () => {
  t = await createTestApp();
  hr = await login(t, t.hr);
  mgr = await login(t, t.manager);
  emp = await login(t, t.employee);
});

afterAll(async () => {
  await destroyTestApp(t);
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('подчинённые и отдел заявки', () => {
  it('GET /employees?manager= — только прямые подчинённые, без перебора организации', async () => {
    const res = await t.http().get(`/api/v1/employees?manager=${t.manager.id}&per_page=200`).set(auth(mgr));
    expect(res.status).toBe(200);
    const ids = (res.body.items as Array<{ id: number; managerId: number }>).map((e) => e.id);
    expect(ids).toContain(t.employee.id);
    expect((res.body.items as Array<{ managerId: number }>).every((e) => e.managerId === t.manager.id)).toBe(true);
    expect(res.body.meta.total).toBe(ids.length);
  });

  it('заявки в списке несут отдел сотрудника — очередь руководителя ищет пересечения только в нём', async () => {
    await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send({ start: `${NEXT_YEAR}-05-11`, end: `${NEXT_YEAR}-05-15` });
    const res = await t.http().get('/api/v1/vacation-requests?scope=subordinates&status=pending').set(auth(mgr));
    expect(res.status).toBe(200);
    const mine = (res.body.items as Array<{ employee: number; employeeName: string; employeeDept: string | null }>)
      .find((r) => r.employee === t.employee.id)!;
    expect(mine.employeeName).toBeTruthy();
    expect(mine.employeeDept).toBe('Тестовый отдел');
  });
});

describe('карточка сотрудника', () => {
  it('дробные норма и перенос сохраняются как есть (раньше API принимал только целые, форма округляла)', async () => {
    const created = await t.http().post('/api/v1/employees').set(auth(hr)).send({ name: 'Дробнов Иван Петрович', plannedDays: 28.5, carryOver: 3.5 });
    expect(created.status).toBe(201);
    const id = created.body.employee.id as number;
    const patched = await t.http().patch(`/api/v1/employees/${id}`).set(auth(hr)).send({ carryOver: 2.33, position: 'Аналитик' });
    expect(patched.status).toBe(200);
    const card = await t.http().get(`/api/v1/employees/${id}`).set(auth(hr));
    expect(card.body).toMatchObject({ plannedDays: 28.5, carryOver: 2.33, position: 'Аналитик' });
    expect((await t.http().patch(`/api/v1/employees/${id}`).set(auth(hr)).send({ carryOver: 1.234 })).status).toBe(400);
    expect((await t.http().patch(`/api/v1/employees/${id}`).set(auth(hr)).send({ plannedDays: 400 })).status).toBe(400);
  });
});

describe('уведомления', () => {
  it('POST /notifications/read-all отмечает все непрочитанные одним запросом и только свои', async () => {
    await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send({ start: `${NEXT_YEAR}-06-01`, end: `${NEXT_YEAR}-06-05` });
    const before = await t.http().get('/api/v1/notifications?unread=true').set(auth(mgr));
    expect(before.body.meta.total).toBeGreaterThan(0);
    const res = await t.http().post('/api/v1/notifications/read-all').set(auth(mgr));
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(before.body.meta.total);
    expect((await t.http().get('/api/v1/notifications?unread=true').set(auth(mgr))).body.meta.total).toBe(0);
  });
});
