// График: интервалы за период + конфликты отделов (Ф5, Ф6).
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { calendarDays, eachDay, toIso } from '../requests/balance';

export class ScheduleQuery {
  @IsISO8601({})
    from!: string;

  @IsISO8601({})
    to!: string;

  @IsOptional() @IsString() @MaxLength(128)
    dept?: string;

  @IsOptional() @IsInt()
    project?: number;
}

@ApiTags('schedule')
@Controller('api/v1/schedule')
export class ScheduleController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ operationId: 'getSchedule', summary: 'График отпусков и режимов за период' })
  async schedule(@Query() q: ScheduleQuery) {
    if (q.from > q.to) throw new ProblemException('validation/bad-date-range');
    if (calendarDays(q.from, q.to) > 370) {
      throw new ProblemException('validation/invalid-field', 'Период не длиннее 370 дней');
    }
    const from = new Date(q.from);
    const to = new Date(q.to);

    const employees = await this.prisma.employee.findMany({
      where: {
        isActive: true,
        ...(q.dept ? { dept: { name: q.dept } } : {}),
        ...(q.project ? { projectId: q.project } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, position: true, dept: { select: { name: true } },
        vacationRequests: {
          where: { startDate: { lte: to }, endDate: { gte: from }, status: { in: ['pending', 'approved'] } },
          select: { id: true, startDate: true, endDate: true, type: true, status: true },
        },
        workPatterns: true,
        workOverrides: { where: { date: { gte: from, lte: to } } },
      },
    });

    // Конфликты: доля отсутствующих (approved) в отделе по датам ≥ порога
    const settings = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    const threshold = (settings?.conflictThreshold ?? 50) / 100;
    const byDept = new Map<string, { total: Set<number>; absentByDate: Map<string, Set<number>> }>();
    for (const e of employees) {
      const deptName = e.dept?.name ?? 'Без отдела';
      let bucket = byDept.get(deptName);
      if (!bucket) { bucket = { total: new Set(), absentByDate: new Map() }; byDept.set(deptName, bucket); }
      bucket.total.add(e.id);
      for (const v of e.vacationRequests.filter((v) => v.status === 'approved')) {
        const s = v.startDate < from ? from : v.startDate;
        const en = v.endDate > to ? to : v.endDate;
        for (const d of eachDay(toIso(s), toIso(en))) {
          if (!bucket.absentByDate.has(d)) bucket.absentByDate.set(d, new Set());
          bucket.absentByDate.get(d)!.add(e.id);
        }
      }
    }
    const conflicts: Array<{ date: string; dept: string; absentRatio: number }> = [];
    for (const [dept, bucket] of byDept) {
      if (bucket.total.size === 0) continue;
      for (const [date, absent] of bucket.absentByDate) {
        const ratio = absent.size / bucket.total.size;
        if (ratio >= threshold) conflicts.push({ date, dept, absentRatio: Math.round(ratio * 100) / 100 });
      }
    }
    conflicts.sort((a, b) => a.date.localeCompare(b.date));

    return {
      from: q.from,
      to: q.to,
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        position: e.position,
        dept: e.dept?.name ?? null,
        vacations: e.vacationRequests.map((v) => ({
          requestId: v.id, start: toIso(v.startDate), end: toIso(v.endDate),
          type: v.type, status: v.status,
        })),
        workPattern: Object.fromEntries(e.workPatterns.map((p) => [p.weekday, p.mode])),
        workOverrides: e.workOverrides.map((o) => ({ date: toIso(o.date), mode: o.mode })),
      })),
      conflicts,
    };
  }
}
