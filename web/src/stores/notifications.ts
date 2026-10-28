// Уведомления пользователя: обновляются по потоку событий сервера; опрос раз в 30 секунд —
// только пока поток недоступен (5000 вкладок с опросом — ~170 запросов/с впустую).
import { defineStore } from 'pinia';
import { api, type Notification, type Page } from '@/api/client';

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({ items: [] as Notification[], timer: 0 as number | 0 }),
  getters: {
    unread: (s) => s.items.filter((n) => !n.isRead).length,
  },
  actions: {
    async load(): Promise<void> {
      try {
        const page = await api.get<Page<Notification>>('/notifications?per_page=30');
        this.items = page.items;
      } catch {
        /* тихо: следующая попытка по таймеру */
      }
    },
    start(): void {
      if (this.timer) return;
      void this.load();
      this.timer = window.setInterval(() => void this.load(), 30000);
    },
    /** Поток событий работает — опрос не нужен; потерян — опрос возобновляется. */
    live(on: boolean): void {
      if (on && this.timer) { window.clearInterval(this.timer); this.timer = 0; }
      if (!on && !this.timer) this.timer = window.setInterval(() => void this.load(), 30000);
    },
    stop(): void {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = 0;
      this.items = [];
    },
    async markRead(id: number): Promise<void> {
      const n = this.items.find((x) => x.id === id);
      if (!n || n.isRead) return;
      n.isRead = true;
      await api.post(`/notifications/${id}/read`).catch(() => { n.isRead = false; });
    },
    async markAllRead(): Promise<void> {
      await Promise.all(this.items.filter((n) => !n.isRead).map((n) => this.markRead(n.id)));
    },
  },
});
