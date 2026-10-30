// Настоящие руководства (копия docs/manuals в guide/content): разбираются, рисунки из сборки,
// якоря ссылок и знаков «?» существуют.
import { describe, expect, it } from 'vitest';
import { GUIDES, loadGuide, resolveGuideImage } from './guides';
import { GUIDE_PATHS, HELP_TOPICS, helpLocation, type GuideKey, type HelpTarget, type HelpTopic } from './help';
import type { Block, Inline } from './markdown';

const KEYS: GuideKey[] = ['user', 'admin'];

function walk(blocks: Block[], visit: (block: Block) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.type === 'blockquote') walk(block.children, visit);
  }
}

function inlineLinks(nodes: Inline[]): string[] {
  return nodes.flatMap((node) => (node.type === 'link' ? [node.href, ...inlineLinks(node.children)] : 'children' in node ? inlineLinks(node.children) : []));
}

function links(blocks: Block[]): string[] {
  const out: string[] = [];
  walk(blocks, (block) => {
    if (block.type === 'heading' || block.type === 'paragraph') out.push(...inlineLinks(block.children));
    if (block.type === 'table') for (const row of [block.head, ...block.rows]) for (const cell of row) out.push(...inlineLinks(cell));
    if (block.type === 'list') {
      const items = (list: typeof block): void => list.items.forEach((item) => { out.push(...inlineLinks(item.children)); item.lists.forEach(items); });
      items(block);
    }
  });
  return out;
}

describe.each(KEYS)('руководство «%s» в приложении', (key) => {
  const doc = loadGuide(key);

  it('разбирается: главы с уникальными якорями, оглавление начинается с «О руководстве»', () => {
    const ids = doc.headings.map((heading) => heading.id);
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.headings[0]).toEqual({ level: 1, id: 'о-руководстве', text: 'О руководстве' });
    expect(doc.blocks.some((block) => block.type === 'table')).toBe(true);
  });

  it('каждый рисунок — файл сборки с размерами', () => {
    const figures: Array<Extract<Block, { type: 'figure' }>> = [];
    walk(doc.blocks, (block) => { if (block.type === 'figure') figures.push(block); });
    expect(figures.length).toBeGreaterThan(5);
    for (const figure of figures) {
      expect(figure.image, `рисунок ${figure.src} не найден в сборке — npm run guide:sync`).not.toBeNull();
      expect(figure.image?.url).toMatch(/\.png$/);
      expect(figure.image?.width).toBeGreaterThan(0);
      expect(figure.image?.height).toBeGreaterThan(0);
      expect(figure.alt, `у рисунка ${figure.src} нет подписи`).not.toBe('');
    }
  });

  it('ссылки внутри руководства ведут на существующие главы', () => {
    const ids = new Set(doc.headings.map((heading) => heading.id));
    for (const href of links(doc.blocks).filter((link) => link.startsWith('#'))) {
      expect(ids.has(href.slice(1)), `нет главы ${href}`).toBe(true);
    }
  });

  it('PDF — файл сборки; имя для скачивания латиницей с версией', () => {
    expect(GUIDES[key].pdfUrl).toMatch(/\.pdf$/);
    expect(GUIDES[key].pdfName).toMatch(/^planirovshchik-otpuskov-\d+\.\d+\.\d+-rukovodstvo-(polzovatelya|administratora)\.pdf$/);
    expect(GUIDES[key].path).toBe(GUIDE_PATHS[key]);
  });
});

describe('контекстная справка «?»', () => {
  it.each(Object.keys(HELP_TOPICS) as HelpTopic[])('%s ведёт на существующую главу с той же подписью', (topic) => {
    const target: HelpTarget = HELP_TOPICS[topic];
    const heading = loadGuide(target.guide).headings.find((item) => item.id === target.slug);
    expect(heading, `в руководстве «${target.guide}» нет главы #${target.slug}`).toBeDefined();
    expect(heading?.text).toBe(target.section);
    expect(helpLocation(topic)).toEqual({ path: GUIDE_PATHS[target.guide], hash: `#${target.slug}` });
  });

  it('руководство пользователя рассказывает о себе: поиск, «?», PDF', () => {
    const doc = loadGuide('user');
    const index = doc.blocks.findIndex((block) => block.type === 'heading' && block.id === 'руководство-в-приложении');
    expect(index).toBeGreaterThan(0);
    const text = JSON.stringify(doc.blocks.slice(index, index + 4));
    for (const phrase of ['Найти в руководстве', '«?»', 'Открыть PDF', 'Скачать PDF', 'Перейти к разделу']) expect(text).toContain(phrase);
  });
});

describe('рисунки руководств', () => {
  it('только из docs/images; внешние адреса и чужие пути не подставляются', () => {
    expect(resolveGuideImage('../images/ui-login.png')).toMatchObject({ width: 2160, height: 1350 });
    for (const src of ['https://example.ru/ui-login.png', '/etc/ui-login.png', '../images/../secret.png', '../images/нет-такого.png', 'ui-login.png']) {
      expect(resolveGuideImage(src), src).toBeNull();
    }
  });
});
