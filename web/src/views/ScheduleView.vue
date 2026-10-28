<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, type Department, type OrgSettings, type Schedule, type ScheduleEmployee } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useCalendarStore } from '@/stores/calendar';
import { useLiveStore } from '@/stores/live';
import { isDayOff, workCalendar, type WorkCalendar } from '@/lib/calendar';
import { useUiStore } from '@/stores/ui';
import {
  addDays, dayIndex, daysInYear, fmtDate, fmtRange, localIso, monthsOf, vacationDays, WEEKDAYS_SHORT, weekday,
} from '@/lib/dates';
import { absentPerDay, barsForYear, conflictDatesFor, isAbsent, segments, virtualWindow, type Bar } from '@/lib/schedule';
import { shortName } from '@/lib/people';
import { statusMeta } from '@/lib/requests';
import AppIcon from '@/components/common/AppIcon.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import { vDialog } from '@/directives/dialog';

const auth = useAuthStore();
const calendar = useCalendarStore();
const ui = useUiStore();

const today = localIso(new Date());
const year = ref(Number(today.slice(0, 4)));
const schedule = ref<Schedule | null>(null);
const departments = ref<Department[]>([]);
const holidays = ref<Set<string>>(new Set());
const workCal = ref<WorkCalendar>(workCalendar([]));
const dept = ref('');
const search = ref('');
const loading = ref(true);
const error = ref('');
const selected = ref<ScheduleEmployee | null>(null);
const collapsedDepts = ref<Set<string>>(new Set());
const scroller = ref<HTMLElement | null>(null);
const threshold = ref(0.5);
const showWorkMode = ref(false);
const picked = ref<Set<number>>(new Set());

type Zoom = 'year' | 'quarter' | 'month';
const ZOOM: Record<Zoom, { day: number; label: string }> = {
  year: { day: 5, label: 'Год' },
  quarter: { day: 18, label: 'Квартал' },
  month: { day: 30, label: 'Месяц' },
};
const zoom = ref<Zoom>(readZoom());
const DAY = computed(() => ZOOM[zoom.value].day);
const NAME_COL = 264;
const ROW_H = 40;
const GROUP_H = 36;

function readZoom(): Zoom {
  try {
    const v = localStorage.getItem('vp.schedule.zoom');
    return v === 'year' || v === 'month' ? v : 'quarter';
  } catch { return 'quarter'; }
}

const totalDays = computed(() => daysInYear(year.value));
const months = computed(() => monthsOf(year.value));
const laneWidth = computed(() => totalDays.value * DAY.value);
const todayIdx = computed(() => (today.startsWith(`${year.value}-`) ? dayIndex(year.value, today) : -1));
const isCurrentYear = computed(() => todayIdx.value >= 0);

/** Дни года для подписей и фона: выходные и праздники. */
const days = computed(() => Array.from({ length: totalDays.value }, (_, i) => {
  const iso = addDays(`${year.value}-01-01`, i);
  const holiday = holidays.value.has(iso);
  // weekend — любой нерабочий день кроме праздника: выходные и перенесённые выходные
  return { i, iso, d: Number(iso.slice(8)), weekend: !holiday && isDayOff(iso, workCal.value), holiday, wd: weekday(iso) };
}));
const offDaySegments = computed(() => segments(year.value, days.value.filter((d) => d.weekend || d.holiday).map((d) => d.iso)));

const filtered = computed(() => {
  const list = schedule.value?.employees ?? [];
  const q = search.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) => e.name.toLowerCase().includes(q) || (e.position ?? '').toLowerCase().includes(q));
});

/** Конфликтные даты по отделам (порог из настроек организации). */
const conflictsByDept = computed(() => {
  const map = new Map<string, Set<string>>();
  for (const c of schedule.value?.conflicts ?? []) {
    if (!map.has(c.dept)) map.set(c.dept, new Set());
    map.get(c.dept)!.add(c.date);
  }
  return map;
});

interface Group { name: string; employees: ScheduleEmployee[]; absentToday: number; conflictDays: number }
const groups = computed<Group[]>(() => {
  const map = new Map<string, ScheduleEmployee[]>();
  for (const e of filtered.value) {
    const key = e.dept ?? 'Без отдела';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([name, employees]) => ({
      name,
      employees,
      absentToday: employees.filter((e) => isAbsent(e.vacations, today)).length,
      conflictDays: [...(conflictsByDept.value.get(name) ?? [])].filter((d) => d.startsWith(`${year.value}-`)).length,
    }));
});

