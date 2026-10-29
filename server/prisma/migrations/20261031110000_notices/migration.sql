-- v0.6.0 (E60-03/04): извещение о начале отпуска не позднее чем за две недели (ТК РФ, ст. 123).

-- Извещение по согласованному отпуску на конкретные даты: перенос на новые даты — новое извещение.
CREATE TABLE "vacation_notices" (
  "id" SERIAL NOT NULL,
  "request_id" INTEGER NOT NULL,
  "employee_id" INTEGER NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "days" DOUBLE PRECISION NOT NULL,
  "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "late" BOOLEAN NOT NULL DEFAULT false,
  "acknowledged_at" TIMESTAMPTZ(6),
  -- Отпуск отменён или перенесён на другие даты: извещение остаётся в журнале как история
  "withdrawn_at" TIMESTAMPTZ(6),
  CONSTRAINT "vacation_notices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vacation_notices_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vacation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "vacation_notices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "vacation_notices_request_id_start_date_key" ON "vacation_notices" ("request_id", "start_date");
CREATE INDEX "vacation_notices_start_date_idx" ON "vacation_notices" ("start_date");
CREATE INDEX "vacation_notices_employee_id_idx" ON "vacation_notices" ("employee_id");

-- За сколько дней до начала отпуска извещать (не меньше 14 — ст. 123 ТК РФ).
ALTER TABLE "org_settings" ADD COLUMN "notice_days" INTEGER NOT NULL DEFAULT 14;
