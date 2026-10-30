// Выгрузка и загрузка сотрудников в формате «По Делу» (v1.1.0, ADR-018): CSV («;», BOM) и JSON
// podelu.employees версии 1 с полями отпусков. Загрузка — план без записи в БД, затем то же самое
// с решениями кадровой службы одной транзакцией.
//
// Сопоставление: email (без учёта регистра), затем логин, затем табельный номер. Коллизия — поле, у
// которого и в планировщике, и в файле есть разные значения: выбирается значение планировщика (по
// умолчанию), файла, объединение (списки) или своё. Пустое в планировщике заполняется из файла,
// пустое в файле ничего не стирает. Быстрый импорт CSV («как в AD») — тот же план, но файл главнее:
// коллизии решаются в его пользу, руководство подразделениями добавляется.
//
// Явный руководитель записывается, только если он отличается от руководителя по структуре — тогда
// переводы и смены руководителей подразделений дальше работают сами (правило «По Делу»).
import { Injectable } from '@nestjs/common';
import type { Employee } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/passwords';
import type { StaffActor } from '../auth/access';
import { generatePassword, oneTimePasswordLength, toPublic, translitLogin } from '../employees/employees.service';
import { loadTree } from './org.service';
import { nameKey, OrgTree, type DeptNode } from './org-tree';
import {
  EMAIL, EMP_TYPE_LABELS, HR_CAPABILITIES, OWN_DEPARTMENT, PERSONNEL_NUMBER, ROLE_LABELS, employeesCsv, employeesDocument,
  pathText, samePath, toBool, toPath, type EmpType, type ExportRecord, type Path, type PersonRecord, type Role,
} from './transfer-format';

const FIELDS = ['name', 'email', 'login', 'position', 'department', 'manager', 'reportsToNone', 'heads', 'role', 'capabilities',
  'isActive', 'personnelNumber', 'plannedDays', 'carryOver', 'empType'] as const;
type Field = typeof FIELDS[number];

const LABELS: Record<Field, string> = {
  name: 'ФИО', email: 'Email', login: 'Логин', position: 'Должность', department: 'Подразделение',
  manager: 'Руководитель (явно)', reportsToNone: 'Первое лицо', heads: 'Руководит', role: 'Роль',
  capabilities: 'Полномочия', isActive: 'Активен', personnelNumber: 'Табельный номер', plannedDays: 'Норма дней',
  carryOver: 'Перенос', empType: 'Тип занятости',
};
const LIST_FIELDS = new Set<Field>(['heads', 'capabilities']);
const BOOL_FIELDS = new Set<Field>(['reportsToNone', 'isActive']);
const CUSTOM_FIELDS = new Set<Field>(['name', 'email', 'login', 'position', 'department', 'manager', 'personnelNumber', 'plannedDays', 'carryOver']);
const LOGIN = /^[a-z0-9._-]{2,64}$/i;

type Values = {
  name?: string; email?: string | null; login?: string | null; position?: string | null; department?: Path | null;
  manager?: string | null; reportsToNone?: boolean; heads?: Path[]; role?: Role; capabilities?: string[];
  isActive?: boolean; personnelNumber?: string | null; plannedDays?: number; carryOver?: number; empType?: EmpType;
};
type Choice = 'current' | 'incoming' | 'merge' | 'custom';
export type Decisions = Record<string, { fields?: Record<string, { choice?: Choice; value?: unknown }> }>;
export interface TransferOptions { mode: 'transfer' | 'sync'; decisions?: Decisions; newUsers?: 'active' | 'inactive' | 'file'; createMissing?: boolean }

