# О документе

Документ описывает модель данных «Планировщика отпусков»: сущности и связи, словарь данных, инварианты и способ их обеспечения, производственный календарь, миграцию данных прототипа и правила изменения схемы.

Единственный источник DDL — `server/prisma/schema.prisma`; SQL-миграции — `server/prisma/migrations/`. Словарь данных ниже сформирован из схемы автоматически (`tools/docs/gen_tables.py`).

# Обзор

Данные хранятся в PostgreSQL 17 в 18 таблицах трёх групп:

| Группа | Таблицы | Назначение |
|---|---|---|
| Организация | `employees`, `departments`, `projects`, `groups`, `group_members` | Кто работает, в каком отделе и проекте, кто чей руководитель |
| Отпуска и режим | `vacation_requests`, `request_events`, `notifications`, `work_patterns`, `work_overrides` | Заявки с историей, уведомления, офис и удалёнка |
| Служебные | `audit_events`, `refresh_tokens`, `org_settings`, `calendars`, `email_outbox`, `job_runs`, `data_version`, `login_attempts` | Журнал изменений, сессии, правила организации, праздники, очередь писем, плановые задачи, версия данных графика, окна лимита входа |

## Организация

![ER: сотрудники, отделы, проекты, группы](../images/er-org.png)

Руководитель сотрудника (`employees.manager_id`) согласует его заявки и управляет его режимом работы. Признак `is_hr` даёт права кадровой службы, `email` и `email_notifications` — адрес и согласие на письма. Руководитель отдела (`departments.manager_id`) выгружает отпуска отдела. Сотрудник не удаляется физически: увольнение снимает признак `is_active`, история отпусков и журнал сохраняются.

## Отпуска и режим работы

![ER: заявки, история, уведомления, режим работы](../images/er-requests.png)

Заявка хранит актуальные даты; при переносе согласованного отпуска прежние даты лежат в `change_from_start/end` до решения руководителя. Запрос удаления — флаг `pending_deletion`. История действий по заявке — `request_events` (только дополняется). Режим работы: недельный шаблон `work_patterns` (день недели → офис/удалёнка/не работает) и разовые исключения `work_overrides` на даты.

## Служебные данные

![ER: аудит, сессии, настройки, календарь](../images/er-system.png)

# Словарь данных

<!-- BEGIN:data-dictionary -->
**`employees`** — Сотрудники: учётные записи, роли, нормы дней

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `login` | String | UK |  |
| `password_hash` | String |  |  |
| `pw_version` | Int |  |  |
| `name` | String |  |  |
| `email` | String | null | уникальность без учёта регистра — частичным индексом в миграции employee_email |
| `position` | String | null |  |
| `dept_id` | Int | null |  |
| `role` | String |  | employee \| manager |
| `is_admin` | Boolean |  |  |
| `is_hr` | Boolean |  | кадровая служба: сотрудники, календарь, импорт, выгрузки, аудит |
| `emp_type` | String |  | staff \| ipsz |
| `manager_id` | Int | null |  |
| `projectId` | Int | null |  |
| `planned_days` | Float |  |  |
| `carry_over` | Float |  |  |
| `is_active` | Boolean |  |  |
| `email_notifications` | Boolean |  | отписка — в профиле |
| `must_change_password` | Boolean |  | пароль выдан при создании или сбросе (v0.6.0) |
| `password_changed_at` | DateTime | null |  |
| `personnel_number` | String | UK null | табельный номер — графа 4 формы Т-7 (v0.6.0) |
| `created_at` | DateTime |  |  |
| `updated_at` | DateTime |  |  |

**`departments`** — Отделы и их руководители

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `name` | String | UK |  |
| `manager_id` | Int | null |  |

**`projects`** — Проекты и руководители проектов

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `name` | String | UK |  |
| `manager_id` | Int | null |  |

**`groups`** — Личные группы для фильтров графика

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `owner_id` | Int |  |  |
| `name` | String |  |  |

