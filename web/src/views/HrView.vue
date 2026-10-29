<script setup lang="ts">
// Кадровый учёт (v0.6.0, E60): извещения о начале отпуска под подпись (ст. 123 ТК РФ).
import NoticesJournal from '@/components/NoticesJournal.vue';
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Кадровый учёт
        </div>
        <div class="view-subtitle">
          Извещения о начале отпуска: не позднее чем за две недели, под подпись (ст. 123 ТК РФ)
        </div>
      </div>
    </div>

    <NoticesJournal />
  </div>
</template>