interface Conflict {
  field: Field; label: string; current: unknown; incoming: unknown; merged: unknown;
  choices: Choice[]; choice: Choice; value: unknown; note: string | null;
}
interface Entry {
  record: PersonRecord;
  key: string;
  user: Employee | null;
  action: 'create' | 'update' | 'unchanged' | 'skip' | 'error';
  final: Values;
  touched: Set<Field>;
  changes: Array<{ field: Field; label: string; old: unknown; new: unknown }>;
  conflicts: Conflict[];
  errors: string[];
  warnings: string[];
  /** Ключ сотрудника в будущей структуре: id или отрицательный — для новых. */
  person: number;
  deptKey?: number | null;
  headKeys?: number[];
  explicit?: number | null;
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const lower = (v?: string | null) => (v ?? '').toLowerCase();

function same(field: Field, a: unknown, b: unknown): boolean {
  if (field === 'department') return samePath(a as Path | null, b as Path | null);
  if (field === 'heads') {
    const keys = (v: unknown) => [...new Set(((v as Path[] | undefined) ?? []).map((p) => p.map(nameKey).join('/')))].sort().join('|');
    return keys(a) === keys(b);
  }
  if (field === 'capabilities') return [...((a as string[]) ?? [])].sort().join(',') === [...((b as string[]) ?? [])].sort().join(',');
  if (field === 'email' || field === 'manager' || field === 'login') return lower(a as string) === lower(b as string);
  return (empty(a) ? null : a) === (empty(b) ? null : b);
}

function show(field: Field, v: unknown): unknown {
  if (empty(v)) return '';
  if (field === 'department') return pathText(v as Path);
  if (field === 'heads') return (v as Path[]).map(pathText);
  if (field === 'role') return ROLE_LABELS[v as Role];
  if (BOOL_FIELDS.has(field)) return v ? 'да' : 'нет';
  if (field === 'empType') return EMP_TYPE_LABELS[v as EmpType];
  return v;
}

function merge(field: Field, a: unknown, b: unknown): unknown {
  if (field === 'heads') {
    const out = new Map<string, Path>();
    for (const p of [...((a as Path[]) ?? []), ...((b as Path[]) ?? [])]) out.set(p.map(nameKey).join('/'), p);
    return [...out.values()];
  }
  return [...new Set([...((a as string[]) ?? []), ...((b as string[]) ?? [])])].sort();
}

/** Своё значение кадровой службы → [значение, ошибка]. */
function custom(field: Field, value: unknown): [unknown, string | null] {
  const t = String(value ?? '').trim().replace(/\s+/g, ' ');
  switch (field) {
    case 'name': return t ? [t, null] : [null, 'ФИО не может быть пустым'];
    case 'email': return EMAIL.test(t) ? [t.toLowerCase(), null] : [null, 'некорректный email'];
    case 'login': return LOGIN.test(t) ? [t.toLowerCase(), null] : [null, 'логин: латиница, цифры, «._-», 2–64 символа'];
    case 'department': return [toPath(t) ?? null, null];
    case 'manager': return [t.toLowerCase() || null, null];
    case 'personnelNumber': return !t || PERSONNEL_NUMBER.test(t) ? [t || null, null] : [null, 'табельный номер: до 20 символов — цифры, буквы, «-» и «/»'];
    case 'plannedDays': case 'carryOver': {
      const n = Number(t.replace(',', '.'));
      return Number.isFinite(n) && n >= 0 && n <= 365 ? [Math.round(n * 100) / 100, null] : [null, 'ожидается число от 0 до 365'];
    }
    default: return [t || null, null];
  }
}

function roleOf(e: Employee): Role {
  return e.isAdmin ? 'admin' : e.role === 'manager' ? 'manager' : 'user';
}

@Injectable()
export class EmployeeTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Выгрузка ──

  async records(includeInactive: boolean): Promise<ExportRecord[]> {
    const [people, tree] = await Promise.all([
      this.prisma.employee.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      loadTree(this.prisma),
    ]);
    const all = includeInactive ? people : await this.prisma.employee.findMany({ select: { id: true, email: true, login: true } });
    const ref = new Map(all.map((e) => [e.id, (e.email ?? e.login).toLowerCase()]));
    const headed = new Map<number, Path[]>();
    for (const d of tree.ordered()) if (d.managerId !== null) headed.set(d.managerId, [...(headed.get(d.managerId) ?? []), tree.path(d.id)]);
    return people.map((e) => ({
      email: e.email?.toLowerCase() ?? '', login: e.login, name: e.name, position: e.position ?? '',
      department: e.deptId !== null && tree.byId.has(e.deptId) ? tree.path(e.deptId) : [],
      manager: e.managerId !== null ? ref.get(e.managerId) ?? '' : '',
      reportsToNone: e.reportsToNone,
      heads: (headed.get(e.id) ?? []).map((department) => ({ department, primary: true })),
      functionalManagers: [], role: roleOf(e), capabilities: e.isHr ? [...HR_CAPABILITIES] : [],
      timezone: '', isActive: e.isActive, visibilityScope: '', authSource: 'local', externalId: e.externalId ?? '',
      vacation: { personnelNumber: e.personnelNumber ?? '', plannedDays: e.plannedDays, carryOver: e.carryOver, empType: e.empType === 'ipsz' ? 'ipsz' : 'staff' },
    }));
  }

