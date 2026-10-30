/**
 * Разбор Markdown руководств (docs/manuals) в типизированное дерево для чтения внутри приложения.
 *
 * Дерево рендерится функциями Vue (guide/render.ts): строки попадают в DOM текстовыми узлами
 * и никогда не разбираются как HTML — `<script>` в тексте остаётся текстом. Поддерживается то,
 * что используют руководства: титульный блок YAML, заголовки с якорями, абзацы, маркированные
 * и нумерованные списки (в том числе вложенные), таблицы, цитаты, рисунки с подписью из
 * альтернативного текста, жирный текст, курсив, код и ссылки — только на якоря внутри документа,
 * http(s) и mailto; остальные ссылки остаются обычным текстом.
 */

export interface GuideImage {
  url: string;
  width?: number;
  height?: number;
}

export type ImageResolver = (src: string) => GuideImage | null;

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  children: Inline[];
  lists: ListBlock[];
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  start: number;
  items: ListItem[];
}

export type Block =
  | { type: 'heading'; level: number; id: string; text: string; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | ListBlock
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'figure'; src: string; alt: string; image: GuideImage | null }
  | { type: 'code'; value: string }
  | { type: 'rule' };

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export interface GuideDocument {
  /** Поля титульного блока YAML (title, subtitle, date…), если он есть. */
  meta: Record<string, string>;
  blocks: Block[];
  /** Все заголовки по порядку — для оглавления и якорей. */
  headings: Heading[];
}

export interface ParseOptions {
  resolveImage?: ImageResolver;
}

