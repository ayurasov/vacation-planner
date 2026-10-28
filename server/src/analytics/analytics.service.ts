// Аналитика пересечений: загрузка данных из БД и вызов чистых функций coverage.ts.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { toIso } from '../requests/balance';
import {
  conflictPeriods, dayStatus, insightsFor, monthlyLoad, planningStatus, suggestWindows, workCalendar,
  type DayStatus, type Person, type Transfer, type WorkCalendar,
} from './coverage';

export interface Viewer {
  id: number;
  /** Администратор или кадровая служба: видит аналитику всех отделов. */
  isAdmin: boolean;
  deptName: string | null;
  /** Отделы, где пользователь руководит или работают его подчинённые. */
  managedDepts: string[];
  subordinates: number[];
}

const NO_DEPT = 'Без отдела';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async viewer(userId: number): Promise<Viewer> {
    const me = await this.prisma.employee.findUnique({
      where: { id: userId },
      include: {
        dept: { select: { name: true } },
        managedDepts: { select: { name: true } },
        subordinates: { where: { isActive: true }, select: { id: true, dept: { select: { name: true } } } },
      },
    });
    if (!me) throw new ProblemException('not-found');
    const managed = new Set<string>(me.managedDepts.map((d) => d.name));
    for (const s of me.subordinates) if (s.dept) managed.add(s.dept.name);
    return {
      id: me.id, isAdmin: me.isAdmin || me.isHr, deptName: me.dept?.name ?? null,
      managedDepts: [...managed].sort(), subordinates: me.subordinates.map((s) => s.id),
    };
  }

  /** Отделы, доступные для аналитики: админ — все, руководитель — свои, сотрудник — собственный. */
  async visibleDepts(v: Viewer): Promise<string[]> {
    if (v.isAdmin) return (await this.prisma.department.findMany({ orderBy: { name: 'asc' }, select: { name: true } })).map((d) => d.name);
    const set = new Set(v.managedDepts);
    if (v.deptName) set.add(v.deptName);
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  private async assertDept(v: Viewer, dept: string): Promise<void> {
    if (!(await this.visibleDepts(v)).includes(dept)) throw new ProblemException('auth/forbidden', 'Аналитика доступна по своим отделам');
  }

  /** Календарь лет: праздники ст. 112 и переносы выходных. Нет календаря года — только выходные. */
  async calendar(...years: number[]): Promise<WorkCalendar> {
    const rows = await this.prisma.productionCalendar.findMany({ where: { year: { in: years } } });
    const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
    return workCalendar(rows.flatMap((r) => list<string>(r.holidays)), rows.flatMap((r) => list<Transfer>(r.transfers)));
  }

  private async threshold(): Promise<number> {
    const s = await this.prisma.orgSettings.findUnique({ where: { id: 1 } });
    return (s?.conflictThreshold ?? 50) / 100;
  }

  /** Активные сотрудники отдела (или проекта) с отпусками, пересекающими период. */
  async people(filter: { dept?: string; project?: number }, from: string, to: string): Promise<Person[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        isActive: true,
        ...(filter.dept ? (filter.dept === NO_DEPT ? { deptId: null } : { dept: { name: filter.dept } }) : {}),
        ...(filter.project ? { projectId: filter.project } : {}),
      },
      orderBy: { name: 'asc' },
      include: {
        dept: { select: { name: true } },
        vacationRequests: {
          where: { status: { in: ['approved', 'pending'] }, pendingDeletion: false, startDate: { lte: new Date(to) }, endDate: { gte: new Date(from) } },
          select: { startDate: true, endDate: true, status: true, type: true },
        },
      },
    });
    return rows.map((e) => ({
      id: e.id, name: e.name, dept: e.dept?.name ?? null, plannedDays: e.plannedDays, carryOver: e.carryOver, empType: e.empType,
      vacations: e.vacationRequests.map((v) => ({
        start: toIso(v.startDate), end: toIso(v.endDate), status: v.status as 'approved' | 'pending', type: v.type,
      })),
    }));
  }

  /** Аналитика года по отделу: нагрузка по месяцам, конфликты, распределение дней, выводы. */
  async overview(v: Viewer, dept: string, year: number, today: string) {
    await this.assertDept(v, dept);
    const [people, cal, threshold] = await Promise.all([
      this.people({ dept }, `${year}-01-01`, `${year}-12-31`), this.calendar(year), this.threshold(),
    ]);
    const plan = monthlyLoad(people, year, cal, true);
    return {
      dept, year, threshold, headcount: people.length,
      months: monthlyLoad(people, year, cal).map((m, i) => ({ ...m, planRatio: plan[i].avgRatio })),
      conflicts: conflictPeriods(people, year, threshold, cal),
      planning: people.filter((p) => p.empType !== 'ipsz').map((p) => planningStatus(p, year, cal.holidays)),
      insights: insightsFor(dept, people, year, threshold, cal, today),
    };
  }

  /** Состав отдела или проекта на дату: офис, удалёнка, отпуск, выходной. */
  async team(v: Viewer, scope: { dept?: string; project?: number }, date: string) {
    if (scope.dept) await this.assertDept(v, scope.dept);
    if (scope.project && !v.isAdmin) {
      const p = await this.prisma.project.findUnique({ where: { id: scope.project } });
      const member = await this.prisma.employee.findFirst({ where: { id: v.id, projectId: scope.project } });
      if (!p || (p.managerId !== v.id && !member)) throw new ProblemException('auth/forbidden');
    }
    if (!scope.dept && !scope.project) throw new ProblemException('validation/invalid-field', 'Укажите отдел или проект');
    const year = Number(date.slice(0, 4));
    const [people, cal, threshold] = await Promise.all([
      this.people(scope, `${year}-01-01`, `${year}-12-31`), this.calendar(year), this.threshold(),
    ]);
    const ids = people.map((p) => p.id);
    const [patterns, overrides, pending] = await Promise.all([
      this.prisma.workPattern.findMany({ where: { employeeId: { in: ids } } }),
      this.prisma.workOverride.findMany({ where: { employeeId: { in: ids }, date: new Date(date) } }),
      this.prisma.vacationRequest.groupBy({ by: ['employeeId'], where: { employeeId: { in: ids }, status: 'pending' }, _count: true }),
    ]);
    const pendingBy = new Map(pending.map((p) => [p.employeeId, p._count]));
    const members = people.map((p) => {
      const pattern = Object.fromEntries(patterns.filter((w) => w.employeeId === p.id).map((w) => [w.weekday, w.mode]));
      const ovr = Object.fromEntries(overrides.filter((o) => o.employeeId === p.id).map((o) => [toIso(o.date), o.mode]));
      const status: DayStatus = dayStatus(p, date, pattern, ovr, cal);
      const plan = planningStatus(p, year, cal.holidays);
      const current = p.vacations.find((x) => x.status === 'approved' && x.start <= date && date <= x.end) ?? null;
      const next = p.vacations.filter((x) => x.status === 'approved' && x.start > date).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
      return {
        id: p.id, name: p.name, dept: p.dept, empType: p.empType, status,
        until: current?.end ?? null, next: next ? { start: next.start, end: next.end } : null,
        available: plan.available, hasStretch: plan.hasStretch, pending: pendingBy.get(p.id) ?? 0,
      };
    });
    const count = (s: DayStatus) => members.filter((m) => m.status === s).length;
    const absentRatio = members.length ? count('vacation') / members.length : 0;
    return {
      date, threshold, headcount: members.length,
      counts: { office: count('office'), remote: count('remote'), vacation: count('vacation'), off: count('off'), pending: members.reduce((n, m) => n + m.pending, 0) },
      absentRatio: Math.round(absentRatio * 100) / 100,
      overThreshold: members.length >= 2 && absentRatio >= threshold,
      members,
    };
  }

  /** Подбор окон отпуска для сотрудника (себя, подчинённого или — администратору — любого). */
  async suggestions(v: Viewer, employeeId: number, length: number, from: string, to: string) {
    if (employeeId !== v.id && !v.isAdmin && !v.subordinates.includes(employeeId)) throw new ProblemException('auth/forbidden');
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { dept: { select: { name: true } } } });
    if (!emp || !emp.isActive) throw new ProblemException('not-found');
    if (emp.empType === 'ipsz') throw new ProblemException('validation/invalid-field', 'Для ИП/самозанятых отпуск не предусмотрен');
    const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
    const { holidays } = await this.calendar(...years);
    const team = await this.people({ dept: emp.dept?.name ?? NO_DEPT }, from, `${to.slice(0, 4)}-12-31`);
    const person = team.find((p) => p.id === employeeId) ?? (await this.people({}, from, to)).find((p) => p.id === employeeId)!;
    const threshold = await this.threshold();
    const plan = planningStatus(person, Number(from.slice(0, 4)), holidays);
    return {
      employee: employeeId, length, from, to, available: plan.available, hasStretch: plan.hasStretch, threshold,
      items: suggestWindows({ person, colleagues: team.filter((p) => p.id !== employeeId), length, from, to, holidays, threshold }),
    };
  }
}
