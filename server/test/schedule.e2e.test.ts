// E2E: график при масштабе (E41) — версия данных, ETag и 304, кэш не отдаёт устаревшее.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';
import { conflictDays } from '../src/schedule/schedule.service';

let t: TestApp;
let emp: string;
let adm: string;
const Y = NEXT_YEAR;
const url = `/api/v1/schedule?from=${Y}-01-01&to=${Y}-12-31`;

beforeAll(async () => {
  t = await createTestApp();
  emp = await login(t, t.employee);
  adm = await login(t, t.admin);
});

afterAll(async () => {
  await destroyTestApp(t);
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('график: версия данных и ETag', () => {
  it('повторный запрос с ETag без изменений — 304 без тела', async () => {
    const first = await t.http().get(url).set(auth(emp));
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\/"s\d+-/);
    const again = await t.http().get(url).set(auth(emp)).set('If-None-Match', etag);
    expect(again.status).toBe(304);
    expect(again.text ?? '').toBe('');
  });

  it('любое изменение отпусков меняет версию: старый ETag не подходит, новые данные видны сразу', async () => {
    const before = await t.http().get(url).set(auth(emp));
    const created = await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send({ start: `${Y}-03-02`, end: `${Y}-03-06` });
    expect(created.status).toBe(201);
    const after = await t.http().get(url).set(auth(emp)).set('If-None-Match', before.headers.etag as string);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    const me = after.body.employees.find((e: { id: number }) => e.id === t.employee.id);
    expect(me.vacations.map((v: { start: string }) => v.start)).toContain(`${Y}-03-02`);
  });

  it('изменение режима работы и правил тоже меняет версию', async () => {
    const a = await t.http().get(url).set(auth(adm));
    await t.http().put(`/api/v1/employees/${t.employee.id}/work-pattern`).set(auth(emp)).send({ 1: 'remote' });
    const b = await t.http().get(url).set(auth(adm));
    expect(b.headers.etag).not.toBe(a.headers.etag);
    expect(b.body.employees.find((e: { id: number }) => e.id === t.employee.id).workPattern).toEqual({ 1: 'remote' });
    await t.http().patch('/api/v1/settings').set(auth(adm)).send({ conflictThreshold: 40 });
    const c = await t.http().get(url).set(auth(adm));
    expect(c.headers.etag).not.toBe(b.headers.etag);
  });

  it('фильтр отдела: свой ETag и только сотрудники отдела', async () => {
    const all = await t.http().get(url).set(auth(emp));
    const dept = await t.http().get(`${url}&dept=${encodeURIComponent('Тестовый отдел')}`).set(auth(emp));
    expect(dept.headers.etag).not.toBe(all.headers.etag);
    expect(dept.body.employees.every((e: { dept: string }) => e.dept === 'Тестовый отдел')).toBe(true);
    expect(all.body.employees.length).toBeGreaterThan(dept.body.employees.length);
  });
});

describe('версия данных: при фиксации и один раз за транзакцию', () => {
  const version = async () =>
    Number((await t.prisma.$queryRaw<Array<{ v: bigint }>>`SELECT sum(version)::bigint AS v FROM data_version`)[0].v);

  it('транзакция из нескольких изменений увеличивает версию на 1; оператор без изменённых строк — не меняет', async () => {
    const before = await version();
    await t.prisma.$transaction(async (tx) => {
      await tx.department.create({ data: { name: 'Версия-1' } });
      await tx.department.create({ data: { name: 'Версия-2' } });
      await tx.department.updateMany({ where: { name: { startsWith: 'Версия-' } }, data: { managerId: null } });
    });
    expect(await version()).toBe(before + 1);
    await t.prisma.department.updateMany({ where: { name: 'Такого отдела нет' }, data: { managerId: null } });
    expect(await version()).toBe(before + 1);
    await t.prisma.department.deleteMany({ where: { name: { startsWith: 'Версия-' } } });
    expect(await version()).toBe(before + 2);
  });

  it('строки счётчика не заблокированы, пока транзакция открыта (иначе под нагрузкой — взаимная блокировка)', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    let changed!: () => void;
    const inside = new Promise<void>((r) => { changed = r; });
    const tx = t.prisma.$transaction(async (db) => {
      await db.department.create({ data: { name: 'Версия-блокировка' } });
      changed();
      await hold; // транзакция открыта, изменение сделано
    }, { timeout: 10_000 });
    await inside;
    try {
      // Другое соединение: NOWAIT упадёт (55P03), если хоть одна строка счётчика заблокирована
      const rows = await t.prisma.$queryRaw<Array<{ shard: number }>>`SELECT shard FROM data_version FOR UPDATE NOWAIT`;
      expect(rows).toHaveLength(16);
    } finally {
      release();
      await tx;
      await t.prisma.department.deleteMany({ where: { name: 'Версия-блокировка' } });
    }
  });
});

describe('конфликты отдела', () => {
  it('доля отсутствующих по дням считается счётчиком; ниже порога — не конфликт', () => {
    const staff = [{ id: 1, dept: 'А' }, { id: 2, dept: 'А' }, { id: 3, dept: 'А' }, { id: 4, dept: 'Б' }];
    const c = conflictDays('2027-07-01', '2027-07-10', 0.5, staff, [
      { employeeId: 1, start: '2027-07-01', end: '2027-07-05' },
      { employeeId: 2, start: '2027-07-04', end: '2027-07-08' },
      { employeeId: 4, start: '2027-06-28', end: '2027-07-02' }, // начался до периода — обрезается
    ]);
    expect(c.filter((x) => x.dept === 'А').map((x) => x.date)).toEqual(['2027-07-04', '2027-07-05']);
    expect(c.find((x) => x.dept === 'А')!.absentRatio).toBe(0.67);
    expect(c.filter((x) => x.dept === 'Б').map((x) => x.date)).toEqual(['2027-07-01', '2027-07-02']);
  });
});
