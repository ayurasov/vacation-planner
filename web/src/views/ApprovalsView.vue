<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, daysBetween, fmtRange, type VacationRequest } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import AppIcon from '@/components/common/AppIcon.vue';

const auth = useAuthStore();
const queue = ref<VacationRequest[]>([]);
const loading = ref(true);
const error = ref('');
const rejectFor = ref<number | null>(null);
const rejectComment = ref('');
const busy = ref(false);

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const page = await api.get<{ items: VacationRequest[] }>('/vacation-requests?scope=subordinates&status=pending&per_page=100');
    queue.value = page.items;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function approve(r: VacationRequest): Promise<void> {
  busy.value = true;
  try {
    await api.post(`/vacation-requests/${r.id}/approve`, {});
    await reload();
  } catch (e) {
    alert((e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function reject(r: VacationRequest): Promise<void> {
  if (rejectComment.value.trim().length < 3) return;
  busy.value = true;
  try {
    await api.post(`/vacation-requests/${r.id}/reject`, { comment: rejectComment.value.trim() });
    rejectFor.value = null;
    rejectComment.value = '';
    await reload();
  } catch (e) {
    alert((e as Error).message);
  } finally {
    busy.value = false;
  }
}

function kindLabel(r: VacationRequest): string {
  if (r.pendingDeletion) return 'Удаление отпуска';
  if (r.changeFrom) return `Перенос с ${fmtRange(r.changeFrom.start, r.changeFrom.end)}`;
  if (r.type === 'maternity') return 'Декрет';
  return 'Новый отпуск';
}

onMounted(reload);
</script>

<template>
  <div>
    <div class="view-header">
      <div>
        <div class="view-title">
          Заявки к согласованию
        </div>
        <div class="view-subtitle">
          {{ auth.isAdmin ? 'Все сотрудники организации' : 'Ваши прямые подчинённые' }}
        </div>
      </div>
      <button
        class="btn"
        @click="reload"
      >
        <AppIcon
          name="refresh"
          :size="14"
        /> Обновить
      </button>
    </div>

    <div
      v-if="error"
      class="error-banner"
    >
      {{ error }}
    </div>
    <div
      v-if="loading"
      class="empty-state"
    >
      Загрузка…
    </div>
    <div
      v-else-if="!queue.length"
      class="card empty-state"
    >
      Заявок к согласованию нет
    </div>

    <div
      v-for="r in queue"
      :key="r.id"
      class="card"
      style="margin-bottom: 12px"
    >
      <div class="approval-row">
        <div style="flex: 1">
          <div class="approval-name">
            {{ r.employeeName ?? `Сотрудник #${r.employee}` }}
          </div>
          <div class="approval-kind">
            {{ kindLabel(r) }}
          </div>
          <div class="approval-dates">
            {{ fmtRange(r.start, r.end) }} · {{ daysBetween(r.start, r.end) }} календарных дней
          </div>
          <div
            v-if="r.comment"
            class="muted small"
          >
            «{{ r.comment }}»
          </div>
        </div>
        <div class="approval-actions">
          <template v-if="rejectFor !== r.id">
            <button
              class="btn btn-primary"
              :disabled="busy"
              @click="approve(r)"
            >
              Согласовать
            </button>
            <button
              class="btn"
              :disabled="busy"
              @click="rejectFor = r.id; rejectComment = ''"
            >
              Отклонить
            </button>
          </template>
          <template v-else>
            <input
              v-model="rejectComment"
              class="input"
              placeholder="Причина (обязательна)"
              style="width: 260px"
            >
            <button
              class="btn btn-danger"
              :disabled="busy || rejectComment.trim().length < 3"
              @click="reject(r)"
            >
              Отклонить
            </button>
            <button
              class="btn"
              @click="rejectFor = null"
            >
              Отмена
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.approval-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 14px 16px;
  flex-wrap: wrap;
}

.approval-name { font-weight: 600; font-size: 14px; }
.approval-kind { color: var(--color-text-muted); font-size: 12.5px; margin-top: 2px; }
.approval-dates { font-size: 13.5px; margin-top: 6px; }
.approval-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.muted { color: var(--color-text-muted); }
.small { font-size: 12px; margin-top: 4px; }
</style>
