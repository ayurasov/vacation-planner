// Разбор файла производственного календаря для редактора в «Справочниках».
// Поддерживаются: формат открытых данных xmlcalendar.ru (<day d="01.08" t="1" f="01.02"/>, даты ММ.ДД)
// и простой текст/CSV — по дате в строке (праздник) или по две (перенос «откуда → куда»).
// Модуль чистый: без DOM и без «сегодня».
import { isWeekend } from './dates';

export interface Transfer { from: string; to: string }

export interface ParsedCalendar {
  format: 'xmlcalendar' | 'text';
  holidays: string[];
  transfers: Transfer[];
  /** Даты другого года и нераспознанные строки с датами. */
  skipped: number;
}

const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const RU = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g;

function valid(y: number, m: number, d: number): string | null {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? iso : null;
}

/** Даты строки в порядке появления (YYYY-MM-DD и ДД.ММ.ГГГГ). */
function datesIn(line: string): Array<string | null> {
  const found: Array<{ at: number; iso: string | null }> = [];
  for (const m of line.matchAll(ISO)) found.push({ at: m.index ?? 0, iso: valid(+m[1], +m[2], +m[3]) });
  for (const m of line.matchAll(RU)) found.push({ at: m.index ?? 0, iso: valid(+m[3], +m[2], +m[1]) });
  return found.sort((a, b) => a.at - b.at).map((f) => f.iso);
}

function finish(format: ParsedCalendar['format'], holidays: Set<string>, transfers: Transfer[], skipped: number): ParsedCalendar {
  const seen = new Set<string>();
  const uniq = transfers.filter((t) => {
    const k = `${t.from}>${t.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.to.localeCompare(b.to));
  return { format, holidays: [...holidays].sort(), transfers: uniq, skipped };
}

function parseXmlCalendar(text: string, year: number): ParsedCalendar {
  const fileYear = Number(/<calendar[^>]*\byear="(\d{4})"/.exec(text)?.[1] ?? year);
  const holidays = new Set<string>();
  const transfers: Transfer[] = [];
  let skipped = 0;
  if (fileYear !== year) {
    return { format: 'xmlcalendar', holidays: [], transfers: [], skipped: (text.match(/<day\b/g) ?? []).length };
  }
  for (const m of text.matchAll(/<day\b([^>]*)\/?>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1])?.[1];
    const [mm, dd] = (attr('d') ?? '').split('.').map(Number); // xmlcalendar: ММ.ДД
    const iso = dd && mm ? valid(year, mm, dd) : null;
    if (!iso) { skipped++; continue; }
    if (attr('t') !== '1') continue; // 2 — сокращённый день, 3 — рабочий выходной: учтены через перенос
    if (attr('h')) { holidays.add(iso); continue; } // праздник ст. 112 ТК РФ
    const f = attr('f'); // перенесённый выходной: f — откуда перенесён
    const [fm, fd] = (f ?? '').split('.').map(Number);
    const from = fd && fm ? valid(year, fm, fd) : null;
    if (from) transfers.push({ from, to: iso });
    else skipped++;
  }
  return finish('xmlcalendar', holidays, transfers, skipped);
}

function parseText(text: string, year: number): ParsedCalendar {
  const holidays = new Set<string>();
  const transfers: Transfer[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const dates = datesIn(line);
    if (!dates.length) continue;
    if (dates.some((d) => d === null)) { skipped++; continue; }
    const iso = dates as string[];
    if (iso.length === 1) {
      if (iso[0].startsWith(`${year}-`)) holidays.add(iso[0]); else skipped++;
    } else if (iso.length === 2 && iso[0] !== iso[1] && (iso[0].startsWith(`${year}-`) || iso[1].startsWith(`${year}-`))) {
      transfers.push({ from: iso[0], to: iso[1] });
    } else {
      skipped++;
    }
  }
  return finish('text', holidays, transfers, skipped);
}

export function parseCalendarFile(text: string, year: number): ParsedCalendar {
  return /<calendar\b/.test(text) ? parseXmlCalendar(text, year) : parseText(text, year);
}

/** Переключение праздника в редакторе: возвращает новый отсортированный список. */
export function toggleHoliday(holidays: readonly string[], iso: string): string[] {
  return holidays.includes(iso) ? holidays.filter((d) => d !== iso) : [...holidays, iso].sort();
}

/**
 * Рабочий календарь года. Праздники ст. 112 (`holidays`) не входят в дни отпуска;
 * перенесённые выходные (`to` переноса) — нерабочие, но в отпуск входят; `from`
 * переноса, выпавший на выходной и не являющийся праздником, становится рабочим.
 */
export interface WorkCalendar {
  holidays: Set<string>;
  offDays: Set<string>;
  workWeekends: Set<string>;
}

export function workCalendar(holidays: Iterable<string>, transfers: readonly Transfer[] = []): WorkCalendar {
  const h = new Set(holidays);
  return {
    holidays: h,
    offDays: new Set([...h, ...transfers.map((t) => t.to)]),
    workWeekends: new Set(transfers.map((t) => t.from).filter((d) => !h.has(d) && isWeekend(d))),
  };
}

export function isDayOff(iso: string, cal: WorkCalendar): boolean {
  if (cal.workWeekends.has(iso)) return false;
  return isWeekend(iso) || cal.offDays.has(iso);
}
