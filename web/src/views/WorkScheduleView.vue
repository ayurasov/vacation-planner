<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, type Department, type Employee, type Page, type Schedule, type WorkSchedule } from '@/api/client';
import { indented } from '@/lib/departments';
import { useAuthStore } from '@/stores/auth';
import { useCalendarStore } from '@/stores/calendar';
import { useUiStore } from '@/stores/ui';
import { addDays, fmtDate, localIso, MONTHS, weekday } from '@/lib/dates';
import { isDayOff, workCalendar, type WorkCalendar } from '@/lib/calendar';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import HelpLink from '@/components/common/HelpLink.vue';

type Mode = 'office' | 'remote' | 'off';
const auth = useAuthStore();
const calendar = useCalendarStore();
const ui = useUiStore();

const today = localIso(new Date());
const people = ref<Employee[]>([]);
const departments = ref<Department[]>([]);
const dept = ref('');
const employeeId = ref<number>(auth.me!.employee.id);
const month = ref(today.slice(0, 7)); // YYYY-MM
const schedule = ref<WorkSchedule | null>(null);
const pattern = ref<Record<number, Mode>>({});
const vacations = ref<Array<{ start: string; end: string; status: string }>>([]);
const holidays = ref<Set<string>>(new Set());
const workCal = ref<WorkCalendar>(workCalendar([]));
const dirty = ref(false);
const loading = ref(true);
const saving = ref(false);

const MODES: Record<Mode, { label: string; icon: string }> = {
  office: { label: 'Офис', icon: 'building' },
  remote: { label: 'Удалённо', icon: 'monitor' },
  off: { label: 'Не работает', icon: 'moon' },
};
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const subordinateIds = computed(() => new Set(auth.me?.permissions.approveSubordinates ?? []));
const canPick = computed(() => auth.isAdmin || subordinateIds.value.size > 0);
const year = computed(() => Number(month.value.slice(0, 4)));
const overrideMap = computed(() => new Map((schedule.value?.overrides ?? []).map((o) => [o.date, o.mode])));
const futureOverrides = computed(() => (schedule.value?.overrides ?? []).filter((o) => o.date >= today));
const selected = computed(() => people.value.find((p) => p.id === employeeId.value));
/** Отдел выбранного сотрудника; для своего графика без выбора — отдел из карточки. */
const ownDept = ref<string | null>(null);
const deptOf = computed(() => selected.value?.deptName ?? (employeeId.value === auth.me?.employee.id ? ownDept.value : null));

/** Сетка месяца с понедельника; null — пустые клетки до 1-го числа. */
const grid = computed(() => {
  const first = `${month.value}-01`;
  const lastDay = new Date(Date.UTC(year.value, Number(month.value.slice(5)) , 0)).getUTCDate();
  const lead = (weekday(first) + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 0; d < lastDay; d++) cells.push(addDays(first, d));
  return cells;
});

function inVacation(iso: string): boolean {
  return vacations.value.some((v) => v.status === 'approved' && v.start <= iso && iso <= v.end);
}

function effective(iso: string): { mode: Mode | 'vacation' | 'holiday'; override: boolean } {
  if (inVacation(iso)) return { mode: 'vacation', override: false };
  const o = overrideMap.value.get(iso);
  if (o) return { mode: o, override: true };
  if (holidays.value.has(iso)) return { mode: 'holiday', override: false };
  if (isDayOff(iso, workCal.value)) return { mode: 'off', override: false };
  return { mode: pattern.value[weekday(iso)] ?? 'office', override: false };
}

function cyclePattern(wd: number): void {
  const cur = pattern.value[wd] ?? (wd === 0 || wd === 6 ? 'off' : 'office');
  const next: Mode = cur === 'office' ? 'remote' : cur === 'remote' ? 'off' : 'office';
  pattern.value = { ...pattern.value, [wd]: next };
  dirty.value = true;
}

