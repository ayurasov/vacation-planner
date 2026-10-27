<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, daysBetween, fmtRange, type Department, type Schedule, type ScheduleEmployee } from '@/api/client';

const YEAR = new Date().getFullYear();

interface Cell {
  key: string;
  date: string;
  vacation?: { status: string; type: string };
  work?: string;
  weekend?: boolean;
}

const schedule = ref<Schedule | null>(null);
const departments = ref<Department[]>([]);
const deptFilter = ref('');
const search = ref('');
const loading = ref(true);
const error = ref('');
const selected = ref<ScheduleEmployee | null>(null);

// Период: год, разбитый на месяцы (31×12 ячеек максимум на строку — читаемо и быстро)
const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

const daysInMonth = (m: number) => new Date(YEAR, m + 1, 0).getDate();
const totalDays = computed(() => Array.from({ length: 12 }, (_, m) => daysInMonth(m)).reduce((a, b) => a + b, 0));

function cellFor(e: ScheduleEmployee, month: number, day: number): Cell {
  const date = `${YEAR}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const wd = new Date(YEAR, month, day).getDay();
  const cell: Cell = { key: `${e.id}-${date}`, date, weekend: wd === 0 || wd === 6 };
  for (const v of e.vacations) {
    if (date >= v.start && date <= v.end) {
      cell.vacation = { status: v.status, type: v.type };
      break;
    }
  }
  if (!cell.vacation && e.workOverrides.length) {
    const o = e.workOverrides.find((w) => w.date === date);
    if (o) cell.work = o.mode;
    else if (e.workPattern[String(wd)]) cell.work = e.workPattern[String(wd)];
  } else if (!cell.vacation && e.workPattern[String(wd)]) {
    cell.work = e.workPattern[String(wd)];
  }
  return cell;
}

const filtered = computed(() => {
  if (!schedule.value) return [];
  let list = schedule.value.employees;
  if (deptFilter.value) list = list.filter((e) => e.dept === deptFilter.value);
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(q) || (e.position ?? '').toLowerCase().includes(q));
  }
  return list;
});

const conflictDates = computed(() => new Set((schedule.value?.conflicts ?? []).map((c) => c.date)));
const hasConflicts = computed(() => conflictDates.value.size > 0);

function isConflict(date: string): boolean {
  return conflictDates.value.has(date);
}

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const from = `${YEAR}-01-01`;
    const to = `${YEAR}-12-31`;
    const query = deptFilter.value ? `&dept=${encodeURIComponent(deptFilter.value)}` : '';
    schedule.value = await api.get<Schedule>(`/schedule?from=${from}&to=${to}${query}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await reload();
  try {
    departments.value = await api.get<Department[]>('/departments');
  } catch { /* необязательно */ }
});
</script>

