// Разбор файла импорта сотрудников: XLSX (первый лист) или CSV/текст. Только чтение и
// нормализация строк — правила сопоставления и проверки живут в plan.ts.
import ExcelJS from 'exceljs';

export interface ImportRow {
  /** Номер строки в файле (заголовок — строка 1). */
  line: number;
  name?: string;
  login?: string;
  position?: string;
  dept?: string;
  manager?: string;
  plannedDays?: string;
  carryOver?: string;
  empType?: string;
  email?: string;
}

type Field = Exclude<keyof ImportRow, 'line'>;

/** Заголовки колонок: русские и английские варианты, регистр и пробелы не важны. */
const HEADERS: Record<string, Field> = {
  фио: 'name', сотрудник: 'name', name: 'name',
  логин: 'login', login: 'login',
  должность: 'position', position: 'position',
  отдел: 'dept', подразделение: 'dept', department: 'dept', dept: 'dept',
  руководитель: 'manager', manager: 'manager',
  нормадней: 'plannedDays', норма: 'plannedDays', 'нормаднейвгод': 'plannedDays', planneddays: 'plannedDays',
  перенос: 'carryOver', остаток: 'carryOver', 'переноспрошлыхлет': 'carryOver', carryover: 'carryOver',
  типзанятости: 'empType', тип: 'empType', emptype: 'empType',
  email: 'email', почта: 'email', 'e-mail': 'email', электроннаяпочта: 'email',
};

export const TEMPLATE_HEADERS = ['ФИО', 'Логин', 'Должность', 'Отдел', 'Руководитель', 'Норма дней', 'Перенос', 'Тип занятости', 'Email'];

const key = (h: string) => h.toLowerCase().replace(/ё/g, 'е').replace(/[\s_.]+/g, '');

export class ImportFormatError extends Error {}

function toRows(table: string[][]): ImportRow[] {
  const headerIdx = table.findIndex((r) => r.some((c) => c.trim()));
  if (headerIdx < 0) throw new ImportFormatError('Файл пустой');
  const header = table[headerIdx].map((h) => HEADERS[key(h)] ?? HEADERS[key(h).replace(/[^a-zа-я-]/g, '')]);
  if (!header.includes('name')) {
    throw new ImportFormatError(`Нет колонки «ФИО». Ожидаемые колонки: ${TEMPLATE_HEADERS.join(', ')}`);
  }
  const rows: ImportRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells.some((c) => c.trim())) continue;
    const row: ImportRow = { line: i + 1 };
    header.forEach((field, col) => {
      const v = (cells[col] ?? '').trim();
      if (field && v) row[field] = v;
    });
    rows.push(row);
  }
  return rows;
}

/** CSV с разделителем «;», «,» или табуляцией и кавычками по RFC 4180. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && !cell) {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text; // гиперссылка, e-mail
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue); // формула
    return '';
  }
  return String(v);
}

export async function parseImportFile(buffer: Buffer, filename: string): Promise<ImportRow[]> {
  const isXlsx = buffer.subarray(0, 2).toString('latin1') === 'PK' || /\.xlsx$/i.test(filename);
  if (!isXlsx) return toRows(parseCsv(buffer.toString('utf8')));
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportFormatError('Не удалось прочитать XLSX: сохраните файл в формате Excel 2007+ или CSV');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportFormatError('В книге нет листов');
  const table: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (r, n) => {
    const cells: string[] = [];
    r.eachCell({ includeEmpty: true }, (c, col) => { cells[col - 1] = cellText(c.value); });
    table[n - 1] = Array.from(cells, (c) => c ?? '');
  });
  return toRows(Array.from(table, (r) => r ?? []));
}
