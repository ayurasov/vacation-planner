<script setup lang="ts">
// Сотрудники в форматах «По Делу» (v1.1.0, ADR-018). transfer — выгрузка и загрузка с решением
// коллизий: по умолчанию остаётся значение планировщика; sync — быстрый импорт CSV, файл главнее.
// План строится без записи в БД, применение — одной транзакцией; новым — одноразовые пароли.
import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useUiStore } from '@/stores/ui';
import { localIso } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import FileDrop from './FileDrop.vue';
import { saveDownload } from './download';

type Choice = 'current' | 'incoming' | 'merge' | 'custom';
type Action = 'create' | 'update' | 'unchanged' | 'skip' | 'error';
interface Conflict {
  field: string; label: string; current: unknown; incoming: unknown; merged: unknown;
  choices: Choice[]; choice: Choice; value: unknown; note: string | null;
}
interface PlanRecord {
  key: string; line: number; action: Action; employeeId: number | null; name: string; email: string;
  changes: Array<{ field: string; label: string; old: unknown; new: unknown }>;
  conflicts: Conflict[]; errors: string[]; warnings: string[];
}
interface Plan {
  applied?: boolean;
  summary: { records: number; create: number; update: number; unchanged: number; skip: number; conflicts: number; errors: number; createDepartments: number };
  departments: Array<{ key: string; path: string }>;
  records: PlanRecord[];
  canApply: boolean;
  credentials?: Array<{ login: string; name: string; password: string }>;
}

const props = defineProps<{ mode: 'transfer' | 'sync' }>();
const emit = defineEmits<{ applied: [] }>();
const ui = useUiStore();
const file = ref<File | null>(null);
const plan = ref<Plan | null>(null);
const busy = ref(false);
const error = ref('');
const withInactive = ref(true);
const newUsers = ref<'active' | 'inactive' | 'file'>('active');
const createMissing = ref(false);
const showAll = ref(false);
/** Решения по коллизиям: ключ записи → поле → выбор и своё значение. */
const decisions = reactive<Record<string, Record<string, { choice: Choice; value: string }>>>({});

const ACTIONS: Record<Action, { label: string; badge: string }> = {
  create: { label: 'новый', badge: 'badge-success' },
  update: { label: 'изменится', badge: 'badge-info' },
  unchanged: { label: 'без изменений', badge: 'badge-muted' },
  skip: { label: 'пропущен', badge: 'badge-muted' },
  error: { label: 'ошибка', badge: 'badge-danger' },
};
const CHOICES: Record<Choice, string> = { current: 'как в планировщике', incoming: 'из файла', merge: 'объединить', custom: 'своё' };

const show = (v: unknown) => (Array.isArray(v) ? v.join('; ') : v === '' || v === null || v === undefined ? '—' : String(v));
const visible = computed(() => (plan.value?.records ?? [])
  .filter((r) => showAll.value || r.action !== 'unchanged' || r.warnings.length)
  .sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || a.line - b.line));

async function exportFile(format: 'csv' | 'json'): Promise<void> {
  try {
    await saveDownload(`/org/employees/export?format=${format}&inactive=${withInactive.value}`, `employees-${localIso(new Date())}.${format}`);
    ui.toast('Сотрудники выгружены');
  } catch (e) {
    ui.error(e);
  }
}

function fields(apply: boolean): Record<string, string> {
  const out: Record<string, string> = { apply: String(apply) };
  if (props.mode === 'sync') out.createMissing = String(createMissing.value);
  else {
    out.newUsers = newUsers.value;
    out.decisions = JSON.stringify(Object.fromEntries(Object.entries(decisions).map(([key, f]) => [key, { fields: f }])));
  }
  return out;
}

