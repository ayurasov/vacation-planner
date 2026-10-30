<script setup lang="ts">
// Перенос структуры компании — файл «По Делу» podelu.org-structure (v1.1.0, ADR-018): выгрузка,
// план загрузки без записи и применение одной транзакцией. Ничего не удаляется и не переименовывается.
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { localIso, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';
import FileDrop from './FileDrop.vue';
import { saveDownload } from './download';

interface StructurePlan {
  applied?: boolean;
  summary: {
    departments: number; create: number; update: number; unchanged: number; settings: number;
    addHeads: number; pendingHeads: number; skippedHeads: number; missingInFile: number; errors: number;
  };
  settings: Array<{ key: string; label: string; current: string; incoming: string }>;
  departments: Array<{ key: string; path: string; action: 'create' | 'update' | 'unchanged'; changes: Array<{ field: string; old: unknown; new: unknown }> }>;
  heads: Array<{ path: string; email: string; name: string; action: 'add' | 'exists' | 'pending' | 'skip'; note: string | null }>;
  missingInFile: string[];
  notes: string[];
  errors: string[];
  canApply: boolean;
}

const auth = useAuthStore();
const ui = useUiStore();
const file = ref<File | null>(null);
const plan = ref<StructurePlan | null>(null);
const applySettings = ref(auth.isAdmin);
const busy = ref(false);
const error = ref('');
const showMissing = ref(false);

const FIELD: Record<string, string> = { kind: 'вид', sortOrder: 'порядок' };
const HEAD_ACTION: Record<string, { label: string; badge: string }> = {
  add: { label: 'назначается', badge: 'badge-success' },
  exists: { label: 'уже руководит', badge: 'badge-muted' },
  pending: { label: 'нет в планировщике', badge: 'badge-warning' },
  skip: { label: 'не переносится', badge: 'badge-muted' },
};
const changed = computed(() => plan.value?.departments.filter((d) => d.action !== 'unchanged') ?? []);
const heads = computed(() => plan.value?.heads.filter((h) => h.action !== 'exists') ?? []);

async function exportFile(): Promise<void> {
  try {
    await saveDownload('/org/export', `org-structure-${localIso(new Date())}.json`);
    ui.toast('Структура выгружена');
  } catch (e) {
    ui.error(e);
  }
}

async function send(f: File, apply: boolean): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const res = await api.upload<StructurePlan>('/org/import/structure', f, { apply: String(apply), applySettings: String(applySettings.value) });
    plan.value = res;
    if (res.applied) {
      ui.toast(`Структура загружена: новых подразделений ${res.summary.create}, изменено ${res.summary.update}`);
      file.value = null;
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
  void send(f, false);
}
</script>

<template>
  <div class="exchange-grid">
    <section class="card">
      <div class="card-header">
        <span class="section-title">Выгрузка</span>
      </div>
      <div class="card-body">
        <p class="soft small">
          Подразделения с видом уровня, порядком, внешним ID и руководителями (по email), а также виды уровней и глубина структуры.
          Файл загружается в «По Делу» или в другой планировщик.
        </p>
        <button
          class="btn"
          type="button"
          @click="exportFile"
        >
          <AppIcon
            name="download"
            :size="15"
          /> Скачать структуру (JSON)
        </button>
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <span class="section-title">Загрузка</span>
      </div>
      <div class="card-body">
        <FileDrop
          accept=".json,application/json"
          hint="файл структуры «По Делу» (JSON)"
          :file="file"
          :busy="busy"
          @pick="pick"
        />
        <label
          class="checkbox option"
          :title="auth.isAdmin ? '' : 'Настройки организации меняет администратор'"
        >
          <input
            v-model="applySettings"
            type="checkbox"
            :disabled="!auth.isAdmin"
            @change="file && send(file, false)"
          > Применить виды уровней и глубину из файла
        </label>
        <p class="soft small">
          Подразделения сопоставляются по пути от верхнего уровня без учёта регистра. Новые создаются, у найденных меняются вид и порядок;
          отсутствующие в файле остаются как есть — ничего не удаляется, не переименовывается и не переносится.
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
          v-if="plan.summary.errors"
          class="badge badge-danger"
        >{{ plural(plan.summary.errors, ['ошибка', 'ошибки', 'ошибок']) }}: {{ plan.summary.errors }}</span>
      </div>
    </div>
    <div class="card-body plan-body">
      <div
        v-for="e in plan.errors"
        :key="e"
        class="banner banner-error"
      >
        <AppIcon
          name="warning"
          :size="15"
        /> {{ e }}
      </div>
      <div
        v-for="n in plan.notes"
        :key="n"
        class="soft small"
      >
        {{ n }}
      </div>

      <template v-if="plan.settings.length">
        <h3 class="plan-title">
          Настройки
        </h3>
        <table class="data-table">
          <thead><tr><th>Настройка</th><th>Сейчас</th><th>Из файла</th></tr></thead>
          <tbody>
            <tr
              v-for="s in plan.settings"
              :key="s.key"
            >
              <td>{{ s.label }}</td><td class="soft">
                {{ s.current }}
              </td><td>{{ s.incoming }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-if="changed.length">
        <h3 class="plan-title">
          Подразделения
        </h3>
        <ul class="plan-list">
          <li
            v-for="d in changed"
            :key="d.key"
          >
            <span
              class="badge"
              :class="d.action === 'create' ? 'badge-success' : 'badge-info'"
            >{{ d.action === 'create' ? 'новое' : 'изменится' }}</span>
            {{ d.path }}
            <span
              v-for="c in d.changes"
              :key="c.field"
              class="soft small"
            > · {{ FIELD[c.field] ?? c.field }}: {{ c.old }} → {{ c.new }}</span>
          </li>
        </ul>
      </template>

      <template v-if="heads.length">
        <h3 class="plan-title">
          Руководители
        </h3>
        <ul class="plan-list">
          <li
            v-for="h in heads"
            :key="`${h.path}|${h.email}`"
          >
            <span
              class="badge"
              :class="HEAD_ACTION[h.action].badge"
            >{{ HEAD_ACTION[h.action].label }}</span>
            {{ h.path }} — {{ h.name || h.email }}
            <span
              v-if="h.note"
              class="soft small"
            > · {{ h.note }}</span>
          </li>
        </ul>
      </template>

      <div
        v-if="plan.missingInFile.length"
        class="soft small"
      >
        Нет в файле и останутся как есть: {{ plan.missingInFile.length }}
        <button
          class="btn-link"
          type="button"
          @click="showMissing = !showMissing"
        >
          {{ showMissing ? 'скрыть' : 'показать' }}
        </button>
        <ul
          v-if="showMissing"
          class="plan-list"
        >
          <li
            v-for="p in plan.missingInFile"
            :key="p"
          >
            {{ p }}
          </li>
        </ul>
      </div>
    </div>
    <div
      v-if="!plan.applied"
      class="card-footer"
    >
      <span
        v-if="!plan.canApply"
        class="soft small"
      >Исправьте ошибки в файле и загрузите его снова — файл применяется целиком.</span>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="busy || !plan.canApply || !file"
        @click="file && send(file, true)"
      >
        <AppIcon
          name="check"
          :size="15"
        /> Загрузить структуру
      </button>
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

@media (max-width: 860px) {
  .exchange-grid {
    grid-template-columns: minmax(0, 1fr);
  }
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

.plan-title {
  font-size: 13px;
  font-weight: 600;
  margin: 6px 0 0;
}

.plan-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.plan-list .badge {
  margin-right: 6px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
}

.btn-link {
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  cursor: pointer;
  padding: 0;
}
</style>