  async export(format: 'csv' | 'json', includeInactive: boolean, now: Date): Promise<string> {
    const records = await this.records(includeInactive);
    return format === 'csv' ? employeesCsv(records) : JSON.stringify(employeesDocument(records, now), null, 2);
  }

  // ── План ──

  private async build(actor: StaffActor, records: PersonRecord[], opts: TransferOptions) {
    const decisions = opts.decisions ?? {};
    const [people, tree] = await Promise.all([this.prisma.employee.findMany(), loadTree(this.prisma)]);
    const byId = new Map(people.map((e) => [e.id, e]));
    const index = <K>(key: (e: Employee) => K | null | undefined) => {
      const m = new Map<K, Employee[]>();
      for (const e of people) { const k = key(e); if (k !== null && k !== undefined && k !== '') m.set(k, [...(m.get(k) ?? []), e]); }
      return m;
    };
    const byEmail = index((e) => e.email?.toLowerCase());
    const byLogin = index((e) => e.login.toLowerCase());
    const byNumber = index((e) => e.personnelNumber);
    const headed = new Map<number, Path[]>();
    for (const d of tree.ordered()) if (d.managerId !== null) headed.set(d.managerId, [...(headed.get(d.managerId) ?? []), tree.path(d.id)]);
    const refOf = (id: number | null) => (id === null ? null : byId.get(id) ? (byId.get(id)!.email ?? byId.get(id)!.login).toLowerCase() : null);
    const current = (e: Employee): Values => ({
      name: e.name, email: e.email?.toLowerCase() ?? null, login: e.login, position: e.position,
      department: e.deptId !== null && tree.byId.has(e.deptId) ? tree.path(e.deptId) : null,
      manager: refOf(e.managerId), reportsToNone: e.reportsToNone, heads: headed.get(e.id) ?? [], role: roleOf(e),
      capabilities: e.isHr ? [...HR_CAPABILITIES] : [], isActive: e.isActive, personnelNumber: e.personnelNumber,
      plannedDays: e.plannedDays, carryOver: e.carryOver, empType: e.empType === 'ipsz' ? 'ipsz' : 'staff',
    });

    const entries: Entry[] = [];
    const seen = new Map<string, number>();
    let temp = 0;
    for (const record of records) {
      const key = record.email ?? (record.login ? `login:${lower(record.login)}` : record.personnelNumber ? `pn:${record.personnelNumber}` : `line:${record.line}`);
      const entry: Entry = {
        record, key, user: null, action: 'create', final: {}, touched: new Set(), changes: [], conflicts: [],
        errors: [], warnings: [...record.notes], person: 0,
      };
      entries.push(entry);
      if (!record.email && !record.login && !record.personnelNumber) { entry.errors.push('нет email, логина и табельного номера'); continue; }
      if (record.email && !EMAIL.test(record.email)) { entry.errors.push(`email «${record.email}» указан неверно`); continue; }
      if (seen.has(key)) { entry.errors.push(`сотрудник повторяется (строка ${seen.get(key)})`); continue; }
      seen.set(key, record.line);

      // Сопоставление: email → логин → табельный номер
      let user: Employee | null = null;
      let matchedBy: 'email' | 'login' | 'pn' | null = null;
      if (record.email) {
        const m = byEmail.get(record.email) ?? [];
        if (m.length > 1) { entry.errors.push('в планировщике несколько сотрудников с таким email — исправьте в планировщике'); continue; }
        if (m.length) { user = m[0]; matchedBy = 'email'; }
      }
      if (!user && record.login && byLogin.get(lower(record.login))) { user = byLogin.get(lower(record.login))![0]; matchedBy = 'login'; }
      if (!user && record.personnelNumber && byNumber.get(record.personnelNumber)) { user = byNumber.get(record.personnelNumber)![0]; matchedBy = 'pn'; }
      if (user && matchedBy === 'login') entry.warnings.push(`сопоставлен по логину «${user.login}»`);
      if (user && matchedBy === 'pn') entry.warnings.push(`сопоставлен по табельному номеру «${user.personnelNumber}»`);
      if (user && entries.some((x) => x !== entry && x.user?.id === user!.id)) { entry.errors.push(`сотрудник ${user.name} уже есть в файле выше`); continue; }
      entry.user = user;

      if (user && !actor.isAdmin && (user.isAdmin || (user.isHr && user.id !== actor.id))) {
        entry.action = 'skip';
        entry.warnings.push('учётные записи администраторов и кадровой службы меняет администратор — запись пропущена');
        continue;
      }
      const incoming = (field: Field, own: Path | null | undefined): unknown => {
        if (field === 'heads') {
          const heads = record.heads?.flatMap((h) => (h.path === OWN_DEPARTMENT ? (own ? [own] : []) : [h.path]));
          return heads?.length ? heads : undefined;
        }
        return record[field];
      };

      if (!user) {
        entry.person = -(++temp);
        if (opts.mode === 'sync' && !opts.createMissing) { entry.errors.push('сотрудник не найден — включите «Создавать новых»'); continue; }
        if (!record.name) entry.errors.push('для нового сотрудника нужно ФИО');
        if (record.role === 'admin' && !actor.isAdmin) entry.errors.push('роль администратора назначает только администратор');
        if (record.capabilities?.length && !actor.isAdmin) entry.warnings.push('полномочия выдаёт администратор — не применяются');
        const active = opts.newUsers === 'inactive' ? false : opts.newUsers === 'file' ? record.isActive ?? true : true;
        entry.final = {
          name: record.name, email: record.email ?? null, login: record.login?.toLowerCase() ?? null, position: record.position ?? null,
          department: record.department ?? null, manager: record.manager ?? null, reportsToNone: record.reportsToNone ?? false,
          heads: (incoming('heads', record.department) as Path[] | undefined) ?? [], role: record.role ?? 'user',
          capabilities: actor.isAdmin ? record.capabilities ?? [] : [], isActive: active,
          personnelNumber: record.personnelNumber ?? null, plannedDays: record.plannedDays, carryOver: record.carryOver, empType: record.empType,
        };
        if (record.login && !LOGIN.test(record.login)) entry.errors.push(`логин «${record.login}»: латиница, цифры, «._-», 2–64 символа`);
        entry.touched = new Set(FIELDS);
        entry.action = 'create';
        continue;
      }

      entry.person = user.id;
      const cur = current(user);
      const final: Values = { ...cur };
      const own = record.department ?? cur.department;
      const fieldDecisions = decisions[key]?.fields ?? {};
      for (const field of FIELDS) {
        const inc = incoming(field, own);
        if (empty(inc)) continue;
        if (field === 'email' && matchedBy === 'email') continue;
        if ((field === 'capabilities' || (field === 'role' && (inc === 'admin' || cur.role === 'admin'))) && !actor.isAdmin) {
          if (!same(field, cur[field], inc)) entry.warnings.push(`${LABELS[field]}: служебные права выдаёт администратор — не применяется`);
          continue;
        }
        if ((field === 'role' || field === 'isActive') && user.id === actor.id && !same(field, cur[field], inc)) {
          entry.warnings.push(`${LABELS[field]}: свою учётную запись изменить нельзя — не применяется`);
          continue;
        }
        if (same(field, cur[field], inc)) continue;
        if (empty(cur[field]) && !BOOL_FIELDS.has(field)) {
          (final as Record<string, unknown>)[field] = inc;
          entry.touched.add(field);
          entry.changes.push({ field, label: LABELS[field], old: '', new: show(field, inc) });
          continue;
        }
        const choices: Choice[] = ['current', 'incoming'];
        if (LIST_FIELDS.has(field)) choices.push('merge');
        if (CUSTOM_FIELDS.has(field)) choices.push('custom');
        let note: string | null = null;
        if (field === 'login') {
          const holder = byLogin.get(lower(inc as string))?.[0];
          if (holder && holder.id !== user.id) { choices.splice(choices.indexOf('incoming'), 1); note = `логин «${String(inc)}» занят: ${holder.name}`; }
        }
        // Быстрый импорт: файл главнее, руководство подразделениями добавляется
        const chosen = opts.mode === 'sync' ? { choice: (field === 'heads' ? 'merge' : 'incoming') as Choice } : fieldDecisions[field] ?? {};
        const choice: Choice = chosen.choice && choices.includes(chosen.choice) ? chosen.choice : 'current';
        let value: unknown = cur[field];
        if (choice === 'incoming') value = inc;
        else if (choice === 'merge') value = merge(field, cur[field], inc);
        else if (choice === 'custom') {
          const [v, error] = custom(field, chosen.value);
          if (error) entry.errors.push(`${LABELS[field]}: ${error}`); else value = v;
        }
        if (choice !== 'current' && !same(field, cur[field], value)) {
          (final as Record<string, unknown>)[field] = value;
          entry.touched.add(field);
        }
        if (opts.mode === 'sync') {
          if (entry.touched.has(field)) entry.changes.push({ field, label: LABELS[field], old: show(field, cur[field]), new: show(field, value) });
          continue;
        }
        entry.conflicts.push({
          field, label: LABELS[field], current: show(field, cur[field]), incoming: show(field, inc),
          merged: LIST_FIELDS.has(field) ? show(field, merge(field, cur[field], inc)) : null,
          choices, choice, value: choice === 'custom' ? show(field, value) : null, note,
        });
        if (choice !== 'current' && entry.touched.has(field)) {
          entry.changes.push({ field, label: LABELS[field], old: show(field, cur[field]), new: show(field, value) });
        }
      }
      if (record.externalId && !user.externalId) entry.warnings.push(`внешний ID «${record.externalId}» будет записан`);
      entry.final = final;
      entry.action = entry.touched.size || (record.externalId && !user.externalId) ? 'update' : 'unchanged';
    }

    this.checkUnique(entries, byLogin, byEmail, byNumber);
    const created = this.resolve(entries, tree, people, byEmail, byLogin);
    for (const e of entries) if (e.errors.length && e.action !== 'skip') e.action = 'error';
    return { entries, created, tree, byId };
  }

