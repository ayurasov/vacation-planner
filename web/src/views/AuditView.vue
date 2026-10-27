<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/api/client';

interface AuditEvent {
  id: number; ts: string; actorId: number | null; action: string;
  entity: string; entityId: string; before: unknown; after: unknown;
}

const events = ref<AuditEvent[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const error = ref('');

const actionLabels: Record<string, string> = {
  'request.created': 'создание заявки',
  'request.approved': 'согласование',
  'request.rejected': 'отклонение',
  'request.cancelled': 'отмена',
  'request.deleted': 'удаление отпуска',
  'request.deletion_requested': 'запрос удаления',
  'request.updated': 'изменение заявки',
  'employee.created': 'новый сотрудник',
  'employee.updated': 'изменение сотрудника',
  'employee.deactivated': 'увольнение',
  'department.created': 'новый отдел',
  'department.updated': 'изменение отдела',
  'department.deleted': 'удаление отдела',
  'project.created': 'новый проект',
  'settings.updated': 'изменение настроек',
};

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get<{ items: AuditEvent[]; meta: { total: number } }>(
      `/audit-events?page=${page.value}&per_page=50`);
    events.value = data.items;
    total.value = data.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

function fmt(e: AuditEvent): string {
  const b = e.before ? JSON.stringify(e.before) : '';
  const a = e.after ? JSON.stringify(e.after) : '';
  return `${b || '—'} → ${a || '—'}`;
}

onMounted(reload);
</script>

<template>
  <div>
    <div class="view-header">
      <div>
        <div class="view-title">Аудит</div>
        <div class="view-subtitle">{{ total }} событий · только чтение</div>
      </div>
      <button class="btn" @click="reload">Обновить</button>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="loading" class="empty-state">Загрузка…</div>

    <div v-else class="card">
      <div class="grid-table">
        <div class="grid-head" style="grid-template-columns: 150px 1fr 160px 1fr">
          <div>Время</div><div>Действие</div><div>Кто</div><div>Изменение</div>
        </div>
        <div v-for="e in events" :key="e.id" class="grid-row" style="grid-template-columns: 150px 1fr 160px 1fr">
          <span class="muted">{{ new Date(e.ts).toLocaleString('ru-RU') }}</span>
          <div>{{ actionLabels[e.action] ?? e.action }}</div>
          <span class="muted">#{{ e.actorId ?? 'система' }} · {{ e.entity }}/{{ e.entityId }}</span>
          <code class="muted small" style="overflow-wrap: anywhere">{{ fmt(e).slice(0, 140) }}</code>
        </div>
      </div>
      <div class="pager">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; reload()">←</button>
        <span class="muted">стр. {{ page }} из {{ Math.max(1, Math.ceil(total / 50)) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / 50)" @click="page++; reload()">→</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.muted { color: var(--color-text-muted); }
.small { font-size: 11.5px; }
.pager { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
</style>
