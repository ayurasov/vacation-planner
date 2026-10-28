// Расчёт полос диаграммы Ганта: чистые функции над интервалами года.
import { addDays, dayIndex, daysInYear } from './dates';

export interface VacationSpan {
  requestId: number;
  start: string;
  end: string;
  type: string;
  status: string;
}

export interface Bar {
  requestId: number;
  first: number; // индекс дня в году
  days: number;
  status: string;
  type: string;
  start: string;
  end: string;
}

/** Полосы отпусков, обрезанные по границам года. */
export function barsForYear(year: number, vacations: VacationSpan[]): Bar[] {
  const last = daysInYear(year) - 1;
  return vacations
    .map((v) => {
      const first = Math.max(0, dayIndex(year, v.start));
      const end = Math.min(last, dayIndex(year, v.end));
      return end < first ? null : {
        requestId: v.requestId, first, days: end - first + 1, status: v.status, type: v.type, start: v.start, end: v.end,
      };
    })
    .filter((b): b is Bar => b !== null)
    .sort((a, b) => a.first - b.first);
}

/** Сжатие множества дат в непрерывные отрезки [первый день, длина]. */
export function segments(year: number, dates: Iterable<string>): Array<{ first: number; days: number }> {
  const sorted = [...new Set(dates)].filter((d) => d.startsWith(`${year}-`)).sort();
  const out: Array<{ first: number; days: number }> = [];
  for (const d of sorted) {
    const idx = dayIndex(year, d);
    const prev = out[out.length - 1];
    if (prev && prev.first + prev.days === idx) prev.days++;
    else out.push({ first: idx, days: 1 });
  }
  return out;
}

/** Даты согласованного отпуска сотрудника, попадающие в конфликтные дни его отдела. */
export function conflictDatesFor(vacations: VacationSpan[], deptConflicts: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const v of vacations) {
    if (v.status !== 'approved') continue;
    for (let d = v.start; d <= v.end; d = addDays(d, 1)) if (deptConflicts.has(d)) out.push(d);
  }
  return out;
}

/** Отсутствует ли сотрудник в дату (согласованный отпуск). */
export function isAbsent(vacations: VacationSpan[], iso: string): boolean {
  return vacations.some((v) => v.status === 'approved' && v.start <= iso && iso <= v.end);
}