  /** Логины, email и табельные номера после загрузки не повторяются. */
  private checkUnique(entries: Entry[], byLogin: Map<string, Employee[]>, byEmail: Map<string, Employee[]>, byNumber: Map<string, Employee[]>) {
    const live = entries.filter((e) => !e.errors.length && (e.action === 'create' || e.action === 'update'));
    const taken = { login: new Map<string, number>(), email: new Map<string, number>(), pn: new Map<string, number>() };
    for (const e of live) {
      const own = e.user?.id;
      const check = (kind: 'login' | 'email' | 'pn', value: string | null | undefined, sys: Map<string, Employee[]>, label: string) => {
        if (!value) return;
        const holder = sys.get(kind === 'pn' ? value : value.toLowerCase())?.find((x) => x.id !== own);
        if (holder) e.errors.push(`${label} «${value}» уже у сотрудника ${holder.name}`);
        const k = kind === 'pn' ? value : value.toLowerCase();
        if (taken[kind].has(k)) e.errors.push(`${label} «${value}» повторяется (строка ${taken[kind].get(k)})`);
        else taken[kind].set(k, e.record.line);
      };
      if (e.action === 'create' || e.touched.has('login')) check('login', e.final.login, byLogin, 'логин');
      if (e.action === 'create' || e.touched.has('email')) check('email', e.final.email, byEmail, 'email');
      if (e.action === 'create' || e.touched.has('personnelNumber')) check('pn', e.final.personnelNumber, byNumber, 'табельный номер');
    }
  }