const stats = computed(() => {
  const list = filtered.value;
  return {
    people: list.length,
    absentToday: isCurrentYear.value ? list.filter((e) => isAbsent(e.vacations, today)).length : 0,
    pending: list.reduce((n, e) => n + e.vacations.filter((v) => v.status === 'pending').length, 0),
    conflictDays: groups.value.reduce((n, g) => n + g.conflictDays, 0),
  };
});

/** Нагрузка выборки по дням: доля в согласованном отпуске (рабочие дни), для полосы над графиком. */
const dailyLoad = computed(() => {
  const list = filtered.value;
  const n = list.length || 1;
  const counts = absentPerDay(year.value, list);
  return days.value.map((d) => {
    if (d.weekend || d.holiday) return { i: d.i, ratio: -1, absent: 0 };
    return { i: d.i, ratio: counts[d.i] / n, absent: counts[d.i] };
  });
});

// ── Виртуальный список: рисуются только видимые строки (5000 сотрудников — не 65 тыс. узлов DOM)
type Item = { kind: 'group'; key: string; g: Group } | { kind: 'row'; key: string; e: ScheduleEmployee };
const items = computed<Item[]>(() => {
  const out: Item[] = [];
  for (const g of groups.value) {
    out.push({ kind: 'group', key: `g:${g.name}`, g });
    if (!collapsedDepts.value.has(g.name)) for (const e of g.employees) out.push({ kind: 'row', key: `r:${e.id}`, e });
  }
  return out;
});
const layout = computed(() => {
  const offsets: number[] = [];
  let y = 0;
  for (const it of items.value) { offsets.push(y); y += it.kind === 'group' ? GROUP_H : ROW_H; }
  return { offsets, total: y };
});
const view = ref({ top: 0, height: 900 });
const bodyRef = ref<HTMLElement | null>(null);
const win = computed(() => virtualWindow(layout.value.offsets, layout.value.total, view.value.top, view.value.height));
const visible = computed(() => items.value.slice(win.value.start, win.value.end));

let frame = 0;
function measure(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const el = scroller.value;
    if (!el) return;
    const bodyTop = bodyRef.value?.offsetTop ?? 0; // высота шапки над строками
    view.value = { top: Math.max(0, el.scrollTop - bodyTop), height: el.clientHeight };
  });
}
const resizer = new ResizeObserver(measure);
watch(scroller, (el, old) => {
  old?.removeEventListener('scroll', measure);
  if (old) resizer.unobserve(old);
  if (el) { el.addEventListener('scroll', measure, { passive: true }); resizer.observe(el); measure(); }
});
onBeforeUnmount(() => { resizer.disconnect(); cancelAnimationFrame(frame); });

function loadColor(ratio: number): string {
  if (ratio < 0) return 'transparent';
  if (ratio >= threshold.value && ratio > 0) return 'var(--color-danger)';
  if (ratio === 0) return 'var(--color-neutral-soft)';
  const k = Math.min(1, ratio / threshold.value);
  return `color-mix(in srgb, var(--chart-approved) ${Math.round(18 + k * 72)}%, var(--color-surface))`;
}

/** Удалённые дни сотрудника (шаблон + исключения, без выходных, праздников и отпуска). */
function remoteSegs(e: ScheduleEmployee) {
  const overrides = new Map(e.workOverrides.map((o) => [o.date, o.mode]));
  const remote = days.value.filter((d) => {
    const mode = overrides.get(d.iso) ?? (d.weekend || d.holiday ? 'off' : e.workPattern[String(d.wd)] ?? 'office');
    return mode === 'remote' && !isAbsent(e.vacations, d.iso);
  }).map((d) => d.iso);
  return segments(year.value, remote);
}

