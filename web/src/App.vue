<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api, type Notification } from '@/api/client';

const auth = useAuthStore();
const router = useRouter();
const sidebarOpen = ref(false);
const notifications = ref<Notification[]>([]);

const nav = [
  { section: 'Основное' },
  { path: '/schedule', label: 'График отпусков', icon: '🗓' },
  { path: '/my', label: 'Мой отпуск', icon: '🏖' },
  { section: 'Управление' },
  { path: '/approvals', label: 'Заявки', icon: '✅', needsApprover: true },
  { path: '/employees', label: 'Сотрудники', icon: '👥', admin: true },
  { path: '/directories', label: 'Справочники', icon: '📁', admin: true },
  { path: '/settings', label: 'Настройки', icon: '⚙' },
  { path: '/audit', label: 'Аудит', icon: '📜', admin: true },
];

const unreadCount = () => notifications.value.filter((n) => !n.isRead).length;

async function pollNotifications(): Promise<void> {
  if (!auth.isLoggedIn) return;
  try {
    const page = await api.get<{ items: Notification[] }>('/notifications?per_page=20');
    notifications.value = page.items;
  } catch {
    /* тихо: следующая итерация через 30 с */
  }
}

async function toggleTheme(): Promise<void> {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('vp.theme', next);
}

async function logout(): Promise<void> {
  await auth.logout();
  router.push('/login');
}

onMounted(() => {
  pollNotifications();
  setInterval(pollNotifications, 30000);
});
</script>

<template>
  <div
    v-if="auth.loading"
    class="empty-state"
  >
    Загрузка…
  </div>

  <div
    v-else-if="!auth.isLoggedIn"
    class="anon-area"
  >
    <router-view />
  </div>

  <div
    v-else
    class="app-shell"
  >
    <aside
      class="sidebar scroll-thin"
      :class="{ open: sidebarOpen }"
    >
      <div class="sidebar-logo">
        <span class="logo-dot">VP</span>
        <span>Планировщик<br>отпусков</span>
      </div>
      <template
        v-for="item in nav"
        :key="item.path ?? item.section"
      >
        <div
          v-if="item.section"
          class="nav-section"
        >
          {{ item.section }}
        </div>
        <router-link
          v-else-if="(!item.admin || auth.isAdmin) && (!item.needsApprover || auth.isApprover)"
          class="nav-item"
          :to="item.path ?? '/'"
          :class="{ active: $route.path === item.path }"
          @click="sidebarOpen = false"
        >
          <span>{{ item.icon }}</span>{{ item.label }}
          <span
            v-if="item.path === '/approvals' && unreadCount()"
            class="nav-badge"
          >{{ unreadCount() }}</span>
        </router-link>
      </template>
      <div style="flex: 1" />
      <button
        class="nav-item"
        @click="logout"
      >
        ↩ Выйти
      </button>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <button
          class="btn btn-icon"
          style="display: none"
          aria-hidden="true"
        />
        <strong style="font-size: 14px">{{ auth.displayName }}</strong>
        <span
          v-if="auth.isAdmin"
          class="badge badge-info"
        >администратор</span>
        <span class="topbar-spacer" />
        <button
          class="btn btn-icon"
          :title="notifications.length ? 'Есть уведомления' : 'Уведомлений нет'"
          @click="router.push('/my')"
        >
          🔔<span
            v-if="unreadCount()"
            class="nav-badge"
            style="margin-left: 4px"
          >{{ unreadCount() }}</span>
        </button>
        <button
          class="btn btn-icon"
          title="Тема"
          @click="toggleTheme"
        >
          ◐
        </button>
      </header>
      <main class="app-content scroll-thin">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.anon-area {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
