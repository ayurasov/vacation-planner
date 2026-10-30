// Дерево структуры компании (v1.1.0, ADR-018): пути, уровни, правило руководителя и подписи одноимённых
// подразделений — без БД.
import { describe, expect, it } from 'vitest';
import { approverFor, OrgTree, pathKey, type DeptNode } from '../src/org/org-tree';

const node = (id: number, name: string, parentId: number | null, managerId: number | null = null, extra: Partial<DeptNode> = {}): DeptNode => ({
  id, name, parentId, kind: 'department', sortOrder: 0, externalId: null, managerId, managerActive: true, managerDeptId: id, ...extra,
});

// Компания (руководитель 1) → Продажи (2) → Отдел продаж (без руководителя); Компания → Север → Отдел продаж (3)
const tree = new OrgTree([
  node(1, 'Компания', null, 1),
  node(2, 'Продажи', 1, 2),
  node(3, 'Отдел продаж', 2),
  node(4, 'Север', 1, null),
  node(5, 'Отдел продаж', 4, 3),
]);

describe('дерево подразделений', () => {
  it('пути, уровни, высота и порядок: родитель раньше вложенных', () => {
    expect(tree.path(3)).toEqual(['Компания', 'Продажи', 'Отдел продаж']);
    expect(tree.level(1)).toBe(1);
    expect(tree.level(5)).toBe(3);
    expect(tree.height(1)).toBe(3);
    expect(tree.height(3)).toBe(1);
    const order = tree.ordered().map((n) => n.id);
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(5));
  });

  it('поиск по пути без учёта регистра и лишних пробелов; перемещение в своего потомка — цикл', () => {
    expect(tree.findByPath(['компания', '  север ', 'ОТДЕЛ  продаж'])?.id).toBe(5);
    expect(tree.findByPath(['Компания', 'Юг'])).toBeUndefined();
    expect(pathKey(['А', 'Б'])).toBe('а/б');
    expect(tree.isSelfOrAncestor(1, 5)).toBe(true);
    expect(tree.isSelfOrAncestor(5, 1)).toBe(false);
    expect(tree.siblingNamed(2, 'отдел продаж')?.id).toBe(3);
    expect(tree.siblingNamed(2, 'Отдел продаж', 3)).toBeUndefined();
  });

  it('одноимённые подразделения получают подписи с родителем; единственные — просто название', () => {
    expect(tree.label(2)).toBe('Продажи');
    expect(tree.label(3)).toBe('Отдел продаж — Продажи');
    expect(tree.label(5)).toBe('Отдел продаж — Север');
    expect(tree.findByLabel('отдел продаж — север')?.id).toBe(5);
    expect(tree.findByLabel('Отдел продаж')).toBeUndefined(); // неоднозначно
    expect(tree.findByLabel('Продажи')?.id).toBe(2);
  });

  it('совпадают и с родителем — подпись полным путём', () => {
    // Два «Отдела» под двумя «Б»: с родителем подписи совпали бы — у обоих полный путь
    const t = new OrgTree([node(1, 'А', null), node(2, 'Б', 1), node(3, 'Б', null), node(4, 'Отдел', 2), node(5, 'Отдел', 3)]);
    expect(t.label(4)).toBe('А / Б / Отдел');
    expect(t.label(5)).toBe('Б / Отдел');
    expect(t.label(2)).toBe('Б — А');
    expect(t.label(3)).toBe('Б');
    expect(t.findByLabel('б / отдел')?.id).toBe(5);
  });
});

describe('правило руководителя (как в «По Делу»)', () => {
  it('явный руководитель важнее структуры; «первое лицо» не подчиняется никому', () => {
    expect(approverFor({ id: 10, managerId: 7, reportsToNone: false, deptId: 3 }, tree)).toBe(7);
    expect(approverFor({ id: 1, managerId: null, reportsToNone: true, deptId: 1 }, tree)).toBeNull();
  });

  it('без явного: руководитель своего подразделения, без него — выше по дереву', () => {
    expect(approverFor({ id: 10, managerId: null, reportsToNone: false, deptId: 5 }, tree)).toBe(3);
    expect(approverFor({ id: 11, managerId: null, reportsToNone: false, deptId: 3 }, tree)).toBe(2); // своего нет — «Продажи»
    expect(approverFor({ id: 12, managerId: null, reportsToNone: false, deptId: 4 }, tree)).toBe(1); // у «Север» нет — «Компания»
  });

  it('руководитель подразделения подчиняется руководителю выше; на корне — никому', () => {
    expect(approverFor({ id: 2, managerId: null, reportsToNone: false, deptId: 2 }, tree)).toBe(1);
    expect(approverFor({ id: 1, managerId: null, reportsToNone: false, deptId: 1 }, tree)).toBeNull();
  });

  it('уволенный руководитель пропускается', () => {
    const t = new OrgTree([node(1, 'Компания', null, 1), node(2, 'Отдел', 1, 9, { managerActive: false })]);
    expect(approverFor({ id: 20, managerId: null, reportsToNone: false, deptId: 2 }, t)).toBe(1);
  });
});

describe('очередь согласования по структуре', () => {
  it('рядовые сотрудники — по подразделениям, руководители — отдельным списком', () => {
    // Руководитель 1 решает по сотрудникам «Компании», «Севера» (своего руководителя нет), по руководителю «Продаж»
    // и по руководителю «Отдела продаж» в «Севере» — выше него до «Компании» руководителей нет
    expect(tree.approvalScope([1])).toEqual({ depts: [1, 4], exceptIds: [1, 2, 3], headIds: [2, 3] });
    // Руководитель 2 — по «Продажам» и «Отделу продаж» без руководителя
    expect(tree.approvalScope([2]).depts).toEqual([2, 3]);
  });

  it('руководитель верхнего уровня, числящийся во вложенном подразделении без руководителя, подчиняется выше', () => {
    // 1 руководит «Компанией», но числится в «Группе» (без руководителя) внутри «Отдела» (руководитель 5)
    const t = new OrgTree([
      node(1, 'Холдинг', null, 9, { managerDeptId: 1 }),
      node(2, 'Отдел', 1, 1, { managerDeptId: 3 }),
      node(3, 'Группа', 2),
    ]);
    expect(approverFor({ id: 1, managerId: null, reportsToNone: false, deptId: 3 }, t)).toBe(9);
    const scope = t.approvalScope([9]);
    expect(scope.headIds).toContain(1);
    expect(scope.exceptIds).toContain(1);
  });

  it('решать вправе руководители своего и вышестоящих подразделений — но не ниже того, которым руководит сам сотрудник', () => {
    expect(tree.decidersFor(3, 10)).toEqual([1, 2]);
    expect(tree.decidersFor(5, 10)).toEqual([1, 3]);
    const t = new OrgTree([
      node(1, 'Холдинг', null, 9, { managerDeptId: 1 }),
      node(2, 'Отдел', 1, 1, { managerDeptId: 3 }),
      node(3, 'Группа', 2, 7),
    ]);
    // Руководитель «Отдела» числится в «Группе»: руководитель группы (7) по нему не решает
    expect(t.decidersFor(3, 1)).toEqual([9]);
    expect(t.decidersFor(3, 20)).toEqual([9, 1, 7]);
    expect(t.subtree(1)).toEqual([1, 2, 3]);
  });
});
