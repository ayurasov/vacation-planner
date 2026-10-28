<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type OrgSettings } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useTheme, type ThemeChoice } from '@/composables/useTheme';
import { fmtNumber } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const theme = useTheme();

const settings = ref<OrgSettings | null>(null);
const savingOrg = ref(false);
const oldPassword = ref('');
const newPassword = ref('');
const newPassword2 = ref('');
const savingPw = ref(false);
const savingMail = ref(false);
const testingMail = ref(false);

async function toggleLetters(ev: Event): Promise<void> {
  const on = (ev.target as HTMLInputElement).checked;
  savingMail.value = true;
  try {
    auth.me = await api.patch('/auth/me', { emailNotifications: on });
    ui.toast(on ? 'Письма о заявках включены' : 'Письма о заявках отключены');
  } catch (e) {
    ui.error(e);
  } finally {
    savingMail.value = false;
  }
}

async function testEmail(): Promise<void> {
  testingMail.value = true;
  try {
    const r = await api.post<{ to: string; sent: boolean; error: string | null }>('/settings/test-email');
    if (r.sent) ui.toast(`Проверочное письмо отправлено на ${r.to}`);
    else ui.toast(`Письмо не отправлено: ${r.error ?? 'неизвестная ошибка'}. Повтор — автоматически.`, 'error');
  } catch (e) {
    ui.error(e);
  } finally {
    testingMail.value = false;
  }
}

const THEMES: Array<{ key: ThemeChoice; label: string; icon: string }> = [
  { key: 'system', label: 'Как в системе', icon: 'monitor' },
  { key: 'light', label: 'Светлая', icon: 'sun' },
  { key: 'dark', label: 'Тёмная', icon: 'moon' },
];

async function saveOrg(): Promise<void> {
  if (!settings.value) return;
  savingOrg.value = true;
  try {
    settings.value = await api.patch<OrgSettings>('/settings', {
      conflictThreshold: Number(settings.value.conflictThreshold),
      limitPolicy: settings.value.limitPolicy,
      defaultPlannedDays: Number(settings.value.defaultPlannedDays),
    });
    ui.toast('Настройки организации сохранены');
  } catch (e) {
    ui.error(e);
  } finally {
    savingOrg.value = false;
  }
}

async function changePassword(): Promise<void> {
  if (newPassword.value !== newPassword2.value) {
    ui.toast('Новый пароль и подтверждение не совпадают', 'error');
    return;
  }
  savingPw.value = true;
  try {
    await api.put(`/employees/${auth.me!.employee.id}/password`, {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    });
    ui.toast('Пароль изменён. Войдите с новым паролем.');
    await auth.logout();
    router.push('/login');
  } catch (e) {
    ui.error(e);
  } finally {
    savingPw.value = false;
  }
}

