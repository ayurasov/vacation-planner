// Подразделения в выпадающих списках (v1.1.0): порядок дерева с отступом по уровню; значение фильтра —
// подпись (у одноимённых — «Отдел — Родитель»), поэтому старые закладки с названием отдела работают.
import type { Department, UnitKind } from '@/api/client';

/** Отступ уровня неразрывными пробелами: в <option> другие способы не работают. */
export const indented = (d: Pick<Department, 'name' | 'level'>) => `${'   '.repeat(Math.max(0, (d.level ?? 1) - 1))}${d.name}`;

/** Подразделение и все вложенные — нельзя выбрать вышестоящим при переносе. */
export function subtreeIds(list: readonly Department[], id: number): Set<number> {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const d of list) if (d.parentId !== null && out.has(d.parentId) && !out.has(d.id)) { out.add(d.id); grew = true; }
  }
  return out;
}

/** Виды уровней по умолчанию — как в «По Делу»; настройка организации их заменяет. */
export const DEFAULT_UNIT_KINDS: UnitKind[] = [
  { value: 'company', label: 'Компания', color: '#7c3aed' },
  { value: 'division', label: 'Дирекция', color: '#0369a1' },
  { value: 'direction', label: 'Направление', color: '#0f766e' },
  { value: 'service', label: 'Служба', color: '#b45309' },
  { value: 'department', label: 'Отдел', color: '#4f7cff' },
  { value: 'sector', label: 'Сектор', color: '#be185d' },
  { value: 'group', label: 'Группа', color: '#15803d' },
  { value: 'position', label: 'Позиция', color: '#64748b' },
];
