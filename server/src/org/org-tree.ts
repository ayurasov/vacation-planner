// Дерево структуры компании (v1.1.0, ADR-018): пути, уровни и глубина, проверки перемещения и правило
// руководителя — как в «По Делу». Чистые функции без БД: дерево строится из строк departments.

export interface DeptNode {
  id: number;
  name: string;
  parentId: number | null;
  kind: string;
  sortOrder: number;
  externalId: string | null;
  /** Руководитель подразделения (основной) и его состояние — для правила руководителя. */
  managerId: number | null;
  managerActive: boolean;
  /** Подразделение, в котором числится сам руководитель. */
  managerDeptId: number | null;
}

/** Ключ сравнения названий и путей: без учёта регистра, пробелы схлопнуты (как в «По Делу»). */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
export const pathKey = (path: readonly string[]) => path.map(nameKey).join('/');

export class OrgTree {
  readonly byId = new Map<number, DeptNode>();
  private readonly kids = new Map<number | null, DeptNode[]>();

  constructor(nodes: readonly DeptNode[]) {
    for (const n of nodes) this.byId.set(n.id, n);
    for (const n of nodes) {
      const parent = n.parentId !== null && this.byId.has(n.parentId) ? n.parentId : null;
      const list = this.kids.get(parent) ?? [];
      list.push(n);
      this.kids.set(parent, list);
    }
    for (const list of this.kids.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
  }

  /** Вложенные подразделения в порядке показа; null — верхний уровень. */
  children(id: number | null): DeptNode[] {
    return this.kids.get(id) ?? [];
  }

  /** Все подразделения в порядке дерева: родитель раньше вложенных. */
  ordered(): DeptNode[] {
    const out: DeptNode[] = [];
    const walk = (id: number | null) => { for (const c of this.children(id)) { out.push(c); walk(c.id); } };
    walk(null);
    return out;
  }

  /** Цепочка от корня до подразделения (включительно). */
  chain(id: number): DeptNode[] {
    const out: DeptNode[] = [];
    const seen = new Set<number>();
    for (let n = this.byId.get(id); n && !seen.has(n.id); n = n.parentId !== null ? this.byId.get(n.parentId) : undefined) {
      seen.add(n.id);
      out.unshift(n);
    }
    return out;
  }

  /** Путь названий от корня: «Компания / Служба / Отдел». */
  path(id: number): string[] {
    return this.chain(id).map((n) => n.name);
  }

  /** Уровень: 1 — верхний. */
  level(id: number): number {
    return this.chain(id).length;
  }

  /** Высота поддерева: 1 — без вложенных. */
  height(id: number): number {
    const below = this.children(id).map((c) => this.height(c.id));
    return 1 + (below.length ? Math.max(...below) : 0);
  }

  /** Подразделение и все вложенные — фильтр dept охватывает поддерево. */
  subtree(id: number): number[] {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of this.children(out[i])) out.push(c.id);
    return out;
  }

  /** a — само подразделение b или его предок. */
  isSelfOrAncestor(a: number, b: number): boolean {
    return this.chain(b).some((n) => n.id === a);
  }

  private labels: Map<number, string> | null = null;

  /**
   * Подпись подразделения — уникальна в организации: название, если оно единственное; одноимённые —
   * «Отдел продаж — Север» (с родителем), а если и так совпадают — полный путь. Подпись — значение
   * параметра dept и поля dept в API: организации без одноимённых подразделений ничего не замечают.
   */
  label(id: number): string {
    if (!this.labels) {
      this.labels = new Map();
      const byName = new Map<string, DeptNode[]>();
      for (const n of this.byId.values()) byName.set(nameKey(n.name), [...(byName.get(nameKey(n.name)) ?? []), n]);
      for (const same of byName.values()) {
        if (same.length === 1) { this.labels.set(same[0].id, same[0].name); continue; }
        const withParent = same.map((n) => {
          const parent = n.parentId !== null ? this.byId.get(n.parentId) : undefined;
          return parent ? `${n.name} — ${parent.name}` : n.name;
        });
        const unique = new Set(withParent.map(nameKey)).size === same.length;
        same.forEach((n, i) => this.labels!.set(n.id, unique ? withParent[i] : this.path(n.id).join(' / ')));
      }
    }
    return this.labels.get(id) ?? '';
  }

