// Показ дерева руководства (guide/markdown.ts) функциями отрисовки Vue — без v-html.
// Строки из документа передаются в h() детьми-строками и становятся текстовыми узлами DOM;
// атрибуты — только href из белого списка (safeHref) и адреса рисунков из сборки.
import { defineComponent, h, type PropType, type VNode, type VNodeArrayChildren } from 'vue';
import type { Align, Block, Inline, ListBlock } from './markdown';

export interface ZoomImage {
  src: string;
  alt: string;
}

/** Заголовок документа «#» — h2: h1 страницы — название раздела в верхней панели. */
const HEADING_OFFSET = 1;

export const GuideArticle = defineComponent({
  name: 'GuideArticle',
  props: {
    blocks: { type: Array as PropType<Block[]>, required: true },
  },
  emits: {
    /** Ссылка на якорь внутри документа. */
    anchor: (id: string) => typeof id === 'string',
    /** Щелчок по рисунку — показать крупно. */
    zoom: (image: ZoomImage) => typeof image.src === 'string',
  },
  setup(props, { emit }) {
    function inline(nodes: Inline[]): VNodeArrayChildren {
      return nodes.map((node) => {
        switch (node.type) {
          case 'text':
            return node.value;
          case 'strong':
            return h('strong', inline(node.children));
          case 'em':
            return h('em', inline(node.children));
          case 'code':
            return h('code', node.value);
          case 'link': {
            if (node.href.startsWith('#')) {
              const id = node.href.slice(1);
              return h('a', { href: node.href, onClick: (event: MouseEvent) => { event.preventDefault(); emit('anchor', id); } }, inline(node.children));
            }
            const external = !node.href.toLowerCase().startsWith('mailto:');
            return h('a', external ? { href: node.href, target: '_blank', rel: 'noopener noreferrer' } : { href: node.href }, inline(node.children));
          }
        }
      });
    }

    const cellAttrs = (align: Align) => (align ? { class: `align-${align}` } : null);

    function list(node: ListBlock): VNode {
      const items = node.items.map((item) => h('li', [...inline(item.children), ...item.lists.map(list)]));
      return node.ordered ? h('ol', node.start !== 1 ? { start: node.start } : null, items) : h('ul', items);
    }

    function block(node: Block): VNode | null {
      switch (node.type) {
        case 'heading':
          return h(`h${Math.min(node.level + HEADING_OFFSET, 6)}`, { id: node.id, class: `guide-h${node.level}` }, inline(node.children));
        case 'paragraph':
          return h('p', inline(node.children));
        case 'list':
          return list(node);
        case 'table':
          return h('div', { class: 'guide-table scroll-thin' }, [
            h('table', [
              h('thead', [h('tr', node.head.map((cell, index) => h('th', cellAttrs(node.align[index]), inline(cell))))]),
              h('tbody', node.rows.map((row) => h('tr', row.map((cell, index) => h('td', cellAttrs(node.align[index]), inline(cell)))))),
            ]),
          ]);
        case 'blockquote':
          return h('blockquote', node.children.map(block));
        case 'figure': {
          // Рисунок не из сборки (внешний адрес, опечатка в пути) не показывается: тест руководства это ловит
          const image = node.image;
          if (!image) return null;
          // Размеры из images.json: браузер резервирует место до загрузки, ширина кнопки — по пропорции
          const sized = Boolean(image.width && image.height);
          return h('figure', [
            h('button', {
              type: 'button',
              class: 'guide-zoom-trigger',
              style: sized ? { '--w': image.width, '--h': image.height } : undefined,
              'aria-label': node.alt ? `Увеличить рисунок: ${node.alt}` : 'Увеличить рисунок',
              onClick: () => emit('zoom', { src: image.url, alt: node.alt }),
            }, [h('img', {
              src: image.url,
              alt: node.alt,
              loading: 'lazy',
              decoding: 'async',
              ...(sized ? { width: image.width, height: image.height } : {}),
            })]),
            node.alt ? h('figcaption', node.alt) : null,
          ]);
        }
        case 'code':
          return h('pre', { class: 'scroll-thin' }, [h('code', node.value)]);
        case 'rule':
          return h('hr');
      }
    }

    return () => h('article', { class: 'guide-content' }, props.blocks.map(block));
  },
});
