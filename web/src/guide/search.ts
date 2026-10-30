// Поиск по руководству: разделы с заголовком уровня ≤ 3 и текстом до следующего такого заголовка.
import { plainText, type Block, type GuideDocument, type Heading, type ListBlock } from './markdown';

export interface Section extends Heading {
  /** Заголовок раздела верхнего уровня — подсказка в результатах поиска («Команда» для «Сегодня»). */
  parent: string | null;
  /** Заголовок и текст раздела в нормализованном виде — для сравнения со строкой поиска. */
  haystack: string;
}

/** Строчные буквы, «ё» как «е», одиночные пробелы: «Учет» находит «учёт». */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function listText(list: ListBlock): string {
  return list.items.map((item) => [plainText(item.children), ...item.lists.map(listText)].join(' ')).join(' ');
}

function blockText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return plainText(block.children);
    case 'list':
      return listText(block);
    case 'table':
      return [block.head, ...block.rows].map((row) => row.map(plainText).join(' ')).join(' ');
    case 'blockquote':
      return block.children.map(blockText).join(' ');
    case 'figure':
      return block.alt;
    case 'code':
      return block.value;
    default:
      return '';
  }
}

export function guideSections(doc: GuideDocument, maxLevel = 3): Section[] {
  const sections: Array<Section & { body: string[] }> = [];
  const parents: Heading[] = [];
  for (const block of doc.blocks) {
    if (block.type === 'heading' && block.level <= maxLevel) {
      while (parents.length && parents[parents.length - 1].level >= block.level) parents.pop();
      sections.push({ level: block.level, id: block.id, text: block.text, parent: parents[0]?.text ?? null, haystack: '', body: [block.text] });
      parents.push(block);
    } else {
      sections[sections.length - 1]?.body.push(blockText(block));
    }
  }
  return sections.map(({ body, ...section }) => ({ ...section, haystack: normalize(body.join(' ')) }));
}

/** Разделы, где встречаются все слова запроса — в заголовке или в тексте. */
export function searchSections(sections: Section[], query: string): Section[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return sections;
  return sections.filter((section) => words.every((word) => section.haystack.includes(word)));
}