**`group_members`** — Состав личных групп

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `group_id` | Int |  |  |
| `employee_id` | Int |  |  |

**`vacation_requests`** — Заявки на отпуск и их состояние

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `employee_id` | Int |  |  |
| `start_date` | DateTime |  |  |
| `end_date` | DateTime |  |  |
| `type` | RequestType |  |  |
| `status` | RequestStatus |  |  |
| `pending_deletion` | Boolean |  |  |
| `change_from_start` | DateTime | null |  |
| `change_from_end` | DateTime | null |  |
| `comment` | String | null |  |
| `rejection_comment` | String | null |  |
| `created_by` | Int |  |  |
| `created_at` | DateTime |  |  |
| `updated_at` | DateTime |  |  |
| `pending_since` | DateTime | null |  |
| `escalated_to` | Int | null |  |
| `escalated_at` | DateTime | null |  |

**`request_events`** — История действий по заявке

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `request_id` | Int |  |  |
| `ts` | DateTime |  |  |
| `actor_id` | Int | null |  |
| `action` | String |  |  |
| `comment` | String | null |  |

**`work_patterns`** — Недельный шаблон офис/удалёнка

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `employee_id` | Int |  |  |
| `weekday` | Int |  | 0 (вс) … 6 (сб) |
| `mode` | WorkMode |  |  |

**`work_overrides`** — Разовые исключения режима работы

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `employee_id` | Int |  |  |
| `date` | DateTime |  |  |
| `mode` | WorkMode |  |  |

**`org_settings`** — Правила организации (одна строка)

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `conflict_threshold` | Int |  |  |
| `timezone` | String |  |  |
| `limit_policy` | String |  | hard \| soft |
| `default_planned_days` | Int |  |  |
| `password_min_length` | Int |  |  |
| `lockout_threshold` | Int |  | неудачных попыток подряд; 0 — без блокировки |
| `lockout_minutes` | Int |  |  |
| `login_retention_days` | Int |  |  |
| `escalation_days` | Int |  |  |
| `notice_days` | Int |  |  |
| `org_name` | String | null |  |
| `org_okpo` | String | null |  |
| `head_position` | String | null |  |
| `head_name` | String | null |  |
| `hr_head_position` | String | null |  |
| `hr_head_name` | String | null |  |

**`calendars`** — Производственный календарь по годам

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `year` | Int | PK |  |
| `holidays` | Json |  | ["2026-01-01", …] |
| `transfers` | Json |  | [{"from":"2026-01-03","to":"2026-01-09"}, …] |

**`notifications`** — Уведомления пользователей

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `employee_id` | Int |  |  |
| `kind` | String |  |  |
| `text` | String |  |  |
| `payload` | Json | null |  |
| `is_read` | Boolean |  |  |
| `created_at` | DateTime |  |  |

**`audit_events`** — Неизменяемый журнал изменений

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `ts` | DateTime |  |  |
| `actor_id` | Int | null |  |
| `action` | String |  |  |
| `entity` | String |  |  |
| `entity_id` | String |  |  |
| `before` | Json | null |  |
| `after` | Json | null |  |

**`refresh_tokens`** — Хеши refresh-токенов (ротация, отзыв); цепочка одного входа — сеанс

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `user_id` | Int |  |  |
| `token_hash` | String | UK |  |
| `expires_at` | DateTime |  |  |
| `revoked_at` | DateTime | null |  |
| `created_at` | DateTime |  |  |
| `session_id` | String |  |  |
| `session_started_at` | DateTime |  |  |
| `method` | String |  | password \| oidc |
| `ip` | String | null |  |
| `user_agent` | String | null |  |

**`login_state`** — Состояние входа сотрудника: последний вход, неудачные попытки подряд, блокировка

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `employee_id` | Int | PK |  |
| `last_login_at` | DateTime | null |  |
| `failed_logins` | Int |  |  |
| `locked_until` | DateTime | null |  |

