# Модель данных, справочники и миграция

| Параметр | Значение |
|---|---|
| Документ | Модель данных и справочники (документ 4 комплекта) |
| Версия | 1.0 |
| Дата | 27.10.2026 |
| Статус | На согласование |
| Связанные документы | 1 — Архитектура; 2 — Спецификация API; 3 — Бэклог (E00-01, E10-01) |

## 1. Назначение

Целевая реляционная схема SQLite этапа 1 и правила миграции из текущего snapshot-формата (`employees.data` JSON + `settings`). Заменяет денормализованное хранение этапа 0.

## 2. Принципы

1. Каждая сущность — отдельная таблица; отдел получает `id` (сегодня — строка в данных сотрудника).
2. Ссылки — по id с `ON DELETE`-поведением; строковые ссылки (имя отдела) устраняются при миграции.
3. История заявки и аудит — отдельно от записи заявки: запись меняется, журнал только растёт.
4. Время — UTC ISO-8601; дата отпуска — календарная `YYYY-MM-DD` без времени.
5. Миграции нумерованные и обратимые; применяются `npm run migrate`.

## 3. Схема

### 3.1. Таблицы

```sql
employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,            -- scrypt: соль+хеш, base64
  name          TEXT NOT NULL,
  position      TEXT,
  dept_id       INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  role          TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','manager')),
  is_admin      INTEGER NOT NULL DEFAULT 0,
  emp_type      TEXT NOT NULL DEFAULT 'staff' CHECK (emp_type IN ('staff','ipsz')),
  manager_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  planned_days  REAL NOT NULL DEFAULT 28 CHECK (planned_days >= 0),
  carry_over    REAL NOT NULL DEFAULT 0   CHECK (carry_over >= 0),
  is_active     INTEGER NOT NULL DEFAULT 1, -- soft delete: уволенные сохраняются для истории
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  manager_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL
);

projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  manager_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL
);

groups (                                   -- личные группы фильтров
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  UNIQUE (owner_id, name)
);
group_members (group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
               employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
               PRIMARY KEY (group_id, employee_id));

vacation_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'vacation' CHECK (type IN ('vacation','maternity')),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','cancelled')),
  pending_deletion INTEGER NOT NULL DEFAULT 0,
  change_from_start TEXT,                  -- прежние даты при переносе
  change_from_end   TEXT,
  comment          TEXT,
  rejection_comment TEXT,
  created_by       INTEGER NOT NULL REFERENCES employees(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_requests_employee ON vacation_requests(employee_id, status);
CREATE INDEX idx_requests_dates ON vacation_requests(start_date, end_date);

request_events (                          -- история заявки (append-only)
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES vacation_requests(id) ON DELETE CASCADE,
  ts         TEXT NOT NULL,
  actor_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,                -- created/edited/approved/rejected/cancelled/deletion_requested/dates_restored
  comment    TEXT
);

work_patterns (                           -- недельный шаблон; 7 строк на сотрудника
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  mode        TEXT NOT NULL CHECK (mode IN ('office','remote','off')),
  PRIMARY KEY (employee_id, weekday)
);

work_overrides (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('office','remote','off')),
  PRIMARY KEY (employee_id, date)
);

org_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- JSON: conflictThreshold, timezone, limitPolicy, defaultPlannedDays

calendars (                               -- производственный календарь
  year       INTEGER PRIMARY KEY,
  holidays   TEXT NOT NULL,               -- JSON: ["2026-01-01", ...]
  transfers  TEXT NOT NULL                -- JSON: [{"from":"...","to":"..."}]
);

notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  payload     TEXT,                       -- JSON со ссылкой на сущность
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_notifications_inbox ON notifications(employee_id, is_read, created_at);

audit_events (                            -- append-only журнал изменений
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  actor_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,               -- каталог в разделе 5
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  before     TEXT,                        -- JSON
  after      TEXT                         -- JSON
);
CREATE INDEX idx_audit_entity ON audit_events(entity, entity_id, ts);
```

