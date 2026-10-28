// Сотрудники: CRUD, права на просмотр/изменение, защита последнего администратора.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/passwords';
import type { StaffActor } from '../auth/access';
import { invalidateSession } from '../auth/guards';
import { randomBytes } from 'node:crypto';

export function translitLogin(name: string): string {
  const TRANSLIT: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const translit = (word: string) => word.split('').map((ch) => TRANSLIT[ch] ?? ch).join('');
  const parts = name.toLowerCase().split(/\s+/);
  if (parts.length < 2) return 'user';
  const last = translit(parts[0]);
  const initials = parts.slice(1).map((p) => translit(p[0])).filter(Boolean);
  return `${last}.${initials.join('')}`;
}

export function generatePassword(): string {
  return randomBytes(6).toString('base64url');
}

export function toPublic(e: {
  id: number; login: string; name: string; email: string | null; position: string | null; deptId: number | null;
  role: string; isAdmin: boolean; isHr: boolean; empType: string; managerId: number | null; projectId: number | null;
  plannedDays: number; carryOver: number; isActive: boolean;
}) {
  return {
    id: e.id, login: e.login, name: e.name, email: e.email, position: e.position, deptId: e.deptId,
    role: e.role, isAdmin: e.isAdmin, isHr: e.isHr, empType: e.empType, managerId: e.managerId,
    projectId: e.projectId, plannedDays: e.plannedDays, carryOver: e.carryOver,
    isActive: e.isActive,
  };
}

/**
 * Служебные права выдаёт и снимает только администратор. Кадровая служба не меняет
 * учётные записи администраторов и коллег по кадровой службе: иначе сброс пароля
 * или правка карточки давали бы ей чужие права.
 */
export function assertCanTouch(actor: StaffActor, target: { id: number; isAdmin: boolean; isHr: boolean }): void {
  if (actor.isAdmin) return;
  if (target.isAdmin || (target.isHr && target.id !== actor.id)) {
    throw new ProblemException('auth/forbidden', 'Учётные записи администраторов и кадровой службы меняет администратор');
  }
}

