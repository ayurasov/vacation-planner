// Счётчик заявок, ожидающих решения пользователя (бейдж в меню).
import { defineStore } from 'pinia';
import { api, type Page, type VacationRequest } from '@/api/client';

export const useApprovalsStore = defineStore('approvals', {
  state: () => ({ pending: 0 }),
  actions: {
    /**
     * Администратор согласует заявки всей организации; остальные — ждущие их решения: подчинённые
     * и сотрудники руководимого отдела без руководителя, команда замещаемого, эскалированные (v0.6.0).
     */
    scope(isAdmin: boolean): 'all' | 'approvals' {
      return isAdmin ? 'all' : 'approvals';
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
