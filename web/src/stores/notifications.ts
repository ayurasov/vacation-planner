// Уведомления пользователя: обновляются по потоку событий сервера; опрос раз в 30 секунд —
// только пока поток недоступен (5000 вкладок с опросом — ~170 запросов/с впустую).
// Событие несёт число непрочитанных — для значка колокольчика запрос не нужен; список читается,
// когда панель открыта или открывается. До v1.0.0 каждое событие перечитывало список во всех
// вкладках сразу: приглашение кампании на 2000 сотрудников давало 715 запросов за секунду и p95
// чтения 2–10 с на 1 vCPU (docs/performance/report-v1.0.0.md, узкое место 5).
import { defineStore } from 'pinia';
import { api, type Notification, type Page } from '@/api/client';

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    items: [] as Notification[],
    timer: 0 as number | 0,
    /** Непрочитанных — по событию сервера или по прочитанному списку. */
    count: 0,
    /** Список отстал от события: перечитать при открытии панели. */
    stale: false,
    /** Панель открыта: событие перечитывает список сразу. */
    panelOpen: false,
  }),
  getters: {
    unread: (s) => s.count,
  },
  actions: {
    async load(): Promise<void> {
      try {
        const page = await api.get<Page<Notification>>('/notifications?per_page=30');
        this.items = page.items;
        this.count = page.items.filter((n) => !n.isRead).length;
        this.stale = false;
      } catch {
        /* тихо: следующая попытка по таймеру */
      }
    },
    /** Событие потока: число непрочитанных (hello, notifications); список — только для открытой панели. */
    update(unread: number): void {
      this.count = unread;
      this.stale = true;
      if (this.panelOpen) void this.load();
    },
    /** Панель открыта или закрыта; при открытии отставший список перечитывается. */
    setPanel(open: boolean): void {
      this.panelOpen = open;
      if (open && (this.stale || !this.items.length)) void this.load();
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
      this.count = 0;
      this.stale = false;
    },
    async markRead(id: number): Promise<void> {
      const n = this.items.find((x) => x.id === id);
      if (!n || n.isRead) return;
      n.isRead = true;
      this.count = Math.max(0, this.count - 1);
      await api.post(`/notifications/${id}/read`).catch(() => { n.isRead = false; this.count += 1; });
    },
    async markAllRead(): Promise<void> {
      const unread = this.items.filter((n) => !n.isRead);
      const before = this.count;
      unread.forEach((n) => { n.isRead = true; });
      this.count = 0;
      // Один запрос на все (с v0.5.0), а не по запросу на уведомление
      await api.post('/notifications/read-all').catch(() => { unread.forEach((n) => { n.isRead = false; }); this.count = before; });
    },
  },
});
