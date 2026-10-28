import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min, MinLength, MaxLength,
} from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { CurrentUser, Roles } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { AuthService } from '../auth/auth.service';
import { RequestsService } from '../requests/requests.service';
import { AuditService } from '../audit/audit.service';
import { calendarDays, toIso } from '../requests/balance';
import { EmployeesService } from './employees.service';

export class EmployeeCreateDto {
  @IsString() @MinLength(3) @MaxLength(128)
    name!: string;

  @IsOptional() @IsString() @MaxLength(128)
    position?: string;

  @IsOptional() @IsInt()
    deptId?: number;

  @IsOptional() @IsIn(['employee', 'manager'])
    role?: string;

  @IsOptional() @IsBoolean()
    isAdmin?: boolean;

  @IsOptional() @IsIn(['staff', 'ipsz'])
    empType?: string;

  @IsOptional() @IsInt()
    managerId?: number;

  @IsOptional() @IsInt()
    projectId?: number;

  @IsOptional() @Matches(/^[a-z0-9._-]{2,64}$/i, { message: 'Логин: латиница, цифры, . _ -' })
    login?: string;

  @IsOptional() @IsString() @MinLength(8) @MaxLength(128)
    password?: string;

  @IsOptional() @IsInt() @Min(0)
    plannedDays?: number;

  @IsOptional() @IsInt() @Min(0)
    carryOver?: number;
}

export class EmployeeUpdateDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(128)
    name?: string;

  @IsOptional() @IsString() @MaxLength(128)
    position?: string;

  @IsOptional() @IsInt()
    deptId?: number | null;

  @IsOptional() @IsIn(['employee', 'manager'])
    role?: string;

  @IsOptional() @IsBoolean()
    isAdmin?: boolean;

  @IsOptional() @IsIn(['staff', 'ipsz'])
    empType?: string;

  @IsOptional() @IsInt()
    managerId?: number | null;

  @IsOptional() @IsInt()
    projectId?: number | null;

  @IsOptional() @IsInt() @Min(0)
    plannedDays?: number;

  @IsOptional() @IsInt() @Min(0)
    carryOver?: number;
}

export class SetPasswordDto {
  @IsOptional() @IsString()
    oldPassword?: string;

  @IsString() @MinLength(8) @MaxLength(128)
    newPassword!: string;
}

export class ListQuery {
  @IsOptional() @Min(1)
    page?: number;

  @IsOptional() @Min(1) @Max(200)
    per_page?: number;

  @IsOptional() @IsString() @MaxLength(128)
    dept?: string;

  @IsOptional() @IsInt()
    project?: number;

  @IsOptional() @IsString() @MaxLength(100)
    search?: string;
}

export class WorkPatternDto {
  @IsOptional() @IsIn(['office', 'remote', 'off'])
    '0'?: string;

  @IsOptional() @IsIn(['office', 'remote', 'off'])
    '1'?: string;

  @IsOptional() @IsIn(['office', 'remote', 'off'])
    '2'?: string;

  @IsOptional() @IsIn(['office', 'remote', 'off'])
    '3'?: string;

  @IsOptional() @IsIn(['office', 'remote', 'off'])
    '4'?: string;

  @IsOptional() @IsIn(['office', 'remote', 'off'])
    '5'?: string;

  @IsOptional() @IsIn(['office', 'remote', 'off'])
    '6'?: string;
}

export class WorkOverrideDto {
  @IsISO8601({})
    date!: string;

  @IsIn(['office', 'remote', 'off'])
    mode!: 'office' | 'remote' | 'off';
}

async function assertAdmin(user: AccessClaims, prisma: PrismaService): Promise<void> {
  const me = await prisma.employee.findUnique({ where: { id: user.sub } });
  if (!me?.isAdmin) throw new ProblemException('auth/forbidden');
}

