import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const LoginView = () => import('@/views/LoginView.vue');
const ScheduleView = () => import('@/views/ScheduleView.vue');
const MyVacationView = () => import('@/views/MyVacationView.vue');
const ApprovalsView = () => import('@/views/ApprovalsView.vue');
const EmployeesView = () => import('@/views/EmployeesView.vue');
const DirectoriesView = () => import('@/views/DirectoriesView.vue');
const SettingsView = () => import('@/views/SettingsView.vue');
const AuditView = () => import('@/views/AuditView.vue');

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/', redirect: '/schedule' },
    { path: '/schedule', component: ScheduleView, meta: { title: 'График отпусков' } },
    { path: '/my', component: MyVacationView, meta: { title: 'Мой отпуск' } },
    { path: '/approvals', component: ApprovalsView, meta: { title: 'Заявки на согласование' } },
    { path: '/employees', component: EmployeesView, meta: { admin: true, title: 'Сотрудники' } },
    { path: '/directories', component: DirectoriesView, meta: { admin: true, title: 'Справочники' } },
    { path: '/settings', component: SettingsView, meta: { title: 'Профиль и настройки' } },
    { path: '/audit', component: AuditView, meta: { admin: true, title: 'Журнал аудита' } },
    { path: '/:pathMatch(.*)*', redirect: '/schedule' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.loading) await auth.restore();
  if (!to.meta.public && !auth.isLoggedIn) return { path: '/login' };
  if (to.path === '/login' && auth.isLoggedIn) return { path: '/schedule' };
  if (to.meta.admin && !auth.isAdmin) return { path: '/schedule' };
  return true;
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} · Планировщик отпусков` : 'Планировщик отпусков';
});
