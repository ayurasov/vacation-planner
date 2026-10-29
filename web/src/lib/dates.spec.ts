import { describe, expect, it } from 'vitest';
import {
  addDays, calendarDays, dayIndex, daysInYear, fmtDateTime, fmtDays, fmtNumber, fmtRange, holidaysIn, isWeekend, monthsOf, plural,
  relativeToToday, vacationDays,
} from './dates';

describe('арифметика дат', () => {
  it('сложение дней через границу года', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('календарные дни и индекс дня в году', () => {
    expect(calendarDays('2026-07-01', '2026-07-14')).toBe(14);
    expect(dayIndex(2026, '2026-01-01')).toBe(0);
    expect(dayIndex(2026, '2026-12-31')).toBe(364);
    expect(daysInYear(2028)).toBe(366);
  });

  it('выходные', () => {
    expect(isWeekend('2026-10-31')).toBe(true); // суббота
    expect(isWeekend('2026-10-28')).toBe(false); // среда
  });

  it('месяцы года с правильными смещениями', () => {
    const m = monthsOf(2026);
    expect(m).toHaveLength(12);
    expect(m[1]).toMatchObject({ days: 28, offset: 31 });
    expect(m[11].offset + m[11].days).toBe(365);
  });
});

describe('дни отпуска (ТК РФ ст. 120)', () => {
  const H = new Set(['2026-05-01', '2026-05-09', '2026-05-11']);
  it('праздники не входят в дни отпуска', () => {
    expect(vacationDays('2026-05-01', '2026-05-14', H)).toBe(11);
    expect(holidaysIn('2026-05-01', '2026-05-14', H)).toEqual(['2026-05-01', '2026-05-09', '2026-05-11']);
  });
  it('без календаря — календарные дни', () => {
    expect(vacationDays('2026-05-01', '2026-05-14')).toBe(14);
  });
});

describe('форматирование', () => {
  it('момент времени: без года в текущем году, с годом — в другом', () => {
    const now = new Date(2026, 9, 29, 12, 0);
    expect(fmtDateTime(new Date(2026, 9, 28, 10, 12).toISOString(), now)).toMatch(/^28 окт\.?,? 10:12$/);
    expect(fmtDateTime(new Date(2025, 9, 28, 10, 12).toISOString(), now)).toMatch(/2025/);
  });

  it('склонения', () => {
    expect(plural(1, ['день', 'дня', 'дней'])).toBe('день');
    expect(plural(3, ['день', 'дня', 'дней'])).toBe('дня');
    expect(plural(11, ['день', 'дня', 'дней'])).toBe('дней');
    expect(plural(22, ['день', 'дня', 'дней'])).toBe('дня');
    expect(plural(9.33, ['день', 'дня', 'дней'])).toBe('дня');
  });
  it('дробные дни без хвоста 9.329999…', () => {
    expect(fmtNumber(9.329999999999998)).toBe('9,33');
    expect(fmtDays(28)).toBe('28 дней');
  });
  it('периоды', () => {
    expect(fmtRange('2026-09-14', '2026-09-20')).toBe('14–20 сентября 2026');
    expect(fmtRange('2026-09-28', '2026-10-04')).toBe('28 сентября – 4 октября 2026');
    expect(fmtRange('2026-12-28', '2027-01-10')).toBe('28 декабря 2026 – 10 января 2027');
  });
  it('относительно сегодня', () => {
    expect(relativeToToday('2026-11-01', '2026-11-07', '2026-10-28')).toBe('через 4 дня');
    expect(relativeToToday('2026-10-29', '2026-11-07', '2026-10-28')).toBe('завтра');
    expect(relativeToToday('2026-10-20', '2026-11-07', '2026-10-28')).toBe('идёт сейчас');
    expect(relativeToToday('2026-10-01', '2026-10-07', '2026-10-28')).toBe('завершён');
  });
});
