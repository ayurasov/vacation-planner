// Модульные тесты чистых функций баланса (без БД): ТК РФ ст. 120 и ст. 125.
import { describe, expect, it } from 'vitest';
import { calendarDays, computeBalance, overlaps, vacationDays } from '../src/requests/balance';

const MAY_HOLIDAYS = new Set(['2026-05-01', '2026-05-09', '2026-05-11']);

describe('дни отпуска', () => {
  it('календарные дни включают обе границы', () => {
    expect(calendarDays('2026-07-01', '2026-07-14')).toBe(14);
    expect(calendarDays('2026-12-31', '2027-01-01')).toBe(2);
  });

  it('праздники внутри отпуска не входят в дни отпуска', () => {
    expect(vacationDays('2026-05-01', '2026-05-14', MAY_HOLIDAYS)).toBe(11);
    expect(vacationDays('2026-05-01', '2026-05-14')).toBe(14);
  });

  it('пересечение периодов — включительно', () => {
    expect(overlaps({ start: '2026-07-01', end: '2026-07-10' }, { start: '2026-07-10', end: '2026-07-20' })).toBe(true);
    expect(overlaps({ start: '2026-07-01', end: '2026-07-09' }, { start: '2026-07-10', end: '2026-07-20' })).toBe(false);
  });
});

describe('баланс', () => {
  it('остаток = норма + перенос − согласованные дни без праздников', () => {
    const b = computeBalance({
      plannedDays: 28, carryOver: 2,
      approved: [{ start: '2026-05-01', end: '2026-05-14' }],
      pending: [{ start: '2026-08-03', end: '2026-08-09' }],
      holidays: MAY_HOLIDAYS,
    });
    expect(b).toMatchObject({ entitlement: 30, used: 11, pending: 7, remaining: 19, hasFourteenDayStretch: true });
  });

  it('пересекающиеся периоды не считаются дважды', () => {
    const b = computeBalance({
      plannedDays: 28, carryOver: 0,
      approved: [{ start: '2026-07-01', end: '2026-07-10' }, { start: '2026-07-05', end: '2026-07-12' }],
      pending: [],
    });
    expect(b.used).toBe(12);
  });

  it('дробная норма округляется до сотых', () => {
    const b = computeBalance({ plannedDays: 28, carryOver: 9.33, approved: [{ start: '2026-03-02', end: '2026-03-29' }], pending: [] });
    expect(b.remaining).toBe(9.33);
  });

  it('без части в 14 дней подряд — флаг ст. 125 снят', () => {
    const b = computeBalance({
      plannedDays: 28, carryOver: 0,
      approved: [{ start: '2026-02-02', end: '2026-02-08' }, { start: '2026-06-01', end: '2026-06-07' }],
      pending: [],
    });
    expect(b.hasFourteenDayStretch).toBe(false);
  });
});