async function savePattern(): Promise<void> {
  saving.value = true;
  try {
    const body = Object.fromEntries(WEEK.map((wd) => [wd, pattern.value[wd] ?? (wd === 0 || wd === 6 ? 'off' : 'office')]));
    await api.put(`/employees/${employeeId.value}/work-pattern`, body);
    dirty.value = false;
    ui.toast('Недельный график сохранён');
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    saving.value = false;
  }
}

/** Клик по дню: исключение офис ↔ удалённо; повтор к значению шаблона снимает исключение. */
async function toggleDay(iso: string): Promise<void> {
  const eff = effective(iso);
  if (eff.mode === 'vacation') return;
  const base = isDayOff(iso, workCal.value) ? 'off' : pattern.value[weekday(iso)] ?? 'office';
  const cur = eff.mode === 'holiday' ? 'off' : eff.mode;
  const next: Mode = cur === 'office' ? 'remote' : cur === 'remote' ? (base === 'off' ? 'off' : 'office') : 'office';
  try {
    if (next === base && eff.override) {
      await api.del(`/employees/${employeeId.value}/work-overrides/${iso}`);
    } else {
      await api.put(`/employees/${employeeId.value}/work-overrides`, { date: iso, mode: next });
    }
    await load();
  } catch (e) {
    ui.error(e);
  }
}

