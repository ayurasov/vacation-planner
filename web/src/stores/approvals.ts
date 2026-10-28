// Счётчик заявок, ожидающих решения пользователя (бейдж в меню).
import { defineStore } from 'pinia';
import { api, type Page, type VacationRequest } from '@/api/client';

export const useApprovalsStore = defineStore('approvals', {
  state: () => ({ pending: 0 }),
  actions: {
    /** Администратор согласует заявки всей организации, руководитель — прямых подчинённых. */
    scope(isAdmin: boolean): 'all' | 'subordinates' {
      return isAdmin ? 'all' : 'subordinates';
    },
    async refresh(isAdmin: boolean): Promise<void> {
      try {
        const page = await api.get<Page<VacationRequest>>(
          `/vacation-requests?scope=${this.scope(isAdmin)}&status=pending&per_page=1`,
        );
        this.pending = page.meta.total;
      } catch {
        /* бейдж необязателен */
      }
    },
  },
});
