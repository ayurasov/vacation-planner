<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, daysBetween, type VacationRequest } from '@/api/client';

const emit = defineEmits<{ close: []; created: [VacationRequest] }>();

const start = ref('');
const end = ref('');
const comment = ref('');
const busy = ref(false);
const error = ref('');

const calendarDays = computed(() =>
  start.value && end.value && start.value <= end.value ? daysBetween(start.value, end.value) : 0);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const created = await api.post<VacationRequest>('/vacation-requests', {
      start: start.value,
      end: end.value,
      comment: comment.value.trim() || undefined,
    });
    emit('created', created);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="modal-overlay"
    @click.self="emit('close')"
  >
    <div class="modal">
      <div class="modal-title">
        Заявка на отпуск
      </div>

      <div
        v-if="error"
        class="error-banner"
      >
        {{ error }}
      </div>

      <div class="field">
        <label for="v-start">Первый день</label>
        <input
          id="v-start"
          v-model="start"
          type="date"
          class="input"
          :min="new Date().toISOString().slice(0, 10)"
        >
      </div>
      <div class="field">
        <label for="v-end">Последний день</label>
        <input
          id="v-end"
          v-model="end"
          type="date"
          class="input"
          :min="start || new Date().toISOString().slice(0, 10)"
        >
      </div>
      <div class="field">
        <label for="v-comment">Комментарий (необязательно)</label>
        <textarea
          id="v-comment"
          v-model="comment"
          class="input"
          rows="2"
          maxlength="1000"
        />
      </div>

      <div
        v-if="calendarDays"
        class="days-preview"
      >
        {{ calendarDays }} календарных дней
      </div>

      <div class="modal-actions">
        <button
          class="btn"
          @click="emit('close')"
        >
          Отмена
        </button>
        <button
          class="btn btn-primary"
          :disabled="busy || !start || !end || start > end"
          @click="submit"
        >
          {{ busy ? 'Отправляем…' : 'Отправить' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.days-preview {
  font-size: 13px;
  color: var(--color-primary-dark);
  background: var(--color-primary-soft);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}
</style>
