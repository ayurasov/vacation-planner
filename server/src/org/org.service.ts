// Структура компании (v1.1.0, E70-01, ADR-018): дерево подразделений, виды уровней и операции над ними —
// по образцу «По Делу», чтобы структура переносилась между инструментами без потерь.
import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { OrgTree, type DeptNode } from './org-tree';

type Db = PrismaClient | Prisma.TransactionClient;

export interface UnitKind { value: string; label: string; color: string }

/** Виды уровней по умолчанию — те же, что в «По Делу» (settings/routes.py, org_unit_kinds). */
export const DEFAULT_UNIT_KINDS: readonly UnitKind[] = [
  { value: 'company', label: 'Компания', color: '#7c3aed' },
  { value: 'division', label: 'Дирекция', color: '#0369a1' },
  { value: 'direction', label: 'Направление', color: '#0f766e' },
  { value: 'service', label: 'Служба', color: '#b45309' },
  { value: 'department', label: 'Отдел', color: '#4f7cff' },
  { value: 'sector', label: 'Сектор', color: '#be185d' },
  { value: 'group', label: 'Группа', color: '#15803d' },
  { value: 'position', label: 'Позиция', color: '#64748b' },
];

const KIND_VALUE = /^[a-z][a-z0-9_-]{0,31}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Проверка списка видов (правила «По Делу»): код, подпись 1–40 символов, цвет #RRGGBB, 1–30 видов. */
export function validUnitKinds(raw: unknown): UnitKind[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) return null;
  const seen = new Set<string>();
  const out: UnitKind[] = [];
  for (const k of raw as Array<Record<string, unknown>>) {
    const value = String(k?.value ?? '');
    const label = String(k?.label ?? '').trim();
    const color = String(k?.color ?? '');
    if (!KIND_VALUE.test(value) || !label || label.length > 40 || !COLOR.test(color) || seen.has(value)) return null;
    seen.add(value);
    out.push({ value, label, color: color.toLowerCase() });
  }
  return out;
}

/** Дерево из БД — любым клиентом, в том числе внутри транзакции. */
export async function loadTree(db: Db): Promise<OrgTree> {
  const rows = await db.department.findMany({
    select: {
      id: true, name: true, parentId: true, kind: true, sortOrder: true, externalId: true, managerId: true,
      manager: { select: { isActive: true, deptId: true } },
    },
  });
  return new OrgTree(rows.map((r): DeptNode => ({
    id: r.id, name: r.name, parentId: r.parentId, kind: r.kind, sortOrder: r.sortOrder, externalId: r.externalId,
    managerId: r.managerId, managerActive: r.manager?.isActive ?? false, managerDeptId: r.manager?.deptId ?? null,
  })));
}

export async function unitKinds(db: Db): Promise<UnitKind[]> {
  const s = await db.orgSettings.findUnique({ where: { id: 1 }, select: { unitKinds: true } });
  return validUnitKinds(s?.unitKinds) ?? [...DEFAULT_UNIT_KINDS];
}

export async function maxDepth(db: Db): Promise<number> {
  const s = await db.orgSettings.findUnique({ where: { id: 1 }, select: { orgMaxDepth: true } });
  return s?.orgMaxDepth ?? 15;
}

/** Подписи подразделений и разбор параметра dept — для выдач и фильтров. */
export interface DeptLabels {
  tree: OrgTree;
  /** Подпись подразделения сотрудника; null — без подразделения. */
  label(id: number | null | undefined): string | null;
  /** Подразделения фильтра dept: найденное и вложенные; не найдено — пусто (ничего не подходит). */
  ids(text: string): number[];
}

export async function deptLabels(db: Db): Promise<DeptLabels> {
  const tree = await loadTree(db);
  return {
    tree,
    label: (id) => (id === null || id === undefined ? null : tree.byId.has(id) ? tree.label(id) : null),
    ids: (text) => {
      // Значение фильтра — подпись; id — запасной вариант (подразделение с названием «101» найдётся по названию)
      const n = tree.findByLabel(text) ?? (/^\d+$/.test(text) ? tree.byId.get(Number(text)) : undefined);
      return n ? tree.subtree(n.id) : [];
    },
  };
}

