<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, type AccountSecurity, type Department, type Employee, type Page } from '@/api/client';
import { useUiStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';
import { fmtDateTime, fmtNumber, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import VacationForm from '@/components/VacationForm.vue';
import ImportDialog from '@/components/ImportDialog.vue';
import DelegationEditor from '@/components/DelegationEditor.vue';
import { vDialog } from '@/directives/dialog';

const ui = useUiStore();
const auth = useAuthStore();
/** Кадровая служба не меняет учётные записи администраторов и коллег по службе — сервер проверяет то же. */
const canTouch = (e: Employee) => auth.isAdmin || (!e.isAdmin && (!e.isHr || e.id === auth.me?.employee.id));
const PER_PAGE = 50;

const employees = ref<Employee[]>([]);
const total = ref(0);
const departments = ref<Department[]>([]);
const search = ref('');
const dept = ref('');
const page = ref(1);
const loading = ref(true);
const error = ref('');

const pages = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)));
// Политика паролей организации (v0.6.0): подсказка в форме; проверяет сервер
const passwordMin = ref(8);
// Учётная запись в карточке: последний вход, блокировка, одноразовый пароль, сеансы (v0.6.0)
const security = ref<AccountSecurity | null>(null);
const securityBusy = ref(false);

// ── Форма сотрудника
const formOpen = ref(false);
const editing = ref<Employee | null>(null);
const busy = ref(false);
const formError = ref('');
const managers = ref<Employee[]>([]);
const emptyForm = () => ({
  name: '', email: '', position: '', deptId: null as number | null, managerId: null as number | null,
  role: 'employee', empType: 'staff', isAdmin: false, isHr: false, plannedDays: 28, carryOver: 0, login: '', password: '',
  personnelNumber: '',
});
const form = ref(emptyForm());
const secret = ref<{ title: string; login: string; password: string } | null>(null);
const vacationFor = ref<Employee | null>(null);
const importOpen = ref(false);

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) });
    if (search.value.trim()) q.set('search', search.value.trim());
    if (dept.value) q.set('dept', dept.value);
    const data = await api.get<Page<Employee>>(`/employees?${q}`);
    employees.value = data.items;
    total.value = data.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

let searchTimer = 0;
watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => { page.value = 1; void reload(); }, 300);
});
watch(dept, () => { page.value = 1; void reload(); });
watch(page, reload);

/** Кандидаты в руководители — сотрудники выбранного отдела. */
async function loadManagers(deptId: number | null): Promise<void> {
  const d = departments.value.find((x) => x.id === deptId);
  if (!d) { managers.value = []; return; }
  try {
    const data = await api.get<Page<Employee>>(`/employees?dept=${encodeURIComponent(d.name)}&per_page=200`);
    const list = data.items.filter((e) => e.id !== editing.value?.id);
    // Руководитель из другого отдела (руководитель направления) остаётся в списке, а не пустым полем
    const current = form.value.managerId;
    if (current && !list.some((e) => e.id === current)) {
      const m = await api.get<Employee>(`/employees/${current}`).catch(() => null);
      if (m) list.unshift(m);
    }
    managers.value = list;
  } catch { managers.value = []; }
}
watch(() => form.value.deptId, (id) => { if (formOpen.value) void loadManagers(id); });

function openCreate(): void {
  editing.value = null;
  form.value = emptyForm();
  formError.value = '';
  formOpen.value = true;
}

function openEdit(e: Employee): void {
  editing.value = e;
  form.value = {
    name: e.name, email: e.email ?? '', position: e.position ?? '', deptId: e.deptId, managerId: e.managerId,
    role: e.role, empType: e.empType, isAdmin: e.isAdmin, isHr: e.isHr, plannedDays: e.plannedDays, carryOver: e.carryOver,
    login: e.login, password: '', personnelNumber: e.personnelNumber ?? '',
  };
  formError.value = '';
  formOpen.value = true;
  void loadManagers(e.deptId);
  void loadSecurity(e);
}

async function loadSecurity(e: Employee): Promise<void> {
  security.value = null;
  if (!canTouch(e)) return;
  try {
    security.value = await api.get<AccountSecurity>(`/employees/${e.id}/security`);
  } catch { /* блок учётной записи не показывается */ }
}

