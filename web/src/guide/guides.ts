// Руководства внутри приложения (E71): текст, рисунки и PDF — копия docs/ в guide/content
// (npm run guide:sync). Рисунки и PDF — отдельные файлы сборки с хешем в имени: грузятся по мере
// прокрутки и кешируются; Markdown входит в отложенно загружаемый модуль страницы руководства.
import userSource from './content/user-guide.md?raw';
import adminSource from './content/admin-guide.md?raw';
import userPdf from './content/user-guide.pdf?url';
import adminPdf from './content/admin-guide.pdf?url';
import imageSizes from './content/images.json';
import { parseMarkdown, type GuideDocument, type GuideImage } from './markdown';
import { GUIDE_PATHS, type GuideKey } from './help';

const imageUrls = import.meta.glob<string>('./content/images/*.{png,jpg,jpeg,svg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const sizes: Record<string, number[] | undefined> = imageSizes;

export interface GuideInfo {
  key: GuideKey;
  title: string;
  /** Подзаголовок — как на обложке PDF (tools/docs/build_docs.py). */
  subtitle: string;
  path: string;
  pdfUrl: string;
  /** Имя скачиваемого PDF — латиницей: кириллицу в имени файла принимают не все браузеры. */
  pdfName: string;
  source: string;
}

const version = __APP_VERSION__;

export const GUIDES: Record<GuideKey, GuideInfo> = {
  user: {
    key: 'user',
    title: 'Руководство пользователя',
    subtitle: 'Сотрудник и руководитель',
    path: GUIDE_PATHS.user,
    pdfUrl: userPdf,
    pdfName: `planirovshchik-otpuskov-${version}-rukovodstvo-polzovatelya.pdf`,
    source: userSource,
  },
  admin: {
    key: 'admin',
    title: 'Руководство администратора',
    subtitle: 'Сотрудники, справочники, настройки и аудит',
    path: GUIDE_PATHS.admin,
    pdfUrl: adminPdf,
    pdfName: `planirovshchik-otpuskov-${version}-rukovodstvo-administratora.pdf`,
    source: adminSource,
  },
};

/** Рисунок руководства «../images/ui-login.png» → адрес в сборке и размеры; чужие пути — null. */
export function resolveGuideImage(src: string): GuideImage | null {
  const file = /^(?:\.\.\/)?images\/([\w.-]+)$/.exec(src)?.[1];
  const url = file ? imageUrls[`./content/images/${file}`] : undefined;
  if (!file || !url) return null;
  const [width, height] = sizes[file] ?? [];
  return width && height ? { url, width, height } : { url };
}

const parsed = new Map<GuideKey, GuideDocument>();

/** Разобранное руководство; разбор — один раз за сеанс. */
export function loadGuide(key: GuideKey): GuideDocument {
  let doc = parsed.get(key);
  if (!doc) {
    doc = parseMarkdown(GUIDES[key].source, { resolveImage: resolveGuideImage });
    parsed.set(key, doc);
  }
  return doc;
}
