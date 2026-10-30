// Перенос структуры компании между планировщиком и «По Делу» (v1.1.0, ADR-018): файл
// podelu.org-structure версии 1 — виды уровней, глубина и дерево подразделений с видом, порядком,
// внешним ключом и руководителями по email. Загрузка — как в «По Делу»: план без записи в БД,
// затем то же одной транзакцией. Подразделения сопоставляются по пути от корня (без учёта регистра
// и лишних пробелов); отсутствующие в файле не удаляются, ничего не переименовывается и не переносится.
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadTree, maxDepth, unitKinds, validUnitKinds, type UnitKind } from './org.service';
import { APP_STAMP, MAX_DEPARTMENTS, STRUCTURE_FORMAT, TRANSFER_VERSION, TransferFormatError } from './transfer-format';

/** Настройки «По Делу», которые есть и в планировщике; прочие (термины, поручения) пропускаются. */
const SETTING_LABELS = { org_unit_kinds: 'Виды уровней', org_max_depth: 'Глубина вложенности' } as const;

interface BundleDept {
  key: string;
  name: string;
  parent: string | null;
  kind: string;
  sortOrder: number;
  externalId: string | null;
  heads: Array<{ email: string; primary: boolean }>;
}

export function parseStructure(bundle: unknown): { settings: Record<string, unknown>; departments: BundleDept[]; ignored: string[] } {
  let doc = bundle;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc.replace(/^﻿/, '')); } catch { throw new TransferFormatError('Файл не является JSON'); }
  }
  if (!doc || typeof doc !== 'object' || (doc as Record<string, unknown>).format !== STRUCTURE_FORMAT) {
    throw new TransferFormatError(`Это не файл структуры «По Делу» (format: ${STRUCTURE_FORMAT})`);
  }
  const d = doc as Record<string, unknown>;
  if (d.version !== TRANSFER_VERSION) throw new TransferFormatError(`Версия файла ${String(d.version)} не поддерживается — нужна ${TRANSFER_VERSION}`);
  if (!Array.isArray(d.departments)) throw new TransferFormatError('В файле нет списка подразделений');
  if (d.departments.length > MAX_DEPARTMENTS) throw new TransferFormatError(`Не больше ${MAX_DEPARTMENTS} подразделений в одном файле`);
  const keys = new Set<string>();
  const departments = d.departments.map((item: unknown, i): BundleDept => {
    if (!item || typeof item !== 'object') throw new TransferFormatError(`Подразделение №${i + 1}: ожидается объект`);
    const o = item as Record<string, unknown>;
    const key = String(o.key ?? '');
    const name = String(o.name ?? '').trim().replace(/\s+/g, ' ');
    if (!key || !name) throw new TransferFormatError(`Подразделение №${i + 1}: нужны key и name`);
    if (keys.has(key)) throw new TransferFormatError(`Подразделение №${i + 1}: key «${key}» повторяется`);
    const parent = o.parent === null || o.parent === undefined ? null : String(o.parent);
    if (parent !== null && !keys.has(parent)) throw new TransferFormatError(`Подразделение «${name}»: родитель «${parent}» должен идти в файле раньше`);
    keys.add(key);
    const heads = (Array.isArray(o.heads) ? o.heads : []).flatMap((h: unknown) => {
      const email = h && typeof h === 'object' ? String((h as Record<string, unknown>).email ?? '').trim().toLowerCase() : '';
      return email ? [{ email, primary: Boolean((h as Record<string, unknown>).primary) }] : [];
    });
    const sortOrder = Number.parseInt(String(o.sortOrder ?? 0), 10);
    return {
      key, name: name.slice(0, 128), parent, kind: String(o.kind || 'department'),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0, externalId: o.externalId ? String(o.externalId).slice(0, 128) : null, heads,
    };
  });
  const raw = d.settings && typeof d.settings === 'object' ? d.settings as Record<string, unknown> : {};
  const settings = Object.fromEntries(Object.entries(raw).filter(([k]) => k in SETTING_LABELS));
  return { settings, departments, ignored: Object.keys(raw).filter((k) => !(k in SETTING_LABELS)) };
}

