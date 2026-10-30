<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, type DayStatus, type DepartmentOverview, type TeamSnapshot } from '@/api/client';
import { fmtDate, fmtNumber, fmtRange, localIso, plural } from '@/lib/dates';
import { shortName } from '@/lib/people';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import MonthlyLoadChart from '@/components/analytics/MonthlyLoadChart.vue';

type Tab = 'today' | 'year';
const today = localIso(new Date());
const tab = ref<Tab>('today');
const depts = ref<string[]>([]);
const dept = ref('');
const date = ref(today);
const year = ref(Number(today.slice(0, 4)));
const team = ref<TeamSnapshot | null>(null);
const overview = ref<DepartmentOverview | null>(null);
const statusFilter = ref<DayStatus | ''>('');
const loading = ref(true);
const error = ref('');

const STATUS: Record<DayStatus, { label: string; icon: string }> = {
  office: { label: 'В офисе', icon: 'building' },
  remote: { label: 'Удалённо', icon: 'monitor' },
  vacation: { label: 'В отпуске', icon: 'vacation' },
  off: { label: 'Выходной', icon: 'moon' },
};

const members = computed(() => (team.value?.members ?? []).filter((m) => !statusFilter.value || m.status === statusFilter.value));
const planning = computed(() => [...(overview.value?.planning ?? [])].sort((a, b) => b.available - a.available));
const SEVERITY_ICON = { danger: 'warning', warning: 'clock', info: 'info', success: 'check' } as const;

async function loadToday(): Promise<void> {
  team.value = await api.get<TeamSnapshot>(`/analytics/team?dept=${encodeURIComponent(dept.value)}&date=${date.value}`);
}

async function loadYear(): Promise<void> {
  overview.value = await api.get<DepartmentOverview>(`/analytics/overview?dept=${encodeURIComponent(dept.value)}&year=${year.value}`);
}

