<script setup lang="ts">
// Журнал извещений о начале отпуска (v0.6.0, E60-04): кто извещён, кто подтвердил ознакомление,
// по кому до начала отпуска осталось три дня и меньше, а подписи нет.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, type Department, type Page, type VacationNotice } from '@/api/client';
import { indented } from '@/lib/departments';
import { useUiStore } from '@/stores/ui';
import { addDays, fmtDateTime, fmtNumber, fmtRange, localIso, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';

type Status = '' | 'pending' | 'overdue' | 'acknowledged';

const PER_PAGE = 50;
const ui = useUiStore();
const today = localIso(new Date());
const from = ref(today);
const to = ref(addDays(today, 60));
const status = ref<Status>('');
const dept = ref('');
const departments = ref<Department[]>([]);
const items = ref<VacationNotice[]>([]);
const total = ref(0);
const unacknowledged = ref(0);
const page = ref(1);
const loading = ref(true);
const error = ref('');
const exporting = ref(false);

const pages = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)));
const rangeOk = computed(() => !!from.value && !!to.value && from.value <= to.value);

function state(n: VacationNotice): { label: string; tone: string } {
  if (n.withdrawnAt) return { label: 'Отозвано', tone: 'muted' };
  if (n.acknowledgedAt) return { label: `Ознакомлен ${fmtDateTime(n.acknowledgedAt)}`, tone: 'success' };
  if (n.overdue) return { label: 'Нет подписи — скоро отпуск', tone: 'danger' };
  if (n.start <= today) return { label: 'Не подтверждено', tone: 'warning' };
  return { label: 'Ждёт ознакомления', tone: 'warning' };
}

async function reload(): Promise<void> {
  if (!rangeOk.value) return;
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ from: from.value, to: to.value, page: String(page.value), per_page: String(PER_PAGE) });
    if (status.value) q.set('status', status.value);
    if (dept.value) q.set('dept', dept.value);
    const data = await api.get<Page<VacationNotice> & { unacknowledged: number }>(`/notices?${q}`);
    items.value = data.items;
    total.value = data.meta.total;
    unacknowledged.value = data.unacknowledged;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function exportXlsx(): Promise<void> {
  exporting.value = true;
  try {
    const blob = await api.download(`/reports/notices?from=${from.value}&to=${to.value}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `izveshcheniya-${from.value}_${to.value}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    ui.toast('Выгрузка сформирована');
  } catch (e) {
    ui.error(e);
  } finally {
    exporting.value = false;
  }
}

let timer = 0;
watch([from, to, status, dept], () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { page.value = 1; void reload(); }, 200);
});
watch(page, reload);
onMounted(async () => {
  void reload();
  try { departments.value = await api.get<Department[]>('/departments'); } catch { /* без фильтра по отделу */ }
});
onBeforeUnmount(() => window.clearTimeout(timer));
</script>

