// Представление заявок в интерфейсе: статусы, виды, тон бейджа.

export type Tone = 'info' | 'success' | 'danger' | 'warning' | 'muted' | 'violet';

export interface RequestLike {
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
  pendingDeletion?: boolean;
  changeFrom?: { start: string; end: string } | null;
  type?: string;
}

export function statusMeta(r: RequestLike): { label: string; tone: Tone } {
  if (r.status === 'pending') {
    if (r.pendingDeletion) return { label: 'удаление на согласовании', tone: 'warning' };
    if (r.changeFrom) return { label: 'перенос на согласовании', tone: 'warning' };
    return { label: 'на согласовании', tone: 'info' };
  }
  if (r.status === 'approved') return { label: 'согласован', tone: 'success' };
  if (r.status === 'rejected') return { label: 'отклонён', tone: 'danger' };
  return { label: 'отменён', tone: 'muted' };
}

export function kindLabel(r: RequestLike): string {
  if (r.pendingDeletion) return 'Удаление отпуска';
  if (r.changeFrom) return 'Перенос отпуска';
  if (r.type === 'maternity') return 'Отпуск по уходу за ребёнком';
  return 'Ежегодный отпуск';
}
