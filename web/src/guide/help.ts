// Контекстная справка (E71): знак «?» в заголовке экрана открывает руководство на нужной главе.
// Карта — единственное место с якорями: guides.spec.ts разбирает настоящие руководства и проверяет,
// что каждый якорь существует, а подпись совпадает с заголовком главы. Модуль лёгкий — входит
// в основную сборку вместе с экранами; сами руководства грузятся только на странице руководства.
import type { RouteLocationRaw } from 'vue-router';

export type GuideKey = 'user' | 'admin';

export const GUIDE_PATHS: Record<GuideKey, string> = {
  user: '/guide',
  admin: '/guide/admin',
};

export interface HelpTarget {
  guide: GuideKey;
  /** Якорь главы (slugify заголовка). */
  slug: string;
  /** Заголовок главы — для подписи «Справка: …». */
  section: string;
}

export const HELP_TOPICS = {
  schedule: { guide: 'user', slug: 'график-отпусков', section: 'График отпусков' },
  my: { guide: 'user', slug: 'мой-отпуск', section: 'Мой отпуск' },
  teamToday: { guide: 'user', slug: 'сегодня', section: 'Сегодня' },
  teamYear: { guide: 'user', slug: 'аналитика-года', section: 'Аналитика года' },
  workSchedule: { guide: 'user', slug: 'график-работы', section: 'График работы' },
  approvals: { guide: 'user', slug: 'согласование-заявок-руководителям', section: 'Согласование заявок (руководителям)' },
  settings: { guide: 'user', slug: 'профиль-и-настройки', section: 'Профиль и настройки' },
  // Разделы кадровой службы и администратора описаны в руководстве администратора
  employees: { guide: 'admin', slug: 'сотрудники', section: 'Сотрудники' },
  departments: { guide: 'admin', slug: 'подразделения-и-проекты', section: 'Подразделения и проекты' },
  calendar: { guide: 'admin', slug: 'производственный-календарь', section: 'Производственный календарь' },
  hrPlanning: { guide: 'admin', slug: 'планирование-и-утверждение-графика', section: 'Планирование и утверждение графика' },
  hrNotices: { guide: 'admin', slug: 'извещения-о-начале-отпуска', section: 'Извещения о начале отпуска' },
  audit: { guide: 'admin', slug: 'журнал-аудита', section: 'Журнал аудита' },
  exchange: { guide: 'admin', slug: 'импорт-и-экспорт', section: 'Импорт и экспорт' },
} as const satisfies Record<string, HelpTarget>;

export type HelpTopic = keyof typeof HELP_TOPICS;

/** Адрес главы руководства: /guide#график-отпусков. */
export function helpLocation(topic: HelpTopic): RouteLocationRaw {
  const target: HelpTarget = HELP_TOPICS[topic];
  return { path: GUIDE_PATHS[target.guide], hash: `#${target.slug}` };
}
