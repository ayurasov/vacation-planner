<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type Delegation, type Employee, type Page, type Schedule, type ScheduleEmployee, type VacationRequest } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useApprovalsStore } from '@/stores/approvals';
import { useCalendarStore } from '@/stores/calendar';
import { useUiStore } from '@/stores/ui';
import { fmtDate, fmtRange, localIso, plural, vacationDays } from '@/lib/dates';
import { shortName } from '@/lib/people';
import { kindLabel } from '@/lib/requests';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import HelpLink from '@/components/common/HelpLink.vue';
import VacationForm from '@/components/VacationForm.vue';

const auth = useAuthStore();
const approvals = useApprovalsStore();
const calendar = useCalendarStore();
const ui = useUiStore();

type Kind = 'all' | 'new' | 'move' | 'delete';
const queue = ref<VacationRequest[]>([]);
const people = ref<Map<number, ScheduleEmployee>>(new Map());
const holidays = ref<Set<string>>(new Set());
const filter = ref<Kind>('all');
const loading = ref(true);
const error = ref('');
const busyId = ref<number | null>(null);
const subordinates = ref<Employee[]>([]);
const formOpen = ref(false);
const today = localIso(new Date());
// Замещение (v0.6.0): чьи заявки в очереди за отсутствующего руководителя
const deputyFor = ref<Delegation[]>([]);

/** Заявка ждёт решения: сколько дней, передана ли вышестоящему (эскалация, v0.6.0). */
function waitInfo(r: VacationRequest): { days: number; escalated: boolean; toMe: boolean } {
  const since = r.pendingSince ?? r.updatedAt;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  return { days, escalated: !!r.escalatedAt, toMe: r.escalatedTo === auth.me?.employee.id };
}

const kindOf = (r: VacationRequest): Exclude<Kind, 'all'> => (r.pendingDeletion ? 'delete' : r.changeFrom ? 'move' : 'new');
const counts = computed(() => ({
  all: queue.value.length,
  new: queue.value.filter((r) => kindOf(r) === 'new').length,
  move: queue.value.filter((r) => kindOf(r) === 'move').length,
  delete: queue.value.filter((r) => kindOf(r) === 'delete').length,
}));
const visible = computed(() => queue.value
  .filter((r) => filter.value === 'all' || kindOf(r) === filter.value)
  .sort((a, b) => a.start.localeCompare(b.start)));

const KIND_TABS: Array<{ key: Kind; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'new', label: 'Новые' },
  { key: 'move', label: 'Переносы' },
  { key: 'delete', label: 'Удаления' },
];

/** Коллеги из того же отдела, чьи отпуска пересекаются с заявкой. */
function overlaps(r: VacationRequest): Array<{ name: string; start: string; end: string; status: string }> {
  const me = people.value.get(r.employee);
  if (!me?.dept) return [];
  const out: Array<{ name: string; start: string; end: string; status: string }> = [];
  for (const p of people.value.values()) {
    if (p.id === r.employee || p.dept !== me.dept) continue;
    for (const v of p.vacations) {
      if (v.start <= r.end && r.start <= v.end) out.push({ name: p.name, start: v.start, end: v.end, status: v.status });
    }
  }
  return out;
}

/** Должность и отдел под именем: отдел есть в заявке, должность — в графике отдела. */
function personSub(r: VacationRequest): string {
  const p = people.value.get(r.employee);
  return [p?.position, r.employeeDept ?? p?.dept].filter(Boolean).join(' · ');
}

