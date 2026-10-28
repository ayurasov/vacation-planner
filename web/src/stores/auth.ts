// Сессия: access-токен в памяти, восстановление сессии по refresh-cookie.
import { defineStore } from 'pinia';
import { api, setAccess, type Me } from '@/api/client';

interface AuthState {
  me: Me | null;
  loading: boolean;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({ me: null, loading: true }),

  getters: {
    isLoggedIn: (s) => s.me !== null,
    isAdmin: (s) => s.me?.permissions.isAdmin ?? false,
    /** Кадровые разделы: администратор или кадровая служба. */
    isStaff: (s) => s.me?.permissions.manageStaff ?? false,
    isApprover: (s) => (s.me?.permissions.approveSubordinates.length ?? 0) > 0,
    displayName: (s) => {
      const name = s.me?.employee.name ?? '';
      const parts = name.split(' ');
      return parts.length >= 2 ? `${parts[0]} ${parts[1][0]}.` : name || '—';
    },
  },

  actions: {
    async login(login: string, password: string): Promise<void> {
      const data = await api.post<{ accessToken: string; expiresAt: string; user: Me }>('/auth/login', {
        login,
        password,
      });
      setAccess(data.accessToken, data.expiresAt);
      this.me = data.user;
    },

    /** Попытка тихого восстановления сессии по httpOnly refresh-cookie. */
    async restore(): Promise<void> {
      try {
        this.me = await api.get<Me>('/auth/me');
      } catch {
        this.me = null;
      } finally {
        this.loading = false;
      }
    },

    async logout(): Promise<void> {
      try {
        await api.post('/auth/logout');
      } finally {
        setAccess(null);
        this.me = null;
      }
    },
  },
});
