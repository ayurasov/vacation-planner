<script setup lang="ts">
// Выбор файла щелчком или перетаскиванием — для загрузок на странице «Импорт и экспорт».
import { ref } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';

defineProps<{ accept: string; hint: string; file: File | null; busy?: boolean }>();
const emit = defineEmits<{ pick: [file: File] }>();
const dragging = ref(false);

function onPick(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (f) emit('pick', f);
}

function onDrop(ev: DragEvent): void {
  dragging.value = false;
  const f = ev.dataTransfer?.files?.[0];
  if (f) emit('pick', f);
}
</script>

<template>
  <label
    class="dropzone"
    :class="{ dragging, busy }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <input
      type="file"
      :accept="accept"
      class="sr-only"
      @change="onPick"
    >
    <AppIcon
      name="upload"
      :size="22"
    />
    <span v-if="file"><strong>{{ file.name }}</strong> · выбрать другой файл</span>
    <span v-else><strong>Выберите файл</strong> или перетащите его сюда · {{ hint }}</span>
  </label>
</template>

<style scoped>
.dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 22px;
  border: 1.5px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.dropzone:focus-within {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.dropzone.busy {
  opacity: 0.6;
  pointer-events: none;
}
</style>
