<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Department, type Employee, type Page } from '@/api/client';
import AppIcon from '@/components/common/AppIcon.vue';

const employees = ref<Employee[]>([]);
const total = ref(0);
const departments = ref<Department[]>([]);
const search = ref('');
const page = ref(1);
const loading = ref(true);
const error = ref('');

const showModal = ref(false);
const editing = ref<Employee | null>(null);
const form = ref({ name: '', position: '', deptId: '' as string, login: '', password: '', plannedDays: '28' });
const generated = ref('');
const busy = ref(false);

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ page: String(page.value), per_page: '50' });
    if (search.value.trim()) q.set('search', search.value.trim());
    const data = await api.get<Page<Employee>>(`/employees?${q}`);
    employees.value = data.items;
    total.value = data.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  form.value = { name: '', position: '', deptId: '', login: '', password: '', plannedDays: '28' };
  generated.value = '';
  showModal.value = true;
}

function openEdit(e: Employee): void {
  editing.value = e;
  form.value = {
    name: e.name, position: e.position ?? '', deptId: e.deptId ? String(e.deptId) : '',
    login: '', password: '', plannedDays: String(e.plannedDays),
  };
  generated.value = '';
  showModal.value = true;
}

async function save(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const payload: Record<string, unknown> = {
      name: form.value.name.trim(),
      position: form.value.position.trim() || undefined,
      deptId: form.value.deptId ? Number(form.value.deptId) : null,
    };
    if (editing.value) {
      await api.patch(`/employees/${editing.value.id}`, { ...payload, plannedDays: Number(form.value.plannedDays) });
    } else {
      const created = await api.post<{ employee: Employee; generatedPassword?: string }>('/employees', {
        ...payload,
        plannedDays: Number(form.value.plannedDays),
        ...(form.value.login.trim() ? { login: form.value.login.trim() } : {}),
        ...(form.value.password ? { password: form.value.password } : {}),
      });
      if (created.generatedPassword) generated.value = created.generatedPassword;
    }
    if (!generated.value) {
      showModal.value = false;
      await reload();
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function deactivate(e: Employee): Promise<void> {
  if (!confirm(`Уволить ${e.name}? История сохранится.`)) return;
  try {
    await api.del(`/employees/${e.id}`);
    await reload();
  } catch (err) {
    alert((err as Error).message);
  }
}

onMounted(async () => {
  await reload();
  departments.value = await api.get<Department[]>('/departments');
});
</script>

<template>
  <div>
    <div class="view-header">
      <div>
        <div class="view-title">
          Сотрудники
        </div>
        <div class="view-subtitle">
          {{ total }} активных
        </div>
      </div>
      <div class="view-controls">
        <input
          v-model="search"
          class="input"
          style="width: 220px"
          placeholder="Поиск…"
          @keyup.enter="page = 1; reload()"
        >
        <button
          class="btn"
          @click="page = 1; reload()"
        >
          Найти
        </button>
        <button
          class="btn btn-primary"
          @click="openCreate"
        >
          <AppIcon
            name="plus"
            :size="14"
          /> Сотрудник
        </button>
      </div>
    </div>

    <div
      v-if="error"
      class="error-banner"
    >
      {{ error }}
    </div>
    <div
      v-if="loading"
      class="empty-state"
    >
      Загрузка…
    </div>

    <div
      v-else
      class="card"
    >
      <div class="grid-table">
        <div
          class="grid-head"
          style="grid-template-columns: 1.6fr 1.2fr 1.2fr 90px 120px 110px"
        >
          <div>ФИО</div><div>Должность</div><div>Отдел</div><div>Дней</div><div>Логин</div><div />
        </div>
        <div
          v-for="e in employees"
          :key="e.id"
          class="grid-row"
          style="grid-template-columns: 1.6fr 1.2fr 1.2fr 90px 120px 110px"
        >
          <div>
            {{ e.name }}
            <span
              v-if="e.isAdmin"
              class="badge badge-info"
            >админ</span>
            <span
              v-else-if="e.role === 'manager'"
              class="badge badge-muted"
            >рук.</span>
          </div>
          <div class="muted">
            {{ e.position ?? '—' }}
          </div>
          <div class="muted">
            {{ e.deptName ?? '—' }}
          </div>
          <div>{{ e.plannedDays }}</div>
          <code class="muted">{{ e.login }}</code>
          <div style="display: flex; gap: 6px">
            <button
              class="btn btn-sm"
              @click="openEdit(e)"
            >
              Править
            </button>
            <button
              class="btn btn-sm btn-danger"
              @click="deactivate(e)"
            >
              Уволить
            </button>
          </div>
        </div>
      </div>
      <div
        v-if="!employees.length"
        class="empty-state"
      >
        Никого не найдено
      </div>
      <div
        v-if="total > 50"
        class="pager"
      >
        <button
          class="btn btn-sm"
          :disabled="page <= 1"
          @click="page--; reload()"
        >
          ←
        </button>
        <span class="muted">стр. {{ page }} из {{ Math.ceil(total / 50) }}</span>
        <button
          class="btn btn-sm"
          :disabled="page >= Math.ceil(total / 50)"
          @click="page++; reload()"
        >
          →
        </button>
      </div>
    </div>

    <div
      v-if="showModal"
      class="modal-overlay"
      @click.self="showModal = false"
    >
      <div class="modal">
        <div class="modal-title">
          {{ editing ? `Правка: ${editing.name}` : 'Новый сотрудник' }}
        </div>
        <div
          v-if="error"
          class="error-banner"
        >
          {{ error }}
        </div>

        <template v-if="!generated">
          <div class="field">
            <label>ФИО</label>
            <input
              v-model="form.name"
              class="input"
            >
          </div>
          <div class="field">
            <label>Должность</label>
            <input
              v-model="form.position"
              class="input"
            >
          </div>
          <div class="field">
            <label>Отдел</label>
            <select
              v-model="form.deptId"
              class="input"
            >
              <option value="">
                Без отдела
              </option>
              <option
                v-for="d in departments"
                :key="d.name"
                :value="d.name"
              >
                {{ d.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label>Плановых дней</label>
            <input
              v-model="form.plannedDays"
              type="number"
              min="0"
              class="input"
            >
          </div>
          <template v-if="!editing">
            <div class="field">
              <label>Логин (пусто — сгенерировать)</label>
              <input
                v-model="form.login"
                class="input"
                placeholder="ivanov.ii"
              >
            </div>
            <div class="field">
              <label>Пароль (пусто — сгенерировать)</label>
              <input
                v-model="form.password"
                type="text"
                class="input"
                minlength="8"
              >
            </div>
          </template>
          <div class="modal-actions">
            <button
              class="btn"
              @click="showModal = false"
            >
              Отмена
            </button>
            <button
              class="btn btn-primary"
              :disabled="busy || form.name.trim().length < 3"
              @click="save"
            >
              Сохранить
            </button>
          </div>
        </template>

        <template v-else>
          <p>Сотрудник создан. Одноразовый пароль (показывается один раз):</p>
          <div class="one-time">
            {{ generated }}
          </div>
          <div class="modal-actions">
            <button
              class="btn btn-primary"
              @click="showModal = false; reload()"
            >
              Готово
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-controls { display: flex; gap: 8px; }
.muted { color: var(--color-text-muted); }
.pager { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.one-time {
  font-family: var(--font-mono);
  font-size: 16px;
  background: var(--color-primary-soft);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  text-align: center;
  user-select: all;
}
</style>