/** Свой профиль или подчинённый; иначе — администратор. */
async function assertCanManage(user: AccessClaims, id: number, prisma: PrismaService): Promise<void> {
  if (user.sub === id) return;
  const me = await prisma.employee.findUnique({
    where: { id: user.sub }, include: { subordinates: { select: { id: true } } },
  });
  if (me?.isAdmin) return;
  if (me?.subordinates.some((s) => s.id === id)) return;
  throw new ProblemException('auth/forbidden');
}

@ApiTags('employees')
@Controller('api/v1/employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly auth: AuthService,
    private readonly requests: RequestsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listEmployees', summary: 'Список сотрудников (постранично, с фильтрами)' })
  async list(@Query() q: ListQuery) {
    return this.employees.list({
      page: q.page ?? 1, perPage: q.per_page ?? 50,
      dept: q.dept, project: q.project, search: q.search,
    });
  }

  @Post()
  @HttpCode(201)
    @Roles('admin')
  @ApiOperation({ operationId: 'createEmployee', summary: 'Создать сотрудника (администратор)' })
  async create(@CurrentUser() user: AccessClaims, @Body() dto: EmployeeCreateDto) {
    await assertAdmin(user, this.prisma);
    return this.employees.create(user.sub, dto);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getEmployee', summary: 'Карточка сотрудника' })
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.employees.get(id);
  }

  @Patch(':id')
    @Roles('admin')
  @ApiOperation({ operationId: 'updateEmployee', summary: 'Изменить поля сотрудника (администратор)' })
  async update(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number, @Body() dto: EmployeeUpdateDto) {
    await assertAdmin(user, this.prisma);
    return this.employees.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
    @Roles('admin')
  @ApiOperation({ operationId: 'deleteEmployee', summary: 'Уволить сотрудника (soft delete)' })
  async remove(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    await assertAdmin(user, this.prisma);
    await this.employees.remove(user.sub, id);
  }

  @Get(':id/balance')
  @ApiOperation({ operationId: 'getBalance', summary: 'Баланс дней отпуска за год' })
  async balance(
    @CurrentUser() user: AccessClaims,
      @Param('id', ParseIntPipe) id: number,
      @Query('year') year?: string,
  ) {
    await assertCanManage(user, id, this.prisma);
    const y = year ? Number(year) : new Date().getFullYear();
    if (!Number.isInteger(y) || y < 2024 || y > 2100) {
      throw new ProblemException('validation/invalid-field', 'Год: 2024–2100');
    }
    return this.requests.balance(id, y);
  }

  @Get(':id/work-schedule')
  @ApiOperation({ operationId: 'getWorkSchedule', summary: 'График работы: недельный шаблон и исключения за период' })
  async getWorkSchedule(
    @CurrentUser() user: AccessClaims,
      @Param('id', ParseIntPipe) id: number,
      @Query('from') from?: string,
      @Query('to') to?: string,
  ) {
    await assertCanManage(user, id, this.prisma);
    const year = new Date().getFullYear();
    const f = from ?? `${year}-01-01`;
    const t = to ?? `${year}-12-31`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || f > t) {
      throw new ProblemException('validation/bad-date-range');
    }
    if (calendarDays(f, t) > 400) throw new ProblemException('validation/invalid-field', 'Период не длиннее 400 дней');
    const [patterns, overrides] = await Promise.all([
      this.prisma.workPattern.findMany({ where: { employeeId: id } }),
      this.prisma.workOverride.findMany({ where: { employeeId: id, date: { gte: new Date(f), lte: new Date(t) } }, orderBy: { date: 'asc' } }),
    ]);
    return {
      employee: id,
      pattern: Object.fromEntries(patterns.map((p) => [p.weekday, p.mode])),
      overrides: overrides.map((o) => ({ date: toIso(o.date), mode: o.mode })),
    };
  }

  @Put(':id/work-pattern')
  @HttpCode(204)
  @ApiOperation({ operationId: 'setWorkPattern', summary: 'Недельный шаблон офис/удалёнка (свой или подчинённый)' })
  async setWorkPattern(
    @CurrentUser() user: AccessClaims,
      @Param('id', ParseIntPipe) id: number,
      @Body() dto: WorkPatternDto,
  ) {
    await assertCanManage(user, id, this.prisma);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.workPattern.findMany({ where: { employeeId: id } });
      await tx.workPattern.deleteMany({ where: { employeeId: id } });
      const rows = Object.entries(dto)
        .map(([weekday, mode]) => ({ employeeId: id, weekday: Number(weekday), mode: mode as 'office' | 'remote' | 'off' }))
        .filter((r) => r.weekday >= 0 && r.weekday <= 6 && r.mode);
      if (rows.length) await tx.workPattern.createMany({ data: rows });
      await this.audit.record(tx, {
        actorId: user.sub, action: 'employee.work_pattern_updated', entity: 'employee', entityId: id,
        before: Object.fromEntries(before.map((p) => [p.weekday, p.mode])),
        after: Object.fromEntries(rows.map((r) => [r.weekday, r.mode])),
      });
    });
  }

  @Put(':id/work-overrides')
  @HttpCode(204)
  @ApiOperation({ operationId: 'setWorkOverride', summary: 'Ручное переопределение режима на дату' })
  async setWorkOverride(
    @CurrentUser() user: AccessClaims,
      @Param('id', ParseIntPipe) id: number,
      @Body() dto: WorkOverrideDto,
  ) {
    await assertCanManage(user, id, this.prisma);
    await this.prisma.$transaction(async (tx) => {
      const key = { employeeId_date: { employeeId: id, date: new Date(dto.date) } };
      const before = await tx.workOverride.findUnique({ where: key });
      await tx.workOverride.upsert({
        where: key,
        update: { mode: dto.mode },
        create: { employeeId: id, date: new Date(dto.date), mode: dto.mode },
      });
      await this.audit.record(tx, {
        actorId: user.sub, action: 'employee.work_override_set', entity: 'employee', entityId: id,
        before: before ? { date: dto.date, mode: before.mode } : null, after: { date: dto.date, mode: dto.mode },
      });
    });
  }

  @Delete(':id/work-overrides/:date')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteWorkOverride', summary: 'Снять исключение — на дату снова действует недельный шаблон' })
  async deleteWorkOverride(
    @CurrentUser() user: AccessClaims,
      @Param('id', ParseIntPipe) id: number,
      @Param('date') date: string,
  ) {
    await assertCanManage(user, id, this.prisma);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ProblemException('validation/invalid-field', 'Дата в формате YYYY-MM-DD');
    await this.prisma.$transaction(async (tx) => {
      const key = { employeeId_date: { employeeId: id, date: new Date(date) } };
      const before = await tx.workOverride.findUnique({ where: key });
      if (!before) throw new ProblemException('not-found');
      await tx.workOverride.delete({ where: key });
      await this.audit.record(tx, {
        actorId: user.sub, action: 'employee.work_override_removed', entity: 'employee', entityId: id,
        before: { date, mode: before.mode }, after: null,
      });
    });
  }

  @Put(':id/password')
  @HttpCode(204)
  @ApiOperation({ operationId: 'changePassword', summary: 'Смена пароля (свой со старым; чужой — администратор)' })
  async setPassword(
    @CurrentUser() user: AccessClaims,
      @Param('id', ParseIntPipe) id: number,
      @Body() dto: SetPasswordDto,
  ) {
    if (user.sub === id) {
      if (!dto.oldPassword) {
        throw new ProblemException('validation/invalid-field', 'Для смены своего пароля укажите старый');
      }
      await this.auth.changeOwnPassword(id, dto.oldPassword, dto.newPassword);
      return;
    }
    await assertAdmin(user, this.prisma);
    await this.auth.setPassword(id, dto.newPassword);
  }
}
