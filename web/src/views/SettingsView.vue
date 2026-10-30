<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type OrgSettings, type UnitKind, type UserSession } from '@/api/client';
import { DEFAULT_UNIT_KINDS } from '@/lib/departments';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useTheme, type ThemeChoice } from '@/composables/useTheme';
import { fmtDateTime, fmtNumber } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import HelpLink from '@/components/common/HelpLink.vue';
import DelegationEditor from '@/components/DelegationEditor.vue';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const theme = useTheme();

const settings = ref<OrgSettings | null>(null);
// Виды уровней структуры (v1.1.0): правка копии; код нового вида — из названия, латиницей
const kinds = ref<Array<UnitKind & { fresh?: boolean }>>([]);
const resetKinds = (s: OrgSettings | null) => { kinds.value = (s?.unitKinds?.length ? s.unitKinds : DEFAULT_UNIT_KINDS).map((k) => ({ ...k })); };
function addKind(): void {
  let n = kinds.value.length + 1;
  while (kinds.value.some((k) => k.value === `level${n}`)) n++;
  kinds.value.push({ value: `level${n}`, label: '', color: '#64748b', fresh: true });
}
const savingOrg = ref(false);
const oldPassword = ref('');
const newPassword = ref('');
const newPassword2 = ref('');
const savingPw = ref(false);
const savingMail = ref(false);
const testingMail = ref(false);
// Минимальная длина пароля — правило организации (v0.6.0); до загрузки — 8, как в ТЗ
const minLength = computed(() => settings.value?.passwordMinLength ?? 8);

// ── Сеансы (v0.6.0): где выполнен вход, завершение чужих устройств ──
const sessions = ref<UserSession[]>([]);
const sessionsBusy = ref(false);

async function loadSessions(): Promise<void> {
  try {
    sessions.value = (await api.get<{ items: UserSession[] }>('/auth/sessions')).items;
  } catch { /* список не загрузился — карточка покажет пустое состояние */ }
}

async function endSession(s: UserSession): Promise<void> {
  sessionsBusy.value = true;
  try {
    await api.del(`/auth/sessions/${s.id}`);
    ui.toast(`Сеанс «${s.device}» завершён`);
    await loadSessions();
  } catch (e) {
    ui.error(e);
  } finally {
    sessionsBusy.value = false;
  }
}

async function endOthers(): Promise<void> {
  sessionsBusy.value = true;
  try {
    const r = await api.post<{ revoked: number }>('/auth/sessions/revoke-others');
    ui.toast(r.revoked ? `Завершено сеансов: ${r.revoked}` : 'Других сеансов нет');
    await loadSessions();
  } catch (e) {
    ui.error(e);
  } finally {
    sessionsBusy.value = false;
  }
}