async function removeOverride(iso: string): Promise<void> {
  try {
    await api.del(`/employees/${employeeId.value}/work-overrides/${iso}`);
    await load();
  } catch (e) {
    ui.error(e);
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const y = year.value;
    const [ws, h, sch] = await Promise.all([
      api.get<WorkSchedule>(`/employees/${employeeId.value}/work-schedule?from=${y}-01-01&to=${y}-12-31`),
      calendar.workCalendar(y),
      // Отпуска выбранного — из графика его отдела: без фильтра пришёл бы график всей организации
      api.get<Schedule>(`/schedule?from=${month.value}-01&to=${addDays(`${month.value}-01`, 41)}${deptOf.value ? `&dept=${encodeURIComponent(deptOf.value)}` : ''}`),
    ]);
    schedule.value = ws;
    if (!dirty.value) pattern.value = Object.fromEntries(Object.entries(ws.pattern).map(([k, v]) => [Number(k), v]));
    workCal.value = h;
    holidays.value = h.holidays;
    vacations.value = sch.employees.find((e) => e.id === employeeId.value)?.vacations ?? [];
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}

async function loadPeople(): Promise<void> {
  const me = auth.me!.employee;
  if (auth.isAdmin) {
    departments.value = await api.get<Department[]>('/departments');
    dept.value = departments.value.find((d) => d.id === me.deptId)?.label ?? departments.value[0]?.label ?? '';
    ownDept.value = departments.value.find((d) => d.id === me.deptId)?.label ?? null;
    return;
  }
  // Сам руководитель и его прямые подчинённые — фильтром сервера, а не среди первых 200 сотрудников
  const [self, page] = await Promise.all([
    api.get<Employee>(`/employees/${me.id}`),
    api.get<Page<Employee>>(`/employees?manager=${me.id}&per_page=200`),
  ]);
  people.value = [self, ...page.items.filter((e) => e.id !== me.id)];
}

watch(dept, async (d) => {
  if (!d) return;
  const page = await api.get<Page<Employee>>(`/employees?dept=${encodeURIComponent(d)}&per_page=200`);
  people.value = page.items;
  if (!people.value.some((p) => p.id === employeeId.value) && people.value.length) employeeId.value = people.value[0].id;
});
watch(employeeId, () => { dirty.value = false; void load(); });
watch(month, () => void load());

function shiftMonth(n: number): void {
  const d = new Date(Date.UTC(year.value, Number(month.value.slice(5)) - 1 + n, 1));
  month.value = d.toISOString().slice(0, 7);
}

onMounted(async () => {
  if (canPick.value) await loadPeople().catch(() => undefined);
  else ownDept.value = (await api.get<Employee>(`/employees/${auth.me!.employee.id}`).catch(() => null))?.deptName ?? null;
  await load();
});
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          График работы
          <HelpLink topic="workSchedule" />
        </div>
        <div class="view-subtitle">
          Офис и удалёнка: недельный шаблон и разовые исключения{{ selected && selected.id !== auth.me?.employee.id ? ` · ${selected.name}` : '' }}
        </div>
      </div>
      <div
        v-if="canPick"
        class="toolbar"
      >
        <select
          v-if="auth.isAdmin"
          v-model="dept"
          class="input"
          style="width: auto"
          aria-label="Подразделение"
        >
          <option
            v-for="d in departments"
            :key="d.id"
            :value="d.label"
          >
            {{ indented(d) }}
          </option>
        </select>
        <select
          v-model="employeeId"
          class="input"
          style="width: auto; min-width: 240px"
          aria-label="Сотрудник"
        >
          <option
            v-for="p in people"
            :key="p.id"
            :value="p.id"
          >
            {{ p.name }}{{ p.id === auth.me?.employee.id ? ' (я)' : '' }}
          </option>
        </select>
      </div>
    </div>

    <div class="ws-grid">
      <section class="card">
        <div class="card-header">
          <span class="section-title"><AppIcon
            name="layers"
            :size="15"
          /> Недельный шаблон</span>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            :disabled="!dirty || saving"
            @click="savePattern"
          >
            Сохранить
          </button>
        </div>
        <div class="card-body">
          <div class="week">
            <button
              v-for="wd in WEEK"
              :key="wd"
              type="button"
              class="day-btn"
              :class="`m-${pattern[wd] ?? (wd === 0 || wd === 6 ? 'off' : 'office')}`"
              :title="`${WD[wd]}: ${MODES[pattern[wd] ?? (wd === 0 || wd === 6 ? 'off' : 'office')].label} — нажмите, чтобы сменить`"
              @click="cyclePattern(wd)"
            >
              <span class="day-name">{{ WD[wd] }}</span>
              <AppIcon
                :name="MODES[pattern[wd] ?? (wd === 0 || wd === 6 ? 'off' : 'office')].icon"
                :size="18"
              />
              <span class="day-mode">{{ MODES[pattern[wd] ?? (wd === 0 || wd === 6 ? 'off' : 'office')].label }}</span>
            </button>
          </div>
          <p class="soft small hint">
            Нажмите на день, чтобы переключить: офис → удалённо → не работает. Шаблон действует на все даты, кроме исключений.
          </p>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <span class="section-title"><AppIcon
            name="schedule"
            :size="15"
          /> {{ MONTHS[Number(month.slice(5)) - 1] }} {{ year }}</span>
          <div class="toolbar">
            <button
              class="btn btn-icon btn-sm btn-ghost"
              type="button"
              aria-label="Предыдущий месяц"
              @click="shiftMonth(-1)"
            >
              <AppIcon
                name="chevronLeft"
                :size="15"
              />
            </button>
            <button
              class="btn btn-icon btn-sm btn-ghost"
              type="button"
              aria-label="Следующий месяц"
              @click="shiftMonth(1)"
            >
              <AppIcon
                name="chevronRight"
                :size="15"
              />
            </button>
          </div>
        </div>
        <div class="card-body">
          <div class="cal">
            <span
              v-for="d in [1, 2, 3, 4, 5, 6, 0]"
              :key="`h${d}`"
              class="cal-head"
            >{{ WD[d] }}</span>
            <template
              v-for="(iso, i) in grid"
              :key="i"
            >
              <span
                v-if="!iso"
                class="cal-empty"
              />
              <button
                v-else
                type="button"
                class="cal-cell"
                :class="[`m-${effective(iso).mode}`, { today: iso === today, override: effective(iso).override }]"
                :disabled="loading || effective(iso).mode === 'vacation'"
                :title="`${fmtDate(iso)} — ${effective(iso).mode === 'vacation' ? 'отпуск' : effective(iso).mode === 'holiday' ? 'праздник' : MODES[effective(iso).mode as Mode].label}${effective(iso).override ? ' (исключение)' : ''}`"
                @click="toggleDay(iso)"
              >
                {{ Number(iso.slice(8)) }}
              </button>
            </template>
          </div>
          <div class="cal-legend">
            <span><i class="m-office" />офис</span>
            <span><i class="m-remote" />удалённо</span>
            <span><i class="m-vacation" />отпуск</span>
            <span><i class="m-holiday" />праздник</span>
            <span><i class="m-off" />выходной</span>
            <span><i class="dot" />исключение</span>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-header">
        <span class="section-title">Предстоящие исключения <span class="count">{{ futureOverrides.length }}</span></span>
      </div>
      <EmptyState
        v-if="!futureOverrides.length"
        icon="layers"
        title="Исключений нет"
        text="Нажмите на день в календаре, чтобы поменять офис на удалёнку разово."
        compact
      />
      <div
        v-else
        class="chips"
      >
        <span
          v-for="o in futureOverrides"
          :key="o.date"
          class="chip"
          :class="`m-${o.mode}`"
        >
          <AppIcon
            :name="MODES[o.mode].icon"
            :size="13"
          />
          {{ fmtDate(o.date, o.date.slice(0, 4) !== today.slice(0, 4)) }}
          <button
            type="button"
            :aria-label="`Снять исключение ${fmtDate(o.date)}`"
            @click="removeOverride(o.date)"
          >
            <AppIcon
              name="close"
              :size="12"
            />
          </button>
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ws-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}

