// Слой данных: схема SQLite, загрузка/сохранение состояния, наполнение из seed.
// Выделен из server.js, чтобы работать с БД из тестов без запуска HTTP-сервера.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const SEED_PATH = process.env.SEED_PATH || path.join(__dirname, '..', 'seed.json');

// Ключи коллекций состояния, сохраняемых в settings.
const SETTING_KEYS = [
  'passwords', 'logins', 'departments', 'projects',
  'deptManagers', 'groups', 'conflictThreshold',
];

function openDb(dbPath = DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
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
  return db;
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));
}

function getSetting(db, key, def) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : def;
}

// Полная замена сотрудников одной транзакцией.
const replaceEmployees = (db) => db.transaction((employees) => {
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
      data: JSON.stringify(e),
    });
  }
});

function saveStateToDb(db, state) {
  replaceEmployees(db)(state.employees || []);
  setSetting(db, 'passwords', state.passwords || {});
  setSetting(db, 'logins', state.logins || {});
  setSetting(db, 'departments', state.departments || []);
  setSetting(db, 'projects', state.projects || []);
  setSetting(db, 'deptManagers', state.deptManagers || {});
  setSetting(db, 'groups', state.groups || []);
  setSetting(db, 'conflictThreshold', typeof state.conflictThreshold === 'number' ? state.conflictThreshold : 50);
}

function loadStateFromDb(db) {
  const rows = db.prepare('SELECT data FROM employees').all();
  const employees = rows.map((r) => JSON.parse(r.data));
  return {
    employees,
    passwords: getSetting(db, 'passwords', {}),
    logins: getSetting(db, 'logins', {}),
    departments: getSetting(db, 'departments', []),
    projects: getSetting(db, 'projects', []),
    deptManagers: getSetting(db, 'deptManagers', {}),
    groups: getSetting(db, 'groups', []),
    conflictThreshold: getSetting(db, 'conflictThreshold', 50),
  };
}

function readSeed(seedPath = SEED_PATH) {
  return JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
}

function isSeeded(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM employees').get();
  return row.n > 0;
}

// Первичное наполнение из seed.json при пустой БД.
function seedIfEmpty(db, seedPath = SEED_PATH) {
  if (isSeeded(db)) return false;
  try {
    const seed = readSeed(seedPath);
    saveStateToDb(db, seed);
    console.log(`БД инициализирована из seed.json: ${seed.employees.length} сотрудников`);
    return true;
  } catch (err) {
    console.error('Не удалось загрузить seed.json:', err.message);
    return false;
  }
}

module.exports = {
  DB_PATH, SEED_PATH, SETTING_KEYS,
  openDb, saveStateToDb, loadStateFromDb, readSeed, isSeeded, seedIfEmpty,
};
