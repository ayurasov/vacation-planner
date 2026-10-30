// Форматы обмена со «По Делу» (v1.1.0, ADR-018): структура podelu.org-structure и сотрудники
// podelu.employees версии 1 — те же поля и столбцы, что выгружает и загружает «По Делу»; поля отпусков —
// отдельным объектом vacation (JSON) и столбцами в конце CSV, которые «По Делу» пропускает.
// Только разбор и запись значений, без БД.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../imports/parse';
import { nameKey } from './org-tree';

export const STRUCTURE_FORMAT = 'podelu.org-structure';
export const EMPLOYEES_FORMAT = 'podelu.employees';
export const TRANSFER_VERSION = 1;
export const MAX_DEPARTMENTS = 5000;
export const MAX_RECORDS = 5000;

export class TransferFormatError extends Error {}

/** Версия приложения в поле app файла (как в «По Делу»); в образе — dist/main.js рядом с package.json. */
export const APP_STAMP = (() => {
  try {
    const { version } = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
    return `vacation-planner ${version}`;
  } catch {
    return 'vacation-planner';
  }
})();

/** Разделитель пути в CSV: «/», «>» или «\» (как в «По Делу»). */
const PATH_SPLIT = /\s*(?:\/|>|\\)\s*/;
export const PRIMARY_MARK = '(основной)';
/** «Руководит: да» — своим подразделением. */
export const OWN_DEPARTMENT = '__own__';
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'да', 'y', '+', 'руководитель', 'head']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'нет', 'n', '-']);
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Path = string[];
export type Role = 'user' | 'manager' | 'admin';
export type EmpType = 'staff' | 'ipsz';
export interface HeadRef { path: Path | typeof OWN_DEPARTMENT; primary: boolean }

/** Сотрудник из файла: undefined — поля в файле нет или оно пустое (пустое ничего не стирает). */
export interface PersonRecord {
  line: number;
  email?: string;
  login?: string;
  name?: string;
  position?: string;
  department?: Path;
  /** Явный руководитель: email или логин. */
  manager?: string;
  reportsToNone?: boolean;
  heads?: HeadRef[];
  role?: Role;
  capabilities?: string[];
  isActive?: boolean;
  externalId?: string;
  personnelNumber?: string;
  plannedDays?: number;
  carryOver?: number;
  empType?: EmpType;
  /** Что из записи не применится и почему. */
  notes: string[];
}

// ── Значения ──

export function toBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return undefined;
}

export function toPath(value: unknown): Path | undefined {
  const parts = (Array.isArray(value) ? value.map((p) => String(p ?? '')) : String(value ?? '').trim().split(PATH_SPLIT))
    .map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean);
  return parts.length ? parts : undefined;
}

export const pathText = (path: readonly string[] | undefined | null) => (path ?? []).join(' / ');
export const samePath = (a?: readonly string[] | null, b?: readonly string[] | null) =>
  (a ?? []).map(nameKey).join('/') === (b ?? []).map(nameKey).join('/');

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  return String(value ?? '').split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
}

/** «Руководит»: «да» — своим подразделением; иначе пути через «|», «(основной)» — основное. */
export function toHeads(value: unknown): HeadRef[] | undefined {
  if (Array.isArray(value)) {
    const out: HeadRef[] = [];
    for (const item of value) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const path = toPath(o.department ?? o.path);
        if (path) out.push({ path, primary: Boolean(o.primary) });
      } else out.push(...(toHeads(String(item)) ?? []));
    }
    return out.length ? out : undefined;
  }
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (TRUE_VALUES.has(text.toLowerCase())) return [{ path: OWN_DEPARTMENT, primary: true }];
  if (FALSE_VALUES.has(text.toLowerCase())) return undefined;
  const out: HeadRef[] = [];
  for (const part of text.split('|')) {
    const primary = part.toLowerCase().includes(PRIMARY_MARK);
    const path = toPath(part.replace(new RegExp(PRIMARY_MARK.replace(/[()]/g, '\\$&'), 'gi'), ''));
    if (path) out.push({ path, primary });
  }
  return out.length ? out : undefined;
}

const ROLE_ALIASES: Record<string, Role> = {
  user: 'user', manager: 'manager', admin: 'admin', администратор: 'admin', руководитель: 'manager',
  сотрудник: 'user', пользователь: 'user',
};
export const ROLE_LABELS: Record<Role, string> = { admin: 'Администратор', manager: 'Руководитель', user: 'Сотрудник' };
/** Полномочия «По Делу», которые соответствуют кадровой службе планировщика. */
export const HR_CAPABILITIES = ['org.manage', 'users.manage'];
const KNOWN_CAPABILITIES = ['org.manage', 'users.manage', 'settings.manage'];
const EMP_TYPES: Record<string, EmpType> = {
  staff: 'staff', штат: 'staff', штатный: 'staff', ipsz: 'ipsz', ип: 'ipsz', самозанятый: 'ipsz', 'ип/самозанятый': 'ipsz', 'ип/сз': 'ipsz',
};
export const EMP_TYPE_LABELS: Record<EmpType, string> = { staff: 'штат', ipsz: 'ИП/самозанятый' };
export const PERSONNEL_NUMBER = /^[0-9A-Za-zА-Яа-яЁё/-]{1,20}$/;