async function reload(): Promise<void> {
  if (!dept.value || (tab.value === 'today' && !date.value)) return; // очищенная дата — ждём новую, а не ошибку
  loading.value = true;
  error.value = '';
  try {
    if (tab.value === 'today') await loadToday(); else await loadYear();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

watch([tab, dept, date, year], reload);

onMounted(async () => {
  try {
    const res = await api.get<{ items: string[]; own: string | null }>('/analytics/departments');
    depts.value = res.items;
    dept.value = res.own && res.items.includes(res.own) ? res.own : res.items[0] ?? '';
  } catch (e) {
    error.value = (e as Error).message;
  }
  if (!dept.value) loading.value = false;
});
</script>

<template>
  <div class="page">
    <div class="view-header">
      <div>
        <div class="view-title">
          Команда
        </div>
        <div class="view-subtitle">
          Кто где работает сегодня и как распределены отпуска отдела
        </div>
      </div>
      <div class="toolbar">
        <select
          v-if="depts.length > 1"
          v-model="dept"
          class="input"
          style="width: auto; min-width: 220px"
          aria-label="Отдел"
        >
          <option
            v-for="d in depts"
            :key="d"
            :value="d"
          >
            {{ d }}
          </option>
        </select>
        <input
          v-if="tab === 'today'"
          v-model="date"
          type="date"
          class="input"
          style="width: auto"
          aria-label="Дата"
        >
        <div
          v-else
          class="year-switch"
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
      </div>
    </div>

    <div class="segmented tabs">
      <button
        type="button"
        :class="{ active: tab === 'today' }"
        @click="tab = 'today'"
      >
        <AppIcon
          name="today"
          :size="14"
        /> {{ date === today ? 'Сегодня' : fmtDate(date, false) }}
      </button>
      <button
        type="button"
        :class="{ active: tab === 'year' }"
        @click="tab = 'year'"
      >
        <AppIcon
          name="chart"
          :size="14"
        /> Аналитика года
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
      v-if="loading"
      class="card card-body"
    >
      <div
        v-for="i in 4"
        :key="i"
        class="skeleton"
        style="height: 44px; margin-bottom: 10px"
      />
    </div>

    <div
      v-else-if="!dept"
      class="card"
    >
      <EmptyState
        icon="team"
        title="Нет доступных отделов"
        text="Аналитика открывается руководителям по их отделам и сотрудникам — по своему отделу."
      />
    </div>

    <!-- ───────── Сегодня ───────── -->
    <template v-else-if="tab === 'today' && team">
      <div
        v-if="team.overThreshold"
        class="banner banner-error"
      >
        <AppIcon
          name="warning"
          :size="15"
        />
        <span>В отпуске {{ Math.round(team.absentRatio * 100) }}% отдела — выше порога {{ Math.round(team.threshold * 100) }}%. Проверьте замещение.</span>
      </div>

      <div class="status-tiles">
        <button
          v-for="(meta, key) in STATUS"
          :key="key"
          type="button"
          class="card stat status-tile"
          :class="{ active: statusFilter === key }"
          :aria-pressed="statusFilter === key"
          @click="statusFilter = statusFilter === key ? '' : key"
        >
          <span
            class="stat-icon"
            :class="`st-${key}`"
          ><AppIcon
            :name="meta.icon"
            :size="18"
          /></span>
          <div>
            <div class="stat-value">
              {{ team.counts[key] }}
            </div>
            <div class="stat-label">
              {{ meta.label.toLowerCase() }}
            </div>
          </div>
        </button>
        <div class="card stat">
          <span class="stat-icon tone-warning"><AppIcon
            name="clock"
            :size="18"
          /></span>
          <div>
            <div class="stat-value">
              {{ team.counts.pending }}
            </div>
            <div class="stat-label">
              {{ plural(team.counts.pending, ['заявка ждёт', 'заявки ждут', 'заявок ждут']) }} решения
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="section-title">{{ dept }} <span class="count">{{ members.length }} из {{ team.headcount }}</span></span>
          <button
            v-if="statusFilter"
            class="btn btn-sm btn-ghost"
            type="button"
            @click="statusFilter = ''"
          >
            <AppIcon
              name="close"
              :size="13"
            /> Сбросить фильтр
          </button>
        </div>
        <EmptyState
          v-if="!members.length"
          icon="team"
          title="Никого с таким статусом"
          compact
        />
        <table
          v-else
          class="data-table"
        >
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>{{ date === today ? 'Сегодня' : fmtDate(date, false) }}</th>
              <th>Следующий отпуск</th>
              <th class="num">
                Не распределено
              </th>
              <th title="Одна из частей отпуска — не короче 14 календарных дней (ТК РФ, ст. 125)">
                Часть ≥ 14 дн.
              </th>
              <th class="num">
                Заявки
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in members"
              :key="m.id"
            >
              <td>
                <div class="person">
                  <UserAvatar
                    :name="m.name"
                    :size="28"
                  />
                  <span class="person-name">{{ m.name }}</span>
                </div>
              </td>
              <td>
                <span
                  class="status"
                  :class="`st-${m.status}`"
                >
                  <i />{{ STATUS[m.status].label }}<template v-if="m.until">
                    до {{ fmtDate(m.until, false) }}
                  </template>
                </span>
              </td>
              <td class="muted">
                {{ m.next ? fmtRange(m.next.start, m.next.end) : '—' }}
              </td>
              <td class="num">
                <span
                  v-if="m.empType === 'ipsz'"
                  class="soft"
                >—</span>
                <span
                  v-else
                  :class="{ warn: m.available >= 14 }"
                >{{ fmtNumber(m.available) }}</span>
              </td>
              <td>
                <span
                  v-if="m.empType === 'ipsz'"
                  class="soft"
                >—</span>
                <span
                  v-else-if="m.hasStretch"
                  class="badge badge-success"
                >есть</span>
                <span
                  v-else
                  class="badge badge-warning"
                >нет</span>
              </td>
              <td class="num">
                <span
                  v-if="m.pending"
                  class="badge badge-warning"
                >{{ m.pending }}</span>
                <span
                  v-else
                  class="soft"
                >—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ───────── Аналитика года ───────── -->
    <template v-else-if="tab === 'year' && overview">
      <div class="insights">
        <article
          v-for="(ins, i) in overview.insights"
          :key="i"
          class="card insight"
          :class="`sev-${ins.severity}`"
        >
          <span class="insight-icon"><AppIcon
            :name="SEVERITY_ICON[ins.severity]"
            :size="16"
          /></span>
          <div>
            <div class="insight-title">
              {{ ins.title }}
            </div>
            <div class="insight-text">
              {{ ins.text }}
            </div>
          </div>
        </article>
      </div>

      <div class="year-grid">
        <section class="card">
          <div class="card-header">
            <span class="section-title">Доля отдела в отпуске по месяцам</span>
            <span class="soft small">{{ overview.headcount }} чел., рабочие дни</span>
          </div>
          <div class="card-body">
            <MonthlyLoadChart
              :months="overview.months"
              :threshold="overview.threshold"
            />
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <span class="section-title">Периоды конфликтов <span class="count">{{ overview.conflicts.length }}</span></span>
          </div>
          <EmptyState
            v-if="!overview.conflicts.length"
            icon="check"
            title="Конфликтов нет"
            :text="`Ни в один день в отпуске не было ${Math.round(overview.threshold * 100)}% отдела и больше.`"
            compact
          />
          <ul
            v-else
            class="conflicts scroll-thin"
          >
            <li
              v-for="c in overview.conflicts"
              :key="c.start"
            >
              <div>
                <strong>{{ fmtRange(c.start, c.end) }}</strong>
                <div class="soft small">
                  {{ c.names.map(shortName).join(', ') }}
                </div>
              </div>
              <span class="badge badge-danger">{{ Math.round(c.peakRatio * 100) }}%</span>
            </li>
          </ul>
        </section>
      </div>

      <section class="card planning">
        <div class="card-header">
          <span class="section-title">Распределение дней {{ year }}</span>
          <span class="soft small">доступно = остаток − заявки на согласовании</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Запланировано</th>
              <th class="num">
                Не распределено
              </th>
              <th title="Одна из частей отпуска — не короче 14 календарных дней (ТК РФ, ст. 125)">
                Часть ≥ 14 дн.
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in planning"
              :key="p.id"
            >
              <td>
                <div class="person">
                  <UserAvatar
                    :name="p.name"
                    :size="26"
                  />
                  <span class="person-name">{{ p.name }}</span>
                </div>
              </td>
              <td>
                <div class="meter">
                  <span :style="{ width: `${Math.min(100, (p.planned / Math.max(p.planned + Math.max(p.available, 0), 1)) * 100)}%` }" />
                </div>
                <span class="soft small">{{ fmtNumber(p.planned) }} дн.</span>
              </td>
              <td class="num">
                <span :class="{ warn: p.available >= 14 }">{{ fmtNumber(p.available) }}</span>
              </td>
              <td>
                <span
                  v-if="p.hasStretch"
                  class="badge badge-success"
                >есть</span>
                <span
                  v-else
                  class="badge badge-warning"
                >нет</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
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
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  padding: 2px;
}

.year-switch strong {
  min-width: 44px;
  text-align: center;
}

.status-tiles {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.status-tile {
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--color-border);
}

.status-tile:hover {
  border-color: var(--color-border-strong);
}

.status-tile.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-ring);
}

