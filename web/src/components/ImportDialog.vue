<script setup lang="ts">
// Импорт сотрудников и остатков из XLSX/CSV: предпросмотр с ошибками по строкам → применение
// одной транзакцией. Повторная загрузка того же файла ничего не меняет (сервер сверяет план).
import { computed, ref } from 'vue';
import { api, type ImportAction, type ImportResult } from '@/api/client';
import { useUiStore } from '@/stores/ui';
import { fmtNumber, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';

const emit = defineEmits<{ close: []; done: [] }>();
const ui = useUiStore();

const file = ref<File | null>(null);
const preview = ref<ImportResult | null>(null);
const result = ref<ImportResult | null>(null);
const busy = ref(false);
const error = ref('');
const showUnchanged = ref(false);
const dragging = ref(false);

const ACTIONS: Record<ImportAction, { label: string; badge: string }> = {
  create: { label: 'новый', badge: 'badge-success' },
  update: { label: 'изменение', badge: 'badge-info' },
  unchanged: { label: 'без изменений', badge: 'badge-muted' },
  error: { label: 'ошибка', badge: 'badge-danger' },
};

const FIELDS: Record<string, string> = {
  name: 'ФИО', position: 'Должность', dept: 'Отдел', manager: 'Руководитель', plannedDays: 'Норма',
  carryOver: 'Перенос', empType: 'Тип', email: 'Email',
};

const visibleRows = computed(() => (preview.value?.rows ?? [])
  .filter((r) => showUnchanged.value || r.action !== 'unchanged')
  .sort((a, b) => Number(b.action === 'error') - Number(a.action === 'error') || a.line - b.line));
const toApply = computed(() => (preview.value ? preview.value.summary.create + preview.value.summary.update : 0));

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v === 'staff') return 'штат';
  if (v === 'ipsz') return 'ИП/самозанятый';
  return typeof v === 'number' ? fmtNumber(v) : String(v);
}

/** Новый сотрудник одной строкой: «Аналитик · Отдел аналитики · руководитель Балашова А. В. · норма 28». */
function createdSummary(changes: Record<string, { after: unknown }>): string {
  const order = ['position', 'dept', 'manager', 'plannedDays', 'carryOver', 'empType', 'email'];
  return order.filter((k) => k in changes && changes[k].after !== undefined).map((k) => {
    const v = show(changes[k].after);
    if (k === 'position' || k === 'dept' || k === 'email') return v;
    return `${FIELDS[k].toLowerCase()} ${v}`;
  }).join(' · ') || '—';
}

