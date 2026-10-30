// Выгрузка отпусков за период в XLSX (Ф12): администратор — организация,
// руководитель — свой отдел. Без логинов и паролей (docs/specs/02-api-spec.md).
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/guards';
import { calendarDays, vacationDays } from '../requests/balance';
import type { AccessClaims } from '../auth/token.service';

export class ReportQuery {
  @IsISO8601({})
    from!: string;

  @IsISO8601({})
    to!: string;
}

@ApiTags('reports')
@UseGuards()
@Controller('api/v1/reports')
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('vacations')
  @ApiOperation({ operationId: 'exportVacations', summary: 'Выгрузка отпусков за период (XLSX)' })
  async vacations(
    @CurrentUser() user: AccessClaims,
      @Query() q: ReportQuery,
      @Res() res: Response,
  ): Promise<void> {
    if (q.from > q.to) throw new ProblemException('validation/bad-date-range');
    const from = new Date(q.from);
    const to = new Date(q.to);

    const me = await this.prisma.employee.findUnique({
      where: { id: user.sub },
      include: { dept: true, subordinates: { select: { id: true } } },
    });
    if (!me) throw new ProblemException('not-found');
    // Администратор и кадровая служба — вся организация; руководитель отдела — свой отдел;
    // руководитель без отдела в подчинении — только прямые подчинённые и он сам.
    // (До v0.3.0 последний случай получал выгрузку всей организации.)
    let scope: Scope = { kind: 'all' };
    let scopeLabel = 'organization';
    if (!me.isAdmin && !me.isHr) {
      const isDeptManager = me.dept?.managerId === me.id;
      const hasSubordinates = me.subordinates.length > 0;
      if (!isDeptManager && !hasSubordinates) {
        throw new ProblemException('auth/forbidden', 'Выгрузка доступна руководителям и администраторам');
      }
      if (isDeptManager && me.dept) {
        scope = { kind: 'dept', dept: me.dept.name };
        scopeLabel = me.dept.name;
      } else {
        scope = { kind: 'ids', ids: [me.id, ...me.subordinates.map((s) => s.id)] };
        scopeLabel = 'subordinates';
      }
    }

    // Строки — простым SQL (25 тыс. отпусков организации через вложенную выборку Prisma —
    // сотни миллисекунд работы процессора), книга пишется потоком прямо в ответ (v0.5.0):
    // раньше сборка в памяти останавливала обработку всех остальных запросов на ~0,7 с.
    const where = scopeSql(scope);
    const rows = await this.prisma.$queryRaw<ExportRow[]>`
      SELECT e.name, e.position, d.name AS dept, to_char(v.start_date, 'YYYY-MM-DD') AS s, to_char(v.end_date, 'YYYY-MM-DD') AS e,
             v.status::text AS status, v.type::text AS type, v.comment
        FROM vacation_requests v JOIN employees e ON e.id = v.employee_id LEFT JOIN departments d ON d.id = e.dept_id
       WHERE v.start_date <= ${to} AND v.end_date >= ${from} AND v.status IN ('approved', 'pending') ${where}
       ORDER BY v.start_date, e.name, v.id`;

    // Праздники всех затронутых лет: дни отпуска без нерабочих праздничных (ТК РФ ст. 120)
    const years = [...new Set(rows.flatMap((r) => [Number(r.s.slice(0, 4)), Number(r.e.slice(0, 4))]))];
    const calendars = await this.prisma.productionCalendar.findMany({ where: { year: { in: years } } });
    const holidays = new Set(calendars.flatMap((c) => (Array.isArray(c.holidays) ? (c.holidays as string[]) : [])));

    await this.audit.record(this.prisma, {
      actorId: user.sub, action: 'report.exported', entity: 'report', entityId: 'vacations',
      after: { from: q.from, to: q.to, rows: rows.length, scope: scopeLabel },
    });

    res.status(200)
      .contentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="vacations-${q.from}_${q.to}.xlsx"`);
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
    wb.creator = 'Планировщик отпусков';
    const ws = wb.addWorksheet('Отпуска');
    ws.columns = [
      { header: 'Сотрудник', key: 'name', width: 32 },
      { header: 'Должность', key: 'position', width: 28 },
      { header: 'Отдел', key: 'dept', width: 26 },
      // Даты — значения Excel в формате ДД.ММ.ГГГГ (ТЗ, НФ-6): сортируются и считаются как даты (v1.0.0)
      { header: 'Начало', key: 'start', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Окончание', key: 'end', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Календарных дней', key: 'days', width: 18 },
      { header: 'Дней отпуска', key: 'vacationDays', width: 15 },
      { header: 'Статус', key: 'status', width: 16 },
      { header: 'Тип', key: 'type', width: 12 },
      { header: 'Комментарий', key: 'comment', width: 36 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).commit();
    const ruStatus: Record<string, string> = { approved: 'согласован', pending: 'на согласовании' };
    const ruType: Record<string, string> = { vacation: 'отпуск', maternity: 'декрет' };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      ws.addRow({
        name: r.name,
        position: r.position ?? '',
        dept: r.dept ?? '',
        start: new Date(`${r.s}T00:00:00Z`),
        end: new Date(`${r.e}T00:00:00Z`),
        days: calendarDays(r.s, r.e),
        vacationDays: vacationDays(r.s, r.e, holidays),
        status: ruStatus[r.status] ?? r.status,
        type: ruType[r.type] ?? r.type,
        comment: r.comment ?? '',
      }).commit();
      if (i % 100 === 99) await new Promise((resolve) => setImmediate(resolve)); // уступить другим запросам
    }
    ws.commit();
    await wb.commit();
  }
}

interface ExportRow { name: string; position: string | null; dept: string | null; s: string; e: string; status: string; type: string; comment: string | null }

type Scope = { kind: 'all' } | { kind: 'dept'; dept: string } | { kind: 'ids'; ids: number[] };

function scopeSql(scope: Scope): Prisma.Sql {
  if (scope.kind === 'dept') return Prisma.sql`AND d.name = ${scope.dept}`;
  if (scope.kind === 'ids') return Prisma.sql`AND v.employee_id IN (${Prisma.join(scope.ids)})`;
  return Prisma.empty;
}
