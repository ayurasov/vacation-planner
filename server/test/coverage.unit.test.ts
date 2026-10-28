// Модульные тесты аналитики пересечений (чистые функции, без БД).
import { describe, expect, it } from 'vitest';
import {
  conflictPeriods, dayStatus, insightsFor, monthlyLoad, planningStatus, suggestWindows, windowEnd, type Person,
} from '../src/analytics/coverage';

const person = (id: number, name: string, vacations: Person['vacations'] = [], extra: Partial<Person> = {}): Person => ({
  id, name, dept: 'Отдел', plannedDays: 28, carryOver: 0, empType: 'staff', vacations, ...extra,
});
const approved = (start: string, end: string) => ({ start, end, status: 'approved' as const });
const NONE = new Set<string>();

describe('нагрузка и конфликты отдела', () => {
  const team = [
    person(1, 'Анна', [approved('2027-07-05', '2027-07-18')]),
    person(2, 'Борис', [approved('2027-07-12', '2027-07-25')]),
    person(3, 'Вера'),
    person(4, 'Глеб'),
  ];

  it('конфликт — дни, когда в отпуске ≥ порога отдела; выходные не разрывают период', () => {
    const c = conflictPeriods(team, 2027, 0.5, NONE);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ start: '2027-07-12', end: '2027-07-18', peakRatio: 0.5, peakAbsent: 2 });
    expect(c[0].names).toEqual(['Анна', 'Борис']);
  });

  it('месячная нагрузка считает только рабочие дни', () => {
    const july = monthlyLoad(team, 2027, NONE)[6];
    expect(july.peakRatio).toBe(0.5);
    expect(july.avgRatio).toBeGreaterThan(0);
    expect(monthlyLoad(team, 2027, NONE)[0].avgRatio).toBe(0);
  });

  it('у отдела из одного человека конфликтов нет', () => {
    expect(conflictPeriods([team[0]], 2027, 0.5, NONE)).toEqual([]);
  });
});

describe('выводы для руководителя', () => {
  it('сообщает о нераспределённых днях и отсутствии части в 14 дней', () => {
    const team = [
      person(1, 'Анна Иванова', [approved('2027-02-01', '2027-02-07')]),
      person(2, 'Борис Петров'),
      person(3, 'Вера Сидорова', [approved('2027-03-01', '2027-03-28')]),
      person(4, 'Глеб Орлов', [approved('2027-04-05', '2027-04-18')]),
    ];
    const titles = insightsFor('Отдел', team, 2027, 0.5, NONE, '2027-01-10').map((i) => i.title);
    expect(titles.some((t) => t.includes('не распределили отпуск'))).toBe(true);
    expect(titles.some((t) => t.includes('без части отпуска в 14 дней'))).toBe(true);
  });

  it('распределение дней учитывает праздники', () => {
    const p = person(1, 'Анна', [approved('2027-05-01', '2027-05-14')]);
    const s = planningStatus(p, 2027, new Set(['2027-05-01', '2027-05-09']));
    expect(s.planned).toBe(12);
    expect(s.available).toBe(16);
  });
});

describe('подбор окон отпуска', () => {
  it('окно продлевается на праздники', () => {
    expect(windowEnd('2027-05-03', 7, new Set(['2027-05-09']))).toBe('2027-05-10');
  });

  it('не предлагает окна с превышением порога и пересечением со своими отпусками', () => {
    const me = person(1, 'Я', [approved('2027-08-02', '2027-08-15')]);
    const others = [
      person(2, 'Коллега 1', [approved('2027-06-01', '2027-06-30')]),
      person(3, 'Коллега 2', [approved('2027-06-01', '2027-06-30')]),
      person(4, 'Коллега 3'),
    ];
    const items = suggestWindows({ person: me, colleagues: others, length: 7, from: '2027-06-01', to: '2027-09-30', holidays: NONE, threshold: 0.5 });
    expect(items.length).toBeGreaterThan(0);
    for (const s of items) {
      expect(s.start > '2027-06-30' || s.end < '2027-06-01').toBe(true); // июнь занят двумя коллегами — 75% с сотрудником
      expect(s.end < '2027-08-02' || s.start > '2027-08-15').toBe(true);
      expect(s.maxRatio).toBeLessThan(0.5);
    }
  });

  it('предпочитает окна с праздниками и без пересечений, окна не дублируются', () => {
    const me = person(1, 'Я');
    const items = suggestWindows({
      person: me, colleagues: [person(2, 'Б'), person(3, 'В')], length: 7,
      from: '2027-05-01', to: '2027-07-31', holidays: new Set(['2027-06-12', '2027-06-14']), threshold: 0.5,
    });
    expect(items[0].holidays).toBeGreaterThan(0);
    expect(items[0].calendarDays).toBeGreaterThan(7);
    const starts = items.map((s) => Date.parse(s.start)).sort();
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(10 * 86400000);
  });
});

describe('статус на дату', () => {
  it('отпуск важнее графика, исключение важнее шаблона, выходной — off', () => {
    const p = person(1, 'Анна', [approved('2027-07-05', '2027-07-09')]);
    expect(dayStatus(p, '2027-07-06', { 2: 'remote' }, {}, NONE)).toBe('vacation');
    expect(dayStatus(p, '2027-07-13', { 2: 'remote' }, {}, NONE)).toBe('remote');
    expect(dayStatus(p, '2027-07-13', { 2: 'remote' }, { '2027-07-13': 'office' }, NONE)).toBe('office');
    expect(dayStatus(p, '2027-07-10', {}, {}, NONE)).toBe('off');
  });
});
