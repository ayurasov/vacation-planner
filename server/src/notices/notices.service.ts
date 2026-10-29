// Извещение о начале отпуска (v0.6.0, E60-03/04). ТК РФ, ст. 123: о времени начала отпуска работник
// извещается под подпись не позднее чем за две недели. Сервис извещает за noticeDays (не меньше 14)
// дней до начала согласованного ежегодного отпуска, принимает «Ознакомлен» и ведёт журнал для
// кадровой службы. Отпуск, согласованный позже, — извещение сразу, с отметкой «поздно» (ст. 124:
// работник вправе попросить перенос).
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobsService } from '../jobs/jobs.service';
import { dateIn, orgToday } from '../infra/clock';
import { calendarDays, toIso, vacationDays } from '../requests/balance';
import { fmtRange, plural } from '../mail/letters';

/** Меньше двух недель до начала (ст. 123) — извещение «позднее». */
export const LEGAL_NOTICE_DAYS = 14;
/** Неознакомленные за столько дней до начала выделяются в журнале. */
export const OVERDUE_DAYS = 3;

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
const addDays = (iso: string, n: number) => toIso(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000));

type NoticeRow = Prisma.VacationNoticeGetPayload<{ include: { employee: { select: { name: true; position: true; dept: { select: { name: true } } } } } }>;

export function noticeView(n: NoticeRow, today: string) {
  const start = toIso(n.startDate);
  const until = calendarDays(today, start) - 1; // дней до начала
  return {
    id: n.id, requestId: n.requestId, employeeId: n.employeeId,
    employeeName: n.employee.name, position: n.employee.position, dept: n.employee.dept?.name ?? null,
    start, end: toIso(n.endDate), days: n.days, sentAt: n.sentAt.toISOString(), late: n.late,
    acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
    withdrawnAt: n.withdrawnAt?.toISOString() ?? null,
    // Не ознакомлен, а до начала отпуска три дня и меньше — кадровой службе пора вмешаться
    overdue: !n.acknowledgedAt && !n.withdrawnAt && until >= 0 && until <= OVERDUE_DAYS,
  };
}

const INCLUDE = { employee: { select: { name: true, position: true, dept: { select: { name: true } } } } } as const;

@Injectable()
export class NoticesService implements OnModuleInit {
  private readonly log = new Logger('Notices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('vacation-notices', (now) => this.run(now));
  }

  /**
   * Извещения по отпускам, начинающимся в ближайшие noticeDays дней (без уже извещённых на эти даты).
   * Повтор безопасен: уникальность (заявка, дата начала) не даёт известить дважды, в том числе из
   * разных процессов кластера.
   */
  async run(now = new Date()): Promise<number> {
    const settings = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    const today = dateIn(settings?.timezone ?? 'Europe/Moscow', now);
    const horizon = addDays(today, Math.max(LEGAL_NOTICE_DAYS, settings?.noticeDays ?? LEGAL_NOTICE_DAYS));
    await this.syncWithdrawn(today);
    const due = await this.prisma.$queryRaw<Array<{ id: number; employee_id: number; s: string; e: string }>>`
      SELECT r.id, r.employee_id, to_char(r.start_date, 'YYYY-MM-DD') AS s, to_char(r.end_date, 'YYYY-MM-DD') AS e
        FROM vacation_requests r JOIN employees em ON em.id = r.employee_id
       WHERE r.status = 'approved' AND NOT r.pending_deletion AND r.type = 'vacation'
         AND em.is_active AND em.emp_type = 'staff'
         AND r.start_date > ${today}::date AND r.start_date <= ${horizon}::date
         AND NOT EXISTS (SELECT 1 FROM vacation_notices n WHERE n.request_id = r.id AND n.start_date = r.start_date)
       ORDER BY r.start_date, r.id LIMIT 500`;
    if (!due.length) return 0;
    const years = [...new Set(due.flatMap((r) => [Number(r.s.slice(0, 4)), Number(r.e.slice(0, 4))]))];
    const calendars = await this.prisma.productionCalendar.findMany({ where: { year: { in: years } } });
    const holidays = new Set(calendars.flatMap((c) => (Array.isArray(c.holidays) ? (c.holidays as string[]) : [])));
    let sent = 0;
    for (const r of due) {
      try {
        if (await this.send(r, today, holidays)) sent++;
      } catch (e) {
        this.log.error(`Заявка #${r.id}: ${(e as Error).message}`);
      }
    }
    return sent;
  }

  /**
   * Отпуск отменён или перенесён, сотрудник уволен — извещение на прежние даты отозвано; отклонили
   * перенос — снова в силе. Пока перенос на согласовании, в силе прежние даты (change_from_start).
   */
  private async syncWithdrawn(today: string): Promise<void> {
    const inForce = Prisma.sql`em.is_active AND ((r.status = 'approved' AND r.start_date = n.start_date)
      OR (r.status = 'pending' AND r.change_from_start = n.start_date))`;
    await this.prisma.$executeRaw`
      UPDATE vacation_notices n SET withdrawn_at = now()
        FROM vacation_requests r JOIN employees em ON em.id = r.employee_id
       WHERE r.id = n.request_id AND n.withdrawn_at IS NULL AND n.end_date >= ${today}::date AND NOT (${inForce})`;
    await this.prisma.$executeRaw`
      UPDATE vacation_notices n SET withdrawn_at = NULL
        FROM vacation_requests r JOIN employees em ON em.id = r.employee_id
       WHERE r.id = n.request_id AND n.withdrawn_at IS NOT NULL AND n.end_date >= ${today}::date AND ${inForce}`;
  }

