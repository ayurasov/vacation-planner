-- v0.6.0 (E61): замещение руководителя и эскалация заявок без решения.

-- Замещение: на период руководитель передаёт согласование заместителю (свои права сохраняет).
CREATE TABLE "approval_delegations" (
  "id" SERIAL NOT NULL,
  "manager_id" INTEGER NOT NULL,
  "deputy_id" INTEGER NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "created_by" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_delegations_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approval_delegations_deputy_id_fkey" FOREIGN KEY ("deputy_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approval_delegations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "approval_delegations_dates" CHECK ("start_date" <= "end_date"),
  CONSTRAINT "approval_delegations_not_self" CHECK ("manager_id" <> "deputy_id")
);
CREATE INDEX "approval_delegations_deputy_id_end_date_idx" ON "approval_delegations" ("deputy_id", "end_date");
CREATE INDEX "approval_delegations_manager_id_end_date_idx" ON "approval_delegations" ("manager_id", "end_date");

-- Эскалация: с какого момента заявка ждёт решения и кому передана.
ALTER TABLE "vacation_requests"
  ADD COLUMN "pending_since" TIMESTAMPTZ(6),
  ADD COLUMN "escalated_to" INTEGER,
  ADD COLUMN "escalated_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "vacation_requests_escalated_to_fkey" FOREIGN KEY ("escalated_to") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "vacation_requests_escalated_to_idx" ON "vacation_requests" ("escalated_to");

-- Через сколько дней без решения заявка передаётся вышестоящему руководителю; 0 — не передаётся.
ALTER TABLE "org_settings" ADD COLUMN "escalation_days" INTEGER NOT NULL DEFAULT 0;

-- Ждущие решения до v0.6.0 — с момента последнего изменения. Последним оператором: UPDATE запускает
-- отложенный триггер версии данных, и после него ALTER/CREATE INDEX на этой таблице в той же
-- транзакции падают с «pending trigger events» (так и было на стенде с демо-заявками).
UPDATE "vacation_requests" SET "pending_since" = "updated_at" WHERE "status" = 'pending';
