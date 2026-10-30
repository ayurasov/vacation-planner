// Структура компании (v1.1.0, E70, ADR-018): дерево подразделений, правило руководителя в согласовании
// и обмен со «По Делу» — структура, сотрудники с коллизиями и быстрый импорт CSV.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import { hashPassword } from '../src/auth/passwords';

let t: TestApp;
let adm: string;
let hr: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const Y = new Date().getFullYear() + 1;
const ids: Record<string, number> = {};

async function person(name: string, loginName: string, data: Record<string, unknown> = {}) {
  const password = 'Qz4-person-pass';
  const row = await t.prisma.employee.create({ data: { name, login: loginName, passwordHash: await hashPassword(password), ...data } });
  return { id: row.id, login: loginName, password, token: '' };
}

async function dept(name: string, parent: string | null, extra: Record<string, unknown> = {}) {
  const res = await t.http().post('/api/v1/departments').set(auth(adm)).send({ name, parentId: parent ? ids[parent] : null, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: number; label: string; path: string[]; level: number };
}

const upload = (path: string, content: string, fields: Record<string, string> = {}, token = adm) => {
  let req = t.http().post(`/api/v1/org/${path}`).set(auth(token)).attach('file', Buffer.from(content, 'utf8'), 'file.txt');
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
};

beforeAll(async () => {
  t = await createTestApp();
  adm = await login(t, t.admin);
  hr = await login(t, t.hr);
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('дерево подразделений', () => {
  it('одноимённые подразделения в разных ветках различаются подписью; путь и уровень — в списке', async () => {
    ids['Компания'] = (await dept('Компания', null, { kind: 'company' })).id;
    ids['Продажи'] = (await dept('Продажи', 'Компания', { kind: 'division' })).id;
    ids['Отдел продаж'] = (await dept('Отдел продаж', 'Продажи')).id;
    ids['Север'] = (await dept('Север', 'Компания', { kind: 'direction' })).id;
    const north = await dept('Отдел продаж', 'Север');
    ids['Отдел продаж Север'] = north.id;
    expect(north).toMatchObject({ label: 'Отдел продаж — Север', path: ['Компания', 'Север', 'Отдел продаж'], level: 3 });
    const list = (await t.http().get('/api/v1/departments').set(auth(adm))).body as Array<{ id: number; label: string; parentId: number | null }>;
    expect(list.find((d) => d.id === ids['Отдел продаж'])?.label).toBe('Отдел продаж — Продажи');
    // Родитель раньше вложенных
    const order = list.map((d) => d.id);
    expect(order.indexOf(ids['Компания'])).toBeLessThan(order.indexOf(ids['Продажи']));
  });

  it('проверки: название среди соседей, цикл, вид уровня, удаление с вложенными', async () => {
    const dup = await t.http().post('/api/v1/departments').set(auth(adm)).send({ name: 'отдел  ПРОДАЖ', parentId: ids['Продажи'] });
    expect(dup.status).toBe(400);
    expect(dup.body.detail).toMatch(/уже есть/);
    const cycle = await t.http().patch(`/api/v1/departments/${ids['Компания']}`).set(auth(adm)).send({ parentId: ids['Отдел продаж'] });
    expect(cycle.status).toBe(400);
    expect(cycle.body.detail).toMatch(/внутрь самого себя/);
    expect((await t.http().post('/api/v1/departments').set(auth(adm)).send({ name: 'X', kind: 'galaxy' })).status).toBe(400);
    const del = await t.http().delete(`/api/v1/departments/${ids['Продажи']}`).set(auth(adm));
    expect(del.status).toBe(409);
    // Подпись — тоже ссылка на подразделение (совместимость с параметром dept)
    const ren = await t.http().patch(`/api/v1/departments/${encodeURIComponent('Отдел продаж — Север')}`).set(auth(adm)).send({ sortOrder: 5 });
    expect(ren.status, JSON.stringify(ren.body)).toBe(200);
    expect(ren.body).toMatchObject({ id: ids['Отдел продаж Север'], sortOrder: 5 });
  });

  it('глубина структуры ограничена настройкой; сократить её ниже текущей нельзя', async () => {
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ orgMaxDepth: 2 })).status).toBe(400);
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ orgMaxDepth: 3 })).status).toBe(200);
    const deep = await t.http().post('/api/v1/departments').set(auth(adm)).send({ name: 'Группа', parentId: ids['Отдел продаж'] });
    expect(deep.status).toBe(400);
    expect(deep.body.detail).toMatch(/не больше 3 уровней/);
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ orgMaxDepth: 15 })).status).toBe(200);
    // Вид, который носят подразделения, удалить из настроек нельзя
    const kinds = (await t.http().get('/api/v1/settings').set(auth(adm))).body.unitKinds as Array<{ value: string }>;
    const drop = await t.http().patch('/api/v1/settings').set(auth(adm)).send({ unitKinds: kinds.filter((k) => k.value !== 'division') });
    expect(drop.status).toBe(400);
    expect(drop.body.detail).toMatch(/division/);
  });
});