function deptSize(r: VacationRequest): number {
  const me = people.value.get(r.employee);
  if (!me?.dept) return 0;
  return [...people.value.values()].filter((p) => p.dept === me.dept).length;
}

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  if (!auth.isAdmin) {
    api.get<{ received: Delegation[] }>('/delegations')
      .then((d) => { deputyFor.value = d.received.filter((x) => x.active); })
      .catch(() => undefined);
  }
  try {
    // Очередь целиком: у администратора организации на 5000 человек заявок бывает больше 200
    const items: VacationRequest[] = [];
    for (let p = 1; p <= 50; p++) {
      const page = await api.get<Page<VacationRequest>>(
        `/vacation-requests?scope=${approvals.scope(auth.isAdmin)}&status=pending&page=${p}&per_page=200`,
      );
      items.push(...page.items);
      approvals.pending = page.meta.total;
      if (items.length >= page.meta.total || !page.items.length) break;
    }
    queue.value = items;
    const years = [...new Set(items.flatMap((r) => [Number(r.start.slice(0, 4)), Number(r.end.slice(0, 4))]))];
    // Пересечения ищутся внутри отдела — график только отделов из очереди, а не всей организации
    const depts = [...new Set(items.map((r) => r.employeeDept).filter((d): d is string => !!d))];
    const map = new Map<number, ScheduleEmployee>();
    const hol = new Set<string>();
    for (const y of years) {
      const [schedules, h] = await Promise.all([
        // Очередь администратора из многих отделов — один запрос всей организации дешевле десятков
        depts.length > 20
          ? Promise.all([api.get<Schedule>(`/schedule?from=${y}-01-01&to=${y}-12-31`)])
          : Promise.all(depts.map((d) => api.get<Schedule>(`/schedule?from=${y}-01-01&to=${y}-12-31&dept=${encodeURIComponent(d)}`))),
        calendar.holidays(y),
      ]);
      for (const e of schedules.flatMap((s) => s.employees)) {
        const prev = map.get(e.id);
        map.set(e.id, prev ? { ...prev, vacations: [...prev.vacations, ...e.vacations] } : e);
      }
      h.forEach((d) => hol.add(d));
    }
    people.value = map;
    holidays.value = hol;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function approve(r: VacationRequest): Promise<void> {
  busyId.value = r.id;
  try {
    await api.post(`/vacation-requests/${r.id}/approve`, {});
    ui.toast(r.pendingDeletion ? `Удаление отпуска согласовано: ${shortName(r.employeeName ?? '')}` : `Согласовано: ${shortName(r.employeeName ?? '')}, ${fmtRange(r.start, r.end)}`);
    await reload();
  } catch (e) {
    ui.error(e);
  } finally {
    busyId.value = null;
  }
}

async function reject(r: VacationRequest): Promise<void> {
  const answer = await ui.ask({
    title: `Отклонить заявку — ${r.employeeName ?? ''}?`,
    text: `${kindLabel(r)}: ${fmtRange(r.start, r.end)}.${r.changeFrom ? ' Отпуск останется на прежних датах.' : r.pendingDeletion ? ' Отпуск останется согласованным.' : ''}`,
    confirmLabel: 'Отклонить',
    danger: true,
    commentMin: 3,
    commentLabel: 'Причина отклонения',
  });
  if (!answer.ok) return;
  busyId.value = r.id;
  try {
    await api.post(`/vacation-requests/${r.id}/reject`, { comment: answer.comment });
    ui.toast('Заявка отклонена, сотрудник получит уведомление с причиной', 'info');
    await reload();
  } catch (e) {
    ui.error(e);
  } finally {
    busyId.value = null;
  }
}

async function loadSubordinates(): Promise<void> {
  if (!auth.me?.permissions.approveSubordinates.length) return;
  try {
    // Прямые подчинённые фильтром сервера: первые 200 сотрудников организации их не содержат
    const page = await api.get<Page<Employee>>(`/employees?manager=${auth.me.employee.id}&per_page=200`);
    subordinates.value = page.items;
  } catch { /* кнопка оформления необязательна */ }
}

async function onCreated(): Promise<void> {
  formOpen.value = false;
  ui.toast('Отпуск сотрудника оформлен и согласован');
  await reload();
}

onMounted(() => {
  void reload();
  void loadSubordinates();
});
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Заявки на согласование
          <HelpLink topic="approvals" />
        </div>
        <div class="view-subtitle">
          {{ auth.isAdmin ? 'Все сотрудники организации' : 'Ждут вашего решения: ваша команда, замещение и переданные вам заявки' }}
        </div>
      </div>
      <div class="toolbar">
        <button
          class="btn"
          type="button"
          :disabled="loading"
          @click="reload"
        >
          <AppIcon
            name="refresh"
            :size="15"
          /> Обновить
        </button>
        <button
          v-if="subordinates.length"
          class="btn btn-primary"
          type="button"
          @click="formOpen = true"
        >
          <AppIcon
            name="plus"
            :size="15"
          /> Оформить отпуск сотруднику
        </button>
      </div>
    </div>

    <div
      v-for="d in deputyFor"
      :key="d.id"
      class="banner banner-info"
    >
      <AppIcon
        name="swap"
        :size="15"
      />
      <span>Вы замещаете {{ d.managerName }} до {{ fmtDate(d.end, d.end.slice(0, 4) !== today.slice(0, 4)) }} — заявки его сотрудников тоже здесь.</span>
    </div>

    <div class="segmented tabs">
      <button
        v-for="t in KIND_TABS"
        :key="t.key"
        type="button"
        :class="{ active: filter === t.key }"
        @click="filter = t.key"
      >
        {{ t.label }} <span class="tab-count">{{ counts[t.key] }}</span>
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
        v-for="i in 3"
        :key="i"
        class="skeleton"
        style="height: 64px; margin-bottom: 10px"
      />
    </div>

    <div
      v-else-if="!visible.length"
      class="card"
    >
      <EmptyState
        icon="approvals"
        :title="queue.length ? 'В этой категории заявок нет' : 'Все заявки рассмотрены'"
        :text="queue.length ? 'Переключитесь на «Все», чтобы увидеть остальные.' : 'Новые заявки подчинённых появятся здесь и в колокольчике уведомлений.'"
      />
    </div>

    <article
      v-for="r in visible"
      :key="r.id"
      class="card request"
    >
      <header class="request-head">
        <div class="person">
          <UserAvatar
            :name="r.employeeName ?? '?'"
            :size="38"
          />
          <div class="person-text">
            <span
              class="person-name"
              :title="r.employeeName"
            >{{ r.employeeName }}</span>
            <span
              class="person-sub"
              :title="personSub(r)"
            >{{ personSub(r) }}</span>
          </div>
        </div>
        <span
          class="badge"
          :class="kindOf(r) === 'new' ? 'badge-info' : kindOf(r) === 'move' ? 'badge-warning' : 'badge-danger'"
        >
          <AppIcon
            :name="kindOf(r) === 'new' ? 'plus' : kindOf(r) === 'move' ? 'swap' : 'trash'"
            :size="11"
            :stroke="2"
          />
          {{ kindLabel(r) }}
        </span>
        <span
          v-if="waitInfo(r).escalated"
          class="badge badge-warning"
          :title="waitInfo(r).toMe ? 'Руководитель сотрудника не принял решение в срок — заявка передана вам' : 'Заявка ждала решения дольше срока и передана выше'"
        >
          <AppIcon
            name="clock"
            :size="11"
            :stroke="2"
          />
          {{ waitInfo(r).toMe ? 'передана вам' : 'эскалирована' }}
        </span>
      </header>

      <div class="request-body">
        <div class="request-period">
          <div class="period-big">
            {{ fmtRange(r.start, r.end) }}
          </div>
          <div class="muted small">
            {{ vacationDays(r.start, r.end, holidays) }} {{ plural(vacationDays(r.start, r.end, holidays), ['день', 'дня', 'дней']) }} отпуска
            <template v-if="r.changeFrom">
              · было {{ fmtRange(r.changeFrom.start, r.changeFrom.end) }}
            </template>
            · подана {{ fmtDate(r.createdAt.slice(0, 10), r.createdAt.slice(0, 4) !== today.slice(0, 4)) }}
            <template v-if="waitInfo(r).days >= 2">
              · ждёт {{ waitInfo(r).days }} {{ plural(waitInfo(r).days, ['день', 'дня', 'дней']) }}
            </template>
          </div>
          <blockquote
            v-if="r.comment"
            class="request-comment"
          >
            {{ r.comment }}
          </blockquote>
        </div>

        <div
          v-if="!r.pendingDeletion"
          class="overlaps"
        >
          <div class="overlaps-title">
            <AppIcon
              :name="overlaps(r).length ? 'warning' : 'check'"
              :size="14"
            />
            <template v-if="overlaps(r).length">
              Пересечения в отделе: {{ overlaps(r).length }} из {{ deptSize(r) - 1 }} коллег
            </template>
            <template v-else>
              Пересечений с коллегами по отделу нет
            </template>
          </div>
          <ul v-if="overlaps(r).length">
            <li
              v-for="(o, i) in overlaps(r).slice(0, 5)"
              :key="i"
            >
              <span>{{ shortName(o.name) }}</span>
              <span class="muted">{{ fmtRange(o.start, o.end) }}</span>
              <span
                v-if="o.status === 'pending'"
                class="badge badge-warning"
              >ожидает</span>
            </li>
            <li
              v-if="overlaps(r).length > 5"
              class="muted"
            >
              и ещё {{ overlaps(r).length - 5 }}
            </li>
          </ul>
        </div>
      </div>

      <footer class="request-actions">
        <button
          class="btn btn-danger"
          type="button"
          :disabled="busyId === r.id"
          @click="reject(r)"
        >
          <AppIcon
            name="close"
            :size="14"
          /> Отклонить
        </button>
        <button
          class="btn btn-success"
          type="button"
          :disabled="busyId === r.id"
          @click="approve(r)"
        >
          <AppIcon
            name="check"
            :size="14"
          /> {{ r.pendingDeletion ? 'Согласовать удаление' : 'Согласовать' }}
        </button>
      </footer>
    </article>

    <VacationForm
      v-if="formOpen"
      :employees="subordinates"
      @close="formOpen = false"
      @saved="onCreated"
    />
  </div>
</template>

<style scoped>
.tabs {
  margin-bottom: 14px;
}

.tab-count {
  font-size: 11px;
  color: var(--color-text-soft);
  font-variant-numeric: tabular-nums;
}

.request {
  margin-bottom: 12px;
}

.request-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap; /* на узком экране вид заявки уходит под имя, а не сжимает его */
  gap: 8px 12px;
  padding: 14px 18px 0;
}

.request-head .person {
  flex: 1 1 220px;
  min-width: 0;
}

.request-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  padding: 14px 18px;
}

.period-big {
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.request-comment {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-left: 3px solid var(--color-primary);
  background: var(--color-surface-2);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 13px;
  color: var(--color-text);
}

.overlaps {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: var(--color-surface-2);
  font-size: 12.5px;
}

.overlaps-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.overlaps ul {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.overlaps li {
  display: flex;
  gap: 8px;
  align-items: center;
}

.request-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-2);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}

@media (max-width: 900px) {
  .request-body {
    grid-template-columns: 1fr;
  }
}
</style>
