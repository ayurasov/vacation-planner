// Сотрудники: CRUD, права на просмотр/изменение, защита последнего администратора.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/passwords';
import { randomBytes } from 'node:crypto';

function translitLogin(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const parts = name.toLowerCase().split(/\s+/);
  if (parts.length < 2) return 'user';
  const last = parts[0];
  const initials = parts.slice(1).map((p) => p[0]).filter(Boolean);
  return `${last}.${initials.join('')}`;
}

function generatePassword(): string {
  return randomBytes(6).toString('base64url');
}

export function toPublic(e: {
  id: number; login: string; name: string; position: string | null; deptId: number | null;
  role: string; isAdmin: boolean; empType: string; managerId: number | null; projectId: number | null;
  plannedDays: number; carryOver: number; isActive: boolean;
}) {
  return {
    id: e.id, login: e.login, name: e.name, position: e.position, deptId: e.deptId,
    role: e.role, isAdmin: e.isAdmin, empType: e.empType, managerId: e.managerId,
    projectId: e.projectId, plannedDays: e.plannedDays, carryOver: e.carryOver,
    isActive: e.isActive,
  };
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

  async create(actorId: number, input: {
    name: string; position?: string; deptId?: number; role?: string; isAdmin?: boolean;
    empType?: string; managerId?: number; projectId?: number; login?: string;
    password?: string; plannedDays?: number; carryOver?: number;
  }): Promise<{ employee: ReturnType<typeof toPublic>; generatedPassword?: string }> {
    const login = input.login?.trim() || `${translitLogin(input.name)}`;
    const dup = await this.prisma.employee.findFirst({ where: { login } });
    if (dup) throw new ProblemException('validation/invalid-field', `Логин «${login}» уже занят`);
    const generated = input.password ? undefined : generatePassword();

    const created = await this.prisma.$transaction(async (tx) => {
      const e = await tx.employee.create({
        data: {
          login,
          passwordHash: hashPassword(input.password ?? generated!),
          name: input.name,
          position: input.position ?? null,
          deptId: input.deptId ?? null,
          role: input.role === 'manager' ? 'manager' : 'employee',
          isAdmin: input.isAdmin ?? false,
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

  async update(actorId: number, id: number, input: {
    name?: string; position?: string; deptId?: number | null; role?: string; isAdmin?: boolean;
    empType?: string; managerId?: number | null; projectId?: number | null;
    plannedDays?: number; carryOver?: number;
  }) {
    const before = await this.prisma.employee.findUnique({ where: { id } });
    if (!before) throw new ProblemException('not-found');
    if ((input.isAdmin === false) && before.isAdmin) {
      await this.assertNotLastAdmin(id);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.employee.update({
        where: { id },
        data: {
          name: input.name, position: input.position,
          deptId: input.deptId === undefined ? undefined : input.deptId,
          role: input.role, isAdmin: input.isAdmin,
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

  async remove(actorId: number, id: number) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw new ProblemException('not-found');
    if (e.isAdmin) await this.assertNotLastAdmin(id);
    await this.prisma.$transaction(async (tx) => {
      // soft delete: увольнение сохраняет историю
      await tx.employee.update({ where: { id }, data: { isActive: false } });
      await this.audit.record(tx, {
        actorId, action: 'employee.deactivated', entity: 'employee', entityId: id,
        before: toPublic(e), after: { isActive: false },
      });
    });
  }

  private async assertNotLastAdmin(id: number): Promise<void> {
    const admins = await this.prisma.employee.count({ where: { isAdmin: true, isActive: true, id: { not: id } } });
    if (admins === 0) throw new ProblemException('last-admin');
  }
}
