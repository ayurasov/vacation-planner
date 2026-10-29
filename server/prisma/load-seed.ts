// Данные для нагрузочной проверки (E40-02, E51-01): N сотрудников, отделы по ~33 человека, иерархия
// руководителей, отпуска на текущий и следующий год, режимы работы; с --history Y — Y прошлых лет
// работы организации: отпуска с историей и аудитом, уведомления и письма, извещения, кампании и
// утверждённые графики, журнал входов за год, сеансы за 30 дней. Детерминированно (свой ГПСЧ).
//   DATABASE_URL=…/vacation_load npm run db:seed:load [-- --employees 2000 --history 5]
// Запускается только на БД, в имени которой есть «load»: стирает все данные.
import { Prisma, PrismaClient, type WorkMode } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth/passwords';

const prisma = new PrismaClient();
const argN = process.argv.indexOf('--employees');
const N = argN > 0 ? Number(process.argv[argN + 1]) : 5000;
const argH = process.argv.indexOf('--history');
const HISTORY = argH > 0 ? Number(process.argv[argH + 1]) : 0;
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
    notifications, work_patterns, work_overrides, audit_events, refresh_tokens, org_settings, calendars, email_outbox, job_runs,
    login_events, login_state, approval_delegations, vacation_notices, planning_campaigns, schedule_approvals RESTART IDENTITY CASCADE`);
  await prisma.orgSettings.create({ data: { id: 1 } });
  const law = (y: number) => [...Array.from({ length: 8 }, (_, i) => `${y}-01-0${i + 1}`), `${y}-02-23`, `${y}-03-08`, `${y}-05-01`, `${y}-05-09`, `${y}-06-12`, `${y}-11-04`];
  const year = new Date().getUTCFullYear();
  for (const y of [...Array.from({ length: HISTORY }, (_, i) => year - HISTORY + i), year, year + 1]) await prisma.productionCalendar.create({ data: { year: y, holidays: law(y), transfers: [] } });

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
    await prisma.employee.createMany({
      data: rows.slice(i, i + 1000).map((r, k) => ({
        ...r, passwordHash: hash, plannedDays: 28, carryOver: int(0, 10),
        // Адрес и табельный номер — как у организации после импорта: письма уходят всем
        email: `${r.login}@load.local`, personnelNumber: String(i + k + 1).padStart(6, '0'),
      })),
    });
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
  const history = HISTORY > 0 ? await seedHistory(all.slice(1).map((e) => e.id), admin.id, year) : null;
  console.log(`Готово: сотрудников ${all.length}, отделов ${deptCount}, заявок ${reqs.length}, режимов ${patterns.length}. Пароль: ${LOAD_PASSWORD}`);
  if (history) console.log(`История за ${HISTORY} ${HISTORY === 1 ? 'год' : HISTORY < 5 ? 'года' : 'лет'}: ${JSON.stringify(history)}`);
}

/** Пачками: createMany по 5000 строк. */
async function bulk<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<number> {
  for (let i = 0; i < rows.length; i += 5000) await insert(rows.slice(i, i + 5000));
  return rows.length;
}

const ts = (isoDay: string, hours = 10) => new Date(`${isoDay}T${String(hours).padStart(2, '0')}:00:00Z`);
const shift = (isoDay: string, days: number) => new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const LETTER = 'Здравствуйте!\n\nОтпуск согласован руководителем. Подробности — в разделе «Мой отпуск».\n\n—\nПисьмо отправлено планировщиком отпусков автоматически.';

/**
 * Прошлые годы работы организации (E51-01, E51-08): на каждую часть отпуска — заявка с событиями
 * «создана» и «согласована» (5 % отменены), две записи аудита, уведомления руководителю и
 * сотруднику (прочитаны) и по письму на каждое, извещение с ознакомлением; на год — кампания,
 * приглашения всем и утверждённый график; журнал входов — за последний год (срок хранения),
 * refresh-токены — за 30 дней: сотрудник работает в планировщике раз в несколько дней.
 */
async function seedHistory(ids: number[], adminId: number, year: number) {
  const managerOf = new Map((await prisma.employee.findMany({ select: { id: true, managerId: true } })).map((e) => [e.id, e.managerId ?? adminId]));
  const counts = { requests: 0, events: 0, audit: 0, notifications: 0, letters: 0, notices: 0, approvals: 0, loginEvents: 0, refreshTokens: 0 };
  for (let y = year - HISTORY; y < year; y++) {
    type Part = { employeeId: number; start: string; end: string; cancelled: boolean };
    const parts: Part[] = [];
    for (const id of ids) {
      let cursor = int(10, 60);
      for (const len of [14, int(5, 9), ...(rnd() < 0.5 ? [int(5, 9)] : [])]) {
        const start = cursor + int(0, 80);
        if (start + len >= 360) break;
        parts.push({ employeeId: id, start: iso(y, start), end: iso(y, start + len - 1), cancelled: rnd() < 0.05 });
        cursor = start + len + 7;
      }
    }
    const created = await prisma.vacationRequest.createManyAndReturn({
      data: parts.map((p) => ({
        employeeId: p.employeeId, startDate: new Date(p.start), endDate: new Date(p.end),
        status: p.cancelled ? 'cancelled' as const : 'approved' as const, createdBy: p.employeeId,
        createdAt: ts(shift(p.start, -60)), updatedAt: ts(shift(p.start, -58)),
      })),
      select: { id: true, employeeId: true, startDate: true, endDate: true, status: true },
    });
    counts.requests += created.length;
    counts.events += await bulk(created.flatMap((r) => {
      const day = r.startDate.toISOString().slice(0, 10);
      return [
        { requestId: r.id, actorId: r.employeeId, action: 'created', ts: ts(shift(day, -60)) },
        { requestId: r.id, actorId: managerOf.get(r.employeeId)!, action: r.status === 'cancelled' ? 'cancelled' : 'approved', ts: ts(shift(day, -58)) },
      ];
    }), (c) => prisma.requestEvent.createMany({ data: c }));
    counts.audit += await bulk(created.flatMap((r) => {
      const day = r.startDate.toISOString().slice(0, 10);
      return [
        { actorId: r.employeeId, action: 'request.created', entity: 'vacation_request', entityId: String(r.id), ts: ts(shift(day, -60)), after: { start: day } },
        { actorId: managerOf.get(r.employeeId)!, action: r.status === 'cancelled' ? 'request.cancelled' : 'request.approved', entity: 'vacation_request', entityId: String(r.id), ts: ts(shift(day, -58)) },
      ];
    }), (c) => prisma.auditEvent.createMany({ data: c }));
    const notes = created.flatMap((r) => {
      const day = r.startDate.toISOString().slice(0, 10);
      return [
        { employeeId: managerOf.get(r.employeeId)!, kind: 'request_created', text: `Новая заявка на отпуск ${day}`, isRead: true, createdAt: ts(shift(day, -60)) },
        { employeeId: r.employeeId, kind: r.status === 'cancelled' ? 'request_cancelled' : 'request_approved', text: `Отпуск ${day} согласован`, isRead: true, createdAt: ts(shift(day, -58)) },
        ...(r.status === 'approved' ? [{ employeeId: r.employeeId, kind: 'vacation_notice', text: `Извещение о начале отпуска ${day}`, isRead: true, createdAt: ts(shift(day, -14)) }] : []),
      ];
    });
    const campaign = ids.map((id) => ({ employeeId: id, kind: 'planning_open', text: `Открыто планирование отпусков на ${y} год`, isRead: true, createdAt: ts(`${y - 1}-11-01`) }));
    counts.notifications += await bulk([...notes, ...campaign], (c) => prisma.notification.createMany({ data: c }));
    counts.letters += await bulk([...notes, ...campaign].map((n) => ({
      employeeId: n.employeeId, to: `e${n.employeeId}@load.local`, kind: n.kind, subject: 'Планировщик отпусков', body: LETTER,
      status: 'sent', attempts: 1, createdAt: n.createdAt, nextAttemptAt: n.createdAt, sentAt: n.createdAt,
    })), (c) => prisma.emailOutbox.createMany({ data: c }));
    counts.notices += await bulk(created.filter((r) => r.status === 'approved').map((r) => {
      const day = r.startDate.toISOString().slice(0, 10);
      return {
        requestId: r.id, employeeId: r.employeeId, startDate: r.startDate, endDate: r.endDate, days: 7,
        sentAt: ts(shift(day, -14)), acknowledgedAt: ts(shift(day, -13)),
      };
    }), (c) => prisma.vacationNotice.createMany({ data: c }));
    await prisma.planningCampaign.create({ data: { year: y, deadline: new Date(`${y - 1}-11-30`), openedAt: ts(`${y - 1}-11-01`), openedBy: adminId, closedAt: ts(`${y - 1}-12-10`) } });
    await prisma.scheduleApproval.create({
      data: {
        year: y, docNumber: `${y}-ГО`, docDate: new Date(`${y - 1}-12-12`), approvedAt: ts(`${y - 1}-12-12`), approvedBy: adminId,
        rows: created.filter((r) => r.status === 'approved').map((r) => ({
          requestId: r.id, employeeId: r.employeeId, name: `Сотрудник ${r.employeeId}`, position: 'Специалист', dept: null,
          personnelNumber: String(r.employeeId).padStart(6, '0'), start: r.startDate.toISOString().slice(0, 10), end: r.endDate.toISOString().slice(0, 10), days: 7,
        })) as unknown as Prisma.InputJsonValue,
      },
    });
    counts.approvals++;
  }

  // Журнал входов за год: вход раз в ~две недели (refresh-cookie живёт 30 дней), 3 % — неудачные
  const now = Date.now();
  const logins: Prisma.LoginEventCreateManyInput[] = [];
  for (const id of ids) {
    for (let d = int(1, 14); d < 365; d += int(7, 21)) {
      const at = new Date(now - d * 86_400_000 + int(8, 18) * 3_600_000);
      if (rnd() < 0.03) logins.push({ ts: at, employeeId: id, login: `load.u${String(id).padStart(5, '0')}`, result: 'bad_password', method: 'password', ip: `10.0.${id >> 8 & 255}.${id & 255}`, userAgent: 'Mozilla/5.0 Chrome/130' });
      logins.push({ ts: at, employeeId: id, login: `load.u${String(id).padStart(5, '0')}`, result: 'success', method: 'password', ip: `10.0.${id >> 8 & 255}.${id & 255}`, userAgent: 'Mozilla/5.0 Chrome/130' });
    }
  }
  counts.loginEvents = await bulk(logins, (c) => prisma.loginEvent.createMany({ data: c }));

  // Refresh-токены за 30 дней: сотрудник работает раз в ~3 дня, за рабочую сессию ~4 обновления
  const tokens: Prisma.RefreshTokenCreateManyInput[] = [];
  for (const id of ids) {
    for (let d = int(0, 3); d < 30; d += int(2, 4)) {
      const sessionId = randomUUID();
      const startedAt = new Date(now - d * 86_400_000);
      for (let k = 0; k < 4; k++) {
        tokens.push({
          userId: id, tokenHash: createHash('sha256').update(`${id}:${d}:${k}:${rnd()}`).digest('hex'),
          expiresAt: new Date(startedAt.getTime() + 30 * 86_400_000), revokedAt: k < 3 ? new Date(startedAt.getTime() + (k + 1) * 900_000) : null,
          sessionId, sessionStartedAt: startedAt, method: 'password', ip: '10.0.0.1', userAgent: 'Mozilla/5.0 Chrome/130',
          createdAt: new Date(startedAt.getTime() + k * 900_000),
        });
      }
    }
  }
  counts.refreshTokens = await bulk(tokens, (c) => prisma.refreshToken.createMany({ data: c }));
  return counts;
}

main().finally(() => prisma.$disconnect());
