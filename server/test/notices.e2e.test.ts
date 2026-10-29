// Извещение о начале отпуска за две недели (v0.6.0, E60-03/04; ТК РФ, ст. 123–124).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import { NoticesService } from '../src/notices/notices.service';
import { orgToday } from '../src/infra/clock';

let t: TestApp;
let adm: string;
let mgr: string;
let emp: string;
let hr: string;
let today: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const run = () => t.app.get(NoticesService).run();

/** Согласованный отпуск сотрудника — напрямую в БД: проверяется извещение, а не согласование. */
async function approved(employeeId: number, startIn: number, length = 7, data: Record<string, unknown> = {}): Promise<number> {
  const r = await t.prisma.vacationRequest.create({
    data: {
      employeeId, createdBy: employeeId, status: 'approved',
      startDate: new Date(`${plus(today, startIn)}T00:00:00Z`), endDate: new Date(`${plus(today, startIn + length - 1)}T00:00:00Z`),
      ...data,
    },
  });
  return r.id;
}

beforeAll(async () => {
  t = await createTestApp();
  adm = await login(t, t.admin);
  mgr = await login(t, t.manager);
  emp = await login(t, t.employee);
  hr = await login(t, t.hr);
  today = await orgToday(t.prisma);
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('извещение о начале отпуска', () => {
  let onTime: number;
  let lateId: number;

  it('за 14 дней до начала — извещение и уведомление; раньше срока и повторно — нет', async () => {
    await approved(t.employee.id, 30);
    const requestId = await approved(t.employee.id, 14);
    expect(await run()).toBe(1);
    const n = await t.prisma.vacationNotice.findFirstOrThrow({ where: { requestId } });
    expect(n).toMatchObject({ employeeId: t.employee.id, days: 7, late: false, acknowledgedAt: null });
    onTime = n.id;
    const note = await t.prisma.notification.findFirstOrThrow({ where: { employeeId: t.employee.id, kind: 'vacation_notice' } });
    expect(note.text).toMatch(/^Извещение о начале отпуска: ежегодный оплачиваемый отпуск .+ — 7 дней — начинается/);
    expect(note.text).not.toMatch(/ст\. 124/);
    expect(note.payload).toEqual({ noticeId: n.id });
    expect(await t.prisma.emailOutbox.count({ where: { employeeId: t.employee.id, kind: 'vacation_notice' } })).toBeLessThanOrEqual(1);

    expect(await run()).toBe(0);
    expect(await t.prisma.vacationNotice.count()).toBe(1);
  });

  it('отпуск согласован позже чем за две недели — извещение сразу, с отметкой «поздно» и ст. 124', async () => {
    lateId = await approved(t.employee.id, 5, 3);
    expect(await run()).toBe(1);
    const n = await t.prisma.vacationNotice.findFirstOrThrow({ where: { requestId: lateId } });
    expect(n.late).toBe(true);
    const note = await t.prisma.notification.findFirstOrThrow({ where: { kind: 'vacation_notice', payload: { equals: { noticeId: n.id } } } });
    expect(note.text).toMatch(/позже чем за две недели .+ ст\. 124 ТК РФ/);
  });

  it('не извещаются: заявка на согласовании, декрет, отпуск уволенного и начавшийся отпуск', async () => {
    await approved(t.employee.id, 10, 3, { status: 'pending' });
    await approved(t.employee.id, 12, 3, { type: 'maternity' });
    await approved(t.employee.id, 0, 3);
    const gone = await t.prisma.employee.create({ data: { name: 'Уволенов Ушёл', login: 'gone.notice', passwordHash: 'x', isActive: false } });
    await approved(gone.id, 6, 3);
    expect(await run()).toBe(0);
  });

  it('сотрудник видит свои извещения и подтверждает ознакомление; повтор ничего не меняет; чужое — 404', async () => {
    const mine = await t.http().get('/api/v1/notices/mine').set(auth(emp));
    expect(mine.status).toBe(200);
    expect((mine.body.items as Array<{ id: number }>).map((n) => n.id).sort()).toEqual([onTime, (await t.prisma.vacationNotice.findFirstOrThrow({ where: { requestId: lateId } })).id].sort());
    expect(mine.body.items[0]).toMatchObject({ employeeName: 'Сотрудников Тест', dept: 'Тестовый отдел', acknowledgedAt: null, withdrawnAt: null });

    expect((await t.http().post(`/api/v1/notices/${onTime}/acknowledge`).set(auth(mgr))).status).toBe(404);
    expect((await t.http().post(`/api/v1/notices/${onTime}/acknowledge`).set(auth(emp))).status).toBe(204);
    const ack = await t.prisma.vacationNotice.findUniqueOrThrow({ where: { id: onTime } });
    expect(ack.acknowledgedAt).not.toBeNull();
    expect((await t.http().post(`/api/v1/notices/${onTime}/acknowledge`).set(auth(emp))).status).toBe(204);
    expect(await t.prisma.auditEvent.count({ where: { action: 'notice.acknowledged', entityId: String(onTime) } })).toBe(1);
    expect((await t.prisma.vacationNotice.findUniqueOrThrow({ where: { id: onTime } })).acknowledgedAt).toEqual(ack.acknowledgedAt);
  });

  it('извещение для печати: сотруднику — своё, кадровой службе — любое, руководителю — нет', async () => {
    expect((await t.http().get(`/api/v1/notices/${onTime}`).set(auth(emp))).status).toBe(200);
    const byHr = await t.http().get(`/api/v1/notices/${onTime}`).set(auth(hr));
    expect(byHr.status).toBe(200);
    expect(byHr.body).toMatchObject({ id: onTime, start: plus(today, 14), end: plus(today, 20), days: 7, late: false });
    expect((await t.http().get(`/api/v1/notices/${onTime}`).set(auth(mgr))).status).toBe(404);
  });

  it('журнал кадровой службы: фильтры, неподтверждённые, просроченные; сотруднику — 403', async () => {
    const from = today;
    const to = plus(today, 60);
    expect((await t.http().get(`/api/v1/notices?from=${from}&to=${to}`).set(auth(emp))).status).toBe(403);

    const all = await t.http().get(`/api/v1/notices?from=${from}&to=${to}`).set(auth(hr));
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.unacknowledged).toBe(1);

    const pending = await t.http().get(`/api/v1/notices?from=${from}&to=${to}&status=pending`).set(auth(hr));
    expect((pending.body.items as Array<{ requestId: number }>).map((n) => n.requestId)).toEqual([lateId]);
    expect((await t.http().get(`/api/v1/notices?from=${from}&to=${to}&status=acknowledged`).set(auth(hr))).body.meta.total).toBe(1);
    expect((await t.http().get(`/api/v1/notices?from=${from}&to=${to}&status=overdue`).set(auth(hr))).body.meta.total).toBe(0);
    expect((await t.http().get(`/api/v1/notices?from=${from}&to=${to}&dept=Кадровая служба`).set(auth(hr))).body.meta.total).toBe(0);

    // Не ознакомлен, а до начала три дня — просрочено
    const soon = await approved(t.employee.id, 3, 2);
    await run();
    const overdue = await t.http().get(`/api/v1/notices?from=${from}&to=${to}&status=overdue`).set(auth(hr));
    expect((overdue.body.items as Array<{ requestId: number; overdue: boolean }>).map((n) => [n.requestId, n.overdue])).toEqual([[soon, true]]);

    expect((await t.http().get(`/api/v1/notices?from=${to}&to=${from}`).set(auth(hr))).status).toBe(400);
  });

  it('выгрузка журнала в XLSX — кадровой службе, с записью в аудит', async () => {
    expect((await t.http().get(`/api/v1/reports/notices?from=${today}&to=${plus(today, 60)}`).set(auth(emp))).status).toBe(403);
    const res = await t.http().get(`/api/v1/reports/notices?from=${today}&to=${plus(today, 60)}`).set(auth(adm))
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(await t.prisma.auditEvent.findFirst({ where: { action: 'report.exported', entityId: 'notices' } })).not.toBeNull();
  });

  it('перенос: прежнее извещение в силе, пока перенос на согласовании; после согласования — отозвано, на новые даты — новое', async () => {
    const oldStart = new Date(`${plus(today, 14)}T00:00:00Z`);
    const r = await t.prisma.vacationNotice.findUniqueOrThrow({ where: { id: onTime } });
    await t.prisma.vacationRequest.update({
      where: { id: r.requestId },
      data: { status: 'pending', changeFromStart: oldStart, changeFromEnd: r.endDate, startDate: new Date(`${plus(today, 9)}T00:00:00Z`), endDate: new Date(`${plus(today, 12)}T00:00:00Z`) },
    });
    await run();
    expect((await t.prisma.vacationNotice.findUniqueOrThrow({ where: { id: onTime } })).withdrawnAt).toBeNull();

    await t.prisma.vacationRequest.update({ where: { id: r.requestId }, data: { status: 'approved', changeFromStart: null, changeFromEnd: null } });
    expect(await run()).toBe(1);
    expect((await t.prisma.vacationNotice.findUniqueOrThrow({ where: { id: onTime } })).withdrawnAt).not.toBeNull();
    const fresh = await t.prisma.vacationNotice.findFirstOrThrow({ where: { requestId: r.requestId, withdrawnAt: null } });
    expect(fresh).toMatchObject({ late: true, days: 4 });

    const mine = await t.http().get('/api/v1/notices/mine').set(auth(emp));
    expect((mine.body.items as Array<{ id: number }>).map((n) => n.id)).not.toContain(onTime);
    const res = await t.http().post(`/api/v1/notices/${onTime}/acknowledge`).set(auth(emp));
    expect(res.status).toBe(204); // уже подтверждено раньше — повтор безвреден

    // Отмена отпуска отзывает извещение; неподтверждённое отозванное подтвердить нельзя
    await t.prisma.vacationRequest.update({ where: { id: lateId }, data: { status: 'cancelled' } });
    await run();
    const late = await t.prisma.vacationNotice.findFirstOrThrow({ where: { requestId: lateId } });
    expect(late.withdrawnAt).not.toBeNull();
    expect((await t.http().post(`/api/v1/notices/${late.id}/acknowledge`).set(auth(emp))).status).toBe(400);
  });

  it('срок извещения — в настройках, не меньше 14 дней', async () => {
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ noticeDays: 10 })).status).toBe(400);
    const id = await approved(t.employee.id, 21, 3);
    expect(await run()).toBe(0);
    const res = await t.http().patch('/api/v1/settings').set(auth(adm)).send({ noticeDays: 21 });
    expect(res.status).toBe(200);
    expect(res.body.noticeDays).toBe(21);
    expect(await run()).toBe(1);
    expect((await t.prisma.vacationNotice.findFirstOrThrow({ where: { requestId: id } })).late).toBe(false);
  });

  it('сотрудник уволен — извещение отозвано', async () => {
    const leaver = await t.prisma.employee.create({ data: { name: 'Уходящев Ушёл', login: 'leaver.notice', passwordHash: 'x' } });
    const requestId = await approved(leaver.id, 6, 2);
    expect(await run()).toBe(1);
    await t.prisma.employee.update({ where: { id: leaver.id }, data: { isActive: false } });
    await run();
    expect((await t.prisma.vacationNotice.findFirstOrThrow({ where: { requestId } })).withdrawnAt).not.toBeNull();
  });
});
