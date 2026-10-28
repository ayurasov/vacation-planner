// Справочники: отделы, проекты, группы (docs/specs/02-api-spec.md).
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MinLength, MaxLength,
} from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';

export class DeptCreateDto {
  @IsString() @MinLength(1) @MaxLength(128)
    name!: string;

  @IsOptional() @IsInt()
    managerId?: number | null;
}

export class DeptUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128)
    name?: string;

  @IsOptional() @IsInt()
    managerId?: number | null;
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

async function adminOr(user: AccessClaims, prisma: PrismaService): Promise<number> {
  const me = await prisma.employee.findUnique({ where: { id: user.sub } });
  if (!me?.isAdmin) throw new ProblemException('auth/forbidden');
  return me.id;
}

@ApiTags('directories')
@Controller('api/v1')
export class DirectoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Отделы ──
  @Get('departments')
  @ApiOperation({ operationId: 'listDepartments', summary: 'Отделы с руководителями и численностью' })
  async departments() {
    const depts = await this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: { where: { isActive: true } } } } },
    });
    return depts.map((d) => ({ id: d.id, name: d.name, managerId: d.managerId, headcount: d._count.members }));
  }

  @Post('departments')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createDepartment', summary: 'Создать отдел (администратор)' })
  async createDept(@CurrentUser() user: AccessClaims, @Body() dto: DeptCreateDto) {
    const actorId = await adminOr(user, this.prisma);
    const dup = await this.prisma.department.findUnique({ where: { name: dto.name } });
    if (dup) throw new ProblemException('validation/invalid-field', 'Отдел с таким названием уже есть');
    const d = await this.prisma.$transaction(async (tx) => {
      const created = await tx.department.create({ data: { name: dto.name, managerId: dto.managerId ?? null } });
      await this.audit.record(tx, { actorId, action: 'department.created', entity: 'department', entityId: created.id, after: { name: dto.name } });
      return created;
    });
    return { id: d.id, name: d.name, managerId: d.managerId, headcount: 0 };
  }

  @Patch('departments/:name')
  @ApiOperation({ operationId: 'updateDepartment', summary: 'Переименовать, сменить руководителя' })
  async updateDept(@CurrentUser() user: AccessClaims, @Param('name') name: string, @Body() dto: DeptUpdateDto) {
    const actorId = await adminOr(user, this.prisma);
    const d = await this.prisma.department.findUnique({ where: { name } });
    if (!d) throw new ProblemException('not-found');
    if (dto.name && dto.name !== name) {
      const dup = await this.prisma.department.findUnique({ where: { name: dto.name } });
      if (dup) throw new ProblemException('validation/invalid-field', 'Отдел с таким названием уже есть');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.department.update({ where: { id: d.id }, data: { name: dto.name, managerId: dto.managerId } });
      await this.audit.record(tx, { actorId, action: 'department.updated', entity: 'department', entityId: d.id, before: { name: d.name, managerId: d.managerId }, after: { name: dto.name ?? d.name, managerId: dto.managerId ?? d.managerId } });
    });
    return { id: d.id, name: dto.name ?? d.name, managerId: dto.managerId ?? d.managerId };
  }

  @Delete('departments/:name')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteDepartment', summary: 'Удалить отдел (нельзя при наличии сотрудников)' })
  async deleteDept(@CurrentUser() user: AccessClaims, @Param('name') name: string) {
    const actorId = await adminOr(user, this.prisma);
    const d = await this.prisma.department.findUnique({ where: { name }, include: { _count: { select: { members: { where: { isActive: true } } } } } });
    if (!d) throw new ProblemException('not-found');
    if (d._count.members > 0) throw new ProblemException('department-not-empty');
    await this.prisma.$transaction(async (tx) => {
      await tx.department.delete({ where: { id: d.id } });
      await this.audit.record(tx, { actorId, action: 'department.deleted', entity: 'department', entityId: d.id, before: { name: d.name } });
    });
  }

  // ── Проекты ──
  @Get('projects')
  @ApiOperation({ operationId: 'listProjects', summary: 'Проекты' })
  async projects() {
    const items = await this.prisma.project.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: { where: { isActive: true } } } } },
    });
    return items.map((p) => ({ id: p.id, name: p.name, managerId: p.managerId, headcount: p._count.members }));
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
