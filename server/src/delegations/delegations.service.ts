// Замещение руководителя (v0.6.0, E61-01): на период заместитель согласует заявки сотрудников
// руководителя; руководитель своих прав не теряет. Назначает сам руководитель или кадровая служба.
import { Injectable } from '@nestjs/common';
import type { ApprovalDelegation, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertStaff } from '../auth/access';
import type { AccessClaims } from '../auth/token.service';
import { orgToday } from '../infra/clock';
import { teamOf } from '../requests/approval-scope';
import { fmtRange } from '../mail/letters';
import { toIso } from '../requests/balance';

type WithPeople = ApprovalDelegation & { manager: { name: string }; deputy: { name: string } };

const INCLUDE = { manager: { select: { name: true } }, deputy: { select: { name: true } } } as const;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function view(d: WithPeople, today: string) {
  const start = toIso(d.startDate);
  const end = toIso(d.endDate);
  return {
    id: d.id, managerId: d.managerId, managerName: d.manager.name, deputyId: d.deputyId, deputyName: d.deputy.name,
    start, end, active: start <= today && today <= end, createdBy: d.createdBy, createdAt: d.createdAt.toISOString(),
  };
}

@Injectable()
export class DelegationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  /** Действующие и будущие замещения: переданные руководителем и полученные сотрудником. */
  async list(user: AccessClaims, managerId?: number) {
    const today = await orgToday(this.prisma);
    const current = { revokedAt: null, endDate: { gte: day(today) } };
    if (managerId !== undefined && managerId !== user.sub) {
      await assertStaff(this.prisma, user, 'hr');
      const given = await this.prisma.approvalDelegation.findMany({ where: { managerId, ...current }, include: INCLUDE, orderBy: { startDate: 'asc' } });
      return { given: given.map((d) => view(d, today)), received: [] };
    }
    const [given, received] = await Promise.all([
      this.prisma.approvalDelegation.findMany({ where: { managerId: user.sub, ...current }, include: INCLUDE, orderBy: { startDate: 'asc' } }),
      this.prisma.approvalDelegation.findMany({ where: { deputyId: user.sub, ...current }, include: INCLUDE, orderBy: { startDate: 'asc' } }),
    ]);
    return { given: given.map((d) => view(d, today)), received: received.map((d) => view(d, today)) };
  }

  async create(user: AccessClaims, input: { managerId?: number; deputyId: number; start: string; end: string }) {
    const managerId = input.managerId ?? user.sub;
    const onBehalf = managerId !== user.sub;
    if (onBehalf) await assertStaff(this.prisma, user, 'hr');
    const today = await orgToday(this.prisma);
    if (input.start > input.end) throw new ProblemException('validation/bad-date-range', 'Окончание замещения раньше начала');
    if (input.end < today) throw new ProblemException('validation/bad-date-range', 'Период замещения уже прошёл');
    if ((day(input.end).getTime() - day(input.start).getTime()) / 86_400_000 > 366) {
      throw new ProblemException('validation/bad-date-range', 'Замещение — не дольше года');
    }
    if (input.deputyId === managerId) throw new ProblemException('validation/invalid-field', 'Заместитель — другой сотрудник');

    const created = await this.prisma.$transaction(async (tx) => {
      // Одно замещение руководителя на любой день: проверка и запись — под блокировкой его строки
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${managerId} FOR NO KEY UPDATE`;
      const [manager, deputy] = await Promise.all([
        tx.employee.findUnique({ where: { id: managerId }, select: { id: true, name: true, isActive: true } }),
        tx.employee.findUnique({ where: { id: input.deputyId }, select: { id: true, name: true, isActive: true } }),
      ]);
      if (!manager?.isActive) throw new ProblemException('not-found', 'Руководитель не найден');
      if (!deputy?.isActive) throw new ProblemException('validation/invalid-field', 'Заместитель не найден или уволен');
      const team = await tx.employee.count({ where: { ...teamOf([managerId]), id: { not: managerId } } });
      if (!team) throw new ProblemException('validation/invalid-field', 'У сотрудника нет подчинённых — передавать нечего');
      const clash = await tx.approvalDelegation.findFirst({
        where: { managerId, revokedAt: null, startDate: { lte: day(input.end) }, endDate: { gte: day(input.start) } },
        include: { deputy: { select: { name: true } } },
      });
      if (clash) {
        throw new ProblemException('validation/invalid-field',
          `На эти даты согласование уже передано: ${clash.deputy.name}, ${fmtRange(toIso(clash.startDate), toIso(clash.endDate))}`);
      }
      const d = await tx.approvalDelegation.create({
        data: { managerId, deputyId: input.deputyId, startDate: day(input.start), endDate: day(input.end), createdBy: user.sub },
        include: INCLUDE,
      });
      await this.audit.record(tx, {
        actorId: user.sub, action: 'delegation.created', entity: 'delegation', entityId: d.id,
        after: { managerId, deputyId: input.deputyId, start: input.start, end: input.end },
      });
      const period = fmtRange(input.start, input.end);
      await this.notify.notify(tx, input.deputyId, 'delegation_assigned',
        `${manager.name} передаёт вам согласование заявок своих сотрудников на ${period}. Заявки появятся в разделе «Заявки».`);
      if (onBehalf) {
        await this.notify.notify(tx, managerId, 'delegation_assigned',
          `Кадровая служба передала согласование ваших заявок сотруднику ${deputy.name} на ${period}.`);
      }
      return d;
    });
    return view(created, today);
  }

  async revoke(user: AccessClaims, id: number): Promise<void> {
    const d = await this.prisma.approvalDelegation.findUnique({ where: { id }, include: INCLUDE });
    if (!d || d.revokedAt) throw new ProblemException('not-found');
    if (d.managerId !== user.sub) await assertStaff(this.prisma, user, 'hr');
    const today = await orgToday(this.prisma);
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.approvalDelegation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        actorId: user.sub, action: 'delegation.revoked', entity: 'delegation', entityId: id,
        before: { managerId: d.managerId, deputyId: d.deputyId, start: toIso(d.startDate), end: toIso(d.endDate) }, after: { revoked: true },
      });
      if (toIso(d.endDate) >= today) {
        await this.notify.notify(tx, d.deputyId, 'delegation_assigned',
          `Замещение ${d.manager.name} на ${fmtRange(toIso(d.startDate), toIso(d.endDate))} отменено.`);
      }
    });
  }
}
