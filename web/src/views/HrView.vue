<script setup lang="ts">
// Кадровый учёт (v0.6.0, E60): кампания планирования и утверждение графика (форма Т-7),
// извещения о начале отпуска под подпись (ст. 123 ТК РФ).
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PlanningPanel from '@/components/PlanningPanel.vue';
import NoticesJournal from '@/components/NoticesJournal.vue';
import HelpLink from '@/components/common/HelpLink.vue';

const route = useRoute();
const router = useRouter();
const tab = ref<'planning' | 'notices'>(route.query.tab === 'notices' ? 'notices' : 'planning');
watch(tab, (t) => { void router.replace({ query: t === 'planning' ? {} : { tab: t } }); });
</script>

<template>
  <div class="page-narrow">
    <div class="view-header">
      <div>
        <div class="view-title">
          Кадровый учёт
          <HelpLink :topic="tab === 'planning' ? 'hrPlanning' : 'hrNotices'" />
        </div>
        <div class="view-subtitle">
          {{ tab === 'planning'
            ? 'График отпусков на год: планирование, утверждение, форма Т-7 (ст. 123 ТК РФ)'
            : 'Извещения о начале отпуска: не позднее чем за две недели, под подпись (ст. 123 ТК РФ)' }}
        </div>
      </div>
      <div class="segmented">
        <button
          type="button"
          :class="{ active: tab === 'planning' }"
          :aria-pressed="tab === 'planning'"
          @click="tab = 'planning'"
        >
          Планирование
        </button>
        <button
          type="button"
          :class="{ active: tab === 'notices' }"
          :aria-pressed="tab === 'notices'"
          @click="tab = 'notices'"
        >
          Извещения
        </button>
      </div>
    </div>

    <PlanningPanel v-if="tab === 'planning'" />
    <NoticesJournal v-else />
  </div>
</template>
