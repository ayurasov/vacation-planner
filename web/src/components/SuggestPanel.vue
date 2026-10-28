<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Suggestions } from '@/api/client';
import { addDays, fmtRange, localIso, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';

/** Подбор лучших окон отпуска: нагрузка отдела, праздники, свои отпуска (GET /analytics/suggestions). */
const props = defineProps<{ employeeId?: number | null; initialDays?: number }>();
const emit = defineEmits<{ pick: [start: string, end: string] }>();

const today = localIso(new Date());
const days = ref(props.initialDays ?? 14);
const from = ref(addDays(today, 7));
const to = ref(`${today.slice(0, 4)}-12-31`);
const result = ref<Suggestions | null>(null);
const busy = ref(false);
const error = ref('');

async function search(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ days: String(days.value), from: from.value, to: to.value });
    if (props.employeeId) q.set('employee', String(props.employeeId));
    result.value = await api.get<Suggestions>(`/analytics/suggestions?${q}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  // До конца года меньше трёх месяцев — ищем на полгода вперёд (сервер ограничивает поиск 400 днями)
  if (to.value < addDays(from.value, 90)) to.value = addDays(from.value, 182);
  void search();
});
</script>

<template>
  <div class="suggest">
    <div class="suggest-form">
      <div class="field">
        <label for="s-days">Дней отпуска</label>
        <input
          id="s-days"
          v-model.number="days"
          type="number"
          min="1"
          max="60"
          class="input"
        >
      </div>
      <div class="field">
        <label for="s-from">Не раньше</label>
        <input
          id="s-from"
          v-model="from"
          type="date"
          class="input"
          :min="today"
        >
      </div>
      <div class="field">
        <label for="s-to">Не позже</label>
        <input
          id="s-to"
          v-model="to"
          type="date"
          class="input"
          :min="from"
        >
      </div>
      <button
        class="btn"
        type="button"
        :disabled="busy || days < 1 || days > 60"
        @click="search"
      >
        <AppIcon
          name="search"
          :size="14"
        /> Подобрать
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
      v-else-if="busy"
      class="skeleton"
      style="height: 64px"
    />
    <template v-else-if="result">
      <p
        v-if="!result.items.length"
        class="soft small"
      >
        Подходящих окон нет: в эти даты отдел уже слишком загружен. Расширьте период или сократите длительность.
      </p>
      <button
        v-for="s in result.items"
        :key="s.start"
        type="button"
        class="option"
        @click="emit('pick', s.start, s.end)"
      >
        <div class="option-main">
          <strong>{{ fmtRange(s.start, s.end) }}</strong>
          <span class="soft small">
            {{ s.calendarDays }} {{ plural(s.calendarDays, ['день', 'дня', 'дней']) }} отдыха<template v-if="s.holidays">
              · из них {{ s.holidays }} {{ plural(s.holidays, ['праздник', 'праздника', 'праздников']) }}
            </template>
          </span>
          <ul>
            <li
              v-for="r in s.reasons"
              :key="r"
            >
              {{ r }}
            </li>
          </ul>
        </div>
        <div
          class="load"
          :title="`Наибольшая доля отдела в отпуске в эти дни, включая вас: ${Math.round(s.maxRatio * 100)}%`"
        >
          <span class="load-bar"><span :style="{ width: `${Math.round(s.maxRatio * 100)}%` }" /></span>
          <span class="soft small">{{ Math.round(s.maxRatio * 100) }}% отдела с вами</span>
        </div>
        <span class="pick">Выбрать <AppIcon
          name="arrowRight"
          :size="13"
        /></span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.suggest-form {
  display: grid;
  grid-template-columns: 90px 1fr 1fr auto;
  gap: 8px;
  align-items: end;
  margin-bottom: 10px;
}

.suggest-form .field {
  margin-bottom: 0;
}

.option {
  display: grid;
  grid-template-columns: 1fr 120px auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  text-align: left;
  font: inherit;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.option:hover {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-ring);
}

.option-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.option ul {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.load {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.load-bar {
  height: 6px;
  border-radius: 4px;
  background: var(--color-neutral-soft);
  overflow: hidden;
}

.load-bar span {
  display: block;
  height: 100%;
  background: var(--status-vacation);
  border-radius: 4px;
}

.pick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-primary);
  font-size: 12.5px;
  font-weight: 600;
}

@media (max-width: 700px) {
  .suggest-form {
    grid-template-columns: 1fr 1fr;
  }

  .option {
    grid-template-columns: 1fr;
  }
}
</style>
