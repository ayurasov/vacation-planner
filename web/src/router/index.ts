import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const LoginView = () => import('@/views/LoginView.vue');
const ScheduleView = () => import('@/views/ScheduleView.vue');
const MyVacationView = () => import('@/views/MyVacationView.vue');
const ApprovalsView = () => import('@/views/ApprovalsView.vue');
const EmployeesView = () => import('@/views/EmployeesView.vue');
const ExchangeView = () => import('@/views/ExchangeView.vue');
const DirectoriesView = () => import('@/views/DirectoriesView.vue');
const SettingsView = () => import('@/views/SettingsView.vue');
const AuditView = () => import('@/views/AuditView.vue');
const TeamView = () => import('@/views/TeamView.vue');
const WorkScheduleView = () => import('@/views/WorkScheduleView.vue');
const ChangePasswordView = () => import('@/views/ChangePasswordView.vue');
const HrView = () => import('@/views/HrView.vue');
const NoticePrintView = () => import('@/views/NoticePrintView.vue');
const GuideView = () => import('@/views/GuideView.vue');

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    // Без меню: пока одноразовый пароль не сменён, остальные разделы недоступны (v0.6.0)
    { path: '/change-password', component: ChangePasswordView, meta: { bare: true, title: 'Смена пароля' } },
    { path: '/', redirect: '/schedule' },
    { path: '/schedule', component: ScheduleView, meta: { title: 'График отпусков' } },
    { path: '/my', component: MyVacationView, meta: { title: 'Мой отпуск' } },
    { path: '/team', component: TeamView, meta: { title: 'Команда' } },
    { path: '/work-schedule', component: WorkScheduleView, meta: { title: 'График работы' } },
    { path: '/approvals', component: ApprovalsView, meta: { title: 'Заявки на согласование' } },
    { path: '/employees', component: EmployeesView, meta: { staff: true, title: 'Сотрудники' } },
    { path: '/directories', component: DirectoriesView, meta: { staff: true, title: 'Справочники' } },
    { path: '/settings', component: SettingsView, meta: { title: 'Профиль и настройки' } },
    { path: '/audit', component: AuditView, meta: { staff: true, title: 'Журнал аудита' } },
    { path: '/hr', component: HrView, meta: { staff: true, title: 'Кадровый учёт' } },
    { path: '/exchange', component: ExchangeView, meta: { staff: true, title: 'Импорт и экспорт' } },
    // Руководства внутри приложения (v1.1.0, E71); глава — в якоре: /guide#график-отпусков
    { path: '/guide', component: GuideView, meta: { title: 'Руководство пользователя', guide: 'user' } },
    { path: '/guide/admin', component: GuideView, meta: { staff: true, title: 'Руководство администратора', guide: 'admin' } },
    // Лист для печати под подпись — без меню; своё извещение — сотруднику, любое — кадровой службе
    { path: '/notices/:id(\\d+)/print', component: NoticePrintView, meta: { bare: true, title: 'Извещение о начале отпуска' } },
    { path: '/:pathMatch(.*)*', redirect: '/schedule' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.loading) await auth.restore();
  if (!to.meta.public && !auth.isLoggedIn) return { path: '/login' };
  if (auth.mustChangePassword && to.path !== '/change-password' && !to.meta.public) return { path: '/change-password' };
  if (!auth.mustChangePassword && to.path === '/change-password') return { path: '/schedule' };
  if (to.path === '/login' && auth.isLoggedIn) return { path: auth.mustChangePassword ? '/change-password' : '/schedule' };
  if (to.meta.staff && !auth.isStaff) return { path: '/schedule' };
  return true;
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} · Планировщик отпусков` : 'Планировщик отпусков';
});
