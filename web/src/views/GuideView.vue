<script setup lang="ts">
// Руководство внутри приложения (v1.1.0, E71): тот же документ, что в PDF (docs/manuals),
// с оглавлением, поиском по разделам, якорями (/guide#раздел) и увеличением рисунков.
// Текст разбирается в дерево (guide/markdown.ts) и рисуется функциями Vue (guide/render.ts) — без v-html.
// Кадровой службе и администратору — ещё и руководство администратора (/guide/admin).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import AppIcon from '@/components/common/AppIcon.vue';
import { vDialog } from '@/directives/dialog';
import { GUIDES, loadGuide } from '@/guide/guides';
import type { GuideKey } from '@/guide/help';
import { GuideArticle, type ZoomImage } from '@/guide/render';
import { guideSections, searchSections } from '@/guide/search';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const key = computed<GuideKey>(() => (route.meta.guide === 'admin' ? 'admin' : 'user'));
const info = computed(() => GUIDES[key.value]);
const doc = computed(() => loadGuide(key.value));
const sections = computed(() => guideSections(doc.value));
const other = computed(() => (auth.isStaff ? GUIDES[key.value === 'user' ? 'admin' : 'user'] : null));
const subtitle = computed(() => `Версия ${__APP_VERSION__} · ${info.value.subtitle}`);

const rootEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const query = ref('');
const activeId = ref('');
const zoomed = ref<ZoomImage | null>(null);

const toc = computed(() => doc.value.headings.filter((heading) => heading.level <= 2));
const searching = computed(() => query.value.trim() !== '');
const tocItems = computed(() => (searching.value
  ? searchSections(sections.value, query.value)
  : toc.value.map((heading) => ({ ...heading, parent: null }))));

// В оглавлении подсвечивается раздел, в который входит текущий подраздел
const activeTocId = computed(() => {
  const headings = doc.value.headings;
  for (let i = headings.findIndex((heading) => heading.id === activeId.value); i >= 0; i--) {
    if (headings[i].level <= 2) return headings[i].id;
  }
  return headings[0]?.id ?? '';
});

function idFromHash(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function go(id: string): void {
  const target = document.getElementById(id);
  if (!target || !contentEl.value?.contains(target)) return;
  target.scrollIntoView({ block: 'start' });
  activeId.value = id;
  // Адрес главы можно скопировать и переслать; replace — «Назад» уводит со страницы, а не по главам
  if (route.hash !== `#${id}`) void router.replace({ path: route.path, hash: `#${id}` });
}

function onSelect(event: Event): void {
  go((event.target as HTMLSelectElement).value);
}

function closeZoom(): void {
  zoomed.value = null;
}

// Текущий раздел — первый заголовок в верхней трети экрана; если там пусто и заголовок ушёл вниз
// (читатель листает вверх) — предыдущий раздел
let observer: IntersectionObserver | null = null;
function observeHeadings(): void {
  observer?.disconnect();
  observer = null;
  const root = contentEl.value;
  if (!root || typeof IntersectionObserver === 'undefined') return;
  const order = doc.value.headings.map((heading) => heading.id);
  const visible = new Set<string>();
  observer = new IntersectionObserver((entries) => {
    let above = '';
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).id;
      if (entry.isIntersecting) visible.add(id);
      else {
        visible.delete(id);
        if (entry.rootBounds && entry.boundingClientRect.top >= entry.rootBounds.bottom) above = order[Math.max(order.indexOf(id) - 1, 0)];
      }
    }
    const first = order.find((id) => visible.has(id));
    if (first) activeId.value = first;
    else if (above) activeId.value = above;
  }, { rootMargin: '0px 0px -70% 0px' });
  root.querySelectorAll('h2[id], h3[id], h4[id], h5[id], h6[id]').forEach((heading) => observer?.observe(heading));
}

onMounted(async () => {
  await nextTick();
  observeHeadings();
  const id = idFromHash(route.hash);
  if (id) go(id);
});

