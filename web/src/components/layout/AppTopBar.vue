<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useNotificationsStore } from '@/stores/notifications';
import { useTheme } from '@/composables/useTheme';
import AppIcon from '@/components/common/AppIcon.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import NotificationsPanel from './NotificationsPanel.vue';

const emit = defineEmits<{ openMenu: [] }>();
const route = useRoute();
const auth = useAuthStore();
const notifications = useNotificationsStore();
const theme = useTheme();
const notifOpen = ref(false);

const title = computed(() => (route.meta.title as string | undefined) ?? '');
const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const themeIcon = computed(() => (theme.choice.value === 'system' ? 'monitor' : theme.choice.value === 'dark' ? 'moon' : 'sun'));
const themeTitle = computed(() => ({ system: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' })[theme.choice.value]);
const roleLabel = computed(() => (auth.isAdmin ? 'Администратор' : auth.isApprover ? 'Руководитель' : 'Сотрудник'));
</script>

<template>
  <header class="topbar">
    <button
      class="btn btn-icon btn-ghost mobile-trigger"
      type="button"
      aria-label="Открыть меню"
      @click="emit('openMenu')"
    >
      <AppIcon
        name="menu"
        :size="18"
      />
    </button>
    <div class="topbar-title">
      <h1
        class="page-title"
        :title="title"
      >
        {{ title }}
      </h1>
      <span class="topbar-date">{{ today }}</span>
    </div>

    <div class="topbar-actions">
      <button
        class="icon-btn"
        type="button"
        :title="themeTitle"
        :aria-label="themeTitle"
        @click="theme.cycle()"
      >
        <AppIcon
          :name="themeIcon"
          :size="17"
        />
      </button>
      <div class="notif-wrap">
        <button
          class="icon-btn"
          type="button"
          title="Уведомления"
          aria-label="Уведомления"
          :aria-expanded="notifOpen"
          @click.stop="notifOpen = !notifOpen"
        >
          <AppIcon
            name="bell"
            :size="17"
          />
          <span
            v-if="notifications.unread"
            class="notif-dot"
          >{{ notifications.unread > 9 ? '9+' : notifications.unread }}</span>
        </button>
        <NotificationsPanel
          v-if="notifOpen"
          @close="notifOpen = false"
        />
      </div>
      <router-link
        to="/settings"
        class="current-user"
        title="Профиль и настройки"
      >
        <UserAvatar
          :name="auth.me?.employee.name ?? '?'"
          :size="30"
        />
        <span class="current-user-text hide-mobile">
          <span class="current-user-name">{{ auth.displayName }}</span>
          <span class="current-user-role">{{ roleLabel }}</span>
        </span>
      </router-link>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--topbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 24px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.topbar-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.page-title {
  font-size: 15px;
  font-weight: 650;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-date {
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.topbar-date::first-letter {
  text-transform: uppercase;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  position: relative;
  width: 34px;
  height: 34px;
  border: none;
  background: none;
  border-radius: 8px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--color-hover);
  color: var(--color-text);
}

.notif-wrap {
  position: relative;
}

.notif-dot {
  position: absolute;
  top: 3px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--color-danger-fill);
  color: #fff;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  border: 2px solid var(--color-surface);
  box-sizing: content-box;
  transform: translate(25%, -25%);
}

.current-user {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 3px 10px 3px 3px;
  border-radius: 22px;
  color: var(--color-text);
  margin-left: 4px;
}

.current-user:hover {
  background: var(--color-hover);
}

.current-user-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.current-user-name {
  font-size: 13px;
  font-weight: 600;
}

.current-user-role {
  font-size: 11px;
  color: var(--color-text-muted);
}

.mobile-trigger {
  display: none;
}

@media (max-width: 900px) {
  .topbar {
    padding: 0 12px;
    gap: 8px;
  }

  .mobile-trigger {
    display: inline-flex;
  }

  .current-user {
    padding: 3px;
  }
}
</style>
