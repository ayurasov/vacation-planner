<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, type Balance, type Employee, type OrgSettings, type VacationRequest } from '@/api/client';
import { useCalendarStore } from '@/stores/calendar';
import { addDays, calendarDays, fmtDate, fmtNumber, holidaysIn, localIso, plural, vacationDays } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';

/**
 * Диалог заявки. Режимы:
 *  - создание за себя;
 *  - создание за подчинённого (employees передан) — заявка сразу согласована;
 *  - перенос (editing передан) — PATCH, согласованный отпуск уходит на согласование с прежними датами.
 */
const props = defineProps<{
  balance?: Balance | null;
  editing?: VacationRequest | null;
  employees?: Employee[];
}>();
const emit = defineEmits<{ close: []; saved: [VacationRequest] }>();

const calendar = useCalendarStore();
const today = localIso(new Date());
const start = ref(props.editing?.start ?? '');
const end = ref(props.editing?.end ?? '');
const comment = ref(props.editing?.comment ?? '');
const employeeId = ref<number | null>(null);
const holidays = ref<Set<string>>(new Set());
const settings = ref<OrgSettings | null>(null);
const busy = ref(false);
const error = ref('');

const forSubordinate = computed(() => !!props.employees?.length);
const isMove = computed(() => !!props.editing);
const valid = computed(() => !!start.value && !!end.value && start.value <= end.value && (!forSubordinate.value || !!employeeId.value));

const total = computed(() => (valid.value ? calendarDays(start.value, end.value) : 0));
const inPeriodHolidays = computed(() => (valid.value ? holidaysIn(start.value, end.value, holidays.value) : []));
const days = computed(() => (valid.value ? vacationDays(start.value, end.value, holidays.value) : 0));

/** Доступно с учётом заявок на согласовании; при переносе прежние даты освобождаются. */
const available = computed(() => {
  if (!props.balance || forSubordinate.value) return null;
  let a = props.balance.remaining - props.balance.pending;
  if (props.editing) a += vacationDays(props.editing.start, props.editing.end, holidays.value);
  return Math.round(a * 100) / 100;
});
const after = computed(() => (available.value === null ? null : Math.round((available.value - days.value) * 100) / 100));
const overLimit = computed(() => after.value !== null && after.value < 0);
const blocked = computed(() => overLimit.value && settings.value?.limitPolicy === 'hard');

function preset(n: number): void {
  if (!start.value) start.value = addDays(today, 14);
  end.value = addDays(start.value, n - 1);
}

watch(start, async (s) => {
  if (s && end.value && end.value < s) end.value = s;
  if (s) {
    const y = Number(s.slice(0, 4));
    const set = await calendar.holidays(y);
    const next = end.value && end.value.slice(0, 4) !== s.slice(0, 4) ? await calendar.holidays(y + 1) : new Set<string>();
    holidays.value = new Set([...set, ...next]);
  }
}, { immediate: true });

onMounted(async () => {
  try {
    settings.value = await api.get<OrgSettings>('/settings');
  } catch { /* политика лимита — подсказка, не обязательна */ }
});

