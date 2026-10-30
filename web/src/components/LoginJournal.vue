<script setup lang="ts">
// Журнал входов (v0.6.0, E62-01): успешные и неуспешные попытки, блокировки, повтор refresh-токена.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, type LoginEvent, type LoginResult, type Page } from '@/api/client';
import { fmtDateTime, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';

const PER_PAGE = 50;
const items = ref<LoginEvent[]>([]);
const total = ref(0);
const page = ref(1);
const login = ref('');
const result = ref<'' | 'failed' | LoginResult>('');
const from = ref('');
const to = ref('');
const loading = ref(true);
const error = ref('');

const RESULTS: Record<LoginResult, { label: string; tone: string }> = {
  success: { label: 'Вход', tone: 'success' },
  sso_success: { label: 'Единый вход', tone: 'success' },
  bad_password: { label: 'Неверный пароль', tone: 'warning' },
  unknown_login: { label: 'Неизвестный логин', tone: 'warning' },
  locked: { label: 'Блокировка', tone: 'danger' },
  rate_limited: { label: 'Отказ по частоте', tone: 'danger' },
  password_disabled: { label: 'Пароль отключён', tone: 'muted' },
  sso_unknown: { label: 'Единый вход: не найден', tone: 'warning' },
  refresh_reuse: { label: 'Повтор токена — сеанс завершён', tone: 'danger' },
};

const pages = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)));

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) });
    if (login.value.trim()) q.set('login', login.value.trim());
    if (result.value === 'failed') q.set('failed', 'true');
    else if (result.value) q.set('result', result.value);
    if (from.value) q.set('from', from.value);
    if (to.value) q.set('to', to.value);
    const data = await api.get<Page<LoginEvent>>(`/login-events?${q}`);
    items.value = data.items;
    total.value = data.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

let timer = 0;
watch(login, () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { page.value = 1; void reload(); }, 300);
});
watch([result, from, to], () => { page.value = 1; void reload(); });
watch(page, reload);
onMounted(reload);
onBeforeUnmount(() => window.clearTimeout(timer));
</script>

<template>
  <div>
    <div class="filters">
      <div class="input-icon grow">
        <AppIcon
          name="search"
          :size="15"
        />
        <input
          v-model="login"
          class="input"
          type="search"
          placeholder="Логин"
          aria-label="Логин"
        >
      </div>
      <select
        v-model="result"
        class="input"
        aria-label="Результат"
      >
        <option value="">
          Все попытки
        </option>
        <option value="failed">
          Только неудачные
        </option>
        <option
          v-for="(r, key) in RESULTS"
          :key="key"
          :value="key"
        >
          {{ r.label }}
        </option>
      </select>
      <input
        v-model="from"
        class="input"
        type="date"
        aria-label="С даты"
      >
      <input
        v-model="to"
        class="input"
        type="date"
        aria-label="По дату"
      >
    </div>

    <div
      v-if="error"
      class="banner banner-error"
      role="alert"
    >
      <AppIcon
        name="warning"
        :size="15"
      /> {{ error }}
    </div>

    <div class="card">
      <div
        v-if="loading"
        class="card-body"
      >
        <div
          v-for="i in 8"
          :key="i"
          class="skeleton"
          style="height: 36px; margin-bottom: 8px"
        />
      </div>
      <EmptyState
        v-else-if="!items.length"
        icon="shield"
        title="Попыток входа нет"
        text="Измените фильтры или период."
      />
      <div
        v-else
        class="table-scroll scroll-thin"
      >
        <table class="data-table">
          <caption class="sr-only">
            Журнал входов, {{ total }} {{ plural(total, ['запись', 'записи', 'записей']) }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                Время
              </th>
              <th scope="col">
                Сотрудник
              </th>
              <th scope="col">
                Результат
              </th>
              <th
                scope="col"
                class="hide-mobile"
              >
                Устройство
              </th>
              <th
                scope="col"
                class="hide-mobile"
              >
                Адрес
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in items"
              :key="e.id"
            >
              <td class="nowrap small">
                {{ fmtDateTime(e.ts) }}
              </td>
              <td>
                <div>{{ e.employeeName ?? '—' }}</div>
                <div class="mono soft small">
                  {{ e.login || '—' }}
                </div>
              </td>
              <td>
                <span
                  class="badge"
                  :class="`badge-${RESULTS[e.result]?.tone ?? 'muted'}`"
                >{{ RESULTS[e.result]?.label ?? e.result }}</span>
              </td>
              <td class="small hide-mobile">
                {{ e.device }}
              </td>
              <td class="mono small hide-mobile">
                {{ e.ip ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="pages > 1"
        class="pager"
      >
        <span class="muted small">Стр. {{ page }} из {{ pages }} · {{ total }} {{ plural(total, ['запись', 'записи', 'записей']) }}</span>
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
            /> Новее
          </button>
          <button
            class="btn btn-sm"
            type="button"
            :disabled="page >= pages"
            @click="page++"
          >
            Старше <AppIcon
              name="chevronRight"
              :size="14"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.filters .input {
  width: auto;
}

.filters .grow {
  flex: 1 1 200px;
}

.filters .grow .input {
  width: 100%;
}

.nowrap {
  white-space: nowrap;
}

.table-scroll {
  overflow-x: auto;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
}

@media (max-width: 600px) {
  .filters .input,
  .filters > * {
    flex: 1 1 100%;
    width: 100%;
  }
}
</style>
