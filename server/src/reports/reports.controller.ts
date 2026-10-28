// Выгрузка отпусков за период в XLSX (Ф12): администратор — организация,
// руководитель — свой отдел. Без логинов и паролей (docs/specs/02-api-spec.md).
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/guards';
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
    // Администратор — вся организация; руководитель отдела — свой отдел;
    // руководитель без отдела в подчинении — только прямые подчинённые и он сам.
    // (До v0.3.0 последний случай получал выгрузку всей организации.)
    let scope: Prisma.VacationRequestWhereInput = {};
    let scopeLabel = 'organization';
    if (!me.isAdmin) {
      const isDeptManager = me.dept?.managerId === me.id;
      const hasSubordinates = me.subordinates.length > 0;
      if (!isDeptManager && !hasSubordinates) {
        throw new ProblemException('auth/forbidden', 'Выгрузка доступна руководителям и администраторам');
      }
      if (isDeptManager && me.dept) {
        scope = { employee: { dept: { name: me.dept.name } } };
        scopeLabel = me.dept.name;
      } else {
        scope = { employeeId: { in: [me.id, ...me.subordinates.map((s) => s.id)] } };
        scopeLabel = 'subordinates';
      }
    }

    const rows = await this.prisma.vacationRequest.findMany({
      where: {
        startDate: { lte: to },
        endDate: { gte: from },
        status: { in: ['approved', 'pending'] },
        ...scope,
      },
      orderBy: [{ startDate: 'asc' }],
      include: { employee: { include: { dept: { select: { name: true } } } } },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Планировщик отпусков';
    const ws = wb.addWorksheet('Отпуска');
    ws.columns = [
      { header: 'Сотрудник', key: 'name', width: 32 },
      { header: 'Должность', key: 'position', width: 28 },
      { header: 'Отдел', key: 'dept', width: 26 },
      { header: 'Начало', key: 'start', width: 12 },
      { header: 'Окончание', key: 'end', width: 12 },
      { header: 'Календарных дней', key: 'days', width: 18 },
      { header: 'Статус', key: 'status', width: 16 },
      { header: 'Тип', key: 'type', width: 12 },
      { header: 'Комментарий', key: 'comment', width: 36 },
    ];
    ws.getRow(1).font = { bold: true };
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const ruStatus: Record<string, string> = { approved: 'согласован', pending: 'на согласовании' };
    const ruType: Record<string, string> = { vacation: 'отпуск', maternity: 'декрет' };
    for (const r of rows) {
      const days = Math.floor((r.endDate.getTime() - r.startDate.getTime()) / 86400000) + 1;
      ws.addRow({
        name: r.employee.name,
        position: r.employee.position ?? '',
        dept: r.employee.dept?.name ?? '',
        start: iso(r.startDate),
        end: iso(r.endDate),
        days,
        status: ruStatus[r.status] ?? r.status,
        type: ruType[r.type] ?? r.type,
        comment: r.comment ?? '',
      });
    }

    await this.audit.record(this.prisma, {
      actorId: user.sub, action: 'report.exported', entity: 'report', entityId: 'vacations',
      after: { from: q.from, to: q.to, rows: rows.length, scope: scopeLabel },
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.status(200)
      .contentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="vacations-${q.from}_${q.to}.xlsx"`)
      .send(buffer);
  }
}
