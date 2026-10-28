<script setup lang="ts">
import { computed } from 'vue';
import { statusMeta, type RequestLike } from '@/lib/requests';

const props = defineProps<{ request: RequestLike }>();
const meta = computed(() => statusMeta(props.request));
</script>

<template>
  <span
    class="badge badge-dot"
    :class="`badge-${meta.tone}`"
  >{{ meta.label }}</span>
</template>
