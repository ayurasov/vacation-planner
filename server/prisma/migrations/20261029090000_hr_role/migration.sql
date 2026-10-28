-- v0.4.0, E33-01: роль кадровой службы.
-- Добавляющая миграция: признак по умолчанию false, существующие права не меняются.
ALTER TABLE "employees" ADD COLUMN "is_hr" BOOLEAN NOT NULL DEFAULT false;