onMounted(async () => {
  try {
    settings.value = await api.get<OrgSettings>('/settings');
  } catch { /* блок организации скрыт */ }
});
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Профиль и настройки
        </div>
        <div class="view-subtitle">
          Личные данные, безопасность и оформление{{ auth.isAdmin ? ' · правила организации' : '' }}
        </div>
      </div>
    </div>

    <section class="card profile">
      <UserAvatar
        :name="auth.me?.employee.name ?? '?'"
        :size="56"
      />
      <div class="profile-main">
        <div class="profile-name">
          {{ auth.me?.employee.name }}
        </div>
        <div class="muted">
          {{ auth.me?.employee.position ?? 'Должность не указана' }}
        </div>
        <div class="profile-tags">
          <span class="tag mono">{{ auth.me?.employee.login }}</span>
          <span
            v-if="auth.isAdmin"
            class="badge badge-violet"
          >администратор</span>
          <span
            v-if="auth.isApprover"
            class="badge badge-info"
          >руководитель · {{ auth.me?.permissions.approveSubordinates.length }} подчинённых</span>
          <span class="badge badge-muted">норма {{ fmtNumber(auth.me?.employee.plannedDays ?? 0) }} дн.</span>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-header">
          <span class="section-title"><AppIcon
            name="sun"
            :size="16"
          /> Оформление</span>
        </div>
        <div class="card-body">
          <div class="theme-options">
            <button
              v-for="t in THEMES"
              :key="t.key"
              type="button"
              class="theme-option"
              :class="{ active: theme.choice.value === t.key }"
              @click="theme.set(t.key)"
            >
              <span
                class="theme-preview"
                :class="`preview-${t.key}`"
              ><span /><span /></span>
              <span class="theme-label"><AppIcon
                :name="t.icon"
                :size="14"
              /> {{ t.label }}</span>
            </button>
          </div>
        </div>
      </section>

      <form
        class="card"
        @submit.prevent="changePassword"
      >
        <div class="card-header">
          <span class="section-title"><AppIcon
            name="key"
            :size="16"
          /> Смена пароля</span>
        </div>
        <div class="card-body">
          <div class="field">
            <label for="pw-old">Текущий пароль</label>
            <input
              id="pw-old"
              v-model="oldPassword"
              type="password"
              class="input"
              autocomplete="current-password"
              required
            >
          </div>
          <div class="field">
            <label for="pw-new">Новый пароль</label>
            <input
              id="pw-new"
              v-model="newPassword"
              type="password"
              class="input"
              autocomplete="new-password"
              minlength="8"
              required
            >
            <span class="field-hint">Не короче 8 символов. После смены все сеансы завершатся.</span>
          </div>
          <div class="field">
            <label for="pw-new2">Повторите новый пароль</label>
            <input
              id="pw-new2"
              v-model="newPassword2"
              type="password"
              class="input"
              autocomplete="new-password"
              required
            >
          </div>
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="savingPw || newPassword.length < 8 || !oldPassword"
          >
            Сменить пароль
          </button>
        </div>
      </form>
    </div>

    <section class="card">
      <div class="card-header">
        <span class="section-title"><AppIcon
          name="mail"
          :size="16"
        /> Письма о заявках</span>
        <span
          v-if="settings && !settings.mailEnabled"
          class="soft small"
        >почта на сервере не настроена</span>
      </div>
      <div class="card-body mail">
        <label class="checkbox">
          <input
            type="checkbox"
            :checked="auth.me?.employee.emailNotifications"
            :disabled="savingMail || !auth.me?.employee.email"
            @change="toggleLetters"
          >
          <span>
            Присылать письма: новые заявки подчинённых, решения по моим заявкам<template v-if="auth.isApprover">, сводка по пятницам об отпусках команды на следующей неделе</template>
          </span>
        </label>
        <div class="field-hint">
          <template v-if="auth.me?.employee.email">
            Адрес: <span class="mono">{{ auth.me.employee.email }}</span>. Уведомления в колокольчике приходят в любом случае.
          </template>
          <template v-else>
            Адрес почты не указан — его вносит кадровая служба в карточке сотрудника.
          </template>
        </div>
        <div
          v-if="auth.isAdmin"
          class="mail-admin"
        >
          <button
            class="btn btn-sm"
            type="button"
            :disabled="testingMail || !settings?.mailEnabled || !auth.me?.employee.email"
            :title="!settings?.mailEnabled ? 'Задайте SMTP_HOST и параметры SMTP в окружении сервера' : ''"
            @click="testEmail"
          >
            <AppIcon
              name="mail"
              :size="14"
            /> Проверочное письмо себе
          </button>
          <span class="soft small">проверка SMTP после развёртывания</span>
        </div>
      </div>
    </section>

    <form
      v-if="auth.isAdmin && settings"
      class="card"
      @submit.prevent="saveOrg"
    >
      <div class="card-header">
        <span class="section-title"><AppIcon
          name="sliders"
          :size="16"
        /> Правила организации</span>
        <span class="soft small">изменения попадают в журнал аудита</span>
      </div>
      <div class="card-body org">
        <div class="field">
          <label for="org-thr">Порог конфликта отдела: <strong>{{ settings.conflictThreshold }}%</strong></label>
          <input
            id="org-thr"
            v-model.number="settings.conflictThreshold"
            type="range"
            min="20"
            max="80"
            step="5"
            class="range"
          >
          <span class="field-hint">День считается конфликтным, если в отпуске такая доля отдела или больше.</span>
        </div>
        <div class="field">
          <span class="field-label">Превышение остатка дней</span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: settings.limitPolicy === 'hard' }"
              @click="settings.limitPolicy = 'hard'"
            >
              Запрещено
            </button>
            <button
              type="button"
              :class="{ active: settings.limitPolicy === 'soft' }"
              @click="settings.limitPolicy = 'soft'"
            >
              Предупреждение
            </button>
          </div>
          <span class="field-hint">{{ settings.limitPolicy === 'hard' ? 'Заявку сверх остатка отправить нельзя.' : 'Сотрудник видит предупреждение, решение за руководителем.' }}</span>
        </div>
        <div class="field">
          <label for="org-days">Норма дней для новых сотрудников</label>
          <input
            id="org-days"
            v-model.number="settings.defaultPlannedDays"
            type="number"
            min="20"
            max="60"
            class="input"
            style="max-width: 120px"
          >
        </div>
        <button
          class="btn btn-primary"
          type="submit"
          :disabled="savingOrg"
        >
          Сохранить правила
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.card + .card,
.grid-2 + .card,
.card + .grid-2 {
  margin-top: 14px;
}

.profile {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
}

.profile-name {
  font-size: 17px;
  font-weight: 650;
}

.profile-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}

.mail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mail-admin {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.grid-2 .card + .card {
  margin-top: 0;
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.theme-option {
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: 8px;
  cursor: pointer;
  font: inherit;
  color: var(--color-text);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-option.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-ring);
}

.theme-preview {
  height: 52px;
  border-radius: 6px;
  display: flex;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.theme-preview span:first-child {
  width: 30%;
}

.theme-preview span:last-child {
  flex: 1;
}

.preview-light span:first-child { background: #fff; }
.preview-light span:last-child { background: #f6f7fb; }
.preview-dark span:first-child { background: #171b23; }
.preview-dark span:last-child { background: #0f1218; }
.preview-system span:first-child { background: linear-gradient(135deg, #fff 50%, #171b23 50%); }
.preview-system span:last-child { background: linear-gradient(135deg, #f6f7fb 50%, #0f1218 50%); }

.theme-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  justify-content: center;
}

.org {
  max-width: 560px;
}

.range {
  width: 100%;
  accent-color: var(--color-primary);
}

@media (max-width: 900px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
