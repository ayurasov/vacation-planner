<script setup lang="ts">
// Кампания планирования и утверждение графика (v0.6.0, E60-01/02): открыть со сроком, прогресс по
// отделам и сотрудникам, напоминание, утверждение с реквизитами документа, форма Т-7.
import { computed, onMounted, ref, watch } from 'vue';
import { api, type EmployeePlan, type PlanningOverview, type PlanStatus } from '@/api/client';
import { useUiStore } from '@/stores/ui';
import { addDays, fmtDate, fmtDateTime, fmtNumber, localIso, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import EmptyState from '@/components/common/EmptyState.vue';

const ui = useUiStore();
const today = localIso(new Date());
const thisYear = Number(today.slice(0, 4));
const year = ref(thisYear + 1);
const data = ref<PlanningOverview | null>(null);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const deadline = ref(addDays(today, 30));

const deptOpen = ref<{ deptId: number | null; dept: string | null } | null>(null);
const people = ref<EmployeePlan[]>([]);
const peopleStatus = ref<'' | PlanStatus>('');
const peopleLoading = ref(false);

const docNumber = ref('');
const docDate = ref(today);
const unionDate = ref('');
const unionNumber = ref('');

const STATUS: Record<PlanStatus, { label: string; tone: string }> = {
  none: { label: 'Не запланировал', tone: 'danger' },
  partial: { label: 'Частично', tone: 'warning' },
  done: { label: 'Полностью', tone: 'success' },
};

const campaign = computed(() => data.value?.campaign ?? null);
const approval = computed(() => data.value?.approval ?? null);
const totals = computed(() => data.value?.totals ?? null);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** ТК РФ, ст. 123: не позднее чем за две недели до начала года. */
const legalDeadline = computed(() => `${year.value - 1}-12-17`);
const canApprove = computed(() => !approval.value && today < `${year.value}-01-01`);

// Строки собираются в скрипте: переносы в шаблоне давали пробел перед запятой
const approvedLine = computed(() => {
  const a = approval.value;
  if (!a) return '';
  return `График утверждён: документ № ${a.docNumber} от ${fmtDate(a.docDate)}, ${a.rows} ${plural(a.rows, ['строка', 'строки', 'строк'])}`
    + (a.approvedBy ? ` · ${a.approvedBy}, ${fmtDateTime(a.approvedAt)}` : '') + '.';
});
const unionText = computed(() => {
  const a = approval.value;
  if (!a?.unionOpinionDate && !a?.unionOpinionNumber) return 'не указано';
  return ['учтено', a.unionOpinionDate ? fmtDate(a.unionOpinionDate) : '', a.unionOpinionNumber ? `№ ${a.unionOpinionNumber}` : ''].filter(Boolean).join(', ');
});
const planText = (p: EmployeePlan) => `${fmtNumber(p.plannedDays)} из ${fmtNumber(p.norm)} дн.`
  + (p.pendingDays ? ` (на согласовании ${fmtNumber(p.pendingDays)})` : '');

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.get<PlanningOverview>(`/planning/${year.value}`);
    if (data.value.campaign?.open) deadline.value = data.value.campaign.deadline;
    if (deptOpen.value) await loadPeople();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function loadPeople(): Promise<void> {
  if (!deptOpen.value) return;
  peopleLoading.value = true;
  try {
    const q = new URLSearchParams({ deptId: String(deptOpen.value.deptId ?? 0) });
    if (peopleStatus.value) q.set('status', peopleStatus.value);
    people.value = (await api.get<{ items: EmployeePlan[] }>(`/planning/${year.value}/employees?${q}`)).items;
  } catch (e) {
    ui.error(e);
  } finally {
    peopleLoading.value = false;
  }
}

function showDept(d: { deptId: number | null; dept: string | null }): void {
  deptOpen.value = deptOpen.value?.deptId === d.deptId ? null : d;
  peopleStatus.value = '';
  void loadPeople();
}

async function act(path: string, body: object, done: string): Promise<void> {
  busy.value = true;
  try {
    data.value = await api.post<PlanningOverview>(`/planning/${year.value}/${path}`, body);
    ui.toast(done);
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}

async function open(): Promise<void> {
  const first = !campaign.value?.open;
  if (first) {
    const answer = await ui.ask({
      title: `Открыть планирование на ${year.value} год?`,
      text: `Все штатные сотрудники получат приглашение — уведомление и письмо — со сроком до ${fmtDate(deadline.value)}.`,
      confirmLabel: 'Открыть и пригласить',
    });
    if (!answer.ok) return;
  }
  await act('open', { deadline: deadline.value }, first ? 'Планирование открыто, сотрудники приглашены' : 'Срок изменён');
}

async function close(): Promise<void> {
  const answer = await ui.ask({
    title: 'Закрыть планирование?',
    text: 'Сотрудники перестанут видеть приглашение. Открыть снова можно до утверждения графика.',
    confirmLabel: 'Закрыть',
  });
  if (answer.ok) await act('close', {}, 'Планирование закрыто');
}

async function remind(): Promise<void> {
  busy.value = true;
  try {
    const r = await api.post<{ sent: number }>(`/planning/${year.value}/remind`, {});
    ui.toast(r.sent ? `Напоминание отправлено: ${r.sent} ${plural(r.sent, ['сотруднику', 'сотрудникам', 'сотрудникам'])}` : 'Все спланировали отпуск — напоминать некому');
    await reload();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}

async function approve(): Promise<void> {
  const w = data.value?.warnings;
  const notes = [
    w?.pendingRequests ? `${w.pendingRequests} ${plural(w.pendingRequests, ['заявка', 'заявки', 'заявок'])} на согласовании в график не ${w.pendingRequests === 1 ? 'войдёт' : 'войдут'}.` : '',
    w?.missingPersonnelNumbers ? `У ${w.missingPersonnelNumbers} ${plural(w.missingPersonnelNumbers, ['сотрудника', 'сотрудников', 'сотрудников'])} нет табельного номера.` : '',
  ].filter(Boolean).join(' ');
  const answer = await ui.ask({
    title: `Утвердить график отпусков на ${year.value} год?`,
    text: `Документ № ${docNumber.value.trim()} от ${fmtDate(docDate.value)}. Утвердить можно один раз: дальше изменения — переносами, они попадут в графы 8–9 формы Т-7. ${notes}`,
    confirmLabel: 'Утвердить график',
  });
  if (!answer.ok) return;
  await act('approve', {
    docNumber: docNumber.value.trim(), docDate: docDate.value,
    ...(unionDate.value ? { unionOpinionDate: unionDate.value } : {}),
    ...(unionNumber.value.trim() ? { unionOpinionNumber: unionNumber.value.trim() } : {}),
  }, 'График утверждён');
}

async function downloadT7(): Promise<void> {
  try {
    const blob = await api.download(`/reports/t7?year=${year.value}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grafik-otpuskov-T7-${year.value}${approval.value ? '' : '-proekt'}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    ui.toast(approval.value ? 'Форма Т-7 сформирована' : 'Проект формы Т-7 сформирован');
  } catch (e) {
    ui.error(e);
  }
}

watch(year, () => { deptOpen.value = null; void reload(); });
watch(peopleStatus, loadPeople);
onMounted(reload);
</script>

<template>
  <div>
    <div class="year-row">
      <div
        class="segmented"
        role="group"
        aria-label="Год графика"
      >
        <button
          v-for="y in [thisYear, thisYear + 1]"
          :key="y"
          type="button"
          :class="{ active: year === y }"
          :aria-pressed="year === y"
          @click="year = y"
        >
          {{ y }}
        </button>
      </div>
      <button
        class="btn"
        type="button"
        @click="downloadT7"
      >
        <AppIcon
          name="spreadsheet"
          :size="15"
        /> {{ approval ? 'Форма Т-7' : 'Проект Т-7' }}
      </button>
    </div>

    <div
      v-if="error"
      class="banner banner-error"
      role="alert"
    >
      <AppIcon
        name="warning"
        :size="15"
      /> {{ error }}
    </div>

    <div
      v-if="loading && !data"
      class="card card-body"
    >
      <div
        v-for="i in 4"
        :key="i"
        class="skeleton"
        style="height: 28px; margin-bottom: 10px"
      />
    </div>

    <template v-else-if="data">
      <!-- Кампания -->
      <section
        class="card"
        aria-labelledby="pl-campaign"
      >
        <div class="card-header">
          <span
            id="pl-campaign"
            class="section-title"
          >Планирование на {{ year }} год</span>
          <span
            v-if="approval"
            class="badge badge-success"
          >график утверждён</span>
          <span
            v-else-if="campaign?.open && campaign.deadline < today"
            class="badge badge-danger"
          >срок прошёл</span>
          <span
            v-else-if="campaign?.open"
            class="badge badge-info"
          >открыто</span>
          <span
            v-else-if="campaign"
            class="badge badge-muted"
          >закрыто</span>
        </div>
        <div class="card-body">
          <p
            v-if="approval"
            class="state"
          >
            {{ approvedLine }}
          </p>
          <template v-else>
            <p class="state">
              <template v-if="!campaign">
                Планирование не открыто. Сотрудники получат приглашение — уведомление и письмо — и увидят свой план в «Моём отпуске».
              </template>
              <template v-else-if="campaign.open">
                Открыто до <strong>{{ fmtDate(campaign.deadline) }}</strong><template v-if="campaign.openedBy">
                  · открыл(а) {{ campaign.openedBy }} {{ fmtDateTime(campaign.openedAt) }}
                </template><template v-if="campaign.remindedAt">
                  · последнее напоминание {{ fmtDateTime(campaign.remindedAt) }}
                </template>. За три дня до срока не спланировавшим уйдёт автоматическое напоминание.
              </template>
              <template v-else>
                Закрыто {{ fmtDateTime(campaign.closedAt!) }}. Открыть снова можно до утверждения графика.
              </template>
            </p>
            <div class="campaign-actions">
              <div class="field-inline">
                <label for="pl-deadline">Срок</label>
                <input
                  id="pl-deadline"
                  v-model="deadline"
                  class="input"
                  type="date"
                  :min="today"
                  :max="`${year}-12-31`"
                >
              </div>
              <button
                class="btn btn-primary"
                type="button"
                :disabled="busy || !deadline"
                @click="open"
              >
                {{ !campaign ? 'Открыть планирование' : campaign.open ? 'Изменить срок' : 'Открыть снова' }}
              </button>
              <template v-if="campaign?.open">
                <button
                  class="btn"
                  type="button"
                  :disabled="busy || totals?.done === totals?.employees"
                  @click="remind"
                >
                  <AppIcon
                    name="bell"
                    :size="15"
                  /> Напомнить не спланировавшим
                </button>
                <button
                  class="btn btn-ghost"
                  type="button"
                  :disabled="busy"
                  @click="close"
                >
                  Закрыть
                </button>
              </template>
            </div>
          </template>
        </div>
      </section>

      <!-- Показатели -->
      <div
        v-if="totals"
        class="kpis"
      >
        <div class="kpi card">
          <span class="kpi-label">Сотрудников</span>
          <span class="kpi-value">{{ totals.employees }}</span>
          <span class="kpi-note">штатных, действующих</span>
        </div>
        <div class="kpi card">
          <span class="kpi-label">Спланировали отпуск</span>
          <span class="kpi-value">{{ pct(totals.planned, totals.employees) }}%</span>
          <span class="kpi-note">{{ totals.planned }} из {{ totals.employees }}</span>
        </div>
        <div class="kpi card">
          <span class="kpi-label">Полностью</span>
          <span class="kpi-value">{{ pct(totals.done, totals.employees) }}%</span>
          <span class="kpi-note">норма и часть ≥ 14 дней: {{ totals.done }}</span>
        </div>
        <div class="kpi card">
          <span class="kpi-label">Дней запланировано</span>
          <span class="kpi-value">{{ pct(totals.plannedDays, totals.normDays) }}%</span>
          <span class="kpi-note">{{ fmtNumber(totals.plannedDays) }} из {{ fmtNumber(totals.normDays) }}</span>
        </div>
      </div>

      <!-- По отделам -->
      <section
        class="card"
        aria-labelledby="pl-depts"
      >
        <div class="card-header">
          <span
            id="pl-depts"
            class="section-title"
          >По отделам</span>
          <span class="soft small">Отпуска, начинающиеся в {{ year }} году: согласованные и на согласовании</span>
        </div>
        <EmptyState
          v-if="!data.departments.length"
          icon="team"
          title="Нет штатных сотрудников"
        />
        <div
          v-else
          class="table-scroll scroll-thin"
        >
          <table class="data-table depts">
            <caption class="sr-only">
              Прогресс планирования по отделам
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  Отдел
                </th>
                <th
                  scope="col"
                  class="num"
                >
                  Сотрудников
                </th>
                <th
                  scope="col"
                  class="num"
                >
                  Спланировали
                </th>
                <th
                  scope="col"
                  class="num hide-mobile"
                >
                  Полностью
                </th>
                <th
                  scope="col"
                  class="num hide-mobile"
                >
                  Часть ≥ 14 дней
                </th>
                <th scope="col">
                  Дней из нормы
                </th>
              </tr>
            </thead>
            <tbody>
              <template
                v-for="d in data.departments"
                :key="d.deptId ?? 0"
              >
                <tr :class="{ selected: deptOpen?.deptId === d.deptId }">
                  <td>
                    <button
                      class="link-btn"
                      type="button"
                      :aria-expanded="deptOpen?.deptId === d.deptId"
                      @click="showDept(d)"
                    >
                      <AppIcon
                        :name="deptOpen?.deptId === d.deptId ? 'chevronDown' : 'chevronRight'"
                        :size="14"
                      />
                      {{ d.dept ?? 'Без отдела' }}
                    </button>
                  </td>
                  <td class="num">
                    {{ d.employees }}
                  </td>
                  <td class="num">
                    {{ d.planned }}
                  </td>
                  <td class="num hide-mobile">
                    {{ d.done }}
                  </td>
                  <td class="num hide-mobile">
                    {{ d.withFourteen }}
                  </td>
                  <td>
                    <div
                      class="meter"
                      role="meter"
                      :aria-valuenow="pct(d.plannedDays, d.normDays)"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      :aria-label="`${d.dept ?? 'Без отдела'}: запланировано ${pct(d.plannedDays, d.normDays)}% дней`"
                    >
                      <span
                        class="meter-fill"
                        :style="{ width: `${Math.min(100, pct(d.plannedDays, d.normDays))}%` }"
                      />
                    </div>
                    <span class="meter-value">{{ pct(d.plannedDays, d.normDays) }}%</span>
                  </td>
                </tr>
                <tr
                  v-if="deptOpen?.deptId === d.deptId"
                  class="people-row"
                >
                  <td colspan="6">
                    <div class="people-filter">
                      <select
                        v-model="peopleStatus"
                        class="input"
                        aria-label="Состояние плана"
                      >
                        <option value="">
                          Все сотрудники
                        </option>
                        <option value="none">
                          Не запланировали
                        </option>
                        <option value="partial">
                          Частично
                        </option>
                        <option value="done">
                          Полностью
                        </option>
                      </select>
                    </div>
                    <p
                      v-if="peopleLoading && !people.length"
                      class="soft small"
                    >
                      Загрузка…
                    </p>
                    <p
                      v-else-if="!people.length"
                      class="soft small"
                    >
                      Таких сотрудников нет.
                    </p>
                    <ul
                      v-else
                      class="people"
                    >
                      <li
                        v-for="p in people"
                        :key="p.id"
                      >
                        <div class="person">
                          <span>{{ p.name }}</span>
                          <span class="soft small">{{ p.position ?? '—' }}</span>
                        </div>
                        <span class="small">{{ planText(p) }}</span>
                        <span
                          v-if="!p.hasFourteen && p.norm >= 14"
                          class="badge badge-warning"
                          title="ТК РФ, ст. 125: одна из частей отпуска — не короче 14 календарных дней"
                        >нет части ≥ 14 дней</span>
                        <span
                          class="badge"
                          :class="`badge-${STATUS[p.status].tone}`"
                        >{{ STATUS[p.status].label }}</span>
                      </li>
                    </ul>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Утверждение -->
      <section
        class="card"
        aria-labelledby="pl-approve"
      >
        <div class="card-header">
          <span
            id="pl-approve"
            class="section-title"
          >Утверждение графика</span>
        </div>
        <div class="card-body">
          <template v-if="approval">
            <dl class="facts">
              <div>
                <dt>Документ</dt><dd>№ {{ approval.docNumber }} от {{ fmtDate(approval.docDate) }}</dd>
              </div>
              <div>
                <dt>Мнение профсоюза</dt>
                <dd>{{ unionText }}</dd>
              </div>
              <div>
                <dt>Утверждён</dt><dd>{{ fmtDateTime(approval.approvedAt) }}{{ approval.approvedBy ? `, ${approval.approvedBy}` : '' }}</dd>
              </div>
            </dl>
            <p class="soft small">
              Переносы после утверждения попадают в графы 8–9 формы Т-7, отмены — в примечание.
            </p>
          </template>
          <p
            v-else-if="!canApprove"
            class="soft"
          >
            {{ year }} год уже начался — график на него не утверждался в системе. Проект формы Т-7 доступен для выгрузки.
          </p>
          <form
            v-else
            class="approve-form"
            @submit.prevent="approve"
          >
            <p class="soft small">
              По ст. 123 ТК РФ график утверждается не позднее чем за две недели до начала года — до {{ fmtDate(legalDeadline) }}.
              В график войдут согласованные отпуска, начинающиеся в {{ year }} году, — сейчас их {{ data.approvedParts }}; утвердить можно один раз.
            </p>
            <ul
              v-if="data.warnings.pendingRequests || data.warnings.missingPersonnelNumbers || data.warnings.missingRequisites.length"
              class="warnings"
            >
              <li v-if="data.warnings.pendingRequests">
                <AppIcon
                  name="warning"
                  :size="14"
                /> На согласовании {{ data.warnings.pendingRequests }} {{ plural(data.warnings.pendingRequests, ['заявка', 'заявки', 'заявок']) }} — в график не войдут, пока руководители не решат.
              </li>
              <li v-if="data.warnings.missingPersonnelNumbers">
                <AppIcon
                  name="warning"
                  :size="14"
                /> Без табельного номера: {{ data.warnings.missingPersonnelNumbers }} {{ plural(data.warnings.missingPersonnelNumbers, ['сотрудник', 'сотрудника', 'сотрудников']) }} — графа 4 останется пустой.
              </li>
              <li v-if="data.warnings.missingRequisites.length">
                <AppIcon
                  name="warning"
                  :size="14"
                /> Не заполнены реквизиты: {{ data.warnings.missingRequisites.join(', ') }} (правила организации, администратор).
              </li>
            </ul>
            <div class="approve-grid">
              <div class="field">
                <label for="pl-num">Номер документа</label>
                <input
                  id="pl-num"
                  v-model="docNumber"
                  class="input"
                  required
                  maxlength="30"
                >
              </div>
              <div class="field">
                <label for="pl-date">Дата составления</label>
                <input
                  id="pl-date"
                  v-model="docDate"
                  class="input"
                  type="date"
                  :max="today"
                  required
                >
              </div>
              <div class="field">
                <label for="pl-union-date">Мнение профсоюза: дата <span class="soft">(если есть)</span></label>
                <input
                  id="pl-union-date"
                  v-model="unionDate"
                  class="input"
                  type="date"
                >
              </div>
              <div class="field">
                <label for="pl-union-num">Мнение профсоюза: номер</label>
                <input
                  id="pl-union-num"
                  v-model="unionNumber"
                  class="input"
                  maxlength="30"
                >
              </div>
            </div>
            <button
              class="btn btn-primary"
              type="submit"
              :disabled="busy || !docNumber.trim() || !docDate || !data.approvedParts"
            >
              <AppIcon
                name="check"
                :size="15"
              /> Утвердить график на {{ year }} год
            </button>
          </form>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.year-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.state {
  margin: 0 0 12px;
}

.campaign-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.field-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-inline label {
  color: var(--color-text-muted);
  font-size: 13px;
}

.field-inline .input {
  width: auto;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
  margin: 0;
}

.kpi-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.kpi-value {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.kpi-note {
  font-size: 12px;
  color: var(--color-text-muted);
}

.table-scroll {
  overflow-x: auto;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  padding: 4px 0;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.link-btn:hover {
  color: var(--color-primary);
}

tr.selected td {
  background: var(--color-primary-soft);
}

.meter {
  display: inline-block;
  vertical-align: middle;
  width: 120px;
  height: 8px;
  border-radius: 4px;
  background: var(--color-neutral-soft);
  overflow: hidden;
}

.meter-fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--color-primary);
}

.meter-value {
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--color-text-muted);
}

.people-row td {
  background: var(--color-surface-2);
  text-align: left;
}

.people-filter {
  margin-bottom: 8px;
}

.people-filter .input {
  width: auto;
}

.people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.people li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.people li:last-child {
  border-bottom: none;
}

.person {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

.facts {
  display: grid;
  gap: 6px;
  margin: 0 0 8px;
}

.facts div {
  display: flex;
  gap: 8px;
}

.facts dt {
  min-width: 160px;
  color: var(--color-text-muted);
}

.facts dd {
  margin: 0;
}

.warnings {
  list-style: none;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-soft);
  color: var(--color-warning-dark);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.approve-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

@media (max-width: 760px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .approve-grid {
    grid-template-columns: 1fr;
  }

  .people li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .meter {
    width: 64px;
  }

  .facts div {
    flex-direction: column;
    gap: 0;
  }
}
</style>
