-- v0.6.0 (E60-01/02): кампания планирования на следующий год, утверждение графика отпусков,
-- унифицированная форма Т-7 (ТК РФ, ст. 123).

-- Табельный номер — графа 4 формы Т-7; заполняется в карточке и импортом.
ALTER TABLE "employees" ADD COLUMN "personnel_number" TEXT;
CREATE UNIQUE INDEX "employees_personnel_number_key" ON "employees" ("personnel_number");

-- Реквизиты организации и подписанты формы Т-7.
ALTER TABLE "org_settings"
  ADD COLUMN "org_name" TEXT,
  ADD COLUMN "org_okpo" TEXT,
  ADD COLUMN "head_position" TEXT,
  ADD COLUMN "head_name" TEXT,
  ADD COLUMN "hr_head_position" TEXT,
  ADD COLUMN "hr_head_name" TEXT;

-- Кампания планирования: одна на год; закрыть и открыть снова можно до утверждения графика.
CREATE TABLE "planning_campaigns" (
  "year" INTEGER NOT NULL,
  "deadline" DATE NOT NULL,
  "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "opened_by" INTEGER,
  "closed_at" TIMESTAMPTZ(6),
  "closed_by" INTEGER,
  -- Последнее напоминание не спланировавшим; автоматическое — один раз за три дня до срока
  "reminded_at" TIMESTAMPTZ(6),
  "auto_reminded" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "planning_campaigns_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "planning_campaigns_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "planning_campaigns_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Утверждённый график: реквизиты документа и неизменяемый снимок строк на момент утверждения.
-- Переносы после утверждения видны в графах 8–9 формы Т-7 по текущему состоянию заявок.
CREATE TABLE "schedule_approvals" (
  "year" INTEGER NOT NULL,
  "doc_number" TEXT NOT NULL,
  "doc_date" DATE NOT NULL,
  "union_opinion_date" DATE,
  "union_opinion_number" TEXT,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "approved_by" INTEGER,
  "rows" JSONB NOT NULL,
  CONSTRAINT "schedule_approvals_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "schedule_approvals_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