  /**
   * Подразделения по путям (недостающие создаются), руководство подразделениями, явные руководители и
   * проверка циклов подчинения — на структуре «после загрузки».
   */
  private resolve(entries: Entry[], tree: OrgTree, people: Employee[], byEmail: Map<string, Employee[]>, byLogin: Map<string, Employee[]>) {
    const created: Array<{ key: number; name: string; parentKey: number | null; kind: string; path: string }> = [];
    const kids = new Map<string, number>();
    for (const d of tree.byId.values()) kids.set(`${d.parentId ?? 0}|${nameKey(d.name)}`, d.id);
    const hasRoots = tree.children(null).length > 0;
    const deptOf = (path: Path | null | undefined): number | null => {
      if (!path?.length) return null;
      let parent: number | null = null;
      path.forEach((name, depth) => {
        const k = `${parent ?? 0}|${nameKey(name)}`;
        if (!kids.has(k)) {
          const key = -(created.length + 1);
          created.push({ key, name, parentKey: parent, kind: depth === 0 && !hasRoots ? 'company' : 'department', path: pathText(path.slice(0, depth + 1)) });
          kids.set(k, key);
        }
        parent = kids.get(k)!;
      });
      return parent;
    };

    const live = entries.filter((e) => !e.errors.length && (e.action === 'create' || e.action === 'update' || e.action === 'unchanged'));
    // Будущее состояние: подразделения и сотрудники
    const nodes = new Map<number, DeptNode>([...tree.byId.values()].map((d) => [d.id, { ...d }]));
    const person = new Map(people.map((p) => [p.id, { deptId: p.deptId, managerId: p.managerId, reportsToNone: p.reportsToNone, isActive: p.isActive }]));
    for (const e of live) {
      e.deptKey = deptOf(e.final.department);
      e.headKeys = (e.final.heads ?? []).map((p) => deptOf(p)!).filter((k) => k !== null);
      person.set(e.person, {
        deptId: e.deptKey, managerId: e.user?.managerId ?? null, reportsToNone: e.final.reportsToNone ?? false, isActive: e.final.isActive ?? true,
      });
    }
    for (const c of created) {
      nodes.set(c.key, { id: c.key, name: c.name, parentId: c.parentKey, kind: c.kind, sortOrder: 0, externalId: null, managerId: null, managerActive: false, managerDeptId: null });
    }
    // Руководство подразделениями: у подразделения один руководитель
    const claimedBy = new Map<number, Entry>();
    for (const e of live) {
      if (!(e.touched.has('heads') || e.action === 'create')) continue;
      if (e.user) for (const n of nodes.values()) if (n.managerId === e.user.id && !e.headKeys!.includes(n.id)) n.managerId = null;
      for (const k of e.headKeys!) {
        const other = claimedBy.get(k);
        if (other) { e.errors.push(`подразделением «${pathText(this.pathOf(nodes, k))}» в файле руководит и ${other.final.name ?? other.record.email} — оставьте одного`); continue; }
        claimedBy.set(k, e);
        const prev = nodes.get(k)!.managerId;
        if (prev !== null && prev !== e.person && prev > 0) {
          e.warnings.push(`«${pathText(this.pathOf(nodes, k))}»: руководитель ${people.find((p) => p.id === prev)?.name ?? ''} будет заменён`);
        }
        nodes.get(k)!.managerId = e.person;
      }
    }
    const build = () => new OrgTree([...nodes.values()].map((n) => {
      const head = n.managerId !== null ? person.get(n.managerId) : undefined;
      return { ...n, managerActive: head?.isActive ?? false, managerDeptId: head?.deptId ?? null };
    }));
    let future = build();

    // Явные руководители — по email или логину: сначала из файла, затем из планировщика
    const fileRef = new Map<string, number>();
    for (const e of live) {
      if (e.final.email) fileRef.set(e.final.email.toLowerCase(), e.person);
      if (e.final.login) fileRef.set(e.final.login.toLowerCase(), e.person);
    }
    const refKey = (ref: string) => fileRef.get(ref) ?? byEmail.get(ref)?.[0]?.id ?? byLogin.get(ref)?.[0]?.id;
    for (const e of live) {
      if (!(e.touched.has('manager') || e.action === 'create')) { e.explicit = e.user?.managerId ?? null; continue; }
      const ref = e.final.manager;
      let target = ref ? refKey(ref) ?? null : null;
      if (ref && target === null) {
        e.warnings.push(`руководитель ${ref} не найден ни в планировщике, ни в файле — не назначается`);
        e.touched.delete('manager');
        e.changes = e.changes.filter((c) => c.field !== 'manager');
      }
      if (target === e.person) { e.errors.push('сотрудник указан своим руководителем'); target = null; }
      e.explicit = target !== null && future.structuralManager(e.deptKey ?? null, e.person) !== target ? target : null;
      person.get(e.person)!.managerId = e.explicit;
    }
    future = build();
    // Руководитель совпал с руководителем по структуре — явный не нужен, изменения нет
    for (const e of live) {
      if (e.user && e.touched.has('manager') && e.explicit === e.user.managerId) {
        e.touched.delete('manager');
        e.changes = e.changes.filter((c) => c.field !== 'manager');
      }
      if (e.action === 'update' && !e.touched.size && !(e.record.externalId && !e.user?.externalId)) e.action = 'unchanged';
    }

    // Циклы подчинения: идём вверх по руководителям, пока не вернёмся к себе
    const approver = (id: number): number | null => {
      const p = person.get(id);
      if (!p || p.reportsToNone) return null;
      if (p.managerId !== null && p.managerId !== id) return p.managerId;
      return future.structuralManager(p.deptId, id);
    };
    for (const e of live) {
      const seenIds = new Set<number>([e.person]);
      for (let m = approver(e.person), steps = 0; m !== null && steps < 1000; m = approver(m), steps++) {
        if (m === e.person) { e.errors.push('цикл подчинения: руководитель подчиняется сотруднику'); break; }
        if (seenIds.has(m)) break;
        seenIds.add(m);
      }
    }
    return created;
  }

