<script setup lang="ts">
// Приглашение запланировать отпуск (v0.6.0, E60-01): открытая кампания, срок и свой прогресс —
// запланировано из нормы, есть ли часть не короче 14 календарных дней (ст. 125 ТК РФ).
import { computed, onMounted, ref } from 'vue';
import { api, type MyPlanning } from '@/api/client';
import { fmtDate, fmtNumber } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';

const emit = defineEmits<{ plan: [year: number] }>();

const data = ref<MyPlanning | null>(null);

const plan = computed(() => data.value?.plan ?? null);
const plannedText = computed(() => (plan.value
  ? `Запланировано ${fmtNumber(plan.value.plannedDays)} из ${fmtNumber(plan.value.norm)} дн.`
    + (plan.value.pendingDays ? `, на согласовании ${fmtNumber(plan.value.pendingDays)}` : '')
  : ''));
const pct = computed(() => (plan.value && plan.value.norm > 0 ? Math.min(100, Math.round((plan.value.plannedDays / plan.value.norm) * 100)) : 0));

async function load(): Promise<void> {
  try {
    data.value = await api.get<MyPlanning>('/planning/mine');
  } catch { /* без приглашения страница работает как прежде */ }
}

onMounted(load);
defineExpose({ load });
</script>

<template>
  <section
    v-if="data?.campaign && plan"
    class="card planning-card"
    :class="{ done: plan.status === 'done' }"
    aria-labelledby="planning-title"
  >
    <div class="planning-main">
      <div
        id="planning-title"
        class="planning-title"
      >
        <template v-if="plan.status === 'done'">
          Отпуск на {{ data.campaign.year }} год запланирован
        </template>
        <template v-else>
          Запланируйте отпуск на {{ data.campaign.year }} год
        </template>
      </div>
      <p class="soft small">
        <template v-if="data.campaign.overdue">
          Срок кадровой службы — {{ fmtDate(data.campaign.deadline) }} — прошёл, планирование ещё открыто.
        </template>
        <template v-else>
          Кадровая служба собирает график до {{ fmtDate(data.campaign.deadline) }}.
        </template>
        Согласованные отпуска войдут в утверждённый график.
      </p>
      <div
        class="progress"
        role="meter"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="pct"
        :aria-label="`Запланировано ${fmtNumber(plan.plannedDays)} из ${fmtNumber(plan.norm)} дней`"
      >
        <span
          class="progress-fill"
          :style="{ width: `${pct}%` }"
        />
      </div>
      <ul class="checks">
        <li :class="plan.plannedDays >= plan.norm ? 'ok' : 'todo'">
          <AppIcon
            :name="plan.plannedDays >= plan.norm ? 'check' : 'clock'"
            :size="14"
          />
          {{ plannedText }}
        </li>
        <li
          v-if="plan.norm >= 14"
          :class="plan.hasFourteen ? 'ok' : 'todo'"
        >
          <AppIcon
            :name="plan.hasFourteen ? 'check' : 'clock'"
            :size="14"
          />
          Одна из частей — не короче 14 календарных дней
        </li>
      </ul>
    </div>
    <button
      v-if="plan.status !== 'done'"
      class="btn btn-primary"
      type="button"
      @click="emit('plan', data.campaign.year)"
    >
      <AppIcon
        name="plus"
        :size="15"
      /> Запланировать на {{ data.campaign.year }}
    </button>
  </section>
</template>

<style scoped>
.planning-card {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 16px 18px;
  border-color: var(--color-primary);
  box-shadow: inset 4px 0 0 var(--color-primary);
}

.planning-card.done {
  border-color: var(--color-border);
  box-shadow: inset 4px 0 0 var(--color-success);
}

.planning-main {
  flex: 1 1 auto;
  min-width: 0;
}

.planning-title {
  font-weight: 600;
}

.planning-main p {
  margin: 4px 0 10px;
}

.progress {
  height: 8px;
  border-radius: 4px;
  background: var(--color-neutral-soft);
  overflow: hidden;
  max-width: 420px;
}

.progress-fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--color-primary);
}

.done .progress-fill {
  background: var(--color-success);
}

.checks {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  font-size: 13px;
}

.checks li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.checks .ok {
  color: var(--color-success-dark);
}

.checks .todo {
  color: var(--color-text-muted);
}

@media (max-width: 600px) {
  .planning-card {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