**`login_events`** — Журнал входов: успешные и неуспешные попытки, блокировки; срок хранения — правило организации

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `ts` | DateTime |  |  |
| `employee_id` | Int | null |  |
| `login` | String |  |  |
| `result` | String |  |  |
| `method` | String |  |  |
| `ip` | String | null |  |
| `user_agent` | String | null |  |

**`email_outbox`** — Очередь писем (outbox): пишется в транзакции события, отправляется фоном с повторами

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `employee_id` | Int | null |  |
| `to_address` | String |  |  |
| `kind` | String |  |  |
| `subject` | String |  |  |
| `body` | String |  |  |
| `status` | String |  | pending \| sent \| failed |
| `attempts` | Int |  |  |
| `next_attempt_at` | DateTime |  |  |
| `last_error` | String | null |  |
| `created_at` | DateTime |  |  |
| `sent_at` | DateTime | null |  |

**`job_runs`** — Отметки плановых задач: строка (задача, период) — задача за период уже выполнена

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `name` | String |  |  |
| `period` | String |  |  |
| `ran_at` | DateTime |  |  |

**`data_version`** — Версия данных графика: 16 строк-счётчиков, увеличиваются триггерами; версия — сумма

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `shard` | Int | PK |  |

**`login_attempts`** — Окна лимита входа по минутам (нежурналируемая таблица, общая для всех процессов)

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `key` | String |  |  |
| `window_start` | DateTime |  |  |
| `hits` | Int |  |  |

**`approval_delegations`** — Замещение руководителя: заместитель согласует заявки его команды на период

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `manager_id` | Int |  |  |
| `deputy_id` | Int |  |  |
| `start_date` | DateTime |  |  |
| `end_date` | DateTime |  |  |
| `created_by` | Int | null |  |
| `created_at` | DateTime |  |  |
| `revoked_at` | DateTime | null |  |

**`vacation_notices`** — Извещения о начале отпуска под подпись (ст. 123 ТК РФ): отправка, ознакомление, отзыв

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `id` | Int | PK |  |
| `request_id` | Int |  |  |
| `employee_id` | Int |  |  |
| `start_date` | DateTime |  |  |
| `end_date` | DateTime |  |  |
| `days` | Float |  | дни отпуска без праздников (ст. 120) |
| `sent_at` | DateTime |  |  |
| `late` | Boolean |  | позже чем за 14 дней: отпуск согласован поздно |
| `acknowledged_at` | DateTime | null |  |
| `withdrawn_at` | DateTime | null | отпуск отменён или перенесён |

**`planning_campaigns`** — Кампания планирования отпусков на год: срок, открытие и закрытие, напоминания

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `year` | Int | PK |  |
| `deadline` | DateTime |  |  |
| `opened_at` | DateTime |  |  |
| `opened_by` | Int | null |  |
| `closed_at` | DateTime | null |  |
| `closed_by` | Int | null |  |
| `reminded_at` | DateTime | null |  |
| `auto_reminded` | Boolean |  |  |

**`schedule_approvals`** — Утверждённый график отпусков: реквизиты документа, мнение профсоюза, снимок строк для формы Т-7

| Поле | Тип | Признаки | Примечание |
|---|---|---|---|
| `year` | Int | PK |  |
| `doc_number` | String |  |  |
| `doc_date` | DateTime |  |  |
| `union_opinion_date` | DateTime | null |  |
| `union_opinion_number` | String | null |  |
| `approved_at` | DateTime |  |  |
| `approved_by` | Int | null |  |
| `rows` | Json |  |  |
<!-- END:data-dictionary -->

# Инварианты

