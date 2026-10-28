-- v0.4.0, E32: письма о заявках и решениях. Очередь пишется в той же транзакции, что и
-- событие (outbox): письмо не теряется при сбое почты и не уходит при откате транзакции.
ALTER TABLE "employees" ADD COLUMN "email_notifications" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "email_outbox" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER,
    "to_address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_outbox_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Отправщик выбирает ожидающие письма по времени следующей попытки
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- Плановые задачи (еженедельный дайджест): один запуск на период при нескольких экземплярах сервера
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name", "period")
);
