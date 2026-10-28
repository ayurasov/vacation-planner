<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useCalendarStore } from '@/stores/calendar';
import { useUiStore } from '@/stores/ui';
import { useApprovalsStore } from '@/stores/approvals';
import { api, type Balance, type Page, type VacationRequest } from '@/api/client';
import {
  dayIndex, daysInYear, fmtDate, fmtNumber, fmtRange, localIso, monthsOf, plural, relativeToToday, vacationDays,
} from '@/lib/dates';
import { barsForYear } from '@/lib/schedule';
import VacationForm from '@/components/VacationForm.vue';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';

const auth = useAuthStore();
const calendar = useCalendarStore();
const ui = useUiStore();
const approvals = useApprovalsStore();

const today = localIso(new Date());
const year = ref(Number(today.slice(0, 4)));
const balance = ref<Balance | null>(null);
const requests = ref<VacationRequest[]>([]);
const holidays = ref<Set<string>>(new Set());
const loading = ref(true);
const error = ref('');
const formOpen = ref(false);
const editing = ref<VacationRequest | null>(null);
const showArchive = ref(false);

const me = computed(() => auth.me?.employee);
const isIpsz = computed(() => me.value?.empType === 'ipsz');

async function reload(): Promise<void> {
  if (!me.value || isIpsz.value) { loading.value = false; return; }
  error.value = '';
  try {
    // Праздники соседних лет — для отпусков через Новый год (дни отпуска в списке без них завышены)
    const [b, rq, ...h] = await Promise.all([
      api.get<Balance>(`/employees/${me.value.id}/balance?year=${year.value}`),
      api.get<Page<VacationRequest>>('/vacation-requests?scope=mine&per_page=200'),
      calendar.holidays(year.value - 1),
      calendar.holidays(year.value),
      calendar.holidays(year.value + 1),
    ]);
    balance.value = b;
    requests.value = rq.items;
    holidays.value = new Set(h.flatMap((x) => [...x]));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

const inYear = (r: VacationRequest) => r.start.startsWith(`${year.value}`) || r.end.startsWith(`${year.value}`);
const active = computed(() => requests.value
  .filter((r) => (r.status === 'pending' || r.status === 'approved') && inYear(r))
  .sort((a, b) => a.start.localeCompare(b.start)));
const archive = computed(() => requests.value.filter((r) => r.status === 'rejected' || r.status === 'cancelled'));
const next = computed(() => active.value.find((r) => r.status === 'approved' && r.end >= today) ?? null);

const available = computed(() => (balance.value ? Math.round((balance.value.remaining - balance.value.pending) * 100) / 100 : 0));
/** Доли полосы баланса: использовано / на согласовании / доступно. */
const bar = computed(() => {
  const b = balance.value;
  if (!b || b.entitlement <= 0) return { used: 0, pending: 0, free: 0 };
  const pct = (n: number) => Math.max(0, Math.min(100, (n / b.entitlement) * 100));
  return { used: pct(b.used), pending: pct(b.pending), free: pct(Math.max(available.value, 0)) };
});

const yearBars = computed(() => barsForYear(year.value, active.value.map((r) => ({
  requestId: r.id, start: r.start, end: r.end, type: r.type, status: r.status,
}))));
const months = computed(() => monthsOf(year.value));
const yearLen = computed(() => daysInYear(year.value));
const todayPct = computed(() => (today.startsWith(`${year.value}-`) ? (dayIndex(year.value, today) / yearLen.value) * 100 : -1));

function days(r: VacationRequest): number {
  return vacationDays(r.start, r.end, holidays.value);
}

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}

function openMove(r: VacationRequest): void {
  editing.value = r;
  formOpen.value = true;
}

async function cancel(r: VacationRequest): Promise<void> {
  const approved = r.status === 'approved';
  const answer = await ui.ask(approved
    ? { title: 'Запросить удаление отпуска?', text: `${fmtRange(r.start, r.end)}. Отпуск согласован — удаление тоже согласует руководитель.`, confirmLabel: 'Запросить удаление', danger: true }
    : { title: 'Отменить заявку?', text: `${fmtRange(r.start, r.end)}. Заявка ещё не согласована и будет отменена сразу.`, confirmLabel: 'Отменить заявку', danger: true });
  if (!answer.ok) return;
  try {
    await api.del(`/vacation-requests/${r.id}`);
    ui.toast(approved ? 'Запрос на удаление отправлен руководителю' : 'Заявка отменена');
    await reload();
  } catch (e) {
    ui.error(e);
  }
}

async function onSaved(): Promise<void> {
  const move = !!editing.value;
  formOpen.value = false;
  editing.value = null;
  ui.toast(move ? 'Перенос отправлен на согласование' : 'Заявка отправлена руководителю');
  await reload();
  void approvals.refresh(auth.isAdmin);
}

watch(year, reload);
onMounted(reload);
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Мой отпуск
        </div>
        <div class="view-subtitle">
          {{ me?.name }}<template v-if="me?.position">
            · {{ me.position }}
          </template>
        </div>
      </div>
      <div class="toolbar">
        <div class="year-switch">
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
        <button
          v-if="!isIpsz"
          class="btn btn-primary"
          type="button"
          @click="openCreate"
        >
          <AppIcon
            name="plus"
            :size="15"
          /> Запланировать отпуск
        </button>
      </div>
    </div>

    <div
      v-if="isIpsz"
      class="card"
    >
      <EmptyState
        icon="briefcase"
        title="Отпуск не предусмотрен"
        text="Для индивидуальных предпринимателей и самозанятых ежегодный отпуск не оформляется. График коллег доступен в разделе «График отпусков»."
      />
    </div>

    <template v-else>
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
          class="skeleton"
          style="height: 22px; width: 40%; margin-bottom: 14px"
        />
        <div
          class="skeleton"
          style="height: 12px; width: 100%"
        />
      </div>

      <template v-else-if="balance">
        <section class="card balance-card">
          <div class="balance-main">
            <div class="balance-label">
              Доступно для планирования в {{ year }}
            </div>
            <div class="balance-value">
              <span :class="{ negative: available < 0 }">{{ fmtNumber(available) }}</span>
              <small>{{ plural(available, ['день', 'дня', 'дней']) }}</small>
            </div>
            <div
              class="balance-bar"
              role="img"
              :aria-label="`Использовано ${balance.used}, на согласовании ${balance.pending}, доступно ${available} из ${balance.entitlement}`"
            >
              <span
                class="seg seg-used"
                :style="{ width: `${bar.used}%` }"
              />
              <span
                class="seg seg-pending"
                :style="{ width: `${bar.pending}%` }"
              />
              <span
                class="seg seg-free"
                :style="{ width: `${bar.free}%` }"
              />
            </div>
            <div class="balance-legend">
              <span><i class="dot dot-used" />использовано {{ fmtNumber(balance.used) }}</span>
              <span><i class="dot dot-pending" />на согласовании {{ fmtNumber(balance.pending) }}</span>
              <span><i class="dot dot-free" />свободно {{ fmtNumber(Math.max(available, 0)) }}</span>
            </div>
          </div>
          <dl class="balance-facts">
            <div>
              <dt>Норма года</dt><dd>{{ fmtNumber(me?.plannedDays ?? 0) }}</dd>
            </div>
            <div>
              <dt>Перенесено с прошлых лет</dt><dd>{{ fmtNumber(me?.carryOver ?? 0) }}</dd>
            </div>
            <div>
              <dt>Всего положено</dt><dd>{{ fmtNumber(balance.entitlement) }}</dd>
            </div>
            <div>
              <dt>Часть ≥ 14 дней (ТК РФ)</dt>
              <dd>
                <span
                  v-if="balance.hasFourteenDayStretch"
                  class="badge badge-success"
                >есть</span>
                <span
                  v-else
                  class="badge badge-warning"
                >нужно запланировать</span>
              </dd>
            </div>
          </dl>
        </section>

        <section
          v-if="next"
          class="card next-card"
        >
          <span class="next-icon"><AppIcon
            name="vacation"
            :size="22"
          /></span>
          <div>
            <div class="muted small">
              {{ next.start <= today ? 'Сейчас вы в отпуске' : 'Ближайший отпуск' }}
            </div>
            <strong>{{ fmtRange(next.start, next.end) }}</strong>
            <span class="muted"> · {{ days(next) }} {{ plural(days(next), ['день', 'дня', 'дней']) }}</span>
          </div>
          <span class="badge badge-info next-rel">{{ relativeToToday(next.start, next.end, today) }}</span>
        </section>

        <section class="card year-card">
          <div class="card-header">
            <span class="section-title">Год одним взглядом</span>
          </div>
          <div class="year-strip">
            <div class="year-months">
              <span
                v-for="m in months"
                :key="m.index"
                :style="{ width: `${(m.days / yearLen) * 100}%` }"
              >{{ m.short }}</span>
            </div>
            <div class="year-track">
              <span
                v-for="b in yearBars"
                :key="b.requestId"
                class="year-bar"
                :class="b.type === 'maternity' ? 'bar-maternity' : b.status === 'approved' ? 'bar-approved' : 'bar-pending'"
                :style="{ left: `${(b.first / yearLen) * 100}%`, width: `${Math.max((b.days / yearLen) * 100, 0.6)}%` }"
                :title="fmtRange(b.start, b.end)"
              />
              <span
                v-if="todayPct >= 0"
                class="year-today"
                :style="{ left: `${todayPct}%` }"
                title="Сегодня"
              />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <span class="section-title">Периоды {{ year }} <span class="count">{{ active.length }}</span></span>
          </div>
          <EmptyState
            v-if="!active.length"
            icon="vacation"
            title="Отпуск ещё не запланирован"
            :text="`Выберите даты — заявка уйдёт руководителю. Доступно ${fmtNumber(available)} ${plural(available, ['день', 'дня', 'дней'])}.`"
          >
            <button
              class="btn btn-primary"
              type="button"
              @click="openCreate"
            >
              <AppIcon
                name="plus"
                :size="15"
              /> Запланировать
            </button>
          </EmptyState>
          <div
            v-for="r in active"
            :key="r.id"
            class="list-row period"
          >
            <div class="date-chip">
              <strong>{{ Number(r.start.slice(8)) }}</strong>
              <span>{{ fmtDate(r.start, false).split(' ')[1].slice(0, 3) }}</span>
            </div>
            <div class="period-main">
              <div class="period-title">
                {{ fmtRange(r.start, r.end) }}
                <span class="muted">· {{ days(r) }} {{ plural(days(r), ['день', 'дня', 'дней']) }}</span>
              </div>
              <div class="period-meta">
                <StatusBadge :request="r" />
                <span
                  v-if="r.changeFrom"
                  class="soft small"
                >было: {{ fmtRange(r.changeFrom.start, r.changeFrom.end) }}</span>
                <span
                  v-else
                  class="soft small"
                >{{ relativeToToday(r.start, r.end, today) }}</span>
                <span
                  v-if="r.comment"
                  class="soft small ellipsis"
                >«{{ r.comment }}»</span>
              </div>
            </div>
            <div
              v-if="!r.pendingDeletion && r.end >= today"
              class="period-actions"
            >
              <button
                class="btn btn-sm"
                type="button"
                :disabled="r.status === 'pending' && !!r.changeFrom"
                @click="openMove(r)"
              >
                <AppIcon
                  name="swap"
                  :size="13"
                /> {{ r.status === 'approved' ? 'Перенести' : 'Изменить' }}
              </button>
              <button
                class="btn btn-sm btn-ghost btn-danger"
                type="button"
                :title="r.status === 'approved' ? 'Запросить удаление' : 'Отменить заявку'"
                @click="cancel(r)"
              >
                <AppIcon
                  name="trash"
                  :size="13"
                />
              </button>
            </div>
          </div>
        </section>

        <section
          v-if="archive.length"
          class="card"
        >
          <button
            class="card-header archive-toggle"
            type="button"
            @click="showArchive = !showArchive"
          >
            <span class="section-title">Отклонённые и отменённые <span class="count">{{ archive.length }}</span></span>
            <AppIcon
              :name="showArchive ? 'chevronUp' : 'chevronDown'"
              :size="15"
            />
          </button>
          <template v-if="showArchive">
            <div
              v-for="r in archive"
              :key="r.id"
              class="list-row"
            >
              <div class="period-main">
                <div>{{ fmtRange(r.start, r.end) }}</div>
                <div
                  v-if="r.rejectionComment"
                  class="soft small"
                >
                  Причина: {{ r.rejectionComment }}
                </div>
              </div>
              <StatusBadge :request="r" />
            </div>
          </template>
        </section>
      </template>
    </template>

    <VacationForm
      v-if="formOpen"
      :balance="balance"
      :editing="editing"
      @close="formOpen = false"
      @saved="onSaved"
    />
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
}

