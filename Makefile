# Основные сценарии разработки. Полный список — docs/specs/07-environments-cicd.md.
.DEFAULT_GOAL := help

help: ## показать эту справку
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## поднять PostgreSQL
	docker compose up -d postgres

down: ## остановить всё
	docker compose --profile full down

seed: ## миграции + демо-данные (131 сотрудник)
	cd server && npx prisma migrate deploy && npm run db:seed

server-dev: ## сервер с автоперезапуском
	cd server && npm run dev

web-dev: ## фронтенд с горячей перезагрузкой
	cd web && npm run dev

test: ## все тесты (server)
	cd server && npm test

lint: ## линтеры
	cd server && npm run lint
	cd web && npm run lint

sbom: ## SBOM CycloneDX + отчёт по лицензиям
	cd server && npm run sbom
	cd web && npm run sbom
	node scripts/license-report.mjs

docs-diagrams: ## схемы docs/diagrams → docs/images (PNG)
	cd tools/docs && npm ci && node render_diagrams.mjs && python3 optimize_png.py ../../docs/images

docs: ## комплект документов → docs/pdf (PDF) и docs/docx (DOCX)
	cd tools/docs && npm ci && python3 build_docs.py

compose-full: ## полный стенд в контейнерах (нужен JWT_SECRET в .env)
	docker compose --profile full up --build
