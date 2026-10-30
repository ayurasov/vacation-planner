<script setup lang="ts">
// Знак «?» рядом с названием экрана: открывает руководство на главе об этом экране (E71).
// Якоря — в guide/help.ts; их существование проверяет guides.spec.ts.
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { HELP_TOPICS, helpLocation, type HelpTopic } from '@/guide/help';

const props = defineProps<{ topic: HelpTopic }>();
const label = computed(() => `Справка: ${HELP_TOPICS[props.topic].section}`);
</script>

<template>
  <router-link
    :to="helpLocation(topic)"
    class="help-link"
    :title="label"
    :aria-label="label"
  >
    <AppIcon
      name="help"
      :size="16"
    />
  </router-link>
</template>

<style scoped>
.help-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-left: 4px;
  border-radius: 50%;
  vertical-align: -3px;
  color: var(--color-text-soft);
  transition: background 0.15s, color 0.15s;
}

.help-link:hover {
  background: var(--color-hover);
  color: var(--color-primary);
}

@media (pointer: coarse) {
  .help-link {
    width: 36px;
    height: 36px;
    vertical-align: -8px;
  }
}
</style>