// ── Сравнение выбранных: дни, когда отсутствуют двое и больше
function togglePick(id: number): void {
  const next = new Set(picked.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  picked.value = next;
}
const pickedPeople = computed(() => (schedule.value?.employees ?? []).filter((e) => picked.value.has(e.id)));
const pickedOverlap = computed(() => {
  if (pickedPeople.value.length < 2) return [] as Array<{ first: number; days: number; names: string[] }>;
  const dates = days.value.map((d) => d.iso).filter((iso) => pickedPeople.value.filter((e) => isAbsent(e.vacations, iso)).length >= 2);
  return segments(year.value, dates).map((seg) => {
    const iso = days.value[seg.first].iso;
    return { ...seg, names: pickedPeople.value.filter((e) => isAbsent(e.vacations, iso)).map((e) => shortName(e.name)) };
  });
});

function barsOf(e: ScheduleEmployee): Bar[] {
  return barsForYear(year.value, e.vacations);
}

function conflictSegs(e: ScheduleEmployee) {
  const set = conflictsByDept.value.get(e.dept ?? 'Без отдела');
  return set ? segments(year.value, conflictDatesFor(e.vacations, set)) : [];
}

function barClass(b: Bar): string[] {
  return [
    b.type === 'maternity' ? 'bar-maternity' : b.status === 'approved' ? 'bar-approved' : 'bar-pending',
    b.first + b.days - 1 < todayIdx.value ? 'bar-past' : '',
  ];
}

function barLabel(b: Bar): string {
  const width = b.days * DAY.value;
  if (width < 44) return '';
  const n = vacationDays(b.start, b.end, holidays.value);
  if (width < 120) return `${n} д.`;
  return `${fmtRange(b.start, b.end).replace(/ \d{4}$/, '')} · ${n} д.`;
}

function barTitle(e: ScheduleEmployee, b: Bar): string {
  const n = vacationDays(b.start, b.end, holidays.value);
  return `${e.name}\n${fmtRange(b.start, b.end)} · ${n} дн. отпуска\n${statusMeta(b).label}${b.type === 'maternity' ? ' · по уходу за ребёнком' : ''}`;
}

function toggleDept(name: string): void {
  const next = new Set(collapsedDepts.value);
  if (next.has(name)) next.delete(name); else next.add(name);
  collapsedDepts.value = next;
}

function scrollToToday(smooth = false): void {
  const el = scroller.value;
  if (!el) return;
  const idx = isCurrentYear.value ? todayIdx.value : 0;
  const target = NAME_COL + idx * DAY.value - (el.clientWidth - NAME_COL) / 3;
  el.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
}

/** quiet — тихое обновление по событию «данные изменились»: без скелета и без прокрутки к сегодня. */
async function reload(quiet = false): Promise<void> {
  if (!quiet) loading.value = true;
  error.value = '';
  try {
    const q = dept.value ? `&dept=${encodeURIComponent(dept.value)}` : '';
    const [s, h, st] = await Promise.all([
      api.get<Schedule>(`/schedule?from=${year.value}-01-01&to=${year.value}-12-31${q}`),
      calendar.workCalendar(year.value),
      api.get<OrgSettings>('/settings').catch(() => null),
    ]);
    if (st) threshold.value = st.conflictThreshold / 100;
    schedule.value = s;
    workCal.value = h;
    holidays.value = h.holidays;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
  if (quiet) return;
  await nextTick();
  scrollToToday();
}

// Живое обновление: не чаще раза в минуту и только в видимой вкладке — при 5000 сотрудниках
// данные организации меняются постоянно; без изменений сервер отвечает 304 по ETag
const live = useLiveStore();
let lastLive = Date.now();
let liveTimer = 0;
watch(() => live.version, () => {
  if (liveTimer) return;
  const wait = Math.max(0, 60_000 - (Date.now() - lastLive));
  liveTimer = window.setTimeout(() => {
    liveTimer = 0;
    if (document.visibilityState !== 'visible') return;
    lastLive = Date.now();
    void reload(true);
  }, wait);
});
onBeforeUnmount(() => window.clearTimeout(liveTimer));

async function exportXlsx(): Promise<void> {
  try {
    const res = await api.download(`/reports/vacations?from=${year.value}-01-01&to=${year.value}-12-31`);
    const url = URL.createObjectURL(res);
    const a = document.createElement('a');
    a.href = url;
    a.download = `otpuska-${year.value}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    ui.toast('Выгрузка сформирована');
  } catch (e) {
    ui.error(e);
  }
}

watch(zoom, async (z) => {
  try { localStorage.setItem('vp.schedule.zoom', z); } catch { /* приватный режим */ }
  await nextTick();
  scrollToToday();
});
watch([year, dept], () => void reload());

onMounted(async () => {
  void reload();
  try {
    departments.value = await api.get<Department[]>('/departments');
  } catch { /* фильтр по отделам необязателен */ }
});

const canExport = computed(() => auth.isStaff || auth.isApprover);
const selectedDays = computed(() => selected.value
  ? selected.value.vacations.filter((v) => v.status === 'approved' && v.start.startsWith(`${year.value}`))
    .reduce((n, v) => n + vacationDays(v.start, v.end, holidays.value), 0)
  : 0);
</script>

<template>
  <div class="page">
    <div class="view-header">
      <div>
        <div class="view-title">
          График отпусков
        </div>
        <div class="view-subtitle">
          {{ stats.people }} сотрудников{{ dept ? ` · ${dept}` : ' · вся организация' }}
        </div>
      </div>
      <div class="toolbar">
        <div
          class="year-switch"
          role="group"
          aria-label="Год"
        >
          <button
            class="btn btn-icon btn-sm btn-ghost"
            type="button"
            aria-label="Предыдущий год"
            @click="year--"
          >
            <AppIcon
              name="chevronLeft"
              :size="15"
            />
          </button>
          <strong>{{ year }}</strong>
          <button
            class="btn btn-icon btn-sm btn-ghost"
            type="button"
            aria-label="Следующий год"
            @click="year++"
          >
            <AppIcon
              name="chevronRight"
              :size="15"
            />
          </button>
        </div>
        <div
          class="segmented"
          role="group"
          aria-label="Масштаб"
        >
          <button
            v-for="(z, key) in ZOOM"
            :key="key"
            type="button"
            :class="{ active: zoom === key }"
            @click="zoom = key"
          >
            {{ z.label }}
          </button>
        </div>
        <button
          class="btn"
          type="button"
          :class="{ 'btn-toggled': showWorkMode }"
          :aria-pressed="showWorkMode"
          title="Показать дни удалённой работы на полосах"
          @click="showWorkMode = !showWorkMode"
        >
          <AppIcon
            name="monitor"
            :size="15"
          /> <span class="hide-mobile">Удалёнка</span>
        </button>
        <button
          class="btn"
          type="button"
          @click="isCurrentYear ? scrollToToday(true) : (year = Number(today.slice(0, 4)))"
        >
          <AppIcon
            name="today"
            :size="15"
          /> Сегодня
        </button>
        <button
          v-if="canExport"
          class="btn"
          type="button"
          title="Выгрузить отпуска года в Excel"
          @click="exportXlsx"
        >
          <AppIcon
            name="spreadsheet"
            :size="15"
          /> <span class="hide-mobile">Excel</span>
        </button>
      </div>
    </div>

    <div class="filters">
      <select
        v-model="dept"
        class="input dept-select"
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
          {{ d.name }} · {{ d.headcount }}
        </option>
      </select>
      <div class="input-icon search">
        <AppIcon
          name="search"
          :size="15"
        />
        <input
          v-model="search"
          class="input"
          placeholder="Поиск по ФИО или должности"
          aria-label="Поиск"
        >
      </div>
      <div class="legend">
        <span><i class="sw sw-approved" />согласован</span>
        <span><i class="sw sw-pending" />на согласовании</span>
        <span><i class="sw sw-maternity" />по уходу за ребёнком</span>
        <span><i class="sw sw-conflict" />конфликт отдела</span>
        <span><i class="sw sw-off" />выходные и праздники</span>
        <span v-if="showWorkMode"><i class="sw sw-remote" />удалённо</span>
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

    <div
      v-if="picked.size"
      class="card compare"
    >
      <div class="compare-head">
        <span class="section-title"><AppIcon
          name="layers"
          :size="15"
        /> Сравнение: {{ pickedPeople.map((e) => shortName(e.name)).join(', ') }}</span>
        <button
          class="btn btn-sm btn-ghost"
          type="button"
          @click="picked = new Set()"
        >
          <AppIcon
            name="close"
            :size="13"
          /> Сбросить
        </button>
      </div>
      <p
        v-if="picked.size < 2"
        class="soft small compare-body"
      >
        Отметьте ещё хотя бы одного сотрудника (значок слева от фамилии), чтобы увидеть общие дни отсутствия.
      </p>
      <p
        v-else-if="!pickedOverlap.length"
        class="compare-body ok-text"
      >
        <AppIcon
          name="check"
          :size="14"
        /> В {{ year }} году выбранные сотрудники не отсутствуют одновременно — можно замещать друг друга.
      </p>
      <ul
        v-else
        class="compare-body overlap-list"
      >
        <li
          v-for="o in pickedOverlap"
          :key="o.first"
        >
          <strong>{{ fmtRange(days[o.first].iso, days[o.first + o.days - 1].iso) }}</strong>
          <span class="muted">одновременно отсутствуют: {{ o.names.join(', ') }}</span>
        </li>
      </ul>
    </div>

    <div class="stats">
      <div class="card stat">
        <span class="stat-icon"><AppIcon
          name="team"
          :size="19"
        /></span>
        <div>
          <div class="stat-value">
            {{ stats.people }}
          </div>
          <div class="stat-label">
            сотрудников в выборке
          </div>
        </div>
      </div>
      <div class="card stat">
        <span class="stat-icon tone-success"><AppIcon
          name="vacation"
          :size="19"
        /></span>
        <div>
          <div class="stat-value">
            {{ stats.absentToday }}
          </div>
          <div class="stat-label">
            в отпуске сегодня
          </div>
        </div>
      </div>
      <div class="card stat">
        <span class="stat-icon tone-warning"><AppIcon
          name="clock"
          :size="19"
        /></span>
        <div>
          <div class="stat-value">
            {{ stats.pending }}
          </div>
          <div class="stat-label">
            заявок на согласовании
          </div>
        </div>
      </div>
      <div class="card stat">
        <span
          class="stat-icon"
          :class="stats.conflictDays ? 'tone-danger' : 'tone-muted'"
        ><AppIcon
          name="warning"
          :size="19"
        /></span>
        <div>
          <div class="stat-value">
            {{ stats.conflictDays }}
          </div>
          <div class="stat-label">
            конфликтных дней в отделах
          </div>
        </div>
      </div>
    </div>

    <div class="card gantt-card">
      <div
        v-if="loading"
        class="gantt-loading"
      >
        <div
          v-for="i in 8"
          :key="i"
          class="skeleton-row"
        >
          <span
            class="skeleton"
            style="width: 30px; height: 30px; border-radius: 50%"
          />
          <span
            class="skeleton"
            :style="{ width: `${140 + (i % 3) * 30}px`, height: '12px' }"
          />
          <span
            class="skeleton"
            :style="{ marginLeft: `${60 + i * 37}px`, width: `${50 + (i % 4) * 25}px`, height: '18px' }"
          />
        </div>
      </div>

      <EmptyState
        v-else-if="!filtered.length"
        icon="search"
        title="Никого не нашли"
        :text="search ? `По запросу «${search}» сотрудников нет — уточните ФИО или очистите поиск.` : 'В выбранном отделе нет активных сотрудников.'"
      />

      <div
        v-else
        ref="scroller"
        class="gantt-scroll scroll-thin"
      >
        <div
          class="gantt"
          :style="{ width: `${NAME_COL + laneWidth}px`, '--day': `${DAY}px`, '--name-col': `${NAME_COL}px` }"
        >
          <!-- шапка: месяцы и дни -->
          <div class="g-head">
            <div class="g-corner">
              <span>Сотрудник</span>
              <span class="g-corner-load">нагрузка</span>
            </div>
            <div class="g-scale">
              <div class="g-months">
                <div
                  v-for="m in months"
                  :key="m.index"
                  class="g-month"
                  :class="{ current: isCurrentYear && today.slice(5, 7) === String(m.index + 1).padStart(2, '0') }"
                  :style="{ width: `${m.days * DAY}px` }"
                >
                  {{ zoom === 'year' ? m.short : m.name }}
                </div>
              </div>
              <div
                class="g-load"
                :title="'Доля выборки в отпуске по рабочим дням'"
              >
                <span
                  v-for="d in dailyLoad"
                  :key="d.i"
                  class="g-load-cell"
                  :style="{ background: loadColor(d.ratio) }"
                  :title="d.ratio < 0 ? undefined : `${fmtDate(days[d.i].iso)}: в отпуске ${d.absent} (${Math.round(d.ratio * 100)}%)`"
                />
              </div>
              <div
                v-if="zoom !== 'year'"
                class="g-days"
              >
                <div
                  v-for="d in days"
                  :key="d.i"
                  class="g-day"
                  :class="{ off: d.weekend || d.holiday, holiday: d.holiday, today: d.i === todayIdx }"
                  :title="`${fmtDate(d.iso)}${d.holiday ? ' · праздник' : ''}`"
                >
                  <span>{{ d.d }}</span>
                  <small v-if="zoom === 'month'">{{ WEEKDAYS_SHORT[d.wd] }}</small>
                </div>
              </div>
            </div>
          </div>

          <!-- тело -->
          <div
            ref="bodyRef"
            class="g-body"
          >
            <div
              class="g-overlay"
              aria-hidden="true"
            >
              <div
                v-for="(s, si) in offDaySegments"
                :key="`off${si}`"
                class="g-off"
                :style="{ left: `${s.first * DAY}px`, width: `${s.days * DAY}px` }"
              />
              <div
                v-for="m in months.slice(1)"
                :key="`m${m.index}`"
                class="g-month-line"
                :style="{ left: `${m.offset * DAY}px` }"
              />
              <div
                v-for="o in pickedOverlap"
                :key="`p${o.first}`"
                class="g-pick-overlap"
                :style="{ left: `${o.first * DAY}px`, width: `${o.days * DAY}px` }"
              />
              <div
                v-if="isCurrentYear"
                class="g-today"
                :style="{ left: `${todayIdx * DAY + DAY / 2}px` }"
              />
            </div>

            <div
              class="g-pad"
              :style="{ height: `${win.padTop}px` }"
            />
            <template
              v-for="it in visible"
              :key="it.key"
            >
              <button
                v-if="it.kind === 'group'"
                type="button"
                class="g-group"
                :aria-expanded="!collapsedDepts.has(it.g.name)"
                @click="toggleDept(it.g.name)"
              >
                <span class="g-group-name">
                  <AppIcon
                    :name="collapsedDepts.has(it.g.name) ? 'chevronRight' : 'chevronDown'"
                    :size="14"
                  />
                  <strong>{{ it.g.name }}</strong>
                  <span class="muted">{{ it.g.employees.length }}</span>
                  <span
                    v-if="it.g.absentToday"
                    class="badge badge-success"
                    :title="'В отпуске сегодня'"
                  >{{ it.g.absentToday }} в отпуске</span>
                  <span
                    v-if="it.g.conflictDays"
                    class="badge badge-danger"
                    :title="'Дней, когда в отпуске доля отдела выше порога'"
                  >{{ it.g.conflictDays }} дн. конфликта</span>
                </span>
              </button>
              <template v-else>
                <div
                  class="g-row"
                  :class="{ picked: picked.has(it.e.id) }"
                  :style="{ height: `${ROW_H}px` }"
                >
                  <button
                    type="button"
                    class="g-pick"
                    :class="{ on: picked.has(it.e.id) }"
                    :aria-pressed="picked.has(it.e.id)"
                    :title="picked.has(it.e.id) ? 'Убрать из сравнения' : 'Добавить в сравнение пересечений'"
                    @click="togglePick(it.e.id)"
                  >
                    <AppIcon
                      :name="picked.has(it.e.id) ? 'check' : 'plus'"
                      :size="11"
                      :stroke="2.2"
                    />
                  </button>
                  <button
                    type="button"
                    class="g-name"
                    @click="selected = it.e"
                  >
                    <UserAvatar
                      :name="it.e.name"
                      :size="26"
                    />
                    <span class="person-text">
                      <span class="person-name">{{ shortName(it.e.name) }}</span>
                      <span class="person-sub">{{ it.e.position ?? '—' }}</span>
                    </span>
                    <span
                      v-if="isCurrentYear && isAbsent(it.e.vacations, today)"
                      class="away-dot"
                      title="В отпуске сегодня"
                    />
                  </button>
                  <div
                    class="g-lane"
                    :style="{ width: `${laneWidth}px` }"
                  >
                    <template v-if="showWorkMode">
                      <div
                        v-for="(r, ri) in remoteSegs(it.e)"
                        :key="`r${ri}`"
                        class="g-remote"
                        :style="{ left: `${r.first * DAY}px`, width: `${r.days * DAY}px` }"
                      />
                    </template>
                    <div
                      v-for="(c, ci) in conflictSegs(it.e)"
                      :key="`c${ci}`"
                      class="g-conflict"
                      :style="{ left: `${c.first * DAY}px`, width: `${c.days * DAY}px` }"
                    />
                    <button
                      v-for="b in barsOf(it.e)"
                      :key="b.requestId"
                      type="button"
                      class="g-bar"
                      :class="barClass(b)"
                      :style="{ left: `${b.first * DAY + 1}px`, width: `${Math.max(b.days * DAY - 2, 3)}px` }"
                      :title="barTitle(it.e, b)"
                      @click="selected = it.e"
                    >
                      {{ barLabel(b) }}
                    </button>
                  </div>
                </div>
              </template>
            </template>
            <div
              class="g-pad"
              :style="{ height: `${win.padBottom}px` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- карточка сотрудника -->
    <div
      v-if="selected"
      class="modal-overlay"
      @click.self="selected = null"
    >
      <div
        v-dialog="() => (selected = null)"
        class="modal modal-wide"
        role="dialog"
        aria-modal="true"
      >
        <div class="modal-head">
          <div class="person">
            <UserAvatar
              :name="selected.name"
              :size="44"
            />
            <div class="person-text">
              <span class="modal-title">{{ selected.name }}</span>
              <span class="modal-sub">{{ selected.position ?? 'Должность не указана' }} · {{ selected.dept ?? 'Без отдела' }}</span>
            </div>
          </div>
          <button
            class="btn btn-icon btn-ghost"
            type="button"
            aria-label="Закрыть"
            @click="selected = null"
          >
            <AppIcon
              name="close"
              :size="16"
            />
          </button>
        </div>
        <div class="modal-body">
          <div class="emp-summary">
            <span class="badge badge-info">{{ selectedDays }} дн. согласовано в {{ year }}</span>
            <span
              v-if="isCurrentYear && isAbsent(selected.vacations, today)"
              class="badge badge-success"
            >в отпуске сегодня</span>
          </div>
          <EmptyState
            v-if="!selected.vacations.length"
            icon="vacation"
            title="Отпусков в этом году нет"
            compact
          />
          <div
            v-for="v in selected.vacations"
            :key="v.requestId"
            class="period"
          >
            <span
              class="period-mark"
              :class="v.type === 'maternity' ? 'bar-maternity' : v.status === 'approved' ? 'bar-approved' : 'bar-pending'"
            />
            <div class="period-main">
              <strong>{{ fmtRange(v.start, v.end) }}</strong>
              <span class="muted small">{{ vacationDays(v.start, v.end, holidays) }} дн. отпуска{{ v.type === 'maternity' ? ' · по уходу за ребёнком' : '' }}</span>
            </div>
            <StatusBadge :request="v" />
          </div>
        </div>
        <div class="modal-actions">
          <button
            class="btn"
            type="button"
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
.year-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  padding: 2px;
}

.year-switch strong {
  min-width: 44px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.dept-select {
  width: auto;
  min-width: 220px;
}

.search {
  width: 280px;
}

.legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: auto;
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sw {
  width: 16px;
  height: 9px;
  border-radius: 3px;
  display: inline-block;
}

.sw-approved { background: var(--color-primary); }
.sw-pending { background: repeating-linear-gradient(135deg, var(--color-warning) 0 3px, color-mix(in srgb, var(--color-warning) 55%, var(--color-surface)) 3px 6px); }
.sw-maternity { background: var(--color-violet); }
.sw-conflict { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-danger) 55%, transparent) 0 2px, transparent 2px 4px); outline: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent); }
.sw-off { background: var(--color-weekend); outline: 1px solid var(--color-border); }

/* ── Диаграмма ── */
.gantt-card {
  overflow: hidden;
}

.gantt-scroll {
  overflow: auto;
  max-height: calc(100dvh - 318px);
  min-height: 320px;
}

.gantt {
  position: relative;
}

.g-head {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.g-corner {
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start !important;
  gap: 4px;
  position: sticky;
  left: 0;
  z-index: 7;
  flex: 0 0 var(--name-col);
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  align-items: flex-end;
  padding: 0 14px 9px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.g-months {
  display: flex;
}

.g-month {
  flex-shrink: 0;
  padding: 8px 8px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  border-left: 1px solid var(--color-border);
  white-space: nowrap;
  overflow: hidden;
  position: sticky;
}

.g-month.current {
  color: var(--color-primary-dark);
}

.g-days {
  display: flex;
  border-top: 1px solid var(--color-border);
}

.g-day {
  flex: 0 0 var(--day);
  text-align: center;
  font-size: 10px;
  color: var(--color-text-muted);
  padding: 4px 0;
  letter-spacing: -0.02em;
  line-height: 1.15;
  display: flex;
  flex-direction: column;
  font-variant-numeric: tabular-nums;
}

.g-day small {
  font-size: 9.5px;
  color: var(--color-text-soft);
}

.g-day.off {
  background: var(--color-weekend);
}

.g-day.holiday {
  color: var(--color-danger);
  background: var(--color-holiday);
}

.g-day.today span {
  background: var(--color-danger);
  color: #fff;
  border-radius: 4px;
  margin: 0 1px;
  font-weight: 700;
}

.g-body {
  position: relative;
}

.g-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--name-col);
  right: 0;
  pointer-events: none;
}

.g-off {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--color-weekend);
}

.g-month-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border);
}

.g-today {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--color-danger);
  opacity: 0.7;
  z-index: 2;
}

.g-group {
  position: relative;
  z-index: 3;
  display: block;
  width: 100%;
  height: 36px; /* GROUP_H — виртуальный список считает высоты строк заранее; без overflow: иначе sticky-название «прилипает» внутри кнопки и уезжает влево */
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
  padding: 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--color-text);
}

.g-group-name {
  position: sticky;
  left: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding: 0 14px;
  font-size: 12.5px;
}

.g-group:hover {
  background: var(--color-hover);
}

.g-row {
  position: relative;
  display: flex;
  border-bottom: 1px solid var(--color-border);
}

.g-row:hover .g-name,
.g-row:hover .g-pick,
.g-row:hover {
  background: color-mix(in srgb, var(--color-primary-soft) 30%, transparent);
}

.g-name {
  position: sticky;
  left: 24px;
  z-index: 4;
  flex: 0 0 calc(var(--name-col) - 24px);
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px 0 0;
  border: none;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--color-text);
  min-width: 0;
}

.g-name .person-name {
  font-size: 13px;
}

.away-dot {
  margin-left: auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 3px var(--color-success-soft);
  flex-shrink: 0;
}

.g-lane {
  position: relative;
  flex-shrink: 0;
}

.g-conflict {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 4px;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-danger) 35%, transparent) 0 2px, transparent 2px 5px);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 40%, transparent);
}

.g-bar {
  position: absolute;
  top: 9px;
  height: 22px;
  border: none;
  border-radius: 6px;
  color: #fff;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 0 7px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  cursor: pointer;
  z-index: 3;
  box-shadow: 0 1px 2px rgba(20, 25, 40, 0.15);
  transition: transform 0.12s, box-shadow 0.12s;
}

.g-bar:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(20, 25, 40, 0.2);
}

.bar-approved { background: var(--color-primary); }
.bar-pending {
  background: repeating-linear-gradient(135deg, var(--color-warning) 0 6px, color-mix(in srgb, var(--color-warning) 75%, #fff) 6px 12px);
  color: #5a3a06;
}
.bar-maternity { background: var(--color-violet); }
.bar-past { opacity: 0.55; }

.gantt-loading {
  padding: 8px 0;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
}

.g-corner-load {
  font-size: 9.5px;
  color: var(--color-text-soft);
  letter-spacing: 0.04em;
}

.g-load {
  display: flex;
  height: 8px;
  border-top: 1px solid var(--color-border);
  padding: 1px 0;
  box-sizing: content-box;
}

.g-load-cell {
  flex: 0 0 var(--day);
  height: 100%;
  border-right: 1px solid var(--color-surface);
}

.g-remote {
  position: absolute;
  top: 5px;
  bottom: 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--status-remote) 22%, transparent);
}

.sw-remote { background: color-mix(in srgb, var(--status-remote) 40%, transparent); }

.btn-toggled {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
  color: var(--color-primary-dark);
}

.g-pick-overlap {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--color-warning) 16%, transparent);
  border-left: 1px solid color-mix(in srgb, var(--color-warning) 55%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--color-warning) 55%, transparent);
}

.g-pick {
  position: sticky;
  left: 0;
  z-index: 5;
  flex: 0 0 24px;
  width: 24px;
  border: none;
  padding: 0 0 0 6px;
  background: var(--color-surface);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.g-pick .app-icon {
  width: 15px;
  height: 15px;
  padding: 1px;
  border-radius: 4px;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text-soft);
  opacity: 0;
  transition: opacity 0.12s;
}

.g-row:hover .g-pick .app-icon,
.g-pick.on .app-icon,
.g-pick:focus-visible .app-icon {
  opacity: 1;
}

.g-pick.on .app-icon {
  background: var(--color-warning);
  border-color: var(--color-warning);
  color: #fff;
}

.g-row.picked .g-pick,
.g-row.picked .g-name {
  background: color-mix(in srgb, var(--color-warning-soft) 70%, var(--color-surface));
}

.compare {
  margin-bottom: 14px;
  border-left: 3px solid var(--color-warning);
}

.compare-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 0;
}

.compare-body {
  margin: 0;
  padding: 8px 14px 12px;
}

.ok-text {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-success-dark);
  font-size: 13px;
}

.overlap-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.overlap-list li {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* ── Карточка сотрудника ── */
.emp-summary {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.period {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}

.period:last-child {
  border-bottom: none;
}

.period-mark {
  width: 6px;
  align-self: stretch;
  border-radius: 3px;
}

.period-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

@media (max-width: 900px) {
  .search,
  .dept-select {
    width: 100%;
  }

  .legend {
    margin-left: 0;
  }

  .gantt-scroll {
    max-height: calc(100dvh - 220px);
  }
}
</style>
