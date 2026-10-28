<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useApprovalsStore } from '@/stores/approvals';
import AppIcon from '@/components/common/AppIcon.vue';

defineProps<{ collapsed: boolean; mobileOpen: boolean }>();
const emit = defineEmits<{ toggle: []; navigate: []; logout: [] }>();

const auth = useAuthStore();
const approvals = useApprovalsStore();
const route = useRoute();
const version = __APP_VERSION__;

interface NavItem { path: string; label: string; icon: string; badge?: number }

const sections = computed(() => {
  const out: Array<{ title: string; items: NavItem[] }> = [
    {
      title: 'Отпуска',
      items: [
        { path: '/schedule', label: 'График отпусков', icon: 'schedule' },
        { path: '/my', label: 'Мой отпуск', icon: 'vacation' },
      ],
    },
    {
      title: 'Работа',
      items: [
        { path: '/team', label: 'Команда', icon: 'team' },
        { path: '/work-schedule', label: 'График работы', icon: 'layers' },
      ],
    },
  ];
  if (auth.isApprover || auth.isAdmin) {
    out.push({
      title: 'Согласование',
      items: [{ path: '/approvals', label: 'Заявки', icon: 'approvals', badge: approvals.pending }],
    });
  }
  if (auth.isStaff) {
    out.push({
      title: auth.isAdmin ? 'Администрирование' : 'Кадровая служба',
      items: [
        { path: '/employees', label: 'Сотрудники', icon: 'user' },
        { path: '/directories', label: 'Справочники', icon: 'building' },
        { path: '/audit', label: 'Журнал аудита', icon: 'shield' },
      ],
    });
  }
  return out;
});

const isActive = (path: string) => route.path === path || route.path.startsWith(`${path}/`);
</script>

<template>
  <aside
    class="sidebar scroll-thin"
    :class="{ collapsed, 'mobile-open': mobileOpen }"
    aria-label="Главное меню"
  >
    <div class="sidebar-top">
      <router-link
        to="/schedule"
        class="sidebar-logo"
        title="Планировщик отпусков"
        @click="emit('navigate')"
      >
        <AppIcon
          name="brand"
          :size="30"
        />
        <span
          v-if="!collapsed"
          class="brand-text"
        >
          <span class="brand-name">Планировщик<br>отпусков</span>
        </span>
      </router-link>
      <button
        class="collapse-btn"
        type="button"
        :title="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
        :aria-label="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
        @click="emit('toggle')"
      >
        <AppIcon
          :name="collapsed ? 'chevronRight' : 'chevronLeft'"
          :size="14"
        />
      </button>
    </div>

    <nav class="sidebar-nav">
      <template
        v-for="section in sections"
        :key="section.title"
      >
        <div
          class="nav-section"
          :class="{ 'nav-section-collapsed': collapsed }"
        >
          <span v-if="!collapsed">{{ section.title }}</span>
        </div>
        <router-link
          v-for="item in section.items"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
          :title="collapsed ? item.label : undefined"
          @click="emit('navigate')"
        >
          <AppIcon
            :name="item.icon"
            :size="17"
          />
          <span
            v-if="!collapsed"
            class="nav-label"
          >{{ item.label }}</span>
          <span
            v-if="item.badge"
            class="nav-count"
            :class="{ 'nav-count-dot': collapsed }"
          >{{ collapsed ? '' : item.badge }}</span>
        </router-link>
      </template>
    </nav>

    <div class="sidebar-bottom">
      <router-link
        to="/settings"
        class="nav-item"
        :class="{ active: isActive('/settings') }"
        :title="collapsed ? 'Настройки' : undefined"
        @click="emit('navigate')"
      >
        <AppIcon
          name="sliders"
          :size="17"
        />
        <span
          v-if="!collapsed"
          class="nav-label"
        >Настройки</span>
      </router-link>
      <button
        class="nav-item"
        type="button"
        :title="collapsed ? 'Выйти' : undefined"
        @click="emit('logout')"
      >
        <AppIcon
          name="logout"
          :size="17"
        />
        <span
          v-if="!collapsed"
          class="nav-label"
        >Выйти</span>
      </button>
      <div
        v-if="!collapsed"
        class="sidebar-version"
      >
        Версия {{ version }} · © Alexander Yurasov
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  padding: 16px 10px 12px;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.18s ease;
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed);
  padding: 16px 8px 12px;
}

.sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 4px 18px;
}

.collapsed .sidebar-top {
  flex-direction: column;
  gap: 12px;
  padding-inline: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  min-width: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-name {
  font-weight: 700;
  font-size: 13.5px;
  line-height: 1.2;
}

.collapse-btn {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: 7px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: var(--color-hover);
  color: var(--color-text);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-section {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-soft);
  padding: 14px 10px 6px;
  white-space: nowrap;
}

.nav-section:first-child {
  padding-top: 2px;
}

.nav-section-collapsed {
  padding: 10px 0 6px;
  margin: 0 12px;
  border-top: 1px solid var(--color-border);
}

.nav-section-collapsed:first-child {
  border-top: none;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  color: var(--color-text);
  border: none;
  background: none;
  text-align: left;
  width: 100%;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
}

.nav-item .app-icon {
  color: var(--color-text-muted);
}

.collapsed .nav-item {
  justify-content: center;
  padding: 9px 8px;
}

.nav-item:hover {
  background: var(--color-hover);
}

.nav-item.active {
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-weight: 600;
}

.nav-item.active .app-icon {
  color: var(--color-primary);
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-warning);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  text-align: center;
  line-height: 16px;
}

.nav-count-dot {
  position: absolute;
  top: 6px;
  right: 8px;
  min-width: 8px;
  width: 8px;
  height: 8px;
  padding: 0;
}

.sidebar-bottom {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-version {
  font-size: 10.5px;
  color: var(--color-text-soft);
  padding: 8px 10px 0;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .sidebar,
  .sidebar.collapsed {
    position: fixed;
    z-index: 200;
    inset: 0 auto 0 0;
    width: min(86vw, 300px);
    padding: 16px 10px 12px;
    transform: translateX(-105%);
    transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .sidebar.mobile-open {
    transform: translateX(0);
    box-shadow: 12px 0 32px rgba(20, 25, 40, 0.22);
  }

  .collapse-btn {
    display: none;
  }

  .nav-item {
    min-height: 44px;
  }
}
</style>
