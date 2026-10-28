<script setup lang="ts">
import AppIcon from './AppIcon.vue';

withDefaults(defineProps<{ icon?: string; title: string; text?: string; compact?: boolean }>(), {
  icon: 'inbox', text: '', compact: false,
});
</script>

<template>
  <div
    class="empty"
    :class="{ compact }"
  >
    <div class="empty-icon">
      <AppIcon
        :name="icon"
        :size="compact ? 20 : 26"
      />
    </div>
    <div class="empty-title">
      {{ title }}
    </div>
    <div
      v-if="text"
      class="empty-text"
    >
      {{ text }}
    </div>
    <div
      v-if="$slots.default"
      class="empty-actions"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  padding: 48px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty.compact {
  padding: 26px 16px;
}

.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}

.compact .empty-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  margin-bottom: 10px;
}

.empty-title {
  font-weight: 600;
  font-size: 14.5px;
}

.empty-text {
  color: var(--color-text-muted);
  font-size: 13px;
  margin-top: 4px;
  max-width: 380px;
}

.empty-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}
</style>
