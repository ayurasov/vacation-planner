<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type Department, type Employee, type Page } from '@/api/client';
import { useCalendarStore } from '@/stores/calendar';
import { useUiStore } from '@/stores/ui';
import { fmtDate, localIso, MONTHS, WEEKDAYS_SHORT, weekday } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';

interface Project { id: number; name: string; managerId: number | null; headcount: number }
type Tab = 'departments' | 'projects' | 'calendar';

const ui = useUiStore();
const calendar = useCalendarStore();
const tab = ref<Tab>('departments');
const departments = ref<Department[]>([]);
const projects = ref<Project[]>([]);
const people = ref<Map<number, Employee>>(new Map());
const error = ref('');
const loading = ref(true);
const calYear = ref(Number(localIso(new Date()).slice(0, 4)));
const holidays = ref<string[]>([]);

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
  holidays.value = [...(await calendar.holidays(calYear.value))].sort();
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
        <div class="year-switch">
          <button
            class="btn btn-icon btn-sm btn-ghost"
            type="button"
            aria-label="Предыдущий год"
            @click="calYear--; loadHolidays()"
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
            @click="calYear++; loadHolidays()"
          >
            <AppIcon
              name="chevronRight"
              :size="15"
            />
          </button>
        </div>
      </div>
      <EmptyState
        v-if="!holidays.length"
        icon="schedule"
        :title="`Календарь ${calYear} не загружен`"
        text="Без календаря праздники не исключаются из дней отпуска. Календарь загружается миграцией данных (документ 4)."
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
</style>