function assertGrants(actor: StaffActor, input: { isAdmin?: boolean; isHr?: boolean }, current: { isAdmin: boolean; isHr: boolean }): void {
  if (actor.isAdmin) return;
  const changes = (input.isAdmin !== undefined && input.isAdmin !== current.isAdmin)
    || (input.isHr !== undefined && input.isHr !== current.isHr);
  if (changes) throw new ProblemException('auth/forbidden', 'Служебные права выдаёт администратор');
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params: { page: number; perPage: number; dept?: string; project?: number; search?: string }) {
    const where = {
      isActive: true,
      ...(params.dept ? { dept: { name: params.dept } } : {}),
      ...(params.project ? { projectId: params.project } : {}),
      ...(params.search ? {
        OR: [
          { name: { contains: params.search, mode: 'insensitive' as const } },
          { position: { contains: params.search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (params.page - 1) * params.perPage, take: params.perPage,
        include: { dept: { select: { name: true } } },
      }),
      this.prisma.employee.count({ where }),
    ]);
    return {
      items: items.map((e) => ({ ...toPublic(e), deptName: e.dept?.name ?? null })),
      meta: { page: params.page, perPage: params.perPage, total },
    };
  }

  async get(id: number) {
    const e = await this.prisma.employee.findUnique({ where: { id }, include: { dept: { select: { name: true } } } });
    if (!e || !e.isActive) throw new ProblemException('not-found');
    return { ...toPublic(e), deptName: e.dept?.name ?? null };
  }

  async create(actor: StaffActor, input: {
    name: string; email?: string; position?: string; deptId?: number; role?: string; isAdmin?: boolean; isHr?: boolean;
    empType?: string; managerId?: number; projectId?: number; login?: string;
    password?: string; plannedDays?: number; carryOver?: number;
  }): Promise<{ employee: ReturnType<typeof toPublic>; generatedPassword?: string }> {
    assertGrants(actor, input, { isAdmin: false, isHr: false });
    const actorId = actor.id;
    const login = input.login?.trim() || `${translitLogin(input.name)}`;
    const dup = await this.prisma.employee.findFirst({ where: { login } });
    if (dup) throw new ProblemException('validation/invalid-field', `Логин «${login}» уже занят`);
    await this.assertEmailFree(input.email);
    const generated = input.password ? undefined : generatePassword();
    const passwordHash = await hashPassword(input.password ?? generated!);

    const created = await this.prisma.$transaction(async (tx) => {
      const e = await tx.employee.create({
        data: {
          login,
          passwordHash,
          name: input.name,
          email: input.email?.toLowerCase() ?? null,
          position: input.position ?? null,
          deptId: input.deptId ?? null,
          role: input.role === 'manager' ? 'manager' : 'employee',
          isAdmin: input.isAdmin ?? false,
          isHr: input.isHr ?? false,
          empType: input.empType === 'ipsz' ? 'ipsz' : 'staff',
          managerId: input.managerId ?? null,
          projectId: input.projectId ?? null,
          plannedDays: input.plannedDays ?? 28,
          carryOver: input.carryOver ?? 0,
        },
      });
      await this.audit.record(tx, {
        actorId, action: 'employee.created', entity: 'employee', entityId: e.id,
        after: toPublic(e),
      });
      return e;
    });
    return { employee: toPublic(created), ...(generated ? { generatedPassword: generated } : {}) };
  }

  async update(actor: StaffActor, id: number, input: {
    name?: string; email?: string | null; position?: string; deptId?: number | null; role?: string; isAdmin?: boolean; isHr?: boolean;
    empType?: string; managerId?: number | null; projectId?: number | null;
    plannedDays?: number; carryOver?: number;
  }) {
    const actorId = actor.id;
    const before = await this.prisma.employee.findUnique({ where: { id } });
    if (!before) throw new ProblemException('not-found');
    assertCanTouch(actor, before);
    assertGrants(actor, input, before);
    await this.assertEmailFree(input.email ?? undefined, id);
    if ((input.isAdmin === false) && before.isAdmin) {
      await this.assertNotLastAdmin(id);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.employee.update({
        where: { id },
        data: {
          name: input.name, position: input.position,
          email: input.email === null ? null : input.email?.toLowerCase(), // null — очистить адрес
          deptId: input.deptId === undefined ? undefined : input.deptId,
          role: input.role, isAdmin: input.isAdmin, isHr: input.isHr,
          empType: input.empType, managerId: input.managerId === undefined ? undefined : input.managerId,
          projectId: input.projectId === undefined ? undefined : input.projectId,
          plannedDays: input.plannedDays, carryOver: input.carryOver,
        },
      });
      await this.audit.record(tx, {
        actorId, action: 'employee.updated', entity: 'employee', entityId: id,
        before: toPublic(before), after: toPublic(e),
      });
      return e;
    });
    return toPublic(updated);
  }

  async remove(actor: StaffActor, id: number) {
    const actorId = actor.id;
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw new ProblemException('not-found');
    assertCanTouch(actor, e);
    if (e.isAdmin) await this.assertNotLastAdmin(id);
    await this.prisma.$transaction(async (tx) => {
      // soft delete: увольнение сохраняет историю
      await tx.employee.update({ where: { id }, data: { isActive: false } });
      invalidateSession(id);
      await this.audit.record(tx, {
        actorId, action: 'employee.deactivated', entity: 'employee', entityId: id,
        before: toPublic(e), after: { isActive: false },
      });
    });
  }

  private async assertEmailFree(email: string | undefined, exceptId?: number): Promise<void> {
    if (!email) return;
    const other = await this.prisma.employee.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (other) throw new ProblemException('validation/invalid-field', `Адрес ${email} уже указан у другого сотрудника`);
  }

  private async assertNotLastAdmin(id: number): Promise<void> {
    const admins = await this.prisma.employee.count({ where: { isAdmin: true, isActive: true, id: { not: id } } });
    if (admins === 0) throw new ProblemException('last-admin');
  }
}