.card + .card {
  margin-top: 14px;
}

.balance-card {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
}

.balance-main {
  padding: 20px 22px;
  border-right: 1px solid var(--color-border);
}

.balance-label {
  font-size: 12.5px;
  color: var(--color-text-muted);
}

.balance-value {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0 14px;
}

.balance-value span {
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}

.balance-value span.negative {
  color: var(--color-danger);
}

.balance-value small {
  font-size: 15px;
  color: var(--color-text-muted);
  font-weight: 500;
}

.balance-bar {
  display: flex;
  height: 10px;
  border-radius: 6px;
  background: var(--color-neutral-soft);
  overflow: hidden;
}

.seg {
  height: 100%;
}

.seg-used, .dot-used { background: var(--color-primary); }
.seg-pending, .dot-pending { background: var(--color-warning); }
.seg-free, .dot-free { background: color-mix(in srgb, var(--color-success) 55%, transparent); }

.balance-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.balance-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.balance-facts {
  margin: 0;
  padding: 14px 22px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.balance-facts div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px dashed var(--color-border);
  font-size: 13px;
}

.balance-facts div:last-child {
  border-bottom: none;
}

.balance-facts dt {
  color: var(--color-text-muted);
}

.balance-facts dd {
  margin: 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.next-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  background: linear-gradient(100deg, var(--color-primary-soft), var(--color-surface) 70%);
}