async function toggleLetters(ev: Event): Promise<void> {
  const box = ev.target as HTMLInputElement;
  const on = box.checked;
  savingMail.value = true;
  try {
    auth.me = await api.patch('/auth/me', { emailNotifications: on });
    ui.toast(on ? 'Письма о заявках включены' : 'Письма о заявках отключены');
  } catch (e) {
    box.checked = !on; // настройка не изменилась — флажок возвращается
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
      unitKinds: kinds.value.map(({ value, label, color }) => ({ value, label: label.trim(), color })),
      orgMaxDepth: Number(settings.value.orgMaxDepth ?? 15),
      conflictThreshold: Number(settings.value.conflictThreshold),
      limitPolicy: settings.value.limitPolicy,
      defaultPlannedDays: Number(settings.value.defaultPlannedDays),
      escalationDays: Number(settings.value.escalationDays),
      noticeDays: Number(settings.value.noticeDays),
      // Реквизиты формы Т-7: пустая строка на сервере очищает поле
      orgName: settings.value.orgName ?? '', orgOkpo: settings.value.orgOkpo ?? '',
      headPosition: settings.value.headPosition ?? '', headName: settings.value.headName ?? '',
      hrHeadPosition: settings.value.hrHeadPosition ?? '', hrHeadName: settings.value.hrHeadName ?? '',
      passwordMinLength: Number(settings.value.passwordMinLength),
      lockoutThreshold: Number(settings.value.lockoutThreshold),
      lockoutMinutes: Number(settings.value.lockoutMinutes),
      loginRetentionDays: Number(settings.value.loginRetentionDays),
    });
    resetKinds(settings.value);
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
  void loadSessions();
  try {
    settings.value = await api.get<OrgSettings>('/settings');
    resetKinds(settings.value);
  } catch { /* блок организации скрыт */ }
});
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Профиль и настройки
          <HelpLink topic="settings" />
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
              :minlength="minLength"
              required
            >
            <span class="field-hint">Не короче {{ minLength }} символов, без логина и фамилии, не из распространённых вроде «qwerty123». После смены все сеансы завершатся.</span>
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
            :disabled="savingPw || newPassword.length < minLength || !oldPassword"
          >
            Сменить пароль
          </button>
        </div>
      </form>
    </div>

    <section
      class="card"
      aria-labelledby="sessions-title"
    >
      <div class="card-header">
        <span
          id="sessions-title"
          class="section-title"
        ><AppIcon
          name="monitor"
          :size="16"
        /> Активные сеансы</span>
        <button
          v-if="sessions.length > 1"
          class="btn btn-sm"
          type="button"
          :disabled="sessionsBusy"
          @click="endOthers"
        >
          Завершить остальные
        </button>
      </div>
      <ul
        v-if="sessions.length"
        class="sessions"
      >
        <li
          v-for="s in sessions"
          :key="s.id"
          class="session"
        >
          <div class="session-main">
            <div class="session-device">
              {{ s.device }}
              <span
                v-if="s.current"
                class="badge badge-success"
              >это устройство</span>
              <span
                v-if="s.method === 'oidc'"
                class="badge badge-muted"
              >единый вход</span>
            </div>
            <div class="soft small">
              вход {{ fmtDateTime(s.startedAt) }} · активен {{ fmtDateTime(s.lastActiveAt) }}<template v-if="s.ip">
                · {{ s.ip }}
              </template>
            </div>
          </div>
          <button
            v-if="!s.current"
            class="btn btn-sm btn-danger"
            type="button"
            :disabled="sessionsBusy"
            :aria-label="`Завершить сеанс ${s.device}`"
            @click="endSession(s)"
          >
            Завершить
          </button>
        </li>
      </ul>
      <div
        v-else
        class="card-body soft small"
      >
        Список сеансов не загрузился.
      </div>
      <div class="card-body field-hint sessions-hint">
        Не узнаёте устройство — завершите сеанс и смените пароль. Завершённый сеанс перестаёт работать в течение 10 секунд.
      </div>
    </section>

    <section
      v-if="auth.hasApprovals"
      class="card"
      aria-labelledby="deleg-title"
    >
      <div class="card-header">
        <span
          id="deleg-title"
          class="section-title"
        ><AppIcon
          name="swap"
          :size="16"
        /> Замещение на время отсутствия</span>
        <span class="soft small">заместитель согласует заявки ваших сотрудников</span>
      </div>
      <div class="card-body">
        <DelegationEditor />
      </div>
    </section>

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
        <div class="field">
          <label for="org-esc">Заявка без решения передаётся вышестоящему руководителю через, дней</label>
          <input
            id="org-esc"
            v-model.number="settings.escalationDays"
            type="number"
            min="0"
            max="60"
            class="input"
            style="max-width: 120px"
            aria-describedby="org-esc-hint"
          >
          <span
            id="org-esc-hint"
            class="field-hint"
          >0 — не передаётся. Если выше руководителя никого нет, уведомление получает кадровая служба.</span>
        </div>
        <div class="field">
          <label for="org-notice">Извещение о начале отпуска — за, дней</label>
          <input
            id="org-notice"
            v-model.number="settings.noticeDays"
            type="number"
            min="14"
            max="60"
            class="input"
            style="max-width: 120px"
            aria-describedby="org-notice-hint"
          >
          <span
            id="org-notice-hint"
            class="field-hint"
          >Не меньше 14 — по ст. 123 ТК РФ сотрудника извещают под подпись не позднее чем за две недели.</span>
        </div>
        <fieldset class="security">
          <legend class="field-label">
            Безопасность входа
          </legend>
          <div class="security-grid">
            <div class="field">
              <label for="org-pwlen">Минимальная длина пароля</label>
              <input
                id="org-pwlen"
                v-model.number="settings.passwordMinLength"
                type="number"
                min="8"
                max="64"
                class="input"
              >
            </div>
            <div class="field">
              <label for="org-lock">Неудачных попыток до блокировки</label>
              <input
                id="org-lock"
                v-model.number="settings.lockoutThreshold"
                type="number"
                min="0"
                max="50"
                class="input"
                aria-describedby="org-lock-hint"
              >
            </div>
            <div class="field">
              <label for="org-lockmin">Блокировка, минут</label>
              <input
                id="org-lockmin"
                v-model.number="settings.lockoutMinutes"
                type="number"
                min="1"
                max="1440"
                class="input"
              >
            </div>
            <div class="field">
              <label for="org-retention">Журнал входов хранится, дней</label>
              <input
                id="org-retention"
                v-model.number="settings.loginRetentionDays"
                type="number"
                min="30"
                max="3650"
                class="input"
              >
            </div>
          </div>
          <span
            id="org-lock-hint"
            class="field-hint"
          >Блокировка — после стольких неудачных попыток подряд (0 — без блокировки, иначе от 3); снимает кадровая служба в карточке сотрудника или она истекает сама. Политика паролей действует для новых паролей.</span>
        </fieldset>
        <fieldset class="security">
          <legend class="field-label">
            Реквизиты для графика отпусков (форма Т-7)
          </legend>
          <div class="field legend-gap">
            <label for="org-name">Наименование организации</label>
            <input
              id="org-name"
              v-model="settings.orgName"
              class="input"
              maxlength="300"
            >
          </div>
          <div class="security-grid">
            <div class="field">
              <label for="org-okpo">Код по ОКПО</label>
              <input
                id="org-okpo"
                v-model="settings.orgOkpo"
                class="input"
                inputmode="numeric"
                pattern="\d{8}|\d{10}"
                maxlength="10"
                style="max-width: 160px"
              >
            </div>
            <span />
            <div class="field">
              <label for="org-head-pos">Утверждает: должность руководителя</label>
              <input
                id="org-head-pos"
                v-model="settings.headPosition"
                class="input"
                maxlength="128"
                placeholder="Генеральный директор"
              >
            </div>
            <div class="field">
              <label for="org-head">Утверждает: фамилия и инициалы</label>
              <input
                id="org-head"
                v-model="settings.headName"
                class="input"
                maxlength="128"
              >
            </div>
            <div class="field">
              <label for="org-hr-pos">Руководитель кадровой службы: должность</label>
              <input
                id="org-hr-pos"
                v-model="settings.hrHeadPosition"
                class="input"
                maxlength="128"
                placeholder="Начальник отдела кадров"
              >
            </div>
            <div class="field">
              <label for="org-hr">Руководитель кадровой службы: фамилия и инициалы</label>
              <input
                id="org-hr"
                v-model="settings.hrHeadName"
                class="input"
                maxlength="128"
              >
            </div>
          </div>
        </fieldset>
        <fieldset class="security">
          <legend class="field-label">
            Структура компании
          </legend>
          <div class="field legend-gap">
            <label for="org-depth">Наибольшая глубина, уровней</label>
            <input
              id="org-depth"
              v-model.number="settings.orgMaxDepth"
              type="number"
              min="2"
              max="30"
              class="input"
              style="max-width: 120px"
            >
          </div>
          <div class="field">
            <span class="field-label">Виды уровней</span>
            <div
              v-for="(k, i) in kinds"
              :key="i"
              class="kind-row"
            >
              <input
                v-model="k.color"
                type="color"
                class="kind-color"
                :aria-label="`Цвет: ${k.label || k.value}`"
              >
              <input
                v-model="k.label"
                class="input"
                maxlength="40"
                required
                :aria-label="`Название вида ${k.value}`"
              >
              <input
                v-if="k.fresh"
                v-model="k.value"
                class="input mono kind-code"
                pattern="[a-z][a-z0-9_\-]{0,31}"
                required
                aria-label="Код вида — латиницей"
              >
              <span
                v-else
                class="mono soft small kind-code"
              >{{ k.value }}</span>
              <button
                class="btn btn-icon btn-sm btn-ghost btn-danger"
                type="button"
                :disabled="kinds.length <= 1"
                :title="`Убрать «${k.label || k.value}»`"
                @click="kinds.splice(i, 1)"
              >
                <AppIcon
                  name="trash"
                  :size="14"
                />
              </button>
            </div>
            <button
              class="btn btn-sm btn-ghost add-kind"
              type="button"
              @click="addKind"
            >
              <AppIcon
                name="plus"
                :size="14"
              /> Вид уровня
            </button>
            <span class="field-hint">Как в «По Делу»: код переносится в файлах структуры. Вид, который носят подразделения, убрать нельзя.</span>
          </div>
        </fieldset>
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

.sessions {
  list-style: none;
  margin: 0;
  padding: 0;
}

.session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
}

.session:first-child {
  border-top: none;
}

.session-device {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-weight: 600;
}

.sessions-hint {
  border-top: 1px solid var(--color-border);
}

.security {
  border: none;
  padding: 0;
  margin: 4px 0 16px;
}

.legend-gap {
  margin-top: 8px;
}

.kind-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 120px 32px;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.kind-color {
  width: 36px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-surface);
  cursor: pointer;
}

.add-kind {
  align-self: flex-start;
}

.security-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
  margin-top: 8px;
}

@media (max-width: 600px) {
  .security-grid {
    grid-template-columns: 1fr;
  }

  .session {
    padding: 12px 16px;
  }
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
  height: 24px; /* цель нажатия (WCAG 2.5.8); по умолчанию 16 px */
  accent-color: var(--color-primary);
}

@media (max-width: 900px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
