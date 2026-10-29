// Кампания планирования, утверждение графика и форма Т-7 (v0.6.0, E60-01/02).
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { assertStaff } from '../auth/access';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { PlanningService, type PlanStatus } from './planning.service';
import { buildT7 } from './t7';

export class OpenCampaignDto {
  @IsISO8601({ strict: true })
    deadline!: string;
}

export class ApproveScheduleDto {
  @IsString() @Length(1, 30)
    docNumber!: string;

  @IsISO8601({ strict: true })
    docDate!: string;

  @IsOptional() @IsISO8601({ strict: true })
    unionOpinionDate?: string;

  @IsOptional() @IsString() @MaxLength(30)
    unionOpinionNumber?: string;
}

export class PlanEmployeesQuery {
  /** Отдел; 0 — сотрудники без отдела. */
  @IsOptional() @IsInt() @Min(0)
    deptId?: number;

  @IsOptional() @IsIn(['none', 'partial', 'done'])
    status?: PlanStatus;
}

export class T7Query {
  @IsInt() @Min(2000) @Max(2100)
    year!: number;
}

function checkYear(year: number): number {
  if (year < 2000 || year > 2100) throw new ProblemException('validation/invalid-field', 'Год — от 2000 до 2100');
  return year;
}

@ApiTags('planning')
@Controller('api/v1')
export class PlanningController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
    private readonly audit: AuditService,
  ) {}

  @Get('planning/mine')
  @ApiOperation({ operationId: 'getMyPlanning', summary: 'Открытая кампания планирования и мой прогресс' })
  mine(@CurrentUser() user: AccessClaims) {
    return this.planning.mine(user.sub);
  }

  @Get('planning/:year')
  @ApiOperation({ operationId: 'getPlanning', summary: 'Кампания, утверждение и прогресс по отделам (кадровая служба)' })
  async overview(@CurrentUser() user: AccessClaims, @Param('year', ParseIntPipe) year: number) {
    await assertStaff(this.prisma, user, 'hr');
    return this.planning.overview(checkYear(year));
  }

  @Get('planning/:year/employees')
  @ApiOperation({ operationId: 'listPlanningEmployees', summary: 'Прогресс планирования по сотрудникам (кадровая служба)' })
  async employees(@CurrentUser() user: AccessClaims, @Param('year', ParseIntPipe) year: number, @Query() q: PlanEmployeesQuery) {
    await assertStaff(this.prisma, user, 'hr');
    return this.planning.employees(checkYear(year), { deptId: q.deptId, status: q.status });
  }

  @Post('planning/:year/open')
  @HttpCode(200)
  @ApiOperation({ operationId: 'openPlanning', summary: 'Открыть планирование на год или изменить срок' })
  async open(@CurrentUser() user: AccessClaims, @Param('year', ParseIntPipe) year: number, @Body() dto: OpenCampaignDto) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    return this.planning.open(actor.id, checkYear(year), dto.deadline.slice(0, 10));
  }

  @Post('planning/:year/close')
  @HttpCode(200)
  @ApiOperation({ operationId: 'closePlanning', summary: 'Закрыть планирование' })
  async close(@CurrentUser() user: AccessClaims, @Param('year', ParseIntPipe) year: number) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    return this.planning.close(actor.id, checkYear(year));
  }

  @Post('planning/:year/remind')
  @HttpCode(200)
  @ApiOperation({ operationId: 'remindPlanning', summary: 'Напомнить не спланировавшим отпуск' })
  async remind(@CurrentUser() user: AccessClaims, @Param('year', ParseIntPipe) year: number) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    return { sent: await this.planning.remind(actor.id, checkYear(year)) };
  }

  @Post('planning/:year/approve')
  @ApiOperation({ operationId: 'approveSchedule', summary: 'Утвердить график отпусков на год (один раз, до начала года)' })
  async approve(@CurrentUser() user: AccessClaims, @Param('year', ParseIntPipe) year: number, @Body() dto: ApproveScheduleDto) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    return this.planning.approve(actor.id, checkYear(year), {
      docNumber: dto.docNumber, docDate: dto.docDate.slice(0, 10),
      unionOpinionDate: dto.unionOpinionDate?.slice(0, 10), unionOpinionNumber: dto.unionOpinionNumber,
    });
  }

  @Get('reports/t7')
  @ApiOperation({ operationId: 'exportT7', summary: 'График отпусков по форме Т-7 (XLSX)' })
  async t7(@CurrentUser() user: AccessClaims, @Query() q: T7Query, @Res() res: Response): Promise<void> {
    await assertStaff(this.prisma, user, 'hr');
    const data = await this.planning.t7(q.year);
    const file = await buildT7(data);
    await this.audit.record(this.prisma, {
      actorId: user.sub, action: 'report.exported', entity: 'report', entityId: 't7',
      after: { year: q.year, rows: data.rows.length, draft: data.draft },
    });
    res.status(200)
      .contentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="t7-${q.year}${data.draft ? '-draft' : ''}.xlsx"`);
    res.end(file);
  }
}