export interface DeptInput {
  name?: string;
  parentId?: number | null;
  kind?: string;
  sortOrder?: number;
  managerId?: number | null;
  externalId?: string | null;
}

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  tree(db: Db = this.prisma): Promise<OrgTree> {
    return loadTree(db);
  }

  labels(db: Db = this.prisma): Promise<DeptLabels> {
    return deptLabels(db);
  }

  /** Подразделение по id или подписи (параметр пути и dept): одноимённые различаются подписью. */
  async resolve(ref: string, db: Db = this.prisma): Promise<DeptNode> {
    const tree = await loadTree(db);
    const node = (/^\d+$/.test(ref) ? tree.byId.get(Number(ref)) : undefined) ?? tree.findByLabel(ref);
    if (!node) throw new ProblemException('not-found');
    return node;
  }

  /** Подразделения в порядке дерева: путь, уровень, подпись, руководитель и численность. */
  async list() {
    const [tree, heads, counts] = await Promise.all([
      loadTree(this.prisma),
      this.prisma.employee.findMany({ where: { managedDepts: { some: {} } }, select: { id: true, name: true } }),
      this.prisma.employee.groupBy({ by: ['deptId'], where: { isActive: true }, _count: true }),
    ]);
    const headName = new Map(heads.map((h) => [h.id, h.name]));
    const headcount = new Map(counts.map((c) => [c.deptId, c._count]));
    return tree.ordered().map((d) => ({
      id: d.id, name: d.name, label: tree.label(d.id), parentId: d.parentId, path: tree.path(d.id), level: tree.level(d.id),
      kind: d.kind, sortOrder: d.sortOrder, externalId: d.externalId,
      managerId: d.managerId, managerName: d.managerId !== null ? headName.get(d.managerId) ?? null : null,
      headcount: headcount.get(d.id) ?? 0,
    }));
  }

  /** Проверки дерева для создания и изменения: соседи, цикл, глубина, вид, руководитель. */
  private async check(tx: Db, input: DeptInput, current?: DeptNode): Promise<void> {
    const tree = await loadTree(tx);
    const parentId = input.parentId !== undefined ? input.parentId : current?.parentId ?? null;
    const name = (input.name ?? current?.name ?? '').trim();
    if (parentId !== null && !tree.byId.has(parentId)) throw new ProblemException('validation/invalid-field', 'Вышестоящее подразделение не найдено');
    if (current && parentId !== null && tree.isSelfOrAncestor(current.id, parentId)) {
      throw new ProblemException('validation/invalid-field', 'Нельзя перенести подразделение внутрь самого себя');
    }
    if (tree.siblingNamed(parentId, name, current?.id)) {
      const where = parentId !== null ? `в «${tree.byId.get(parentId)!.name}»` : 'на верхнем уровне';
      throw new ProblemException('validation/invalid-field', `Подразделение «${name}» ${where} уже есть`);
    }
    const limit = await maxDepth(tx);
    const depth = (parentId !== null ? tree.level(parentId) : 0) + (current ? tree.height(current.id) : 1);
    if (depth > limit) throw new ProblemException('validation/invalid-field', `Глубина структуры — не больше ${limit} уровней`);
    if (input.kind !== undefined && !(await unitKinds(tx)).some((k) => k.value === input.kind)) {
      throw new ProblemException('validation/invalid-field', `Неизвестный вид уровня «${input.kind}»`);
    }
    if (input.managerId !== undefined && input.managerId !== null) {
      const m = await tx.employee.findUnique({ where: { id: input.managerId }, select: { isActive: true } });
      if (!m?.isActive) throw new ProblemException('validation/invalid-field', 'Руководитель не найден или уволен');
    }
  }

  async create(actorId: number, input: DeptInput & { name: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.check(tx, input);
      const d = await tx.department.create({
        data: {
          name: input.name.trim(), parentId: input.parentId ?? null, kind: input.kind ?? 'department',
          sortOrder: input.sortOrder ?? 0, managerId: input.managerId ?? null, externalId: input.externalId ?? null,
        },
      });
      await this.audit.record(tx, { actorId, action: 'department.created', entity: 'department', entityId: d.id, after: snapshot(d) });
      return d;
    });
  }

  async update(actorId: number, id: number, input: DeptInput) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.department.findUnique({ where: { id } });
      if (!before) throw new ProblemException('not-found');
      await this.check(tx, input, (await loadTree(tx)).byId.get(id));
      const d = await tx.department.update({
        where: { id },
        data: {
          name: input.name?.trim(), parentId: input.parentId, kind: input.kind, sortOrder: input.sortOrder,
          managerId: input.managerId, externalId: input.externalId,
        },
      });
      await this.audit.record(tx, { actorId, action: 'department.updated', entity: 'department', entityId: id, before: snapshot(before), after: snapshot(d) });
      return d;
    });
  }

  async remove(actorId: number, id: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const d = await tx.department.findUnique({
        where: { id }, include: { _count: { select: { members: { where: { isActive: true } }, children: true } } },
      });
      if (!d) throw new ProblemException('not-found');
      if (d._count.children > 0) throw new ProblemException('department-not-empty', 'Сначала перенесите или удалите вложенные подразделения');
      if (d._count.members > 0) throw new ProblemException('department-not-empty');
      await tx.department.delete({ where: { id } });
      await this.audit.record(tx, { actorId, action: 'department.deleted', entity: 'department', entityId: id, before: snapshot(d) });
    });
  }
}

function snapshot(d: { name: string; parentId: number | null; kind: string; sortOrder: number; managerId: number | null; externalId: string | null }) {
  return { name: d.name, parentId: d.parentId, kind: d.kind, sortOrder: d.sortOrder, managerId: d.managerId, externalId: d.externalId };
}
