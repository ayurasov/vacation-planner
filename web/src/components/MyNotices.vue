<script setup lang="ts">
// Извещения о начале отпуска (v0.6.0, E60-03): не позднее чем за две недели до начала отпуска
// сотрудник подтверждает ознакомление (ТК РФ, ст. 123). Подтверждённые — одной строкой.
import { computed, onMounted, ref } from 'vue';
import { api, type VacationNotice } from '@/api/client';
import { useUiStore } from '@/stores/ui';
import { fmtDate, fmtDateTime, fmtNumber, fmtRange, localIso, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';

const ui = useUiStore();
const today = localIso(new Date());
const items = ref<VacationNotice[]>([]);
const busy = ref<number | null>(null);

const open = computed(() => items.value.filter((n) => !n.acknowledgedAt && n.end >= today));
const done = computed(() => items.value.filter((n) => n.acknowledgedAt && n.start > today));

async function load(): Promise<void> {
  try {
    items.value = (await api.get<{ items: VacationNotice[] }>('/notices/mine')).items;
  } catch { /* извещения не загрузились — остальная страница работает */ }
}

async function acknowledge(n: VacationNotice): Promise<void> {
  busy.value = n.id;
  try {
    await api.post(`/notices/${n.id}/acknowledge`, {});
    ui.toast('Ознакомление подтверждено');
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = null;
  }
}

onMounted(load);
</script>

<template>
  <section
    v-for="n in open"
    :key="n.id"
    class="card notice-card"
    :aria-labelledby="`notice-${n.id}`"
  >
    <span class="notice-icon"><AppIcon
      name="signature"
      :size="20"
    /></span>
    <div class="notice-body">
      <div
        :id="`notice-${n.id}`"
        class="notice-title"
      >
        Извещение о начале отпуска
      </div>
      <p>
        Ежегодный оплачиваемый отпуск <strong>{{ fmtRange(n.start, n.end) }}</strong>
        — {{ fmtNumber(n.days) }} {{ plural(n.days, ['день', 'дня', 'дней']) }}, начинается {{ fmtDate(n.start) }}.
      </p>
      <p
        v-if="n.late"
        class="soft small"
      >
        Извещение направлено позже чем за две недели до начала: по ст. 124 ТК РФ отпуск можно перенести
        по вашему письменному заявлению.
      </p>
      <p class="soft small">
        Извещено {{ fmtDateTime(n.sentAt) }}
      </p>
    </div>
    <div class="notice-actions">
      <button
        class="btn btn-primary"
        type="button"
        :disabled="busy === n.id"
        @click="acknowledge(n)"
      >
        <AppIcon
          name="check"
          :size="15"
        /> Ознакомлен
      </button>
      <router-link
        class="btn btn-ghost btn-sm"
        :to="`/notices/${n.id}/print`"
      >
        <AppIcon
          name="printer"
          :size="14"
        /> Для печати
      </router-link>
    </div>
  </section>

  <p
    v-for="n in done"
    :key="n.id"
    class="notice-done soft small"
  >
    <AppIcon
      name="check"
      :size="14"
    />
    С извещением об отпуске {{ fmtRange(n.start, n.end) }} ознакомлены {{ fmtDateTime(n.acknowledgedAt!) }}
  </p>
</template>

<style scoped>
.notice-card {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  border-color: var(--color-primary);
  box-shadow: inset 4px 0 0 var(--color-primary);
}

.notice-icon {
  display: grid;
  place-items: center;
  flex: 0 0 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.notice-body {
  flex: 1 1 auto;
  min-width: 0;
}

.notice-body p {
  margin: 4px 0 0;
}

.notice-title {
  font-weight: 600;
}

.notice-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.notice-done {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
}

@media (max-width: 600px) {
  .notice-card {
    flex-wrap: wrap;
  }

  .notice-actions {
    flex: 1 1 100%;
    flex-direction: row;
  }
}
</style>
