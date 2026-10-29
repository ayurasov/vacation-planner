// Кто решает по заявке (v0.6.0, E61). Одно место для очереди, проверки права решения и уведомлений:
//  • руководитель сотрудника (manager_id), а у сотрудника без руководителя — руководитель его отдела;
//  • руководитель отдела вправе решать по любому сотруднику отдела (как до v0.6.0);
//  • заместитель — всё то же за руководителя на период замещения;
//  • вышестоящий — по заявке, переданной ему эскалацией;
//  • по своей заявке не решает никто, кроме администратора.
import type { Prisma, PrismaClient } from '@prisma/client';

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

/** Сотрудники, чьи заявки по умолчанию ждут решения этих руководителей. */
export function teamOf(managerIds: number[]): Prisma.EmployeeWhereInput {
  return {
    isActive: true,
    OR: [{ managerId: { in: managerIds } }, { managerId: null, dept: { managerId: { in: managerIds } } }],
  };
}

/** Заявки «ждут моего решения»: команда (своя и замещаемых руководителей) и переданные мне эскалацией. */
export async function queueFilter(db: Db, actorId: number, today: string): Promise<Prisma.VacationRequestWhereInput> {
  const managers = [actorId, ...(await activeDelegators(db, actorId, today))];
  return { employeeId: { not: actorId }, OR: [{ employee: teamOf(managers) }, { escalatedTo: actorId }] };
}

export async function canDecide(
  db: Db, actor: { id: number; isAdmin: boolean }, r: { employeeId: number; escalatedTo: number | null }, today: string,
): Promise<boolean> {
  if (actor.isAdmin) return true;
  if (r.employeeId === actor.id) return false;
  if (r.escalatedTo === actor.id) return true;
  const emp = await db.employee.findUnique({ where: { id: r.employeeId }, select: { managerId: true, dept: { select: { managerId: true } } } });
  if (!emp) return false;
  const managers = [actor.id, ...(await activeDelegators(db, actor.id, today))];
  return managers.some((m) => emp.managerId === m || emp.dept?.managerId === m);
}

/** Есть ли у сотрудника что согласовывать: команда, замещение или эскалированные заявки (меню «Согласование»). */
export async function approvesAnything(db: Db, userId: number, today: string): Promise<boolean> {
  const managers = [userId, ...(await activeDelegators(db, userId, today))];
  const [team, escalated] = await Promise.all([
    db.employee.count({ where: { ...teamOf(managers), id: { not: userId } } }),
    db.vacationRequest.count({ where: { escalatedTo: userId, status: 'pending' } }),
  ]);
  return team > 0 || escalated > 0;
}

/**
 * Согласующий по заявке сотрудника: его руководитель, иначе руководитель отдела — но не он сам
 * (руководитель отдела без своего руководителя раньше получал уведомление о собственной заявке
 * и мог её согласовать).
 */
export async function approverOf(db: Db, employeeId: number): Promise<{ approverId: number | null; name: string }> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { name: true, managerId: true, dept: { select: { managerId: true } } } });
  const candidate = e?.managerId ?? e?.dept?.managerId ?? null;
  return { approverId: candidate !== employeeId ? candidate : null, name: e?.name ?? '' };
}

/** Следующий уровень для эскалации: руководитель согласующего (или руководитель его отдела). */
export async function escalationTarget(db: Db, employeeId: number): Promise<number | null> {
  const { approverId } = await approverOf(db, employeeId);
  if (approverId === null) return null;
  const { approverId: upper } = await approverOf(db, approverId);
  return upper !== null && upper !== employeeId ? upper : null;
}
