-- Структура компании по образцу «По Делу» (v1.1.0, E70-01, ADR-018): дерево подразделений с видом уровня,
-- порядком и внешним идентификатором; название уникально среди соседей, а не во всей организации.
-- Данные не меняются: существующие отделы становятся подразделениями верхнего уровня вида «Отдел».

ALTER TABLE "departments"
  ADD COLUMN "parent_id" INTEGER,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'department',
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "org_source" TEXT NOT NULL DEFAULT 'manual';

-- Подразделение с вложенными удаляется только после них (как в «По Делу»)
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");
CREATE INDEX "departments_external_id_idx" ON "departments"("external_id");

DROP INDEX "departments_name_key";
CREATE UNIQUE INDEX "departments_parent_name_key" ON "departments"(COALESCE("parent_id", 0), lower("name"));

-- Сотрудник: внешний идентификатор (табельный номер другой системы, objectGUID), источник записи,
-- «первое лицо» — никому не подчиняется: по его заявкам решает администратор
ALTER TABLE "employees"
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "org_source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "reports_to_none" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "employees_external_id_idx" ON "employees"("external_id");

-- Виды уровней структуры (NULL — виды по умолчанию, как в «По Делу») и наибольшая глубина
ALTER TABLE "org_settings"
  ADD COLUMN "unit_kinds" JSONB,
  ADD COLUMN "org_max_depth" INTEGER NOT NULL DEFAULT 15;
