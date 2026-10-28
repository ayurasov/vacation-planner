<script setup lang="ts">
import { useUiStore } from '@/stores/ui';
import AppIcon from './AppIcon.vue';

const ui = useUiStore();
const ICON = { success: 'check', error: 'warning', info: 'info' } as const;
</script>

<template>
  <div
    class="toast-wrap"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <div
        v-for="t in ui.toasts"
        :key="t.id"
        class="toast"
        :class="`toast-${t.tone}`"
      >
        <span class="toast-icon"><AppIcon
          :name="ICON[t.tone]"
          :size="14"
          :stroke="2"
        /></span>
        <span class="toast-text">{{ t.text }}</span>
        <button
          class="toast-close"
          type="button"
          aria-label="Закрыть"
          @click="ui.dismiss(t.id)"
        >
          <AppIcon
            name="close"
            :size="13"
          />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 400;
  max-width: min(400px, calc(100vw - 40px));
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-2);
  padding: 11px 12px;
  font-size: 13px;
}

.toast-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.toast-success .toast-icon { background: var(--color-success-soft); color: var(--color-success); }
.toast-error .toast-icon { background: var(--color-danger-soft); color: var(--color-danger); }
.toast-info .toast-icon { background: var(--color-primary-soft); color: var(--color-primary); }

.toast-text {
  flex: 1;
  padding-top: 2px;
}

.toast-close {
  border: none;
  background: none;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
}

.toast-close:hover {
  background: var(--color-hover);
  color: var(--color-text);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
