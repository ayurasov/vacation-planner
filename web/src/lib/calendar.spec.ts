import { describe, expect, it } from 'vitest';
import { isDayOff, parseCalendarFile, toggleHoliday, workCalendar } from './calendar';

describe('файл производственного календаря', () => {
  it('xmlcalendar: праздники по h, переносы по f, рабочие субботы и сокращённые дни пропускаются', () => {
    const xml = `<?xml version="1.0"?><calendar year="2027" lang="ru">
      <holidays><holiday id="1" title="Новогодние каникулы"/></holidays>
      <days>
        <day d="01.01" t="1" h="1"/><day d="01.02" t="1" h="1"/>
        <day d="01.08" t="1" f="01.02"/>
        <day d="02.22" t="2"/>
        <day d="11.13" t="3"/>
      </days></calendar>`;
    const r = parseCalendarFile(xml, 2027);
    expect(r.format).toBe('xmlcalendar');
    expect(r.holidays).toEqual(['2027-01-01', '2027-01-02']);
    expect(r.transfers).toEqual([{ from: '2027-01-02', to: '2027-01-08' }]);
    expect(r.skipped).toBe(0);
  });

  it('xmlcalendar другого года не применяется', () => {
    const r = parseCalendarFile('<calendar year="2026"><days><day d="01.01" t="1" h="1"/></days></calendar>', 2027);
    expect(r.holidays).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it('текст и CSV: одна дата — праздник, две — перенос; форматы ISO и ДД.ММ.ГГГГ', () => {
    const r = parseCalendarFile([
      'дата;название',
      '2027-01-01;Новый год',
      '07.01.2027;Рождество',
      '07.01.2027;повтор',
      '02.01.2027 → 08.01.2027;перенос',
      '2026-12-31;другой год',
      '31.02.2027;нет такой даты',
    ].join('\n'), 2027);
    expect(r.format).toBe('text');
    expect(r.holidays).toEqual(['2027-01-01', '2027-01-07']);
    expect(r.transfers).toEqual([{ from: '2027-01-02', to: '2027-01-08' }]);
    expect(r.skipped).toBe(2);
  });

  it('переключение праздника сохраняет порядок', () => {
    expect(toggleHoliday(['2027-05-09'], '2027-01-01')).toEqual(['2027-01-01', '2027-05-09']);
    expect(toggleHoliday(['2027-01-01', '2027-05-09'], '2027-01-01')).toEqual(['2027-05-09']);
  });
});

describe('рабочий календарь', () => {
  it('перенесённый выходной — нерабочий, рабочая суббота — рабочая, праздник в выходной остаётся выходным', () => {
    const cal = workCalendar(['2026-05-09'], [{ from: '2026-05-09', to: '2026-05-11' }, { from: '2027-11-13', to: '2027-11-05' }]);
    expect(isDayOff('2026-05-11', cal)).toBe(true);
    expect(isDayOff('2026-05-09', cal)).toBe(true);
    expect(isDayOff('2027-11-13', cal)).toBe(false);
    expect(isDayOff('2026-05-12', cal)).toBe(false);
  });
});
