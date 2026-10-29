<script setup lang="ts">
// Извещение о начале отпуска для печати под подпись (v0.6.0, E60-03): ТК РФ, ст. 123 — работник
// извещается под подпись не позднее чем за две недели до начала отпуска.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type OrgSettings, type VacationNotice } from '@/api/client';
import { fmtDate, fmtNumber, localIso, plural } from '@/lib/dates';
import AppIcon from '@/components/common/AppIcon.vue';

const route = useRoute();
const router = useRouter();
const notice = ref<VacationNotice | null>(null);
const error = ref('');
const orgName = ref('');

/** Для документа — полная дата: «29 октября 2026 г., 10:25». */
function stamp(ts: string): string {
  const d = new Date(ts);
  return `${fmtDate(localIso(d))} г., ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

/** «Иванова Мария Петровна» → «Иванова М. П.» */
const shortName = computed(() => {
  const [last, ...rest] = (notice.value?.employeeName ?? '').split(/\s+/);
  return [last, rest.map((p) => `${p[0]}.`).join(' ')].filter(Boolean).join(' ');
});

function print(): void {
  window.print();
}

function back(): void {
  if (window.history.length > 1) router.back();
  else void router.push('/my');
}

onMounted(async () => {
  try {
    notice.value = await api.get<VacationNotice>(`/notices/${Number(route.params.id)}`);
    // Наименование организации — из реквизитов формы Т-7 (правила организации)
    try { orgName.value = (await api.get<OrgSettings>('/settings')).orgName ?? ''; } catch { /* без наименования */ }
    document.title = `Извещение — ${notice.value.employeeName}`;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div class="print-page">
    <div class="print-toolbar no-print">
      <button
        class="btn btn-ghost"
        type="button"
        @click="back"
      >
        <AppIcon
          name="chevronLeft"
          :size="15"
        /> Назад
      </button>
      <button
        v-if="notice"
        class="btn btn-primary"
        type="button"
        @click="print"
      >
        <AppIcon
          name="printer"
          :size="15"
        /> Печать
      </button>
    </div>

    <div
      v-if="error"
      class="banner banner-error no-print"
      role="alert"
    >
      <AppIcon
        name="warning"
        :size="15"
      /> {{ error }}
    </div>

    <article
      v-if="notice"
      class="sheet"
    >
      <div
        v-if="orgName"
        class="org"
      >
        {{ orgName }}
      </div>
      <header class="addressee">
        <div>
          {{ notice.position ?? 'Работнику' }}<template v-if="notice.dept">
            , {{ notice.dept }}
          </template>
        </div>
        <div><strong>{{ notice.employeeName }}</strong></div>
      </header>

      <h1>Извещение<br><small>о начале ежегодного оплачиваемого отпуска</small></h1>

      <p class="text">
        В соответствии со статьёй 123 Трудового кодекса Российской Федерации извещаем Вас о том, что согласно
        графику отпусков Вам предоставляется ежегодный оплачиваемый отпуск продолжительностью
        <strong>{{ fmtNumber(notice.days) }} {{ plural(notice.days, ['календарный день', 'календарных дня', 'календарных дней']) }}</strong>
        с <strong>{{ fmtDate(notice.start) }}</strong> по <strong>{{ fmtDate(notice.end) }}</strong>.
      </p>
      <p
        v-if="notice.late"
        class="text"
      >
        Извещение направлено позднее чем за две недели до начала отпуска. По статье 124 Трудового кодекса
        Российской Федерации по Вашему письменному заявлению отпуск может быть перенесён на другой срок,
        согласованный с работодателем.
      </p>
      <p
        v-if="notice.withdrawnAt"
        class="text withdrawn"
      >
        Извещение отозвано {{ stamp(notice.withdrawnAt) }}: отпуск отменён или перенесён на другие даты.
      </p>

      <dl class="facts">
        <div>
          <dt>Извещение направлено</dt>
          <dd>{{ stamp(notice.sentAt) }}</dd>
        </div>
        <div v-if="notice.acknowledgedAt">
          <dt>Ознакомление подтверждено в системе</dt>
          <dd>{{ stamp(notice.acknowledgedAt) }}</dd>
        </div>
      </dl>

      <div class="signature">
        <span>С извещением ознакомлен(а):</span>
        <span class="line" />
        <span class="hint">подпись</span>
        <span class="name">{{ shortName }}</span>
        <span class="date">«____» ______________ 20____ г.</span>
      </div>
    </article>
  </div>
</template>

<style scoped>
.print-page {
  min-height: 100vh;
  padding: 24px 16px 48px;
  background: var(--color-bg);
}

.print-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  max-width: 210mm;
  margin: 0 auto 16px;
}

/* Лист бумаги: белый и в тёмной теме — так он выглядит и при печати */
.sheet {
  max-width: 210mm;
  margin: 0 auto;
  padding: 20mm 18mm 24mm;
  background: #fff;
  color: #111;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  line-height: 1.55;
}

.org {
  margin-bottom: 24px;
  font-weight: 600;
}

.addressee {
  margin-left: auto;
  width: min(100%, 300px);
  text-align: left;
}

h1 {
  margin: 36px 0 24px;
  font-size: 18px;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

h1 small {
  font-size: 14px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.text {
  margin: 0 0 12px;
  text-indent: 1.25em;
  text-align: justify;
}

.withdrawn {
  font-weight: 600;
}

.facts {
  margin: 24px 0 0;
  font-size: 13px;
}

.facts div {
  display: flex;
  gap: 8px;
}

.facts dt::after {
  content: ':';
}

.facts dd {
  margin: 0;
}

.signature {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) auto;
  grid-template-areas:
    'label line name'
    '.     hint .'
    'date  date date';
  gap: 0 12px;
  align-items: end;
  margin-top: 48px;
}

.signature > span:first-child { grid-area: label; }

.signature .line {
  grid-area: line;
  border-bottom: 1px solid #111;
  height: 1.4em;
}

.signature .hint {
  grid-area: hint;
  font-size: 11px;
  text-align: center;
  color: #555;
}

.signature .name { grid-area: name; }

.signature .date {
  grid-area: date;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .sheet {
    padding: 24px 18px;
  }

  .signature {
    grid-template-columns: 1fr;
    grid-template-areas: 'label' 'line' 'hint' 'name' 'date';
  }
}

@media print {
  .no-print {
    display: none;
  }

  .print-page {
    padding: 0;
    background: none;
  }

  .sheet {
    max-width: none;
    padding: 0;
    border: none;
  }
}
</style>
