-- v0.6.0 (E62): журнал входов, временная блокировка, сеансы, политика паролей, одноразовый пароль.

-- Пароль, выданный при создании или сбросе, нужно сменить при первом входе.
-- Меняется только вместе с паролем, поэтому живёт в employees (триггер версии графика срабатывает
-- и так — смена пароля увеличивает pw_version).
ALTER TABLE "employees"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(6);

-- Состояние входа — отдельной таблицей: у employees отложенный триггер версии данных графика,
-- и запись времени входа в employees сбрасывала бы кэш графика на каждом входе (утром — тысячи раз).
CREATE TABLE "login_state" (
  "employee_id" INTEGER NOT NULL,
  "last_login_at" TIMESTAMPTZ(6),
  "failed_logins" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(6),
  CONSTRAINT "login_state_pkey" PRIMARY KEY ("employee_id"),
  CONSTRAINT "login_state_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Журнал входов: успешные и неуспешные попытки, блокировки. Без внешнего ключа на логин:
-- неизвестный логин тоже записывается (перебор логинов виден ИБ).
CREATE TABLE "login_events" (
  "id" BIGSERIAL NOT NULL,
  "ts" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "employee_id" INTEGER,
  "login" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "ip" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "login_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "login_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "login_events_ts_idx" ON "login_events" ("ts" DESC);
CREATE INDEX "login_events_employee_id_ts_idx" ON "login_events" ("employee_id", "ts" DESC);

-- Сеанс — цепочка refresh-токенов одного входа: ротация переносит session_id в новую запись.
-- Активный сеанс — его неотозванный и неистёкший токен (один на цепочку).
ALTER TABLE "refresh_tokens"
  ADD COLUMN "session_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "session_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN "ip" TEXT,
  ADD COLUMN "user_agent" TEXT;
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens" ("session_id");

-- Правила организации: политика паролей, блокировка, срок хранения журнала входов.
ALTER TABLE "org_settings"
  ADD COLUMN "password_min_length" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "lockout_threshold" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "lockout_minutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "login_retention_days" INTEGER NOT NULL DEFAULT 365;