  private pathOf(nodes: Map<number, DeptNode>, id: number): Path {
    const out: string[] = [];
    for (let n = nodes.get(id), i = 0; n && i < 100; n = n.parentId !== null ? nodes.get(n.parentId) : undefined, i++) out.unshift(n.name);
    return out;
  }

  private view(entries: Entry[], created: Array<{ key: number; path: string }>) {
    const count = (a: Entry['action']) => entries.filter((e) => e.action === a).length;
    const errors = entries.filter((e) => e.errors.length).length;
    return {
      summary: {
        records: entries.length, create: count('create'), update: count('update'), unchanged: count('unchanged'), skip: count('skip'),
        conflicts: entries.reduce((n, e) => n + e.conflicts.length, 0), errors, createDepartments: created.length,
      },
      departments: created.map((c) => ({ key: String(c.key), path: c.path })),
      records: entries.map((e) => ({
        key: e.key, line: e.record.line, action: e.action, employeeId: e.user?.id ?? null,
        name: e.final.name ?? e.record.name ?? e.user?.name ?? '', email: e.final.email ?? e.record.email ?? '',
        changes: e.changes, conflicts: e.conflicts, errors: e.errors, warnings: e.warnings,
      })),
      canApply: !errors,
    };
  }

  async plan(actor: StaffActor, records: PersonRecord[], opts: TransferOptions) {
    const { entries, created } = await this.build(actor, records, opts);
    return this.view(entries, created);
  }