| Инвариант | Где обеспечивается | Ответ при нарушении |
|---|---|---|
| `start_date ≤ end_date`, даты в формате `YYYY-MM-DD`, не в прошлом (кроме администратора) | Сервис заявок | `400 validation/bad-date-range` |
| Активные (`pending`, `approved`) заявки одного сотрудника не пересекаются | Сервис заявок под блокировкой строки сотрудника (`SELECT … FOR UPDATE`): одновременные запросы проверяются по очереди | `409 overlapping-request` |
| При жёсткой политике лимита заявка не превышает «доступно» = норма − согласованные − на согласовании дни (без праздников) | Сервис заявок под той же блокировкой | `409 limit-exceeded` |
| Решение по заявке применяется один раз | Блокировка строки заявки и повторное чтение в транзакции | `409 stale-state` |
| У отклонённого или согласованного переноса нет `change_from_*` | Сервис заявок | — |
| Статусы, типы и режимы — только из перечислений | Типы `enum` PostgreSQL | ошибка БД |
| Уникальность логина, названия отдела и проекта, группы у владельца | Уникальные индексы | `400 validation/invalid-field` |
| Email сотрудника уникален без учёта регистра | Частичный уникальный индекс `lower(email)`; проверка в сервисе | `400 validation/invalid-field`; гонка — `409 stale-state` |
| Письмо создаётся только вместе с событием | `email_outbox` пишется в транзакции уведомления (outbox) | — |
| Письмо отправляется один раз | Разбор очереди с `FOR UPDATE SKIP LOCKED` и арендой; сводка — строка `job_runs (name, period)` | — |
| Кадровая служба не выдаёт себе и другим служебные роли | Сервис сотрудников и план импорта | `403 auth/forbidden` |
| В системе остаётся хотя бы один администратор | Сервис сотрудников | `409 last-admin` |
| Отдел с сотрудниками не удаляется | Контроллер справочников | `409 department-not-empty` |
| Изменение данных и запись журнала неразделимы | Одна транзакция Prisma; в API нет изменения и удаления журнала | — |
| Пароль не хранится и не возвращается | Только scrypt-хеш; DTO ответа без хеша | — |
| Версия данных растёт при любом изменении графика | Отложенные триггеры `AFTER INSERT/UPDATE/DELETE … DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` (и `AFTER TRUNCATE` на оператор) на `vacation_requests`, `employees`, `departments`, `projects`, `work_patterns`, `work_overrides`, `org_settings` вызывают `bump_data_version()` при фиксации той же транзакции | — |
| Кэшированный ответ графика не опережает данные | Сервер читает версию до данных; кэш и ETag — по прочитанной версии | — |

# Индексы

| Таблица | Индекс | Под какой запрос |
|---|---|---|
| `vacation_requests` | `(employee_id, status)` | Заявки сотрудника, проверка пересечений и лимита |
| `vacation_requests` | `(start_date, end_date)` | График и аналитика за период |
| `employees` | `(dept_id)`, `(manager_id)`, `(is_active)` | Фильтры графика, подчинённые, активные |
| `notifications` | `(employee_id, is_read, created_at)` | Колокольчик: непрочитанные по дате |
| `audit_events` | `(entity, entity_id, ts)`, `(actor_id)` | Журнал по объекту и по автору |
| `request_events` | `(request_id)` | История заявки |
| `email_outbox` | `(status, next_attempt_at)` | Выбор писем к отправке |
| `employees` | `lower(email)` уникальный частичный | Поиск и уникальность адреса |
| `login_attempts` | `(key, window_start)` первичный, `(window_start)` | Счётчик окна при входе; очистка старых окон |

# Служебные таблицы масштабирования

Таблицы v0.5.0 обслуживают работу нескольких процессов и экземпляров сервера (ADR-012) и бизнес-данных не содержат.

**Версия данных графика (`data_version`).** Шестнадцать строк `(shard, version)`. Функция `bump_data_version()` увеличивает строку `shard = pg_backend_pid() % 16`: параллельные транзакции из разных соединений почти всегда обновляют разные строки и не ждут друг друга (с одной строкой p95 записи под нагрузкой вырос с 252 до 487 мс). Версия — `sum(version)`; она только растёт, поэтому годится для ETag и ключа кэша.

