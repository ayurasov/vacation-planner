// Модульные тесты импорта сотрудников: разбор файла и план (без БД).
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseCsv, parseImportFile } from '../src/imports/parse';
import { buildImportPlan, type ExistingEmployee, type PlanContext } from '../src/imports/plan';
import { translitLogin } from '../src/employees/employees.service';

const emp = (id: number, login: string, name: string, extra: Partial<ExistingEmployee> = {}): ExistingEmployee => ({
  id, login, name, position: null, deptName: 'ИТ', managerId: null, plannedDays: 28, carryOver: 0,
  empType: 'staff', email: null, isAdmin: false, isHr: false, isActive: true, ...extra,
});
const ctx = (employees: ExistingEmployee[], actorIsAdmin = false): PlanContext => ({
  employees, departments: ['ИТ', 'Финансы'], actorIsAdmin, actorId: 100, loginFor: translitLogin,
});

describe('разбор файла', () => {
  it('CSV: разделитель «;», кавычки, BOM и пустые строки', async () => {
    expect(parseCsv('﻿а;"б;в";"г ""д"""\n\n1;2;3')).toEqual([['а', 'б;в', 'г "д"'], [''], ['1', '2', '3']]);
    const rows = await parseImportFile(Buffer.from('ФИО;Логин;Норма дней\nИванов Иван Иванович;ivanov.ii;28\n;;\n'), 'x.csv');
    expect(rows).toEqual([{ line: 2, name: 'Иванов Иван Иванович', login: 'ivanov.ii', plannedDays: '28' }]);
  });

  it('XLSX: первый лист, заголовки в любом регистре, числа и e-mail-ссылки', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Сотрудники');
    ws.addRow(['фио', 'ОТДЕЛ', 'Перенос', 'E-mail']);
    ws.addRow(['Петров Пётр Петрович', 'ИТ', 3.5, { text: 'petrov@corp.ru', hyperlink: 'mailto:petrov@corp.ru' }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(await parseImportFile(buf, 'staff.xlsx')).toEqual([
      { line: 2, name: 'Петров Пётр Петрович', dept: 'ИТ', carryOver: '3.5', email: 'petrov@corp.ru' },
    ]);
  });

  it('без колонки ФИО — понятная ошибка формата', async () => {
    await expect(parseImportFile(Buffer.from('Логин;Отдел\nx;y'), 'a.csv')).rejects.toThrow(/Нет колонки «ФИО»/);
  });
});

describe('план импорта', () => {
  const base = [emp(1, 'ivanov.ii', 'Иванов Иван Иванович'), emp(2, 'boss.bb', 'Боссов Борис Борисович', { deptName: 'Финансы' })];

  it('новый сотрудник получает логин транслитом, существующий — сопоставляется по логину или ФИО', () => {
    const plan = buildImportPlan([
      { line: 2, name: 'Сидорова Анна Петровна', dept: 'ИТ', manager: 'boss.bb' },
      { line: 3, name: 'Иванов Иван Иванович', carryOver: '5' },
      { line: 4, name: 'Боссов Борис Борисович', login: 'BOSS.BB', position: 'Финансовый директор' },
    ], ctx(base));
    expect(plan.rows.map((r) => [r.action, r.login])).toEqual([['create', 'sidorova.ap'], ['update', 'ivanov.ii'], ['update', 'boss.bb']]);
    expect(plan.rows[0].values?.manager).toEqual({ id: 2 });
    expect(plan.rows[1].changes).toEqual({ carryOver: { before: 0, after: 5 } });
    expect(plan.rows[0].changes.manager).toEqual({ before: null, after: 'Боссов Борис Борисович' });
    expect(plan.summary).toEqual({ create: 1, update: 2, unchanged: 0, error: 0 });
  });

  it('повторная загрузка того же содержимого ничего не меняет', () => {
    const plan = buildImportPlan([{ line: 2, name: 'Иванов Иван Иванович', dept: 'ИТ', plannedDays: '28' }], ctx(base));
    expect(plan.rows[0].action).toBe('unchanged');
  });

  it('руководитель может быть создан этим же файлом; новые отделы перечисляются', () => {
    const plan = buildImportPlan([
      { line: 2, name: 'Новиков Олег Ильич', dept: 'Склад', manager: 'Начальников Глеб Олегович' },
      { line: 3, name: 'Начальников Глеб Олегович', dept: 'Склад' },
    ], ctx(base));
    expect(plan.rows[0].values?.manager).toEqual({ login: 'nachalnikov.go' });
    expect(plan.newDepartments).toEqual(['Склад']);
  });

  it('ошибки по строкам: числа, тип, e-mail, дубли, неизвестный руководитель, занятый логин', () => {
    const plan = buildImportPlan([
      { line: 2, name: 'Петров', plannedDays: 'много' },
      { line: 3, name: 'Козлов Ким Кимович', empType: 'фрилансер', email: 'не-почта' },
      { line: 4, name: 'Лебедев Лев Львович', manager: 'Неизвестный' },
      { line: 5, name: 'Орлов Олег Олегович', login: 'gone.gg' },
      { line: 6, name: 'Орлов Олег Олегович', login: 'gone.gg' },
    ], ctx([...base, emp(9, 'gone.gg', 'Уволенный', { isActive: false })]));
    expect(plan.rows.every((r) => r.action === 'error')).toBe(true);
    expect(plan.rows[0].errors.join()).toMatch(/ФИО.*Норма дней/);
    expect(plan.rows[1].errors).toHaveLength(2);
    expect(plan.rows[2].errors[0]).toMatch(/не найден/);
    expect(plan.rows[3].errors[0]).toMatch(/уволенным/);
    expect(plan.rows[4].errors.join()).toMatch(/повторяется/);
  });

  it('совпадение логина-транслита получает числовой суффикс', () => {
    const plan = buildImportPlan([{ line: 2, name: 'Иванова Ирина Игоревна' }], ctx(base));
    expect(plan.rows[0].login).toBe('ivanova.ii');
    const twin = buildImportPlan([{ line: 2, name: 'Иванов Илья Ильич' }], ctx(base));
    expect(twin.rows[0].login).toBe('ivanov.ii2');
  });

  it('кадровая служба не меняет администратора; без изменений — не ошибка', () => {
    const admin = emp(3, 'admin.aa', 'Админов Антон Антонович', { isAdmin: true });
    const change = buildImportPlan([{ line: 2, name: admin.name, login: 'admin.aa', carryOver: '9' }], ctx([...base, admin]));
    expect(change.rows[0].action).toBe('error');
    const same = buildImportPlan([{ line: 2, name: admin.name, login: 'admin.aa', carryOver: '0' }], ctx([...base, admin]));
    expect(same.rows[0].action).toBe('unchanged');
    const byAdmin = buildImportPlan([{ line: 2, name: admin.name, login: 'admin.aa', carryOver: '9' }], ctx([...base, admin], true));
    expect(byAdmin.rows[0].action).toBe('update');
    const colleague = emp(4, 'hr.two', 'Кадрова Вера Петровна', { isHr: true });
    const self = emp(100, 'hr.me', 'Кадрова Ирина Петровна', { isHr: true });
    const hrRows = buildImportPlan([
      { line: 2, name: colleague.name, login: 'hr.two', carryOver: '1' },
      { line: 3, name: self.name, login: 'hr.me', carryOver: '1' },
    ], ctx([...base, colleague, self]));
    expect(hrRows.rows.map((r) => r.action)).toEqual(['error', 'update']);
  });
});