.next-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.next-rel {
  margin-left: auto;
}

.year-strip {
  padding: 14px 18px 18px;
}

.year-months {
  display: flex;
  font-size: 11px;
  color: var(--color-text-muted);
}

.year-months span {
  border-left: 1px solid var(--color-border);
  padding-left: 4px;
  text-transform: capitalize;
  overflow: hidden;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .year-months span:nth-child(even) {
    color: transparent;
  }
}

.year-track {
  position: relative;
  height: 16px;
  margin-top: 6px;
  border-radius: 8px;
  background: var(--color-neutral-soft);
}

.year-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 8px;
}

.bar-approved { background: var(--color-primary); }
.bar-pending { background: repeating-linear-gradient(135deg, var(--color-warning) 0 4px, color-mix(in srgb, var(--color-warning) 70%, #fff) 4px 8px); }
.bar-maternity { background: var(--color-violet); }

.year-today {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: var(--color-danger);
  border-radius: 1px;
}

.period {
  align-items: center;
}

.date-chip {
  width: 46px;
  height: 46px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
  flex-shrink: 0;
}

.date-chip strong {
  font-size: 16px;
}

.date-chip span {
  font-size: 10.5px;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.period-main {
  flex: 1;
  min-width: 0;
}

.period-title {
  font-weight: 600;
}

.period-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 4px;
  min-width: 0;
}

.period-actions {
  display: flex;
  gap: 4px;
}

.archive-toggle {
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.archive-toggle:hover {
  background: var(--color-hover);
}

@media (max-width: 900px) {
  .balance-card {
    grid-template-columns: 1fr;
  }

  .balance-main {
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }

  .period {
    flex-wrap: wrap;
  }
}
</style>
