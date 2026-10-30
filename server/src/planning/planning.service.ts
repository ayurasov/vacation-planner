// Кампания планирования отпусков и утверждение графика (v0.6.0, E60-01/02). ТК РФ, ст. 123:
// график отпусков утверждается не позднее чем за две недели до начала календарного года; ст. 125 —
// одна из частей отпуска не короче 14 календарных дней. Кадровая служба открывает кампанию со
// сроком, видит прогресс по отделам, напоминает не спланировавшим и утверждает график: снимок
// согласованных отпусков с реквизитами документа — основа формы Т-7.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { deptLabels } from '../org/org.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobsService } from '../jobs/jobs.service';
import { orgToday } from '../infra/clock';
import { calendarDays, toIso, vacationDays } from '../requests/balance';
import { fmtRange } from '../mail/letters';

/** Строка утверждённого графика (снимок на момент утверждения). */
export interface ScheduleRow {
  requestId: number;
  employeeId: number;
  name: string;
  position: string | null;
  dept: string | null;
  personnelNumber: string | null;
  start: string;
  end: string;
  /** Календарные дни отпуска без нерабочих праздничных (ст. 120). */
  days: number;
}

export type PlanStatus = 'none' | 'partial' | 'done';

export interface EmployeePlan {
  id: number;
  name: string;
  position: string | null;
  deptId: number | null;
  dept: string | null;
  personnelNumber: string | null;
  /** Норма дней в году. */
  norm: number;
  plannedDays: number;
  approvedDays: number;
  pendingDays: number;
  parts: number;
  hasFourteen: boolean;
  /** none — ничего не запланировано; partial — меньше нормы или нет части ≥ 14 дней; done — всё. */
  status: PlanStatus;
}

interface DeptPlan {
  deptId: number | null;
  dept: string | null;
  employees: number;
  planned: number;
  done: number;
  withFourteen: number;
  plannedDays: number;
  normDays: number;
}

interface Part { id: number; employee_id: number; s: string; e: string; status: 'approved' | 'pending' }

/** Сколько дней до срока остаётся, когда уходит автоматическое напоминание. */
export const AUTO_REMIND_DAYS = 3;
const REMIND_PAUSE_MS = 60 * 60 * 1000;

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const fmtDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const fmtNum = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const REQUISITES = { orgName: 'наименование организации', headName: 'руководитель организации', hrHeadName: 'руководитель кадровой службы' } as const;

