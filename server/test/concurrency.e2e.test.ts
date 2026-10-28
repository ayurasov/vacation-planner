// Конкурентность: одновременные заявки одного сотрудника не должны обходить проверку пересечений.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';

let t: TestApp;
let emp: string;
let mgr: string;

beforeAll(async () => {
  t = await createTestApp();
  emp = await login(t, t.employee);
  mgr = await login(t, t.manager);
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('параллельные заявки', () => {
  it('из пересекающихся заявок, отправленных одновременно, создаётся ровно одна', async () => {
    const send = (s: string, e: string) => t.http().post('/api/v1/vacation-requests')
      .set('Authorization', `Bearer ${emp}`).send({ start: `${NEXT_YEAR}-${s}`, end: `${NEXT_YEAR}-${e}` });
    const results = await Promise.all([
      send('11-02', '11-08'), send('11-04', '11-10'), send('11-06', '11-12'), send('11-05', '11-07'), // все содержат 6 ноября
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    const stored = await t.prisma.vacationRequest.count({
      where: { employeeId: t.employee.id, startDate: { gte: new Date(`${NEXT_YEAR}-11-01`) }, endDate: { lte: new Date(`${NEXT_YEAR}-11-12`) } },
    });
    expect(stored).toBe(1);
  });

  it('два одновременных решения по заявке: применяется одно, второе — 409 stale-state', async () => {
    const created = await t.http().post('/api/v1/vacation-requests').set('Authorization', `Bearer ${emp}`)
      .send({ start: `${NEXT_YEAR}-12-01`, end: `${NEXT_YEAR}-12-04` });
    const id = created.body.id as number;
    const [a, b] = await Promise.all([
      t.http().post(`/api/v1/vacation-requests/${id}/approve`).set('Authorization', `Bearer ${mgr}`).send({}),
      t.http().post(`/api/v1/vacation-requests/${id}/reject`).set('Authorization', `Bearer ${mgr}`).send({ comment: 'параллельно' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const events = await t.prisma.requestEvent.count({ where: { requestId: id, action: { in: ['approved', 'rejected'] } } });
    expect(events).toBe(1);
  });
});

describe('перенос', () => {
  it('после согласования переноса прежние даты очищаются; следующий перенос помнит последние', async () => {
    const created = await t.http().post('/api/v1/vacation-requests').set('Authorization', `Bearer ${mgr}`)
      .send({ employee: t.employee.id, start: `${NEXT_YEAR}-02-02`, end: `${NEXT_YEAR}-02-06` }); // сразу approved
    const id = created.body.id as number;
    const move = (s: string, e: string) => t.http().patch(`/api/v1/vacation-requests/${id}`)
      .set('Authorization', `Bearer ${emp}`).send({ start: `${NEXT_YEAR}-${s}`, end: `${NEXT_YEAR}-${e}` });

    await move('02-09', '02-13');
    const approved = await t.http().post(`/api/v1/vacation-requests/${id}/approve`).set('Authorization', `Bearer ${mgr}`).send({});
    expect(approved.body.status).toBe('approved');
    expect(approved.body.changeFrom).toBeNull();

    await move('02-16', '02-20');
    const rejected = await t.http().post(`/api/v1/vacation-requests/${id}/reject`).set('Authorization', `Bearer ${mgr}`)
      .send({ comment: 'нельзя' });
    expect(rejected.body).toMatchObject({ status: 'approved', start: `${NEXT_YEAR}-02-09`, end: `${NEXT_YEAR}-02-13`, changeFrom: null });
  });
});