  /** План и, если ошибок нет, применение одной транзакцией. Новым — одноразовые пароли (показываются один раз). */
  async apply(actor: StaffActor, records: PersonRecord[], opts: TransferOptions, source: string) {
    const { entries, created } = await this.build(actor, records, opts);
    const result = this.view(entries, created);
    if (!result.canApply) return { ...result, applied: false, credentials: [] as Array<{ login: string; name: string; password: string }> };

    const live = entries.filter((e) => e.action === 'create' || e.action === 'update');
    const creates = live.filter((e) => e.action === 'create');
    const taken = new Set((await this.prisma.employee.findMany({ select: { login: true } })).map((e) => e.login.toLowerCase()));
    for (const e of live) if (e.final.login) taken.add(e.final.login.toLowerCase());
    for (const e of creates) {
      if (e.final.login) continue;
      const base = (e.final.name ? translitLogin(e.final.name) : e.final.email?.split('@')[0] ?? 'user').replace(/[^a-z0-9._-]/g, '') || 'user';
      let login = base;
      for (let i = 2; taken.has(login); i++) login = `${base}${i}`;
      taken.add(login);
      e.final.login = login;
    }
    // Пароли хешируются до транзакции — пачками, как в импорте XLSX
    const length = await oneTimePasswordLength(this.prisma);
    const secrets = new Map<Entry, { password: string; hash: string }>();
    for (let i = 0; i < creates.length; i += 64) {
      await Promise.all(creates.slice(i, i + 64).map(async (e) => {
        const password = generatePassword(length);
        secrets.set(e, { password, hash: await hashPassword(password) });
      }));
    }

    const credentials: Array<{ login: string; name: string; password: string }> = [];
    await this.prisma.$transaction(async (tx) => {
      const ids = new Map<number, number>(); // временный ключ → id
      const real = (k: number | null | undefined) => (k === null || k === undefined ? null : k < 0 ? ids.get(k)! : k);
      for (const c of created) {
        const d = await tx.department.create({ data: { name: c.name, parentId: real(c.parentKey), kind: c.kind, orgSource: source === 'csv' ? 'csv' : 'import' } });
        ids.set(c.key, d.id);
        await this.audit.record(tx, { actorId: actor.id, action: 'department.created', entity: 'department', entityId: d.id, after: { name: c.name, parentId: d.parentId, kind: c.kind, source } });
      }
      const people = new Map<number, number>(); // ключ сотрудника → id
      for (const e of creates) {
        const f = e.final;
        const emp = await tx.employee.create({
          data: {
            login: f.login!, passwordHash: secrets.get(e)!.hash, name: f.name!, email: f.email ?? null, position: f.position ?? null,
            deptId: real(e.deptKey), role: f.role === 'manager' ? 'manager' : 'employee', isAdmin: actor.isAdmin && f.role === 'admin',
            isHr: actor.isAdmin && (f.capabilities ?? []).includes('users.manage'), isActive: f.isActive ?? true,
            reportsToNone: f.reportsToNone ?? false, personnelNumber: f.personnelNumber ?? null, externalId: e.record.externalId ?? null,
            plannedDays: f.plannedDays ?? 28, carryOver: f.carryOver ?? 0, empType: f.empType ?? 'staff',
            orgSource: source === 'csv' ? 'csv' : 'import', mustChangePassword: true,
          },
        });
        people.set(e.person, emp.id);
        credentials.push({ login: emp.login, name: emp.name, password: secrets.get(e)!.password });
      }
      const personId = (k: number | null | undefined) => (k === null || k === undefined ? null : k < 0 ? people.get(k) ?? null : k);

      for (const e of live) {
        const id = personId(e.person)!;
        const before = await tx.employee.findUniqueOrThrow({ where: { id } });
        const t = e.touched;
        const f = e.final;
        const update = e.action === 'update';
        const data = {
          ...(update && t.has('name') ? { name: f.name } : {}),
          ...(update && t.has('email') ? { email: f.email } : {}),
          ...(update && t.has('login') ? { login: f.login! } : {}),
          ...(update && t.has('position') ? { position: f.position } : {}),
          ...(update && t.has('department') ? { deptId: real(e.deptKey) } : {}),
          ...(update && t.has('reportsToNone') ? { reportsToNone: f.reportsToNone } : {}),
          ...(update && t.has('role') ? { role: f.role === 'manager' ? 'manager' : 'employee', ...(actor.isAdmin ? { isAdmin: f.role === 'admin' } : {}) } : {}),
          ...(update && t.has('capabilities') && actor.isAdmin ? { isHr: (f.capabilities ?? []).includes('users.manage') } : {}),
          ...(update && t.has('isActive') ? { isActive: f.isActive } : {}),
          ...(update && t.has('personnelNumber') ? { personnelNumber: f.personnelNumber } : {}),
          ...(update && t.has('plannedDays') ? { plannedDays: f.plannedDays } : {}),
          ...(update && t.has('carryOver') ? { carryOver: f.carryOver } : {}),
          ...(update && t.has('empType') ? { empType: f.empType } : {}),
          ...(update && e.record.externalId && !before.externalId ? { externalId: e.record.externalId } : {}),
          ...(t.has('manager') || e.action === 'create' ? { managerId: personId(e.explicit) } : {}),
        };
        const after = Object.keys(data).length ? await tx.employee.update({ where: { id }, data }) : before;
        if (t.has('heads') || e.action === 'create') {
          const heads = (e.headKeys ?? []).map((k) => real(k)!);
          await tx.department.updateMany({ where: { managerId: id, id: { notIn: heads } }, data: { managerId: null } });
          for (const d of heads) {
            const prev = await tx.department.findUniqueOrThrow({ where: { id: d }, select: { managerId: true } });
            if (prev.managerId === id) continue;
            await tx.department.update({ where: { id: d }, data: { managerId: id } });
            await this.audit.record(tx, { actorId: actor.id, action: 'department.updated', entity: 'department', entityId: d, before: { managerId: prev.managerId }, after: { managerId: id, source } });
          }
        }
        await this.audit.record(tx, {
          actorId: actor.id, action: e.action === 'create' ? 'employee.created' : 'employee.updated', entity: 'employee', entityId: id,
          before: e.action === 'create' ? null : toPublic(before), after: { ...toPublic(after), source },
        });
      }
    }, { timeout: 120_000 });
    return { ...result, applied: true, credentials };
  }
}

/** Значения формы загрузки (multipart) → параметры плана. */
export function transferOptions(body: Record<string, unknown>, mode: TransferOptions['mode']): TransferOptions {
  let decisions: Decisions | undefined;
  if (typeof body.decisions === 'string' && body.decisions.trim()) {
    try { decisions = JSON.parse(body.decisions) as Decisions; } catch { decisions = undefined; }
  } else if (body.decisions && typeof body.decisions === 'object') decisions = body.decisions as Decisions;
  const newUsers = body.newUsers === 'inactive' || body.newUsers === 'file' ? body.newUsers : 'active';
  return { mode, decisions, newUsers, createMissing: toBool(body.createMissing) ?? false };
}