// Переход по ссылке на главу, «Назад» к другой главе, смена руководства — после обновления DOM
watch(() => [key.value, route.hash] as const, ([guide, hash], [previous]) => {
  const switched = guide !== previous;
  if (switched) {
    query.value = '';
    zoomed.value = null;
    activeId.value = '';
    observeHeadings();
  }
  const id = idFromHash(hash);
  if (id && (switched || id !== activeId.value)) go(id);
  else if (switched) rootEl.value?.scrollIntoView({ block: 'start' });
}, { flush: 'post' });

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div
    ref="rootEl"
    class="guide"
  >
    <div class="view-header">
      <div class="guide-heading">
        <span class="guide-mark">
          <AppIcon
            name="book"
            :size="20"
          />
        </span>
        <div>
          <div class="view-title">
            {{ info.title }}
          </div>
          <div class="view-subtitle">
            {{ subtitle }}
          </div>
        </div>
      </div>
      <div class="toolbar guide-actions">
        <router-link
          v-if="other"
          :to="other.path"
          class="btn btn-sm"
        >
          <AppIcon
            name="book"
            :size="14"
          />
          {{ other.title }}
        </router-link>
        <a
          class="btn btn-sm"
          :href="info.pdfUrl"
          target="_blank"
          rel="noopener"
        >
          <AppIcon
            name="external"
            :size="14"
          />
          Открыть PDF
        </a>
        <a
          class="btn btn-sm btn-primary"
          :href="info.pdfUrl"
          :download="info.pdfName"
          data-testid="guide-download"
        >
          <AppIcon
            name="download"
            :size="14"
          />
          Скачать PDF
        </a>
      </div>
    </div>

    <div class="guide-layout">
      <nav
        class="guide-toc card scroll-thin"
        aria-label="Содержание руководства"
      >
        <label class="input-icon guide-search">
          <AppIcon
            name="search"
            :size="14"
          />
          <input
            v-model="query"
            class="input"
            type="search"
            placeholder="Найти в руководстве"
            aria-label="Найти в руководстве"
          >
        </label>
        <p
          v-if="searching && !tocItems.length"
          class="guide-toc-empty"
          role="status"
        >
          Ничего не найдено
        </p>
        <ul>
          <li
            v-for="item in tocItems"
            :key="item.id"
            :class="[`toc-level-${item.level}`, { active: !searching && item.id === activeTocId }]"
          >
            <a
              :href="`#${item.id}`"
              :aria-current="!searching && item.id === activeTocId ? 'location' : undefined"
              @click.prevent="go(item.id)"
            >
              <span
                v-if="item.parent"
                class="toc-parent"
              >{{ item.parent }}</span>
              {{ item.text }}
            </a>
          </li>
        </ul>
      </nav>

      <div class="guide-main">
        <select
          class="input guide-toc-mobile"
          :value="activeTocId"
          aria-label="Перейти к разделу"
          @change="onSelect"
        >
          <option
            v-for="heading in toc"
            :key="heading.id"
            :value="heading.id"
          >
            {{ heading.level === 2 ? '— ' : '' }}{{ heading.text }}
          </option>
        </select>
        <div
          ref="contentEl"
          class="card guide-card"
        >
          <GuideArticle
            :key="key"
            :blocks="doc.blocks"
            @anchor="go"
            @zoom="zoomed = $event"
          />
        </div>
      </div>
    </div>

    <div
      v-if="zoomed"
      v-dialog="closeZoom"
      class="guide-zoom"
      role="dialog"
      aria-modal="true"
      :aria-label="zoomed.alt || 'Рисунок'"
      @click="closeZoom"
    >
      <img
        :src="zoomed.src"
        :alt="zoomed.alt"
      >
      <p v-if="zoomed.alt">
        {{ zoomed.alt }}
      </p>
      <button
        type="button"
        class="btn btn-sm guide-zoom-close"
        autofocus
      >
        <AppIcon
          name="close"
          :size="14"
        />
        Закрыть
      </button>
    </div>
  </div>
</template>

<style scoped>
.guide {
  max-width: 1240px;
  margin: 0 auto;
}

