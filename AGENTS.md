# AGENTS.md — правила для ИИ-ассистентов и разработчиков

## Проект

Корпоративный планировщик отпусков (масштаб 1000–5000 пользователей). Монорепо:
`server/` — NestJS 11 + TypeScript strict + Prisma 6 + PostgreSQL 17; `web/` — Vue 3 + Vite + TS + Pinia.
Источник истины — `contracts/openapi-vacation-api-v1.yaml`, `docs/specs/01-architecture.md`, `docs/specs/02-api-spec.md`, `server/prisma/schema.prisma`.

## Версионирование

- Формат `v0.x.y` до релиза; работа — в ветке версии (`v0.1.0`), `main` — только смёрженные версии с тегом.
- Каждый выпуск: запись в `docs/versions.md` (авторство) и `CHANGELOG.md` (технически).

## Команды

- `make up` — PostgreSQL; `make seed` — миграции + демо-данные
- `make server-dev` / `make web-dev` — разработка
- `make test` — e2e сервера (тестовая БД vacation_test); `cd web && npm run test` — тесты клиента
- `make lint` — ESLint обоих пакетов
- `make sbom` — SBOM + отчёт лицензий; copyleft/unknown — блокер
- Перед сообщением о готовности: lint + test + build зелёные

## Структура сервера

- `src/<домен>/` — controller (тонкие: DTO-валидация → сервис → problem+json) + service (логика)
- `src/infra/` — PrismaService, ProblemException/RFC 9457
- `prisma/schema.prisma` — схема; изменения через `prisma migrate dev` с ревью SQL
- Тесты: `test/*.e2e.test.ts` (supertest; фикстуры в `test/helpers.ts`)

## Структура клиента

- `web/src/api/client.ts` — единственный модуль с fetch; типы ответов — здесь же по контракту
- `web/src/styles/tokens.css` — дизайн-токены (light/dark); паттерны — `base.css`
- Никаких компонентных библиотек; данные пользователя в шаблонах — через интерполяцию Vue (автоэкранирование), `v-html` запрещён

## Жёсткие правила

1. `contracts/` и `docs/specs/` — только через ревью владельца (CODEOWNERS). Не хватает контракта — остановись и спроси (P12).
2. Бизнес-логика — в сервисах NestJS; контроллеры тонкие; чистые вычисления (баланс, интервалы) — в модулях без БД.
3. Время — через параметры/инъекцию; `new Date()` в сервисах допустим только для «сейчас» в точке входа; тестируемые расчёты принимают даты аргументами.
4. Изменение данных + `audit_events` — в одной prisma-транзакции (`$transaction`).
5. Ошибки API — только problem+json с кодом из каталога (документ 2, раздел 7). Коды не придумывать.
6. Пароли: только `auth/passwords.ts` (scrypt); секреты — из окружения (`JWT_SECRET` ≥ 32); в логи/ответы/выгрузки пароли и токены не попадают.
7. Новые npm-зависимости — обоснование в `docs/decisions.md` + зелёный SBOM-отчёт (copyleft/unknown — блокер).
8. Фронтенд: токен в памяти, refresh через httpOnly-cookie (клиент это делает сам); доступ к API — только через `api/client.ts`.
9. Тесты используют тестовую БД (`vitest.config.ts` env); рабочую БД не трогать.
10. Одна история/задача — один PR по шаблону; ветки `story/<id>` от ветки версии.

## Как выполнять задачу

1. Прочитай задачу, разделы docs/, контракт. Неясно — спроси.
2. Тесты по критериям приёмки (красные) → минимальная реализация → зелёные.
3. `make lint`, `make test`, сборка обоих пакетов; при зависимостях — `make sbom`.
4. CHANGELOG/versions.md при выпуске; заявка на изменение docs/ — в PR.
5. В PR: что сделано / как проверено / решения / что осталось.

## Обязательное ревью человека

`server/src/auth/`, `prisma/migrations/`, `contracts/`, `docs/specs/`, `.github/workflows/`, матрица прав, `scripts/license-report.mjs`, любые зависимости.
