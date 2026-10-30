// Тексты писем (docs/specs/05-messages.md, раздел «Письма») — чистые функции без БД.

export interface Letter { subject: string; body: string }

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** «1–14 июля 2027», «28 июня – 5 июля 2027», «29 декабря 2026 – 9 января 2027». */
export function fmtRange(start: string, end: string): string {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  if (start === end) return `${d1} ${MONTHS_GEN[m1 - 1]} ${y1}`;
  if (y1 !== y2) return `${d1} ${MONTHS_GEN[m1 - 1]} ${y1} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
  return `${d1}–${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
}

/** Обращение по имени и отчеству: «Иванов Иван Иванович» → «Иван Иванович». */
export function greeting(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 3 ? `${parts[1]} ${parts[2]}` : parts[1] ?? parts[0] ?? '';
}

const FOOTER = (appUrl: string) => [
  '',
  '—',
  'Письмо отправлено планировщиком отпусков автоматически, отвечать на него не нужно.',
  `Отключить письма: ${appUrl}/settings → «Письма о заявках».`,
].join('\n');

const SUBJECTS: Record<string, string> = {
  request_created: 'Заявка на согласование',
  request_approved: 'Отпуск согласован',
  request_rejected: 'Заявка на отпуск отклонена',
  request_cancelled: 'Отпуск удалён',
  request_escalated: 'Заявка ждёт решения',
  request_stalled: 'Заявка без решения',
  delegation_assigned: 'Вам передано согласование заявок',
  account_locked: 'Учётная запись временно заблокирована',
  password_changed: 'Пароль изменён',
  vacation_notice: 'Извещение о начале отпуска',
  planning_open: 'Планирование отпусков',
  planning_reminder: 'Напоминание: запланируйте отпуск',
};

// Куда ведёт ссылка письма — тот же раздел, что открывает щелчок по уведомлению в интерфейсе
const LINKS: Record<string, { path: string; action: string }> = {
  request_created: { path: '/approvals', action: 'Открыть заявки на согласование' },
  request_escalated: { path: '/approvals', action: 'Открыть заявки на согласование' },
  delegation_assigned: { path: '/approvals', action: 'Открыть заявки на согласование' },
  account_locked: { path: '/settings', action: 'Проверить сеансы и сменить пароль' },
  password_changed: { path: '/settings', action: 'Проверить сеансы' },
  request_stalled: { path: '/employees', action: 'Открыть сотрудников' },
};

/** Письмо к уведомлению: тот же текст, что в колокольчике, и ссылка на нужный раздел. */
export function letterFor(kind: string, text: string, recipient: string, appUrl: string): Letter {
  const { path, action } = LINKS[kind] ?? { path: '/my', action: 'Открыть «Мой отпуск»' };
  return {
    subject: `${SUBJECTS[kind] ?? 'Планировщик отпусков'}${kind === 'request_created' ? `: ${text.split(':')[0]}` : ''}`,
    body: [`Здравствуйте, ${greeting(recipient)}!`, '', text, '', `${action}: ${appUrl}${path}`, FOOTER(appUrl)].join('\n'),
  };
}

export interface DigestAbsence { name: string; start: string; end: string }

/** Еженедельная сводка руководителю: кто отсутствует на следующей неделе и что ждёт решения. */
export function digestLetter(input: {
  recipient: string; weekStart: string; weekEnd: string; absences: DigestAbsence[]; pending: number; appUrl: string;
}): Letter | null {
  const { absences, pending } = input;
  if (!absences.length && !pending) return null; // нечего сообщить — письмо не нужно
  const lines = [`Здравствуйте, ${greeting(input.recipient)}!`, ''];
  if (absences.length) {
    lines.push(`На неделе ${fmtRange(input.weekStart, input.weekEnd)} в отпуске ${absences.length} ${plural(absences.length, ['сотрудник', 'сотрудника', 'сотрудников'])}:`);
    for (const a of [...absences].sort((x, y) => x.start.localeCompare(y.start) || x.name.localeCompare(y.name, 'ru'))) {
      const wd = WEEKDAYS[new Date(`${a.start}T00:00:00Z`).getUTCDay()];
      lines.push(`• ${a.name} — ${fmtRange(a.start, a.end)} (с ${wd})`);
    }
  } else {
    lines.push(`На неделе ${fmtRange(input.weekStart, input.weekEnd)} все сотрудники на месте.`);
  }
  if (pending) {
    lines.push('', `Ждут вашего решения: ${pending} ${plural(pending, ['заявка', 'заявки', 'заявок'])} — ${input.appUrl}/approvals`);
  }
  lines.push('', `График отпусков: ${input.appUrl}/schedule`, FOOTER(input.appUrl));
  return { subject: `Отпуска на неделе ${fmtRange(input.weekStart, input.weekEnd)}`, body: lines.join('\n') };
}

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** Повторная попытка: 1, 5, 30 минут, 2 и 12 часов; после шестой — письмо помечается неотправленным. */
export const MAX_ATTEMPTS = 6;
export function backoffMinutes(attempt: number): number {
  return [1, 5, 30, 120, 720][Math.min(attempt, 5) - 1] ?? 720;
}

/**
 * Период еженедельной сводки по местному времени организации: в пятницу с 12:00
 * сводка о следующей неделе (понедельник–воскресенье). Вне окна — null.
 */
export function digestWeek(now: Date, timeZone: string): { weekStart: string; weekEnd: string } | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday !== 'Fri' || Number(parts.hour) < 12) return null;
  const today = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { weekStart: iso(today + 3 * 86400000), weekEnd: iso(today + 9 * 86400000) };
}
