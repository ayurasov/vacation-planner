import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parseInline, parseMarkdown, safeHref, slugify, type Block, type ParseOptions } from './markdown';
import { GuideArticle } from './render';
import { guideSections, normalize, searchSections } from './search';

/** HTML, который получит браузер: дерево → функции отрисовки Vue (без DOM — серверный рендер Vue). */
async function render(markdown: string, options: ParseOptions = {}): Promise<string> {
  const { blocks } = parseMarkdown(markdown, options);
  return renderToString(createSSRApp({ render: () => h(GuideArticle, { blocks }) }));
}

const resolveImage = (src: string) => (src === '../images/ui-login.png' ? { url: '/assets/ui-login-abc123.png', width: 2160, height: 1350 } : null);

describe('руководство: якоря заголовков', () => {
  it('как в «По Делу»: строчные, без кавычек и звёздочек, кириллица сохраняется', () => {
    expect(slugify('График отпусков')).toBe('график-отпусков');
    expect(slugify('Согласование заявок (руководителям)')).toBe('согласование-заявок-руководителям');
    expect(slugify('Кадровый учёт')).toBe('кадровый-учёт');
    expect(slugify('«Мой» отпуск')).toBe('мой-отпуск');
    expect(slugify('**Жирный** `код` и snake_case')).toBe('жирный-код-и-snakecase');
    expect(slugify('Версия 1.0.0 — что нового?')).toBe('версия-1-0-0-что-нового');
    expect(slugify('!!!')).toBe('section');
  });

  it('повторы получают -2, -3; якорь из текста без разметки', () => {
    const doc = parseMarkdown('# Итоги\n\n## Итоги\n\n# **Итоги**\n\n# Итоги 2\n\n# Итоги-2');
    expect(doc.headings.map((heading) => heading.id)).toEqual(['итоги', 'итоги-2', 'итоги-3', 'итоги-2-2', 'итоги-2-3']);
    expect(doc.headings.map((heading) => heading.level)).toEqual([1, 2, 1, 1, 1]);
    expect(doc.headings[2].text).toBe('Итоги');
  });

  it('заголовок «#» — h2 с якорем: h1 страницы — название раздела в верхней панели', async () => {
    const html = await render('# Мой отпуск\n\n## Новая заявка');
    expect(html).toContain('<h2 id="мой-отпуск" class="guide-h1">Мой отпуск</h2>');
    expect(html).toContain('<h3 id="новая-заявка" class="guide-h2">Новая заявка</h3>');
  });
});

describe('руководство: текст не становится HTML', () => {
  it('теги в тексте — текст: и в дереве, и в отрисовке', async () => {
    const source = 'До <script>alert(1)</script> & <img src=x onerror=alert(2)> после';
    expect(parseInline(source)).toEqual([{ type: 'text', value: source }]);
    const html = await render(`${source}\n\n# <b>Заголовок</b>\n\n| <i>x</i> |\n|---|\n| <u>y</u> |`);
    expect(html).toContain('До &lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(2)&gt; после');
    expect(html).toContain('&lt;b&gt;Заголовок&lt;/b&gt;');
    expect(html).toContain('<th>&lt;i&gt;x&lt;/i&gt;</th>');
    expect(html).not.toMatch(/<(script|b|i|u)>/);
    expect(html).not.toMatch(/<img src=x/);
  });

  it('кавычки в подписи рисунка не выходят из атрибута', async () => {
    const html = await render('![Вход" onerror="alert(1)](../images/ui-login.png)', {
      resolveImage: () => ({ url: '/assets/a.png' }),
    });
    // Атрибут цел: за alt сразу следует loading — кавычка из подписи его не закрыла
    expect(html).toContain('<img src="/assets/a.png" alt="Вход&quot; onerror=&quot;alert(1)" loading="lazy"');
  });
});

