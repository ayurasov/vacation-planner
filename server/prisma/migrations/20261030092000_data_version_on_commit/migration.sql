-- v0.5.0: версия данных увеличивается при фиксации транзакции и один раз на транзакцию.
--
-- Триггеры на оператор (20261030090000_data_version) обновляли строку счётчика сразу и держали
-- её блокировку до конца транзакции. Две транзакции, чьи соединения попали в одну строку
-- (pg_backend_pid() % 16), под нагрузкой взаимно блокировались: первая ждала строку сотрудника,
-- захваченную второй, а вторая — строку счётчика первой (40P01 deadlock при подаче заявки).
-- Отложенный триггер обновляет счётчик в фазе фиксации, когда транзакция больше ничего не ждёт.
-- Заодно оператор, не изменивший ни одной строки, больше не меняет версию.
DROP TRIGGER "vacation_requests_data_version" ON "vacation_requests";
DROP TRIGGER "employees_data_version" ON "employees";
DROP TRIGGER "departments_data_version" ON "departments";
DROP TRIGGER "projects_data_version" ON "projects";
DROP TRIGGER "work_patterns_data_version" ON "work_patterns";
DROP TRIGGER "work_overrides_data_version" ON "work_overrides";
DROP TRIGGER "org_settings_data_version" ON "org_settings";

CREATE OR REPLACE FUNCTION "bump_data_version"() RETURNS trigger AS $$
BEGIN
  -- Отложенный триггер срабатывает на каждую изменённую строку; счётчик — один раз за транзакцию
  IF current_setting('vp.data_version_bumped', true) = txid_current()::text THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('vp.data_version_bumped', txid_current()::text, true);
  UPDATE "data_version" SET "version" = "version" + 1 WHERE "shard" = pg_backend_pid() % 16;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

-- Изменение строк — отложенный триггер (выполняется при фиксации); TRUNCATE — сразу на оператор,
-- отложенных триггеров для него в PostgreSQL нет
CREATE CONSTRAINT TRIGGER "vacation_requests_data_version" AFTER INSERT OR UPDATE OR DELETE ON "vacation_requests"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();
CREATE CONSTRAINT TRIGGER "employees_data_version" AFTER INSERT OR UPDATE OR DELETE ON "employees"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();
CREATE CONSTRAINT TRIGGER "departments_data_version" AFTER INSERT OR UPDATE OR DELETE ON "departments"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();
CREATE CONSTRAINT TRIGGER "projects_data_version" AFTER INSERT OR UPDATE OR DELETE ON "projects"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();
CREATE CONSTRAINT TRIGGER "work_patterns_data_version" AFTER INSERT OR UPDATE OR DELETE ON "work_patterns"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();
CREATE CONSTRAINT TRIGGER "work_overrides_data_version" AFTER INSERT OR UPDATE OR DELETE ON "work_overrides"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();
CREATE CONSTRAINT TRIGGER "org_settings_data_version" AFTER INSERT OR UPDATE OR DELETE ON "org_settings"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();

CREATE TRIGGER "vacation_requests_data_version_truncate" AFTER TRUNCATE ON "vacation_requests"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "employees_data_version_truncate" AFTER TRUNCATE ON "employees"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "departments_data_version_truncate" AFTER TRUNCATE ON "departments"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "projects_data_version_truncate" AFTER TRUNCATE ON "projects"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "work_patterns_data_version_truncate" AFTER TRUNCATE ON "work_patterns"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "work_overrides_data_version_truncate" AFTER TRUNCATE ON "work_overrides"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
CREATE TRIGGER "org_settings_data_version_truncate" AFTER TRUNCATE ON "org_settings"
  FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