@Injectable()
export class PlanningService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('planning-reminders', () => this.autoRemind());
  }

  // ── Прогресс ──

  /** Отпуска года (согласованные и на согласовании) по сотрудникам: часть года — по дате начала. */
  async plans(year: number): Promise<EmployeePlan[]> {
    const [employees, parts, calendars, labels] = await Promise.all([
      this.prisma.employee.findMany({
        where: { isActive: true, empType: 'staff' },
        select: { id: true, name: true, position: true, plannedDays: true, personnelNumber: true, deptId: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.$queryRaw<Part[]>`
        SELECT id, employee_id, to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e, status::text AS status
          FROM vacation_requests
         WHERE type = 'vacation' AND status IN ('approved', 'pending')
           AND start_date BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date`,
      this.prisma.productionCalendar.findMany({ where: { year: { in: [year, year + 1] } } }),
      deptLabels(this.prisma),
    ]);
    const holidays = new Set(calendars.flatMap((c) => (Array.isArray(c.holidays) ? (c.holidays as string[]) : [])));
    const byEmployee = new Map<number, Part[]>();
    for (const p of parts) byEmployee.set(p.employee_id, [...(byEmployee.get(p.employee_id) ?? []), p]);
    return employees.map((e) => {
      const own = byEmployee.get(e.id) ?? [];
      const days = (p: Part) => vacationDays(p.s, p.e, holidays);
      const approvedDays = own.filter((p) => p.status === 'approved').reduce((n, p) => n + days(p), 0);
      const pendingDays = own.filter((p) => p.status === 'pending').reduce((n, p) => n + days(p), 0);
      const plannedDays = approvedDays + pendingDays;
      const hasFourteen = own.some((p) => calendarDays(p.s, p.e) >= 14);
      const norm = e.plannedDays;
      const status: PlanStatus = !own.length && norm > 0 ? 'none' : plannedDays >= norm && (hasFourteen || norm < 14) ? 'done' : 'partial';
      return {
        id: e.id, name: e.name, position: e.position, deptId: e.deptId, dept: labels.label(e.deptId), personnelNumber: e.personnelNumber,
        norm, plannedDays, approvedDays, pendingDays, parts: own.length, hasFourteen, status,
      };
    });
  }

  private static summarize(rows: EmployeePlan[]): Omit<DeptPlan, 'deptId' | 'dept'> {
    return {
      employees: rows.length,
      planned: rows.filter((r) => r.status !== 'none').length,
      done: rows.filter((r) => r.status === 'done').length,
      withFourteen: rows.filter((r) => r.hasFourteen).length,
      plannedDays: Math.round(rows.reduce((n, r) => n + r.plannedDays, 0) * 100) / 100,
      normDays: Math.round(rows.reduce((n, r) => n + r.norm, 0) * 100) / 100,
    };
  }

  async overview(year: number) {
    const [campaign, approval, plans, settings, pendingRequests, approvedParts] = await Promise.all([
      this.prisma.planningCampaign.findUnique({ where: { year }, include: { opener: { select: { name: true } } } }),
      this.approvalView(year),
      this.plans(year),
      this.prisma.orgSettings.findUnique({ where: { id: 1 } }),
      this.prisma.vacationRequest.count({
        where: { type: 'vacation', status: 'pending', startDate: { gte: day(`${year}-01-01`), lte: day(`${year}-12-31`) }, employee: { isActive: true } },
      }),
      this.prisma.vacationRequest.count({
        where: { type: 'vacation', status: 'approved', startDate: { gte: day(`${year}-01-01`), lte: day(`${year}-12-31`) }, employee: { isActive: true, empType: 'staff' } },
      }),
    ]);
    const groups = new Map<string, EmployeePlan[]>();
    for (const p of plans) groups.set(String(p.deptId ?? ''), [...(groups.get(String(p.deptId ?? '')) ?? []), p]);
    const departments: DeptPlan[] = [...groups.values()]
      .map((rows) => ({ deptId: rows[0].deptId, dept: rows[0].dept, ...PlanningService.summarize(rows) }))
      .sort((a, b) => (a.dept === null ? 1 : b.dept === null ? -1 : a.dept.localeCompare(b.dept, 'ru')));
    const missingRequisites = (Object.keys(REQUISITES) as Array<keyof typeof REQUISITES>)
      .filter((k) => !settings?.[k]).map((k) => REQUISITES[k]);
    return {
      year,
      campaign: campaign && {
        year: campaign.year, deadline: toIso(campaign.deadline), open: !campaign.closedAt,
        openedAt: campaign.openedAt.toISOString(), openedBy: campaign.opener?.name ?? null,
        closedAt: campaign.closedAt?.toISOString() ?? null, remindedAt: campaign.remindedAt?.toISOString() ?? null,
      },
      approval,
      /** Строк в графике при утверждении сейчас: согласованные отпуска года. */
      approvedParts,
      totals: PlanningService.summarize(plans),
      departments,
      warnings: {
        pendingRequests,
        missingPersonnelNumbers: plans.filter((p) => p.approvedDays > 0 && !p.personnelNumber).length,
        missingRequisites,
      },
    };
  }

  async employees(year: number, filter: { deptId?: number; status?: PlanStatus }) {
    const rows = (await this.plans(year)).filter((p) =>
      (filter.deptId === undefined || (p.deptId ?? 0) === filter.deptId) && (!filter.status || p.status === filter.status));
    return { items: rows };
  }

  /** Приглашение сотруднику: открытая кампания и его прогресс. */
  async mine(userId: number) {
    const me = await this.prisma.employee.findUnique({ where: { id: userId }, select: { isActive: true, empType: true } });
    const today = await orgToday(this.prisma);
    const campaign = me?.isActive && me.empType === 'staff'
      ? await this.prisma.planningCampaign.findFirst({ where: { closedAt: null, year: { gte: Number(today.slice(0, 4)) } }, orderBy: { year: 'asc' } })
      : null;
    if (!campaign) return { campaign: null, plan: null };
    const plan = (await this.plans(campaign.year)).find((p) => p.id === userId) ?? null;
    return { campaign: { year: campaign.year, deadline: toIso(campaign.deadline), overdue: toIso(campaign.deadline) < today }, plan };
  }

  // ── Кампания ──

  async open(actorId: number, year: number, deadline: string) {
    const today = await orgToday(this.prisma);
    const current = Number(today.slice(0, 4));
    if (year < current || year > current + 1) {
      throw new ProblemException('validation/invalid-field', `Планирование открывается на текущий или следующий год (${current}–${current + 1})`);
    }
    if (deadline < today || deadline > `${year}-12-31`) {
      throw new ProblemException('validation/bad-date-range', `Срок — с сегодняшнего дня до 31 декабря ${year} года`);
    }
    if (await this.prisma.scheduleApproval.findUnique({ where: { year }, select: { year: true } })) {
      throw new ProblemException('validation/invalid-field', `График на ${year} год уже утверждён — планирование закрыто`);
    }
    const existing = await this.prisma.planningCampaign.findUnique({ where: { year } });
    const reopening = !existing || !!existing.closedAt;
    await this.prisma.$transaction(async (tx) => {
      await tx.planningCampaign.upsert({
        where: { year },
        create: { year, deadline: day(deadline), openedBy: actorId },
        update: reopening
          ? { deadline: day(deadline), openedAt: new Date(), openedBy: actorId, closedAt: null, closedBy: null, autoReminded: false }
          : { deadline: day(deadline), autoReminded: deadline === toIso(existing!.deadline) ? undefined : false },
      });
      await this.audit.record(tx, {
        actorId, action: reopening ? 'planning.opened' : 'planning.updated', entity: 'planning_campaign', entityId: year,
        before: existing ? { deadline: toIso(existing.deadline), open: !existing.closedAt } : null,
        after: { deadline, open: true },
      });
      if (!reopening) return;
      // Приглашение всем штатным сотрудникам — одной пачкой в той же транзакции
      const staff = await tx.employee.findMany({ where: { isActive: true, empType: 'staff' }, select: { id: true, plannedDays: true } });
      await this.notify.notifyMany(tx, staff.map((e) => ({
        employeeId: e.id,
        text: `Открыто планирование отпусков на ${year} год — до ${fmtDay(deadline)}. Запланируйте отпуск в разделе «Мой отпуск»: `
          + `в году ${fmtNum(e.plannedDays)} дн., одна из частей — не короче 14 календарных дней (ст. 125 ТК РФ).`,
      })), 'planning_open', { year });
    }, { timeout: 60_000 });
    return this.overview(year);
  }

  async close(actorId: number, year: number) {
    const c = await this.prisma.planningCampaign.findUnique({ where: { year } });
    if (!c) throw new ProblemException('not-found');
    if (c.closedAt) return this.overview(year);
    await this.prisma.$transaction(async (tx) => {
      await tx.planningCampaign.update({ where: { year }, data: { closedAt: new Date(), closedBy: actorId } });
      await this.audit.record(tx, { actorId, action: 'planning.closed', entity: 'planning_campaign', entityId: year, after: { open: false } });
    });
    return this.overview(year);
  }

  /**
   * Напоминание тем, кто не спланировал отпуск полностью. Вручную — не чаще раза в час;
   * автоматически — один раз, за AUTO_REMIND_DAYS дней до срока (отметка в той же транзакции).
   */
  async remind(actorId: number | null, year: number, auto = false): Promise<number> {
    const c = await this.prisma.planningCampaign.findUnique({ where: { year } });
    if (!c || c.closedAt) throw new ProblemException('validation/invalid-field', `Планирование на ${year} год не открыто`);
    if (!auto && c.remindedAt && Date.now() - c.remindedAt.getTime() < REMIND_PAUSE_MS) {
      throw new ProblemException('validation/invalid-field', 'Напоминание уже отправлено в течение последнего часа');
    }
    const deadline = toIso(c.deadline);
    const targets = (await this.plans(year)).filter((p) => p.status !== 'done');
    return this.prisma.$transaction(async (tx) => {
      if (auto) {
        const claimed = await tx.planningCampaign.updateMany({ where: { year, autoReminded: false, closedAt: null }, data: { autoReminded: true } });
        if (!claimed.count) return 0;
      }
      const sent = await this.notify.notifyMany(tx, targets.map((p) => ({
        employeeId: p.id,
        text: [
          `Напоминание: запланируйте отпуск на ${year} год до ${fmtDay(deadline)}.`,
          `Сейчас запланировано ${fmtNum(p.plannedDays)} из ${fmtNum(p.norm)} дн.`,
          p.hasFourteen || p.norm < 14 ? '' : 'Нужна часть не короче 14 календарных дней.',
        ].filter(Boolean).join(' '),
      })), 'planning_reminder', { year });
      await tx.planningCampaign.update({ where: { year }, data: { remindedAt: new Date() } });
      await this.audit.record(tx, {
        actorId, action: 'planning.reminded', entity: 'planning_campaign', entityId: year, after: { sent, auto },
      });
      return sent;
    }, { timeout: 60_000 });
  }

  /** Плановая задача: автоматическое напоминание за несколько дней до срока. */
  async autoRemind(): Promise<number> {
    const today = await orgToday(this.prisma);
    const due = await this.prisma.planningCampaign.findMany({
      where: {
        closedAt: null, autoReminded: false,
        deadline: { gte: day(today), lte: new Date(day(today).getTime() + AUTO_REMIND_DAYS * 86_400_000) },
      },
    });
    let sent = 0;
    for (const c of due) sent += await this.remind(null, c.year, true);
    return sent;
  }

  // ── Утверждение графика ──

  private async approvalView(year: number) {
    const a = await this.prisma.scheduleApproval.findUnique({
      where: { year },
      select: {
        year: true, docNumber: true, docDate: true, unionOpinionDate: true, unionOpinionNumber: true,
        approvedAt: true, approver: { select: { name: true } },
      },
    });
    if (!a) return null;
    const [{ n }] = await this.prisma.$queryRaw<Array<{ n: number }>>`SELECT jsonb_array_length(rows)::int AS n FROM schedule_approvals WHERE year = ${year}`;
    return {
      year: a.year, docNumber: a.docNumber, docDate: toIso(a.docDate),
      unionOpinionDate: a.unionOpinionDate ? toIso(a.unionOpinionDate) : null, unionOpinionNumber: a.unionOpinionNumber,
      approvedAt: a.approvedAt.toISOString(), approvedBy: a.approver?.name ?? null, rows: n,
    };
  }

  /** Согласованные отпуска года на сегодня — строки будущего (или проекта) графика. */
  async currentRows(year: number): Promise<ScheduleRow[]> {
    const plans = new Map((await this.plans(year)).map((p) => [p.id, p]));
    const [parts, calendars] = await Promise.all([
      this.prisma.$queryRaw<Part[]>`
        SELECT id, employee_id, to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e, status::text AS status
          FROM vacation_requests
         WHERE type = 'vacation' AND status = 'approved'
           AND start_date BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date
         ORDER BY start_date, id`,
      this.prisma.productionCalendar.findMany({ where: { year: { in: [year, year + 1] } } }),
    ]);
    const holidays = new Set(calendars.flatMap((c) => (Array.isArray(c.holidays) ? (c.holidays as string[]) : [])));
    return parts.flatMap((p) => {
      const e = plans.get(p.employee_id); // только действующие штатные сотрудники
      return e ? [{
        requestId: p.id, employeeId: e.id, name: e.name, position: e.position, dept: e.dept, personnelNumber: e.personnelNumber,
        start: p.s, end: p.e, days: vacationDays(p.s, p.e, holidays),
      }] : [];
    }).sort((a, b) => (a.dept ?? '￿').localeCompare(b.dept ?? '￿', 'ru') || a.name.localeCompare(b.name, 'ru') || a.start.localeCompare(b.start));
  }

  async approve(actorId: number, year: number, input: { docNumber: string; docDate: string; unionOpinionDate?: string; unionOpinionNumber?: string }) {
    const today = await orgToday(this.prisma);
    if (today >= `${year}-01-01`) {
      throw new ProblemException('validation/invalid-field', `График на ${year} год утверждается до начала года`);
    }
    const existing = await this.prisma.scheduleApproval.findUnique({ where: { year }, select: { docNumber: true, docDate: true } });
    if (existing) {
      throw new ProblemException('validation/invalid-field', `График на ${year} год уже утверждён: № ${existing.docNumber} от ${fmtDay(toIso(existing.docDate))}`);
    }
    if (input.docDate > today) throw new ProblemException('validation/bad-date-range', 'Дата составления документа — не позже сегодняшней');
    const rows = await this.currentRows(year);
    if (!rows.length) {
      throw new ProblemException('validation/invalid-field', `Нет согласованных отпусков на ${year} год — утверждать нечего`);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.scheduleApproval.create({
          data: {
            year, docNumber: input.docNumber.trim(), docDate: day(input.docDate),
            unionOpinionDate: input.unionOpinionDate ? day(input.unionOpinionDate) : null,
            unionOpinionNumber: input.unionOpinionNumber?.trim() || null,
            approvedBy: actorId, rows: rows as unknown as Prisma.InputJsonValue,
          },
        });
        // Утверждённый график закрывает кампанию: планы года дальше меняются переносами
        await tx.planningCampaign.updateMany({ where: { year, closedAt: null }, data: { closedAt: new Date(), closedBy: actorId } });
        await this.audit.record(tx, {
          actorId, action: 'schedule.approved', entity: 'schedule_approval', entityId: year,
          after: { docNumber: input.docNumber.trim(), docDate: input.docDate, unionOpinionDate: input.unionOpinionDate ?? null, unionOpinionNumber: input.unionOpinionNumber ?? null, rows: rows.length },
        });
      });
    } catch (e) {
      // Два утверждения одновременно: первичный ключ по году пропускает одно
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ProblemException('validation/invalid-field', `График на ${year} год уже утверждён`);
      }
      throw e;
    }
    return this.overview(year);
  }

  // ── Форма Т-7 ──

  /**
   * Данные формы Т-7. Утверждённый график — строки снимка; перенос после утверждения — графы 8–9
   * (основание: согласованная заявка на перенос; дата предполагаемого отпуска), отмена — в
   * примечании; фактическая дата (графа 7) — начало отпуска, если он уже начался. До утверждения —
   * проект по согласованным отпускам на сегодня.
   */
  async t7(year: number) {
    const [settings, approval, today] = await Promise.all([
      this.prisma.orgSettings.findUnique({ where: { id: 1 } }),
      this.prisma.scheduleApproval.findUnique({ where: { year } }),
      orgToday(this.prisma),
    ]);
    const snapshot = approval ? (approval.rows as unknown as ScheduleRow[]) : await this.currentRows(year);
    const ids = snapshot.map((r) => r.requestId);
    const [current, decisions] = await Promise.all([
      this.prisma.vacationRequest.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true, startDate: true, endDate: true, changeFromStart: true },
      }),
      approval && ids.length
        ? this.prisma.$queryRaw<Array<{ request_id: number; ts: Date }>>`
            SELECT request_id, max(ts) AS ts FROM request_events
             WHERE request_id IN (${Prisma.join(ids)}) AND action = 'approved' AND ts > ${approval.approvedAt}
             GROUP BY request_id`
        : Promise.resolve([]),
    ]);
    const byId = new Map(current.map((r) => [r.id, r]));
    const decided = new Map(decisions.map((d) => [d.request_id, d.ts]));
    const ru = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const rows = snapshot.map((r) => {
      const cur = byId.get(r.requestId);
      const row = {
        dept: r.dept, position: r.position, name: r.name, personnelNumber: r.personnelNumber, days: r.days,
        planned: r.start, actual: null as string | null, transferBasis: null as string | null, transferDate: null as string | null, note: null as string | null,
      };
      if (!cur || cur.status === 'cancelled' || cur.status === 'rejected') {
        row.note = 'Отпуск отменён';
        return row;
      }
      const start = toIso(cur.startDate);
      const end = toIso(cur.endDate);
      if (cur.status === 'pending') {
        if (cur.changeFromStart) row.note = `Перенос на ${fmtRange(start, end)} на согласовании`;
        return row;
      }
      if (approval && (start !== r.start || end !== r.end)) {
        const at = decided.get(r.requestId);
        row.transferBasis = `Заявка № ${r.requestId}${at ? ` от ${ru(at.toISOString().slice(0, 10))}` : ''}`;
        row.transferDate = start;
        row.note = `Перенесён: ${fmtRange(start, end)}`;
      }
      if (start <= today) row.actual = start;
      return row;
    });
    return {
      year, draft: !approval,
      docNumber: approval?.docNumber ?? null, docDate: approval ? toIso(approval.docDate) : null,
      unionOpinionDate: approval?.unionOpinionDate ? toIso(approval.unionOpinionDate) : null,
      unionOpinionNumber: approval?.unionOpinionNumber ?? null,
      orgName: settings?.orgName ?? null, orgOkpo: settings?.orgOkpo ?? null,
      headPosition: settings?.headPosition ?? null, headName: settings?.headName ?? null,
      hrHeadPosition: settings?.hrHeadPosition ?? null, hrHeadName: settings?.hrHeadName ?? null,
      rows,
    };
  }
}

export type T7Data = Awaited<ReturnType<PlanningService['t7']>>;
