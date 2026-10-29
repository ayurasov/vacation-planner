// Жизненный цикл заявок: конечный автомат docs/specs/01-architecture.md раздел 8.
// Любое изменение пишет request_events + audit_events + уведомления в одной транзакции.
import { Injectable } from '@nestjs/common';
import type { Prisma, VacationRequest } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { fmtRange } from '../mail/letters';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { calendarDays, computeBalance, overlaps, toIso, vacationDays } from './balance';

export interface Actor {
  id: number;
  isAdmin: boolean;
  subordinates: number[]; // прямые подчинённые
}

const isoDate = (d: Date) => toIso(d);

function publicView(r: VacationRequest & { events?: unknown[] }) {
  return {
    id: r.id,
    employee: r.employeeId,
    start: isoDate(r.startDate),
    end: isoDate(r.endDate),
    type: r.type,
    status: r.status,
    pendingDeletion: r.pendingDeletion,
    changeFrom: r.changeFromStart
      ? { start: isoDate(r.changeFromStart), end: isoDate(r.changeFromEnd!) }
      : null,
    comment: r.comment,
    rejectionComment: r.rejectionComment,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  // ── Создание ──
  async create(actor: Actor, input: {
    employee?: number; start: string; end: string; comment?: string;
  }): Promise<VacationRequest> {
    const employeeId = input.employee ?? actor.id;
    const target = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!target || !target.isActive) throw new ProblemException('not-found');

    const forSubordinate = actor.id !== employeeId;
    if (forSubordinate && !actor.isAdmin && !actor.subordinates.includes(employeeId)) {
      throw new ProblemException('auth/forbidden', 'Создавать заявки можно только за себя или подчинённых');
    }
    if (target.empType === 'ipsz') {
      throw new ProblemException('validation/invalid-field', 'Для ИП/самозанятых отпуск не предусмотрен');
    }
    this.validateRange(input.start, input.end, actor.isAdmin);

    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployee(tx, employeeId);
      await this.assertNoOverlap(tx, employeeId, input.start, input.end, null);
      await this.assertWithinLimit(tx, employeeId, input.start, input.end, null);

      // Оформление за подчинённого/админом — авто-утверждение (Ф3)
      const autoApprove = forSubordinate;
      const created = await tx.vacationRequest.create({
        data: {
          employeeId, startDate: new Date(input.start), endDate: new Date(input.end),
          status: autoApprove ? 'approved' : 'pending',
          comment: input.comment ?? null, createdBy: actor.id,
          events: { create: { actorId: actor.id, action: autoApprove ? 'created+approved' : 'created', comment: input.comment ?? null } },
        },
      });
      await this.audit.record(tx, {
        actorId: actor.id, action: 'request.created', entity: 'vacation_request', entityId: created.id,
        after: { employeeId, start: input.start, end: input.end, status: created.status },
      });
      if (!autoApprove) {
        await this.notifyApprover(tx, employeeId, `Новая заявка на отпуск ${fmtRange(input.start, input.end)} (${calendarDays(input.start, input.end)} к. д.)`);
      }
      return created;
    });
  }

  // ── Список ──
  async list(actor: Actor, params: {
    scope: 'mine' | 'subordinates' | 'all';
    status?: string; employee?: number; page: number; perPage: number;
  }) {
    let employeeIds: number[] | null = null;
    if (params.scope === 'mine') employeeIds = [actor.id];
    if (params.scope === 'subordinates') employeeIds = actor.subordinates;
    if (params.scope === 'all' && !actor.isAdmin) throw new ProblemException('auth/forbidden');

    const where: Prisma.VacationRequestWhereInput = {
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      ...(params.employee ? { employeeId: params.employee } : {}),
      ...(params.status ? { status: params.status as VacationRequest['status'] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.vacationRequest.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.perPage, take: params.perPage,
        include: { employee: { select: { name: true, dept: { select: { name: true } } } } },
      }),
      this.prisma.vacationRequest.count({ where }),
    ]);
    return {
      // employeeDept: очередь руководителя запрашивает пересечения только по нужным отделам
      items: items.map((r) => ({ ...publicView(r), employeeName: r.employee.name, employeeDept: r.employee.dept?.name ?? null })),
      meta: { page: params.page, perPage: params.perPage, total },
    };
  }

  async get(actor: Actor, id: number) {
    const r = await this.prisma.vacationRequest.findUnique({
      where: { id }, include: { events: { orderBy: { ts: 'asc' } }, employee: { select: { name: true } } },
    });
    if (!r) throw new ProblemException('not-found');
    this.assertCanView(actor, r.employeeId);
    return {
      ...publicView(r),
      employeeName: r.employee.name,
      history: r.events.map((e) => ({
        ts: e.ts.toISOString(), actor: e.actorId, action: e.action, comment: e.comment,
      })),
    };
  }

  // ── Правка автором (pending) / запрос переноса (approved) ──
  async update(actor: Actor, id: number, input: { start?: string; end?: string; comment?: string }) {
    const pre = await this.mustExist(id);
    this.assertCanModify(actor, pre, 'изменять');

    if (input.start || input.end) {
      const start = input.start ?? isoDate(pre.startDate);
      const end = input.end ?? isoDate(pre.endDate);
      this.validateRange(start, end, actor.isAdmin);

      return this.prisma.$transaction(async (tx) => {
        await this.lockEmployee(tx, pre.employeeId);
        const r = await this.lockFresh(tx, id);
        if (r.status !== 'pending' && r.status !== 'approved') throw new ProblemException('stale-state', 'Заявка уже закрыта');
        let updated: VacationRequest;
        if (r.status === 'pending') {
          updated = await this.applyEdit(tx, actor, r, start, end, input.comment);
        } else {
          // Перенос approved: прежние даты сохраняются в changeFrom, статус → pending
          if (r.pendingDeletion) throw new ProblemException('stale-state', 'Заявка ожидает решения об удалении');
          if (overlaps({ start, end }, { start: isoDate(r.startDate), end: isoDate(r.endDate) })) {
            // частичный перенос того же периода допустим: снятие дней — то же пересечение, пропускаем самозапрет ниже
          }
          await this.assertNoOverlap(tx, r.employeeId, start, end, id);
          updated = await tx.vacationRequest.update({
            where: { id },
            data: {
              startDate: new Date(start), endDate: new Date(end),
              status: 'pending', pendingDeletion: false,
              changeFromStart: r.changeFromStart ?? r.startDate,
              changeFromEnd: r.changeFromEnd ?? r.endDate,
              comment: input.comment ?? r.comment,
            },
          });
          await tx.requestEvent.create({
            data: { requestId: id, actorId: actor.id, action: 'transfer_requested', comment: `с ${isoDate(r.startDate)} — ${isoDate(r.endDate)} на ${start} — ${end}` },
          });
          await this.audit.record(tx, {
            actorId: actor.id, action: 'request.updated', entity: 'vacation_request', entityId: id,
            before: { start: isoDate(r.startDate), end: isoDate(r.endDate), status: r.status },
            after: { start, end, status: 'pending', changeFrom: true },
          });
          await this.notifyApprover(tx, r.employeeId, `Запрос переноса отпуска на ${fmtRange(start, end)}`);
        }
        return updated;
      });
    }
    // только комментарий
    const updated = await this.prisma.vacationRequest.update({ where: { id }, data: { comment: input.comment ?? undefined } });
    return updated;
  }

  // ── Отмена (pending) / запрос на удаление (approved) ──
  async cancel(actor: Actor, id: number) {
    const pre = await this.mustExist(id);
    this.assertCanModify(actor, pre, 'отменять');

    return this.prisma.$transaction(async (tx) => {
      const r = await this.lockFresh(tx, id);
      if (r.status === 'pending' && !r.pendingDeletion) {
        const upd = await tx.vacationRequest.update({ where: { id }, data: { status: 'cancelled' } });
        await tx.requestEvent.create({ data: { requestId: id, actorId: actor.id, action: 'cancelled' } });
        await this.audit.record(tx, {
          actorId: actor.id, action: 'request.cancelled', entity: 'vacation_request', entityId: id,
          before: { status: 'pending' }, after: { status: 'cancelled' },
        });
        return upd;
      }
      if (r.status === 'approved') {
        const upd = await tx.vacationRequest.update({ where: { id }, data: { status: 'pending', pendingDeletion: true } });
        await tx.requestEvent.create({ data: { requestId: id, actorId: actor.id, action: 'deletion_requested' } });
        await this.audit.record(tx, {
          actorId: actor.id, action: 'request.deletion_requested', entity: 'vacation_request', entityId: id,
          before: { status: 'approved' }, after: { status: 'pending', pendingDeletion: true },
        });
        await this.notifyApprover(tx, r.employeeId, `Запрос на удаление согласованного отпуска ${fmtRange(isoDate(r.startDate), isoDate(r.endDate))}`);
        return upd;
      }
      throw new ProblemException('stale-state', 'Заявку в этом статусе отменить нельзя');
    });
  }

  // ── Решения согласующего ──
  async approve(actor: Actor, id: number, comment?: string): Promise<VacationRequest | { deleted: true }> {
    const pre = await this.mustExist(id);
    await this.assertApprover(actor, pre);

    return this.prisma.$transaction(async (tx) => {
      // Блокировка строки: два одновременных решения по одной заявке не применяются дважды
      const r = await this.lockFresh(tx, id);
      if (r.status !== 'pending') throw new ProblemException('stale-state', 'Заявка уже не на согласовании');

      if (r.pendingDeletion) {
        // Удаление одобренного отпуска: заявка исчезает, событие остаётся в аудите
        await tx.requestEvent.create({ data: { requestId: id, actorId: actor.id, action: 'deleted', comment: comment ?? null } });
        await this.audit.record(tx, {
          actorId: actor.id, action: 'request.deleted', entity: 'vacation_request', entityId: id,
          before: { period: `${isoDate(r.startDate)} — ${isoDate(r.endDate)}` }, after: { deleted: true },
        });
        await this.notifyEmployee(tx, r.employeeId, 'request_cancelled', `Отпуск ${fmtRange(isoDate(r.startDate), isoDate(r.endDate))} удалён по согласованию с руководителем`);
        await tx.vacationRequest.delete({ where: { id } });
        return { deleted: true as const };
      }

      const upd = await tx.vacationRequest.update({
        // Перенос согласован: прежние даты больше не нужны (иначе следующий перенос «помнил» бы самые первые)
        where: { id }, data: { status: 'approved', pendingDeletion: false, rejectionComment: null, changeFromStart: null, changeFromEnd: null },
      });
      await tx.requestEvent.create({ data: { requestId: id, actorId: actor.id, action: 'approved', comment: comment ?? null } });
      await this.audit.record(tx, {
        actorId: actor.id, action: 'request.approved', entity: 'vacation_request', entityId: id,
        before: { status: 'pending' }, after: { status: 'approved' },
      });
      await this.notifyEmployee(tx, r.employeeId, 'request_approved', `Отпуск ${fmtRange(isoDate(r.startDate), isoDate(r.endDate))} согласован`);
      return upd;
    });
  }

  async reject(actor: Actor, id: number, comment: string): Promise<VacationRequest> {
    const pre = await this.mustExist(id);
    await this.assertApprover(actor, pre);

    return this.prisma.$transaction(async (tx) => {
      const r = await this.lockFresh(tx, id);
      if (r.status !== 'pending') throw new ProblemException('stale-state', 'Заявка уже не на согласовании');
      // Отклонение переноса откатывает даты к прежним
      const restoreDates = !!r.changeFromStart && !r.pendingDeletion;
      const upd = await tx.vacationRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectionComment: comment,
          ...(restoreDates ? { startDate: r.changeFromStart!, endDate: r.changeFromEnd!, status: 'approved' as const, changeFromStart: null, changeFromEnd: null } : {}),
          ...(r.pendingDeletion ? { pendingDeletion: false, status: 'approved' as const } : {}),
        },
      });
      await tx.requestEvent.create({ data: { requestId: id, actorId: actor.id, action: 'rejected', comment } });
      await this.audit.record(tx, {
        actorId: actor.id, action: 'request.rejected', entity: 'vacation_request', entityId: id,
        before: { status: 'pending' },
        after: { status: upd.status, datesRestored: restoreDates || r.pendingDeletion },
      });
      await this.notifyEmployee(tx, r.employeeId, 'request_rejected', rejectionText(r, comment));
      return upd;
    });
  }

  // ── Баланс ──
  async balance(employeeId: number, year: number) {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!e) throw new ProblemException('not-found');
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31));
    const requests = await this.prisma.vacationRequest.findMany({
      where: {
        employeeId,
        type: 'vacation',
        startDate: { lte: to }, endDate: { gte: from },
        status: { in: ['approved', 'pending'] },
      },
    });
    // Дни считаем в пересечении с запрошенным годом
    const clip = (r: VacationRequest): { start: string; end: string } => {
      const s = r.startDate < from ? from : r.startDate;
      const e2 = r.endDate > to ? to : r.endDate;
      return { start: isoDate(s), end: isoDate(e2) };
    };
    return {
      year,
      ...computeBalance({
        plannedDays: e.plannedDays, carryOver: e.carryOver,
        approved: requests.filter((r) => r.status === 'approved' && !r.pendingDeletion).map(clip),
        pending: requests.filter((r) => r.status === 'pending' && !r.pendingDeletion).map(clip),
        holidays: await this.holidays(this.prisma, year),
      }),
    };
  }

  /** Нерабочие праздничные дни года (пустое множество, если календарь не загружен). */
  private async holidays(db: Prisma.TransactionClient | PrismaService, year: number): Promise<Set<string>> {
    const cal = await db.productionCalendar.findUnique({ where: { year } });
    return new Set(Array.isArray(cal?.holidays) ? (cal.holidays as string[]) : []);
  }

  // ── Вспомогательные проверки ──
  private validateRange(start: string, end: string, isAdmin: boolean): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw new ProblemException('validation/bad-date-range', 'Даты должны быть в формате YYYY-MM-DD');
    }
    if (start > end) {
      throw new ProblemException('validation/bad-date-range', 'Дата окончания раньше даты начала');
    }
    if (!isAdmin && start < toIso(new Date())) {
      throw new ProblemException('validation/bad-date-range', 'Даты в прошлом недопустимы');
    }
  }

  private async assertNoOverlap(
    tx: Prisma.TransactionClient, employeeId: number, start: string, end: string, exceptId: number | null,
  ): Promise<void> {
    const existing = await tx.vacationRequest.findMany({
      where: { employeeId, status: { in: ['pending', 'approved'] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    for (const r of existing) {
      if (overlaps({ start, end }, { start: isoDate(r.startDate), end: isoDate(r.endDate) })) {
        throw new ProblemException('overlapping-request',
          `Пересечение с заявкой #${r.id} (${isoDate(r.startDate)} — ${isoDate(r.endDate)})`);
      }
    }
  }

  private async assertWithinLimit(
    tx: Prisma.TransactionClient, employeeId: number, start: string, end: string, exceptId: number | null,
  ): Promise<void> {
    const settings = await tx.orgSettings.findUnique({ where: { id: 1 } });
    if (settings?.limitPolicy !== 'hard') return; // soft — только предупреждение на клиенте
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return;
    const year = Number(start.slice(0, 4));
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31));
    const requests = await tx.vacationRequest.findMany({
      where: {
        employeeId, type: 'vacation', status: { in: ['approved', 'pending'] },
        startDate: { lte: to }, endDate: { gte: from },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    const clip = (r: VacationRequest) => {
      const s = r.startDate < from ? from : r.startDate;
      const e = r.endDate > to ? to : r.endDate;
      return { start: isoDate(s), end: isoDate(e) };
    };
    const holidays = await this.holidays(tx, year);
    const b = computeBalance({
      plannedDays: employee.plannedDays, carryOver: employee.carryOver,
      approved: requests.filter((r) => r.status === 'approved' && !r.pendingDeletion).map(clip),
      pending: requests.filter((r) => r.status === 'pending' && !r.pendingDeletion).map(clip),
      holidays,
    });
    // Заявки на согласовании тоже резервируют дни: иначе несколько заявок обходят лимит
    const available = Math.round((b.remaining - b.pending) * 100) / 100;
    if (available - vacationDays(start, end, holidays) < 0) {
      throw new ProblemException('limit-exceeded', `Доступно дней: ${available}`);
    }
  }

  /**
   * Сериализует изменения заявок одного сотрудника: проверки пересечений и лимита видят
   * результат параллельной транзакции (READ COMMITTED сам по себе этого не гарантирует).
   * FOR NO KEY UPDATE, а не FOR UPDATE: блокировка конфликтует сама с собой, но не с проверками
   * внешних ключей (KEY SHARE). С FOR UPDATE уведомление руководителю ждало его собственную
   * заявку, и под нагрузкой две транзакции взаимно блокировались (v0.5.0, 40P01 deadlock).
   */
  private async lockEmployee(tx: Prisma.TransactionClient, employeeId: number): Promise<void> {
    await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId} FOR NO KEY UPDATE`;
  }

  /** Заявка, заблокированная до конца транзакции, в актуальном состоянии (режим — как у lockEmployee). */
  private async lockFresh(tx: Prisma.TransactionClient, id: number): Promise<VacationRequest> {
    await tx.$queryRaw`SELECT id FROM vacation_requests WHERE id = ${id} FOR NO KEY UPDATE`;
    const r = await tx.vacationRequest.findUnique({ where: { id } });
    if (!r) throw new ProblemException('stale-state', 'Заявка уже удалена');
    return r;
  }

  private mustExist(id: number) {
    return this.prisma.vacationRequest.findUnique({ where: { id } }).then((r) => {
      if (!r) throw new ProblemException('not-found');
      return r;
    });
  }

  private assertCanView(actor: Actor, employeeId: number): void {
    if (actor.isAdmin || actor.id === employeeId || actor.subordinates.includes(employeeId)) return;
    throw new ProblemException('auth/forbidden');
  }

  private assertCanModify(actor: Actor, r: VacationRequest, what: string): void {
    if (actor.isAdmin) return;
    if (actor.id === r.employeeId) return;
    if (actor.subordinates.includes(r.employeeId)) return;
    throw new ProblemException('auth/forbidden', `Нельзя ${what} чужие заявки`);
  }

  private async assertApprover(actor: Actor, r: VacationRequest): Promise<void> {
    if (actor.isAdmin) return;
    if (actor.subordinates.includes(r.employeeId)) return;
    // Руководитель отдела сотрудника (В3: эскалация не реализуется в v0.1.0 — backlog)
    const employee = await this.prisma.employee.findUnique({
      where: { id: r.employeeId }, include: { dept: true },
    });
    if (employee?.dept?.managerId === actor.id) return;
    throw new ProblemException('auth/forbidden', 'Согласовывать может руководитель сотрудника или администратор');
  }

  private async notifyApprover(tx: Prisma.TransactionClient, employeeId: number, text: string): Promise<void> {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, include: { dept: true } });
    const approverId = employee?.managerId ?? employee?.dept?.managerId ?? null;
    if (approverId) {
      await this.notifyEmployee(tx, approverId, 'request_created', `${employee?.name}: ${text}`);
    }
  }

  private async notifyEmployee(tx: Prisma.TransactionClient, employeeId: number, kind: string, text: string): Promise<void> {
    await this.notify.notify(tx, employeeId, kind, text);
  }

  private async applyEdit(
    tx: Prisma.TransactionClient, actor: Actor, r: VacationRequest, start: string, end: string, comment?: string,
  ): Promise<VacationRequest> {
    await this.assertNoOverlap(tx, r.employeeId, start, end, r.id);
    const upd = await tx.vacationRequest.update({
      where: { id: r.id },
      data: { startDate: new Date(start), endDate: new Date(end), comment: comment ?? r.comment },
    });
    await tx.requestEvent.create({
      data: { requestId: r.id, actorId: actor.id, action: 'edited', comment: `даты ${start} — ${end}` },
    });
    await this.audit.record(tx, {
      actorId: actor.id, action: 'request.updated', entity: 'vacation_request', entityId: r.id,
      before: { start: isoDate(r.startDate), end: isoDate(r.endDate) },
      after: { start, end },
    });
    return upd;
  }
}

/** Текст отказа по виду заявки: новый отпуск, перенос (остаются прежние даты) или удаление. */
function rejectionText(r: VacationRequest, comment: string): string {
  const range = fmtRange(isoDate(r.startDate), isoDate(r.endDate));
  if (r.pendingDeletion) return `Запрос на удаление отпуска ${range} отклонён — отпуск остаётся. Причина: ${comment}`;
  if (r.changeFromStart && r.changeFromEnd) {
    return `Перенос отпуска на ${range} отклонён, остаются прежние даты ${fmtRange(isoDate(r.changeFromStart), isoDate(r.changeFromEnd))}. Причина: ${comment}`;
  }
  return `Заявка на отпуск ${range} отклонена. Причина: ${comment}`;
}