describe('руководство: ссылки', () => {
  it('белый список: якорь, http(s), mailto', () => {
    expect(safeHref('#график-отпусков')).toBe('#график-отпусков');
    expect(safeHref('https://example.ru/a?b=1')).toBe('https://example.ru/a?b=1');
    expect(safeHref('http://example.ru')).toBe('http://example.ru');
    expect(safeHref('mailto:hr@example.ru')).toBe('mailto:hr@example.ru');
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', 'ftp://example.ru', '/guide', '../docs/a.md', '#', '#a"b']) {
      expect(safeHref(href), href).toBeNull();
    }
  });

  it('неразрешённая ссылка — обычный текст с прежним оформлением', () => {
    expect(parseInline('см. [раздел](javascript:void0) и [**PDF**](file:///etc/passwd)')).toEqual([
      { type: 'text', value: 'см. раздел и ' },
      { type: 'strong', children: [{ type: 'text', value: 'PDF' }] },
    ]);
  });

  it('внешние — в новой вкладке без opener, mailto и якоря — без target', async () => {
    const html = await render('[Сайт](https://example.ru), [почта](mailto:hr@example.ru), [глава](#мой-отпуск), [скрипт](javascript:void0)');
    expect(html).toContain('<a href="https://example.ru" target="_blank" rel="noopener noreferrer">Сайт</a>');
    expect(html).toContain('<a href="mailto:hr@example.ru">почта</a>');
    expect(html).toContain('<a href="#мой-отпуск">глава</a>');
    expect(html).toContain(', скрипт</p>');
    expect(html).not.toContain('javascript:');
  });
});

describe('руководство: оформление текста', () => {
  it('жирный, курсив, код, экранирование', () => {
    expect(parseInline('**Первый вход.** Пароль *только* для _первого_ входа, логин `ivanov.ii`')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'Первый вход.' }] },
      { type: 'text', value: ' Пароль ' },
      { type: 'em', children: [{ type: 'text', value: 'только' }] },
      { type: 'text', value: ' для ' },
      { type: 'em', children: [{ type: 'text', value: 'первого' }] },
      { type: 'text', value: ' входа, логин ' },
      { type: 'code', value: 'ivanov.ii' },
    ]);
    expect(parseInline('snake_case_name, 2 * 3 * 4, \\*не курсив\\*')).toEqual([{ type: 'text', value: 'snake_case_name, 2 * 3 * 4, *не курсив*' }]);
    expect(parseInline('`**не жирный**`')).toEqual([{ type: 'code', value: '**не жирный**' }]);
  });

  it('абзац из нескольких строк — одна строка; рисунок внутри текста — подписью', () => {
    const { blocks } = parseMarkdown('Первая строка\nвторая строка с ![рисунком](../images/x.png)');
    expect(blocks).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'Первая строка вторая строка с рисунком' }] }]);
  });
});