const kindsText = (kinds: UnitKind[]) => kinds.map((k) => `${k.label} (${k.value})`).join(', ');

export interface StructurePlan {
  summary: {
    departments: number; create: number; update: number; unchanged: number; settings: number;
    addHeads: number; pendingHeads: number; skippedHeads: number; missingInFile: number; errors: number;
  };
  settings: Array<{ key: string; label: string; current: string; incoming: string }>;
  departments: Array<{ key: string; path: string; action: 'create' | 'update' | 'unchanged'; changes: Array<{ field: string; old: unknown; new: unknown }> }>;
  heads: Array<{ departmentKey: string; path: string; email: string; name: string; primary: boolean; action: 'add' | 'exists' | 'pending' | 'skip'; note: string | null }>;
  missingInFile: string[];
  notes: string[];
  errors: string[];
  canApply: boolean;
}

interface Internal {
  plan: StructurePlan;
  departments: BundleDept[];
  targets: Map<string, number | null>;
  headUser: Map<string, number>;
  patch: { unitKinds?: UnitKind[]; orgMaxDepth?: number };
}

@Injectable()
export class StructureTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Структура и её настройки — документ JSON «По Делу». Родители раньше вложенных. */
  async export(now: Date) {
    const [tree, kinds, depth] = await Promise.all([loadTree(this.prisma), unitKinds(this.prisma), maxDepth(this.prisma)]);
    const heads = await this.prisma.employee.findMany({ where: { managedDepts: { some: {} } }, select: { id: true, email: true } });
    const email = new Map(heads.map((h) => [h.id, h.email]));
    return {
      format: STRUCTURE_FORMAT,
      version: TRANSFER_VERSION,
      exportedAt: now.toISOString(),
      app: APP_STAMP,
      settings: { org_unit_kinds: kinds, org_max_depth: depth },
      departments: tree.ordered().map((d) => ({
        key: String(d.id), name: d.name, parent: d.parentId !== null ? String(d.parentId) : null, kind: d.kind,
        sortOrder: d.sortOrder, externalId: d.externalId,
        // Руководитель без email в «По Делу» не сопоставится — в файл не попадает
        heads: d.managerId !== null && email.get(d.managerId) ? [{ email: email.get(d.managerId)!.toLowerCase(), primary: true }] : [],
      })),
    };
  }

  private async build(bundle: unknown, applySettings: boolean): Promise<Internal> {
    const { settings, departments, ignored } = parseStructure(bundle);
    const plan: StructurePlan = {
      summary: { departments: 0, create: 0, update: 0, unchanged: 0, settings: 0, addHeads: 0, pendingHeads: 0, skippedHeads: 0, missingInFile: 0, errors: 0 },
      settings: [], departments: [], heads: [], missingInFile: [], notes: [], errors: [], canApply: false,
    };
    if (ignored.length) plan.notes.push(`Настройки «По Делу», которых нет в планировщике, пропущены: ${ignored.join(', ')}`);
    const tree = await loadTree(this.prisma);
    let kinds = await unitKinds(this.prisma);
    let limit = await maxDepth(this.prisma);
    const patch: Internal['patch'] = {};

    // Настройки: виды из файла плюс уже используемые, которых в файле нет (как в «По Делу»)
    if (applySettings && 'org_unit_kinds' in settings) {
      const incoming = validUnitKinds(settings.org_unit_kinds);
      if (!incoming) plan.errors.push('Виды уровней в файле: код латиницей, название до 40 символов, цвет #RRGGBB');
      else {
        const used = new Set([...tree.byId.values()].map((d) => d.kind));
        const merged = [...incoming, ...kinds.filter((k) => used.has(k.value) && !incoming.some((i) => i.value === k.value))];
        if (kindsText(merged) !== kindsText(kinds)) {
          plan.settings.push({ key: 'org_unit_kinds', label: SETTING_LABELS.org_unit_kinds, current: kindsText(kinds), incoming: kindsText(merged) });
          patch.unitKinds = merged;
        }
        kinds = merged;
      }
    }
    if (applySettings && 'org_max_depth' in settings) {
      const n = Number.parseInt(String(settings.org_max_depth), 10);
      if (!Number.isFinite(n)) plan.errors.push('org_max_depth: ожидается целое число');
      else {
        const next = Math.max(2, Math.min(30, n));
        if (next !== limit) {
          plan.settings.push({ key: 'org_max_depth', label: SETTING_LABELS.org_max_depth, current: String(limit), incoming: String(next) });
          patch.orgMaxDepth = next;
        }
        limit = next;
      }
    }
    const kindValues = new Set(kinds.map((k) => k.value));

    // Подразделения: путь от корня → существующее или новое
    const targets = new Map<string, number | null>();
    const paths = new Map<string, string[]>();
    const depthOf = new Map<string, number>();
    const matched = new Set<number>();
    for (const item of departments) {
      const parentTarget = item.parent !== null ? targets.get(item.parent) ?? null : null;
      const path = [...(item.parent !== null ? paths.get(item.parent)! : []), item.name];
      paths.set(item.key, path);
      depthOf.set(item.key, (item.parent !== null ? depthOf.get(item.parent)! : 0) + 1);
      const label = path.join(' / ');
      if (!kindValues.has(item.kind)) plan.errors.push(`${label}: вид «${item.kind}» не задан в настройках`);
      const row = item.parent === null || parentTarget !== null ? tree.siblingNamed(parentTarget, item.name) : undefined;
      if (!row) {
        targets.set(item.key, null);
        plan.departments.push({ key: item.key, path: label, action: 'create', changes: [] });
        continue;
      }
      targets.set(item.key, row.id);
      matched.add(row.id);
      const changes: StructurePlan['departments'][number]['changes'] = [];
      if (row.kind !== item.kind) changes.push({ field: 'kind', old: row.kind, new: item.kind });
      if (row.sortOrder !== item.sortOrder) changes.push({ field: 'sortOrder', old: row.sortOrder, new: item.sortOrder });
      plan.departments.push({ key: item.key, path: label, action: changes.length ? 'update' : 'unchanged', changes });
    }
    const deepest = Math.max(0, ...depthOf.values(), ...tree.children(null).map((n) => tree.height(n.id)));
    if (deepest > limit) plan.errors.push(`Вложенность после загрузки — ${deepest} уровней, а допустимо ${limit}: увеличьте глубину в настройках`);
    plan.missingInFile = tree.ordered().filter((d) => !matched.has(d.id)).map((d) => tree.path(d.id).join(' / '));

    // Руководители: по email. В планировщике у подразделения один руководитель — основной из файла
    const emails = [...new Set(departments.flatMap((d) => d.heads.map((h) => h.email)))];
    const people = emails.length
      ? await this.prisma.employee.findMany({ where: { email: { in: emails, mode: 'insensitive' }, isActive: true }, select: { id: true, name: true, email: true } })
      : [];
    const byEmail = new Map(people.map((p) => [p.email!.toLowerCase(), p]));
    const headUser = new Map<string, number>();
    for (const item of departments) {
      const target = targets.get(item.key) ?? null;
      const current = target !== null ? tree.byId.get(target)!.managerId : null;
      const chosen = item.heads.find((h) => h.primary) ?? item.heads[0];
      for (const h of item.heads) {
        const user = byEmail.get(h.email);
        let action: StructurePlan['heads'][number]['action'];
        let note: string | null = null;
        if (h !== chosen) { action = 'skip'; note = 'в планировщике у подразделения один руководитель — дополнительные не переносятся'; }
        else if (!user) { action = 'pending'; note = 'сотрудника с таким email нет — назначьте после загрузки сотрудников'; }
        else if (current === user.id) action = 'exists';
        else if (current !== null) { action = 'skip'; note = 'у подразделения уже есть руководитель — не меняется'; }
        else { action = 'add'; headUser.set(item.key, user.id); }
        plan.heads.push({ departmentKey: item.key, path: paths.get(item.key)!.join(' / '), email: h.email, name: user?.name ?? '', primary: h.primary, action, note });
      }
    }

    const count = (a: string) => plan.departments.filter((d) => d.action === a).length;
    plan.summary = {
      departments: plan.departments.length, create: count('create'), update: count('update'), unchanged: count('unchanged'),
      settings: plan.settings.length,
      addHeads: plan.heads.filter((h) => h.action === 'add').length,
      pendingHeads: plan.heads.filter((h) => h.action === 'pending').length,
      skippedHeads: plan.heads.filter((h) => h.action === 'skip').length,
      missingInFile: plan.missingInFile.length, errors: plan.errors.length,
    };
    plan.canApply = !plan.errors.length;
    return { plan, departments, targets, headUser, patch };
  }

  plan(bundle: unknown, applySettings: boolean): Promise<StructurePlan> {
    return this.build(bundle, applySettings).then((x) => x.plan);
  }

  /** План и, если ошибок нет, применение одной транзакцией с аудитом. */
  async apply(actorId: number, bundle: unknown, applySettings: boolean): Promise<StructurePlan & { applied: boolean }> {
    const { plan, departments, targets, headUser, patch } = await this.build(bundle, applySettings);
    if (!plan.canApply) return { ...plan, applied: false };
    await this.prisma.$transaction(async (tx) => {
      if (patch.unitKinds || patch.orgMaxDepth !== undefined) {
        const before = await tx.orgSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
        await tx.orgSettings.update({ where: { id: 1 }, data: { unitKinds: patch.unitKinds as unknown as Prisma.InputJsonValue | undefined, orgMaxDepth: patch.orgMaxDepth } });
        await this.audit.record(tx, {
          actorId, action: 'settings.updated', entity: 'org_settings', entityId: '1',
          before: { unitKinds: before.unitKinds, orgMaxDepth: before.orgMaxDepth }, after: { ...patch, source: 'structure-transfer' },
        });
      }
      const ids = new Map<string, number>();
      for (const item of departments) {
        const target = targets.get(item.key) ?? null;
        const managerId = headUser.get(item.key);
        if (target === null) {
          const d = await tx.department.create({
            data: {
              name: item.name, parentId: item.parent !== null ? ids.get(item.parent)! : null, kind: item.kind,
              sortOrder: item.sortOrder, externalId: item.externalId, orgSource: 'transfer', managerId: managerId ?? null,
            },
          });
          ids.set(item.key, d.id);
          await this.audit.record(tx, { actorId, action: 'department.created', entity: 'department', entityId: d.id, after: { name: d.name, parentId: d.parentId, kind: d.kind, managerId: d.managerId, source: 'structure-transfer' } });
          continue;
        }
        ids.set(item.key, target);
        const row = await tx.department.findUniqueOrThrow({ where: { id: target } });
        const data = {
          ...(row.kind !== item.kind ? { kind: item.kind } : {}),
          ...(row.sortOrder !== item.sortOrder ? { sortOrder: item.sortOrder } : {}),
          ...(item.externalId && !row.externalId ? { externalId: item.externalId } : {}),
          ...(managerId !== undefined ? { managerId } : {}),
        };
        if (!Object.keys(data).length) continue;
        await tx.department.update({ where: { id: target }, data });
        await this.audit.record(tx, {
          actorId, action: 'department.updated', entity: 'department', entityId: target,
          before: { kind: row.kind, sortOrder: row.sortOrder, externalId: row.externalId, managerId: row.managerId }, after: { ...data, source: 'structure-transfer' },
        });
      }
    }, { timeout: 60_000 });
    return { ...plan, applied: true };
  }
}
