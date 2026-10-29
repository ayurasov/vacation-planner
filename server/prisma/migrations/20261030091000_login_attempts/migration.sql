-- v0.5.0, E40-05: счётчики попыток входа в PostgreSQL — общие для всех экземпляров сервера.
-- UNLOGGED: при сбое СУБД счётчики сбрасываются, зато запись не нагружает журнал WAL и реплику.
CREATE UNLOGGED TABLE "login_attempts" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("key", "window_start")
);
CREATE INDEX "login_attempts_window_start_idx" ON "login_attempts" ("window_start");