  private async send(r: { id: number; employee_id: number; s: string; e: string }, today: string, holidays: Set<string>): Promise<boolean> {
    const days = vacationDays(r.s, r.e, holidays);
    const untilStart = calendarDays(today, r.s) - 1;
    const late = untilStart < LEGAL_NOTICE_DAYS;
    return this.prisma.$transaction(async (tx) => {
      const [notice] = await tx.$queryRaw<Array<{ id: number }>>`
        INSERT INTO vacation_notices (request_id, employee_id, start_date, end_date, days, late)
        VALUES (${r.id}, ${r.employee_id}, ${r.s}::date, ${r.e}::date, ${days}, ${late})
        ON CONFLICT (request_id, start_date) DO NOTHING RETURNING id`;
      if (!notice) return false;
      const text = [
        `Извещение о начале отпуска: ежегодный оплачиваемый отпуск ${fmtRange(r.s, r.e)} — ${days} ${plural(days, ['день', 'дня', 'дней'])} — начинается ${fmtDay(r.s)}.`,
        'Подтвердите ознакомление в разделе «Мой отпуск».',
        late ? 'Извещение направлено позже чем за две недели до начала: по ст. 124 ТК РФ отпуск можно перенести по вашему письменному заявлению.' : '',
      ].filter(Boolean).join(' ');
      await this.notify.notify(tx, r.employee_id, 'vacation_notice', text, { noticeId: notice.id });
      return true;
    });
  }

  /** Свои действующие извещения: предстоящие отпуска и прошедшие за последние 90 дней. */
  async mine(userId: number) {
    const today = await orgToday(this.prisma);
    const rows = await this.prisma.vacationNotice.findMany({
      where: { employeeId: userId, withdrawnAt: null, endDate: { gte: new Date(`${addDays(today, -90)}T00:00:00Z`) } },
      include: INCLUDE, orderBy: { startDate: 'asc' },
    });
    return { items: rows.map((n) => noticeView(n, today)) };
  }

  async acknowledge(userId: number, id: number): Promise<void> {
    const n = await this.prisma.vacationNotice.findUnique({ where: { id } });
    if (!n || n.employeeId !== userId) throw new ProblemException('not-found');
    if (n.acknowledgedAt) return; // повторное «Ознакомлен» ничего не меняет
    if (n.withdrawnAt) throw new ProblemException('validation/invalid-field', 'Отпуск отменён или перенесён — извещение отозвано');
    await this.prisma.$transaction(async (tx) => {
      await tx.vacationNotice.update({ where: { id }, data: { acknowledgedAt: new Date() } });
      await this.audit.record(tx, {
        actorId: userId, action: 'notice.acknowledged', entity: 'vacation_notice', entityId: id,
        after: { start: toIso(n.startDate), end: toIso(n.endDate) },
      });
    });
  }

  async get(viewer: { id: number; staff: boolean }, id: number) {
    const n = await this.prisma.vacationNotice.findUnique({ where: { id }, include: INCLUDE });
    if (!n || (!viewer.staff && n.employeeId !== viewer.id)) throw new ProblemException('not-found');
    return noticeView(n, await orgToday(this.prisma));
  }

  /** Журнал кадровой службы: извещения по отпускам, начинающимся в периоде. */
  async journal(params: { from: string; to: string; status?: 'pending' | 'acknowledged' | 'overdue'; dept?: string; page: number; perPage: number }) {
    const today = await orgToday(this.prisma);
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const status: Record<string, Prisma.VacationNoticeWhereInput> = {
      acknowledged: { acknowledgedAt: { not: null } },
      pending: { acknowledgedAt: null, withdrawnAt: null },
      overdue: { acknowledgedAt: null, withdrawnAt: null, startDate: { gte: day(today), lte: day(addDays(today, OVERDUE_DAYS)) } },
    };
    const where: Prisma.VacationNoticeWhereInput = {
      AND: [
        { startDate: { gte: day(params.from), lte: day(params.to) } },
        params.dept ? { employee: { dept: { name: params.dept } } } : {},
        params.status ? status[params.status] : {},
      ],
    };
    const [rows, total, pending] = await this.prisma.$transaction([
      this.prisma.vacationNotice.findMany({
        where, include: INCLUDE, orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        skip: (params.page - 1) * params.perPage, take: params.perPage,
      }),
      this.prisma.vacationNotice.count({ where }),
      this.prisma.vacationNotice.count({ where: { AND: [where, status.pending] } }),
    ]);
    return { items: rows.map((n) => noticeView(n, today)), meta: { page: params.page, perPage: params.perPage, total }, unacknowledged: pending };
  }

  /** Все извещения периода — для выгрузки. */
  async all(from: string, to: string) {
    const today = await orgToday(this.prisma);
    const rows = await this.prisma.vacationNotice.findMany({
      where: { startDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      include: INCLUDE, orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((n) => noticeView(n, today));
  }
}