async function choose(f: File | undefined): Promise<void> {
  if (!f) return;
  file.value = f;
  preview.value = null;
  error.value = '';
  busy.value = true;
  try {
    preview.value = await api.upload<ImportResult>('/imports/employees?dryRun=true', f);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function onPick(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  void choose(input.files?.[0]);
  input.value = '';
}

function onDrop(ev: DragEvent): void {
  dragging.value = false;
  void choose(ev.dataTransfer?.files?.[0]);
}

async function apply(): Promise<void> {
  if (!file.value) return;
  busy.value = true;
  error.value = '';
  try {
    result.value = await api.upload<ImportResult>('/imports/employees?dryRun=false', file.value);
    const s = result.value.summary;
    ui.toast(`Импорт применён: новых ${s.create}, изменено ${s.update}`);
    emit('done');
    if (!result.value.credentials.length) emit('close');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function template(): Promise<void> {
  try {
    const blob = await api.download('/imports/employees/template');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shablon-importa-sotrudnikov.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    ui.error(e);
  }
}

async function copyCredentials(): Promise<void> {
  const lines = (result.value?.credentials ?? []).map((c) => `${c.name}\t${c.login}\t${c.password}`);
  try {
    await navigator.clipboard.writeText(['ФИО\tЛогин\tПароль', ...lines].join('\n'));
    ui.toast('Скопировано в буфер обмена');
  } catch {
    ui.toast('Не удалось скопировать — выделите текст вручную', 'error');
  }
}
</script>

<template>
  <div
    class="modal-overlay"
    @click.self="emit('close')"
  >
    <div
      class="modal modal-import"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
    >
      <div class="modal-head">
        <div>
          <div
            id="import-title"
            class="modal-title"
          >
            Импорт сотрудников и остатков
          </div>
          <div class="modal-sub">
            XLSX или CSV из кадровой системы: новые сотрудники, отделы, руководители, нормы и перенос дней
          </div>
        </div>
        <button
          class="btn btn-icon btn-sm btn-ghost"
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
        <!-- Результат: пароли созданных — один раз -->
        <template v-if="result">
          <div class="banner banner-success">
            <AppIcon
              name="check"
              :size="16"
            />
            <span>Импорт применён: новых {{ result.summary.create }}, изменено {{ result.summary.update }}<template v-if="result.newDepartments.length">, создано отделов {{ result.newDepartments.length }}</template>.</span>
          </div>
          <div class="banner banner-warning">
            <AppIcon
              name="key"
              :size="16"
            />
            <span>Одноразовые пароли новых сотрудников показываются только сейчас. Передайте их лично; при первом входе сотрудник сменит пароль.</span>
          </div>
          <div class="table-wrap scroll-thin">
            <table class="data-table">
              <thead>
                <tr><th>ФИО</th><th>Логин</th><th>Пароль</th></tr>
              </thead>
              <tbody>
                <tr
                  v-for="c in result.credentials"
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
        </template>

        <template v-else>
          <label
            class="dropzone"
            :class="{ dragging, busy }"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
          >
            <input
              type="file"
              accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              class="sr-only"
              @change="onPick"
            >
            <AppIcon
              name="upload"
              :size="22"
            />
            <span v-if="file"><strong>{{ file.name }}</strong> · выбрать другой файл</span>
            <span v-else><strong>Выберите файл</strong> или перетащите его сюда · XLSX, CSV до 2 МБ</span>
          </label>
          <div class="hint-row soft small">
            Колонки: ФИО, Логин, Должность, Отдел, Руководитель, Норма дней, Перенос, Тип занятости, Email. Пустая ячейка значение не меняет.
            <button
              class="btn-link"
              type="button"
              @click="template"
            >
              Скачать шаблон
            </button>
          </div>

          <div
            v-if="error"
            class="banner banner-error"
            role="alert"
          >
            <AppIcon
              name="warning"
              :size="16"
            />
            <span>{{ error }}</span>
          </div>

          <template v-if="preview">
            <div class="summary">
              <span class="chip"><strong>{{ preview.summary.create }}</strong> {{ plural(preview.summary.create, ['новый', 'новых', 'новых']) }}</span>
              <span class="chip"><strong>{{ preview.summary.update }}</strong> {{ plural(preview.summary.update, ['изменение', 'изменения', 'изменений']) }}</span>
              <span class="chip"><strong>{{ preview.summary.unchanged }}</strong> без изменений</span>
              <span
                class="chip"
                :class="{ 'chip-danger': preview.summary.error }"
              ><strong>{{ preview.summary.error }}</strong> {{ plural(preview.summary.error, ['ошибка', 'ошибки', 'ошибок']) }}</span>
              <span
                v-if="preview.newDepartments.length"
                class="chip"
              >новые отделы: {{ preview.newDepartments.join(', ') }}</span>
            </div>
            <label
              v-if="preview.summary.unchanged"
              class="checkbox small"
            >
              <input
                v-model="showUnchanged"
                type="checkbox"
              > Показать строки без изменений
            </label>
            <div class="table-wrap scroll-thin">
              <table class="data-table">
                <thead>
                  <tr>
                    <th class="num">
                      Стр.
                    </th>
                    <th>Сотрудник</th>
                    <th>Действие</th>
                    <th>Что изменится</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="r in visibleRows"
                    :key="r.line"
                    :class="{ 'row-error': r.action === 'error' }"
                  >
                    <td class="num soft">
                      {{ r.line }}
                    </td>
                    <td>
                      <div>{{ r.name || '—' }}</div>
                      <div class="mono soft small">
                        {{ r.login }}
                      </div>
                    </td>
                    <td>
                      <span
                        class="badge"
                        :class="ACTIONS[r.action].badge"
                      >{{ ACTIONS[r.action].label }}</span>
                    </td>
                    <td class="small">
                      <div
                        v-for="msg in r.errors"
                        :key="msg"
                        class="err"
                      >
                        {{ msg }}
                      </div>
                      <div
                        v-if="r.action === 'create'"
                        class="created"
                      >
                        {{ createdSummary(r.changes) }}
                      </div>
                      <template v-else>
                        <div
                          v-for="(c, k) in r.changes"
                          :key="k"
                        >
                          <span class="soft">{{ FIELDS[k] ?? k }}: </span><s class="soft">{{ show(c.before) }}</s> → {{ show(c.after) }}
                        </div>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="!visibleRows.length">
                    <td
                      colspan="4"
                      class="soft"
                    >
                      Все строки совпадают с текущими данными — применять нечего.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
      </div>

      <div class="modal-actions">
        <template v-if="result">
          <button
            class="btn"
            type="button"
            @click="copyCredentials"
          >
            <AppIcon
              name="key"
              :size="14"
            /> Скопировать пароли
          </button>
          <button
            class="btn btn-primary"
            type="button"
            @click="emit('close')"
          >
            Готово
          </button>
        </template>
        <template v-else>
          <button
            class="btn btn-ghost"
            type="button"
            @click="emit('close')"
          >
            Отмена
          </button>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="busy || !preview || !!preview.summary.error || !toApply"
            :title="preview?.summary.error ? 'Исправьте ошибки в файле и загрузите его снова' : ''"
            @click="apply"
          >
            <AppIcon
              name="check"
              :size="14"
            /> Применить<template v-if="toApply">
              ({{ toApply }})
            </template>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-import {
  max-width: 860px;
}

.dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 22px;
  border: 1.5px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.dropzone:focus-within {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.dropzone.busy {
  opacity: 0.6;
  pointer-events: none;
}

.hint-row {
  margin: 8px 0 14px;
}

.btn-link {
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  cursor: pointer;
  padding: 0;
  margin-left: 6px;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 12.5px;
}

.chip-danger {
  background: var(--color-danger-soft);
  color: var(--color-danger-dark);
  border-color: transparent;
}

.table-wrap {
  max-height: 46vh;
  overflow: auto;
  margin-top: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.row-error td {
  background: var(--color-danger-soft);
}

.err {
  color: var(--color-danger-dark);
}
</style>
