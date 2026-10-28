// Данные для нагрузочной проверки (E40-02): 5000 сотрудников, ~150 отделов, иерархия руководителей,
// отпуска на текущий и следующий год, режимы работы. Детерминированно (свой ГПСЧ) — прогоны сравнимы.
//   DATABASE_URL=…/vacation_load npm run db:seed:load [-- --employees 5000]
// Запускается только на БД, в имени которой есть «load»: стирает все данные.
import { PrismaClient, type WorkMode } from '@prisma/client';
import { hashPassword } from '../src/auth/passwords';

const prisma = new PrismaClient();
const argN = process.argv.indexOf('--employees');
const N = argN > 0 ? Number(process.argv[argN + 1]) : 5000;
export const LOAD_PASSWORD = 'load-pass-12345';

let seed = 20261029;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const LAST = ['Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Соколов', 'Михайлов', 'Новиков', 'Фёдоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев', 'Семёнов', 'Егоров', 'Павлов', 'Козлов', 'Степанов', 'Николаев', 'Орлов', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Зайцев', 'Соловьёв', 'Борисов', 'Яковлев', 'Григорьев'];
const FIRST_M = ['Александр', 'Дмитрий', 'Максим', 'Сергей', 'Андрей', 'Алексей', 'Артём', 'Илья', 'Кирилл', 'Михаил', 'Никита', 'Иван', 'Егор', 'Роман', 'Павел'];
const FIRST_F = ['Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Татьяна', 'Ирина', 'Екатерина', 'Светлана', 'Юлия', 'Анастасия', 'Дарья', 'Полина', 'Виктория', 'Ксения'];
const PATR = ['Александров', 'Дмитриев', 'Сергеев', 'Андреев', 'Алексеев', 'Михайлов', 'Иванов', 'Павлов', 'Николаев', 'Викторов'];
const POS = ['Инженер', 'Ведущий инженер', 'Аналитик', 'Специалист', 'Ведущий специалист', 'Разработчик', 'Тестировщик', 'Менеджер', 'Экономист', 'Юрист'];
const UNITS = ['Отдел продаж', 'Отдел закупок', 'Отдел разработки', 'Отдел тестирования', 'Отдел эксплуатации', 'Бухгалтерия', 'Отдел логистики', 'Отдел маркетинга', 'Отдел аналитики', 'Служба поддержки'];

function person(): string {
  const female = rnd() < 0.5;
  const last = pick(LAST);
  return female
    ? `${last.endsWith('ий') ? last : `${last}а`} ${pick(FIRST_F)} ${pick(PATR)}на`
    : `${last} ${pick(FIRST_M)} ${pick(PATR)}ич`;
}

const iso = (y: number, doy: number) => new Date(Date.UTC(y, 0, 1) + doy * 86400000).toISOString().slice(0, 10);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/load/i.test(new URL(url).pathname)) throw new Error('Нагрузочные данные пишутся только в БД с «load» в имени');
  console.log(`Нагрузочные данные: ${N} сотрудников → ${new URL(url).pathname}`);
  await prisma.$executeRawUnsafe(`TRUNCATE employees, departments, projects, groups, group_members, vacation_requests, request_events,
    notifications, work_patterns, work_overrides, audit_events, refresh_tokens, org_settings, calendars, email_outbox, job_runs RESTART IDENTITY CASCADE`);
  await prisma.orgSettings.create({ data: { id: 1 } });
  const law = (y: number) => [...Array.from({ length: 8 }, (_, i) => `${y}-01-0${i + 1}`), `${y}-02-23`, `${y}-03-08`, `${y}-05-01`, `${y}-05-09`, `${y}-06-12`, `${y}-11-04`];
  const year = new Date().getUTCFullYear();
  for (const y of [year, year + 1]) await prisma.productionCalendar.create({ data: { year: y, holidays: law(y), transfers: [] } });

  const hash = await hashPassword(LOAD_PASSWORD); // один хеш на всех: scrypt на 5000 учётных записей — минуты
  const deptCount = Math.max(1, Math.round(N / 33));
  const depts = await Promise.all(Array.from({ length: deptCount }, (_, i) =>
    prisma.department.create({ data: { name: `${UNITS[i % UNITS.length]} №${Math.floor(i / UNITS.length) + 1}` } })));

  // Сотрудники: 1 — администратор, далее по отделам; в отделе руководитель и тимлиды на каждые 10 человек
  const rows: Array<{ login: string; name: string; position: string; deptId: number | null; role: string; isAdmin: boolean; isHr: boolean }> = [];
  rows.push({ login: 'load.admin', name: 'Нагрузочный Администратор Тестович', position: 'Администратор', deptId: null, role: 'manager', isAdmin: true, isHr: false });
  for (let i = 1; i < N; i++) {
    const d = depts[(i - 1) % deptCount];
    rows.push({ login: `load.u${String(i).padStart(5, '0')}`, name: person(), position: pick(POS), deptId: d.id, role: 'employee', isAdmin: false, isHr: i <= 10 });
  }
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.employee.createMany({ data: rows.slice(i, i + 1000).map((r) => ({ ...r, passwordHash: hash, plannedDays: 28, carryOver: int(0, 10) })) });
  }
  const all = await prisma.employee.findMany({ select: { id: true, deptId: true }, orderBy: { id: 'asc' } });
  const admin = all[0];
  const byDept = new Map<number, number[]>();
  for (const e of all.slice(1)) byDept.set(e.deptId!, [...(byDept.get(e.deptId!) ?? []), e.id]);

  // Иерархия: руководитель отдела → тимлиды → сотрудники; руководители отделов подчинены администратору
  const updates: Array<Promise<unknown>> = [];
  for (const [deptId, ids] of byDept) {
    const head = ids[0];
    updates.push(prisma.department.update({ where: { id: deptId }, data: { managerId: head } }));
    updates.push(prisma.employee.update({ where: { id: head }, data: { role: 'manager', managerId: admin.id } }));
    const rest = ids.slice(1);
    for (let k = 0; k < rest.length; k += 10) {
      const lead = rest[k];
      updates.push(prisma.employee.update({ where: { id: lead }, data: { role: 'manager', managerId: head } }));
      const team = rest.slice(k + 1, k + 10);
      if (team.length) updates.push(prisma.employee.updateMany({ where: { id: { in: team } }, data: { managerId: lead } }));
    }
  }
  for (let i = 0; i < updates.length; i += 200) await Promise.all(updates.slice(i, i + 200));

  // Отпуска: в каждом году часть в 14 дней и 1–2 части по 5–9 дней без пересечений; 10 % — заявка на согласовании
  const reqs: Array<{ employeeId: number; startDate: Date; endDate: Date; status: 'approved' | 'pending'; createdBy: number }> = [];
  for (const e of all.slice(1)) {
    for (const y of [year, year + 1]) {
      const parts = [14, int(5, 9), ...(rnd() < 0.5 ? [int(5, 9)] : [])];
      let cursor = int(10, 60);
      for (const len of parts) {
        const start = cursor + int(0, 80);
        if (start + len >= 360) break;
        reqs.push({ employeeId: e.id, startDate: new Date(iso(y, start)), endDate: new Date(iso(y, start + len - 1)), status: 'approved', createdBy: e.id });
        cursor = start + len + 7;
      }
    }
    if (rnd() < 0.1) {
      const start = int(300, 350);
      reqs.push({ employeeId: e.id, startDate: new Date(iso(year + 1, start)), endDate: new Date(iso(year + 1, start + 6)), status: 'pending', createdBy: e.id });
    }
  }
  for (let i = 0; i < reqs.length; i += 2000) await prisma.vacationRequest.createMany({ data: reqs.slice(i, i + 2000) });

  // Режимы: треть сотрудников работает удалённо 1–2 дня в неделю
  const patterns: Array<{ employeeId: number; weekday: number; mode: WorkMode }> = [];
  for (const e of all.slice(1)) {
    if (rnd() < 0.33) {
      const days = new Set([int(1, 5), int(1, 5)]);
      for (const wd of days) patterns.push({ employeeId: e.id, weekday: wd, mode: 'remote' });
    }
  }
  await prisma.workPattern.createMany({ data: patterns });
  console.log(`Готово: сотрудников ${all.length}, отделов ${deptCount}, заявок ${reqs.length}, режимов ${patterns.length}. Пароль: ${LOAD_PASSWORD}`);
}

main().finally(() => prisma.$disconnect());
