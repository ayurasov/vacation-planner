import { describe, expect, it } from 'vitest';
import { avatarColor, initials, shortName } from './people';
import { kindLabel, statusMeta } from './requests';

describe('люди', () => {
  it('инициалы и краткое ФИО', () => {
    expect(initials('Юрасов Александр Валерьевич')).toBe('ЮА');
    expect(initials('  ')).toBe('?');
    expect(shortName('Юрасов Александр Валерьевич')).toBe('Юрасов А. В.');
    expect(shortName('Иванов Иван')).toBe('Иванов И.');
  });
  it('цвет аватара детерминирован', () => {
    expect(avatarColor('Иванов Иван')).toBe(avatarColor('Иванов Иван'));
  });
});

describe('статусы заявок', () => {
  it('различает перенос и удаление на согласовании', () => {
    expect(statusMeta({ status: 'pending' }).label).toBe('на согласовании');
    expect(statusMeta({ status: 'pending', pendingDeletion: true }).tone).toBe('warning');
    expect(statusMeta({ status: 'pending', changeFrom: { start: '2026-01-01', end: '2026-01-02' } }).label).toBe('перенос на согласовании');
    expect(statusMeta({ status: 'approved' }).tone).toBe('success');
    expect(kindLabel({ status: 'pending', type: 'maternity' })).toBe('Отпуск по уходу за ребёнком');
  });
});
