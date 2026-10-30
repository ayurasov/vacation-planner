// E2E: письма о заявках (outbox) и еженедельная сводка руководителю (E32).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';
import { MailService } from '../src/mail/mail.service';
import { digestWeek, fmtRange, letterFor } from '../src/mail/letters';

const sent: Array<{ to: string; subject: string; text: string }> = [];
let failNext = 0;
const transport = {
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    if (failNext > 0) { failNext--; throw new Error('SMTP 421 временно недоступен'); }
    sent.push(m);
    return {};
  },
};

let t: TestApp;
let mail: MailService;
let emp: string;
let mgr: string;
let adm: string;

beforeAll(async () => {
  process.env.SMTP_HOST = 'smtp.test';
  process.env.APP_URL = 'https://otpusk.corp.test/';
  t = await createTestApp({ mail: transport });
  mail = t.app.get(MailService);
  await t.prisma.employee.update({ where: { id: t.employee.id }, data: { email: 'employee@corp.test' } });
  await t.prisma.employee.update({ where: { id: t.manager.id }, data: { email: 'manager@corp.test' } });
  await t.prisma.employee.update({ where: { id: t.admin.id }, data: { email: 'admin@corp.test' } });
  emp = await login(t, t.employee);
  mgr = await login(t, t.manager);
  adm = await login(t, t.admin);
});

afterAll(async () => {
  delete process.env.SMTP_HOST;
  delete process.env.APP_URL;
  await destroyTestApp(t);
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('письма о заявках', () => {
  it('заявка — письмо руководителю, решение — письмо сотруднику; с датами по-русски и ссылкой', async () => {
    const created = await t.http().post('/api/v1/vacation-requests').set(auth(emp))
      .send({ start: `${NEXT_YEAR}-07-01`, end: `${NEXT_YEAR}-07-14` });
    expect(created.status).toBe(201);
    expect(await mail.flush()).toEqual({ sent: 1, failed: 0 });
    expect(sent[0].to).toBe('manager@corp.test');
    expect(sent[0].subject).toBe('Заявка на согласование: Сотрудников Тест');
    expect(sent[0].text).toContain(`Новая заявка на отпуск 1–14 июля ${NEXT_YEAR}`);
    expect(sent[0].text).toContain('https://otpusk.corp.test/approvals');

    await t.http().post(`/api/v1/vacation-requests/${created.body.id}/approve`).set(auth(mgr)).send({});
    await mail.flush();
    expect(sent[1]).toMatchObject({ to: 'employee@corp.test', subject: 'Отпуск согласован' });
  });

  it('письмо создаётся в транзакции события: отказ в заявке — нет ни уведомления, ни письма', async () => {
    const before = await t.prisma.emailOutbox.count();
    const res = await t.http().post('/api/v1/vacation-requests').set(auth(emp))
      .send({ start: `${NEXT_YEAR}-07-05`, end: `${NEXT_YEAR}-07-08` }); // пересечение → 409
    expect(res.status).toBe(409);
    expect(await t.prisma.emailOutbox.count()).toBe(before);
  });

  it('сбой SMTP: письмо остаётся в очереди и уходит со следующей попытки', async () => {
    failNext = 1;
    await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send({ start: `${NEXT_YEAR}-09-01`, end: `${NEXT_YEAR}-09-03` });
    expect(await mail.flush()).toEqual({ sent: 0, failed: 1 });
    const row = await t.prisma.emailOutbox.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'SMTP 421 временно недоступен' });
    await t.prisma.emailOutbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } }); // «время пришло»
    expect(await mail.flush()).toEqual({ sent: 1, failed: 0 });
    expect((await t.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('sent');
  });

  it('отписка в профиле: уведомление в интерфейсе есть, письма нет; изменение в аудите', async () => {
    const res = await t.http().patch('/api/v1/auth/me').set(auth(mgr)).send({ emailNotifications: false });
    expect(res.status).toBe(200);
    expect(res.body.employee.emailNotifications).toBe(false);
    const before = await t.prisma.emailOutbox.count();
    await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send({ start: `${NEXT_YEAR}-10-05`, end: `${NEXT_YEAR}-10-06` });
    expect(await t.prisma.emailOutbox.count()).toBe(before);
    expect(await t.prisma.notification.count({ where: { employeeId: t.manager.id } })).toBeGreaterThan(0);
    expect(await t.prisma.auditEvent.count({ where: { action: 'employee.preferences_updated' } })).toBe(1);
    await t.http().patch('/api/v1/auth/me').set(auth(mgr)).send({ emailNotifications: true });
  });

  it('проверочное письмо администратору; сотруднику недоступно', async () => {
    const res = await t.http().post('/api/v1/settings/test-email').set(auth(adm));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ to: 'admin@corp.test', sent: true, error: null });
    expect((await t.http().post('/api/v1/settings/test-email').set(auth(emp))).status).toBe(403);
    expect((await t.http().get('/api/v1/settings').set(auth(emp))).body.mailEnabled).toBe(true);
  });
});

