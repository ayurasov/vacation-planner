# Планировщик отпусков

Корпоративное веб-приложение для планирования и согласования ежегодных отпусков (масштаб 1000 → 5000 пользователей): график отпусков организации, заявки с согласованием руководителем, балансы дней по ТК РФ (праздники не входят в отпуск), аналитика пересечений в отделах и подбор лучших дат, график работы офис/удалёнка, справочники, выгрузки и неизменяемый журнал аудита.

Стек: **NestJS 11 + TypeScript strict + Prisma 6 + PostgreSQL 17**, клиент **Vue 3 + Vite + Pinia** без компонентных библиотек, поставка в **Docker**.

**Версия:** v0.3.0. Ветки и теги `v0.x.y`; `main` — только принятые версии. История и авторство — [docs/versions.md](docs/versions.md), технический журнал — [CHANGELOG.md](CHANGELOG.md).

![График отпусков](docs/images/ui-schedule.png)

## Быстрый старт

```bash
make up          # PostgreSQL в Docker
make seed        # миграции и демо-данные (131 сотрудник, 14 отделов)
make server-dev  # API → http://localhost:8080 (Swagger: /api/docs)
make web-dev     # интерфейс → http://localhost:5173
```

Полный стенд в контейнерах: `make compose-full` → http://localhost (нужен `JWT_SECRET` в `.env`). Установка на сервер организации — [руководство по развёртыванию](docs/manuals/deployment-guide.md).

Демо-вход администратора: `yurasov.av` / `j2ENXpPi`.

## Проверки

| Команда | Что делает |
|---|---|
| `make test` | Модульные и e2e-тесты API на тестовой БД `vacation_test` |
| `cd web && npm test` | Модульные тесты клиента |
| `cd web && npm run e2e` | e2e интерфейса (Playwright, Chromium) |
| `make lint` | ESLint сервера и клиента |
| `make sbom` | SBOM CycloneDX и отчёт лицензий (copyleft и неизвестные — блокер) |
| `make docs` | Комплект документов в PDF и DOCX |

CI — GitHub Actions и Gitea Actions с одинаковым набором: сервер (Node 20 и 22), клиент, e2e интерфейса, SBOM, сборка образов и дымовой прогон стенда; в Gitea — развёртывание стенда после всех проверок.

## Структура

```text
server/      API: src/<домен>/ (controller + service), prisma/ (схема, миграции, seed), test/
web/         SPA: src/views, src/components, src/stores, src/api/client.ts, e2e/
contracts/   OpenAPI-контракт v1 (меняется через ревью владельца)
docs/        specs/ — спецификации, manuals/ — руководства, pdf/ и docx/ — сборки,
             diagrams/ — исходники схем, images/ — схемы и снимки экранов
tools/docs/  Конвейер документов: pandoc → PDF (Chromium) и DOCX; рендер схем
scripts/     Отчёт лицензий
```

## Документация

| Документ | Назначение |
|---|---|
| [Руководство пользователя](docs/manuals/user-guide.md) · [PDF](docs/pdf/user-guide.pdf) | Сотрудник и руководитель |
| [Руководство администратора](docs/manuals/admin-guide.md) · [PDF](docs/pdf/admin-guide.pdf) | Сотрудники, справочники, правила, аудит |
| [Руководство по развёртыванию](docs/manuals/deployment-guide.md) · [PDF](docs/pdf/deployment-guide.pdf) | Установка, обновление, резервное копирование |
| [00 Ревизия функциональности](docs/specs/00-feature-audit.md) | Прототип и платформа по функциям |
| [01 Описание архитектуры](docs/specs/01-architecture.md) | Компоненты, решения, план развития |
| [02 Спецификация API](docs/specs/02-api-spec.md) | Протокол, ошибки, права |
| [03 План развития и бэклог](docs/specs/03-backlog.md) | Версии, истории, критерии приёмки |
| [04 Модель данных](docs/specs/04-data-model.md) | Сущности, словарь данных, инварианты |
| [05 Тексты интерфейса](docs/specs/05-messages.md) | Сообщения, уведомления, ошибки |
| [06 Правила разработки с ИИ](docs/specs/06-ai-rules.md) | Процесс и ограничения ассистентов |
| [07 Стенды, CI/CD и выпуск](docs/specs/07-environments-cicd.md) | Окружения, конвейеры, выпуск |
| [08 Техническое задание](docs/specs/08-tz.md) | Требования и приёмка |
| [10 Промпты итераций](docs/specs/10-prompts.md) | Шаблоны задач для ассистентов |
| [11 SBOM и лицензии](docs/specs/11-sbom-licenses.md) | Состав компонентов для реестра ПО |

PDF и DOCX всех документов — в [docs/pdf](docs/pdf) и [docs/docx](docs/docx). Правила для ИИ-ассистентов — [AGENTS.md](AGENTS.md).

© Александр Юрасов
