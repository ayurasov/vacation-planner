// Отображение людей: инициалы, цвет аватара, краткое ФИО. Цвет детерминирован по имени.

const AVATAR_COLORS = ['#4f7cff', '#2fa96b', '#e8a13a', '#8e6fc1', '#e5484d', '#14a3a3', '#d9578b', '#5b6b8c'];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** «Юрасов Александр Валерьевич» → «Юрасов А. В.» */
export function shortName(name: string): string {
  const [last, first, middle] = name.trim().split(/\s+/);
  if (!first) return last ?? '';
  return `${last} ${first[0]}.${middle ? ` ${middle[0]}.` : ''}`;
}
