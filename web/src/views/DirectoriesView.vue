<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type Department, type Employee, type Page } from '@/api/client';
import { useCalendarStore } from '@/stores/calendar';
import { useUiStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';
import { addDays, fmtDate, isWeekend, localIso, MONTHS, WEEKDAYS_SHORT, weekday } from '@/lib/dates';
import { parseCalendarFile, toggleHoliday, type Transfer } from '@/lib/calendar';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';

interface Project { id: number; name: string; managerId: number | null; headcount: number }
type Tab = 'departments' | 'projects' | 'calendar';

const ui = useUiStore();
const auth = useAuthStore();
const calendar = useCalendarStore();
const tab = ref<Tab>('departments');
const departments = ref<Department[]>([]);
const projects = ref<Project[]>([]);
const people = ref<Map<number, Employee>>(new Map());
const error = ref('');
const loading = ref(true);
const calYear = ref(Number(localIso(new Date()).slice(0, 4)));
const holidays = ref<string[]>([]);
const transfers = ref<Transfer[]>([]);
// Редактор календаря (кадровая служба, администратор): черновик года до сохранения
const calEdit = ref<{ holidays: string[]; transfers: Transfer[] } | null>(null);
const calBusy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// Диалог отдела/проекта
const editor = ref<{ kind: 'department' | 'project'; original: Department | Project | null; name: string; managerId: number | null } | null>(null);
const candidates = ref<Employee[]>([]);
const busy = ref(false);

const managerName = (id: number | null) => (id ? people.value.get(id)?.name ?? `#${id}` : null);

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [d, p, e] = await Promise.all([
      api.get<Department[]>('/departments'),
      api.get<Project[]>('/projects'),
      loadAllEmployees(),
    ]);
    departments.value = d;
    projects.value = p;
    people.value = new Map(e.map((x) => [x.id, x]));
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

/** Все активные сотрудники постранично (для выбора руководителей). */
async function loadAllEmployees(): Promise<Employee[]> {
  const out: Employee[] = [];
  for (let page = 1; page < 100; page++) {
    const data = await api.get<Page<Employee>>(`/employees?page=${page}&per_page=200`);
    out.push(...data.items);
    if (out.length >= data.meta.total || !data.items.length) break;
  }
  return out;
}

async function loadHolidays(): Promise<void> {
  calEdit.value = null;
  try {
    const cal = await api.get<{ holidays: string[]; transfers: Transfer[] }>(`/calendar/holidays/${calYear.value}`);
    holidays.value = [...cal.holidays].sort();
    transfers.value = cal.transfers ?? [];
  } catch {
    holidays.value = []; // календарь года не загружен
    transfers.value = [];
  }
}

/** «Откуда» переноса становится рабочим днём, только если это выходной и не праздник. */
const becomesWorking = (d: string) => isWeekend(d) && !holidays.value.includes(d);

function shiftYear(delta: number): void {
  calYear.value += delta;
  void loadHolidays();
}

function startCalEdit(): void {
  calEdit.value = { holidays: [...holidays.value], transfers: transfers.value.map((t) => ({ ...t })) };
}

/** Сетка года для редактора: месяцы с отступом до понедельника. */
const editMonths = computed(() => MONTHS.map((name, i) => {
  const first = `${calYear.value}-${String(i + 1).padStart(2, '0')}-01`;
  const days: string[] = [];
  for (let d = first; d.slice(5, 7) === first.slice(5, 7); d = addDays(d, 1)) days.push(d);
  return { name, offset: (weekday(first) + 6) % 7, days };
}));

function dayClass(d: string): Record<string, boolean> {
  const ed = calEdit.value;
  return {
    weekend: isWeekend(d),
    holiday: !!ed?.holidays.includes(d),
    'transfer-off': !!ed?.transfers.some((t) => t.to === d),
    // «откуда» переноса становится рабочим, только если это выходной и не праздник
    'transfer-work': !!ed?.transfers.some((t) => t.from === d) && isWeekend(d) && !ed?.holidays.includes(d),
  };
}

function toggleDay(d: string): void {
  if (calEdit.value) calEdit.value.holidays = toggleHoliday(calEdit.value.holidays, d);
}

async function importFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !calEdit.value) return;
  const parsed = parseCalendarFile(await file.text(), calYear.value);
  if (!parsed.holidays.length && !parsed.transfers.length) {
    ui.toast(`В файле нет дат ${calYear.value} года`, 'error');
    return;
  }
  calEdit.value = { holidays: parsed.holidays, transfers: parsed.transfers };
  const skipped = parsed.skipped ? `; пропущено строк: ${parsed.skipped}` : '';
  ui.toast(`Из файла: праздников ${parsed.holidays.length}, переносов ${parsed.transfers.length}${skipped}. Проверьте и сохраните.`, 'info');
}

