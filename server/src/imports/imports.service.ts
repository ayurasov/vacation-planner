// Импорт сотрудников и остатков (E30): план строится чистой функцией plan.ts,
// применение — одна транзакция с аудитом каждой созданной и изменённой записи.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/passwords';
import type { StaffActor } from '../auth/access';
import { generatePassword, toPublic, translitLogin } from '../employees/employees.service';
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
    const [employees, departments] = await Promise.all([
      this.prisma.employee.findMany({ include: { dept: { select: { name: true } } } }),
      this.prisma.department.findMany({ select: { name: true } }),
    ]);
    return buildImportPlan(rows, {
      employees: employees.map((e) => ({
        id: e.id, login: e.login, name: e.name, position: e.position, deptName: e.dept?.name ?? null,
        managerId: e.managerId, plannedDays: e.plannedDays, carryOver: e.carryOver, empType: e.empType,
        email: e.email, isAdmin: e.isAdmin, isHr: e.isHr, isActive: e.isActive,
      })),
      departments: departments.map((d) => d.name),
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
    await this.prisma.$transaction(async (tx) => {
      // Блокировка от параллельного импорта: план строился до транзакции, повторяем
      // проверки уникальности на уровне БД (уникальные логин и e-mail).
      const deptIds = new Map<string, number>();
      for (const d of await tx.department.findMany()) deptIds.set(d.name.toLowerCase(), d.id);
      for (const name of plan.newDepartments) {
        const d = await tx.department.create({ data: { name } });
        deptIds.set(name.toLowerCase(), d.id);
        await this.audit.record(tx, { actorId: actor.id, action: 'department.created', entity: 'department', entityId: d.id, after: { name, source } });
      }
      const idByLogin = new Map<string, number>();
      const deptId = (name?: string) => (name === undefined ? undefined : deptIds.get(name.toLowerCase()) ?? null);

      for (const r of plan.rows.filter((x) => x.action === 'create')) {
        const v = r.values!;
        const password = generatePassword();
        const e = await tx.employee.create({
          data: {
            login: v.login, passwordHash: hashPassword(password), name: v.name, email: v.email ?? null,
            position: v.position ?? null, deptId: deptId(v.dept) ?? null,
            plannedDays: v.plannedDays ?? 28, carryOver: v.carryOver ?? 0, empType: v.empType ?? 'staff',
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
