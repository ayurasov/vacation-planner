// Унифицированная форма № Т-7 «График отпусков» (ОКУД 0301020; постановление Госкомстата России
// от 05.01.2004 № 1): шапка с реквизитами, «УТВЕРЖДАЮ», таблица граф 1–10, подпись руководителя
// кадровой службы. Книга собирается в памяти: строк — по числу частей отпусков (тысячи, не десятки тысяч).
import ExcelJS from 'exceljs';
import type { T7Data } from './planning.service';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ru = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const quoted = (iso: string | null) => (iso ? `«${iso.slice(8, 10)}» ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)} г.` : '«____» ______________ 20____ г.');

const THIN = { style: 'thin' as const };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const SMALL = { size: 8 };
const CENTER = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };

/** Колонки A–J — графы 1–10 формы. */
const WIDTHS = [24, 26, 30, 11, 12, 13, 13, 22, 15, 26];

export async function buildT7(data: T7Data): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Планировщик отпусков';
  const ws = wb.addWorksheet(`Т-7 ${data.year}`, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = WIDTHS.map((width) => ({ width }));
  ws.properties.defaultRowHeight = 15;
  const font = { name: 'Arial', size: 10 };

  const put = (ref: string, value: string | number | null, style: Partial<ExcelJS.Style> = {}) => {
    const c = ws.getCell(ref);
    c.value = value ?? '';
    c.font = { ...font, ...(style.font ?? {}) };
    if (style.alignment) c.alignment = style.alignment;
    if (style.border) c.border = style.border;
    return c;
  };
  const merge = (range: string, value: string | number | null, style: Partial<ExcelJS.Style> = {}) => {
    ws.mergeCells(range);
    return put(range.split(':')[0], value, style);
  };
  const underline = (range: string) => {
    const [from, to] = range.split(':');
    const row = Number(from.replace(/\D/g, ''));
    const a = from.charCodeAt(0);
    const b = (to ?? from).charCodeAt(0);
    for (let col = a; col <= b; col++) ws.getCell(`${String.fromCharCode(col)}${row}`).border = { bottom: THIN };
  };

  // Шапка формы
  merge('H1:J1', 'Унифицированная форма № Т-7', { alignment: { horizontal: 'right' }, font: SMALL });
  merge('H2:J2', 'Утверждена постановлением Госкомстата России от 05.01.2004 № 1', { alignment: { horizontal: 'right' }, font: SMALL });
  put('J3', 'Код', { alignment: CENTER, border: BOX });
  put('I4', 'Форма по ОКУД', { alignment: { horizontal: 'right' }, font: SMALL });
  put('J4', '0301020', { alignment: CENTER, border: BOX });
  put('I5', 'по ОКПО', { alignment: { horizontal: 'right' }, font: SMALL });
  put('J5', data.orgOkpo, { alignment: CENTER, border: BOX });
  merge('A4:G4', data.orgName, { alignment: { horizontal: 'center' }, font: { bold: true } });
  underline('A4:G4');
  merge('A5:G5', '(наименование организации)', { alignment: { horizontal: 'center', vertical: 'top' }, font: SMALL });

  // Мнение профсоюза, реквизиты документа, «УТВЕРЖДАЮ»
  const union = data.unionOpinionDate || data.unionOpinionNumber
    ? `Мнение выборного профсоюзного органа от ${quoted(data.unionOpinionDate)} № ${data.unionOpinionNumber ?? '____'} учтено`
    : 'Мнение выборного профсоюзного органа от «____» ______________ 20____ г. № ____ учтено';
  merge('A7:C9', union, { alignment: { vertical: 'top', wrapText: true }, font: SMALL });
  put('E7', 'Номер документа', { alignment: CENTER, border: BOX, font: SMALL });
  put('F7', 'Дата составления', { alignment: CENTER, border: BOX, font: SMALL });
  put('G7', 'На год', { alignment: CENTER, border: BOX, font: SMALL });
  put('E8', data.docNumber, { alignment: CENTER, border: BOX, font: { bold: true } });
  put('F8', ru(data.docDate), { alignment: CENTER, border: BOX, font: { bold: true } });
  put('G8', data.year, { alignment: CENTER, border: BOX, font: { bold: true } });
  ws.getRow(7).height = 24;
  merge('H7:J7', 'УТВЕРЖДАЮ', { font: { bold: true } });
  merge('H8:J8', `Руководитель: ${data.headPosition ?? ''}`);
  merge('H9:J9', `____________________   ${data.headName ?? ''}`);
  merge('H10:J10', data.docDate ? quoted(data.docDate) : quoted(null));

  merge('A12:J12', data.draft ? 'ГРАФИК ОТПУСКОВ — ПРОЕКТ (не утверждён)' : 'ГРАФИК ОТПУСКОВ', { alignment: { horizontal: 'center' }, font: { bold: true, size: 13 } });

  // Заголовок таблицы: три уровня и номера граф
  const head = { alignment: CENTER, border: BOX, font: SMALL };
  merge('A14:A16', 'Структурное подразделение', head);
  merge('B14:B16', 'Должность (специальность, профессия) по штатному расписанию', head);
  merge('C14:C16', 'Фамилия, имя, отчество', head);
  merge('D14:D16', 'Табельный номер', head);
  merge('E14:I14', 'ОТПУСК', head);
  merge('J14:J16', 'Примечание', head);
  merge('E15:E16', 'количество календарных дней', head);
  merge('F15:G15', 'дата', head);
  merge('H15:I15', 'перенесение отпуска', head);
  put('F16', 'запланированная', head);
  put('G16', 'фактическая', head);
  put('H16', 'основание (документ)', head);
  put('I16', 'дата предполагаемого отпуска', head);
  ws.getRow(16).height = 36;
  'ABCDEFGHIJ'.split('').forEach((col, i) => put(`${col}17`, i + 1, head));
  // У объединённых ячеек рамку несёт каждая ячейка диапазона, а не только первая
  for (const ref of ['B14', 'C14', 'D14', 'J14', 'A15', 'B15', 'C15', 'D15', 'J15', 'A16', 'B16', 'C16', 'D16', 'E16', 'J16', 'F14', 'G14', 'H14', 'I14', 'G15', 'I15']) {
    ws.getCell(ref).border = BOX;
  }
  ws.pageSetup.printTitlesRow = '14:17';

  // Строки графика
  let r = 18;
  for (const row of data.rows) {
    const cells: Array<string | number | null> = [
      row.dept, row.position, row.name, row.personnelNumber, row.days,
      ru(row.planned), ru(row.actual), row.transferBasis, ru(row.transferDate), row.note,
    ];
    cells.forEach((v, i) => {
      put(`${'ABCDEFGHIJ'[i]}${r}`, v, {
        border: BOX,
        alignment: i >= 3 && i <= 8 ? { horizontal: 'center', vertical: 'top', wrapText: true } : { vertical: 'top', wrapText: true },
      });
    });
    r++;
  }

  // Подпись руководителя кадровой службы
  r += 1;
  put(`A${r}`, 'Руководитель кадровой службы');
  merge(`B${r}:C${r}`, data.hrHeadPosition, { alignment: { horizontal: 'center' } });
  underline(`B${r}:C${r}`);
  underline(`D${r}:E${r}`);
  merge(`F${r}:H${r}`, data.hrHeadName, { alignment: { horizontal: 'center' } });
  underline(`F${r}:H${r}`);
  merge(`B${r + 1}:C${r + 1}`, '(должность)', { alignment: { horizontal: 'center' }, font: SMALL });
  merge(`D${r + 1}:E${r + 1}`, '(личная подпись)', { alignment: { horizontal: 'center' }, font: SMALL });
  merge(`F${r + 1}:H${r + 1}`, '(расшифровка подписи)', { alignment: { horizontal: 'center' }, font: SMALL });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
