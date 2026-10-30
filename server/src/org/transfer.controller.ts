// Импорт и экспорт структуры компании и сотрудников в форматах «По Делу» (v1.1.0, ADR-018).
// Загрузки — multipart: файл (поле file) и параметры формы; apply=false — только план.
import { Body, Controller, Get, HttpCode, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBooleanString, IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { assertStaff } from '../auth/access';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { orgToday } from '../infra/clock';
import { StructureTransferService } from './structure-transfer.service';
import { EmployeeTransferService, transferOptions } from './employee-transfer.service';
import { parseEmployees, parseEmployeesCsv, toBool, TransferFormatError } from './transfer-format';

const MAX_FILE = 5 * 1024 * 1024;
interface Upload { buffer: Buffer; originalname: string; size: number }

export class EmployeesExportQuery {
  @IsOptional() @IsIn(['csv', 'json'])
    format?: 'csv' | 'json';

  /** Уволенные — тоже (по умолчанию да, как в «По Делу»). */
  @IsOptional() @IsBooleanString()
    inactive?: string;
}

function fileText(file: Upload | undefined): string {
  if (!file) throw new ProblemException('validation/invalid-field', 'Выберите файл (multipart, поле file)');
  return file.buffer.toString('utf8');
}

/** Ошибки формата файла — 400 с понятным текстом. */
async function readable<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TransferFormatError) throw new ProblemException('validation/invalid-field', e.message);
    throw e;
  }
}

@ApiTags('org')
@Controller('api/v1/org')
export class TransferController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureTransferService,
    private readonly employees: EmployeeTransferService,
  ) {}

  private async download(res: Response, user: AccessClaims, kind: string, filename: string, type: string, body: string, rows: number) {
    await this.prisma.$transaction((tx) => this.audit.record(tx, {
      actorId: user.sub, action: 'report.exported', entity: 'report', entityId: kind, after: { rows },
    }));
    res.status(200).contentType(type).setHeader('Content-Disposition', `attachment; filename="${filename}"`).send(body);
  }

  @Get('export')
  @ApiOperation({ operationId: 'exportOrgStructure', summary: 'Структура компании и её настройки — файл podelu.org-structure (JSON)' })
  async exportStructure(@CurrentUser() user: AccessClaims, @Res() res: Response) {
    await assertStaff(this.prisma, user, 'hr');
    const doc = await this.structure.export(new Date());
    const day = await orgToday(this.prisma);
    await this.download(res, user, 'org-structure', `org-structure-${day}.json`, 'application/json', JSON.stringify(doc, null, 2), doc.departments.length);
  }

  @Post('import/structure')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE, files: 1 } }))
  @ApiOperation({ operationId: 'importOrgStructure', summary: 'Загрузка структуры: план (apply=false) или применение одной транзакцией' })
  async importStructure(@CurrentUser() user: AccessClaims, @UploadedFile() file: Upload | undefined, @Body() body: Record<string, unknown>) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    const text = fileText(file);
    const applySettings = toBool(body.applySettings) ?? true;
    if (toBool(body.apply)) {
      // Виды уровней и глубина — настройки организации: их меняет администратор
      if (applySettings && !actor.isAdmin) throw new ProblemException('auth/forbidden', 'Настройки структуры из файла применяет администратор — снимите «Применить настройки»');
      return readable(() => this.structure.apply(actor.id, text, applySettings));
    }
    return readable(() => this.structure.plan(text, applySettings));
  }

  @Get('employees/export')
  @ApiOperation({ operationId: 'exportOrgEmployees', summary: 'Сотрудники — CSV или JSON podelu.employees с полями отпусков' })
  async exportEmployees(@CurrentUser() user: AccessClaims, @Query() q: EmployeesExportQuery, @Res() res: Response) {
    await assertStaff(this.prisma, user, 'hr');
    const format = q.format ?? 'csv';
    const body = await this.employees.export(format, q.inactive !== 'false', new Date());
    const day = await orgToday(this.prisma);
    const rows = format === 'csv' ? body.split('\r\n').length - 2 : (JSON.parse(body) as { employees: unknown[] }).employees.length;
    await this.download(res, user, 'employees', `employees-${day}.${format}`,
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json', body, rows);
  }

  @Post('employees/import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE, files: 1 } }))
  @ApiOperation({ operationId: 'importOrgEmployees', summary: 'Загрузка сотрудников с решением коллизий: план или применение одной транзакцией' })
  async importEmployees(@CurrentUser() user: AccessClaims, @UploadedFile() file: Upload | undefined, @Body() body: Record<string, unknown>) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    const records = await readable(() => parseEmployees(fileText(file)));
    const opts = transferOptions(body, 'transfer');
    if (toBool(body.apply)) return this.employees.apply(actor, records, opts, 'transfer');
    return this.employees.plan(actor, records, opts);
  }

  @Post('import/csv')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE, files: 1 } }))
  @ApiOperation({ operationId: 'importOrgCsv', summary: 'Быстрый импорт CSV: сотрудник → подразделение, руководитель; файл главнее' })
  async importCsv(@CurrentUser() user: AccessClaims, @UploadedFile() file: Upload | undefined, @Body() body: Record<string, unknown>) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    const records = await readable(() => parseEmployeesCsv(fileText(file)));
    const opts = transferOptions(body, 'sync');
    if (toBool(body.apply)) return this.employees.apply(actor, records, opts, 'csv');
    return this.employees.plan(actor, records, opts);
  }
}