describe('руководство: блоки', () => {
  it('таблица: заголовок, выравнивание, «\\|» в ячейке, недостающие ячейки', async () => {
    const source = '| Раздел | Для чего | Число |\n|:---|:---:|---:|\n| **График** | Отпуска \\| год | 1 |\n| Только одна |';
    const [table] = parseMarkdown(source).blocks;
    expect(table.type).toBe('table');
    if (table.type !== 'table') return;
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.head.map((cell) => cell[0])).toEqual([{ type: 'text', value: 'Раздел' }, { type: 'text', value: 'Для чего' }, { type: 'text', value: 'Число' }]);
    expect(table.rows[0][0]).toEqual([{ type: 'strong', children: [{ type: 'text', value: 'График' }] }]);
    expect(table.rows[0][1]).toEqual([{ type: 'text', value: 'Отпуска | год' }]);
    expect(table.rows[1]).toEqual([[{ type: 'text', value: 'Только одна' }], [], []]);
    const html = await render(source);
    expect(html).toContain('<div class="guide-table scroll-thin"><table><thead><tr><th class="align-left">Раздел</th><th class="align-center">Для чего</th><th class="align-right">Число</th></tr></thead>');
    expect(html).toContain('<td class="align-center">Отпуска | год</td>');
  });

  it('рисунок отдельной строкой — figure с подписью из alt и размерами; чужой путь не показывается', async () => {
    const source = 'Текст\n![Экран входа](../images/ui-login.png)\n\n![Нет файла](https://example.ru/x.png)';
    const { blocks } = parseMarkdown(source, { resolveImage });
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'figure', 'figure']);
    expect(blocks[1]).toEqual({ type: 'figure', src: '../images/ui-login.png', alt: 'Экран входа', image: { url: '/assets/ui-login-abc123.png', width: 2160, height: 1350 } });
    expect(blocks[2]).toMatchObject({ type: 'figure', image: null });
    const html = await render(source, { resolveImage });
    expect(html).toContain('<figure><button type="button" class="guide-zoom-trigger" style="--w:2160;--h:1350;" aria-label="Увеличить рисунок: Экран входа">');
    expect(html).toContain('<img src="/assets/ui-login-abc123.png" alt="Экран входа" loading="lazy" decoding="async" width="2160" height="1350">');
    expect(html).toContain('<figcaption>Экран входа</figcaption></figure>');
    expect(html).not.toContain('example.ru');
    expect(html.match(/<figure>/g)).toHaveLength(1);
  });

  it('списки: нумерованный с началом, вложенные, продолжение строки, пустая строка между пунктами', async () => {
    const source = '3. Третий\n   продолжение\n4. Четвёртый\n   - вложенный\n   - ещё\n\n5. Пятый\n\n- Отдельный список';
    const { blocks } = parseMarkdown(source);
    expect(blocks.map((block) => block.type)).toEqual(['list', 'list']);
    const [ordered, bullets] = blocks as Array<Extract<Block, { type: 'list' }>>;
    expect(ordered).toMatchObject({ ordered: true, start: 3 });
    expect(ordered.items).toHaveLength(3);
    expect(ordered.items[0].children).toEqual([{ type: 'text', value: 'Третий продолжение' }]);
    expect(ordered.items[1].lists[0]).toMatchObject({ ordered: false, items: [{ children: [{ type: 'text', value: 'вложенный' }] }, { children: [{ type: 'text', value: 'ещё' }] }] });
    expect(bullets).toMatchObject({ ordered: false, items: [{ children: [{ type: 'text', value: 'Отдельный список' }] }] });
    const html = await render(source);
    expect(html).toContain('<ol start="3"><li>Третий продолжение</li><li>Четвёртый<ul><li>вложенный</li><li>ещё</li></ul></li><li>Пятый</li></ol><ul><li>Отдельный список</li></ul>');
  });

  it('список сразу после абзаца прерывает его', () => {
    const { blocks } = parseMarkdown('Планировщик учитывает:\n- отпуска коллег;\n- праздники.');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'list']);
  });

  it('цитата: абзацы и оформление внутри', async () => {
    const html = await render('> Праздники **не входят** в отпуск.\n>\n> Второй абзац.');
    expect(html).toBe('<article class="guide-content"><blockquote><p>Праздники <strong>не входят</strong> в отпуск.</p><p>Второй абзац.</p></blockquote></article>');
  });

  it('код блоком и горизонтальная линия', async () => {
    const html = await render('```\n<b>как есть</b>\n```\n\n---');
    expect(html).toBe('<article class="guide-content"><pre class="scroll-thin"><code>&lt;b&gt;как есть&lt;/b&gt;</code></pre><hr></article>');
  });

  it('титульный блок YAML — в meta; две линии подряд — не титульный блок', () => {
    const doc = parseMarkdown('---\ntitle: "Руководство пользователя"\ndate: 30.10.2026\n---\n# О руководстве');
    expect(doc.meta).toEqual({ title: 'Руководство пользователя', date: '30.10.2026' });
    expect(doc.headings).toEqual([{ level: 1, id: 'о-руководстве', text: 'О руководстве' }]);
    const plain = parseMarkdown('---\nТекст между линиями\n---');
    expect(plain.meta).toEqual({});
    expect(plain.blocks.map((block) => block.type)).toEqual(['rule', 'paragraph', 'rule']);
  });
});

describe('руководство: поиск по разделам', () => {
  const doc = parseMarkdown([
    '# Команда', 'Кто где работает.',
    '## Сегодня', 'Плитки: офис, удалёнка.',
    '#### Мелкий раздел', 'Сводная таблица учёта.',
    '## Аналитика года', '| Показатель |\n|---|\n| Пиковый месяц |',
    '# Кадровый учёт', '> Утверждение графика', '- форма Т-7',
  ].join('\n\n'));
  const sections = guideSections(doc);

  it('разделы уровня ≤ 3 с родителем; текст глубже — в ближайшем разделе', () => {
    expect(sections.map((section) => [section.id, section.parent])).toEqual([
      ['команда', null], ['сегодня', 'Команда'], ['аналитика-года', 'Команда'], ['кадровый-учёт', null],
    ]);
    expect(sections[1].haystack).toContain('мелкий раздел сводная таблица учета');
  });

  it('по заголовку и тексту, без учёта регистра и «ё», все слова запроса', () => {
    const ids = (query: string) => searchSections(sections, query).map((section) => section.id);
    expect(ids('сегодня')).toEqual(['сегодня']);
    expect(ids('УЧЕТ')).toEqual(['сегодня', 'кадровый-учёт']);
    expect(ids('пиковый')).toEqual(['аналитика-года']);
    expect(ids('т-7 утверждение')).toEqual(['кадровый-учёт']);
    expect(ids('офис отпуск')).toEqual([]);
    expect(ids('   ')).toHaveLength(4);
    expect(normalize('  Ёлка   УЧЁТ ')).toBe('елка учет');
  });
});
