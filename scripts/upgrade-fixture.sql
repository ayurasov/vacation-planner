-- Данные на схеме предыдущего выпуска для проверки обновления (scripts/upgrade-check.sh).
-- Только колонки, которые есть с v0.1.0: файл не меняется вместе со схемой.
-- Заявки на согласовании и уведомления нужны обязательно: миграции, меняющие таблицы с отложенными
-- триггерами, падают только на непустых таблицах (v0.6.0).
INSERT INTO org_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO departments (name) VALUES ('Отдел проверки обновления');
INSERT INTO employees (login, password_hash, name, role, dept_id, updated_at)
  SELECT 'upgrade.boss', 'x', 'Руководитель Проверки', 'manager', id, now() FROM departments WHERE name = 'Отдел проверки обновления';
INSERT INTO employees (login, password_hash, name, dept_id, manager_id, updated_at)
  SELECT 'upgrade.emp', 'x', 'Сотрудник Проверки', d.id, b.id, now()
    FROM departments d, employees b WHERE d.name = 'Отдел проверки обновления' AND b.login = 'upgrade.boss';
UPDATE departments SET manager_id = (SELECT id FROM employees WHERE login = 'upgrade.boss') WHERE name = 'Отдел проверки обновления';
INSERT INTO vacation_requests (employee_id, start_date, end_date, status, created_by, updated_at)
  SELECT id, DATE '2030-07-01', DATE '2030-07-14', 'pending', id, now() FROM employees WHERE login = 'upgrade.emp';
INSERT INTO vacation_requests (employee_id, start_date, end_date, status, created_by, updated_at)
  SELECT id, DATE '2030-03-02', DATE '2030-03-06', 'approved', id, now() FROM employees WHERE login = 'upgrade.emp';
INSERT INTO notifications (employee_id, kind, text)
  SELECT id, 'request_created', 'Сотрудник Проверки: новая заявка' FROM employees WHERE login = 'upgrade.boss';
INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
  SELECT id, md5(login), now() + interval '30 days' FROM employees;
