// Кто решает по заявке (v0.6.0, E61; структура компании — v1.1.0, ADR-018). Одно место для очереди,
// проверки права решения и уведомлений:
//  • руководитель сотрудника по правилу «По Делу»: «первое лицо» — никто; явный руководитель (manager_id);
//    иначе действующий руководитель своего подразделения, а без него — первый выше по дереву;
//  • руководители своего и вышестоящих подразделений вправе решать по сотруднику (как руководитель отдела
//    до v1.1.0), но не ниже подразделения, которым руководит сам сотрудник;
//  • заместитель — всё то же за руководителя на период замещения;
//  • вышестоящий — по заявке, переданной ему эскалацией;
//  • по своей заявке не решает никто, кроме администратора.
import type { Prisma, PrismaClient } from '@prisma/client';
import { loadTree } from '../org/org.service';
import { approverFor } from '../org/org-tree';

type Db = PrismaClient | Prisma.TransactionClient;

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Руководители, чьё согласование сегодня передано сотруднику (действующие замещения). */
export async function activeDelegators(db: Db, deputyId: number, today: string): Promise<number[]> {
  const rows = await db.approvalDelegation.findMany({
    where: { deputyId, revokedAt: null, startDate: { lte: day(today) }, endDate: { gte: day(today) }, manager: { isActive: true } },
    select: { managerId: true },
  });
  return [...new Set(rows.map((r) => r.managerId))];
}

/** Действующие заместители руководителя на сегодня. */
export async function activeDeputies(db: Db, managerId: number, today: string): Promise<number[]> {
  const rows = await db.approvalDelegation.findMany({
    where: { managerId, revokedAt: null, startDate: { lte: day(today) }, endDate: { gte: day(today) }, deputy: { isActive: true } },
    select: { deputyId: true },
  });
  return [...new Set(rows.map((r) => r.deputyId))];
}

/**
 * Сотрудники, чьи заявки по умолчанию ждут решения этих руководителей (их подчинённые по правилу
 * руководителя): условие SQL по подразделениям без загрузки всех сотрудников.
 */
export async function teamOf(db: Db, managerIds: number[]): Promise<Prisma.EmployeeWhereInput> {
  const scope = (await loadTree(db)).approvalScope(managerIds);
  return {
    isActive: true,
    reportsToNone: false,
    OR: [
      { managerId: { in: managerIds } },
      { managerId: null, deptId: { in: scope.depts }, id: { notIn: scope.exceptIds } },
      { managerId: null, id: { in: scope.headIds } },
    ],
  };
}

/** Подчинённые руководителя — те, чьим руководителем он считается по правилу (меню, права просмотра, сводка). */
export async function directReports(db: Db, managerId: number): Promise<number[]> {
  const rows = await db.employee.findMany({ where: { ...(await teamOf(db, [managerId])), id: { not: managerId } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Заявки «ждут моего решения»: команда (своя и замещаемых руководителей) и переданные мне эскалацией. */
export async function queueFilter(db: Db, actorId: number, today: string): Promise<Prisma.VacationRequestWhereInput> {
  const managers = [actorId, ...(await activeDelegators(db, actorId, today))];
  return { employeeId: { not: actorId }, OR: [{ employee: await teamOf(db, managers) }, { escalatedTo: actorId }] };
}

export async function canDecide(
  db: Db, actor: { id: number; isAdmin: boolean }, r: { employeeId: number; escalatedTo: number | null }, today: string,
): Promise<boolean> {
  if (actor.isAdmin) return true;
  if (r.employeeId === actor.id) return false;
  if (r.escalatedTo === actor.id) return true;
  const emp = await db.employee.findUnique({ where: { id: r.employeeId }, select: { id: true, managerId: true, reportsToNone: true, deptId: true } });
  if (!emp || emp.reportsToNone) return false;
  const tree = await loadTree(db);
  const allowed = new Set([approverFor(emp, tree), ...tree.decidersFor(emp.deptId, emp.id)]);
  const managers = [actor.id, ...(await activeDelegators(db, actor.id, today))];
  return managers.some((m) => allowed.has(m));
}

/** Есть ли у сотрудника что согласовывать: команда, замещение или эскалированные заявки (меню «Согласование»). */
export async function approvesAnything(db: Db, userId: number, today: string): Promise<boolean> {
  const managers = [userId, ...(await activeDelegators(db, userId, today))];
  const [team, escalated] = await Promise.all([
    db.employee.count({ where: { ...(await teamOf(db, managers)), id: { not: userId } } }),
    db.vacationRequest.count({ where: { escalatedTo: userId, status: 'pending' } }),
  ]);
  return team > 0 || escalated > 0;
}

/**
 * Согласующий по заявке сотрудника — его руководитель по правилу, но не он сам (руководитель отдела
 * без своего руководителя раньше получал уведомление о собственной заявке и мог её согласовать).
 */
export async function approverOf(db: Db, employeeId: number): Promise<{ approverId: number | null; name: string }> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, managerId: true, reportsToNone: true, deptId: true } });
  if (!e) return { approverId: null, name: '' };
  const candidate = approverFor(e, await loadTree(db));
  return { approverId: candidate !== employeeId ? candidate : null, name: e.name };
}

/** Следующий уровень для эскалации: руководитель согласующего по тому же правилу. */
export async function escalationTarget(db: Db, employeeId: number): Promise<number | null> {
  const { approverId } = await approverOf(db, employeeId);
  if (approverId === null) return null;
  const { approverId: upper } = await approverOf(db, approverId);
  return upper !== null && upper !== employeeId ? upper : null;
}
