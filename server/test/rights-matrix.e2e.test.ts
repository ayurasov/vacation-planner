// Матрица прав (v1.0.0, E50-02): каждая операция контракта — каждой ролью.
// Ожидание 'ok' — права пройдены: ответ не 401, не 403 и не 5xx (400, 404 и 409 — проверки данных после прав);
// число — точный код: 401 для анонима, 403 для запрета, 404 там, где сервер не раскрывает чужой объект.
// Полнота: каждый operationId контракта встречается в матрице — новая операция без строки здесь роняет тест.
// Человекочитаемая матрица — docs/specs/02-api-spec.md, «Матрица прав»; расхождение — ошибка одной из них.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NEXT_YEAR, createTestApp, destroyTestApp, login, type TestApp } from './helpers';

type Role = 'anon' | 'employee' | 'manager' | 'hr' | 'admin';
type Expect = 'ok' | 401 | 403 | 404;
type Matrix = Record<Role, Expect>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const ROLES: Role[] = ['anon', 'employee', 'manager', 'hr', 'admin'];
// Типовые строки матрицы
const ALL: Matrix = { anon: 401, employee: 'ok', manager: 'ok', hr: 'ok', admin: 'ok' };
const HR: Matrix = { anon: 401, employee: 403, manager: 403, hr: 'ok', admin: 'ok' };
const ADMIN: Matrix = { anon: 401, employee: 403, manager: 403, hr: 403, admin: 'ok' };
const PUBLIC: Matrix = { anon: 'ok', employee: 'ok', manager: 'ok', hr: 'ok', admin: 'ok' };

interface Fixture {
  t: TestApp;
  /** admin2 — второй администратор: цель операций над учётной записью администратора (сам себе сбросить пароль
   *  администратор фикстуры не должен — его сеанс нужен остальным проверкам) */
  ids: Record<'employee' | 'manager' | 'hr' | 'admin' | 'admin2' | 'other', number>;
  dept: string;
  otherDept: string;
  noticeId: number;
  notificationId: number;
  groupId: number;
}

interface Case {
  op: string;
  what: string;
  expect: Matrix;
  /** Запрос от имени роли; объекты, которые операция меняет, создаются для каждой роли заново. */
  run: (as: Caller, f: Fixture, role: Role) => Promise<request.Response>;
  /** Операция завершает текущий сеанс — после неё роль входит заново. */
  relogin?: boolean;
}

type Caller = (method: Method, path: string, body?: object) => Promise<request.Response>;

let seq = 0;
const next = () => ++seq;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (offset: number) => iso(new Date(Date.now() + offset * 86_400_000));

/** Заявка на согласовании — своя у каждой роли и каждой проверки. Даты не пересекаются. */
async function pending(f: Fixture, employeeId = f.ids.employee): Promise<number> {
  const n = next();
  const start = new Date(Date.UTC(NEXT_YEAR, 0, 10 + 3 * n));
  const r = await f.t.prisma.vacationRequest.create({
    data: { employeeId, startDate: start, endDate: new Date(start.getTime() + 86_400_000), createdBy: employeeId, pendingSince: new Date() },
  });
  return r.id;
}

/** Подчинённый руководителя фикстуры — цель для операций кадровой службы над учётной записью. */
async function person(f: Fixture): Promise<number> {
  const n = next();
  const e = await f.t.prisma.employee.create({
    data: { login: `matrix.${n}`, passwordHash: 'x', name: `Матрицев ${n}`, deptId: (await dept(f, f.dept)).id, managerId: f.ids.manager },
  });
  return e.id;
}

const dept = (f: Fixture, name: string) => f.t.prisma.department.findFirstOrThrow({ where: { name } });

