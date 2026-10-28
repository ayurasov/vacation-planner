// Производственный календарь: праздники по годам (публичный эндпоинт), кэш на сессию.
import { defineStore } from 'pinia';
import { api } from '@/api/client';

export const useCalendarStore = defineStore('calendar', {
  state: () => ({ years: {} as Record<number, string[]> }),
  actions: {
    async holidays(year: number): Promise<Set<string>> {
      if (!this.years[year]) {
        try {
          const res = await api.get<{ holidays: string[] }>(`/calendar/holidays/${year}`);
          this.years[year] = res.holidays;
        } catch {
          this.years[year] = []; // календарь года не загружен — считаем без праздников
        }
      }
      return new Set(this.years[year]);
    },
  },
});