### 3.2. Сопоставление со старым форматом

| Было (JSON в snapshot) | Стало |
|---|---|
| `employee.id` = 100000+ или `Date.now()` | `employees.id` AUTOINCREMENT; старые id сохраняются при миграции как есть (в допустимом диапазоне INTEGER) |
| `employee.dept` строка | `dept_id` → `departments.id` (отдел создаётся при миграции, если отсутствует) |
| `employee.vacationRequests[]` | строки `vacation_requests` + `request_events` из `history[]` |
| `employee.vacations[]` (легаси-даты) | не переносится; при миграции сверяется с заявками, расхождения — в отчёт миграции |
| `employee.special` (декрет) | заявка `type='maternity'` на период |
| `employee.workPattern {}` | 7 строк `work_patterns` |
| `employee.workOverrides {}` | `work_overrides` |
| `settings.passwords{}` | не переносится — сброс на одноразовые пароли (В1 документа 1) |
| `settings.logins{}` | `employees.login` |
| `settings.deptManagers{}` | `departments.manager_id` |
| `settings.projects[]`, `groups[]`, `conflictThreshold` | `projects`, `groups`(+owner из контекста), `org_settings` |

## 4. Справочники

| Справочник | Владелец | Изменение | Особые правила |
|---|---|---|---|
| Сотрудники | Админ | CRUD + деактивация | Удаление = `is_active=0`; последний админ защищён; логин уникален, транслит ФИО |
| Отделы | Админ | CRUD | Удаление только без активных сотрудников; переименование безопасно (id) |
| Проекты | Админ | CRUD | Удаление только без участников |
| Группы | Каждый пользователь | CRUD | Видит только владелец |
| Календарь | Админ | Импорт по годам | Блокирует операции с датами года без календаря (явная ошибка `calendar-missing`) |
| Настройки | Админ | PATCH | Валидация диапазонов контракта |

## 5. Каталог действий аудита

`employee.created / employee.updated / employee.deactivated / password.changed /
request.created / request.updated / request.approved / request.rejected / request.cancelled /
request.deletion_requested / request.deleted / department.* / project.* / group.* /
settings.updated / calendar.imported / report.exported / migration.completed`

Правила: append-only; актор — всегда серверный пользователь или `system`; секретные поля (password_hash, токены) не попадают в before/after.

## 6. Миграция из snapshot-формата

1. **Источник**: текущая `data.db` этапа 0 (или `seed.json`) — `employees.data` JSON + `settings`.
2. **Инструмент**: `scripts/migrate-stage0.mjs` — читает snapshot, пишет новую схему в ту же БД (новые таблицы), старые таблицы переименовываются в `legacy_*` и удаляются после приёмки.
3. **Идентификация**: id сотрудников сохраняются; отделы — по имени (`deptManagers` даёт руководителей); проекты — из `settings.projects` (участники по `projectId`).
4. **Отпуска**: только `vacationRequests` (status approved/pending/rejected переносятся как есть); легаси `vacations[]` сверяется на расхождения и попадает в отчёт, но не в данные.
5. **Пароли**: всем — одноразовые `changeme-<код>`; первый вход требует смены.
6. **Сверка**: отчёт «до/после» — численность, сумма дней по сотрудникам, количество заявок по статусам. Расхождение = 0 — критерий приёмки E10-01.
7. **Откат**: миграция исполняется в транзакции на копии БД; при ошибке — полный откат, рабочая БД не меняется.

## 7. Порядок изменения схемы

1. Новая миграция — новый файл `migrations/NNN-*.sql` с `up`/`down`.
2. Изменение существующей колонки — в два шага: добавить новую, мигрировать данные, удалить старую в следующем выпуске.
3. Миграция, меняющая данные, пишет `audit_events` (`migration.completed`).
