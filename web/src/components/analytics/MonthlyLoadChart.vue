<script setup lang="ts">
import { computed, ref } from 'vue';
import { MONTHS, MONTHS_SHORT } from '@/lib/dates';

/**
 * Нагрузка отдела по месяцам: доля сотрудников в отпуске (рабочие дни).
 * Столбец = согласовано + заявки на согласовании (2px зазор между сегментами),
 * пунктир — порог конфликта. Подсказка при наведении; таблица — для экранных дикторов.
 */
const props = defineProps<{
  months: Array<{ month: number; avgRatio: number; planRatio: number; peakRatio: number; peakDate: string | null }>;
  threshold: number;
}>();

const W = 640;
const H = 200;
const PAD = { top: 14, right: 12, bottom: 26, left: 36 };
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;
const band = innerW / 12;
const barW = Math.min(24, band * 0.56);

const maxY = computed(() => {
  const top = Math.max(props.threshold, ...props.months.map((m) => Math.max(m.planRatio, m.peakRatio)));
  return Math.min(1, Math.ceil((top + 0.05) * 10) / 10);
});
const y = (v: number) => PAD.top + innerH - (v / maxY.value) * innerH;
const ticks = computed(() => {
  const step = maxY.value > 0.5 ? 0.25 : 0.1;
  const out: number[] = [];
  for (let v = 0; v <= maxY.value + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
});

const hover = ref<number | null>(null);
const pct = (v: number) => `${Math.round(v * 100)}%`;

function bars(m: { avgRatio: number; planRatio: number }) {
  const approvedTop = y(m.avgRatio);
  const pendingTop = y(Math.max(m.planRatio, m.avgRatio));
  const base = y(0);
  const approvedH = Math.max(0, base - approvedTop);
  const pendingH = Math.max(0, approvedTop - pendingTop - (approvedH > 0 ? 2 : 0));
  return { approvedTop, approvedH, pendingTop, pendingH };
}

/** Столбец с закруглённым верхом (4px) и прямым основанием. */
function roundedTop(x: number, top: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
}
</script>

<template>
  <figure class="chart">
    <div class="legend">
      <span><i class="key key-approved" />согласовано</span>
      <span><i class="key key-pending" />на согласовании</span>
      <span><i class="key key-threshold" />порог конфликта {{ pct(threshold) }}</span>
    </div>
    <div class="plot">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        role="img"
        aria-label="Доля отдела в отпуске по месяцам"
        @mouseleave="hover = null"
      >
        <g class="grid">
          <template
            v-for="t in ticks"
            :key="t"
          >
            <line
              :x1="PAD.left"
              :x2="W - PAD.right"
              :y1="y(t)"
              :y2="y(t)"
            />
            <text
              :x="PAD.left - 6"
              :y="y(t) + 3"
              text-anchor="end"
            >{{ pct(t) }}</text>
          </template>
        </g>
        <g
          v-for="(m, i) in months"
          :key="m.month"
          @mouseenter="hover = i"
        >
          <rect
            class="hit"
            :x="PAD.left + i * band"
            :y="PAD.top"
            :width="band"
            :height="innerH"
          />
          <path
            class="bar-pending"
            :d="roundedTop(PAD.left + i * band + (band - barW) / 2, bars(m).pendingTop, barW, bars(m).pendingH)"
          />
          <path
            class="bar-approved"
            :d="bars(m).pendingH > 0
              ? `M${PAD.left + i * band + (band - barW) / 2},${bars(m).approvedTop}h${barW}v${bars(m).approvedH}h${-barW}Z`
              : roundedTop(PAD.left + i * band + (band - barW) / 2, bars(m).approvedTop, barW, bars(m).approvedH)"
          />
          <text
            class="axis"
            :x="PAD.left + i * band + band / 2"
            :y="H - 8"
            text-anchor="middle"
          >{{ MONTHS_SHORT[i] }}</text>
        </g>
        <line
          class="threshold"
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="y(threshold)"
          :y2="y(threshold)"
        />
        <line
          class="baseline"
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="y(0)"
          :y2="y(0)"
        />
      </svg>
      <div
        v-if="hover !== null"
        class="tip"
        :style="{ left: `${((PAD.left + hover * band + band / 2) / W) * 100}%` }"
      >
        <strong>{{ MONTHS[hover] }}</strong>
        <span><i class="key key-approved" />согласовано {{ pct(months[hover].avgRatio) }}</span>
        <span><i class="key key-pending" />с заявками {{ pct(months[hover].planRatio) }}</span>
        <span class="soft">пик {{ pct(months[hover].peakRatio) }}{{ months[hover].peakDate ? ` · ${Number(months[hover].peakDate!.slice(8))} ${MONTHS_SHORT[hover]}` : '' }}</span>
      </div>
    </div>
    <table class="sr-only">
      <caption>Доля отдела в отпуске по месяцам</caption>
      <tr>
        <th>Месяц</th><th>Согласовано</th><th>С заявками</th><th>Пик</th>
      </tr>
      <tr
        v-for="(m, i) in months"
        :key="m.month"
      >
        <td>{{ MONTHS[i] }}</td><td>{{ pct(m.avgRatio) }}</td><td>{{ pct(m.planRatio) }}</td><td>{{ pct(m.peakRatio) }}</td>
      </tr>
    </table>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
}

.legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.legend span,
.tip span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.key {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}

.key-approved { background: var(--chart-approved); }
.key-pending { background: var(--chart-pending); }
.key-threshold { height: 0; border-top: 2px dashed var(--color-danger); border-radius: 0; width: 14px; }

.plot {
  position: relative;
}

svg {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}

.grid line {
  stroke: var(--chart-grid);
  stroke-width: 1;
}

.grid text,
.axis {
  font-size: 10.5px;
  fill: var(--color-text-soft);
  font-variant-numeric: tabular-nums;
}

.baseline {
  stroke: var(--color-border-strong);
  stroke-width: 1;
}

.threshold {
  stroke: var(--color-danger);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
}

.bar-approved { fill: var(--chart-approved); }
.bar-pending { fill: var(--chart-pending); }

.hit {
  fill: transparent;
}

g:hover .hit {
  fill: var(--color-hover);
  opacity: 0.6;
}

.tip {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-2);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 2;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