describe('разбор очереди (v1.0.0, E51-03)', () => {
  it('проход разбирает очередь пачками до конца, а не одну пачку в 15 секунд', async () => {
    await mail.drain(); // очередь предыдущих проверок
    const before = sent.length;
    await t.prisma.emailOutbox.createMany({
      data: Array.from({ length: 45 }, (_, i) => ({ to: `invite${i}@corp.test`, kind: 'planning_open', subject: 'Планирование отпусков', body: 'Приглашение' })),
    });
    expect(await mail.drain()).toEqual({ sent: 45, failed: 0 });
    expect(sent.length - before).toBe(45);
    expect(await t.prisma.emailOutbox.count({ where: { status: 'pending' } })).toBe(0);
  });
});

describe('еженедельная сводка', () => {
  it('в пятницу после 12:00 — руководителю: кто в отпуске на следующей неделе и сколько заявок ждут; один раз за неделю', async () => {
    // первая пятница августа следующего года, 13:00 по Москве; отпуск сотрудника — на следующей неделе
    let fri = Date.UTC(NEXT_YEAR, 7, 1, 10);
    while (new Date(fri).getUTCDay() !== 5) fri += 86400000;
    const now = new Date(fri);
    const week = digestWeek(now, 'Europe/Moscow')!;
    expect(new Date(`${week.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    const res = await t.http().post('/api/v1/vacation-requests').set(auth(mgr))
      .send({ employee: t.employee.id, start: week.weekStart, end: week.weekEnd });
    expect(res.status).toBe(201);
    sent.length = 0;
    expect(await mail.runDigest(now)).toBe(1);
    expect(await mail.runDigest(now)).toBe(0); // повтор в ту же неделю — ничего
    await mail.flush();
    const digest = sent.find((m) => m.subject.startsWith('Отпуска на неделе'))!;
    expect(digest.to).toBe('manager@corp.test');
    expect(digest.subject).toBe(`Отпуска на неделе ${fmtRange(week.weekStart, week.weekEnd)}`);
    expect(digest.text).toContain('Сотрудников Тест');
    expect(digest.text).toMatch(/Ждут вашего решения: \d+ заяв/);
  });
});

describe('тексты писем', () => {
  it('диапазоны дат и ссылки', () => {
    expect(fmtRange('2027-07-01', '2027-07-14')).toBe('1–14 июля 2027');
    expect(fmtRange('2027-06-28', '2027-07-05')).toBe('28 июня – 5 июля 2027');
    expect(fmtRange('2026-12-29', '2027-01-09')).toBe('29 декабря 2026 – 9 января 2027');
    const l = letterFor('request_rejected', 'Заявка отклонена. Причина: аврал', 'Иванов Иван Иванович', 'https://x');
    expect(l.body.startsWith('Здравствуйте, Иван Иванович!')).toBe(true);
    expect(l.body).toContain('https://x/my');
  });

  it('окно сводки: пятница после 12:00 по времени организации', () => {
    expect(digestWeek(new Date('2027-07-16T08:59:00Z'), 'Europe/Moscow')).toBeNull(); // 11:59 МСК
    expect(digestWeek(new Date('2027-07-16T09:00:00Z'), 'Europe/Moscow')).toEqual({ weekStart: '2027-07-19', weekEnd: '2027-07-25' });
    expect(digestWeek(new Date('2027-07-15T12:00:00Z'), 'Europe/Moscow')).toBeNull(); // четверг
  });
});