  /** Подразделение по подписи или по единственному названию — для параметра dept. */
  findByLabel(text: string): DeptNode | undefined {
    const key = nameKey(text);
    for (const n of this.byId.values()) if (nameKey(this.label(n.id)) === key) return n;
    const named = [...this.byId.values()].filter((n) => nameKey(n.name) === key);
    return named.length === 1 ? named[0] : undefined;
  }

  /** Подразделение по пути названий (без учёта регистра). */
  findByPath(path: readonly string[]): DeptNode | undefined {
    let parent: number | null = null;
    let found: DeptNode | undefined;
    for (const name of path) {
      found = this.children(parent).find((c) => nameKey(c.name) === nameKey(name));
      if (!found) return undefined;
      parent = found.id;
    }
    return found;
  }

  /** Соседнее подразделение с тем же названием (кроме самого себя) — названия уникальны среди соседей. */
  siblingNamed(parentId: number | null, name: string, exceptId?: number): DeptNode | undefined {
    return this.children(parentId).find((c) => c.id !== exceptId && nameKey(c.name) === nameKey(name));
  }

  /** Подразделение, чей действующий руководитель — первый вверх от deptId, не считая excludeId. */
  private firstHead(deptId: number | null, excludeId: number): DeptNode | null {
    if (deptId === null) return null;
    const chain = this.chain(deptId);
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i];
      if (n.managerId !== null && n.managerActive && n.managerId !== excludeId) return n;
    }
    return null;
  }

  /**
   * Руководитель по структуре: действующий руководитель подразделения, если это не сам сотрудник,
   * иначе — выше по дереву; на корне — никого (правило «По Делу», org_service.direct_manager).
   */
  structuralManager(deptId: number | null, employeeId: number): number | null {
    return this.firstHead(deptId, employeeId)?.managerId ?? null;
  }

  /**
   * Руководители подразделений, вправе решать по сотруднику: действующие руководители его подразделения
   * и вышестоящих — но только выше самого верхнего подразделения, которым руководит он сам (руководитель
   * отдела, числящийся в группе своего отдела, не согласует отпуск у руководителя этой группы).
   */
  decidersFor(deptId: number | null, employeeId: number): number[] {
    if (deptId === null) return [];
    const chain = this.chain(deptId);
    const top = chain.findIndex((n) => n.managerId === employeeId);
    return (top >= 0 ? chain.slice(0, top) : chain)
      .filter((n) => n.managerId !== null && n.managerActive && n.managerId !== employeeId)
      .map((n) => n.managerId!);
  }

  /**
   * Чьи заявки по структуре ждут решения этих руководителей — для SQL-фильтра очереди без загрузки всех
   * сотрудников. Сотрудники без явного руководителя:
   *  • depts — числящиеся в этих подразделениях, кроме их руководителей (exceptIds);
   *  • headIds — руководители подразделений, чей руководитель по структуре — один из этих.
   */
  approvalScope(managerIds: readonly number[]): { depts: number[]; exceptIds: number[]; headIds: number[] } {
    const managers = new Set(managerIds);
    const depts: number[] = [];
    const exceptIds: number[] = [];
    const headIds: number[] = [];
    for (const n of this.byId.values()) {
      // Рядовые сотрудники подразделения подчиняются первому действующему руководителю вверх по дереву
      const first = this.firstHead(n.id, -1);
      if (!first || first.managerId === null) continue;
      if (managers.has(first.managerId)) depts.push(n.id);
      // Сам этот руководитель, если числится здесь же, подчиняется следующему вверх
      if (first.managerDeptId === n.id) {
        exceptIds.push(first.managerId);
        const above = this.structuralManager(n.id, first.managerId);
        if (above !== null && managers.has(above)) headIds.push(first.managerId);
      }
    }
    return { depts, exceptIds, headIds };
  }
}

/** Руководитель сотрудника: «первое лицо» — никто; явный руководитель; иначе — по структуре. */
export function approverFor(
  e: { id: number; managerId: number | null; reportsToNone: boolean; deptId: number | null },
  tree: OrgTree,
): number | null {
  if (e.reportsToNone) return null;
  if (e.managerId !== null && e.managerId !== e.id) return e.managerId;
  return tree.structuralManager(e.deptId, e.id);
}
