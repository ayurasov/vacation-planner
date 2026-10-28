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

/**
 * Окно виртуального списка: какие строки рисовать при прокрутке. offsets — верх каждой строки
 * (по возрастанию), total — высота списка. Рисуются строки, видимые в окне, плюс запас overscan
 * сверху и снизу; остальное место занимают пустые отступы (v0.5.0: 5000 строк — 65 тыс. узлов DOM).
 */
export function virtualWindow(offsets: readonly number[], total: number, scrollTop: number, viewport: number, overscan = 8):
{ start: number; end: number; padTop: number; padBottom: number } {
  const n = offsets.length;
  if (!n) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  // первая строка, нижняя граница которой ниже верха окна
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const bottom = mid + 1 < n ? offsets[mid + 1] : total;
    if (bottom <= scrollTop) lo = mid + 1; else hi = mid;
  }
  const first = lo;
  let last = first;
  while (last + 1 < n && offsets[last + 1] < scrollTop + viewport) last++;
  const start = Math.max(0, first - overscan);
  const end = Math.min(n, last + 1 + overscan);
  return { start, end, padTop: offsets[start], padBottom: total - (end < n ? offsets[end] : total) };
}

/** Число сотрудников в согласованном отпуске по дням года — одним проходом по отпускам, без перебора дней × людей. */
export function absentPerDay(year: number, people: ReadonlyArray<{ vacations: VacationSpan[] }>): Int32Array {
  const days = daysInYear(year);
  const diff = new Int32Array(days + 1);
  for (const p of people) {
    for (const v of p.vacations) {
      if (v.status !== 'approved') continue;
      const a = Math.max(0, dayIndex(year, v.start));
      const b = Math.min(days - 1, dayIndex(year, v.end));
      if (b < a) continue;
      diff[a]++;
      diff[b + 1]--;
    }
  }
  const out = new Int32Array(days);
  let run = 0;
  for (let i = 0; i < days; i++) { run += diff[i]; out[i] = run; }
  return out;
}
