// Служебные роли: администратор и кадровая служба (docs/specs/02-api-spec.md, «Матрица прав»).
// Администратор может всё, что может кадровая служба; настройки организации и выдача
// служебных прав — только администратору.
import type { Prisma, PrismaClient } from '@prisma/client';
import { ProblemException } from '../infra/problems';
import type { AccessClaims } from './token.service';

export type Staff = 'admin' | 'hr';

export interface StaffActor {
  id: number;
  isAdmin: boolean;
  isHr: boolean;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Права читаются из БД, а не из токена: снятие роли действует сразу, без ожидания истечения access. */
export async function loadActor(db: Db, userId: number): Promise<StaffActor> {
  const me = await db.employee.findUnique({ where: { id: userId }, select: { id: true, isAdmin: true, isHr: true, isActive: true } });
  if (!me?.isActive) throw new ProblemException('auth/forbidden');
  return { id: me.id, isAdmin: me.isAdmin, isHr: me.isHr };
}

export function hasStaff(actor: StaffActor, need: Staff): boolean {
  return actor.isAdmin || (need === 'hr' && actor.isHr);
}

/** Требует служебную роль: 'admin' — только администратор, 'hr' — кадровая служба или администратор. */
export async function assertStaff(db: Db, user: AccessClaims, need: Staff): Promise<StaffActor> {
  const actor = await loadActor(db, user.sub);
  if (!hasStaff(actor, need)) throw new ProblemException('auth/forbidden');
  return actor;
}
