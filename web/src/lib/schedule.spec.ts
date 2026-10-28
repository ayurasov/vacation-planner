import { describe, expect, it } from 'vitest';
import { absentPerDay, barsForYear, conflictDatesFor, isAbsent, segments, virtualWindow } from './schedule';

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

describe('виртуальный список графика', () => {
  // группа 36 px, строки 40 px: [0 группа][36 р][76 р][116 р][156 группа][192 р]
  const offsets = [0, 36, 76, 116, 156, 192];
  const total = 232;

  it('рисует только видимое и запас; отступы сохраняют высоту', () => {
    const w = virtualWindow(offsets, total, 80, 60, 0);
    expect([w.start, w.end]).toEqual([2, 4]); // строки 76–116 и 116–156 пересекают окно 80–140
    expect(w.padTop).toBe(76);
    expect(w.padBottom).toBe(total - 156);
  });

  it('запас ограничен краями списка', () => {
    expect(virtualWindow(offsets, total, 0, 50, 8)).toEqual({ start: 0, end: 6, padTop: 0, padBottom: 0 });
    expect(virtualWindow([], 0, 0, 100)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it('прокрутка в конец показывает последнюю строку', () => {
    const w = virtualWindow(offsets, total, 200, 100, 0);
    expect(w.end).toBe(6);
    expect(w.padBottom).toBe(0);
  });
});

describe('отсутствующие по дням', () => {
  it('считает согласованные отпуска, обрезает по году, на согласовании не учитывает', () => {
    const v = (start: string, end: string, status = 'approved') => ({ requestId: 1, start, end, type: 'vacation', status });
    const counts = absentPerDay(2027, [
      { vacations: [v('2027-01-01', '2027-01-03')] },
      { vacations: [v('2027-01-03', '2027-01-04'), v('2027-01-02', '2027-01-02', 'pending')] },
      { vacations: [v('2026-12-30', '2027-01-01')] },
    ]);
    expect(Array.from(counts.slice(0, 5))).toEqual([2, 1, 2, 1, 0]);
    expect(counts.length).toBe(365);
  });
});