.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.day-btn {
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: 10px 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font: inherit;
  color: var(--color-text);
}

.day-name {
  font-weight: 650;
  font-size: 12.5px;
}

.day-mode {
  font-size: 10px;
  color: var(--color-text-muted);
}

.day-btn.m-office { border-color: color-mix(in srgb, var(--status-office) 50%, transparent); background: color-mix(in srgb, var(--status-office) 8%, var(--color-surface)); }
.day-btn.m-office .app-icon { color: var(--status-office); }
.day-btn.m-remote { border-color: color-mix(in srgb, var(--status-remote) 50%, transparent); background: color-mix(in srgb, var(--status-remote) 8%, var(--color-surface)); }
.day-btn.m-remote .app-icon { color: var(--status-remote); }
.day-btn.m-off .app-icon { color: var(--color-text-soft); }

.hint {
  margin: 12px 0 0;
}

.cal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.cal-head {
  text-align: center;
  font-size: 11px;
  color: var(--color-text-soft);
  padding-bottom: 4px;
}

.cal-cell {
  position: relative;
  aspect-ratio: 1.25;
  border: none;
  border-radius: 7px;
  font: inherit;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  color: var(--color-text);
}

.cal-cell:disabled {
  cursor: default;
}

.cal-cell.today {
  box-shadow: inset 0 0 0 2px var(--color-text);
  font-weight: 700;
}

.cal-cell.override::after,
.cal-legend .dot {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-warning);
}

.m-office { background: color-mix(in srgb, var(--status-office) 16%, transparent); }
.m-remote { background: color-mix(in srgb, var(--status-remote) 20%, transparent); }
.m-vacation { background: color-mix(in srgb, var(--status-vacation) 22%, transparent); }
.m-holiday { background: var(--color-holiday); color: var(--color-danger-dark) !important; }
.m-off { background: var(--color-weekend); color: var(--color-text-soft) !important; }

.cal-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.cal-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.cal-legend i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
  position: relative;
}

.cal-legend .dot {
  position: static;
  width: 7px;
  height: 7px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 14px 16px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border-radius: 20px;
  font-size: 12px;
}

.chip button {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-text-muted);
  border-radius: 50%;
  padding: 2px;
  display: flex;
}

.chip button:hover {
  background: var(--color-hover);
}

@media (pointer: coarse) {
  .cal-cell {
    aspect-ratio: 1;
  }
}

@media (max-width: 900px) {
  .ws-grid {
    grid-template-columns: 1fr;
  }
}
</style>
