// Чистые функции домена: длительности, пересечения, баланс (ADR-005 — без БД и времени системы).
export interface Interval {
  start: string; // YYYY-MM-DD
  end: string;
}

export function toIso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

/** Календарные дни периода включительно. */
export function calendarDays(start: string, end: string): number {
  const msPerDay = 86400000;
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / msPerDay) + 1;
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const n = calendarDays(start, end);
  for (let i = 0; i < n; i++) days.push(new Date(t0 + i * 86400000).toISOString().slice(0, 10));
  return days;
}

/**
 * Дни отпуска за период: календарные дни без нерабочих праздничных (ТК РФ ст. 120 —
 * праздники, приходящиеся на отпуск, в число дней отпуска не включаются и его продлевают).
 */
export function vacationDays(start: string, end: string, holidays: ReadonlySet<string> = new Set()): number {
  if (!holidays.size) return calendarDays(start, end);
  return eachDay(start, end).filter((d) => !holidays.has(d)).length;
}

/** Пересекаются ли периоды (включительно) в диапазонах дат. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export interface BalanceInput {
  plannedDays: number;
  carryOver: number;
  approved: Interval[]; // только type=vacation, status=approved
  pending: Interval[]; // только type=vacation, status=pending (включая переносы)
  holidays?: ReadonlySet<string>; // нерабочие праздничные дни производственного календаря
}

export interface BalanceResult {
  entitlement: number;
  used: number;
  pending: number;
  remaining: number;
  hasFourteenDayStretch: boolean;
}

/** Уникальные дни отпуска по набору периодов: пересечения не считаются дважды, праздники — не считаются. */
function uniqueDays(intervals: Interval[], holidays: ReadonlySet<string>): Set<string> {
  const set = new Set<string>();
  for (const i of intervals) for (const d of eachDay(i.start, i.end)) if (!holidays.has(d)) set.add(d);
  return set;
}

export function computeBalance(input: BalanceInput): BalanceResult {
  const entitlement = input.plannedDays + input.carryOver;
  const holidays = input.holidays ?? new Set<string>();
  const used = uniqueDays(input.approved, holidays).size;
  const pending = uniqueDays(input.pending, holidays).size;
  const stretch = [...input.approved]
    .map((i) => calendarDays(i.start, i.end))
    .reduce((max, d) => Math.max(max, d), 0);
  return {
    entitlement,
    used,
    pending,
    // Норма может быть дробной (перенос остатка): округляем до сотых, чтобы не было 9.329999…
    remaining: Math.round((entitlement - used) * 100) / 100,
    // ТК РФ ст. 125: одна из частей — не короче 14 календарных дней подряд
    hasFourteenDayStretch: stretch >= 14,
  };
}