const CASES: Case[] = [
  // ── Вход и сеансы
  { op: 'login', what: 'вход по паролю', expect: PUBLIC, run: (as, f) => as('post', '/auth/login', { login: f.t.employee.login, password: f.t.employee.password }) },
  { op: 'refresh', what: 'без refresh-cookie — 401 у всех', expect: { anon: 401, employee: 401, manager: 401, hr: 401, admin: 401 }, run: (as) => as('post', '/auth/refresh') },
  {
    op: 'changeOwnPassword', what: 'новый пароль равен текущему — 400 после проверки прав', expect: ALL,
    run: (as, f, role) => { const p = password(f, role); return as('post', '/auth/password', { oldPassword: p, newPassword: p }); },
  },
  { op: 'getPasswordPolicy', what: 'требования к паролю', expect: PUBLIC, run: (as) => as('get', '/auth/password-policy') },
  { op: 'listMySessions', what: 'свои сеансы', expect: ALL, run: (as) => as('get', '/auth/sessions') },
  // Чужой или несуществующий сеанс — 204 без изменений: не раскрывается, есть ли такой (чужой не завершается — security.e2e)
  { op: 'revokeMySession', what: 'несуществующий сеанс', expect: ALL, run: (as) => as('delete', '/auth/sessions/00000000-0000-4000-8000-000000000000') },
  { op: 'revokeOtherSessions', what: 'свои прочие сеансы', expect: ALL, run: (as) => as('post', '/auth/sessions/revoke-others') },
  { op: 'logout', what: 'выход', expect: ALL, run: (as) => as('post', '/auth/logout'), relogin: true },
  { op: 'getMe', what: 'текущий пользователь', expect: ALL, run: (as) => as('get', '/auth/me') },
  { op: 'updateMyPreferences', what: 'письма о заявках', expect: ALL, run: (as) => as('patch', '/auth/me', { emailNotifications: true }) },
  { op: 'getSsoConfig', what: 'настройки единого входа', expect: PUBLIC, run: (as) => as('get', '/auth/oidc/config') },
  { op: 'startSso', what: 'единый вход не настроен', expect: PUBLIC, run: (as) => as('get', '/auth/oidc/start') },
  { op: 'ssoCallback', what: 'возврат без состояния', expect: PUBLIC, run: (as) => as('get', '/auth/oidc/callback?code=x&state=y') },

  // ── Аудит
  { op: 'listLoginEvents', what: 'журнал входов', expect: HR, run: (as) => as('get', '/login-events') },
  { op: 'listAuditEvents', what: 'журнал изменений', expect: HR, run: (as) => as('get', '/audit-events') },

  // ── Замещение
  { op: 'listDelegations', what: 'свои замещения', expect: ALL, run: (as) => as('get', '/delegations') },
  {
    // Без подчинённых — 400 «передавать нечего»: отказ правила, а не прав
    op: 'createDelegation', what: 'своё согласование заместителю', expect: ALL,
    run: (as, f) => as('post', '/delegations', { deputyId: f.ids.other, start: day(30 + next()), end: day(60) }),
  },
  {
    // Для самого руководителя фикстуры это своё замещение (пересечение с предыдущим — 400)
    op: 'createDelegation', what: 'за другого руководителя', expect: { ...HR, manager: 'ok' },
    run: (as, f) => as('post', '/delegations', { managerId: f.ids.manager, deputyId: f.ids.other, start: day(30 + next()), end: day(60) }),
  },
  {
    op: 'revokeDelegation', what: 'замещение руководителя фикстуры', expect: { ...HR, manager: 'ok' },
    run: async (as, f) => {
      const d = await f.t.prisma.approvalDelegation.create({
        data: { managerId: f.ids.manager, deputyId: f.ids.other, startDate: new Date(day(70)), endDate: new Date(day(80)), createdBy: f.ids.manager },
      });
      return as('delete', `/delegations/${d.id}`);
    },
  },

  // ── Извещения
  { op: 'listMyNotices', what: 'свои извещения', expect: ALL, run: (as) => as('get', '/notices/mine') },
  { op: 'listNotices', what: 'журнал извещений', expect: HR, run: (as) => as('get', `/notices?from=${day(-30)}&to=${day(300)}`) },
  { op: 'getNotice', what: 'извещение сотрудника фикстуры', expect: { ...HR, employee: 'ok', manager: 404 }, run: (as, f) => as('get', `/notices/${f.noticeId}`) },
  { op: 'acknowledgeNotice', what: 'ознакомиться может только сам сотрудник', expect: { anon: 401, employee: 'ok', manager: 404, hr: 404, admin: 404 }, run: (as, f) => as('post', `/notices/${f.noticeId}/acknowledge`) },

  // ── Планирование и форма Т-7
  { op: 'getMyPlanning', what: 'своё планирование', expect: ALL, run: (as) => as('get', '/planning/mine') },
  { op: 'getPlanning', what: 'ход кампании', expect: HR, run: (as) => as('get', `/planning/${NEXT_YEAR}`) },
  { op: 'listPlanningEmployees', what: 'прогресс по сотрудникам', expect: HR, run: (as) => as('get', `/planning/${NEXT_YEAR}/employees`) },
  { op: 'openPlanning', what: 'открыть кампанию', expect: HR, run: (as) => as('post', `/planning/${NEXT_YEAR}/open`, { deadline: day(40) }) },
  { op: 'remindPlanning', what: 'напомнить', expect: HR, run: (as) => as('post', `/planning/${NEXT_YEAR}/remind`) },
  { op: 'closePlanning', what: 'закрыть кампанию', expect: HR, run: (as) => as('post', `/planning/${NEXT_YEAR}/close`) },
  {
    op: 'approveSchedule', what: 'утвердить график (без согласованных отпусков — 400)', expect: HR,
    run: (as) => as('post', `/planning/${NEXT_YEAR + 1}/approve`, { docNumber: '1', docDate: day(0) }),
  },

  // ── Сотрудники
  { op: 'listEmployees', what: 'список сотрудников', expect: ALL, run: (as) => as('get', '/employees?per_page=5') },
  {
    op: 'createEmployee', what: 'создать сотрудника', expect: HR,
    run: (as) => as('post', '/employees', { name: `Созданов ${next()}`, login: `created.${seq}` }),
  },
  { op: 'getEmployee', what: 'карточка коллеги', expect: ALL, run: (as, f) => as('get', `/employees/${f.ids.other}`) },
  { op: 'updateEmployee', what: 'должность подчинённого', expect: HR, run: async (as, f) => as('patch', `/employees/${await person(f)}`, { position: 'Инженер' }) },
  { op: 'deleteEmployee', what: 'уволить', expect: HR, run: async (as, f) => as('delete', `/employees/${await person(f)}`) },
  {
    op: 'changePassword', what: 'свой пароль: новый равен текущему — 400', expect: ALL,
    run: (as, f, role) => { const p = password(f, role); return as('put', `/employees/${f.ids[role === 'anon' ? 'employee' : role]}/password`, { oldPassword: p, newPassword: p }); },
  },
  { op: 'changePassword', what: 'пароль подчинённому', expect: HR, run: async (as, f) => as('put', `/employees/${await person(f)}/password`, { newPassword: 'Matrix-pass-2026' }) },
  { op: 'changePassword', what: 'пароль администратору', expect: ADMIN, run: (as, f) => as('put', `/employees/${f.ids.admin2}/password`, { newPassword: 'Matrix-pass-2026' }) },
  { op: 'resetPassword', what: 'сброс пароля подчинённому', expect: HR, run: async (as, f) => as('post', `/employees/${await person(f)}/password-reset`) },
  { op: 'resetPassword', what: 'сброс пароля администратору', expect: ADMIN, run: (as, f) => as('post', `/employees/${f.ids.admin2}/password-reset`) },
  { op: 'getEmployeeSecurity', what: 'учётная запись сотрудника', expect: HR, run: (as, f) => as('get', `/employees/${f.ids.employee}/security`) },
  { op: 'unlockEmployee', what: 'снять блокировку', expect: HR, run: async (as, f) => as('post', `/employees/${await person(f)}/unlock`) },
  { op: 'revokeEmployeeSessions', what: 'завершить сеансы подчинённого', expect: HR, run: async (as, f) => as('post', `/employees/${await person(f)}/sessions/revoke`) },

  // ── Баланс, график работы
  { op: 'getBalance', what: 'баланс сотрудника фикстуры', expect: { ...ALL }, run: (as, f) => as('get', `/employees/${f.ids.employee}/balance?year=${NEXT_YEAR}`) },
  { op: 'getBalance', what: 'баланс чужого сотрудника', expect: { ...HR }, run: (as, f) => as('get', `/employees/${f.ids.other}/balance?year=${NEXT_YEAR}`) },
  { op: 'setWorkPattern', what: 'шаблон сотрудника фикстуры', expect: { ...ADMIN, employee: 'ok', manager: 'ok' }, run: (as, f) => as('put', `/employees/${f.ids.employee}/work-pattern`, { 1: 'office', 2: 'remote' }) },
  { op: 'setWorkOverride', what: 'исключение сотрудника фикстуры', expect: { ...ADMIN, employee: 'ok', manager: 'ok' }, run: (as, f) => as('put', `/employees/${f.ids.employee}/work-overrides`, { date: day(5), mode: 'remote' }) },
  { op: 'getWorkSchedule', what: 'график работы чужого сотрудника', expect: { ...HR }, run: (as, f) => as('get', `/employees/${f.ids.other}/work-schedule?from=${day(0)}&to=${day(30)}`) },
  { op: 'getWorkSchedule', what: 'график работы сотрудника фикстуры', expect: ALL, run: (as, f) => as('get', `/employees/${f.ids.employee}/work-schedule?from=${day(0)}&to=${day(30)}`) },
  { op: 'deleteWorkOverride', what: 'снять исключение', expect: { ...ADMIN, employee: 'ok', manager: 'ok' }, run: (as, f) => as('delete', `/employees/${f.ids.employee}/work-overrides/${day(5)}`) },
  { op: 'getSchedule', what: 'график организации', expect: ALL, run: (as) => as('get', `/schedule?from=${day(0)}&to=${day(60)}`) },

  // ── Заявки
  { op: 'listVacationRequests', what: 'свои', expect: ALL, run: (as) => as('get', '/vacation-requests?scope=mine') },
  { op: 'listVacationRequests', what: 'все', expect: ADMIN, run: (as) => as('get', '/vacation-requests?scope=all') },
  {
    op: 'createVacationRequest', what: 'за себя', expect: ALL,
    run: (as) => { const s = new Date(Date.UTC(NEXT_YEAR, 11, 1 + next() % 20)); return as('post', '/vacation-requests', { start: iso(s), end: iso(s) }); },
  },
  {
    op: 'createVacationRequest', what: 'за сотрудника фикстуры', expect: { ...ADMIN, manager: 'ok', employee: 'ok' },
    run: (as, f) => { const s = new Date(Date.UTC(NEXT_YEAR, 10, 1 + next() % 25)); return as('post', '/vacation-requests', { employee: f.ids.employee, start: iso(s), end: iso(s) }); },
  },
  { op: 'getVacationRequest', what: 'заявка сотрудника фикстуры', expect: { ...ADMIN, employee: 'ok', manager: 'ok' }, run: async (as, f) => as('get', `/vacation-requests/${await pending(f)}`) },
  { op: 'updateVacationRequest', what: 'комментарий к заявке сотрудника фикстуры', expect: { ...ADMIN, employee: 'ok', manager: 'ok' }, run: async (as, f) => as('patch', `/vacation-requests/${await pending(f)}`, { comment: 'Матрица прав' }) },
  { op: 'cancelVacationRequest', what: 'отмена заявки сотрудника фикстуры', expect: { ...ADMIN, employee: 'ok', manager: 'ok' }, run: async (as, f) => as('delete', `/vacation-requests/${await pending(f)}`) },
  { op: 'approveVacationRequest', what: 'согласование заявки подчинённого', expect: { ...ADMIN, manager: 'ok' }, run: async (as, f) => as('post', `/vacation-requests/${await pending(f)}/approve`, {}) },
  { op: 'rejectVacationRequest', what: 'отклонение заявки подчинённого', expect: { ...ADMIN, manager: 'ok' }, run: async (as, f) => as('post', `/vacation-requests/${await pending(f)}/reject`, { comment: 'Пересечение' }) },

  // ── Справочники
  { op: 'listDepartments', what: 'отделы', expect: ALL, run: (as) => as('get', '/departments') },
  { op: 'createDepartment', what: 'создать отдел', expect: HR, run: (as) => as('post', '/departments', { name: `Отдел матрицы ${next()}` }) },
  {
    op: 'updateDepartment', what: 'переименовать отдел', expect: HR,
    run: async (as, f) => { const d = await f.t.prisma.department.create({ data: { name: `Отдел ${next()}` } }); return as('patch', `/departments/${encodeURIComponent(d.name)}`, { name: `${d.name} новый` }); },
  },
  {
    op: 'deleteDepartment', what: 'удалить пустой отдел', expect: HR,
    run: async (as, f) => { const d = await f.t.prisma.department.create({ data: { name: `Отдел ${next()}` } }); return as('delete', `/departments/${encodeURIComponent(d.name)}`); },
  },
  { op: 'listProjects', what: 'проекты', expect: ALL, run: (as) => as('get', '/projects') },
  { op: 'createProject', what: 'создать проект', expect: HR, run: (as) => as('post', '/projects', { name: `Проект матрицы ${next()}` }) },
  {
    op: 'updateProject', what: 'переименовать проект', expect: HR,
    run: async (as, f) => { const p = await f.t.prisma.project.create({ data: { name: `Проект ${next()}` } }); return as('patch', `/projects/${p.id}`, { name: `Проект ${seq} новый` }); },
  },
  {
    op: 'deleteProject', what: 'удалить проект', expect: HR,
    run: async (as, f) => { const p = await f.t.prisma.project.create({ data: { name: `Проект ${next()}` } }); return as('delete', `/projects/${p.id}`); },
  },
  { op: 'listGroups', what: 'свои группы', expect: ALL, run: (as) => as('get', '/groups') },
  { op: 'createGroup', what: 'своя группа', expect: ALL, run: (as, f) => as('post', '/groups', { name: `Группа ${next()}`, members: [f.ids.other] }) },
  { op: 'updateGroup', what: 'группа сотрудника фикстуры — чужим 404', expect: { anon: 401, employee: 'ok', manager: 404, hr: 404, admin: 404 }, run: (as, f) => as('patch', `/groups/${f.groupId}`, { name: `Своя ${next()}` }) },
  {
    op: 'deleteGroup', what: 'группа сотрудника фикстуры — чужим 404', expect: { anon: 401, employee: 'ok', manager: 404, hr: 404, admin: 404 },
    run: async (as, f, role) => {
      // Владелец удаляет свою, остальные пытаются удалить группу владельца — она остаётся
      const g = role === 'employee' ? (await f.t.prisma.group.create({ data: { ownerId: f.ids.employee, name: `Удаляемая ${next()}` } })).id : f.groupId;
      return as('delete', `/groups/${g}`);
    },
  },

  // ── Настройки и календарь
  { op: 'getSettings', what: 'правила организации', expect: ALL, run: (as) => as('get', '/settings') },
  { op: 'updateSettings', what: 'изменить правила', expect: ADMIN, run: (as) => as('patch', '/settings', { conflictThreshold: 30 }) },
  { op: 'sendTestEmail', what: 'проверочное письмо (без SMTP — 400)', expect: ADMIN, run: (as) => as('post', '/settings/test-email') },
  { op: 'getHolidays', what: 'производственный календарь — открыт без входа', expect: PUBLIC, run: (as) => as('get', `/calendar/holidays/${NEXT_YEAR}`) },
  { op: 'setHolidays', what: 'изменить календарь', expect: HR, run: (as) => as('put', `/calendar/holidays/${NEXT_YEAR + 2}`, { holidays: [`${NEXT_YEAR + 2}-01-01`], transfers: [] }) },

  // ── Уведомления
  { op: 'listNotifications', what: 'свои уведомления', expect: ALL, run: (as) => as('get', '/notifications') },
  { op: 'markAllNotificationsRead', what: 'прочитать все свои', expect: ALL, run: (as) => as('post', '/notifications/read-all') },
  // Чужое уведомление не меняется (отбор по владельцу), ответ тот же 204 — проверка ниже
  { op: 'markNotificationRead', what: 'отметка своего уведомления', expect: ALL, run: (as, f) => as('post', `/notifications/${f.notificationId}/read`) },

  // ── Импорт, поток событий, выгрузки
  { op: 'importEmployees', what: 'импорт без файла — 400 после проверки прав', expect: HR, run: (as) => as('post', '/imports/employees?dryRun=true') },
  { op: 'getImportTemplate', what: 'шаблон импорта', expect: HR, run: (as) => as('get', '/imports/employees/template') },
  { op: 'getEventsTicket', what: 'билет на поток событий', expect: ALL, run: (as) => as('post', '/events/ticket') },
  { op: 'streamEvents', what: 'неверный билет — 401 у всех', expect: { anon: 401, employee: 401, manager: 401, hr: 401, admin: 401 }, run: (as) => as('get', '/events?ticket=invalid') },
  { op: 'exportVacations', what: 'выгрузка графика', expect: { ...HR, manager: 'ok' }, run: (as) => as('get', `/reports/vacations?from=${day(0)}&to=${day(60)}`) },
  { op: 'exportT7', what: 'форма Т-7', expect: HR, run: (as) => as('get', `/reports/t7?year=${NEXT_YEAR}`) },
  { op: 'exportNotices', what: 'журнал извещений XLSX', expect: HR, run: (as) => as('get', `/reports/notices?from=${day(-30)}&to=${day(300)}`) },

  // ── Аналитика
  { op: 'listAnalyticsDepartments', what: 'доступные отделы', expect: ALL, run: (as) => as('get', '/analytics/departments') },
  { op: 'getDepartmentOverview', what: 'свой отдел фикстуры', expect: { ...ALL, hr: 'ok' }, run: (as, f) => as('get', `/analytics/overview?dept=${encodeURIComponent(f.dept)}&year=${NEXT_YEAR}`) },
  { op: 'getDepartmentOverview', what: 'чужой отдел', expect: HR, run: (as, f) => as('get', `/analytics/overview?dept=${encodeURIComponent(f.otherDept)}&year=${NEXT_YEAR}`) },
  { op: 'getTeamToday', what: 'чужой отдел', expect: HR, run: (as, f) => as('get', `/analytics/team?dept=${encodeURIComponent(f.otherDept)}`) },
  { op: 'suggestVacationDates', what: 'для себя', expect: ALL, run: (as) => as('get', '/analytics/suggestions?days=7') },
  { op: 'suggestVacationDates', what: 'для чужого сотрудника', expect: HR, run: (as, f) => as('get', `/analytics/suggestions?days=7&employee=${f.ids.other}`) },
];