async function send(apply: boolean): Promise<void> {
  if (!file.value) return;
  busy.value = true;
  error.value = '';
  try {
    const res = await api.upload<Plan>(props.mode === 'sync' ? '/org/import/csv' : '/org/employees/import', file.value, fields(apply));
    plan.value = res;
    // Решения, присланные сервером обратно (в том числе по умолчанию), — в форму
    for (const r of res.records) {
      for (const c of r.conflicts) {
        decisions[r.key] ??= {};
        decisions[r.key][c.field] ??= { choice: c.choice, value: c.choice === 'custom' ? show(c.value) : '' };
      }
    }
    if (res.applied) {
      ui.toast(`Загружено: новых ${res.summary.create}, изменено ${res.summary.update}`);
      emit('applied');
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function pick(f: File): void {
  file.value = f;
  plan.value = null;
  for (const k of Object.keys(decisions)) delete decisions[k];
  void send(false);
}

function choose(key: string, field: string, choice: Choice): void {
  decisions[key] ??= {};
  decisions[key][field] = { choice, value: decisions[key][field]?.value ?? '' };
}

async function copyCredentials(): Promise<void> {
  const lines = (plan.value?.credentials ?? []).map((c) => `${c.name}\t${c.login}\t${c.password}`);
  try {
    await navigator.clipboard.writeText(['ФИО\tЛогин\tПароль', ...lines].join('\n'));
    ui.toast('Скопировано в буфер обмена');
  } catch {
    ui.toast('Не удалось скопировать — выделите текст вручную', 'error');
  }
}

function restart(): void {
  file.value = null;
  plan.value = null;
}
</script>

<template>
  <div
    class="exchange-grid"
    :class="{ single: mode === 'sync' }"
  >
    <section
      v-if="mode === 'transfer'"
      class="card"
    >
      <div class="card-header">
        <span class="section-title">Выгрузка</span>
      </div>
      <div class="card-body">
        <p class="soft small">
          Те же столбцы, что у «По Делу», и поля отпусков: табельный номер, норма дней, перенос, тип занятости. Пароли не выгружаются.
        </p>
        <div class="actions">
          <button
            class="btn"
            type="button"
            @click="exportFile('csv')"
          >
            <AppIcon
              name="spreadsheet"
              :size="15"
            /> CSV для Excel
          </button>
          <button
            class="btn"
            type="button"
            @click="exportFile('json')"
          >
            <AppIcon
              name="download"
              :size="15"
            /> JSON
          </button>
        </div>
        <label class="checkbox option">
          <input
            v-model="withInactive"
            type="checkbox"
          > С уволенными
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <span class="section-title">{{ mode === 'sync' ? 'Быстрый импорт CSV' : 'Загрузка' }}</span>
      </div>
      <div class="card-body">
        <FileDrop
          :accept="mode === 'sync' ? '.csv,.txt,text/csv' : '.csv,.json,.txt,text/csv,application/json'"
          :hint="mode === 'sync' ? 'CSV до 5 МБ' : 'CSV или JSON «По Делу» до 5 МБ'"
          :file="file"
          :busy="busy"
          @pick="pick"
        />
        <div
          v-if="mode === 'transfer'"
          class="field option"
        >
          <label for="x-new">Новые сотрудники</label>
          <select
            id="x-new"
            v-model="newUsers"
            class="input"
            @change="file && send(false)"
          >
            <option value="active">
              активны — получат одноразовые пароли
            </option>
            <option value="inactive">
              неактивны — доступ выдать позже
            </option>
            <option value="file">
              как в столбце «Активен»
            </option>
          </select>
        </div>
        <label
          v-else
          class="checkbox option"
        >
          <input
            v-model="createMissing"
            type="checkbox"
            @change="file && send(false)"
          > Создавать новых сотрудников
        </label>
        <p
          v-if="mode === 'transfer'"
          class="soft small"
        >
          Сотрудник находится по email, затем по логину и табельному номеру. Если значения различаются, по умолчанию остаётся значение планировщика —
          выберите, какое оставить. Пустое в файле ничего не стирает; недостающие подразделения создаются по пути.
        </p>
        <p
          v-else
          class="soft small"
        >
          Столбцы: email или логин, ФИО, Подразделение («Компания / Служба / Отдел»), Должность, Руководитель (email или логин),
          Руководит («да» — своим подразделением). Файл главнее: значения из него заменяют значения планировщика.
        </p>
      </div>
    </section>
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

  <section
    v-if="plan"
    class="card plan"
  >
    <div class="card-header">
      <span class="section-title">{{ plan.applied ? 'Загружено' : 'Что изменится' }}</span>
      <div class="chips">
        <span class="badge badge-success">новых {{ plan.summary.create }}</span>
        <span class="badge badge-info">изменится {{ plan.summary.update }}</span>
        <span class="badge badge-muted">без изменений {{ plan.summary.unchanged }}</span>
        <span
          v-if="plan.summary.conflicts"
          class="badge badge-warning"
        >коллизий {{ plan.summary.conflicts }}</span>
        <span
          v-if="plan.summary.createDepartments"
          class="badge badge-violet"
        >новых подразделений {{ plan.summary.createDepartments }}</span>
        <span
          v-if="plan.summary.errors"
          class="badge badge-danger"
        >с ошибками {{ plan.summary.errors }}</span>
      </div>
    </div>

    <!-- Пароли созданных — один раз -->
    <div
      v-if="plan.applied && plan.credentials?.length"
      class="card-body"
    >
      <div class="banner banner-warning">
        <AppIcon
          name="key"
          :size="16"
        />
        <span>Одноразовые пароли новых сотрудников показываются только сейчас. Передайте их лично; при первом входе сотрудник сменит пароль.</span>
      </div>
      <div class="table-wrap scroll-thin">
        <table class="data-table">
          <thead><tr><th>ФИО</th><th>Логин</th><th>Пароль</th></tr></thead>
          <tbody>
            <tr
              v-for="c in plan.credentials"
              :key="c.login"
            >
              <td>{{ c.name }}</td>
              <td class="mono">
                {{ c.login }}
              </td>
              <td class="mono">
                {{ c.password }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        class="btn btn-sm"
        type="button"
        @click="copyCredentials"
      >
        Скопировать
      </button>
    </div>

    <div class="card-body plan-body">
      <div
        v-if="plan.departments.length"
        class="soft small"
      >
        Будут созданы подразделения: {{ plan.departments.map((d) => d.path).join('; ') }}
      </div>
      <label class="checkbox">
        <input
          v-model="showAll"
          type="checkbox"
        > Показать и без изменений
      </label>
      <div
        v-if="!visible.length"
        class="soft"
      >
        Изменений нет — файл совпадает с планировщиком.
      </div>
      <article
        v-for="r in visible"
        :key="r.key"
        class="record"
        :class="{ invalid: r.errors.length }"
      >
        <header class="record-head">
          <span
            v-if="r.action === 'unchanged' && r.conflicts.length && !plan.applied"
            class="badge badge-warning"
          >коллизии</span>
          <span
            v-else
            class="badge"
            :class="ACTIONS[r.action].badge"
          >{{ ACTIONS[r.action].label }}</span>
          <strong>{{ r.name || '—' }}</strong>
          <span class="soft small">{{ r.email || r.key }} · строка {{ r.line }}</span>
        </header>
        <ul
          v-if="r.errors.length"
          class="notes error-text"
        >
          <li
            v-for="e in r.errors"
            :key="e"
          >
            {{ e }}
          </li>
        </ul>
        <ul
          v-if="r.changes.length && r.action !== 'create'"
          class="notes"
        >
          <li
            v-for="c in r.changes"
            :key="c.field"
          >
            {{ c.label }}: <span class="soft">{{ show(c.old) }}</span> → {{ show(c.new) }}
          </li>
        </ul>
        <div
          v-for="c in (plan.applied ? [] : r.conflicts)"
          :key="c.field"
          class="conflict"
        >
          <div class="conflict-head">
            <strong>{{ c.label }}</strong>
            <span
              v-if="c.note"
              class="soft small"
            > · {{ c.note }}</span>
          </div>
          <div
            class="choices"
            role="radiogroup"
            :aria-label="`${r.name}: ${c.label}`"
          >
            <label
              v-for="ch in c.choices"
              :key="ch"
              class="choice"
              :class="{ active: decisions[r.key]?.[c.field]?.choice === ch }"
            >
              <input
                type="radio"
                :name="`${r.key}|${c.field}`"
                :checked="decisions[r.key]?.[c.field]?.choice === ch"
                @change="choose(r.key, c.field, ch)"
              >
              <span class="choice-label">{{ CHOICES[ch] }}</span>
              <span
                v-if="ch !== 'custom'"
                class="choice-value"
              >{{ show(ch === 'current' ? c.current : ch === 'incoming' ? c.incoming : c.merged) }}</span>
              <input
                v-else-if="decisions[r.key]?.[c.field]?.choice === 'custom'"
                v-model="decisions[r.key][c.field].value"
                class="input input-sm"
                :aria-label="`${c.label}: своё значение`"
              >
            </label>
          </div>
        </div>
        <ul
          v-if="r.warnings.length"
          class="notes soft small"
        >
          <li
            v-for="w in r.warnings"
            :key="w"
          >
            {{ w }}
          </li>
        </ul>
      </article>
    </div>
    <div class="card-footer">
      <template v-if="plan.applied">
        <button
          class="btn"
          type="button"
          @click="restart"
        >
          Загрузить другой файл
        </button>
      </template>
      <template v-else>
        <span
          v-if="!plan.canApply"
          class="soft small"
        >Исправьте ошибки в файле и загрузите его снова — файл применяется целиком.</span>
        <button
          v-if="mode === 'transfer' && plan.summary.conflicts"
          class="btn"
          type="button"
          :disabled="busy"
          @click="send(false)"
        >
          Проверить решения
        </button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="busy || !plan.canApply || !(plan.summary.create + plan.summary.update + plan.summary.conflicts)"
          @click="send(true)"
        >
          <AppIcon
            name="check"
            :size="15"
          /> Загрузить
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.exchange-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 14px;
  margin-bottom: 14px;
}

.exchange-grid.single {
  grid-template-columns: minmax(0, 1fr);
}

@media (max-width: 860px) {
  .exchange-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option {
  margin: 12px 0 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* На узком экране сводка уходит под заголовок, а не сжимает его */
.plan > .card-header {
  flex-wrap: wrap;
  row-gap: 8px;
}

.plan-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.record.invalid {
  border-color: var(--color-danger);
}

.record-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.notes {
  margin: 0;
  padding-left: 18px;
}

.error-text {
  color: var(--color-danger);
}

.conflict {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.choice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  cursor: pointer;
  font-size: 13px;
}

.choice.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.choice input[type='radio'] {
  margin: 0;
}

.choice-label {
  color: var(--color-text-muted);
}

.choice-value {
  overflow-wrap: anywhere;
}

.input-sm {
  height: 26px;
  padding: 2px 8px;
  min-width: 160px;
}

.card-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
}
</style>
