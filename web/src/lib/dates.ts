// Даты в формате YYYY-MM-DD без часовых поясов: вся арифметика в UTC.
// Модуль чистый — «сегодня» передаётся аргументом (правило 3 AGENTS.md).

const DAY = 86400000;

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function toMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * DAY);
}

/** Локальная дата пользователя в ISO (для «сегодня»). */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Календарные дни периода включительно. */
export function calendarDays(start: string, end: string): number {
  return Math.round((toMs(end) - toMs(start)) / DAY) + 1;
}

/** Дни отпуска: календарные без нерабочих праздничных (ТК РФ ст. 120). */
export function vacationDays(start: string, end: string, holidays: ReadonlySet<string> = new Set()): number {
  const total = calendarDays(start, end);
  if (total <= 0 || !holidays.size) return Math.max(total, 0);
  let n = 0;
  for (let i = 0; i < total; i++) if (!holidays.has(addDays(start, i))) n++;
  return n;
}

/** Праздники, попадающие в период. */
export function holidaysIn(start: string, end: string, holidays: ReadonlySet<string>): string[] {
  return [...holidays].filter((d) => d >= start && d <= end).sort();
}

export function daysInYear(year: number): number {
  return calendarDays(`${year}-01-01`, `${year}-12-31`);
}

/** Номер дня в году с нуля. */
export function dayIndex(year: number, iso: string): number {
  return Math.round((toMs(iso) - toMs(`${year}-01-01`)) / DAY);
}

export function weekday(iso: string): number {
  return new Date(toMs(iso)).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const w = weekday(iso);
  return w === 0 || w === 6;
}

export interface MonthSpan {
  index: number;
  name: string;
  short: string;
  offset: number; // день года, с которого начинается месяц
  days: number;
}

export function monthsOf(year: number): MonthSpan[] {
  let offset = 0;
  return MONTHS.map((name, index) => {
    const days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    const span = { index, name, short: MONTHS_SHORT[index], offset, days };
    offset += days;
    return span;
  });
}

/** «14 сентября 2026», «14 сентября» (без года — для текущего года). */
export function fmtDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/** Компактный период: «14–20 сентября 2026», «28 сентября – 4 октября 2026». */
export function fmtRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (start === end) return fmtDate(start);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_GEN[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_GEN[sm - 1]} – ${ed} ${MONTHS_GEN[em - 1]} ${ey}`;
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

/** Относительное описание: «через 12 дней», «идёт сейчас», «завершён». */
export function relativeToToday(start: string, end: string, today: string): string {
  if (end < today) return 'завершён';
  if (start <= today) return 'идёт сейчас';
  const n = calendarDays(today, start) - 1;
  if (n === 1) return 'завтра';
  return `через ${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}

export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  if (!Number.isInteger(n)) return forms[1];
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Число дней для интерфейса: 9.33 → «9,33», 28 → «28». */
export function fmtNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function fmtDays(n: number): string {
  return `${fmtNumber(n)} ${plural(n, ['день', 'дня', 'дней'])}`;
}