async function submit(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const body = { start: start.value, end: end.value, comment: comment.value.trim() || undefined };
    const saved = isMove.value
      ? await api.patch<VacationRequest>(`/vacation-requests/${props.editing!.id}`, body)
      : await api.post<VacationRequest>('/vacation-requests', { ...body, ...(employeeId.value ? { employee: employeeId.value } : {}) });
    emit('saved', saved);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="modal-overlay"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <form
      class="modal"
      role="dialog"
      aria-modal="true"
      @submit.prevent="submit"
    >
      <div class="modal-head">
        <div>
          <div class="modal-title">
            {{ isMove ? 'Перенос отпуска' : forSubordinate ? 'Отпуск сотрудника' : 'Новая заявка на отпуск' }}
          </div>
          <div class="modal-sub">
            <template v-if="isMove">
              Сейчас: {{ fmtDate(editing!.start) }} – {{ fmtDate(editing!.end) }}. Новые даты уйдут на согласование.
            </template>
            <template v-else-if="forSubordinate">
              Оформляется руководителем — сразу согласован.
            </template>
            <template v-else>
              Заявка уйдёт руководителю на согласование.
            </template>
          </div>
        </div>
        <button
          class="btn btn-icon btn-ghost"
          type="button"
          aria-label="Закрыть"
          @click="emit('close')"
        >
          <AppIcon
            name="close"
            :size="16"
          />
        </button>
      </div>

      <div class="modal-body">
        <div
          v-if="error"
          class="banner banner-error"
          role="alert"
        >
          <AppIcon
            name="warning"
            :size="15"
          /> <span>{{ error }}</span>
        </div>

        <div
          v-if="forSubordinate"
          class="field"
        >
          <label for="v-emp">Сотрудник</label>
          <select
            id="v-emp"
            v-model="employeeId"
            class="input"
            required
          >
            <option
              :value="null"
              disabled
            >
              Выберите сотрудника
            </option>
            <option
              v-for="e in employees"
              :key="e.id"
              :value="e.id"
            >
              {{ e.name }}
            </option>
          </select>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="v-start">Первый день</label>
            <input
              id="v-start"
              v-model="start"
              type="date"
              class="input"
              :min="today"
              required
            >
          </div>
          <div class="field">
            <label for="v-end">Последний день</label>
            <input
              id="v-end"
              v-model="end"
              type="date"
              class="input"
              :min="start || today"
              required
            >
          </div>
        </div>
        <div class="presets">
          <span class="muted small">Быстро:</span>
          <button
            v-for="n in [7, 14, 28]"
            :key="n"
            type="button"
            class="btn btn-sm"
            @click="preset(n)"
          >
            {{ n }} {{ plural(n, ['день', 'дня', 'дней']) }}
          </button>
        </div>

        <div
          v-if="valid"
          class="preview"
        >
          <div class="preview-main">
            <span class="preview-num">{{ days }}</span>
            <span>{{ plural(days, ['день', 'дня', 'дней']) }} отпуска</span>
          </div>
          <div class="preview-lines">
            <div>
              <span>Календарных дней</span><strong>{{ total }}</strong>
            </div>
            <div v-if="inPeriodHolidays.length">
              <span>Праздники — не в счёт отпуска</span>
              <strong>{{ inPeriodHolidays.length }}</strong>
            </div>
            <div v-if="after !== null">
              <span>Останется после заявки</span>
              <strong :class="{ danger: overLimit }">{{ fmtNumber(after) }}</strong>
            </div>
          </div>
          <div
            v-if="inPeriodHolidays.length"
            class="holiday-list"
          >
            <AppIcon
              name="info"
              :size="13"
            />
            {{ inPeriodHolidays.map((d) => fmtDate(d, false)).join(', ') }} — нерабочие праздничные дни продлевают отпуск (ТК РФ, ст. 120).
          </div>
        </div>

        <div
          v-if="overLimit"
          class="banner"
          :class="blocked ? 'banner-error' : 'banner-warning'"
        >
          <AppIcon
            name="warning"
            :size="15"
          />
          <span v-if="blocked">Не хватает дней: доступно {{ fmtNumber(available!) }}. Сократите период — по правилам организации превышать остаток нельзя.</span>
          <span v-else>Дней больше, чем доступно ({{ fmtNumber(available!) }}). Заявку можно отправить — решение примет руководитель.</span>
        </div>
        <div
          v-if="valid && total >= 14"
          class="banner banner-success"
        >
          <AppIcon
            name="check"
            :size="15"
          /> <span>Часть отпуска не короче 14 дней — требование ТК РФ (ст. 125) выполняется.</span>
        </div>

        <div class="field">
          <label for="v-comment">Комментарий для руководителя <span class="soft">(необязательно)</span></label>
          <textarea
            id="v-comment"
            v-model="comment"
            class="input"
            rows="2"
            maxlength="1000"
            placeholder="Например: семейная поездка, билеты уже куплены"
          />
        </div>
      </div>

      <div class="modal-actions">
        <button
          class="btn"
          type="button"
          @click="emit('close')"
        >
          Отмена
        </button>
        <button
          class="btn btn-primary"
          type="submit"
          :disabled="busy || !valid || blocked"
        >
          {{ busy ? 'Отправляем…' : isMove ? 'Отправить перенос' : forSubordinate ? 'Оформить' : 'Отправить на согласование' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.presets {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -4px 0 14px;
  flex-wrap: wrap;
}

.preview {
  border: 1px solid var(--color-border);
  background: var(--color-surface-2);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin-bottom: 14px;
}

.preview-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--color-primary-dark);
  font-weight: 600;
}

.preview-num {
  font-size: 26px;
  font-weight: 750;
  letter-spacing: -0.02em;
  color: var(--color-primary);
}

.preview-lines {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
}

.preview-lines div {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-muted);
}

.preview-lines strong {
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.preview-lines strong.danger {
  color: var(--color-danger);
}

.holiday-list {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border);
  font-size: 12px;
  color: var(--color-text-muted);
}

.holiday-list .app-icon {
  margin-top: 2px;
  color: var(--color-primary);
}
</style>
