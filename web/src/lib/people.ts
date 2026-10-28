// Отображение людей: инициалы, цвет аватара, краткое ФИО. Цвет детерминирован по имени.

// Белые инициалы читаются на каждом цвете: контраст не ниже 4,5:1 (аудит v0.5.0)
const AVATAR_COLORS = ['#3569ff', '#258554', '#a46913', '#8766bd', '#e12d33', '#108383', '#d23a77', '#5b6b8c'];

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
