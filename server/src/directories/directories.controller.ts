// Справочники: подразделения, проекты, группы (docs/specs/02-api-spec.md).
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength, MaxLength,
} from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { OrgService } from '../org/org.service';
import { assertStaff } from '../auth/access';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';

export class DeptCreateDto {
  @IsString() @MinLength(1) @MaxLength(128)
    name!: string;

  /** Вышестоящее подразделение; null — верхний уровень. */
  @IsOptional() @IsInt()
    parentId?: number | null;

  @IsOptional() @IsString() @Matches(/^[a-z][a-z0-9_-]{0,31}$/)
    kind?: string;

  @IsOptional() @IsInt() @Min(-100000) @Max(100000)
    sortOrder?: number;

  @IsOptional() @IsInt()
    managerId?: number | null;

  @IsOptional() @IsString() @MaxLength(128)
    externalId?: string | null;
}

export class DeptUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128)
    name?: string;

  @IsOptional() @IsInt()
    parentId?: number | null;

  @IsOptional() @IsString() @Matches(/^[a-z][a-z0-9_-]{0,31}$/)
    kind?: string;

  @IsOptional() @IsInt() @Min(-100000) @Max(100000)
    sortOrder?: number;

  @IsOptional() @IsInt()
    managerId?: number | null;

  @IsOptional() @IsString() @MaxLength(128)
    externalId?: string | null;
}

export class ProjectCreateDto {
  @IsString() @MinLength(1) @MaxLength(128)
    name!: string;

  @IsOptional() @IsInt()
    managerId?: number | null;
}

export class ProjectUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128)
    name?: string;

  @IsOptional() @IsInt()
    managerId?: number | null;
}

export class GroupDto {
  @IsString() @MinLength(1) @MaxLength(128)
    name!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsInt({ each: true })
    members?: number[];
}

/** Оргструктуру ведут администратор и кадровая служба. */
async function adminOr(user: AccessClaims, prisma: PrismaService): Promise<number> {
  return (await assertStaff(prisma, user, 'hr')).id;
}

