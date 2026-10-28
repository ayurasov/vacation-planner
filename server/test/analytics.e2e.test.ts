// E2E: аналитика пересечений, подбор дат и график работы (права, аудит).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';

let t: TestApp;
let emp: string;
let mgr: string;
let adm: string;

beforeAll(async () => {
  t = await createTestApp();
  emp = await login(t, t.employee);
  mgr = await login(t, t.manager);
  adm = await login(t, t.admin);
  // Согласованный отпуск руководителя — пересечение для подбора дат сотрудника
  await t.http().post('/api/v1/vacation-requests').set('Authorization', `Bearer ${adm}`)
    .send({ employee: t.manager.id, start: `${NEXT_YEAR}-07-01`, end: `${NEXT_YEAR}-07-14` });
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('аналитика отдела', () => {
  it('руководитель видит свой отдел: нагрузка по месяцам и выводы', async () => {
    const res = await t.http().get(`/api/v1/analytics/overview?dept=${encodeURIComponent('Тестовый отдел')}&year=${NEXT_YEAR}`)
      .set('Authorization', `Bearer ${mgr}`);
    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.months[6].peakRatio).toBeGreaterThan(0);
    expect(res.body.insights.length).toBeGreaterThan(0);
  });

  it('чужой отдел недоступен (403)', async () => {
    await t.prisma.department.create({ data: { name: 'Чужой отдел' } });
    const res = await t.http().get(`/api/v1/analytics/overview?dept=${encodeURIComponent('Чужой отдел')}`)
      .set('Authorization', `Bearer ${emp}`);
    expect(res.status).toBe(403);
  });

  it('состав отдела на дату: в отпуске / офис / удалёнка', async () => {
    const res = await t.http().get(`/api/v1/analytics/team?dept=${encodeURIComponent('Тестовый отдел')}&date=${NEXT_YEAR}-07-06`)
      .set('Authorization', `Bearer ${mgr}`);
    expect(res.status).toBe(200);
    const me = res.body.members.find((m: { id: number }) => m.id === t.manager.id);
    expect(me.status).toBe('vacation');
    expect(me.until).toBe(`${NEXT_YEAR}-07-14`);
    expect(res.body.counts.vacation).toBe(1);
  });
});

describe('подбор дат', () => {
  it('сотрудник получает окна без пересечения с отпуском руководителя', async () => {
    const res = await t.http().get(`/api/v1/analytics/suggestions?days=7&from=${NEXT_YEAR}-06-20&to=${NEXT_YEAR}-07-31`)
      .set('Authorization', `Bearer ${emp}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].reasons.length).toBeGreaterThan(0);
  });

  it('подбор для чужого сотрудника запрещён (403)', async () => {
    const res = await t.http().get(`/api/v1/analytics/suggestions?days=7&employee=${t.admin.id}`)
      .set('Authorization', `Bearer ${emp}`);
    expect(res.status).toBe(403);
  });

  it('длина вне 1..60 → 400', async () => {
    const res = await t.http().get('/api/v1/analytics/suggestions?days=90').set('Authorization', `Bearer ${emp}`);
    expect(res.status).toBe(400);
  });
});

describe('график работы', () => {
  it('руководитель задаёт шаблон и исключение подчинённому; всё попадает в аудит', async () => {
    const put = await t.http().put(`/api/v1/employees/${t.employee.id}/work-pattern`).set('Authorization', `Bearer ${mgr}`)
      .send({ 1: 'office', 2: 'remote', 3: 'office', 4: 'remote', 5: 'office' });
    expect(put.status).toBe(204);
    const ovr = await t.http().put(`/api/v1/employees/${t.employee.id}/work-overrides`).set('Authorization', `Bearer ${mgr}`)
      .send({ date: `${NEXT_YEAR}-03-03`, mode: 'remote' });
    expect(ovr.status).toBe(204);

    const get = await t.http().get(`/api/v1/employees/${t.employee.id}/work-schedule?from=${NEXT_YEAR}-01-01&to=${NEXT_YEAR}-12-31`)
      .set('Authorization', `Bearer ${emp}`);
    expect(get.body.pattern).toMatchObject({ 1: 'office', 2: 'remote' });
    expect(get.body.overrides).toEqual([{ date: `${NEXT_YEAR}-03-03`, mode: 'remote' }]);

    const del = await t.http().delete(`/api/v1/employees/${t.employee.id}/work-overrides/${NEXT_YEAR}-03-03`)
      .set('Authorization', `Bearer ${emp}`);
    expect(del.status).toBe(204);

    const audit = await t.http().get('/api/v1/audit-events?entity=employee&per_page=50').set('Authorization', `Bearer ${adm}`);
    const actions = audit.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining([
      'employee.work_pattern_updated', 'employee.work_override_set', 'employee.work_override_removed',
    ]));
    expect(audit.body.items[0].actorName).toBeTruthy();
  });

  it('сотрудник не может менять график коллеги (403)', async () => {
    const res = await t.http().put(`/api/v1/employees/${t.manager.id}/work-pattern`).set('Authorization', `Bearer ${emp}`)
      .send({ 1: 'remote' });
    expect(res.status).toBe(403);
  });
});