Триггеры отложенные: счётчик увеличивается в фазе фиксации и один раз за транзакцию (флаг `vp.data_version_bumped` с номером транзакции), сколько бы строк она ни изменила; оператор, не изменивший строк, версию не меняет. Поэтому строка счётчика заблокирована только на время фиксации. В первой редакции (триггеры на оператор) строка блокировалась сразу и до конца транзакции, и при совпадении строк счётчика две подачи заявок взаимно блокировались (`40P01`, найдено 15-минутным нагрузочным прогоном; миграция `data_version_on_commit`).

**Окна лимита входа (`login_attempts`).** Строка `(key, window_start, hits)` на ключ «адрес + логин» или «адрес» и минуту по часам БД. Вход увеличивает оба счётчика одним запросом (`INSERT … ON CONFLICT DO UPDATE`) и оценивает частоту скользящим окном: `hits + прошлая минута × доля, ещё не вышедшая из окна`. Таблица нежурналируемая (`UNLOGGED`): не пишется в WAL и не реплицируется, после аварийного перезапуска PostgreSQL очищается — для минутных счётчиков это допустимо. Окна старше 5 минут удаляются не чаще раза в 5 минут.

# Производственный календарь

Таблица `calendars` хранит по году два разных понятия:

| Поле | Что это | Где влияет |
|---|---|---|
| `holidays` | Нерабочие праздничные дни ст. 112 ТК РФ | Не входят в дни отпуска (ст. 120); подсвечиваются на графике |
| `transfers` | Переносы выходных `{ from, to }`: день `to` становится выходным; `from`, если это выходной и не праздник, — рабочим | Рабочие дни в аналитике, фон графиков; в дни отпуска перенесённый выходной входит |

Праздник, выпавший на выходной, переносится на следующий рабочий день (ст. 112 ч. 2) — это перенос, а не праздник. Например, в 2026 году 9 мая (суббота) — праздник, а 11 мая (понедельник) — перенесённый выходной: отпуск 4–17 мая расходует 13 дней — исключается только 9 мая.

Календарь ведёт кадровая служба в «Справочниках»: отмечает праздники в сетке года и переносы или загружает файл открытых данных xmlcalendar.ru. Если календарь года не загружен, дни считаются календарными без исключений.

**Исправление v0.4.0.** Демо-календарь версий 0.1–0.3 смешивал праздники с выходными и перенесёнными днями (13–14 июня, 10 мая, 9 января и другие не входили в дни отпуска). Миграция `20261029091000_calendar_holidays_by_law` заменяет календари 2026 и 2027 годов на законные — только если они совпадают с демо-набором, изменённые вручную не трогает.

# Миграция данных прототипа

`server/prisma/seed.ts` переносит снимок прототипа (`server/prisma/seed-data/seed.json`):

| Данные | Результат |
|---|---|
| 131 сотрудник | Идентификаторы и логины сохранены; пароли — scrypt-хеши демо-значений (при эксплуатационной миграции — сброс на одноразовые) |
| 14 отделов | Созданы из строковых названий; руководители — из словаря `deptManagers` |
| 268 заявок | Перенесены со статусами, переносами и запросами удаления |
| Недельные шаблоны | Перенесены в `work_patterns` |

Seed идемпотентен: повторный запуск не дублирует заявки (совпадение сотрудника, дат и типа) и ничего не удаляет, поэтому безопасен для рабочей базы. Для демонстрационного стенда seed добавляет несколько заявок на согласовании относительно текущей даты; переменная `SEED_DEMO=0` отключает их.

# Изменение схемы

1. Изменение `schema.prisma` → `npx prisma migrate dev --name <суть>`; SQL миграции проходит ревью человека (CODEOWNERS).
2. Деструктивные изменения — в два выпуска: сначала новое поле и перенос данных, затем удаление старого.
3. Миграции применяются автоматически при старте контейнера `server` (`prisma migrate deploy`); откат — восстановление резервной копии (руководство по развёртыванию).
4. CI применяет миграции к чистой PostgreSQL перед тестами: рассинхронизация схемы и миграций ломает сборку.
5. После изменения схемы обновляются ER-схемы (`docs/diagrams/er-*.mmd`) и словарь данных (`tools/docs/gen_tables.py`).
