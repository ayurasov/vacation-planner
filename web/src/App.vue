<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api, type Notification } from '@/api/client';
import AppIcon from '@/components/common/AppIcon.vue';

const auth = useAuthStore();
const router = useRouter();
const sidebarOpen = ref(false);
const isDark = ref(false);
const notifications = ref<Notification[]>([]);

interface NavItem {
  path: string;
  label: string;
  icon: string;
  admin?: boolean;
  needsApprover?: boolean;
}

const navSections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Основное',
    items: [
      { path: '/schedule', label: 'График отпусков', icon: 'calendar' },
      { path: '/my', label: 'Мой отпуск', icon: 'palm' },
    ],
  },
  {
    title: 'Управление',
    items: [
      { path: '/approvals', label: 'Заявки', icon: 'checklist', needsApprover: true },
      { path: '/employees', label: 'Сотрудники', icon: 'users', admin: true },
      { path: '/directories', label: 'Справочники', icon: 'folder', admin: true },
      { path: '/settings', label: 'Настройки', icon: 'settings' },
      { path: '/audit', label: 'Аудит', icon: 'history', admin: true },
    ],
  },
];

const visibleItems = (items: NavItem[]) =>
  items.filter((i) => (!i.admin || auth.isAdmin) && (!i.needsApprover || auth.isApprover));

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

function toggleTheme(): void {
  const next = isDark.value ? 'light' : 'dark';
  isDark.value = !isDark.value;
  document.documentElement.dataset.theme = next;
  localStorage.setItem('vp.theme', next);
}

async function logout(): Promise<void> {
  await auth.logout();
  router.push('/login');
}

onMounted(() => {
  isDark.value = document.documentElement.dataset.theme === 'dark';
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
    <div
      v-if="sidebarOpen"
      class="mobile-nav-backdrop"
      @click="sidebarOpen = false"
    />

    <aside
      class="sidebar scroll-thin"
      :class="{ 'mobile-open': sidebarOpen }"
    >
      <div class="sidebar-logo">
        <span class="logo-mark"><AppIcon
          name="brandMark"
          :size="20"
        /></span>
        <span class="logo-text">Планировщик<br>отпусков</span>
      </div>
      <template
        v-for="section in navSections"
        :key="section.title"
      >
        <div class="nav-section">
          {{ section.title }}
        </div>
        <router-link
          v-for="item in visibleItems(section.items)"
          :key="item.path"
          class="nav-item"
          :to="item.path"
          :class="{ active: $route.path === item.path }"
          @click="sidebarOpen = false"
        >
          <AppIcon
            :name="item.icon"
            :size="16"
          />
          <span>{{ item.label }}</span>
          <span
            v-if="item.path === '/approvals' && unreadCount()"
            class="nav-badge"
          >{{ unreadCount() }}</span>
        </router-link>
      </template>
      <div style="flex: 1" />
      <button
        class="nav-item"
        type="button"
        @click="logout"
      >
        <AppIcon
          name="logout"
          :size="16"
        />
        <span>Выйти</span>
      </button>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <button
          class="btn btn-icon btn-ghost mobile-nav-trigger"
          type="button"
          @click="sidebarOpen = true"
        >
          <AppIcon
            name="menu"
            :size="18"
          />
        </button>
        <div class="topbar-user">
          <strong>{{ auth.displayName }}</strong>
          <span
            v-if="auth.isAdmin"
            class="badge badge-info"
          >администратор</span>
        </div>
        <span class="topbar-spacer" />
        <button
          class="btn btn-icon btn-ghost topbar-icon"
          type="button"
          title="Уведомления"
          @click="router.push('/my')"
        >
          <AppIcon
            name="bell"
            :size="17"
          />
          <span
            v-if="unreadCount()"
            class="nav-badge"
          >{{ unreadCount() }}</span>
        </button>
        <button
          class="btn btn-icon btn-ghost"
          type="button"
          title="Тема"
          @click="toggleTheme"
        >
          <AppIcon
            :name="isDark ? 'sun' : 'moon'"
            :size="17"
          />
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

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 14px;
  line-height: 1.2;
  padding: 4px 12px 16px;
}

.logo-mark {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--color-primary);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.topbar-user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
}

.nav-badge {
  background: var(--color-primary);
  color: #fff;
  border-radius: 10px;
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  min-width: 18px;
  text-align: center;
  line-height: 16px;
}

.topbar-icon {
  position: relative;
}

.topbar-icon .nav-badge {
  position: absolute;
  top: 1px;
  right: 1px;
  transform: none;
  padding: 0 4px;
  min-width: 15px;
  line-height: 14px;
  border-radius: 7px;
  font-size: 9.5px;
}

.mobile-nav-trigger {
  display: none;
}

@media (max-width: 900px) {
  .mobile-nav-trigger {
    display: inline-flex;
  }

  .mobile-nav-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--color-overlay);
    z-index: 99;
  }
}
</style>