<template>
  <div>
    <div class="filters">
      <div class="field-inline">
        <label for="nj-from">С</label>
        <input
          id="nj-from"
          v-model="from"
          class="input"
          type="date"
        >
      </div>
      <div class="field-inline">
        <label for="nj-to">по</label>
        <input
          id="nj-to"
          v-model="to"
          class="input"
          type="date"
          :min="from"
        >
      </div>
      <select
        v-model="status"
        class="input"
        aria-label="Состояние"
      >
        <option value="">
          Все извещения
        </option>
        <option value="pending">
          Ждут ознакомления
        </option>
        <option value="overdue">
          Нет подписи — скоро отпуск
        </option>
        <option value="acknowledged">
          Ознакомлены
        </option>
      </select>
      <select
        v-model="dept"
        class="input"
        aria-label="Подразделение"
      >
        <option value="">
          Все подразделения
        </option>
        <option
          v-for="d in departments"
          :key="d.id"
          :value="d.label"
        >
          {{ indented(d) }}
        </option>
      </select>
      <button
        class="btn export"
        type="button"
        :disabled="!rangeOk || exporting"
        @click="exportXlsx"
      >
        <AppIcon
          name="download"
          :size="15"
        /> XLSX
      </button>
    </div>

    <p
      v-if="!rangeOk"
      class="soft small"
      role="status"
    >
      Дата окончания периода раньше даты начала.
    </p>

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
      <div class="card-header">
        <span
          v-if="rangeOk"
          class="section-title"
        >Начало отпуска: {{ fmtRange(from, to) }}</span>
        <span
          v-if="!loading"
          class="badge"
          :class="unacknowledged ? 'badge-warning' : 'badge-success'"
        >{{ unacknowledged ? `не подтверждено: ${unacknowledged}` : 'все подтвердили' }}</span>
      </div>
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
        v-else-if="!items.length"
        icon="signature"
        title="Извещений нет"
        text="Извещение уходит само за две недели до начала согласованного отпуска. Измените период или фильтры."
      />
      <div
        v-else
        class="table-scroll scroll-thin"
      >
        <table class="data-table">
          <caption class="sr-only">
            Журнал извещений, {{ total }} {{ plural(total, ['запись', 'записи', 'записей']) }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                Сотрудник
              </th>
              <th scope="col">
                Отпуск
              </th>
              <th
                scope="col"
                class="hide-mobile"
              >
                Извещён
              </th>
              <th scope="col">
                Ознакомление
              </th>
              <th scope="col">
                <span class="sr-only">Печать</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="n in items"
              :key="n.id"
              :class="{ withdrawn: !!n.withdrawnAt }"
            >
              <td class="emp">
                <div>{{ n.employeeName }}</div>
                <div class="soft small">
                  {{ [n.position, n.dept].filter(Boolean).join(' · ') || '—' }}
                </div>
              </td>
              <td class="period nowrap">
                {{ fmtRange(n.start, n.end) }}
                <div class="soft small">
                  {{ fmtNumber(n.days) }} дн.
                </div>
              </td>
              <td class="small hide-mobile">
                {{ fmtDateTime(n.sentAt) }}
                <div v-if="n.late">
                  <span
                    class="badge badge-warning"
                    title="Позже чем за две недели до начала: работник вправе попросить перенос (ст. 124 ТК РФ)"
                  >позже 14 дней</span>
                </div>
              </td>
              <td class="state">
                <span
                  class="badge"
                  :class="`badge-${state(n).tone}`"
                >{{ state(n).label }}</span>
              </td>
              <td class="actions">
                <router-link
                  class="btn btn-icon btn-sm btn-ghost"
                  :to="`/notices/${n.id}/print`"
                  :aria-label="`Извещение для печати: ${n.employeeName}`"
                  title="Для печати"
                >
                  <AppIcon
                    name="printer"
                    :size="15"
                  />
                </router-link>
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
            /> Назад
          </button>
          <button
            class="btn btn-sm"
            type="button"
            :disabled="page >= pages"
            @click="page++"
          >
            Далее <AppIcon
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
  align-items: center;
  margin-bottom: 12px;
}

.filters .input {
  width: auto;
}

.filters select.input {
  flex: 0 1 220px;
  min-width: 0;
}

.filters .export {
  margin-left: auto;
}

.field-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-inline label {
  color: var(--color-text-muted);
  font-size: 13px;
}

.nowrap {
  white-space: nowrap;
}

.table-scroll {
  overflow-x: auto;
}

.actions {
  width: 1%;
  text-align: right;
}

tr.withdrawn td:not(.actions) {
  color: var(--color-text-muted);
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
  .filters > *,
  .filters .input,
  .filters select.input {
    flex: 1 1 100%;
    width: 100%;
  }

  .field-inline .input {
    flex: 1 1 auto;
  }

  .filters .export {
    margin-left: 0;
  }

  /* Телефон: строка журнала — карточка (сотрудник, отпуск, ознакомление) без горизонтальной прокрутки */
  .data-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  .data-table,
  .data-table tbody {
    display: block;
  }

  .data-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--color-border);
  }

  .data-table tbody tr:last-child {
    border-bottom: none;
  }

  .data-table td {
    display: block;
    padding: 0;
    border: none;
  }

  .data-table td.emp { grid-column: 1; grid-row: 1; }
  .data-table td.actions { grid-column: 2; grid-row: 1; }
  .data-table td.period { grid-column: 1 / -1; }
  .data-table td.state { grid-column: 1 / -1; }

  .data-table .period .soft {
    display: inline;
    margin-left: 4px;
  }
}
</style>
