import { describe, expect, it } from 'vitest';
import type { Department } from '@/api/client';
import { indented, subtreeIds } from './departments';

const d = (id: number, name: string, parentId: number | null, level: number): Department => ({
  id, name, parentId, level, label: name, path: [], kind: 'department', sortOrder: 0, externalId: null, managerId: null, headcount: 0,
});

describe('подразделения в списках', () => {
  it('отступ по уровню — неразрывными пробелами', () => {
    expect(indented(d(1, 'Компания', null, 1))).toBe('Компания');
    expect(indented(d(3, 'Отдел', 2, 3))).toBe(' '.repeat(6) + 'Отдел');
  });

  it('поддерево — само подразделение и все вложенные', () => {
    const list = [d(1, 'А', null, 1), d(2, 'Б', 1, 2), d(3, 'В', 2, 3), d(4, 'Г', null, 1)];
    expect([...subtreeIds(list, 1)].sort()).toEqual([1, 2, 3]);
    expect([...subtreeIds(list, 4)]).toEqual([4]);
  });
});
