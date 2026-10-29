<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useNotificationsStore } from '@/stores/notifications';
import { useApprovalsStore } from '@/stores/approvals';
import { useLiveStore } from '@/stores/live';
import { onSessionLost, subscribeLive } from '@/api/client';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import AppTopBar from '@/components/layout/AppTopBar.vue';
import ToastHost from '@/components/common/ToastHost.vue';
import ConfirmHost from '@/components/common/ConfirmHost.vue';

const auth = useAuthStore();
const notifications = useNotificationsStore();
const approvals = useApprovalsStore();
const live = useLiveStore();
const router = useRouter();
const route = useRoute();

const COLLAPSE_KEY = 'vp.sidebar.collapsed';
const collapsed = ref(readCollapsed());
const mobileOpen = ref(false);
let approvalsTimer = 0;

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

function toggleSidebar(): void {
  collapsed.value = !collapsed.value;
  try { localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0'); } catch { /* приватный режим */ }
}

// Пароль сменён, сотрудник уволен или сеанс истёк — на экран входа с объяснением
onSessionLost(() => {
  if (!auth.isLoggedIn) return;
  auth.drop();
  void router.push({ path: '/login', query: { ended: '1' } });
});

async function logout(): Promise<void> {
  await auth.logout();
  router.push('/login');
}

// Фоновые данные каркаса живут, пока пользователь вошёл. Обновления приходят потоком событий
// сервера; пока он недоступен — опрос (уведомления раз в 30 с, счётчик заявок раз в минуту).
let unsubscribe: (() => void) | null = null;
function pollApprovals(on: boolean): void {
  window.clearInterval(approvalsTimer);
  if (on) approvalsTimer = window.setInterval(() => void approvals.refresh(auth.isAdmin), 60000);
}
// До смены одноразового пароля сервер отвечает только на профиль и смену пароля — фоновые данные не нужны
watch(() => auth.isLoggedIn && !auth.mustChangePassword, (loggedIn) => {
  unsubscribe?.();
  unsubscribe = null;
  pollApprovals(false);
  if (loggedIn) {
    notifications.start();
    void approvals.refresh(auth.isAdmin);
    pollApprovals(true);
    unsubscribe = subscribeLive({
      status: (on) => { notifications.live(on); pollApprovals(!on); },
      notifications: () => { void notifications.load(); void approvals.refresh(auth.isAdmin); },
      data: (d) => { live.version = d.version; },
      hello: (d) => { live.version = d.version; },
    });
  } else {
    notifications.stop();
    approvals.pending = 0;
  }
}, { immediate: true });

watch(() => route.fullPath, () => { mobileOpen.value = false; });
onBeforeUnmount(() => { window.clearInterval(approvalsTimer); unsubscribe?.(); });
</script>

<template>
  <div
    v-if="auth.loading"
    class="boot"
  >
    <span class="boot-spinner" />
  </div>

  <router-view v-else-if="!auth.isLoggedIn || route.meta.bare" />

  <div
    v-else
    class="app-shell"
  >
    <div
      v-if="mobileOpen"
      class="mobile-backdrop"
      @click="mobileOpen = false"
    />
    <AppSidebar
      :collapsed="collapsed"
      :mobile-open="mobileOpen"
      @toggle="toggleSidebar"
      @navigate="mobileOpen = false"
      @logout="logout"
    />
    <div class="main-area">
      <AppTopBar @open-menu="mobileOpen = true" />
      <main class="app-content scroll-thin">
        <router-view />
      </main>
    </div>
  </div>

  <ToastHost />
  <ConfirmHost />
</template>

<style scoped>
.boot {
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.boot-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--color-primary-soft);
  border-top-color: var(--color-primary);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.mobile-backdrop {
  display: none;
}

@media (max-width: 900px) {
  .mobile-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--color-overlay);
    z-index: 150;
  }
}
</style>
