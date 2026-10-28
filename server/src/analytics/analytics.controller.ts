// Аналитика пересечений и подбор дат (docs/specs/02-api-spec.md, раздел «Аналитика»).
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { ProblemException } from '../infra/problems';
import { calendarDays, toIso } from '../requests/balance';
import { AnalyticsService } from './analytics.service';

export class OverviewQuery {
  @IsOptional() @IsString() @MaxLength(128)
    dept?: string;

  @IsOptional() @IsInt() @Min(2024) @Max(2100)
    year?: number;
}

export class TeamQuery {
  @IsOptional() @IsString() @MaxLength(128)
    dept?: string;

  @IsOptional() @IsInt()
    project?: number;

  @IsOptional() @IsISO8601()
    date?: string;
}

export class SuggestQuery {
  @IsOptional() @IsInt()
    employee?: number;

  @IsInt() @Min(1) @Max(60)
    days!: number;

  @IsOptional() @IsISO8601()
    from?: string;

  @IsOptional() @IsISO8601()
    to?: string;
}

@ApiTags('analytics')
@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('departments')
  @ApiOperation({ operationId: 'listAnalyticsDepartments', summary: 'Отделы, доступные пользователю для аналитики' })
  async departments(@CurrentUser() user: AccessClaims) {
    const v = await this.analytics.viewer(user.sub);
    return { items: await this.analytics.visibleDepts(v), own: v.deptName };
  }

  @Get('overview')
  @ApiOperation({ operationId: 'getDepartmentOverview', summary: 'Нагрузка отдела по месяцам, конфликты, распределение дней и выводы' })
  async overview(@CurrentUser() user: AccessClaims, @Query() q: OverviewQuery) {
    const v = await this.analytics.viewer(user.sub);
    const dept = q.dept ?? v.deptName ?? v.managedDepts[0];
    if (!dept) throw new ProblemException('validation/invalid-field', 'Укажите отдел');
    const today = toIso(new Date());
    return this.analytics.overview(v, dept, q.year ?? Number(today.slice(0, 4)), today);
  }

  @Get('team')
  @ApiOperation({ operationId: 'getTeamToday', summary: 'Состав отдела или проекта на дату: офис, удалёнка, отпуск' })
  async team(@CurrentUser() user: AccessClaims, @Query() q: TeamQuery) {
    const v = await this.analytics.viewer(user.sub);
    const dept = q.project ? undefined : q.dept ?? v.deptName ?? v.managedDepts[0];
    return this.analytics.team(v, { dept, project: q.project }, q.date ?? toIso(new Date()));
  }

  @Get('suggestions')
  @ApiOperation({ operationId: 'suggestVacationDates', summary: 'Лучшие окна для отпуска с учётом нагрузки отдела и праздников' })
  async suggestions(@CurrentUser() user: AccessClaims, @Query() q: SuggestQuery) {
    const v = await this.analytics.viewer(user.sub);
    const tomorrow = toIso(new Date(Date.now() + 86400000));
    const from = q.from && q.from > tomorrow ? q.from : tomorrow;
    const to = q.to ?? `${from.slice(0, 4)}-12-31`;
    if (from > to) throw new ProblemException('validation/bad-date-range');
    if (calendarDays(from, to) > 400) throw new ProblemException('validation/invalid-field', 'Период поиска не длиннее 400 дней');
    return this.analytics.suggestions(v, q.employee ?? v.id, q.days, from, to);
  }
}
