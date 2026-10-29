<script setup lang="ts">
// Замещение руководителя (v0.6.0, E61-01): кому передано согласование и на какой срок.
// В профиле — свои замещения (переданные и полученные); в карточке сотрудника — кадровая служба
// назначает замещение за руководителя (managerId).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, type Delegation, type Employee, type Page } from '@/api/client';
import { useUiStore } from '@/stores/ui';
import { addDays, fmtRange, localIso } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';

const props = defineProps<{
  /** Руководитель, за которого назначает кадровая служба; без него — сам пользователь. */
  managerId?: number;
}>();

const ui = useUiStore();
const today = localIso(new Date());
const given = ref<Delegation[]>([]);
const received = ref<Delegation[]>([]);
const loaded = ref(false);
const busy = ref(false);
const query = ref('');
const candidates = ref<Employee[]>([]);
const deputy = ref<Employee | null>(null);
const start = ref(today);
const end = ref(addDays(today, 13));
const uid = `deleg-${Math.random().toString(36).slice(2, 8)}`;

const canSave = computed(() => !!deputy.value && !!start.value && !!end.value && start.value <= end.value && !busy.value);

async function load(): Promise<void> {
  try {
    const r = await api.get<{ given: Delegation[]; received: Delegation[] }>(
      props.managerId ? `/delegations?manager=${props.managerId}` : '/delegations',
    );
    given.value = r.given;
    received.value = r.received;
  } catch { /* список не загрузился — форма всё равно доступна */ } finally {
    loaded.value = true;
  }
}

let timer = 0;
watch(query, (q) => {
  window.clearTimeout(timer);
  if (deputy.value && q === deputy.value.name) return;
  deputy.value = null;
  if (q.trim().length < 2) { candidates.value = []; return; }
  timer = window.setTimeout(async () => {
    try {
      const page = await api.get<Page<Employee>>(`/employees?search=${encodeURIComponent(q.trim())}&per_page=8`);
      candidates.value = page.items.filter((e) => e.id !== props.managerId);
    } catch { candidates.value = []; }
  }, 250);
});

function pick(e: Employee): void {
  deputy.value = e;
  query.value = e.name;
  candidates.value = [];
}

async function save(): Promise<void> {
  if (!deputy.value) return;
  busy.value = true;
  try {
    await api.post('/delegations', {
      ...(props.managerId ? { managerId: props.managerId } : {}),
      deputyId: deputy.value.id, start: start.value, end: end.value,
    });
    ui.toast(`Согласование передано: ${deputy.value.name}, ${fmtRange(start.value, end.value)}`);
    deputy.value = null;
    query.value = '';
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}

async function revoke(d: Delegation): Promise<void> {
  const answer = await ui.ask({
    title: 'Отменить замещение?',
    text: `${d.deputyName} перестанет согласовывать заявки${props.managerId ? '' : ' ваших сотрудников'} (${fmtRange(d.start, d.end)}).`,
    confirmLabel: 'Отменить замещение',
    danger: true,
  });
  if (!answer.ok) return;
  try {
    await api.del(`/delegations/${d.id}`);
    ui.toast('Замещение отменено');
    await load();
  } catch (e) {
    ui.error(e);
  }
}

onMounted(load);
onBeforeUnmount(() => window.clearTimeout(timer));
</script>

<template>
  <div class="delegation">
    <ul
      v-if="received.length"
      class="deleg-list"
    >
      <li
        v-for="d in received"
        :key="d.id"
        class="deleg-item received"
      >
        <AppIcon
          name="swap"
          :size="15"
        />
        <span>Вы замещаете <strong>{{ d.managerName }}</strong>: {{ fmtRange(d.start, d.end) }}<template v-if="d.active"> — его заявки в разделе «Заявки»</template></span>
      </li>
    </ul>

    <ul
      v-if="given.length"
      class="deleg-list"
    >
      <li
        v-for="d in given"
        :key="d.id"
        class="deleg-item"
      >
        <div>
          <strong>{{ d.deputyName }}</strong>
          <span
            v-if="d.active"
            class="badge badge-success"
          >действует</span>
          <div class="soft small">
            {{ fmtRange(d.start, d.end) }}
          </div>
        </div>
        <button
          class="btn btn-sm btn-danger"
          type="button"
          :aria-label="`Отменить замещение: ${d.deputyName}`"
          @click="revoke(d)"
        >
          Отменить
        </button>
      </li>
    </ul>
    <p
      v-else-if="loaded"
      class="soft small"
    >
      {{ managerId ? 'Замещение не назначено.' : 'Согласование никому не передано.' }}
    </p>

    <!-- Не <form>: в карточке сотрудника редактор стоит внутри формы карточки, и вложенная форма
         отправляла бы и её -->
    <div
      class="deleg-form"
      role="group"
      aria-label="Новое замещение"
    >
      <div class="field picker">
        <label :for="`${uid}-q`">Заместитель</label>
        <input
          :id="`${uid}-q`"
          v-model="query"
          class="input"
          type="search"
          placeholder="ФИО или должность, от 2 букв"
          autocomplete="off"
          role="combobox"
          :aria-expanded="candidates.length > 0"
          :aria-controls="`${uid}-list`"
          @keydown.enter.prevent="candidates.length === 1 && pick(candidates[0])"
        >
        <ul
          v-if="candidates.length"
          :id="`${uid}-list`"
          class="candidates"
          role="listbox"
        >
          <li
            v-for="c in candidates"
            :key="c.id"
            role="option"
            :aria-selected="deputy?.id === c.id"
          >
            <button
              type="button"
              @click="pick(c)"
            >
              {{ c.name }}<span class="soft small"> · {{ c.position ?? c.deptName ?? '' }}</span>
            </button>
          </li>
        </ul>
      </div>
      <div class="dates">
        <div class="field">
          <label :for="`${uid}-s`">С</label>
          <input
            :id="`${uid}-s`"
            v-model="start"
            class="input"
            type="date"
            :min="today"
            required
            @keydown.enter.prevent
          >
        </div>
        <div class="field">
          <label :for="`${uid}-e`">По</label>
          <input
            :id="`${uid}-e`"
            v-model="end"
            class="input"
            type="date"
            :min="start"
            required
            @keydown.enter.prevent
          >
        </div>
      </div>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="!canSave"
        @click="save"
      >
        Передать согласование
      </button>
    </div>
  </div>
</template>

<style scoped>
.deleg-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.deleg-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.deleg-item .badge {
  margin-left: 6px;
}

.deleg-item.received {
  justify-content: flex-start;
  background: var(--color-primary-soft);
  border-color: transparent;
}

.deleg-form {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) auto;
  gap: 0 12px;
  align-items: end;
}

.dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 8px;
}

.picker {
  position: relative;
}

.candidates {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  top: 100%;
  margin: 2px 0 0;
  padding: 4px;
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-2);
  max-height: 240px;
  overflow: auto;
}

.candidates button {
  width: 100%;
  min-height: 32px;
  text-align: left;
  border: none;
  background: none;
  padding: 6px 8px;
  border-radius: 6px;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
}

.candidates button:hover,
.candidates button:focus-visible {
  background: var(--color-hover);
}

.deleg-form .btn {
  margin-bottom: 14px;
}

@media (max-width: 760px) {
  .deleg-form {
    grid-template-columns: 1fr;
  }

  .deleg-form .btn {
    justify-self: start;
  }
}
</style>
