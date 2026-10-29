// Извещения о начале отпуска (v0.6.0, E60-03/04): свои извещения и «Ознакомлен» — у сотрудника,
// журнал и выгрузка — у кадровой службы.
import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { assertStaff, hasStaff, loadActor } from '../auth/access';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { NoticesService } from './notices.service';

export class NoticesQuery {
  @IsISO8601({ strict: true })
    from!: string;

  @IsISO8601({ strict: true })
    to!: string;

  /** pending — не ознакомлен; overdue — не ознакомлен, а до начала три дня и меньше. */
  @IsOptional() @IsIn(['pending', 'acknowledged', 'overdue'])
    status?: 'pending' | 'acknowledged' | 'overdue';

  @IsOptional() @IsString() @MaxLength(200)
    dept?: string;

  @IsOptional() @IsInt() @Min(1)
    page?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
    per_page?: number;
}

export class NoticesExportQuery {
  @IsISO8601({ strict: true })
    from!: string;

  @IsISO8601({ strict: true })
    to!: string;
}

const MAX_RANGE_DAYS = 400;

function assertRange(from: string, to: string): void {
  if (from > to) throw new ProblemException('validation/bad-date-range');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new ProblemException('validation/bad-date-range', 'Период — не больше года');
  }
}

@ApiTags('notices')
@Controller('api/v1')
export class NoticesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: NoticesService,
    private readonly audit: AuditService,
  ) {}

  @Get('notices/mine')
  @ApiOperation({ operationId: 'listMyNotices', summary: 'Мои извещения о начале отпуска' })
  mine(@CurrentUser() user: AccessClaims) {
    return this.notices.mine(user.sub);
  }

  @Get('notices')
  @ApiOperation({ operationId: 'listNotices', summary: 'Журнал извещений (кадровая служба)' })
  async list(@CurrentUser() user: AccessClaims, @Query() q: NoticesQuery) {
    await assertStaff(this.prisma, user, 'hr');
    const from = q.from.slice(0, 10);
    const to = q.to.slice(0, 10);
    assertRange(from, to);
    return this.notices.journal({ from, to, status: q.status, dept: q.dept, page: q.page ?? 1, perPage: q.per_page ?? 50 });
  }

  @Get('notices/:id')
  @ApiOperation({ operationId: 'getNotice', summary: 'Извещение (для печати под подпись)' })
  async get(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    const actor = await loadActor(this.prisma, user.sub);
    return this.notices.get({ id: user.sub, staff: hasStaff(actor, 'hr') }, id);
  }

  @Post('notices/:id/acknowledge')
  @HttpCode(204)
  @ApiOperation({ operationId: 'acknowledgeNotice', summary: 'Ознакомлен с извещением' })
  async acknowledge(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.notices.acknowledge(user.sub, id);
  }

  @Get('reports/notices')
  @ApiOperation({ operationId: 'exportNotices', summary: 'Журнал извещений за период (XLSX)' })
  async export(@CurrentUser() user: AccessClaims, @Query() q: NoticesExportQuery, @Res() res: Response): Promise<void> {
    await assertStaff(this.prisma, user, 'hr');
    const from = q.from.slice(0, 10);
    const to = q.to.slice(0, 10);
    assertRange(from, to);
    const rows = await this.notices.all(from, to);
    await this.audit.record(this.prisma, {
      actorId: user.sub, action: 'report.exported', entity: 'report', entityId: 'notices',
      after: { from, to, rows: rows.length },
    });

    res.status(200)
      .contentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="notices-${from}_${to}.xlsx"`);
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
    wb.creator = 'Планировщик отпусков';
    const ws = wb.addWorksheet('Извещения');
    ws.columns = [
      { header: 'Сотрудник', key: 'name', width: 32 },
      { header: 'Должность', key: 'position', width: 28 },
      { header: 'Отдел', key: 'dept', width: 26 },
      { header: 'Начало отпуска', key: 'start', width: 15 },
      { header: 'Окончание', key: 'end', width: 12 },
      { header: 'Дней', key: 'days', width: 8 },
      { header: 'Извещён', key: 'sent', width: 18 },
      { header: 'Позже двух недель', key: 'late', width: 18 },
      { header: 'Ознакомлен', key: 'ack', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).commit();
    const stamp = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
    for (let i = 0; i < rows.length; i++) {
      const n = rows[i];
      ws.addRow({
        name: n.employeeName, position: n.position ?? '', dept: n.dept ?? '', start: n.start, end: n.end, days: n.days,
        sent: stamp(n.sentAt), late: n.late ? 'да' : '', ack: n.acknowledgedAt ? stamp(n.acknowledgedAt) : 'нет',
      }).commit();
      if (i % 100 === 99) await new Promise((resolve) => setImmediate(resolve)); // уступить другим запросам
    }
    ws.commit();
    await wb.commit();
  }
}
