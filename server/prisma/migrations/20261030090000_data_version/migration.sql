-- v0.5.0, E41: версия данных графика. Любое изменение таблиц, из которых строится график,
-- увеличивает счётчик в той же транзакции (триггер на оператор). Сервер кэширует ответ графика
-- по версии и отдаёт ETag: повторное открытие без изменений — 304 без пересчёта.
-- Счётчик транзакционный: изменение версии видно только после фиксации, поэтому прочитанная
-- до запроса версия никогда не опережает данные — кэш не становится устаревшим.
-- Счётчик разбит на 16 строк (по номеру соединения), версия — их сумма: одна общая строка
-- держала бы блокировку до конца каждой пишущей транзакции и выстраивала все записи в очередь.
CREATE TABLE "data_version" (
    "shard" INTEGER NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "data_version_pkey" PRIMARY KEY ("shard"),
    CONSTRAINT "data_version_shard_range" CHECK ("shard" BETWEEN 0 AND 15)
);
INSERT INTO "data_version" ("shard", "version") SELECT s, 0 FROM generate_series(0, 15) AS s;

CREATE FUNCTION "bump_data_version"() RETURNS trigger AS $$
BEGIN
  UPDATE "data_version" SET "version" = "version" + 1 WHERE "shard" = pg_backend_pid() % 16;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "vacation_requests_data_version" AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "vacation_requests"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "employees_data_version" AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "employees"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "departments_data_version" AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "departments"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "projects_data_version" AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "projects"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "work_patterns_data_version" AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "work_patterns"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "work_overrides_data_version" AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "work_overrides"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "org_settings_data_version" AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "org_settings"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
