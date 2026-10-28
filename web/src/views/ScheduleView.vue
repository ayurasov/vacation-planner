<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, daysBetween, fmtRange, type Department, type Schedule, type ScheduleEmployee } from '@/api/client';

const YEAR = new Date().getFullYear();

const schedule = ref<Schedule | null>(null);
const departments = ref<Department[]>([]);
const deptFilter = ref('');
const search = ref('');
const loading = ref(true);
const error = ref('');
const selected = ref<ScheduleEmployee | null>(null);

const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const monthFull = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const daysInMonth = (m: number) => new Date(YEAR, m + 1, 0).getDate();
const dayOfYear = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.parse(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`)
    - Date.parse(`${YEAR}-01-01T00:00:00Z`)) / 86400000);
};
const TOTAL_DAYS = dayOfYear(`${YEAR}-12-31`) + 1;
const todayIso = new Date().toISOString().slice(0, 10);
const todayIndex = todayIso.startsWith(String(YEAR)) ? dayOfYear(todayIso) : -1;

const CELL = 13; // px на день

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
const conflictToday = computed(() =>
  schedule.value?.conflicts.filter((c) => c.date === todayIso).length ?? 0);
const onVacationToday = computed(() => {
  if (!schedule.value || todayIndex < 0) return 0;
  return schedule.value.employees.filter((e) =>
    e.vacations.some((v) => v.status === 'approved' && v.start <= todayIso && todayIso <= v.end)).length;
});
const pendingCount = computed(() =>
  schedule.value?.employees.reduce((acc, e) => acc + e.vacations.filter((v) => v.status === 'pending').length, 0) ?? 0);

interface Bar {
  key: string;
  left: number;
  width: number;
  status: string;
  type: string;
  title: string;
}

/** Полосы отпусков строки — одна полоса на период (а не клетка на день). */
function bars(e: ScheduleEmployee): Bar[] {
  return e.vacations
    .map((v) => {
      const start = Math.max(0, dayOfYear(v.start));
      const end = Math.min(TOTAL_DAYS - 1, dayOfYear(v.end));
      if (end < start) return null;
      return {
        key: `${e.id}-${v.requestId}`,
        left: start * CELL,
        width: (end - start + 1) * CELL - 2,
        status: v.status,
        type: v.type,
        title: `${fmtRange(v.start, v.end)} · ${daysBetween(v.start, v.end)} к.д. · ${v.status === 'approved' ? 'согласован' : 'на согласовании'}`,
      } satisfies Bar;
    })
    .filter((b): b is Bar => b !== null);
}

/** Конфликтные даты строки — красная штриховка фона (сегменты подряд). */
function conflictSegments(e: ScheduleEmployee): Array<{ left: number; width: number }> {
  const days = e.vacations
    .filter((v) => v.status === 'approved')
    .flatMap((v) => {
      const out: string[] = [];
      const n = daysBetween(v.start, v.end);
      for (let i = 0; i < n; i++) {
        const d = new Date(Date.parse(`${v.start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
        if (conflictDates.value.has(d) && d.startsWith(String(YEAR))) out.push(d);
      }
      return out;
    });
  if (!days.length) return [];
  days.sort();
  const segs: Array<{ left: number; width: number }> = [];
  let startD = days[0];
  let prev = days[0];
  const push = (a: string, b: string) => segs.push({
    left: dayOfYear(a) * CELL,
    width: (dayOfYear(b) - dayOfYear(a) + 1) * CELL,
  });
  for (const d of days.slice(1)) {
    const next = new Date(Date.parse(`${prev}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    if (d !== next) {
      push(startD, prev);
      startD = d;
    }
    prev = d;
  }
  push(startD, prev);
  return segs;
}

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const query = deptFilter.value ? `&dept=${encodeURIComponent(deptFilter.value)}` : '';
    schedule.value = await api.get<Schedule>(`/schedule?from=${YEAR}-01-01&to=${YEAR}-12-31${query}`);
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
        <div class="view-title">
          График отпусков · {{ YEAR }}
        </div>
        <div class="view-subtitle">
          {{ filtered.length }} сотрудников{{ deptFilter ? ` · ${deptFilter}` : '' }}
        </div>
      </div>
      <div class="view-controls">
        <select
          v-model="deptFilter"
          class="input"
          style="width: auto"
          @change="reload"
        >
          <option value="">
            Все отделы
          </option>
          <option
            v-for="d in departments"
            :key="d.name"
            :value="d.name"
          >
            {{ d.name }} ({{ d.headcount }})
          </option>
        </select>
        <input
          v-model="search"
          class="input"
          style="width: 200px"
          placeholder="Поиск по ФИО…"
        >
      </div>
    </div>

    <div
      v-if="error"
      class="error-banner"
    >
      {{ error }}
    </div>

    <div class="kpi-row">
      <div class="card kpi">
        <div class="kpi-value">
          {{ filtered.length }}
        </div>
        <div class="kpi-label">
          сотрудников в выборке
        </div>
      </div>
      <div
        class="card kpi"
        :class="{ 'kpi-warn': onVacationToday > 0 }"
      >
        <div class="kpi-value">
          {{ onVacationToday }}
        </div>
        <div class="kpi-label">
          в отпуске сегодня
        </div>
      </div>
      <div
        class="card kpi"
        :class="{ 'kpi-warn': pendingCount > 0 }"
      >
        <div class="kpi-value">
          {{ pendingCount }}
        </div>
        <div class="kpi-label">
          заявок на согласовании
        </div>
      </div>
      <div
        class="card kpi"
        :class="{ 'kpi-danger': conflictToday > 0 }"
      >
        <div class="kpi-value">
          {{ conflictToday }}
        </div>
        <div class="kpi-label">
          конфликтов отдела сегодня
        </div>
      </div>
    </div>

    <div class="legend">
      <span class="legend-item"><span class="sw sw-approved" /> согласован</span>
      <span class="legend-item"><span class="sw sw-pending" /> на согласовании</span>
      <span class="legend-item"><span class="sw sw-maternity" /> декрет</span>
      <span class="legend-item"><span class="sw sw-conflict" /> конфликт отдела</span>
      <span class="legend-item"><span class="sw sw-today" /> сегодня</span>
    </div>

    <div
      v-if="loading"
      class="empty-state"
    >
      Загрузка графика…
    </div>

    <div
      v-else
      class="card schedule-card"
    >
      <div class="schedule-scroll scroll-thin">
        <div class="schedule-grid">
          <div
            class="grid-head schedule-row head-row"
            :style="{ gridTemplateColumns: `240px ${TOTAL_DAYS * CELL}px` }"
          >
            <div class="emp-head">
              Сотрудник
            </div>
            <div class="months-strip">
              <div
                v-for="(m, mi) in monthNames"
                :key="m"
                class="month-label"
                :style="{ width: daysInMonth(mi) * CELL + 'px' }"
                :title="monthFull[mi]"
              >
                {{ m }}
              </div>
            </div>
          </div>

          <div
            v-for="e in filtered"
            :key="e.id"
            class="grid-row schedule-row body-row"
            :style="{ gridTemplateColumns: `240px ${TOTAL_DAYS * CELL}px` }"
            @click="selected = e"
          >
            <div class="emp-cell">
              <div class="emp-name">
                {{ e.name }}
              </div>
              <div class="emp-dept">
                {{ e.dept ?? 'Без отдела' }}
              </div>
            </div>
            <div
              class="lane"
              :style="{ width: TOTAL_DAYS * CELL + 'px' }"
            >
              <div class="lane-bg" />
              <div
                v-for="(seg, si) in conflictSegments(e)"
                :key="'c' + si"
                class="conflict-zone"
                :style="{ left: seg.left + 'px', width: seg.width + 'px' }"
              />
              <div
                v-if="todayIndex >= 0"
                class="today-line"
                :style="{ left: todayIndex * CELL + CELL / 2 + 'px' }"
              />
              <div
                v-for="b in bars(e)"
                :key="b.key"
                class="vac-bar"
                :class="[b.status === 'approved' ? 'bar-approved' : 'bar-pending', { 'bar-maternity': b.type === 'maternity' }]"
                :style="{ left: b.left + 'px', width: b.width + 'px' }"
                :title="`${e.name} · ${b.title}`"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="selected"
      class="modal-overlay"
      @click.self="selected = null"
    >
      <div class="modal">
        <div class="modal-title">
          {{ selected.name }}
        </div>
        <div
          class="muted"
          style="margin-bottom: 12px"
        >
          {{ selected.position }} · {{ selected.dept ?? 'Без отдела' }}
        </div>
        <div
          v-if="!selected.vacations.length"
          class="empty-state"
        >
          Отпусков нет
        </div>
        <div
          v-for="v in selected.vacations"
          :key="v.requestId"
          class="vac-line"
        >
          <span
            class="badge"
            :class="v.status === 'approved' ? 'badge-success' : 'badge-info'"
          >{{ v.status === 'approved' ? 'согласован' : 'на согласовании' }}</span>
          {{ fmtRange(v.start, v.end) }} · {{ daysBetween(v.start, v.end) }} к.д.
          <span
            v-if="v.type === 'maternity'"
            class="badge badge-warning"
          >декрет</span>
        </div>
        <div class="modal-actions">
          <button
            class="btn"
            @click="selected = null"
          >
            Закрыть
          </button>
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
  width: 14px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}

.sw-approved {
  background: var(--color-primary);
}

.sw-pending {
  background: repeating-linear-gradient(45deg, var(--color-warning) 0 4px, #f3cd8a 4px 8px);
}

.sw-maternity {
  background: #8e6fc1;
}

.sw-conflict {
  background: repeating-linear-gradient(90deg, transparent 0 3px, var(--color-danger) 3px 5px);
}

.sw-today {
  background: var(--color-danger);
  width: 2px;
  height: 12px;
  border-radius: 1px;
}

.schedule-card {
  overflow: hidden;
}

.schedule-scroll {
  overflow: auto;
  max-height: calc(100dvh - 340px);
}

.schedule-grid {
  min-width: fit-content;
}

.schedule-row {
  padding: 0;
  border-bottom: 1px solid var(--color-border);
}

.head-row {
  position: sticky;
  top: 0;
  background: var(--color-surface);
  z-index: 3;
}

.emp-head {
  padding: 8px 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  position: sticky;
  left: 0;
  background: var(--color-surface);
  z-index: 2;
}

.months-strip {
  display: flex;
}

.month-label {
  font-size: 11px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 8px 0;
  border-left: 1px solid var(--color-border);
  overflow: hidden;
  white-space: nowrap;
}

.body-row {
  cursor: pointer;
}

.body-row:hover {
  background: var(--color-row-hover);
}

.emp-cell {
  padding: 6px 12px;
  position: sticky;
  left: 0;
  background: var(--color-surface);
  z-index: 2;
  min-width: 0;
  border-right: 1px solid var(--color-border);
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

.lane {
  position: relative;
  height: 30px;
}

.lane-bg {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(90deg, transparent 0 12px, var(--color-neutral-soft) 12px 13px);
  opacity: 0.5;
}

.conflict-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(90deg, transparent 0 3px, var(--color-danger) 3px 5px);
  opacity: 0.35;
  pointer-events: none;
}

.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-danger);
  opacity: 0.75;
  pointer-events: none;
}

.vac-bar {
  position: absolute;
  top: 7px;
  height: 16px;
  border-radius: 4px;
  cursor: pointer;
}

.bar-approved {
  background: var(--color-primary);
}

.bar-approved:hover {
  background: var(--color-primary-dark);
}

.bar-pending {
  background: repeating-linear-gradient(45deg, var(--color-warning) 0 4px, #f3cd8a 4px 8px);
}

.bar-maternity {
  background: #8e6fc1;
}

.bar-maternity:hover {
  background: #7a5cb0;
}

.vac-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--color-border);
}

.vac-line:last-child {
  border-bottom: none;
}

.muted {
  color: var(--color-text-muted);
  font-size: 12.5px;
}
</style>
