// Импорт сотрудников и остатков (E30): план строится чистой функцией plan.ts,
// применение — одна транзакция с аудитом каждой созданной и изменённой записи.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/passwords';
import type { StaffActor } from '../auth/access';
import { generatePassword, oneTimePasswordLength, toPublic, translitLogin } from '../employees/employees.service';
import { loadTree } from '../org/org.service';
import { nameKey } from '../org/org-tree';
import { buildImportPlan, MAX_ROWS, type ImportPlan } from './plan';
import type { ImportRow } from './parse';

export interface ImportResult extends ImportPlan {
  applied: boolean;
  /** Логины и одноразовые пароли созданных — показываются один раз, нигде не хранятся. */
  credentials: Array<{ login: string; name: string; password: string }>;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async plan(actor: StaffActor, rows: ImportRow[]): Promise<ImportPlan> {
    if (!rows.length) throw new ProblemException('validation/invalid-field', 'В файле нет строк с сотрудниками');
    if (rows.length > MAX_ROWS) throw new ProblemException('validation/invalid-field', `Не больше ${MAX_ROWS} строк за один импорт`);
    const [employees, tree] = await Promise.all([this.prisma.employee.findMany(), loadTree(this.prisma)]);
    const byName = new Map<string, number>();
    for (const d of tree.byId.values()) byName.set(nameKey(d.name), (byName.get(nameKey(d.name)) ?? 0) + 1);
    return buildImportPlan(rows, {
      employees: employees.map((e) => ({
        id: e.id, login: e.login, name: e.name, position: e.position, deptName: e.deptId !== null ? tree.label(e.deptId) : null,
        managerId: e.managerId, plannedDays: e.plannedDays, carryOver: e.carryOver, empType: e.empType,
        email: e.email, personnelNumber: e.personnelNumber, isAdmin: e.isAdmin, isHr: e.isHr, isActive: e.isActive,
      })),
      departments: [...tree.byId.keys()].map((id) => tree.label(id)),
      ambiguousDepts: [...tree.byId.values()].filter((d) => byName.get(nameKey(d.name))! > 1).map((d) => d.name),
      actorIsAdmin: actor.isAdmin,
      actorId: actor.id,
      loginFor: translitLogin,
    });
  }

  async run(actor: StaffActor, rows: ImportRow[], dryRun: boolean, source: string): Promise<ImportResult> {
    const plan = await this.plan(actor, rows);
    if (dryRun) return { ...plan, applied: false, credentials: [] };
    if (plan.summary.error) {
      const lines = plan.rows.filter((r) => r.action === 'error').map((r) => r.line).slice(0, 10).join(', ');
      throw new ProblemException('validation/invalid-field', `Исправьте ошибки в строках ${lines}${plan.summary.error > 10 ? '…' : ''} и загрузите файл снова`);
    }
    const credentials: ImportResult['credentials'] = [];
    // Пароли новых сотрудников хешируются до транзакции, параллельно в пуле потоков:
    // 5000 scrypt внутри транзакции не укладывались в её срок и держали соединение БД
    const creates = plan.rows.filter((x) => x.action === 'create');
    const secrets = new Map<string, { password: string; hash: string }>();
    const length = await oneTimePasswordLength(this.prisma);
    for (let i = 0; i < creates.length; i += 64) {
      await Promise.all(creates.slice(i, i + 64).map(async (r) => {
        const password = generatePassword(length);
        secrets.set(r.login, { password, hash: await hashPassword(password) });
      }));
    }
    await this.prisma.$transaction(async (tx) => {
      // Блокировка от параллельного импорта: план строился до транзакции, повторяем
      // проверки уникальности на уровне БД (уникальные логин и e-mail).
      // Подразделения — по подписи (v1.1.0); новые создаются на верхнем уровне структуры
      const tree = await loadTree(tx);
      const deptIds = new Map<string, number>();
      for (const id of tree.byId.keys()) deptIds.set(tree.label(id).toLowerCase(), id);
      for (const name of plan.newDepartments) {
        const d = await tx.department.create({ data: { name, orgSource: 'import' } });
        deptIds.set(name.toLowerCase(), d.id);
        await this.audit.record(tx, { actorId: actor.id, action: 'department.created', entity: 'department', entityId: d.id, after: { name, source } });
      }
      const idByLogin = new Map<string, number>();
      const deptId = (name?: string) => (name === undefined ? undefined : deptIds.get(name.toLowerCase()) ?? null);

      for (const r of plan.rows.filter((x) => x.action === 'create')) {
        const v = r.values!;
        const { password, hash } = secrets.get(v.login)!;
        const e = await tx.employee.create({
          data: {
            login: v.login, passwordHash: hash, name: v.name, email: v.email ?? null,
            position: v.position ?? null, deptId: deptId(v.dept) ?? null,
            plannedDays: v.plannedDays ?? 28, carryOver: v.carryOver ?? 0, empType: v.empType ?? 'staff',
            personnelNumber: v.personnelNumber ?? null,
            mustChangePassword: true, // выданный при импорте пароль меняется при первом входе (v0.6.0)
          },
        });
        idByLogin.set(v.login, e.id);
        credentials.push({ login: v.login, name: v.name, password });
      }
      const managerId = (m: NonNullable<NonNullable<ImportPlan['rows'][number]['values']>['manager']>) => ('id' in m ? m.id : idByLogin.get(m.login)!);

      for (const r of plan.rows.filter((x) => x.action === 'create' || x.action === 'update')) {
        const v = r.values!;
        const id = r.employeeId ?? idByLogin.get(v.login)!;
        const before = r.action === 'update' ? await tx.employee.findUniqueOrThrow({ where: { id } }) : null;
        const data = {
          ...(r.action === 'update' ? {
            ...('name' in r.changes ? { name: v.name } : {}),
            ...('position' in r.changes ? { position: v.position } : {}),
            ...('dept' in r.changes ? { deptId: deptId(v.dept) } : {}),
            ...('plannedDays' in r.changes ? { plannedDays: v.plannedDays } : {}),
            ...('carryOver' in r.changes ? { carryOver: v.carryOver } : {}),
            ...('empType' in r.changes ? { empType: v.empType } : {}),
            ...('email' in r.changes ? { email: v.email } : {}),
            ...('personnelNumber' in r.changes ? { personnelNumber: v.personnelNumber } : {}),
          } : {}),
          ...(v.manager && (r.action === 'create' || 'manager' in r.changes) ? { managerId: managerId(v.manager) } : {}),
        };
        const after = Object.keys(data).length ? await tx.employee.update({ where: { id }, data }) : await tx.employee.findUniqueOrThrow({ where: { id } });
        await this.audit.record(tx, {
          actorId: actor.id,
          action: r.action === 'create' ? 'employee.created' : 'employee.updated',
          entity: 'employee', entityId: id,
          before: before ? toPublic(before) : null,
          after: { ...toPublic(after), source },
        });
      }
      await this.audit.record(tx, {
        actorId: actor.id, action: 'import.applied', entity: 'import', entityId: source,
        after: { ...plan.summary, newDepartments: plan.newDepartments },
      });
    }, { timeout: 120_000 });
    return { ...plan, applied: true, credentials };
  }
}
