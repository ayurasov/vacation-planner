<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import {
  api, daysBetween, fmtRange, type Balance, type VacationRequest,
} from '@/api/client';
import VacationForm from '@/components/VacationForm.vue';

const auth = useAuthStore();
const balance = ref<Balance | null>(null);
const requests = ref<VacationRequest[]>([]);
const notifications = ref<Array<{ id: number; text: string; isRead: boolean; createdAt: string }>>([]);
const showModal = ref(false);
const loading = ref(true);
const error = ref('');

const year = new Date().getFullYear();

async function reload(): Promise<void> {
  error.value = '';
  try {
    const meId = auth.me!.employee.id;
    const [b, rq, nt] = await Promise.all([
      api.get<Balance>(`/employees/${meId}/balance?year=${year}`),
      api.get<{ items: VacationRequest[] }>('/vacation-requests?scope=mine&per_page=50'),
      api.get<{ items: { id: number; text: string; isRead: boolean; createdAt: string }[] }>('/notifications?per_page=20'),
    ]);
    balance.value = b;
    requests.value = rq.items;
    notifications.value = nt.items;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

const activeRequests = computed(() =>
  requests.value.filter((r) => r.status === 'pending' || r.status === 'approved'));
const pastRequests = computed(() =>
  requests.value.filter((r) => r.status === 'rejected' || r.status === 'cancelled'));

function statusBadge(status: string, pendingDeletion: boolean): { cls: string; label: string } {
  if (status === 'pending') {
    return pendingDeletion
      ? { cls: 'badge-warning', label: 'на удаление' }
      : { cls: 'badge-info', label: 'на согласовании' };
  }
  if (status === 'approved') return { cls: 'badge-success', label: 'согласован' };
  if (status === 'rejected') return { cls: 'badge-danger', label: 'отклонён' };
  return { cls: 'badge-muted', label: 'отменён' };
}

async function cancel(r: VacationRequest): Promise<void> {
  const what = r.status === 'approved' ? 'запросить удаление' : 'отменить';
  if (!confirm(`${what[0].toUpperCase() + what.slice(1)} заявку ${fmtRange(r.start, r.end)}?`)) return;
  try {
    await api.del(`/vacation-requests/${r.id}`);
    await reload();
  } catch (e) {
    alert((e as Error).message);
  }
}

async function markRead(id: number): Promise<void> {
  await api.post(`/notifications/${id}/read`);
  await reload();
}

onMounted(reload);
</script>

<template>
  <div>
    <div class="view-header">
      <div>
        <div class="view-title">Мой отпуск</div>
        <div class="view-subtitle">{{ auth.me?.employee.name }} · {{ year }} год</div>
      </div>
      <button v-if="auth.me?.employee.empType !== 'ipsz'" class="btn btn-primary" @click="showModal = true">
        + Добавить отпуск
      </button>
    </div>

    <div v-if="auth.me?.employee.empType === 'ipsz'" class="card empty-state">
      Для ИП и самозанятых отпуск не предусмотрен.
    </div>

    <template v-else>
      <div v-if="error" class="error-banner">{{ error }}</div>

      <div v-if="loading" class="empty-state">Загрузка…</div>

      <template v-else-if="balance">
        <div v-if="!balance.hasFourteenDayStretch" class="warn-banner">
          По ТК РФ одна из частей отпуска должна быть не короче 14 календарных дней подряд. Сейчас такой части нет.
        </div>

        <div class="kpi-row">
          <div class="card kpi">
            <div class="kpi-value">{{ balance.entitlement }}</div>
            <div class="kpi-label">положено дней</div>
          </div>
          <div class="card kpi">
            <div class="kpi-value">{{ balance.used }}</div>
            <div class="kpi-label">использовано</div>
          </div>
          <div class="card kpi">
            <div class="kpi-value">{{ balance.pending }}</div>
            <div class="kpi-label">на согласовании</div>
          </div>
          <div class="card kpi" :class="{ 'kpi-danger': balance.remaining < 0, 'kpi-warn': balance.remaining === 0 }">
            <div class="kpi-value">{{ balance.remaining }}</div>
            <div class="kpi-label">остаток</div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 16px">
          <div class="card-pad">
            <strong>Мои периоды</strong>
          </div>
          <div v-if="!activeRequests.length" class="empty-state">Активных отпусков нет</div>
          <div v-for="r in activeRequests" :key="r.id" class="grid-row" style="grid-template-columns: 1fr 130px 110px 120px">
            <div>
              {{ fmtRange(r.start, r.end) }}
              <span class="muted">{{ daysBetween(r.start, r.end) }} к.д.</span>
              <div v-if="r.changeFrom" class="muted small">перенос с {{ fmtRange(r.changeFrom.start, r.changeFrom.end) }}</div>
              <div v-if="r.comment" class="muted small">«{{ r.comment }}»</div>
            </div>
            <span class="badge" :class="statusBadge(r.status, r.pendingDeletion).cls">{{ statusBadge(r.status, r.pendingDeletion).label }}</span>
            <span class="muted">{{ new Date(r.createdAt).toLocaleDateString('ru-RU') }}</span>
            <button class="btn btn-sm" @click="cancel(r)">
              {{ r.status === 'approved' ? 'Запросить удаление' : 'Отменить' }}
            </button>
          </div>
        </div>

        <div v-if="pastRequests.length" class="card" style="margin-bottom: 16px">
          <div class="card-pad"><strong>Архив</strong></div>
          <div v-for="r in pastRequests" :key="r.id" class="grid-row" style="grid-template-columns: 1fr 110px 1fr">
            <div>{{ fmtRange(r.start, r.end) }} <span class="muted">{{ daysBetween(r.start, r.end) }} к.д.</span></div>
            <span class="badge" :class="statusBadge(r.status, false).cls">{{ statusBadge(r.status, false).label }}</span>
            <span v-if="r.rejectionComment" class="muted small">Причина: {{ r.rejectionComment }}</span>
          </div>
        </div>

        <div v-if="notifications.length" class="card">
          <div class="card-pad"><strong>Уведомления</strong></div>
          <div v-for="n in notifications" :key="n.id" class="grid-row clickable" style="grid-template-columns: 1fr 130px" @click="!n.isRead && markRead(n.id)">
            <div :style="n.isRead ? '' : 'font-weight:600'">{{ n.text }}</div>
            <span class="muted small">{{ new Date(n.createdAt).toLocaleString('ru-RU') }}</span>
          </div>
        </div>
      </template>
    </template>

    <VacationForm v-if="showModal" @close="showModal = false" @created="reload(); showModal = false" />
  </div>
</template>

<style scoped>
.card-pad {
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
}
.muted { color: var(--color-text-muted); }
.small { font-size: 12px; }
</style>
