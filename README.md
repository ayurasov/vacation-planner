# Планировщик отпусков — корпоративная платформа

Внутренний инструмент компании (масштаб 1000 → 5000 пользователей): график отпусков, заявки с согласованием, балансы дней, режимы офис/удалёнка, справочники, аудит. Зрелый стек с первого этапа: **NestJS + PostgreSQL 17 + Vue 3 + Docker**.

**Версия:** v0.1.0 (ветки и теги `v0.x.y`; история и авторство — [docs/versions.md](docs/versions.md)).

## Быстрый старт

```bash
make up          # PostgreSQL (docker)
make seed        # миграции + демо-данные (131 сотрудник)
make server-dev  # API → http://localhost:8080 (docs: /api/docs)
make web-dev     # UI  → http://localhost:5173
```

Полный стенд в контейнерах: `make compose-full` → http://localhost.

Демо-вход администратора: `yurasov.av` / `j2ENXpPi`.

## Проверки

| Команда | Действие |
|---|---|
| `make test` | e2e-тесты API (нужен запущенный `make up`) |
| `make lint` | ESLint (server + web) |
| `make sbom` | CycloneDX SBOM + отчёт лицензий (реестр ОП) |
| `make docs-pdf` | PDF-версии документов |

## Структура

```text
server/   API: NestJS 11 + TS strict + Prisma 6 + PostgreSQL (src/, prisma/, test/)
web/      SPA: Vue 3 + Vite + Pinia + TS (без компонентных библиотек)
contracts/  OpenAPI-контракт v1 (менять только через ревью)
docs/specs/ Комплект документов 00–11; docs/pdf/ — PDF; docs/versions.md — версии
sbom/       CycloneDX (генерируется)
scripts/    Отчёт по лицензиям
tools/      Генератор PDF
```

## CI

GitHub Actions: сборка и тесты server (postgres-сервис) и web, SBOM с блокировкой copyleft-лицензий, сборка docker-образов, дымовой прогон полного стенда. Ветки версий `v0.*`; `main` — только смёрженные версии.

## Документация

| Документ | | Документ | |
|---|---|---|---|
| [00 Ревизия фич](docs/specs/00-feature-audit.md) | as-is/to-be | [06 Правила с ИИ](docs/specs/06-ai-rules.md) | ассистенты |
| [01 Архитектура](docs/specs/01-architecture.md) | платформа | [07 Стенды и CI/CD](docs/specs/07-environments-cicd.md) | выпуск |
| [02 Спецификация API](docs/specs/02-api-spec.md) | протокол | [08 ТЗ](docs/specs/08-tz.md) | требования |
| [03 Бэклог](docs/specs/03-backlog.md) | план | [10 Промпты](docs/specs/10-prompts.md) | итерации |
| [04 Модель данных](docs/specs/04-data-model.md) | схема | [11 SBOM и лицензии](docs/specs/11-sbom-licenses.md) | реестр ОП |
| [05 Тексты сообщений](docs/specs/05-messages.md) | UI-копирайт | [Версии](docs/versions.md) | история/авторство |

Правила для ИИ-ассистентов — [AGENTS.md](AGENTS.md). Лицензии сторонних компонентов — [автоотчёт](docs/sbom/licenses-report.md).
