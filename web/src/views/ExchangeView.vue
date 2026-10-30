<script setup lang="ts">
// Импорт и экспорт (v1.1.0, ADR-018): структура компании и сотрудники в форматах «По Делу» —
// чтобы инструменты работали с одной структурой, — и импорт сотрудников с остатками из Excel.
import { ref } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';
import HelpLink from '@/components/common/HelpLink.vue';
import ImportDialog from '@/components/ImportDialog.vue';
import StructureTransfer from '@/components/exchange/StructureTransfer.vue';
import EmployeeTransfer from '@/components/exchange/EmployeeTransfer.vue';

type Tab = 'structure' | 'employees' | 'csv' | 'excel';
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'structure', label: 'Структура', icon: 'building' },
  { id: 'employees', label: 'Сотрудники', icon: 'user' },
  { id: 'csv', label: 'Быстрый импорт CSV', icon: 'upload' },
  { id: 'excel', label: 'Остатки из Excel', icon: 'spreadsheet' },
];
const tab = ref<Tab>('structure');
const excelOpen = ref(false);
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Импорт и экспорт
          <HelpLink topic="exchange" />
        </div>
        <div class="view-subtitle">
          Структура компании и сотрудники — в тех же файлах, что у «По Делу»
        </div>
      </div>
    </div>

    <div
      class="segmented tabs"
      role="tablist"
    >
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="tab === t.id"
        :class="{ active: tab === t.id }"
        @click="tab = t.id"
      >
        <AppIcon
          :name="t.icon"
          :size="14"
        /> {{ t.label }}
      </button>
    </div>

    <StructureTransfer v-if="tab === 'structure'" />
    <EmployeeTransfer
      v-else-if="tab === 'employees'"
      key="transfer"
      mode="transfer"
    />
    <EmployeeTransfer
      v-else-if="tab === 'csv'"
      key="sync"
      mode="sync"
    />
    <section
      v-else
      class="card"
    >
      <div class="card-body excel">
        <p>
          Сотрудники с нормой дней и переносом с прошлых лет из книги Excel или CSV по шаблону планировщика —
          например, при первом запуске или из кадровой системы. Сначала показывается, что изменится; файл применяется целиком.
        </p>
        <button
          class="btn btn-primary"
          type="button"
          @click="excelOpen = true"
        >
          <AppIcon
            name="upload"
            :size="15"
          /> Загрузить файл Excel
        </button>
      </div>
    </section>

    <ImportDialog
      v-if="excelOpen"
      @close="excelOpen = false"
      @done="() => {}"
    />
  </div>
</template>

<style scoped>
.tabs {
  margin-bottom: 14px;
}

.excel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.excel p {
  margin: 0;
  max-width: 70ch;
}
</style>