<template>
  <div>
    <div class="view-header">
      <div>
        <div class="view-title">График отпусков · {{ YEAR }}</div>
        <div class="view-subtitle">{{ filtered.length }} сотрудников{{ deptFilter ? ` · ${deptFilter}` : '' }}</div>
      </div>
      <div class="view-controls">
        <select v-model="deptFilter" class="input" style="width: auto" @change="reload">
          <option value="">Все отделы</option>
          <option v-for="d in departments" :key="d.name" :value="d.name">{{ d.name }} ({{ d.headcount }})</option>
        </select>
        <input v-model="search" class="input" style="width: 200px" placeholder="Поиск по ФИО…" />
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="hasConflicts" class="warn-banner">
      Дни с превышением порога отсутствия в отделе: {{ [...conflictDates].slice(0, 6).join(', ') }}
      {{ conflictDates.size > 6 ? `… всего ${conflictDates.size}` : '' }}
    </div>

    <div class="legend">
      <span class="legend-item"><span class="sw sw-approved" /> согласован</span>
      <span class="legend-item"><span class="sw sw-pending" /> на согласовании</span>
      <span class="legend-item"><span class="sw sw-maternity" /> декрет</span>
      <span class="legend-item"><span class="sw sw-remote" /> удалёнка</span>
      <span class="legend-item"><span class="sw sw-off" /> выходной</span>
      <span class="legend-item"><span class="sw sw-conflict" /> конфликт отдела</span>
    </div>

    <div v-if="loading" class="empty-state">Загрузка графика…</div>

    <div v-else class="card schedule-card scroll-thin">
      <div class="schedule-grid">
        <!-- Шапка: имя + 12 месяцев -->
        <div class="grid-head schedule-row head-row" :style="{ gridTemplateColumns: `220px repeat(${totalDays}, 10px)` }">
          <div>Сотрудник</div>
          <template v-for="(m, mi) in monthNames" :key="m">
            <div class="month-label" :style="{ gridColumn: `span ${daysInMonth(mi)}` }">{{ m }}</div>
          </template>
        </div>

        <div
          v-for="e in filtered"
          :key="e.id"
          class="grid-row schedule-row"
          :style="{ gridTemplateColumns: `220px repeat(${totalDays}, 10px)` }"
          @click="selected = e"
        >
          <div class="emp-cell">
            <div class="emp-name">{{ e.name }}</div>
            <div class="emp-dept">{{ e.dept ?? 'Без отдела' }}</div>
          </div>
          <template v-for="mi in 12" :key="mi">
            <template v-for="d in daysInMonth(mi - 1)" :key="`${mi}-${d}`">
              <div
                class="day-cell"
                :class="[
                  cellFor(e, mi - 1, d).weekend ? 'weekend' : '',
                  cellFor(e, mi - 1, d).vacation ? `vac-${cellFor(e, mi - 1, d).vacation!.status} ${cellFor(e, mi - 1, d).vacation!.type === 'maternity' ? 'vac-maternity' : ''}` : '',
                  cellFor(e, mi - 1, d).work === 'remote' ? 'work-remote' : '',
                  cellFor(e, mi - 1, d).work === 'off' ? 'work-off' : '',
                  isConflict(cellFor(e, mi - 1, d).date) ? 'conflict' : '',
                ]"
                :title="`${e.name} · ${cellFor(e, mi - 1, d).date}`"
              />
            </template>
          </template>
        </div>
      </div>
    </div>

    <!-- Карточка сотрудника -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="modal">
        <div class="modal-title">{{ selected.name }}</div>
        <div class="muted" style="margin-bottom: 12px">{{ selected.position }} · {{ selected.dept ?? 'Без отдела' }}</div>
        <div v-if="!selected.vacations.length" class="empty-state">Отпусков нет</div>
        <div v-for="v in selected.vacations" :key="v.requestId" class="vac-line">
          <span class="badge" :class="v.status === 'approved' ? 'badge-success' : 'badge-info'">
            {{ v.status === 'approved' ? 'согласован' : 'на согласовании' }}
          </span>
          {{ fmtRange(v.start, v.end) }} · {{ daysBetween(v.start, v.end) }} к.д.
          <span v-if="v.type === 'maternity'" class="badge badge-warning">декрет</span>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="selected = null">Закрыть</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-controls {
  display: flex;
  gap: 10px;
  align-items: center;
}

.legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 12px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sw {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
}

.sw-approved { background: var(--color-primary); }
.sw-pending { background: var(--color-warning); }
.sw-maternity { background: #b98ae0; }
.sw-remote { background: var(--color-primary-soft); }
.sw-off { background: var(--color-neutral-soft); }
.sw-conflict { background: var(--color-danger); }

.schedule-card {
  overflow-x: auto;
}

.schedule-grid {
  min-width: fit-content;
}

.schedule-row {
  padding: 3px 10px;
}

.head-row {
  position: sticky;
  top: 0;
  background: var(--color-surface);
  z-index: 2;
}

.month-label {
  font-size: 10.5px;
  text-align: center;
  overflow: hidden;
}

.emp-cell {
  min-width: 0;
}

.emp-name {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.emp-dept {
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.day-cell {
  width: 10px;
  height: 18px;
  border-radius: 2px;
  background: transparent;
}

.day-cell.weekend:not(.vac-approved):not(.vac-pending):not(.work-remote):not(.work-off) {
  background: var(--color-neutral-soft);
  opacity: 0.5;
}

.vac-approved { background: var(--color-primary); }
.vac-approved.vac-maternity { background: #b98ae0; }
.vac-pending { background: var(--color-warning); }
.vac-pending.vac-maternity { background: #d9bdf0; }
.work-remote { background: var(--color-primary-soft); }
.work-off { background: var(--color-neutral-soft); }
.day-cell.conflict { outline: 1px solid var(--color-danger); }

.vac-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--color-border);
}

.vac-line:last-child { border-bottom: none; }
.muted { color: var(--color-text-muted); font-size: 12.5px; }
</style>
