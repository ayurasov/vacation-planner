# AGENTS.md — правила для ИИ-ассистентов и разработчиков

## Проект

Корпоративный планировщик отпусков (до 500 сотрудников): сервер Node.js/Express/SQLite, SPA-клиент на ванильном JS.
Источник истины — `contracts/openapi-vacation-api-v1.yaml` и документы `docs/specs/01-architecture.md`, `02-api-spec.md`, `04-data-model.md`.

## Стек и версии

- Node.js 20+ (CI проверяет 20 и 22), CommonJS на сервере, ES-модули на фронтенде (`public/src/`, этап 1)
- Express 4.21, better-sqlite3 11 (SQLite WAL), ajv для валидации по контракту (этап 1)
- Тесты: встроенный `node:test` + `fetch`; линтер ESLint 9
- Новые зависимости не добавлять без задачи и записи в `docs/decisions.md`

## Команды

- `npm start` — сервер на :3000 (БД `data.db`, при пустой — из `seed.json`)
- `npm test` — тесты (используют временную БД, не трогают data.db)
- `npm run lint` — ESLint
- `npm run contract:check` — структурная проверка OpenAPI-контракта
- Перед сообщением о готовности: `npm run lint && npm test && npm run contract:check` — всё зелёное

## Структура

```text
src/app.js        сборка Express; src/db.js — схема и слой данных этапа 0
src/domain/       домены этапа 1: employees, requests, balance, schedule, directories, calendar, audit, notify
src/api/          HTTP-слой: валидация, маппинг ошибок RFC 9457
src/infra/        clock.js (время), random.js (случайность)
test/unit/        тесты доменов (без HTTP); test/api/ — HTTP-тесты
public/           SPA-клиент; public/src/ — модули этапа 1
migrations/       нумерованные SQL-миграции (up/down)
scripts/          служебные скрипты (валидация контракта, миграция stage0)
```

## Жёсткие правила

1. Не изменять `contracts/` и `docs/specs/` — только через ревью владельца (CODEOWNERS). Если для задачи «не хватает» контракта — остановись и задай вопрос.
2. Бизнес-логика только в `src/domain/`. Роуты тонкие: валидация → домен → problem+json.
3. Домены не импортируют express/node:http и друг друга (кроме явных сервисов чтения).
4. Время — только через `src/infra/clock.js`; `new Date()`/`Date.now()` в доменах запрещены.
5. Идентификаторы — из БД (AUTOINCREMENT). `Date.now()` как id запрещён.
6. Изменение данных и запись `audit_events` — в одной транзакции.
7. Пароли: только scrypt-хеши; в журналах, тестах, ответах API и выгрузках паролей и токенов нет.
8. Ошибки API — только problem+json с кодом из каталога `docs/specs/02-api-spec.md` раздел 7. Коды не придумывать.
9. Ответы API — только добавляющие изменения; поля не удалять и не переименовывать.
10. Фронтенд: fetch только в `public/src/api/client.js`; вывод данных — через `esc()`, прямое `innerHTML` с данными запрещено.
11. Тесты — на временную БД (`DB_PATH` в tmp); `data.db` не трогать и не коммитить.
12. Одна история бэклога — одна ветка `story/<id>` и один PR по шаблону.

## Как выполнять задачу

1. Прочитай задачу, указанные разделы docs/ и контракта. Что неясно — задай вопрос, не угадывай.
2. Напиши тесты по критериям приёмки, запусти — должны падать.
3. Реализуй минимальный код, проходящий тесты.
4. `npm run lint && npm test && npm run contract:check` — исправь всё.
5. Обнови CHANGELOG.md и, если меняется поведение, — заявку на изменение docs/ в PR (меняет человек).
6. В PR: что сделано, как проверено, решения, что осталось.

## Модули с обязательным ревью человека

`src/auth/`, `migrations/`, `scripts/migrate-stage0.mjs`, `contracts/`, `docs/specs/`, `.github/workflows/`, любые изменения матрицы прав.
