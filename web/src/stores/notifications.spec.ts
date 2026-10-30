import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const get = vi.fn<(path: string) => Promise<unknown>>();
const post = vi.fn<(path: string) => Promise<undefined>>(async () => undefined);
vi.mock('@/api/client', () => ({ api: { get: (path: string) => get(path), post: (path: string) => post(path) } }));

const { useNotificationsStore } = await import('./notifications');

const item = (id: number, isRead = false) => ({ id, kind: 'planning_open', text: `#${id}`, isRead, createdAt: '2026-10-29T10:00:00Z' });

beforeEach(() => {
  setActivePinia(createPinia());
  get.mockReset();
  post.mockClear();
  get.mockResolvedValue({ items: [item(1), item(2), item(3, true)], meta: { total: 3 } });
});

describe('уведомления: событие потока и панель', () => {
  it('событие при закрытой панели меняет значок без запроса к серверу', () => {
    const store = useNotificationsStore();
    store.update(5);
    expect(store.unread).toBe(5);
    expect(get).not.toHaveBeenCalled();
  });

  it('открытие панели после события перечитывает список один раз', async () => {
    const store = useNotificationsStore();
    store.update(2);
    store.setPanel(true);
    await vi.waitFor(() => expect(store.items).toHaveLength(3));
    expect(get).toHaveBeenCalledTimes(1);
    expect(store.unread).toBe(2);
    store.setPanel(false);
    store.setPanel(true); // список свежий — без запроса
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('событие при открытой панели перечитывает список сразу', async () => {
    const store = useNotificationsStore();
    store.setPanel(true);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    store.update(3);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('прочтение уменьшает значок, «прочитать все» обнуляет', async () => {
    const store = useNotificationsStore();
    await store.load();
    expect(store.unread).toBe(2);
    await store.markRead(1);
    expect(store.unread).toBe(1);
    await store.markAllRead();
    expect(store.unread).toBe(0);
    expect(post).toHaveBeenCalledWith('/notifications/read-all');
  });
});