.stat-icon.st-office { background: color-mix(in srgb, var(--status-office) 14%, transparent); color: var(--status-office); }
.stat-icon.st-remote { background: color-mix(in srgb, var(--status-remote) 14%, transparent); color: var(--status-remote); }
.stat-icon.st-vacation { background: color-mix(in srgb, var(--status-vacation) 14%, transparent); color: var(--status-vacation); }
.stat-icon.st-off { background: var(--color-neutral-soft); color: var(--color-text-muted); }

.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

.status i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status.st-office i { background: var(--status-office); }
.status.st-remote i { background: var(--status-remote); }
.status.st-vacation i { background: var(--status-vacation); }
.status.st-off i { background: var(--status-off); }

.warn {
  color: var(--color-warning-dark);
  font-weight: 600;
}

.insights {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.insight {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-left-width: 3px;
}

.insight-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sev-danger { border-left-color: var(--color-danger); }
.sev-danger .insight-icon { background: var(--color-danger-soft); color: var(--color-danger); }
.sev-warning { border-left-color: var(--color-warning); }
.sev-warning .insight-icon { background: var(--color-warning-soft); color: var(--color-warning-dark); }
.sev-info { border-left-color: var(--color-primary); }
.sev-info .insight-icon { background: var(--color-primary-soft); color: var(--color-primary); }
.sev-success { border-left-color: var(--color-success); }
.sev-success .insight-icon { background: var(--color-success-soft); color: var(--color-success); }

.insight-title {
  font-weight: 650;
  font-size: 13.5px;
}

.insight-text {
  font-size: 12.5px;
  color: var(--color-text-muted);
  margin-top: 3px;
  line-height: 1.45;
}

.year-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}

.conflicts {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 300px;
  overflow-y: auto;
}

.conflicts li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
}

.meter {
  width: 120px;
  height: 6px;
  border-radius: 4px;
  background: var(--color-primary-soft);
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
  margin-right: 8px;
}

.meter span {
  display: block;
  height: 100%;
  background: var(--chart-approved);
  border-radius: 4px;
}

@media (max-width: 1100px) {
  .status-tiles {
    grid-template-columns: repeat(2, 1fr);
  }

  .year-grid {
    grid-template-columns: 1fr;
  }
}
</style>