function num(value: unknown, label: string, notes: string[]): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const n = Number(String(value).replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0 || n > 365) { notes.push(`${label}: «${String(value)}» — не число от 0 до 365, не применяется`); return undefined; }
  return Math.round(n * 100) / 100;
}

const text = (value: unknown) => {
  const t = String(value ?? '').trim().replace(/\s+/g, ' ');
  return t || undefined;
};

/** Словарь (из CSV или JSON) → запись; непонятные значения — в notes. */
export function toRecord(line: number, raw: Record<string, unknown>): PersonRecord {
  const notes: string[] = [];
  const r: PersonRecord = { line, notes };
  r.email = text(raw.email)?.toLowerCase();
  r.login = text(raw.login);
  r.name = text(raw.name);
  r.position = text(raw.position)?.slice(0, 128);
  r.department = toPath(raw.department);
  r.manager = text(raw.manager)?.toLowerCase();
  if (raw.reportsToNone !== undefined && raw.reportsToNone !== null && raw.reportsToNone !== '') r.reportsToNone = toBool(raw.reportsToNone);
  r.heads = toHeads(raw.heads);
  const role = text(raw.role)?.toLowerCase();
  if (role) {
    r.role = ROLE_ALIASES[role];
    if (!r.role) notes.push(`роль «${String(raw.role)}» не распознана — не применяется`);
  }
  const caps = splitList(raw.capabilities);
  if (caps.length) {
    const unknown = caps.filter((c) => !KNOWN_CAPABILITIES.includes(c));
    if (unknown.length) notes.push(`неизвестные полномочия пропущены: ${unknown.join(', ')}`);
    r.capabilities = [...new Set(caps.filter((c) => KNOWN_CAPABILITIES.includes(c)))].sort();
  }
  if (raw.isActive !== undefined && raw.isActive !== null && raw.isActive !== '') r.isActive = toBool(raw.isActive);
  r.externalId = text(raw.externalId)?.slice(0, 128);
  // Поля отпусков: в JSON — объект vacation, в CSV — отдельные столбцы
  const v = (raw.vacation && typeof raw.vacation === 'object' ? raw.vacation : raw) as Record<string, unknown>;
  const pn = text(v.personnelNumber);
  if (pn) { if (PERSONNEL_NUMBER.test(pn)) r.personnelNumber = pn; else notes.push(`табельный номер «${pn}» — до 20 символов: цифры, буквы, «-» и «/»; не применяется`); }
  r.plannedDays = num(v.plannedDays, 'норма дней', notes);
  r.carryOver = num(v.carryOver, 'перенос', notes);
  const et = text(v.empType)?.toLowerCase();
  if (et) { r.empType = EMP_TYPES[et]; if (!r.empType) notes.push(`тип занятости «${et}» не распознан — не применяется`); }
  return r;
}

// ── CSV ──

/** Столбцы выгрузки: сначала — как в «По Делу» (тот же порядок и заголовки), затем поля отпусков. */
export const CSV_COLUMNS: Array<[keyof ExportRecord | 'personnelNumber' | 'plannedDays' | 'carryOver' | 'empType', string]> = [
  ['email', 'email'], ['login', 'Логин'], ['name', 'ФИО'], ['position', 'Должность'],
  ['department', 'Подразделение'], ['manager', 'Руководитель (явно)'], ['reportsToNone', 'Первое лицо'],
  ['heads', 'Руководит'], ['functionalManagers', 'Функциональные руководители'], ['role', 'Роль'],
  ['capabilities', 'Полномочия'], ['timezone', 'Часовой пояс'], ['isActive', 'Активен'],
  ['visibilityScope', 'Видимость'], ['authSource', 'Вход'], ['externalId', 'Внешний ID'],
  ['personnelNumber', 'Табельный номер'], ['plannedDays', 'Норма дней'], ['carryOver', 'Перенос'], ['empType', 'Тип занятости'],
];

/** Заголовки при загрузке — «По Делу», импорт структуры CSV и выгрузка AD; «Табельный номер» — графа Т-7. */
const ALIASES: Record<string, string[]> = {
  email: ['email', 'e-mail', 'mail', 'почта', 'эл. почта', 'электронная почта'],
  login: ['login', 'логин', 'samaccountname', 'учётная запись', 'учетная запись'],
  name: ['name', 'фио', 'имя', 'сотрудник', 'displayname'],
  position: ['position', 'title', 'должность'],
  department: ['department', 'department_path', 'подразделение', 'отдел', 'путь подразделения'],
  manager: ['manager', 'manager_email', 'руководитель', 'руководитель (явно)', 'email руководителя', 'почта руководителя'],
  reportsToNone: ['reportstonone', 'reports_to_none', 'первое лицо', 'никому не подчиняется'],
  heads: ['heads', 'is_head', 'head', 'руководит', 'руководит подразделениями', 'руководитель подразделения'],
  role: ['role', 'global_role', 'роль'],
  capabilities: ['capabilities', 'полномочия'],
  isActive: ['isactive', 'is_active', 'active', 'активен', 'доступ'],
  externalId: ['externalid', 'external_id', 'внешний id', 'objectguid'],
  personnelNumber: ['personnelnumber', 'personnel_number', 'табельный номер', 'табельный', 'таб. номер', 'таб№'],
  plannedDays: ['planneddays', 'planned_days', 'норма дней', 'норма'],
  carryOver: ['carryover', 'carry_over', 'перенос', 'остаток'],
  empType: ['emptype', 'emp_type', 'тип занятости'],
};

