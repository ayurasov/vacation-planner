// Производственный календарь: праздники и переносы по годам (публичный эндпоинт), кэш на сессию.
import { defineStore } from 'pinia';
import { api, ApiError } from '@/api/client';
import { workCalendar, type Transfer, type WorkCalendar } from '@/lib/calendar';

interface YearCalendar { holidays: string[]; transfers: Transfer[] }

export const useCalendarStore = defineStore('calendar', {
  state: () => ({ years: {} as Record<number, YearCalendar> }),
  actions: {
    async load(year: number): Promise<YearCalendar> {
      if (!this.years[year]) {
        try {
          const res = await api.get<YearCalendar>(`/calendar/holidays/${year}`);
          this.years[year] = { holidays: res.holidays, transfers: res.transfers ?? [] };
        } catch (e) {
          const empty = { holidays: [], transfers: [] };
          // Календарь года не загружен (4xx) — только выходные до конца сеанса; сбой сети или 503
          // не кэшируется, иначе праздники пропадали до следующего входа
          if (e instanceof ApiError && e.status < 500) this.years[year] = empty;
          else return empty;
        }
      }
      return this.years[year];
    },

    /** Праздники ст. 112 ТК РФ: не входят в дни отпуска. */
    async holidays(year: number): Promise<Set<string>> {
      return new Set((await this.load(year)).holidays);
    },

    /** Праздники, перенесённые выходные и рабочие субботы — для фона графиков. */
    async workCalendar(year: number): Promise<WorkCalendar> {
      const c = await this.load(year);
      return workCalendar(c.holidays, c.transfers);
    },
  },
});
