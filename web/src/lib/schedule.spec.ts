import { describe, expect, it } from 'vitest';
import { barsForYear, conflictDatesFor, isAbsent, segments } from './schedule';

const v = (requestId: number, start: string, end: string, status = 'approved') => ({ requestId, start, end, status, type: 'vacation' });

describe('полосы графика', () => {
  it('обрезаются по границам года и сортируются', () => {
    const bars = barsForYear(2026, [v(2, '2026-07-01', '2026-07-14'), v(1, '2025-12-29', '2026-01-04')]);
    expect(bars.map((b) => [b.requestId, b.first, b.days])).toEqual([[1, 0, 4], [2, 181, 14]]);
  });

  it('периоды вне года отбрасываются', () => {
    expect(barsForYear(2026, [v(1, '2027-01-05', '2027-01-10')])).toEqual([]);
  });
});

describe('отрезки и конфликты', () => {
  it('даты сжимаются в непрерывные отрезки', () => {
    expect(segments(2026, ['2026-01-03', '2026-01-01', '2026-01-02', '2026-01-10'])).toEqual([
      { first: 0, days: 3 }, { first: 9, days: 1 },
    ]);
  });

  it('конфликтные даты — только согласованные дни внутри конфликтов отдела', () => {
    const conflicts = new Set(['2026-07-02', '2026-07-03', '2026-08-01']);
    const days = conflictDatesFor([v(1, '2026-07-01', '2026-07-05'), v(2, '2026-08-01', '2026-08-02', 'pending')], conflicts);
    expect(days).toEqual(['2026-07-02', '2026-07-03']);
  });

  it('отсутствие на дату учитывает только согласованные отпуска', () => {
    const list = [v(1, '2026-07-01', '2026-07-05'), v(2, '2026-08-01', '2026-08-02', 'pending')];
    expect(isAbsent(list, '2026-07-05')).toBe(true);
    expect(isAbsent(list, '2026-08-01')).toBe(false);
  });
});
