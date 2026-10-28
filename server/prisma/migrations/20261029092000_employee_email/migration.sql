-- v0.4.0, E30/E32: адрес почты сотрудника — импорт из кадровой системы и письма о решениях.
-- Необязательный, уникальный без учёта регистра среди заполненных.
ALTER TABLE "employees" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "employees_email_lower_key" ON "employees" (lower("email")) WHERE "email" IS NOT NULL;
