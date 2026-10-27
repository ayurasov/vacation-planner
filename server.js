// Планировщик отпусков — бэкенд: Express + SQLite (better-sqlite3)
// Хранение данных в файловой БД data.db (а не в localStorage браузера).
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.db');
const SEED_PATH = path.join(__dirname, 'seed.json');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ── Схема БД ──
// employees — настоящая реляционная таблица (id + ключевые поля + полный JSON-профиль).
// settings  — пары ключ/значение для коллекций (logins, passwords, projects, departments,
//             deptManagers, groups, conflictThreshold).
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    position  TEXT,
    dept      TEXT,
    role      TEXT,
    is_admin  INTEGER DEFAULT 0,
    emp_type  TEXT DEFAULT 'staff',
    data      TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));
}
function getSetting(key, def) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : def;
}

// ── Запись полного состояния в БД (employees + settings) ──
const replaceEmployees = db.transaction((employees) => {
  db.prepare('DELETE FROM employees').run();
  const ins = db.prepare(`INSERT INTO employees(id,name,position,dept,role,is_admin,emp_type,data)
                          VALUES(@id,@name,@position,@dept,@role,@is_admin,@emp_type,@data)`);
  for (const e of employees) {
    ins.run({
      id: e.id,
      name: e.name || '',
      position: e.position || '',
      dept: e.dept || '',
      role: e.role || 'employee',
      is_admin: e.isAdmin ? 1 : 0,
      emp_type: e.empType || 'staff',
      data: JSON.stringify(e)
    });
  }
});

function saveStateToDb(state) {
  replaceEmployees(state.employees || []);
  setSetting('passwords', state.passwords || {});
  setSetting('logins', state.logins || {});
  setSetting('departments', state.departments || []);
  setSetting('projects', state.projects || []);
  setSetting('deptManagers', state.deptManagers || {});
  setSetting('groups', state.groups || []);
  setSetting('conflictThreshold', typeof state.conflictThreshold === 'number' ? state.conflictThreshold : 50);
}

function loadStateFromDb() {
  const rows = db.prepare('SELECT data FROM employees').all();
  const employees = rows.map(r => JSON.parse(r.data));
  return {
    employees,
    passwords: getSetting('passwords', {}),
    logins: getSetting('logins', {}),
    departments: getSetting('departments', []),
    projects: getSetting('projects', []),
    deptManagers: getSetting('deptManagers', {}),
    groups: getSetting('groups', []),
    conflictThreshold: getSetting('conflictThreshold', 50),
  };
}

// ── Первичное наполнение из seed.json (один раз) ──
function isSeeded() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM employees').get();
  return row.n > 0;
}
if (!isSeeded()) {
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    saveStateToDb(seed);
    console.log(`БД инициализирована из seed.json: ${seed.employees.length} сотрудников`);
  } catch (err) {
    console.error('Не удалось загрузить seed.json:', err.message);
  }
}

// ── HTTP-сервер ──
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Полное состояние приложения
app.get('/api/state', (req, res) => {
  try { res.json(loadStateFromDb()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Сохранение всего состояния (фронтенд шлёт целиком после любого изменения)
app.put('/api/state', (req, res) => {
  try {
    const state = req.body;
    if (!state || !Array.isArray(state.employees)) {
      return res.status(400).json({ error: 'Некорректное состояние' });
    }
    saveStateToDb(state);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Сброс БД к исходному seed
app.post('/api/reset', (req, res) => {
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    saveStateToDb(seed);
    res.json({ ok: true, employees: seed.employees.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`Планировщик отпусков слушает порт ${PORT}`));