describe('правило руководителя по структуре', () => {
  let boss: Awaited<ReturnType<typeof person>>;
  let sales: Awaited<ReturnType<typeof person>>;
  let seller: Awaited<ReturnType<typeof person>>;
  let ceo: Awaited<ReturnType<typeof person>>;

  it('без явного руководителя заявку решает руководитель ближайшего вышестоящего подразделения', async () => {
    boss = await person('Боссов Борис', 'boss.bb', { deptId: ids['Компания'], email: 'boss@example.ru' });
    sales = await person('Продажин Пётр', 'sales.pp', { deptId: ids['Продажи'], email: 'sales@example.ru' });
    seller = await person('Продавцова Вера', 'seller.vv', { deptId: ids['Отдел продаж'], email: 'seller@example.ru', position: 'Менеджер' });
    await t.prisma.department.update({ where: { id: ids['Компания'] }, data: { managerId: boss.id } });
    await t.prisma.department.update({ where: { id: ids['Продажи'] }, data: { managerId: sales.id } });
    for (const p of [boss, sales, seller]) p.token = await login(t, p);

    const me = await t.http().get('/api/v1/auth/me').set(auth(sales.token));
    expect(me.body.permissions.approveSubordinates).toContain(seller.id);
    expect(me.body.permissions.approveSubordinates).not.toContain(boss.id);
    // Руководитель «Продаж» подчиняется руководителю «Компании»
    expect((await t.http().get('/api/v1/auth/me').set(auth(boss.token))).body.permissions.approveSubordinates).toContain(sales.id);

    const created = await t.http().post('/api/v1/vacation-requests').set(auth(seller.token)).send({ start: `${Y}-03-02`, end: `${Y}-03-06` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const queue = await t.http().get('/api/v1/vacation-requests?scope=approvals&status=pending').set(auth(sales.token));
    expect((queue.body.items as Array<{ id: number }>).map((r) => r.id)).toContain(created.body.id);
    expect(await t.prisma.notification.count({ where: { employeeId: sales.id, kind: 'request_created' } })).toBe(1);
    // Руководитель вышестоящего подразделения тоже вправе решить
    expect((await t.http().post(`/api/v1/vacation-requests/${created.body.id}/approve`).set(auth(boss.token)).send({})).status).toBe(200);
  });

  it('фильтр по подразделению охватывает вложенные; подпись одноимённого — точное подразделение', async () => {
    const all = await t.http().get(`/api/v1/employees?dept=${encodeURIComponent('Продажи')}`).set(auth(adm));
    expect((all.body.items as Array<{ id: number }>).map((e) => e.id).sort()).toEqual([sales.id, seller.id].sort());
    const one = await t.http().get(`/api/v1/employees?dept=${encodeURIComponent('Отдел продаж — Продажи')}`).set(auth(adm));
    expect((one.body.items as Array<{ id: number; deptName: string }>).map((e) => [e.id, e.deptName])).toEqual([[seller.id, 'Отдел продаж — Продажи']]);
  });

  it('«первое лицо» никому не подчиняется: его заявку решает только администратор', async () => {
    ceo = await person('Генеральный Глеб', 'ceo.gg', { deptId: ids['Продажи'], reportsToNone: true });
    ceo.token = await login(t, ceo);
    const r = await t.http().post('/api/v1/vacation-requests').set(auth(ceo.token)).send({ start: `${Y}-04-06`, end: `${Y}-04-08` });
    expect(r.status).toBe(201);
    const queue = await t.http().get('/api/v1/vacation-requests?scope=approvals&status=pending').set(auth(sales.token));
    expect((queue.body.items as Array<{ id: number }>).map((x) => x.id)).not.toContain(r.body.id);
    expect((await t.http().post(`/api/v1/vacation-requests/${r.body.id}/approve`).set(auth(boss.token)).send({})).status).toBe(403);
    expect((await t.http().post(`/api/v1/vacation-requests/${r.body.id}/approve`).set(auth(adm)).send({})).status).toBe(200);
  });
});

describe('обмен со «По Делу»', () => {
  let bundle: { format: string; settings: { org_unit_kinds: unknown[] }; departments: Array<{ key: string; name: string; parent: string | null; kind: string; heads: Array<{ email: string }> }> };

  it('выгрузка структуры — podelu.org-structure; повторная загрузка ничего не меняет', async () => {
    const res = await t.http().get('/api/v1/org/export').set(auth(hr));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/org-structure-\d{4}-\d{2}-\d{2}\.json/);
    bundle = JSON.parse(res.text);
    expect(bundle.format).toBe('podelu.org-structure');
    expect(bundle.settings.org_unit_kinds).toHaveLength(8);
    const sales = bundle.departments.find((d) => d.name === 'Продажи')!;
    expect(sales.heads).toEqual([{ email: 'sales@example.ru', primary: true }]);
    expect(bundle.departments.find((d) => d.key === String(ids['Отдел продаж']))?.parent).toBe(String(ids['Продажи']));

    const plan = await upload('import/structure', JSON.stringify(bundle), { applySettings: 'true' });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(plan.body.summary).toMatchObject({ create: 0, update: 0, settings: 0, errors: 0 });
    expect(plan.body.canApply).toBe(true);
  });

  it('новое подразделение из файла создаётся с руководителем; отсутствующие в файле не трогаются', async () => {
    const root = bundle.departments.find((d) => d.name === 'Компания')!;
    const next = {
      ...bundle,
      departments: [
        ...bundle.departments.filter((d) => d.name !== 'Север' && !(d.name === 'Отдел продаж' && d.parent !== String(ids['Продажи']))),
        { key: 'new-1', name: 'Логистика', parent: root.key, kind: 'service', sortOrder: 0, externalId: 'LOG-1', heads: [{ email: 'seller@example.ru', primary: true }] },
      ],
    };
    // Кадровая служба не меняет настройки организации из файла
    expect((await upload('import/structure', JSON.stringify(next), { apply: 'true', applySettings: 'true' }, hr)).status).toBe(403);
    const plan = await upload('import/structure', JSON.stringify(next), { apply: 'true', applySettings: 'false' }, hr);
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(plan.body).toMatchObject({ applied: true, summary: { create: 1, addHeads: 1, missingInFile: 2 } });
    const created = await t.prisma.department.findFirstOrThrow({ where: { name: 'Логистика' }, include: { manager: true } });
    expect(created).toMatchObject({ parentId: ids['Компания'], kind: 'service', externalId: 'LOG-1', orgSource: 'transfer' });
    expect(created.manager?.email).toBe('seller@example.ru');
    expect(await t.prisma.department.count({ where: { name: 'Север' } })).toBe(1);
  });

  it('неверный файл — понятная ошибка', async () => {
    const res = await upload('import/structure', JSON.stringify({ format: 'other' }));
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/podelu\.org-structure/);
  });

  it('выгрузка сотрудников CSV — столбцы «По Делу» и поля отпусков', async () => {
    const res = await t.http().get('/api/v1/org/employees/export?format=csv').set(auth(hr));
    expect(res.status).toBe(200);
    const lines = res.text.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('email;Логин;ФИО;Должность;Подразделение;Руководитель (явно);Первое лицо;Руководит;Функциональные руководители;Роль;Полномочия;Часовой пояс;Активен;Видимость;Вход;Внешний ID;Табельный номер;Норма дней;Перенос;Тип занятости');
    const seller = lines.find((l) => l.startsWith('seller@example.ru'))!;
    expect(seller).toContain('Компания / Продажи / Отдел продаж');
    expect(seller).toContain('Компания / Логистика (основной)');
    const json = await t.http().get('/api/v1/org/employees/export?format=json').set(auth(hr));
    const doc = JSON.parse(json.text) as { format: string; employees: Array<{ email: string; vacation: { plannedDays: number } }> };
    expect(doc.format).toBe('podelu.employees');
    expect(doc.employees.find((e) => e.email === 'seller@example.ru')?.vacation.plannedDays).toBe(28);
    expect(await t.prisma.auditEvent.count({ where: { action: 'report.exported', entityId: 'employees' } })).toBe(2);
  });

  it('загрузка сотрудников: коллизии по умолчанию оставляют значение планировщика; решение «из файла» применяется', async () => {
    const csv = [
      'email;ФИО;Должность;Подразделение;Табельный номер;Норма дней',
      'seller@example.ru;Продавцова Вера;Старший менеджер;Компания / Продажи / Отдел продаж;T-17;31',
      'new@example.ru;Новикова Нина;Логист;Компания / Логистика / Склад;;',
    ].join('\r\n');
    const plan = await upload('employees/import', csv, {}, hr);
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(plan.body.summary).toMatchObject({ create: 1, update: 1, conflicts: 2, errors: 0, createDepartments: 1 });
    const rec = (plan.body.records as Array<{ key: string; conflicts: Array<{ field: string; choice: string }>; changes: Array<{ field: string }> }>)
      .find((r) => r.key === 'seller@example.ru')!;
    expect(rec.conflicts.map((c) => [c.field, c.choice])).toEqual([['position', 'current'], ['plannedDays', 'current']]);
    expect(rec.changes.map((c) => c.field)).toEqual(['personnelNumber']); // пусто в планировщике — из файла

    const decisions = JSON.stringify({ 'seller@example.ru': { fields: { position: { choice: 'incoming' } } } });
    const done = await upload('employees/import', csv, { apply: 'true', decisions }, hr);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.applied).toBe(true);
    expect(done.body.credentials).toHaveLength(1);
    const seller = await t.prisma.employee.findFirstOrThrow({ where: { email: 'seller@example.ru' } });
    expect(seller).toMatchObject({ position: 'Старший менеджер', personnelNumber: 'T-17', plannedDays: 28 });
    const nina = await t.prisma.employee.findFirstOrThrow({ where: { email: 'new@example.ru' }, include: { dept: true } });
    expect(nina).toMatchObject({ name: 'Новикова Нина', mustChangePassword: true, orgSource: 'import' });
    expect(nina.dept?.name).toBe('Склад');
    // Руководитель Нины — руководитель «Логистики» по структуре, явный не записывается
    expect(nina.managerId).toBeNull();
    expect(await t.prisma.auditEvent.count({ where: { action: 'employee.created', entityId: String(nina.id) } })).toBe(1);
  });

  it('файл «По Делу» без полей отпусков ничего не стирает; повторная загрузка — без изменений', async () => {
    const exported = await t.http().get('/api/v1/org/employees/export?format=json').set(auth(adm));
    const doc = JSON.parse(exported.text) as { employees: Array<Record<string, unknown>> };
    for (const e of doc.employees) delete e.vacation;
    const plan = await upload('employees/import', JSON.stringify(doc));
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(plan.body.summary).toMatchObject({ create: 0, update: 0, conflicts: 0, errors: 0 });
  });

  it('быстрый импорт CSV: файл главнее, новые — только с «Создавать новых»; цикл подчинения — ошибка', async () => {
    const csv = [
      'email;ФИО;Подразделение;Должность;Руководитель;Руководит',
      'seller@example.ru;Продавцова Вера;Компания > Север;Ведущий менеджер;boss@example.ru;',
      'fresh@example.ru;Свежев Фёдор;Компания / Север / Отдел продаж;Стажёр;;',
    ].join('\n');
    const strict = await upload('import/csv', csv, {}, hr);
    expect(strict.body.summary.errors).toBe(1);
    const plan = await upload('import/csv', csv, { createMissing: 'true', apply: 'true' }, hr);
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(plan.body).toMatchObject({ applied: true, summary: { create: 1, update: 1, conflicts: 0 } });
    const seller = await t.prisma.employee.findFirstOrThrow({ where: { email: 'seller@example.ru' } });
    expect(seller).toMatchObject({ deptId: ids['Север'], position: 'Ведущий менеджер' });
    // У «Севера» нет руководителя: по структуре — руководитель «Компании», явный не нужен
    expect(seller.managerId).toBeNull();

    const loop = [
      'email;ФИО;Руководитель',
      'boss@example.ru;Боссов Борис;seller@example.ru',
    ].join('\n');
    const bad = await upload('import/csv', loop, {}, hr);
    expect(bad.body.summary.errors).toBe(1);
    expect(JSON.stringify(bad.body.records)).toMatch(/цикл подчинения/);
  });
});
