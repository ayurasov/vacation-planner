<script setup lang="ts">
import { computed } from 'vue';
import { avatarColor, initials } from '@/lib/people';

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 28 });
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.38)}px`,
  background: avatarColor(props.name),
}));
</script>

<template>
  <span
    class="avatar"
    :style="style"
    :title="name"
    aria-hidden="true"
  >{{ initials(name) }}</span>
</template>

<style scoped>
.avatar {
  border-radius: 50%;
  color: #fff;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  letter-spacing: 0.02em;
  user-select: none;
}
</style>
