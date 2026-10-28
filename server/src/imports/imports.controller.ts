// Импорт сотрудников из файла (XLSX/CSV) или JSON (синхронизация с кадровой системой).
import { Body, Controller, Get, HttpCode, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { assertStaff } from '../auth/access';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { ImportsService } from './imports.service';
import { ImportFormatError, parseImportFile, TEMPLATE_HEADERS, type ImportRow } from './parse';

const MAX_FILE = 2 * 1024 * 1024;
const FIELDS = ['name', 'login', 'position', 'dept', 'manager', 'plannedDays', 'carryOver', 'empType', 'email'] as const;

interface UploadedImport { buffer: Buffer; originalname: string; size: number }

/** JSON-строки интеграции: те же поля, что колонки шаблона; значения приводятся к строкам. */
function jsonRows(body: unknown): ImportRow[] {
  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) throw new ProblemException('validation/invalid-field', 'Ожидается файл (multipart, поле file) или JSON { rows: [...] }');
  return rows.map((r, i) => {
    const row: ImportRow = { line: i + 1 };
    if (r && typeof r === 'object') {
      for (const f of FIELDS) {
        const v = (r as Record<string, unknown>)[f];
        if (v !== undefined && v !== null && String(v).trim() !== '') row[f] = String(v).trim();
      }
    }
    return row;
  });
}

@ApiTags('imports')
@Controller('api/v1/imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('employees')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE, files: 1 } }))
  @ApiOperation({
    operationId: 'importEmployees',
    summary: 'Импорт сотрудников и остатков: предпросмотр (dryRun=true) или применение одной транзакцией',
  })
  async importEmployees(
    @CurrentUser() user: AccessClaims,
      @Query('dryRun') dryRun: string | undefined,
      @UploadedFile() file: UploadedImport | undefined,
      @Body() body: unknown,
  ) {
    const actor = await assertStaff(this.prisma, user, 'hr');
    let rows: ImportRow[];
    let source: string;
    try {
      rows = file ? await parseImportFile(file.buffer, file.originalname) : jsonRows(body);
      source = file ? `file:${file.originalname.slice(0, 120)}` : 'api';
    } catch (e) {
      if (e instanceof ImportFormatError) throw new ProblemException('validation/invalid-field', e.message);
      throw e;
    }
    return this.imports.run(actor, rows, dryRun !== 'false', source);
  }

  @Get('employees/template')
  @ApiOperation({ operationId: 'getImportTemplate', summary: 'Шаблон XLSX для импорта сотрудников' })
  async template(@CurrentUser() user: AccessClaims, @Res() res: Response) {
    await assertStaff(this.prisma, user, 'hr');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Сотрудники');
    ws.addRow(TEMPLATE_HEADERS);
    ws.addRow(['Иванов Иван Иванович', 'ivanov.ii', 'Инженер', 'ИТ служба', 'petrov.pp', 28, 3, 'штат', 'ivanov@example.ru']);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => { c.width = 22; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const help = wb.addWorksheet('Пояснения');
    [
      ['Колонка', 'Значение'],
      ['ФИО', 'Обязательно. По ФИО находится сотрудник, если не указан логин'],
      ['Логин', 'Необязательно. Для новых — строится по ФИО; для существующих — ключ сопоставления'],
      ['Отдел', 'Название; новый отдел создаётся автоматически'],
      ['Руководитель', 'Логин или ФИО; может быть создан этим же файлом'],
      ['Норма дней', 'Дней отпуска в год, например 28'],
      ['Перенос', 'Неиспользованный остаток прошлых лет'],
      ['Тип занятости', '«штат» или «ИП/самозанятый»'],
      ['Email', 'Для писем о решениях'],
      ['', 'Пустая ячейка — значение не меняется. Повторная загрузка того же файла ничего не меняет.'],
    ].forEach((r) => help.addRow(r));
    help.getColumn(1).width = 18;
    help.getColumn(2).width = 90;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="employees-import-template.xlsx"');
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }
}
