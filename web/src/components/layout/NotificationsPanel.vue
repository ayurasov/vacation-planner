<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '@/stores/notifications';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';

const emit = defineEmits<{ close: [] }>();
const store = useNotificationsStore();
const router = useRouter();
const root = ref<HTMLElement | null>(null);

/** Раздел уведомления — как ссылка в письме: новая заявка — к согласованию, решение — к своему отпуску. */
const TARGET: Record<string, string> = {
  request_created: '/approvals',
  request_approved: '/my',
  request_rejected: '/my',
  request_cancelled: '/my',
  request_escalated: '/approvals',
  delegation_assigned: '/approvals',
  request_stalled: '/employees',
  account_locked: '/settings',
  password_changed: '/settings',
  vacation_notice: '/my',
  planning_open: '/my',
  planning_reminder: '/my',
};

function open(n: { id: number; kind: string }): void {
  void store.markRead(n.id);
  const to = TARGET[n.kind];
  if (to) void router.push(to);
  emit('close');
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

const KIND_ICON: Record<string, { icon: string; tone: string }> = {
  request_approved: { icon: 'check', tone: 'success' },
  request_rejected: { icon: 'close', tone: 'danger' },
  request_cancelled: { icon: 'trash', tone: 'muted' },
  request_created: { icon: 'approvals', tone: 'info' },
  request_escalated: { icon: 'clock', tone: 'warning' },
  request_stalled: { icon: 'clock', tone: 'warning' },
  delegation_assigned: { icon: 'swap', tone: 'info' },
  account_locked: { icon: 'shield', tone: 'danger' },
  password_changed: { icon: 'shield', tone: 'info' },
  vacation_notice: { icon: 'vacation', tone: 'info' },
  planning_open: { icon: 'schedule', tone: 'info' },
  planning_reminder: { icon: 'schedule', tone: 'warning' },
};

function meta(kind: string) {
  return KIND_ICON[kind] ?? { icon: 'bell', tone: 'info' };
}

function when(ts: string): string {
  const d = new Date(ts);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffMin < 24 * 60) return `${Math.round(diffMin / 60)} ч назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function onDocClick(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) emit('close');
}

onMounted(() => {
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div
    ref="root"
    class="notif-panel card"
    role="dialog"
    aria-label="Уведомления"
  >
    <div class="notif-head">
      <strong>Уведомления</strong>
      <button
        v-if="store.unread"
        class="btn btn-ghost btn-sm"
        type="button"
        @click="store.markAllRead()"
      >
        <AppIcon
          name="check"
          :size="13"
        /> Прочитать все
      </button>
    </div>
    <div class="notif-list scroll-thin">
      <EmptyState
        v-if="!store.items.length"
        icon="bell"
        title="Новых уведомлений нет"
        text="Здесь появятся решения по вашим заявкам и новые заявки подчинённых."
        compact
      />
      <button
        v-for="n in store.items"
        :key="n.id"
        type="button"
        class="notif-item"
        :class="{ unread: !n.isRead }"
        @click="open(n)"
      >
        <span
          class="notif-icon"
          :class="`tone-${meta(n.kind).tone}`"
        >
          <AppIcon
            :name="meta(n.kind).icon"
            :size="14"
          />
        </span>
        <span class="notif-text">
          <span class="notif-body">{{ n.text }}</span>
          <span class="notif-time">{{ when(n.createdAt) }}</span>
        </span>
        <span
          v-if="!n.isRead"
          class="unread-dot"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.notif-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 380px;
  max-width: calc(100vw - 24px);
  box-shadow: var(--shadow-3);
  z-index: 150;
  overflow: hidden;
}

.notif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}

.notif-list {
  max-height: 420px;
  overflow-y: auto;
}

.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 11px 14px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  color: var(--color-text);
  font: inherit;
}

.notif-item:last-child {
  border-bottom: none;
}

.notif-item:hover {
  background: var(--color-row-hover);
}

.notif-item.unread {
  background: color-mix(in srgb, var(--color-primary-soft) 45%, transparent);
}

.notif-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tone-success { background: var(--color-success-soft); color: var(--color-success); }
.tone-danger { background: var(--color-danger-soft); color: var(--color-danger); }
.tone-info { background: var(--color-primary-soft); color: var(--color-primary); }
.tone-muted { background: var(--color-neutral-soft); color: var(--color-text-muted); }

.notif-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.notif-body {
  font-size: 13px;
  line-height: 1.4;
}

.notif-time {
  font-size: 11.5px;
  color: var(--color-text-soft);
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  margin-top: 6px;
  flex-shrink: 0;
}
</style>
