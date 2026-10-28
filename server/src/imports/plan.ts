// План импорта сотрудников — чистая функция без БД: сопоставление строк файла с текущими
// сотрудниками, проверка значений и набор изменений. Предпросмотр и применение строят
// один и тот же план, поэтому повторная загрузка того же файла ничего не меняет.
import type { ImportRow } from './parse';

export interface ExistingEmployee {
  id: number;
  login: string;
  name: string;
  position: string | null;
  deptName: string | null;
  managerId: number | null;
  plannedDays: number;
  carryOver: number;
  empType: string;
  email: string | null;
  isAdmin: boolean;
  isHr: boolean;
  isActive: boolean;
}

export type RowAction = 'create' | 'update' | 'unchanged' | 'error';

export interface EmployeeValues {
  name: string;
  login: string;
  position?: string;
  dept?: string;
  /** Ссылка на руководителя: id существующего или логин создаваемого в этом же файле. */
  manager?: { id: number } | { login: string };
  plannedDays?: number;
  carryOver?: number;
  empType?: 'staff' | 'ipsz';
  email?: string;
}

export interface PlannedRow {
  line: number;
  action: RowAction;
  name: string;
  login: string;
  employeeId?: number;
  values?: EmployeeValues;
  changes: Record<string, { before: unknown; after: unknown }>;
  errors: string[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  newDepartments: string[];
  summary: Record<RowAction, number>;
}

export interface PlanContext {
  employees: ExistingEmployee[]; // все, включая уволенных: логин уволенного занят
  departments: string[];
  actorIsAdmin: boolean;
  /** Своя карточка кадровику доступна — как и в API сотрудников (assertCanTouch). */
  actorId: number;
  /** Логин по ФИО для новых сотрудников (транслит). */
  loginFor: (name: string) => string;
}

export const MAX_ROWS = 5000;
const LOGIN = /^[a-z0-9._-]{2,64}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (s: string) => s.toLowerCase();
const normName = (s: string) => s.replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => lower(normName(s)).replace(/ё/g, 'е');

function num(v: string | undefined, label: string, errors: string[]): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.replace(',', '.').replace(/\s/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 365) {
    errors.push(`${label}: «${v}» — нужно число от 0 до 365`);
    return undefined;
  }
  return Math.round(n * 100) / 100;
}

function empType(v: string | undefined, errors: string[]): 'staff' | 'ipsz' | undefined {
  if (v === undefined) return undefined;
  const k = lower(v).replace(/[\s/.-]/g, '');
  if (['штат', 'штатный', 'штатныйсотрудник', 'сотрудник', 'staff', 'тд', 'трудовойдоговор'].includes(k)) return 'staff';
  if (['ип', 'самозанятый', 'ипсамозанятый', 'ипсз', 'ipsz', 'гпх'].includes(k)) return 'ipsz';
  errors.push(`Тип занятости: «${v}» — укажите «штат» или «ИП/самозанятый»`);
  return undefined;
}