/**
 * Якорь заголовка — как в «По Делу»: строчные буквы, без «»"'`*_, всё, кроме букв и цифр, —
 * дефис; кириллица сохраняется. Повторы различает parseMarkdown: -2, -3…
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»"'`*_]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

/** Разрешённые ссылки: якорь внутри документа, http(s), mailto. Иначе — null (ссылка станет текстом). */
export function safeHref(href: string): string | null {
  if (/^#[\p{L}\p{N}_-]+$/u.test(href)) return href;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(href)) return href;
  if (/^mailto:[^\s"'<>]+$/i.test(href)) return href;
  return null;
}

// Экранирование \x, код, рисунок, ссылка, **жирный**, __жирный__, *курсив*, _курсив_ (не внутри слова:
// символ перед «_» захватывается группой, а не ретроспективной проверкой — её нет в Safari до 16.4)
const INLINE = /\\([\\`*_{}[\]()#+\-.!|<>])|`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|(^|[^\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}])/gu;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  const text = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.value += value;
    else out.push({ type: 'text', value });
  };
  let index = 0;
  for (const match of source.matchAll(INLINE)) {
    text(source.slice(index, match.index));
    index = match.index + match[0].length;
    const [, escaped, code, alt, src, label, href, strong, strong2, em, before, em2] = match;
    if (escaped !== undefined) text(escaped);
    else if (code !== undefined) out.push({ type: 'code', value: code });
    // Рисунок внутри текста — подписью: рисунки руководств стоят отдельной строкой (figure)
    else if (src !== undefined) text(alt);
    else if (href !== undefined) {
      const safe = safeHref(href);
      const children = parseInline(label);
      if (safe) out.push({ type: 'link', href: safe, children });
      else for (const child of children) if (child.type === 'text') text(child.value); else out.push(child);
    } else if (strong !== undefined || strong2 !== undefined) out.push({ type: 'strong', children: parseInline(strong ?? strong2) });
    else {
      text(before ?? '');
      out.push({ type: 'em', children: parseInline(em ?? em2) });
    }
  }
  text(source.slice(index));
  return out;
}

/** Текст без разметки: для оглавления, поиска и якорей. */
export function plainText(nodes: Inline[]): string {
  return nodes.map((node) => ('value' in node ? node.value : plainText(node.children))).join('');
}

function frontMatter(lines: string[]): { meta: Record<string, string>; start: number } {
  const meta: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') return { meta, start: 0 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  // Между чертами — только «ключ: значение»: иначе это две горизонтальные линии, а не титульный блок
  if (end === -1 || !lines.slice(1, end).every((line) => !line.trim() || /^[\w-]+:/.test(line))) return { meta, start: 0 };
  for (const line of lines.slice(1, end)) {
    const match = /^([\w-]+):\s*(.*?)\s*$/.exec(line);
    if (match) meta[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, start: end + 1 };
}

const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const RULE = /^(?:-[ \t]*){3,}$|^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$/;
const FIGURE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;
const FENCE = /^(`{3,}|~{3,})/;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;

interface Marker { indent: number; ordered: boolean; start: number; text: string }

function listMarker(line: string): Marker | null {
  const match = LIST_ITEM.exec(line.replace(/\t/g, '    '));
  if (!match) return null;
  return { indent: match[1].length, ordered: match[2] === undefined, start: match[3] ? Number(match[3]) : 1, text: match[4] };
}

const indentOf = (line: string) => line.replace(/\t/g, '    ').search(/\S/);

/** Ячейки строки таблицы: крайние «|» необязательны, «\|» — символ внутри ячейки. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  const row = line.trim().replace(/^\|/, '');
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') { cell += '|'; i++; }
    else if (row[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += row[i];
  }
  if (cell.trim() || !row.endsWith('|')) cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** Разбирает документ: дерево блоков, заголовки с уникальными якорями и титульный блок. */
export function parseMarkdown(source: string, options: ParseOptions = {}): GuideDocument {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const { meta, start } = frontMatter(lines);
  const headings: Heading[] = [];
  const used = new Set<string>();

  const uniqueId = (text: string) => {
    const base = slugify(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };

  function parseList(rows: string[], from: number): { block: ListBlock; next: number } {
    const first = listMarker(rows[from]) as Marker;
    const block: ListBlock = { type: 'list', ordered: first.ordered, start: first.start, items: [] };
    const texts: string[][] = [];
    let i = from;
    while (i < rows.length) {
      const line = rows[i];
      if (!line.trim()) {
        // Пустая строка между пунктами не разрывает список
        let j = i + 1;
        while (j < rows.length && !rows[j].trim()) j++;
        const ahead = j < rows.length ? listMarker(rows[j]) : null;
        if (ahead && ahead.indent === first.indent && ahead.ordered === first.ordered) { i = j; continue; }
        break;
      }
      const marker = listMarker(line);
      const current = block.items[block.items.length - 1];
      if (marker && marker.indent <= first.indent + 1 && marker.indent >= first.indent) {
        if (marker.ordered !== first.ordered) break;
        block.items.push({ children: [], lists: [] });
        texts.push([marker.text]);
        i++;
      } else if (marker && marker.indent > first.indent && current) {
        const nested = parseList(rows, i);
        current.lists.push(nested.block);
        i = nested.next;
      } else if (!marker && current && !current.lists.length && indentOf(line) > first.indent) {
        texts[texts.length - 1].push(line.trim()); // продолжение пункта на следующей строке
        i++;
      } else break;
    }
    block.items.forEach((item, index) => { item.children = parseInline(texts[index].join(' ')); });
    return { block, next: i };
  }

  function parseBlocks(rows: string[]): Block[] {
    const blocks: Block[] = [];
    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
      paragraph = [];
    };

    for (let i = 0; i < rows.length; i++) {
      const line = rows[i];
      const trimmed = line.trim();
      if (!trimmed) { flush(); continue; }

      const fence = FENCE.exec(trimmed);
      if (fence) {
        flush();
        const code: string[] = [];
        for (i++; i < rows.length && !rows[i].trim().startsWith(fence[1]); i++) code.push(rows[i]);
        blocks.push({ type: 'code', value: code.join('\n') });
        continue;
      }

      const heading = HEADING.exec(trimmed);
      if (heading) {
        flush();
        const children = parseInline(heading[2]);
        const text = plainText(children);
        const block = { type: 'heading' as const, level: heading[1].length, id: uniqueId(text), text, children };
        headings.push({ level: block.level, id: block.id, text });
        blocks.push(block);
        continue;
      }

      if (RULE.test(trimmed)) { flush(); blocks.push({ type: 'rule' }); continue; }

      const figure = FIGURE.exec(trimmed);
      if (figure) {
        flush();
        const [, alt, src] = figure;
        blocks.push({ type: 'figure', src, alt, image: options.resolveImage?.(src) ?? null });
        continue;
      }

      if (trimmed.includes('|') && TABLE_SEPARATOR.test(rows[i + 1]?.trim() ?? '')) {
        flush();
        const head = splitRow(trimmed);
        const align = splitRow(rows[i + 1]).map(alignOf);
        const body: Inline[][][] = [];
        for (i += 2; i < rows.length && rows[i].trim() && rows[i].includes('|'); i++) {
          const cells = splitRow(rows[i]);
          body.push(head.map((_, index) => parseInline(cells[index] ?? '')));
        }
        i--;
        blocks.push({ type: 'table', align: head.map((_, index) => align[index] ?? null), head: head.map((cell) => parseInline(cell)), rows: body });
        continue;
      }

      if (trimmed.startsWith('>')) {
        flush();
        const quoted: string[] = [];
        for (; i < rows.length && rows[i].trim().startsWith('>'); i++) quoted.push(rows[i].trim().replace(/^>\s?/, ''));
        i--;
        blocks.push({ type: 'blockquote', children: parseBlocks(quoted) });
        continue;
      }

      // Список прерывает абзац; нумерованный — только с «1.», как в CommonMark
      const marker = listMarker(line);
      if (marker && (!paragraph.length || !marker.ordered || marker.start === 1)) {
        flush();
        const { block, next } = parseList(rows, i);
        blocks.push(block);
        i = next - 1;
        continue;
      }

      paragraph.push(trimmed);
    }
    flush();
    return blocks;
  }

  return { meta, blocks: parseBlocks(lines.slice(start)), headings };
}
