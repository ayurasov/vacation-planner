// Интеграционные тесты HTTP API этапа 0.
// Приложение поднимается на эфемерном порту с временной БД и урезанным seed,
// чтобы тесты не трогали рабочую data.db.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildApp } = require('../src/app');

// Компактный seed: 2 сотрудника и минимальные коллекции.
const makeSeed = () => ({
  employees: [
    {
      id: 900001, name: 'Тестов Тест Тестович', position: 'Инженер', dept: 'Служба тестирования',
      planned_days: 28, carry_over: 0, vacations: [], special: {},
      role: 'employee', isAdmin: false, empType: 'staff',
      manager: 900002, projectId: null, projectManager: null,
      vacationRequests: [], workOverrides: {},
      workPattern: { 1: 'office', 2: 'office', 3: 'office', 4: 'office', 5: 'office', 6: 'off', 0: 'off' },
    },
    {
      id: 900002, name: 'Админов Админ Админович', position: 'Руководитель', dept: 'Служба тестирования',
      planned_days: 28, carry_over: 0, vacations: [], special: {},
      role: 'manager', isAdmin: true, empType: 'staff',
      manager: null, projectId: null, projectManager: null,
      vacationRequests: [], workOverrides: {},
      workPattern: { 1: 'office', 2: 'office', 3: 'office', 4: 'office', 5: 'office', 6: 'off', 0: 'off' },
    },
  ],
  passwords: { 900001: 'pass1', 900002: 'pass2' },
  logins: { 900001: 'testov', 900002: 'adminov' },
  departments: ['Служба тестирования'],
  projects: [{ id: 1, name: 'Без проекта', managerId: null }],
  deptManagers: { 'Служба тестирования': 900002 },
  groups: [],
  conflictThreshold: 50,
});

describe('HTTP API этапа 0', () => {
  let server;
  let baseUrl;
  let db;
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vacation-planner-test-'));
    const seedPath = path.join(tmpDir, 'seed.json');
    fs.writeFileSync(seedPath, JSON.stringify(makeSeed()));

    const built = buildApp({ dbPath: path.join(tmpDir, 'test.db'), seedPath });
    db = built.db;
    await new Promise((resolve) => {
      server = built.app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /healthz отвечает ok', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('БД автоматически наполняется из seed при первом запуске', async () => {
    const res = await fetch(`${baseUrl}/api/state`);
    assert.equal(res.status, 200);
    const state = await res.json();
    assert.equal(state.employees.length, 2);
    assert.equal(state.employees[0].name, 'Тестов Тест Тестович');
    assert.equal(state.departments[0], 'Служба тестирования');
    assert.equal(state.conflictThreshold, 50);
  });

  it('PUT /api/state сохраняет и возвращает состояние при повторном GET', async () => {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    state.employees[0].planned_days = 30;
    state.conflictThreshold = 60;

    const put = await fetch(`${baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { ok: true });

    const reread = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(reread.employees[0].planned_days, 30);
    assert.equal(reread.conflictThreshold, 60);
  });

  it('PUT /api/state отклоняет некорректное состояние', async () => {
    // Объекты без employees — наш обработчик, тело ошибки JSON.
    for (const body of [{ noEmployees: true }, { employees: 'not-an-array' }]) {
      const res = await fetch(`${baseUrl}/api/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, `ожидался 400 для ${JSON.stringify(body)}`);
      const err = await res.json();
      assert.ok(err.error, 'тело ошибки содержит error');
    }
    // Примитивы верхнего уровня (null, числа) отбрасываются express.json (strict) — 400 без JSON-тела.
    for (const body of ['400', 'null']) {
      const prim = await fetch(`${baseUrl}/api/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(prim.status, 400);
    }
  });

  it('POST /api/reset восстанавливает данные из seed', async () => {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    state.employees = [];
    await fetch(`${baseUrl}/api/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
    });

    const res = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.employees, 2);

    const reread = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(reread.employees.length, 2);
    assert.equal(reread.employees[0].planned_days, 28);
  });

  it('SPA fallback отдаёт index.html для неизвестных маршрутов', async () => {
    const res = await fetch(`${baseUrl}/some/unknown/page`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<!DOCTYPE html>/i);
  });
});
