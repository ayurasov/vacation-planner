// Эскалация заявок без решения (v0.6.0, E61-02): заявка, ждущая решения дольше N дней (правило
// организации), передаётся вышестоящему руководителю — он получает право решения по ней; если
// выше никого нет, кадровая служба получает уведомление. Повторно заявка не передаётся.
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobsService } from '../jobs/jobs.service';
import { approverOf, escalationTarget } from './approval-scope';
import { fmtRange, plural } from '../mail/letters';
import { toIso } from './balance';

@Injectable()
export class EscalationService implements OnModuleInit {
  private readonly log = new Logger('Escalation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('approval-escalation', (now) => this.run(now));
  }

  /** Один проход: не больше 200 заявок; повтор безопасен — заявку забирает один процесс. */
  async run(now = new Date()): Promise<number> {
    const settings = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    const days = settings?.escalationDays ?? 0;
    if (!days) return 0;
    const due = await this.prisma.vacationRequest.findMany({
      where: {
        status: 'pending', escalatedAt: null,
        pendingSince: { lt: new Date(now.getTime() - days * 86_400_000) },
        employee: { isActive: true },
      },
      orderBy: { pendingSince: 'asc' }, take: 200,
      select: { id: true, employeeId: true, startDate: true, endDate: true, employee: { select: { name: true } } },
    });
    let done = 0;
    for (const r of due) {
      try {
        if (await this.escalate(r, days)) done++;
      } catch (e) {
        this.log.error(`Заявка #${r.id}: ${(e as Error).message}`);
      }
    }
    return done;
  }

  private async escalate(
    r: { id: number; employeeId: number; startDate: Date; endDate: Date; employee: { name: string } }, days: number,
  ): Promise<boolean> {
    const target = await escalationTarget(this.prisma, r.employeeId);
    const { approverId } = await approverOf(this.prisma, r.employeeId);
    return this.prisma.$transaction(async (tx) => {
      // Забирает один процесс: условие повторяет отбор, отметка ставится атомарно
      const claimed = await tx.vacationRequest.updateMany({
        where: { id: r.id, status: 'pending', escalatedAt: null },
        data: { escalatedTo: target, escalatedAt: new Date() },
      });
      if (!claimed.count) return false;
      const period = fmtRange(toIso(r.startDate), toIso(r.endDate));
      // «больше 1 дня», «больше 3 дней» — после «больше» родительный падеж
      const waited = `${days} ${plural(days, ['дня', 'дней', 'дней'])}`;
      const targetName = target ? (await tx.employee.findUnique({ where: { id: target }, select: { name: true } }))?.name ?? '' : '';
      await tx.requestEvent.create({
        data: { requestId: r.id, actorId: null, action: 'escalated', comment: target ? `передана: ${targetName}` : 'передана кадровой службе' },
      });
      await this.audit.record(tx, {
        actorId: null, action: 'request.escalated', entity: 'vacation_request', entityId: r.id,
        after: { escalatedTo: target, afterDays: days },
      });
      if (target) {
        await this.notify.notify(tx, target, 'request_escalated',
          `${r.employee.name}: заявка на отпуск ${period} ждёт решения больше ${waited} и передана вам — вы можете согласовать или отклонить её.`);
      } else {
        const hr = await tx.employee.findMany({ where: { isHr: true, isActive: true }, select: { id: true } });
        for (const h of hr) {
          await this.notify.notify(tx, h.id, 'request_stalled',
            `${r.employee.name}: заявка на отпуск ${period} ждёт решения больше ${waited}, а вышестоящего руководителя нет. Свяжитесь с согласующим.`);
        }
      }
      if (approverId) {
        await this.notify.notify(tx, approverId, 'request_escalated',
          `${r.employee.name}: заявка на отпуск ${period} ждёт вашего решения больше ${waited}${target ? ` и передана ${targetName}` : ''}.`);
      }
      return true;
    });
  }
}