.guide-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.guide-mark {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.guide-layout {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

/* ── Оглавление ── */
.guide-toc {
  position: sticky;
  top: 12px;
  max-height: calc(100dvh - var(--topbar-height) - 24px);
  overflow-y: auto;
  padding: 12px 10px;
}

.guide-search {
  margin-bottom: 8px;
}

.guide-search .input {
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: 13px;
}

.guide-toc ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.guide-toc li a {
  display: block;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.35;
}

.guide-toc li a:hover {
  background: var(--color-hover);
}

.guide-toc .toc-level-1 {
  margin-top: 4px;
}

.guide-toc .toc-level-1 a {
  font-weight: 600;
}

.guide-toc .toc-level-2 a {
  padding-left: 20px;
  color: var(--color-text-muted);
}

.guide-toc .toc-level-3 a {
  padding-left: 30px;
  color: var(--color-text-muted);
  font-size: 12.5px;
}

.guide-toc li.active a {
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}

.toc-parent {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-soft);
}

.guide-toc-empty {
  margin: 8px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.guide-toc-mobile {
  display: none;
}

/* ── Текст ── */
.guide-card {
  padding: 4px 40px 36px;
}

.guide-card :deep(.guide-content) {
  max-width: 860px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--color-text);
}

.guide-card :deep(:is(h2, h3, h4, h5, h6)) {
  scroll-margin-top: 16px;
}

.guide-card :deep(.guide-h1) {
  font-size: 21px;
  margin: 34px 0 12px;
  padding-top: 24px;
  border-top: 1px solid var(--color-border);
}

.guide-card :deep(.guide-h1:first-child) {
  margin-top: 24px;
  padding-top: 0;
  border-top: none;
}

.guide-card :deep(.guide-h2) {
  font-size: 17px;
  margin: 28px 0 10px;
}

.guide-card :deep(.guide-h3) {
  font-size: 15px;
  margin: 22px 0 8px;
}

.guide-card :deep(:is(.guide-h4, .guide-h5, .guide-h6)) {
  font-size: 14px;
  margin: 18px 0 6px;
}

.guide-card :deep(p) {
  margin: 0 0 12px;
}

.guide-card :deep(:is(ul, ol)) {
  margin: 0 0 12px;
  padding-left: 22px;
}

.guide-card :deep(li) {
  margin: 4px 0;
}

.guide-card :deep(li > :is(ul, ol)) {
  margin: 4px 0 0;
}

.guide-card :deep(code) {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background: var(--color-neutral-soft);
  border-radius: 4px;
  padding: 1px 5px;
}

.guide-card :deep(pre) {
  margin: 0 0 14px;
  padding: 10px 12px;
  overflow-x: auto;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.guide-card :deep(pre code) {
  background: none;
  padding: 0;
}

.guide-card :deep(.guide-content a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.guide-card :deep(blockquote) {
  margin: 14px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--color-primary);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--color-primary-soft);
}

.guide-card :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

.guide-card :deep(.guide-table) {
  margin: 0 0 16px;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.guide-card :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.guide-card :deep(:is(th, td)) {
  padding: 7px 12px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--color-border);
}

.guide-card :deep(:is(th, td) + :is(th, td)) {
  border-left: 1px solid var(--color-border);
}

.guide-card :deep(tbody tr:last-child td) {
  border-bottom: none;
}

.guide-card :deep(th) {
  background: var(--color-surface-2);
  font-weight: 600;
}

.guide-card :deep(.align-center) {
  text-align: center;
}

.guide-card :deep(.align-right) {
  text-align: right;
}

.guide-card :deep(hr) {
  margin: 20px 0;
  border: none;
  border-top: 1px solid var(--color-border);
}

/* Рисунки: место резервируется по размерам из images.json — переход к главе не сдвигается при загрузке.
   Высокие снимки (телефон) — не выше трёх четвертей экрана */
.guide-card :deep(figure) {
  margin: 18px 0 22px;
}

.guide-card :deep(.guide-zoom-trigger) {
  display: block;
  width: min(100%, calc(75vh * var(--w, 16) / var(--h, 9)));
  margin: 0 auto;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: none;
  cursor: zoom-in;
}

.guide-card :deep(.guide-zoom-trigger img) {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-1);
}

.guide-card :deep(figcaption) {
  margin-top: 6px;
  text-align: center;
  font-size: 12.5px;
  color: var(--color-text-muted);
}

/* ── Рисунок крупно ── */
.guide-zoom {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 56px 24px 24px;
  background: var(--color-scrim);
  cursor: zoom-out;
  animation: fade-in 0.15s ease;
}

.guide-zoom img {
  max-width: 100%;
  max-height: calc(100% - 40px);
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-3);
}

.guide-zoom p {
  margin: 0;
  color: #fff;
  font-size: 13px;
  text-align: center;
}

.guide-zoom-close {
  position: absolute;
  top: 14px;
  right: 14px;
}

@media (max-width: 900px) {
  .guide-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .guide-toc {
    display: none;
  }

  /* Список глав всегда под рукой: прилипает к верху при прокрутке, глава встаёт под ним */
  .guide-toc-mobile {
    display: block;
    position: sticky;
    top: 0;
    z-index: 5;
    margin-bottom: 12px;
    box-shadow: var(--shadow-2);
  }

  .guide-card :deep(:is(h2, h3, h4, h5, h6)) {
    scroll-margin-top: 60px;
  }

  .guide-card {
    padding: 4px 16px 24px;
  }

  .guide-card :deep(.guide-content) {
    font-size: 13.5px;
  }

  .guide-actions {
    width: 100%;
  }

  .guide-actions .btn {
    flex: 1;
  }
}
</style>