@ApiTags('directories')
@Controller('api/v1')
export class DirectoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
  ) {}

  // ── Подразделения (дерево, v1.1.0) ──
  @Get('departments')
  @ApiOperation({ operationId: 'listDepartments', summary: 'Подразделения в порядке дерева: путь, уровень, подпись, руководитель, численность' })
  departments() {
    return this.org.list();
  }

  /** Строка списка по id — тот же вид, что в GET /departments. */
  private async item(id: number) {
    return (await this.org.list()).find((d) => d.id === id)!;
  }

  @Post('departments')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createDepartment', summary: 'Создать подразделение' })
  async createDept(@CurrentUser() user: AccessClaims, @Body() dto: DeptCreateDto) {
    const actorId = await adminOr(user, this.prisma);
    const d = await this.org.create(actorId, dto);
    return this.item(d.id);
  }

  // :ref — id или подпись подразделения (одноимённые различаются подписью «Отдел — Родитель»)
  @Patch('departments/:ref')
  @ApiOperation({ operationId: 'updateDepartment', summary: 'Переименовать, перенести, сменить вид или руководителя' })
  async updateDept(@CurrentUser() user: AccessClaims, @Param('ref') ref: string, @Body() dto: DeptUpdateDto) {
    const actorId = await adminOr(user, this.prisma);
    const { id } = await this.org.resolve(ref);
    await this.org.update(actorId, id, dto);
    return this.item(id);
  }

  @Delete('departments/:ref')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteDepartment', summary: 'Удалить подразделение (нельзя при сотрудниках и вложенных)' })
  async deleteDept(@CurrentUser() user: AccessClaims, @Param('ref') ref: string) {
    const actorId = await adminOr(user, this.prisma);
    const { id } = await this.org.resolve(ref);
    await this.org.remove(actorId, id);
  }

  // ── Проекты ──
  @Get('projects')
  @ApiOperation({ operationId: 'listProjects', summary: 'Проекты' })
  async projects() {
    const items = await this.prisma.project.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: { where: { isActive: true } } } }, manager: { select: { name: true } } },
    });
    return items.map((p) => ({ id: p.id, name: p.name, managerId: p.managerId, managerName: p.manager?.name ?? null, headcount: p._count.members }));
  }

  @Post('projects')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createProject', summary: 'Создать проект (администратор)' })
  async createProject(@CurrentUser() user: AccessClaims, @Body() dto: ProjectCreateDto) {
    const actorId = await adminOr(user, this.prisma);
    const dup = await this.prisma.project.findUnique({ where: { name: dto.name } });
    if (dup) throw new ProblemException('validation/invalid-field', 'Проект с таким названием уже есть');
    const p = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({ data: { name: dto.name, managerId: dto.managerId ?? null } });
      await this.audit.record(tx, { actorId, action: 'project.created', entity: 'project', entityId: created.id, after: { name: dto.name } });
      return created;
    });
    return { id: p.id, name: p.name, managerId: p.managerId, headcount: 0 };
  }

  @Patch('projects/:id')
  @ApiOperation({ operationId: 'updateProject', summary: 'Изменить проект' })
  async updateProject(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number, @Body() dto: ProjectUpdateDto) {
    const actorId = await adminOr(user, this.prisma);
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new ProblemException('not-found');
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { name: dto.name, managerId: dto.managerId } });
      await this.audit.record(tx, { actorId, action: 'project.updated', entity: 'project', entityId: id, before: { name: p.name }, after: { name: dto.name ?? p.name } });
    });
    return { id, name: dto.name ?? p.name, managerId: dto.managerId ?? p.managerId };
  }

  @Delete('projects/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteProject', summary: 'Удалить проект (нельзя при наличии участников)' })
  async deleteProject(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    const actorId = await adminOr(user, this.prisma);
    const p = await this.prisma.project.findUnique({ where: { id }, include: { _count: { select: { members: { where: { isActive: true } } } } } });
    if (!p) throw new ProblemException('not-found');
    if (p._count.members > 0) throw new ProblemException('department-not-empty', 'В проекте ещё есть участники');
    await this.prisma.$transaction(async (tx) => {
      await tx.project.delete({ where: { id } });
      await this.audit.record(tx, { actorId, action: 'project.deleted', entity: 'project', entityId: id, before: { name: p.name } });
    });
  }

  // ── Группы (личные) ──
  @Get('groups')
  @ApiOperation({ operationId: 'listGroups', summary: 'Личные группы фильтров' })
  async groups(@CurrentUser() user: AccessClaims) {
    const items = await this.prisma.group.findMany({
      where: { ownerId: user.sub },
      include: { members: { select: { employeeId: true } } },
      orderBy: { name: 'asc' },
    });
    return items.map((g) => ({ id: g.id, name: g.name, members: g.members.map((m) => m.employeeId) }));
  }

  @Post('groups')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createGroup', summary: 'Создать группу' })
  async createGroup(@CurrentUser() user: AccessClaims, @Body() dto: GroupDto) {
    const dup = await this.prisma.group.findUnique({ where: { ownerId_name: { ownerId: user.sub, name: dto.name } } });
    if (dup) throw new ProblemException('validation/invalid-field', 'Группа с таким названием уже есть');
    const g = await this.prisma.group.create({
      data: {
        ownerId: user.sub, name: dto.name,
        members: { create: (dto.members ?? []).map((employeeId) => ({ employeeId })) },
      },
    });
    return { id: g.id, name: g.name, members: dto.members ?? [] };
  }

  @Patch('groups/:id')
  @ApiOperation({ operationId: 'updateGroup', summary: 'Изменить название или состав' })
  async updateGroup(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number, @Body() dto: GroupDto) {
    const g = await this.prisma.group.findUnique({ where: { id } });
    if (!g || g.ownerId !== user.sub) throw new ProblemException('not-found');
    await this.prisma.$transaction(async (tx) => {
      await tx.group.update({ where: { id }, data: { name: dto.name } });
      await tx.groupMember.deleteMany({ where: { groupId: id } });
      if (dto.members?.length) {
        await tx.groupMember.createMany({ data: dto.members.map((employeeId) => ({ groupId: id, employeeId })) });
      }
    });
    return { id, name: dto.name, members: dto.members ?? [] };
  }

  @Delete('groups/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteGroup', summary: 'Удалить группу' })
  async deleteGroup(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    const g = await this.prisma.group.findUnique({ where: { id } });
    if (!g || g.ownerId !== user.sub) throw new ProblemException('not-found');
    await this.prisma.group.delete({ where: { id } });
  }
}
