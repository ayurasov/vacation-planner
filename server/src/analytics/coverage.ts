// Аналитика пересечений отпусков — чистые функции без БД и «сейчас» (ADR-005, правило 3 AGENTS.md).
// Вход — сотрудники с интервалами отпусков, праздники и порог конфликта; выход — профили нагрузки,
// периоды конфликтов, выводы для руководителя и подбор лучших окон для нового отпуска.
import { calendarDays, computeBalance, eachDay, type Interval } from '../requests/balance';

export interface Span extends Interval {
  status: 'approved' | 'pending';
  type?: string;
}

export interface Person {
  id: number;
  name: string;
  dept: string | null;
  plannedDays: number;
  carryOver: number;
  empType: string;
  vacations: Span[];
}

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`)).getUTCDay();
const isWeekend = (iso: string) => [0, 6].includes(weekday(iso));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function isWorkday(iso: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(iso) && !holidays.has(iso);
}

/** Отсутствует ли человек в дату: согласованный отпуск (и, по запросу, ожидающий). */
export function absentOn(p: Person, iso: string, withPending = false): boolean {
  return p.vacations.some((v) => (v.status === 'approved' || (withPending && v.status === 'pending')) && v.start <= iso && iso <= v.end);
}

// ─────────────────────────────── Профиль нагрузки и конфликты отдела

export interface MonthLoad {
  month: number; // 1..12
  avgRatio: number; // средняя доля отсутствующих по рабочим дням
  peakRatio: number;
  peakDate: string | null;
}

export interface ConflictPeriod {
  start: string;
  end: string;
  peakRatio: number;
  peakAbsent: number;
  names: string[]; // кто отсутствует в пиковый день
}

/** Доля отсутствующих по рабочим дням года; pending учитывается отдельно как «план». */
export function monthlyLoad(people: Person[], year: number, holidays: ReadonlySet<string>, withPending = false): MonthLoad[] {
  const n = people.length || 1;
  const out: MonthLoad[] = [];
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
    let sum = 0;
    let days = 0;
    let peak = 0;
    let peakDate: string | null = null;
    for (const d of eachDay(first, last)) {
      if (!isWorkday(d, holidays)) continue;
      const ratio = people.filter((p) => absentOn(p, d, withPending)).length / n;
      sum += ratio;
      days++;
      if (ratio > peak) { peak = ratio; peakDate = d; }
    }
    out.push({ month: m, avgRatio: round2(days ? sum / days : 0), peakRatio: round2(peak), peakDate });
  }
  return out;
}

/** Непрерывные периоды, когда доля согласованных отсутствий отдела ≥ порога (выходные не разрывают период). */
export function conflictPeriods(people: Person[], year: number, threshold: number, holidays: ReadonlySet<string>): ConflictPeriod[] {
  const n = people.length;
  if (n < 2) return []; // у одиночки «конфликта» с самим собой не бывает
  const out: ConflictPeriod[] = [];
  let cur: ConflictPeriod | null = null;
  let gap = 0;
  for (const d of eachDay(`${year}-01-01`, `${year}-12-31`)) {
    const absent = people.filter((p) => absentOn(p, d));
    const ratio = absent.length / n;
    if (ratio >= threshold && absent.length >= 1) {
      if (!cur) cur = { start: d, end: d, peakRatio: 0, peakAbsent: 0, names: [] };
      cur.end = d;
      gap = 0;
      if (ratio > cur.peakRatio) {
        cur.peakRatio = round2(ratio);
        cur.peakAbsent = absent.length;
        cur.names = absent.map((p) => p.name);
      }
    } else if (cur) {
      // Выходные/праздники внутри периода его не разрывают; рабочий день без конфликта — закрывает
      if (!isWorkday(d, holidays) && gap < 4) { gap++; continue; }
      out.push(cur);
      cur = null;
      gap = 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ─────────────────────────────── Выводы для руководителя

export interface PlanningStatus {
  id: number;
  name: string;
  available: number; // остаток − дни на согласовании
  planned: number; // согласовано + на согласовании в году
  hasStretch: boolean;
}

export function planningStatus(p: Person, year: number, holidays: ReadonlySet<string>): PlanningStatus {
  const clip = (v: Span): Interval => ({ start: v.start < `${year}-01-01` ? `${year}-01-01` : v.start, end: v.end > `${year}-12-31` ? `${year}-12-31` : v.end });
  const inYear = p.vacations.filter((v) => (v.type ?? 'vacation') === 'vacation' && v.start <= `${year}-12-31` && v.end >= `${year}-01-01`);
  const b = computeBalance({
    plannedDays: p.plannedDays, carryOver: p.carryOver,
    approved: inYear.filter((v) => v.status === 'approved').map(clip),
    pending: inYear.filter((v) => v.status === 'pending').map(clip),
    holidays,
  });
  return { id: p.id, name: p.name, available: round2(b.remaining - b.pending), planned: b.used + b.pending, hasStretch: b.hasFourteenDayStretch };
}

export type Severity = 'danger' | 'warning' | 'info' | 'success';

export interface Insight {
  severity: Severity;
  title: string;
  text: string;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const fmt = (iso: string) => `${Number(iso.slice(8))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;
const fmtNum = (n: number) => String(round2(n)).replace('.', ',');

/**
 * Выводы по отделу: конфликтные периоды, перегруженные месяцы, нераспределённые дни,
 * нарушение части в 14 дней, малочисленный отдел. today — дата расчёта (для «до конца года»).
 */
export function insightsFor(
  dept: string, people: Person[], year: number, threshold: number, holidays: ReadonlySet<string>, today: string,
): Insight[] {
  const out: Insight[] = [];
  const staff = people.filter((p) => p.empType !== 'ipsz');
  const conflicts = conflictPeriods(people, year, threshold, holidays).filter((c) => c.end >= today);
  for (const c of conflicts.slice(0, 3)) {
    out.push({
      severity: 'danger',
      title: `${fmt(c.start)}${c.start !== c.end ? ` – ${fmt(c.end)}` : ''}: в отпуске ${pct(c.peakRatio)} отдела`,
      text: `Выше порога ${pct(threshold)}: ${c.names.slice(0, 4).join(', ')}${c.names.length > 4 ? ` и ещё ${c.names.length - 4}` : ''}. Проверьте замещение или предложите перенос.`,
    });
  }

  const load = monthlyLoad(people, year, holidays, true).filter((m) => `${year}-${String(m.month).padStart(2, '0')}-31` >= today);
  const busiest = [...load].sort((a, b) => b.avgRatio - a.avgRatio)[0];
  const calmest = [...load].sort((a, b) => a.avgRatio - b.avgRatio)[0];
  if (busiest && busiest.avgRatio >= threshold * 0.6 && busiest.avgRatio > 0) {
    out.push({
      severity: 'warning',
      title: `Пиковый месяц — ${MONTHS_NOM[busiest.month - 1]}`,
      text: `В среднем отсутствует ${pct(busiest.avgRatio)} отдела (с учётом заявок на согласовании). Новые отпуска лучше планировать на ${MONTHS_NOM[calmest.month - 1]} — там ${pct(calmest.avgRatio)}.`,
    });
  }

  const statuses = staff.map((p) => planningStatus(p, year, holidays));
  const daysLeft = Math.max(0, calendarDays(today, `${year}-12-31`));
  const unplanned = statuses.filter((s) => s.available >= 7);
  if (unplanned.length) {
    const total = unplanned.reduce((n, s) => n + s.available, 0);
    out.push({
      severity: daysLeft < 90 ? 'warning' : 'info',
      title: `${unplanned.length} из ${staff.length} не распределили отпуск`,
      text: `Не запланировано ${fmtNum(total)} дн.; до конца года ${daysLeft} дн. Больше всего — ${unplanned.sort((a, b) => b.available - a.available).slice(0, 3).map((s) => `${s.name.split(' ')[0]} (${fmtNum(s.available)})`).join(', ')}.`,
    });
  }

  const noStretch = statuses.filter((s) => !s.hasStretch && s.planned > 0);
  if (noStretch.length) {
    out.push({
      severity: 'warning',
      title: `${noStretch.length} без части отпуска в 14 дней`,
      text: `ТК РФ, ст. 125: одна из частей должна быть не короче 14 календарных дней. Сотрудники: ${noStretch.slice(0, 4).map((s) => s.name.split(' ')[0]).join(', ')}${noStretch.length > 4 ? '…' : ''}.`,
    });
  }

  if (people.length > 0 && people.length <= 3) {
    out.push({
      severity: 'info',
      title: 'Малочисленный отдел',
      text: `В «${dept}» ${people.length} чел.: отпуск одного — уже ${pct(1 / people.length)} отдела. Договоритесь о взаимном замещении заранее.`,
    });
  }

  if (!out.length) {
    out.push({ severity: 'success', title: 'Покрытие отдела в норме', text: 'Конфликтов выше порога нет, отпуска распределены равномерно.' });
  }
  return out;
}

// ─────────────────────────────── Подбор окон отпуска

export interface SuggestInput {
  person: Person;
  colleagues: Person[]; // отдел без самого сотрудника
  length: number; // дней отпуска (без праздников)
  from: string; // самая ранняя дата начала
  to: string; // самая поздняя дата окончания
  holidays: ReadonlySet<string>;
  threshold: number;
  limit?: number;
}

export interface Suggestion {
  start: string;
  end: string;
  vacationDays: number;
  calendarDays: number;
  holidays: number;
  maxRatio: number; // доля отдела в отпуске с учётом сотрудника
  avgRatio: number;
  overlapWith: string[];
  score: number;
  reasons: string[];
}

/** Конец окна: столько дней, чтобы без праздников набралось length дней отпуска. */
export function windowEnd(start: string, length: number, holidays: ReadonlySet<string>): string {
  let end = start;
  let counted = holidays.has(start) ? 0 : 1;
  while (counted < length) {
    end = addDays(end, 1);
    if (!holidays.has(end)) counted++;
  }
  return end;
}

/**
 * Лучшие окна для отпуска заданной длины. Оценка: ниже нагрузка на отдел — лучше, превышение
 * порога исключает окно; праздники внутри дают бонус (отдых длиннее без затрат дней), старт в
 * понедельник — небольшой бонус. Окна выбираются жадно без взаимных пересечений.
 */
export function suggestWindows(input: SuggestInput): Suggestion[] {
  const { person, colleagues, length, holidays, threshold } = input;
  const team = colleagues.length + 1;
  const own = person.vacations;
  const candidates: Suggestion[] = [];
  for (let start = input.from; start <= input.to; start = addDays(start, 1)) {
    if (holidays.has(start)) continue; // начинать отпуск в праздник бессмысленно
    const end = windowEnd(start, length, holidays);
    if (end > input.to) break;
    if (own.some((v) => v.start <= end && start <= v.end)) continue;
    const days = eachDay(start, end);
    let maxRatio = 0;
    let sum = 0;
    const overlap = new Set<string>();
    for (const d of days) {
      const away = colleagues.filter((c) => absentOn(c, d, true));
      away.forEach((c) => overlap.add(c.name));
      const ratio = (away.length + 1) / team;
      sum += ratio;
      if (ratio > maxRatio) maxRatio = ratio;
    }
    // Порог касается коллег: одиночка или отдел из двух не блокируются полностью
    if (team >= 3 && maxRatio >= threshold) continue;
    const avgRatio = sum / days.length;
    const hol = days.filter((d) => holidays.has(d)).length;
    const monday = weekday(start) === 1;
    const score = round2(100 - 55 * avgRatio - 35 * maxRatio + 8 * hol + (monday ? 4 : 0) - overlap.size * 2);
    const reasons: string[] = [];
    reasons.push(overlap.size
      ? `пересечение с ${overlap.size} ${overlap.size === 1 ? 'коллегой' : 'коллегами'}, максимум ${pct(maxRatio)} отдела`
      : 'никто из отдела не в отпуске');
    if (hol) reasons.push(`${hol} ${hol === 1 ? 'праздник' : hol < 5 ? 'праздника' : 'праздников'} внутри — отдых ${days.length} дн. за ${length} дн. отпуска`);
    if (monday) reasons.push('начинается в понедельник');
    candidates.push({
      start, end, vacationDays: length, calendarDays: days.length, holidays: hol,
      maxRatio: round2(maxRatio), avgRatio: round2(avgRatio), overlapWith: [...overlap], score, reasons,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.start.localeCompare(b.start));
  const picked: Suggestion[] = [];
  for (const c of candidates) {
    // Разнообразие: не предлагаем почти одно и то же окно со сдвигом на день
    if (picked.some((p) => Math.abs(Date.parse(p.start) - Date.parse(c.start)) < 10 * DAY)) continue;
    picked.push(c);
    if (picked.length >= (input.limit ?? 5)) break;
  }
  return picked;
}

// ─────────────────────────────── Сегодня: офис / удалёнка / отпуск

export type DayStatus = 'vacation' | 'office' | 'remote' | 'off';

export function dayStatus(
  p: Person, iso: string, pattern: Record<number, string>, overrides: Record<string, string>, holidays: ReadonlySet<string>,
): DayStatus {
  if (absentOn(p, iso)) return 'vacation';
  const o = overrides[iso];
  if (o === 'office' || o === 'remote' || o === 'off') return o;
  if (!isWorkday(iso, holidays)) return 'off';
  const m = pattern[weekday(iso)];
  return m === 'remote' || m === 'off' ? m : 'office';
}