async function unlock(): Promise<void> {
  const e = editing.value;
  if (!e) return;
  securityBusy.value = true;
  try {
    await api.post(`/employees/${e.id}/unlock`);
    ui.toast(`${e.name}: блокировка входа снята`);
    await loadSecurity(e);
  } catch (err) {
    ui.error(err);
  } finally {
    securityBusy.value = false;
  }
}

async function endSessions(): Promise<void> {
  const e = editing.value;
  if (!e) return;
  const answer = await ui.ask({
    title: `Завершить все сеансы — ${e.name}?`,
    text: 'Сотрудник выйдет на всех устройствах в течение 10 секунд; пароль не меняется.',
    confirmLabel: 'Завершить сеансы',
    danger: true,
  });
  if (!answer.ok) return;
  securityBusy.value = true;
  try {
    const r = await api.post<{ revoked: number }>(`/employees/${e.id}/sessions/revoke`);
    ui.toast(`Завершено сеансов: ${r.revoked}`);
    await loadSecurity(e);
  } catch (err) {
    ui.error(err);
  } finally {
    securityBusy.value = false;
  }
}

async function save(): Promise<void> {
  busy.value = true;
  formError.value = '';
  const f = form.value;
  const payload = {
    name: f.name.trim(), email: f.email.trim() || (editing.value ? null : undefined), position: f.position.trim() || undefined, deptId: f.deptId, managerId: f.managerId,
    role: f.role, empType: f.empType,
    // служебные права выдаёт только администратор
    ...(auth.isAdmin ? { isAdmin: f.isAdmin, isHr: f.isHr } : {}),
    // Дни — до сотых, как в импорте: округление до целых меняло перенос 3,5 → 4 при любой правке карточки
    plannedDays: Math.round(Number(f.plannedDays) * 100) / 100, carryOver: Math.round(Number(f.carryOver) * 100) / 100,
    // Пустое поле в карточке — очистить номер; при создании — не передавать
    personnelNumber: f.personnelNumber.trim() || (editing.value ? null : undefined),
  };
  try {
    if (editing.value) {
      await api.patch(`/employees/${editing.value.id}`, payload);
      ui.toast('Изменения сохранены');
    } else {
      const created = await api.post<{ employee: Employee; generatedPassword?: string }>('/employees', {
        ...payload,
        deptId: f.deptId ?? undefined,
        managerId: f.managerId ?? undefined,
        ...(f.login.trim() ? { login: f.login.trim() } : {}),
        ...(f.password ? { password: f.password } : {}),
      });
      if (created.generatedPassword) {
        secret.value = { title: 'Сотрудник создан', login: created.employee.login, password: created.generatedPassword };
      } else {
        ui.toast('Сотрудник создан');
      }
    }
    formOpen.value = false;
    await reload();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function resetPassword(e: Employee): Promise<void> {
  const answer = await ui.ask({
    title: `Сбросить пароль — ${e.name}?`,
    text: 'Будет выдан новый одноразовый пароль — сотрудник сменит его при первом входе; текущие сеансы завершатся.',
    confirmLabel: 'Сбросить пароль',
  });
  if (!answer.ok) return;
  try {
    // Пароль выдаёт сервер: не короче политики организации и с требованием сменить при первом входе
    const r = await api.post<{ temporaryPassword: string }>(`/employees/${e.id}/password-reset`);
    secret.value = { title: 'Пароль сброшен', login: e.login, password: r.temporaryPassword };
  } catch (err) {
    ui.error(err);
  }
}

async function dismiss(e: Employee): Promise<void> {
  const answer = await ui.ask({
    title: `Уволить ${e.name}?`,
    text: 'Учётная запись будет отключена. История отпусков и журнал аудита сохранятся.',
    confirmLabel: 'Уволить',
    danger: true,
  });
  if (!answer.ok) return;
  try {
    await api.del(`/employees/${e.id}`);
    ui.toast(`${e.name}: учётная запись отключена`, 'info');
    await reload();
  } catch (err) {
    ui.error(err);
  }
}

async function copySecret(): Promise<void> {
  if (!secret.value) return;
  try {
    await navigator.clipboard.writeText(`Логин: ${secret.value.login}\nПароль: ${secret.value.password}`);
    ui.toast('Скопировано в буфер обмена');
  } catch {
    ui.toast('Не удалось скопировать — выделите текст вручную', 'error');
  }
}

onMounted(async () => {
  void reload();
  api.get<{ minLength: number }>('/auth/password-policy').then((p) => { passwordMin.value = p.minLength; }).catch(() => undefined);
  try {
    departments.value = await api.get<Department[]>('/departments');
  } catch { /* фильтр необязателен */ }
});
</script>

<template>
  <div class="page">
    <div class="view-header">
      <div>
        <div class="view-title">
          Сотрудники
        </div>
        <div class="view-subtitle">
          {{ total }} {{ plural(total, ['активная учётная запись', 'активные учётные записи', 'активных учётных записей']) }}
        </div>
      </div>
      <div class="toolbar">
        <select
          v-model="dept"
          class="input"
          style="width: auto; min-width: 200px"
          aria-label="Отдел"
        >
          <option value="">
            Все отделы
          </option>
          <option
            v-for="d in departments"
            :key="d.name"
            :value="d.name"
          >
            {{ d.name }}
          </option>
        </select>
        <div
          class="input-icon"
          style="width: 260px"
        >
          <AppIcon
            name="search"
            :size="15"
          />
          <input
            v-model="search"
            class="input"
            placeholder="ФИО или должность"
            aria-label="Поиск"
          >
        </div>
        <button
          class="btn"
          type="button"
          title="Импорт сотрудников и остатков из XLSX или CSV"
          @click="importOpen = true"
        >
          <AppIcon
            name="upload"
            :size="15"
          /> Импорт
        </button>
        <button
          class="btn btn-primary"
          type="button"
          @click="openCreate"
        >
          <AppIcon
            name="plus"
            :size="15"
          /> Добавить
        </button>
      </div>
    </div>

    <div
      v-if="error"
      class="banner banner-error"
    >
      <AppIcon
        name="warning"
        :size="15"
      /> {{ error }}
    </div>

    <div class="card table-card">
      <div
        v-if="loading"
        class="card-body"
      >
        <div
          v-for="i in 6"
          :key="i"
          class="skeleton"
          style="height: 36px; margin-bottom: 8px"
        />
      </div>
      <EmptyState
        v-else-if="!employees.length"
        icon="team"
        title="Сотрудники не найдены"
        text="Измените фильтр или строку поиска."
      />
      <div
        v-else
        class="table-scroll scroll-thin"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th class="hide-mobile">
                Отдел
              </th>
              <th class="hide-mobile">
                Роль
              </th>
              <th class="num hide-mobile">
                Норма + перенос
              </th>
              <th class="hide-mobile">
                Логин
              </th>
              <th class="actions" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in employees"
              :key="e.id"
            >
              <td>
                <div class="person">
                  <UserAvatar
                    :name="e.name"
                    :size="32"
                  />
                  <div class="person-text">
                    <span class="person-name">{{ e.name }}</span>
                    <span class="person-sub">{{ e.position ?? '—' }}</span>
                  </div>
                </div>
              </td>
              <td class="muted hide-mobile">
                {{ e.deptName ?? '—' }}
              </td>
              <td class="hide-mobile">
                <div class="roles">
                  <span
                    v-if="e.isAdmin"
                    class="badge badge-violet"
                  >администратор</span>
                  <span
                    v-if="e.isHr"
                    class="badge badge-success"
                  >кадровая служба</span>
                  <span
                    v-if="e.role === 'manager'"
                    class="badge badge-info"
                  >руководитель</span>
                  <span
                    v-if="e.empType === 'ipsz'"
                    class="badge badge-warning"
                  >ИП / самозанятый</span>
                  <span
                    v-if="!e.isAdmin && !e.isHr && e.role !== 'manager' && e.empType !== 'ipsz'"
                    class="soft small"
                  >сотрудник</span>
                </div>
              </td>
              <td class="num hide-mobile norm-cell">
                {{ fmtNumber(e.plannedDays) }}<span
                  v-if="e.carryOver"
                  class="soft small"
                  title="Перенесено с прошлых лет"
                > +{{ fmtNumber(e.carryOver) }}</span>
              </td>
              <td class="hide-mobile">
                <span class="mono muted">{{ e.login }}</span>
              </td>
              <td class="actions">
                <div
                  v-if="!canTouch(e)"
                  class="row-actions"
                >
                  <span
                    class="soft small"
                    title="Учётные записи администраторов и кадровой службы меняет администратор"
                  >
                    <AppIcon
                      name="shield"
                      :size="15"
                    />
                  </span>
                </div>
                <div
                  v-else
                  class="row-actions"
                >
                  <button
                    class="btn btn-icon btn-sm btn-ghost"
                    type="button"
                    title="Изменить"
                    @click="openEdit(e)"
                  >
                    <AppIcon
                      name="edit"
                      :size="15"
                    />
                  </button>
                  <button
                    v-if="e.empType !== 'ipsz' && auth.isAdmin"
                    class="btn btn-icon btn-sm btn-ghost"
                    type="button"
                    title="Оформить отпуск"
                    @click="vacationFor = e"
                  >
                    <AppIcon
                      name="vacation"
                      :size="15"
                    />
                  </button>
                  <button
                    class="btn btn-icon btn-sm btn-ghost"
                    type="button"
                    title="Сбросить пароль"
                    @click="resetPassword(e)"
                  >
                    <AppIcon
                      name="key"
                      :size="15"
                    />
                  </button>
                  <button
                    class="btn btn-icon btn-sm btn-ghost btn-danger"
                    type="button"
                    title="Уволить"
                    @click="dismiss(e)"
                  >
                    <AppIcon
                      name="logout"
                      :size="15"
                    />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="pages > 1"
        class="pager"
      >
        <span class="muted small">{{ (page - 1) * PER_PAGE + 1 }}–{{ Math.min(page * PER_PAGE, total) }} из {{ total }}</span>
        <div class="toolbar">
          <button
            class="btn btn-sm"
            type="button"
            :disabled="page <= 1"
            @click="page--"
          >
            <AppIcon
              name="chevronLeft"
              :size="14"
            /> Назад
          </button>
          <span class="small">Стр. {{ page }} из {{ pages }}</span>
          <button
            class="btn btn-sm"
            type="button"
            :disabled="page >= pages"
            @click="page++"
          >
            Вперёд <AppIcon
              name="chevronRight"
              :size="14"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- форма -->
    <div
      v-if="formOpen"
      class="modal-overlay"
      @click.self="formOpen = false"
    >
      <form
        v-dialog="() => (formOpen = false)"
        class="modal modal-wide"
        role="dialog"
        aria-modal="true"
        @submit.prevent="save"
      >
        <div class="modal-head">
          <div>
            <div class="modal-title">
              {{ editing ? 'Карточка сотрудника' : 'Новый сотрудник' }}
            </div>
            <div class="modal-sub">
              {{ editing ? `Логин ${editing.login}` : 'Логин и одноразовый пароль можно не задавать — сгенерируются автоматически.' }}
            </div>
          </div>
          <button
            class="btn btn-icon btn-ghost"
            type="button"
            aria-label="Закрыть"
            @click="formOpen = false"
          >
            <AppIcon
              name="close"
              :size="16"
            />
          </button>
        </div>
        <div class="modal-body">
          <div
            v-if="formError"
            class="banner banner-error"
          >
            <AppIcon
              name="warning"
              :size="15"
            /> {{ formError }}
          </div>
          <div class="field">
            <label for="e-name">ФИО</label>
            <input
              id="e-name"
              v-model="form.name"
              class="input"
              required
              minlength="3"
              placeholder="Иванов Иван Иванович"
            >
          </div>
          <div class="field-row">
            <div class="field">
              <label for="e-email">Email <span class="soft">(для писем о заявках)</span></label>
              <input
                id="e-email"
                v-model="form.email"
                class="input"
                type="email"
                autocomplete="off"
                placeholder="ivanov@company.ru"
              >
            </div>
            <div class="field">
              <label for="e-tab">Табельный номер</label>
              <input
                id="e-tab"
                v-model="form.personnelNumber"
                class="input"
                maxlength="20"
                autocomplete="off"
                aria-describedby="e-tab-hint"
              >
              <span
                id="e-tab-hint"
                class="field-hint"
              >Графа 4 формы Т-7 «График отпусков».</span>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="e-pos">Должность</label>
              <input
                id="e-pos"
                v-model="form.position"
                class="input"
              >
            </div>
            <div class="field">
              <label for="e-dept">Отдел</label>
              <select
                id="e-dept"
                v-model="form.deptId"
                class="input"
              >
                <option :value="null">
                  Без отдела
                </option>
                <option
                  v-for="d in departments"
                  :key="d.id"
                  :value="d.id"
                >
                  {{ d.name }}
                </option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="e-mgr">Руководитель</label>
              <select
                id="e-mgr"
                v-model="form.managerId"
                class="input"
                :disabled="!form.deptId"
              >
                <option :value="null">
                  Не назначен
                </option>
                <option
                  v-for="m in managers"
                  :key="m.id"
                  :value="m.id"
                >
                  {{ m.name }}
                </option>
              </select>
              <span class="field-hint">Руководитель согласует заявки сотрудника.</span>
            </div>
            <div class="field">
              <label for="e-type">Тип занятости</label>
              <select
                id="e-type"
                v-model="form.empType"
                class="input"
              >
                <option value="staff">
                  Штатный сотрудник
                </option>
                <option value="ipsz">
                  ИП / самозанятый (без отпуска)
                </option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="e-days">Норма дней в год</label>
              <input
                id="e-days"
                v-model.number="form.plannedDays"
                class="input"
                type="number"
                min="0"
                max="365"
                step="0.01"
              >
            </div>
            <div class="field">
              <label for="e-carry">Перенос с прошлых лет</label>
              <input
                id="e-carry"
                v-model.number="form.carryOver"
                class="input"
                type="number"
                min="0"
                max="365"
                step="0.01"
              >
            </div>
          </div>
          <div class="field-row">
            <label class="checkbox">
              <input
                v-model="form.role"
                type="checkbox"
                true-value="manager"
                false-value="employee"
              > Руководитель
            </label>
            <label
              v-if="auth.isAdmin"
              class="checkbox"
            >
              <input
                v-model="form.isHr"
                type="checkbox"
              > Кадровая служба
            </label>
            <label
              v-if="auth.isAdmin"
              class="checkbox"
            >
              <input
                v-model="form.isAdmin"
                type="checkbox"
              > Администратор системы
            </label>
          </div>
          <div
            v-if="!editing"
            class="field-row"
            style="margin-top: 14px"
          >
            <div class="field">
              <label for="e-login">Логин <span class="soft">(необязательно)</span></label>
              <input
                id="e-login"
                v-model="form.login"
                class="input mono"
                placeholder="ivanov.ii"
                autocomplete="off"
              >
            </div>
            <div class="field">
              <label for="e-pass">Пароль <span class="soft">(необязательно)</span></label>
              <input
                id="e-pass"
                v-model="form.password"
                class="input"
                type="password"
                :minlength="passwordMin"
                autocomplete="new-password"
                :placeholder="`не короче ${passwordMin} символов`"
                aria-describedby="e-pass-hint"
              >
              <span
                id="e-pass-hint"
                class="field-hint"
              >Одноразовый: сотрудник сменит его при первом входе. Без логина и фамилии, не из распространённых.</span>
            </div>
          </div>
          <section
            v-if="editing && editing.role === 'manager'"
            class="account"
            aria-labelledby="deleg-card-title"
          >
            <div
              id="deleg-card-title"
              class="field-label"
            >
              Замещение руководителя
            </div>
            <DelegationEditor :manager-id="editing.id" />
          </section>
          <section
            v-if="editing && security"
            class="account"
            aria-labelledby="acc-title"
          >
            <div
              id="acc-title"
              class="field-label"
            >
              Учётная запись
            </div>
            <dl class="account-grid">
              <div>
                <dt>Последний вход</dt>
                <dd>{{ security.lastLoginAt ? fmtDateTime(security.lastLoginAt) : 'ещё не входил' }}</dd>
              </div>
              <div>
                <dt>Пароль</dt>
                <dd>{{ security.mustChangePassword ? 'одноразовый — сменит при первом входе' : security.passwordChangedAt ? `сменён ${fmtDateTime(security.passwordChangedAt)}` : 'задан' }}</dd>
              </div>
              <div>
                <dt>Вход</dt>
                <dd>
                  <span
                    v-if="security.lockedUntil"
                    class="badge badge-danger"
                  >заблокирован до {{ fmtDateTime(security.lockedUntil) }}</span>
                  <template v-else>
                    доступен<template v-if="security.failedLogins">
                      · неудачных попыток подряд: {{ security.failedLogins }}
                    </template>
                  </template>
                </dd>
              </div>
              <div>
                <dt>Активные сеансы</dt>
                <dd>{{ security.activeSessions }}</dd>
              </div>
            </dl>
            <div
              v-if="security.lockedUntil || security.activeSessions"
              class="account-actions"
            >
              <button
                v-if="security.lockedUntil"
                class="btn btn-sm"
                type="button"
                :disabled="securityBusy"
                @click="unlock"
              >
                Снять блокировку
              </button>
              <button
                v-if="security.activeSessions"
                class="btn btn-sm btn-danger"
                type="button"
                :disabled="securityBusy"
                @click="endSessions"
              >
                Завершить все сеансы
              </button>
            </div>
          </section>
        </div>
        <div class="modal-actions">
          <button
            class="btn"
            type="button"
            @click="formOpen = false"
          >
            Отмена
          </button>
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="busy || form.name.trim().length < 3"
          >
            {{ busy ? 'Сохраняем…' : editing ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </form>
    </div>

    <ImportDialog
      v-if="importOpen"
      @close="importOpen = false"
      @done="reload"
    />

    <VacationForm
      v-if="vacationFor"
      :employees="[vacationFor]"
      @close="vacationFor = null"
      @saved="vacationFor = null; ui.toast('Отпуск оформлен и согласован')"
    />

    <!-- одноразовый пароль -->
    <div
      v-if="secret"
      class="modal-overlay"
    >
      <!-- Одноразовый пароль показывается один раз: Esc окно не закрывает, только «Готово» -->
      <div
        v-dialog="() => undefined"
        class="modal"
        role="dialog"
        aria-modal="true"
      >
        <div class="modal-head">
          <div>
            <div class="modal-title">
              {{ secret.title }}
            </div>
            <div class="modal-sub">
              Передайте данные сотруднику лично. Пароль показывается один раз и нигде не хранится в открытом виде.
            </div>
          </div>
        </div>
        <div class="modal-body">
          <div class="secret">
            <div><span class="muted">Логин</span><strong class="mono">{{ secret.login }}</strong></div>
            <div><span class="muted">Пароль</span><strong class="mono">{{ secret.password }}</strong></div>
          </div>
        </div>
        <div class="modal-actions">
          <button
            class="btn"
            type="button"
            @click="copySecret"
          >
            <AppIcon
              name="download"
              :size="14"
            /> Скопировать
          </button>
          <button
            class="btn btn-primary"
            type="button"
            @click="secret = null"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
  margin: 8px 0 0;
}

.account-grid dt {
  font-size: 12px;
  color: var(--color-text-muted);
}

.account-grid dd {
  margin: 2px 0 0;
  font-size: 13.5px;
}

.account-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

@media (max-width: 600px) {
  .account-grid {
    grid-template-columns: 1fr;
  }
}

.table-card {
  overflow: hidden;
}

.table-scroll {
  overflow: auto;
  max-height: calc(100dvh - 230px);
}

.roles {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

.secret {
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  background: var(--color-surface-2);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.secret div {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.secret strong {
  font-size: 15px;
  user-select: all;
}
.norm-cell {
  white-space: nowrap;
}
</style>