export function buildImportPlan(input: ImportRow[], ctx: PlanContext): ImportPlan {
  const rows: PlannedRow[] = [];
  const active = ctx.employees.filter((e) => e.isActive);
  const byLogin = new Map(ctx.employees.map((e) => [lower(e.login), e]));
  const activeByName = new Map<string, ExistingEmployee[]>();
  for (const e of active) activeByName.set(nameKey(e.name), [...(activeByName.get(nameKey(e.name)) ?? []), e]);
  const knownDepts = new Set(ctx.departments.map(lower));
  const newDepts = new Map<string, string>();
  const takenLogins = new Set(ctx.employees.map((e) => lower(e.login)));
  const seenLogins = new Set<string>();
  const seenNames = new Set<string>();

  // Первый проход: строка → существующий сотрудник или новый логин
  for (const r of input) {
    const errors: string[] = [];
    const name = normName(r.name ?? '');
    if (name.length < 3 || name.length > 128) errors.push('ФИО: от 3 до 128 символов');
    else if (name.split(' ').length < 2) errors.push('ФИО: укажите фамилию и имя');
    let login = r.login ? lower(r.login.trim()) : '';
    if (login && !LOGIN.test(login)) errors.push(`Логин «${r.login}»: латиница, цифры, точка, дефис, подчёркивание`);

    let target: ExistingEmployee | undefined;
    if (login) {
      target = byLogin.get(login);
      if (target && !target.isActive) errors.push(`Логин «${login}» занят уволенным сотрудником`);
    } else if (name) {
      const found = activeByName.get(nameKey(name)) ?? [];
      if (found.length > 1) errors.push('Несколько сотрудников с таким ФИО — укажите логин');
      target = found.length === 1 ? found[0] : undefined;
    }
    if (target) login = lower(target.login);
    if (!target && !login && name && !errors.length) {
      const base = ctx.loginFor(name);
      login = base;
      for (let i = 2; takenLogins.has(login) || seenLogins.has(login); i++) login = `${base}${i}`;
    }
    if (login && seenLogins.has(login)) errors.push(`Логин «${login}» повторяется в файле`);
    if (!r.login && name && seenNames.has(nameKey(name))) errors.push('ФИО повторяется в файле — укажите логины');
    if (login) seenLogins.add(login);
    if (name) seenNames.add(nameKey(name));

    const values: EmployeeValues = { name, login };
    if (r.position !== undefined) values.position = r.position.slice(0, 128);
    if (r.dept !== undefined) {
      const known = ctx.departments.find((d) => lower(d) === lower(r.dept!.trim()));
      values.dept = known ?? r.dept.trim();
      if (!known && !knownDepts.has(lower(values.dept))) newDepts.set(lower(values.dept), values.dept);
    }
    values.plannedDays = num(r.plannedDays, 'Норма дней', errors);
    values.carryOver = num(r.carryOver, 'Перенос', errors);
    values.empType = empType(r.empType, errors);
    if (r.email !== undefined) {
      if (EMAIL.test(r.email)) values.email = lower(r.email); else errors.push(`Email «${r.email}» указан неверно`);
    }
    rows.push({ line: r.line, action: errors.length ? 'error' : target ? 'update' : 'create', name, login, employeeId: target?.id, values, changes: {}, errors });
  }

  // Второй проход: руководители (в том числе создаваемые этим же файлом) и изменения
  const fileByLogin = new Map(rows.filter((r) => r.action !== 'error').map((r) => [r.login, r]));
  const fileByName = new Map<string, PlannedRow[]>();
  for (const r of rows) if (r.action !== 'error') fileByName.set(nameKey(r.name), [...(fileByName.get(nameKey(r.name)) ?? []), r]);
  const existingById = new Map(ctx.employees.map((e) => [e.id, e]));
  // Руководитель в изменениях — по ФИО, а не по идентификатору
  const managerName = (m: EmployeeValues['manager'] | number | null | undefined): string | null => {
    if (m === null || m === undefined) return null;
    if (typeof m === 'number') return existingById.get(m)?.name ?? `#${m}`;
    return 'id' in m ? existingById.get(m.id)?.name ?? `#${m.id}` : fileByLogin.get(m.login)?.name ?? m.login;
  };

  input.forEach((src, i) => {
    const row = rows[i];
    const v = row.values!;
    if (src.manager !== undefined) {
      const ref = src.manager.trim();
      const viaLogin = byLogin.get(lower(ref));
      const fileLogin = fileByLogin.get(lower(ref));
      const named = [...(activeByName.get(nameKey(ref)) ?? [])];
      const fileNamed = (fileByName.get(nameKey(ref)) ?? []).filter((r) => r.action === 'create');
      if (viaLogin?.isActive) v.manager = { id: viaLogin.id };
      else if (fileLogin) v.manager = fileLogin.employeeId ? { id: fileLogin.employeeId } : { login: fileLogin.login };
      else if (named.length + fileNamed.length > 1) row.errors.push(`Руководитель «${ref}»: несколько совпадений — укажите логин`);
      else if (named.length === 1) v.manager = { id: named[0].id };
      else if (fileNamed.length === 1) v.manager = { login: fileNamed[0].login };
      else row.errors.push(`Руководитель «${ref}» не найден`);
      const self = v.manager && (('id' in v.manager && v.manager.id === row.employeeId) || ('login' in v.manager && v.manager.login === row.login));
      if (self) row.errors.push('Сотрудник не может быть своим руководителем');
    }

    if (row.errors.length) { row.action = 'error'; return; }
    if (row.action === 'create') {
      row.changes = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== undefined && k !== 'login' && k !== 'name')
        .map(([k, x]) => [k, { before: null, after: k === 'manager' ? managerName(v.manager) : x }]));
      return;
    }
    const cur = existingById.get(row.employeeId!)!;
    const diff: PlannedRow['changes'] = {};
    const cmp = (field: string, before: unknown, after: unknown) => {
      if (after !== undefined && after !== before) diff[field] = { before, after };
    };
    if (src.login) cmp('name', cur.name, v.name); // по ФИО строка сопоставлена с самим ФИО — менять нечего
    cmp('position', cur.position ?? undefined, v.position);
    cmp('dept', cur.deptName ?? undefined, v.dept);
    if (v.manager && !('id' in v.manager && v.manager.id === cur.managerId)) {
      diff.manager = { before: managerName(cur.managerId), after: managerName(v.manager) };
    }
    cmp('plannedDays', cur.plannedDays, v.plannedDays);
    cmp('carryOver', cur.carryOver, v.carryOver);
    cmp('empType', cur.empType, v.empType);
    cmp('email', cur.email ?? undefined, v.email);
    row.changes = diff;
    if (!Object.keys(diff).length) { row.action = 'unchanged'; return; }
    if (!ctx.actorIsAdmin && (cur.isAdmin || (cur.isHr && cur.id !== ctx.actorId))) {
      row.errors.push('Учётные записи администраторов и кадровой службы меняет администратор');
      row.action = 'error';
    }
  });

  const summary: Record<RowAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) summary[r.action]++;
  const usedDepts = new Set(rows.filter((r) => r.action === 'create' || r.action === 'update').map((r) => r.values?.dept && lower(r.values.dept)));
  return { rows, newDepartments: [...newDepts].filter(([k]) => usedDepts.has(k)).map(([, v]) => v), summary };
}
