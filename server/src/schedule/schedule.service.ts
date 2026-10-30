// График за период: интервалы отпусков, режимы и конфликты отделов (Ф5, Ф6).
// Данные — тремя простыми SQL-запросами: вложенная выборка Prisma на 5000 сотрудников
// занимала ~400 мс против ~70 мс (v0.5.0); результат одинаков для всех пользователей
// и кэшируется контроллером по версии данных.
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { calendarDays } from '../requests/balance';
import { deptLabels } from '../org/org.service';

export interface ScheduleScope { from: string; to: string; dept?: string; project?: number }

interface EmployeeRow { id: number; name: string; position: string | null; dept_id: number | null }
interface VacationRow { id: number; employee_id: number; s: string; e: string; type: string; status: string }
interface PatternRow { employee_id: number; weekday: number; mode: string }
interface OverrideRow { employee_id: number; d: string; mode: string }

export interface Conflict { date: string; dept: string; absentRatio: number }

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Конфликты: дни, когда доля сотрудников отдела в согласованном отпуске ≥ порога.
 * Согласованные отпуска одного сотрудника не пересекаются (инвариант заявок), поэтому
 * количество отсутствующих — простой счётчик по дням периода, без множеств.
 */
export function conflictDays(
  from: string, to: string, threshold: number,
  employees: Array<{ id: number; dept: string | null }>, approved: Array<{ employeeId: number; start: string; end: string }>,
): Conflict[] {
  const days = calendarDays(from, to);
  const base = ms(from);
  const deptOf = new Map(employees.map((e) => [e.id, e.dept ?? 'Без отдела']));
  const size = new Map<string, number>();
  for (const d of deptOf.values()) size.set(d, (size.get(d) ?? 0) + 1);
  const absent = new Map<string, Uint16Array>();
  for (const v of approved) {
    const dept = deptOf.get(v.employeeId);
    if (!dept) continue;
    let counts = absent.get(dept);
    if (!counts) absent.set(dept, (counts = new Uint16Array(days)));
    const a = Math.max(0, Math.round((ms(v.start) - base) / DAY));
    const b = Math.min(days - 1, Math.round((ms(v.end) - base) / DAY));
    for (let i = a; i <= b; i++) counts[i]++;
  }
  const out: Conflict[] = [];
  for (const [dept, counts] of absent) {
    const total = size.get(dept)!;
    for (let i = 0; i < days; i++) {
      const ratio = counts[i] / total;
      if (counts[i] && ratio >= threshold) out.push({ date: iso(base + i * DAY), dept, absentRatio: Math.round(ratio * 100) / 100 });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.dept.localeCompare(y.dept));
}

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async build(q: ScheduleScope) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    // Подразделение — с вложенными; подпись различает одноимённые (v1.1.0, ADR-018)
    const labels = await deptLabels(this.prisma);
    const scope = Prisma.sql`e.is_active
      ${q.dept ? Prisma.sql`AND e.dept_id = ANY(${labels.ids(q.dept)}::int[])` : Prisma.empty}
      ${q.project ? Prisma.sql`AND e."projectId" = ${q.project}` : Prisma.empty}`;
    const [employees, vacations, patterns, overrides, settings] = await Promise.all([
      this.prisma.$queryRaw<EmployeeRow[]>`
        SELECT e.id, e.name, e.position, e.dept_id
          FROM employees e
         WHERE ${scope} ORDER BY e.name, e.id`,
      this.prisma.$queryRaw<VacationRow[]>`
        SELECT v.id, v.employee_id, to_char(v.start_date, 'YYYY-MM-DD') AS s, to_char(v.end_date, 'YYYY-MM-DD') AS e,
               v.type::text AS type, v.status::text AS status
          FROM vacation_requests v JOIN employees e ON e.id = v.employee_id
         WHERE ${scope} AND v.start_date <= ${to} AND v.end_date >= ${from} AND v.status IN ('pending', 'approved')
         ORDER BY v.start_date, v.id`,
      this.prisma.$queryRaw<PatternRow[]>`
        SELECT p.employee_id, p.weekday, p.mode::text AS mode
          FROM work_patterns p JOIN employees e ON e.id = p.employee_id
         WHERE ${scope}`,
      this.prisma.$queryRaw<OverrideRow[]>`
        SELECT o.employee_id, to_char(o.date, 'YYYY-MM-DD') AS d, o.mode::text AS mode
          FROM work_overrides o JOIN employees e ON e.id = o.employee_id
         WHERE ${scope} AND o.date >= ${from} AND o.date <= ${to}
         ORDER BY o.date`,
      this.prisma.orgSettings.findUnique({ where: { id: 1 } }),
    ]);

    const byEmployee = <T extends { employee_id: number }>(rows: T[]) => {
      const m = new Map<number, T[]>();
      for (const r of rows) {
        const list = m.get(r.employee_id);
        if (list) list.push(r); else m.set(r.employee_id, [r]);
      }
      return m;
    };
    const vac = byEmployee(vacations);
    const pat = byEmployee(patterns);
    const ovr = byEmployee(overrides);
    const threshold = (settings?.conflictThreshold ?? 50) / 100;
    const people = employees.map((e) => ({ ...e, dept: labels.label(e.dept_id) }));

    return {
      from: q.from,
      to: q.to,
      employees: people.map((e) => ({
        id: e.id,
        name: e.name,
        position: e.position,
        dept: e.dept,
        vacations: (vac.get(e.id) ?? []).map((v) => ({ requestId: v.id, start: v.s, end: v.e, type: v.type, status: v.status })),
        workPattern: Object.fromEntries((pat.get(e.id) ?? []).map((p) => [p.weekday, p.mode])),
        workOverrides: (ovr.get(e.id) ?? []).map((o) => ({ date: o.d, mode: o.mode })),
      })),
      conflicts: conflictDays(q.from, q.to, threshold, people,
        vacations.filter((v) => v.status === 'approved').map((v) => ({ employeeId: v.employee_id, start: v.s, end: v.e }))),
    };
  }
}