async function saveCalendar(): Promise<void> {
  const ed = calEdit.value;
  if (!ed) return;
  calBusy.value = true;
  try {
    const body = { holidays: ed.holidays, transfers: ed.transfers.filter((t) => t.from && t.to) };
    const saved = await api.put<{ holidays: string[]; transfers: Transfer[] }>(`/calendar/holidays/${calYear.value}`, body);
    holidays.value = saved.holidays;
    transfers.value = saved.transfers;
    calendar.years[calYear.value] = saved; // график и формы сразу считают по новому календарю
    calEdit.value = null;
    ui.toast(`Календарь ${calYear.value} сохранён`);
  } catch (e) {
    ui.error(e);
  } finally {
    calBusy.value = false;
  }
}

const holidaysByMonth = computed(() => MONTHS.map((name, i) => ({
  name,
  days: holidays.value.filter((d) => Number(d.slice(5, 7)) === i + 1),
})).filter((m) => m.days.length));

function openEditor(kind: 'department' | 'project', item: Department | Project | null): void {
  editor.value = { kind, original: item, name: item?.name ?? '', managerId: item?.managerId ?? null };
  const list = [...people.value.values()];
  candidates.value = kind === 'department' && item
    ? list.filter((e) => e.deptName === item.name || e.id === item.managerId)
    : list;
  candidates.value.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

async function saveEditor(): Promise<void> {
  const ed = editor.value;
  if (!ed) return;
  busy.value = true;
  try {
    const body = { name: ed.name.trim(), managerId: ed.managerId ?? undefined };
    if (ed.kind === 'department') {
      if (ed.original) await api.patch(`/departments/${encodeURIComponent(ed.original.name)}`, body);
      else await api.post('/departments', body);
    } else if (ed.original) {
      await api.patch(`/projects/${(ed.original as Project).id}`, body);
    } else {
      await api.post('/projects', body);
    }
    ui.toast(ed.original ? 'Изменения сохранены' : ed.kind === 'department' ? 'Отдел создан' : 'Проект создан');
    editor.value = null;
    await reload();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}

async function remove(kind: 'department' | 'project', item: Department | Project): Promise<void> {
  const answer = await ui.ask({
    title: `Удалить ${kind === 'department' ? 'отдел' : 'проект'} «${item.name}»?`,
    text: item.headcount ? `В нём ${item.headcount} чел. — сначала переведите их.` : 'Действие попадёт в журнал аудита.',
    confirmLabel: 'Удалить',
    danger: true,
  });
  if (!answer.ok) return;
  try {
    if (kind === 'department') await api.del(`/departments/${encodeURIComponent(item.name)}`);
    else await api.del(`/projects/${(item as Project).id}`);
    ui.toast('Удалено', 'info');
    await reload();
  } catch (e) {
    ui.error(e);
  }
}

onMounted(() => {
  void reload();
  void loadHolidays();
});
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Справочники
        </div>
        <div class="view-subtitle">
          Структура организации и производственный календарь
        </div>
      </div>
      <button
        v-if="tab !== 'calendar'"
        class="btn btn-primary"
        type="button"
        @click="openEditor(tab === 'departments' ? 'department' : 'project', null)"
      >
        <AppIcon
          name="plus"
          :size="15"
        /> {{ tab === 'departments' ? 'Отдел' : 'Проект' }}
      </button>
    </div>

    <div class="segmented tabs">
      <button
        type="button"
        :class="{ active: tab === 'departments' }"
        @click="tab = 'departments'"
      >
        <AppIcon
          name="building"
          :size="14"
        /> Отделы <span class="soft">{{ departments.length }}</span>
      </button>
      <button
        type="button"
        :class="{ active: tab === 'projects' }"
        @click="tab = 'projects'"
      >
        <AppIcon
          name="briefcase"
          :size="14"
        /> Проекты <span class="soft">{{ projects.length }}</span>
      </button>
      <button
        type="button"
        :class="{ active: tab === 'calendar' }"
        @click="tab = 'calendar'"
      >
        <AppIcon
          name="schedule"
          :size="14"
        /> Производственный календарь
      </button>
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
      v-if="tab !== 'calendar'"
      class="card"
    >
      <div
        v-if="loading"
        class="card-body"
      >
        <div
          v-for="i in 5"
          :key="i"
          class="skeleton"
          style="height: 34px; margin-bottom: 8px"
        />
      </div>
      <template v-else>
        <EmptyState
          v-if="!(tab === 'departments' ? departments : projects).length"
          :icon="tab === 'departments' ? 'building' : 'briefcase'"
          :title="tab === 'departments' ? 'Отделов пока нет' : 'Проектов пока нет'"
          text="Добавьте первый — сотрудников можно будет распределить в карточке сотрудника."
        />
        <table
          v-else
          class="data-table"
        >
          <thead>
            <tr>
              <th>Название</th>
              <th>Руководитель</th>
              <th class="num">
                Сотрудников
              </th>
              <th class="actions" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in (tab === 'departments' ? departments : projects)"
              :key="item.name"
            >
              <td><strong>{{ item.name }}</strong></td>
              <td>
                <div
                  v-if="managerName(item.managerId)"
                  class="person"
                >
                  <UserAvatar
                    :name="managerName(item.managerId)!"
                    :size="24"
                  />
                  <span>{{ managerName(item.managerId) }}</span>
                </div>
                <span
                  v-else
                  class="badge badge-warning"
                >не назначен</span>
              </td>
              <td class="num">
                {{ item.headcount }}
              </td>
              <td class="actions">
                <div class="row-actions">
                  <button
                    class="btn btn-icon btn-sm btn-ghost"
                    type="button"
                    title="Изменить"
                    @click="openEditor(tab === 'departments' ? 'department' : 'project', item)"
                  >
                    <AppIcon
                      name="edit"
                      :size="15"
                    />
                  </button>
                  <button
                    class="btn btn-icon btn-sm btn-ghost btn-danger"
                    type="button"
                    title="Удалить"
                    @click="remove(tab === 'departments' ? 'department' : 'project', item)"
                  >
                    <AppIcon
                      name="trash"
                      :size="15"
                    />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <div
      v-else
      class="card"
    >
      <div class="card-header">
        <span class="section-title">Нерабочие праздничные дни {{ calYear }} <span class="count">{{ holidays.length }}</span></span>
        <div class="cal-actions">
          <div class="year-switch">
            <button
              class="btn btn-icon btn-sm btn-ghost"
              type="button"
              aria-label="Предыдущий год"
              :disabled="!!calEdit"
              @click="shiftYear(-1)"
            >
              <AppIcon
                name="chevronLeft"
                :size="15"
              />
            </button>
            <strong>{{ calYear }}</strong>
            <button
              class="btn btn-icon btn-sm btn-ghost"
              type="button"
              aria-label="Следующий год"
              :disabled="!!calEdit"
              @click="shiftYear(1)"
            >
              <AppIcon
                name="chevronRight"
                :size="15"
              />
            </button>
          </div>
          <template v-if="auth.isStaff">
            <button
              v-if="!calEdit"
              class="btn btn-sm"
              type="button"
              @click="startCalEdit"
            >
              <AppIcon
                name="edit"
                :size="14"
              /> Изменить
            </button>
            <template v-else>
              <button
                class="btn btn-sm btn-ghost"
                type="button"
                title="Файл xmlcalendar.ru (XML) или текст/CSV с датами"
                @click="fileInput?.click()"
              >
                <AppIcon
                  name="upload"
                  :size="14"
                /> Из файла
              </button>
              <input
                ref="fileInput"
                type="file"
                accept=".xml,.csv,.txt,text/plain,text/csv,application/xml,text/xml"
                hidden
                @change="importFile"
              >
              <button
                class="btn btn-sm btn-ghost"
                type="button"
                @click="calEdit = null"
              >
                Отмена
              </button>
              <button
                class="btn btn-sm btn-primary"
                type="button"
                :disabled="calBusy"
                @click="saveCalendar"
              >
                <AppIcon
                  name="check"
                  :size="14"
                /> Сохранить
              </button>
            </template>
          </template>
        </div>
      </div>
      <template v-if="calEdit">
        <div class="card-body soft small cal-hint">
          Щёлкните день, чтобы отметить или снять нерабочий праздник. Переносы выходных — ниже.
          <span class="legend"><i class="lg holiday" /> праздник <i class="lg transfer-off" /> перенесённый выходной <i class="lg transfer-work" /> рабочий выходной</span>
        </div>
        <div class="cal-grid">
          <div
            v-for="m in editMonths"
            :key="m.name"
            class="cal-month"
          >
            <div class="holiday-month-name">
              {{ m.name }}
            </div>
            <div class="cal-days">
              <span
                v-for="w in ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']"
                :key="w"
                class="cal-wd"
              >{{ w }}</span>
              <span
                v-for="n in m.offset"
                :key="`o${n}`"
              />
              <button
                v-for="d in m.days"
                :key="d"
                type="button"
                class="cal-day"
                :class="dayClass(d)"
                :aria-pressed="calEdit.holidays.includes(d)"
                :title="fmtDate(d)"
                @click="toggleDay(d)"
              >
                {{ Number(d.slice(8)) }}
              </button>
            </div>
          </div>
        </div>
        <div class="card-body transfers-edit">
          <div class="holiday-month-name">
            Переносы выходных
          </div>
          <div
            v-for="(t, i) in calEdit.transfers"
            :key="i"
            class="transfer-row"
          >
            <label class="field-inline">Выходной <input
              v-model="t.from"
              class="input transfer-date"
              type="date"
              aria-label="Выходной, который становится рабочим"
            ></label>
            <span class="soft">→ рабочим, взамен</span>
            <label class="field-inline">день <input
              v-model="t.to"
              class="input transfer-date"
              type="date"
              aria-label="Рабочий день, который становится выходным"
            ></label>
            <button
              class="btn btn-icon btn-sm btn-ghost btn-danger"
              type="button"
              title="Убрать перенос"
              @click="calEdit.transfers.splice(i, 1)"
            >
              <AppIcon
                name="trash"
                :size="14"
              />
            </button>
          </div>
          <button
            class="btn btn-sm btn-ghost"
            type="button"
            @click="calEdit.transfers.push({ from: '', to: '' })"
          >
            <AppIcon
              name="plus"
              :size="14"
            /> Перенос
          </button>
        </div>
      </template>
      <template v-else>
        <EmptyState
          v-if="!holidays.length"
          icon="schedule"
          :title="`Календарь ${calYear} не загружен`"
          :text="auth.isStaff
            ? 'Без календаря праздники не исключаются из дней отпуска. Нажмите «Изменить»: отметьте праздники вручную или загрузите файл xmlcalendar.ru.'
            : 'Без календаря праздники не исключаются из дней отпуска. Календарь загружает кадровая служба.'"
        />
        <div
          v-else
          class="holidays"
        >
          <div
            v-for="m in holidaysByMonth"
            :key="m.name"
            class="holiday-month"
          >
            <div class="holiday-month-name">
              {{ m.name }}
            </div>
            <div class="holiday-days">
              <span
                v-for="d in m.days"
                :key="d"
                class="holiday-chip"
                :title="fmtDate(d)"
              >
                <strong>{{ Number(d.slice(8)) }}</strong>
                <small>{{ WEEKDAYS_SHORT[weekday(d)] }}</small>
              </span>
            </div>
          </div>
        </div>
        <div
          v-if="transfers.length"
          class="card-body transfers"
        >
          <div class="holiday-month-name">
            Переносы выходных
          </div>
          <div
            v-for="t in transfers"
            :key="t.to"
            class="small"
          >
            <strong>{{ WEEKDAYS_SHORT[weekday(t.to)] }} {{ fmtDate(t.to) }}</strong> — выходной, перенесён с {{ WEEKDAYS_SHORT[weekday(t.from)] }} {{ fmtDate(t.from) }}<span
              v-if="becomesWorking(t.from)"
              class="soft"
            > ({{ WEEKDAYS_SHORT[weekday(t.from)] }} — рабочий день)</span>
          </div>
        </div>
      </template>
      <div class="card-body soft small">
        Праздничные дни внутри отпуска не входят в число дней отпуска и продлевают его (ТК РФ, ст. 120). Переносы выходных учитываются в графике как выходные.
      </div>
    </div>

    <!-- редактор отдела/проекта -->
    <div
      v-if="editor"
      class="modal-overlay"
      @click.self="editor = null"
    >
      <form
        class="modal"
        role="dialog"
        aria-modal="true"
        @submit.prevent="saveEditor"
      >
        <div class="modal-head">
          <div class="modal-title">
            {{ editor.original ? 'Изменить' : 'Новый' }} {{ editor.kind === 'department' ? 'отдел' : 'проект' }}
          </div>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="d-name">Название</label>
            <input
              id="d-name"
              v-model="editor.name"
              class="input"
              required
              maxlength="128"
            >
          </div>
          <div class="field">
            <label for="d-mgr">Руководитель</label>
            <select
              id="d-mgr"
              v-model="editor.managerId"
              class="input"
            >
              <option :value="null">
                Не назначен
              </option>
              <option
                v-for="c in candidates"
                :key="c.id"
                :value="c.id"
              >
                {{ c.name }}{{ c.deptName && editor.kind === 'project' ? ` · ${c.deptName}` : '' }}
              </option>
            </select>
            <span class="field-hint">{{ editor.kind === 'department' ? 'Показаны сотрудники отдела.' : 'Руководитель проекта видит график участников.' }}</span>
          </div>
        </div>
        <div class="modal-actions">
          <button
            class="btn"
            type="button"
            @click="editor = null"
          >
            Отмена
          </button>
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="busy || !editor.name.trim()"
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.tabs {
  margin-bottom: 14px;
}

.year-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.year-switch strong {
  min-width: 40px;
  text-align: center;
}

.holidays {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  padding: 16px;
}

.holiday-month-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.holiday-days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.holiday-chip {
  width: 40px;
  height: 42px;
  border-radius: 9px;
  background: var(--color-holiday);
  color: var(--color-danger-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
}

.holiday-chip small {
  font-size: 10px;
  opacity: 0.8;
}
.cal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cal-hint {
  border-bottom: 1px solid var(--color-border);
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
}

.lg {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-left: 6px;
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 18px;
  padding: 16px;
}

.cal-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}

.cal-wd {
  font-size: 10px;
  color: var(--color-text-soft);
  text-align: center;
}

.cal-day {
  height: 28px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cal-day:hover {
  border-color: var(--color-border-strong);
}

.cal-day:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.cal-day.weekend {
  color: var(--color-text-soft);
  background: var(--color-bg);
}

.cal-day.holiday,
.lg.holiday {
  background: var(--color-holiday);
  color: var(--color-danger-dark);
  font-weight: 600;
}

.cal-day.transfer-off,
.lg.transfer-off {
  box-shadow: inset 0 0 0 2px var(--color-warning);
}

.cal-day.transfer-work,
.lg.transfer-work {
  box-shadow: inset 0 0 0 2px var(--color-primary);
}

.transfers,
.transfers-edit {
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.transfer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.transfer-date {
  width: auto;
  height: 32px;
  padding: 0 8px;
}

.field-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
</style>