function password(f: Fixture, role: Role): string {
  return role === 'anon' ? 'x' : f.t[role].password;
}

describe('матрица прав: каждая операция контракта — каждой ролью', () => {
  let f: Fixture;
  const tokens: Partial<Record<Role, string>> = {};
  const signIn = async (role: Exclude<Role, 'anon'>) => { tokens[role] = await login(f.t, f.t[role]); };

  const caller = (role: Role): Caller => (method, path, body) => {
    let r = f.t.http()[method](`/api/v1${path}`);
    if (role !== 'anon') r = r.set('Authorization', `Bearer ${tokens[role]}`);
    return body === undefined ? r : r.send(body);
  };

  beforeAll(async () => {
    const t = await createTestApp();
    const p = t.prisma;
    const otherDept = await p.department.create({ data: { name: 'Чужой отдел' } });
    const other = await p.employee.create({ data: { login: 'other.test', passwordHash: 'x', name: 'Чужаков Тест', deptId: otherDept.id } });
    const admin2 = await p.employee.create({ data: { login: 'admin2.test', passwordHash: 'x', name: 'Второй Администратор', isAdmin: true } });
    const own = await p.employee.findUniqueOrThrow({ where: { id: t.employee.id }, include: { dept: true } });
    const vacation = await p.vacationRequest.create({
      data: { employeeId: t.employee.id, startDate: new Date(day(20)), endDate: new Date(day(26)), status: 'approved', createdBy: t.employee.id },
    });
    const notice = await p.vacationNotice.create({
      data: { requestId: vacation.id, employeeId: t.employee.id, startDate: vacation.startDate, endDate: vacation.endDate, days: 7 },
    });
    const notification = await p.notification.create({ data: { employeeId: t.employee.id, kind: 'test', text: 'Матрица прав' } });
    const group = await p.group.create({ data: { ownerId: t.employee.id, name: 'Своя группа' } });
    f = {
      t,
      ids: { employee: t.employee.id, manager: t.manager.id, hr: t.hr.id, admin: t.admin.id, admin2: admin2.id, other: other.id },
      dept: own.dept!.name, otherDept: otherDept.name,
      noticeId: notice.id, notificationId: notification.id, groupId: group.id,
    };
    for (const role of ['employee', 'manager', 'hr', 'admin'] as const) await signIn(role);
  });
  afterAll(async () => { await destroyTestApp(f.t); });

  it('матрица покрывает каждую операцию контракта', () => {
    const spec = load(readFileSync(join(__dirname, '../../contracts/openapi-vacation-api-v1.yaml'), 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const ops = Object.values(spec.paths).flatMap((p) => Object.values(p).map((o) => o.operationId).filter(Boolean));
    const covered = new Set(CASES.map((c) => c.op));
    expect(ops.filter((op) => !covered.has(op!))).toEqual([]);
    expect([...covered].filter((op) => !ops.includes(op))).toEqual([]);
  });

  it('карточка коллеги без служебной роли — справочная: без логина, почты, норм дней, табельного номера и прав', async () => {
    await f.t.prisma.employee.update({ where: { id: f.ids.other }, data: { email: 'other@corp.ru', personnelNumber: 'T-777', plannedDays: 31 } });
    const hidden = ['login', 'email', 'plannedDays', 'carryOver', 'personnelNumber', 'isAdmin', 'isHr'];
    const card = (await caller('employee')('get', `/employees/${f.ids.other}`)).body;
    expect(card).toMatchObject({ id: f.ids.other, name: 'Чужаков Тест', deptName: f.otherDept });
    for (const k of hidden) expect(card).not.toHaveProperty(k);
    const listed = (await caller('employee')('get', '/employees?per_page=200')).body.items as Array<Record<string, unknown>>;
    expect(listed.find((e) => e.id === f.ids.other)).not.toHaveProperty('plannedDays');
    expect(listed.find((e) => e.id === f.ids.employee)).toHaveProperty('plannedDays'); // себя — полностью
    // Руководитель видит подчинённого полностью, кадровая служба — всех
    expect((await caller('manager')('get', `/employees/${f.ids.employee}`)).body).toHaveProperty('plannedDays');
    expect((await caller('hr')('get', `/employees/${f.ids.other}`)).body).toMatchObject({ personnelNumber: 'T-777', email: 'other@corp.ru' });
    // Поиск по табельному номеру — только служебным ролям
    expect((await caller('employee')('get', '/employees?search=T-777')).body.items).toHaveLength(0);
    expect((await caller('hr')('get', '/employees?search=T-777')).body.items).toHaveLength(1);
  });

  it('чужое уведомление не помечается прочитанным', async () => {
    const n = await f.t.prisma.notification.create({ data: { employeeId: f.ids.other, kind: 'test', text: 'Чужое' } });
    for (const role of ['employee', 'manager', 'hr', 'admin'] as const) await caller(role)('post', `/notifications/${n.id}/read`);
    expect((await f.t.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(false);
  });

  for (const c of CASES) {
    it(`${c.op} — ${c.what}`, async () => {
      const got: Partial<Record<Role, number>> = {};
      const wrong: string[] = [];
      for (const role of ROLES) {
        const res = await c.run(caller(role), f, role);
        got[role] = res.status;
        const want = c.expect[role];
        const ok = want === 'ok' ? ![401, 403].includes(res.status) && res.status < 500 : res.status === want;
        if (!ok) wrong.push(`${role}: ожидалось ${want}, получено ${res.status} ${res.body?.type ?? ''} ${res.body?.detail ?? ''}`.trim());
        if (c.relogin && role !== 'anon') await signIn(role);
      }
      expect(wrong.join('; '), JSON.stringify(got)).toBe('');
    });
  }
});