export function parseEmployeesCsv(content: string): PersonRecord[] {
  const table = parseCsv(content);
  const headerIdx = table.findIndex((r) => r.some((c) => c.trim()));
  if (headerIdx < 0) throw new TransferFormatError('Файл пустой');
  const mapping = new Map<string, number>();
  table[headerIdx].forEach((title, index) => {
    const key = title.trim().toLowerCase().replace(/ё/g, 'е');
    for (const [column, aliases] of Object.entries(ALIASES)) {
      if (aliases.map((a) => a.replace(/ё/g, 'е')).includes(key) && !mapping.has(column)) mapping.set(column, index);
    }
  });
  if (!mapping.has('email') && !mapping.has('login')) throw new TransferFormatError('Нужен столбец email или «Логин»');
  const records: PersonRecord[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells.some((c) => c.trim())) continue;
    if (records.length >= MAX_RECORDS) throw new TransferFormatError(`Не больше ${MAX_RECORDS} сотрудников за одну загрузку`);
    const raw: Record<string, unknown> = {};
    for (const [column, index] of mapping) raw[column] = cells[index] ?? '';
    records.push(toRecord(i + 1, raw));
  }
  return records;
}

export function parseEmployeesJson(content: unknown): PersonRecord[] {
  let data = content;
  if (typeof data === 'string') {
    try { data = JSON.parse(data.replace(/^﻿/, '')); } catch { throw new TransferFormatError('Файл не является JSON'); }
  }
  let items: unknown = data;
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const doc = data as Record<string, unknown>;
    if (doc.format !== EMPLOYEES_FORMAT) throw new TransferFormatError(`Это не файл сотрудников «По Делу» (format: ${EMPLOYEES_FORMAT})`);
    if (doc.version !== TRANSFER_VERSION) throw new TransferFormatError(`Версия файла ${String(doc.version)} не поддерживается — нужна ${TRANSFER_VERSION}`);
    items = doc.employees;
  }
  if (!Array.isArray(items)) throw new TransferFormatError('В файле нет списка сотрудников');
  if (items.length > MAX_RECORDS) throw new TransferFormatError(`Не больше ${MAX_RECORDS} сотрудников за одну загрузку`);
  return items.flatMap((item, i) => (item && typeof item === 'object' ? [toRecord(i + 1, item as Record<string, unknown>)] : []));
}

/** Формат по содержимому: JSON начинается с «{» или «[». */
export function parseEmployees(content: string): PersonRecord[] {
  const head = content.replace(/^﻿/, '').trimStart()[0];
  return head === '{' || head === '[' ? parseEmployeesJson(content) : parseEmployeesCsv(content);
}

// ── Выгрузка ──

export interface ExportRecord {
  email: string; login: string; name: string; position: string; department: Path; manager: string;
  reportsToNone: boolean; heads: Array<{ department: Path; primary: boolean }>; functionalManagers: string[];
  role: Role; capabilities: string[]; timezone: string; isActive: boolean; visibilityScope: string;
  authSource: string; externalId: string;
  vacation: { personnelNumber: string; plannedDays: number; carryOver: number; empType: EmpType };
}

export function employeesDocument(records: ExportRecord[], exportedAt: Date) {
  return { format: EMPLOYEES_FORMAT, version: TRANSFER_VERSION, exportedAt: exportedAt.toISOString(), app: APP_STAMP, employees: records };
}

function csvValue(key: string, r: ExportRecord): string {
  switch (key) {
    case 'department': return pathText(r.department);
    case 'heads': return r.heads.map((h) => pathText(h.department) + (h.primary ? ` ${PRIMARY_MARK}` : '')).join(' | ');
    case 'functionalManagers': case 'capabilities': return (r[key] as string[]).join(', ');
    case 'role': return ROLE_LABELS[r.role];
    case 'reportsToNone': case 'isActive': return r[key] ? 'да' : 'нет';
    case 'personnelNumber': return r.vacation.personnelNumber;
    case 'plannedDays': case 'carryOver': return String(r.vacation[key]).replace('.', ',');
    case 'empType': return EMP_TYPE_LABELS[r.vacation.empType];
    default: return String((r as unknown as Record<string, unknown>)[key] ?? '');
  }
}

const csvCell = (v: string) => (/[";\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV для Excel: «;», CRLF и BOM — как выгрузка «По Делу». */
export function employeesCsv(records: ExportRecord[]): string {
  const lines = [CSV_COLUMNS.map(([, h]) => csvCell(h)).join(';')];
  for (const r of records) lines.push(CSV_COLUMNS.map(([k]) => csvCell(csvValue(k, r))).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
