// Безопасность к приёмке ИБ (v0.6.0, E62): журнал входов, блокировка, сеансы, политика паролей,
// одноразовый пароль, срок хранения журнала.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import { JobsService } from '../src/jobs/jobs.service';

let t: TestApp;
let hr: string;
let adm: string;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const sidOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sid as string;

/** Вход с указанным браузером: access-токен и refresh-cookie. */
async function signIn(who: { login: string; password: string }, ua = CHROME) {
  const res = await t.http().post('/api/v1/auth/login').set('User-Agent', ua).send({ login: who.login, password: who.password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('vp_refresh='))!.split(';')[0];
  return { token: res.body.accessToken as string, cookie };
}

/** Сотрудник с паролем, который уже сменён (одноразовость здесь не проверяется). */
async function person(name: string, loginName: string, password: string): Promise<{ id: number; login: string; password: string }> {
  const res = await t.http().post('/api/v1/employees').set(auth(hr)).send({ name, login: loginName, password });
  expect(res.status).toBe(201);
  await t.prisma.employee.update({ where: { id: res.body.employee.id }, data: { mustChangePassword: false } });
  return { id: res.body.employee.id, login: loginName, password };
}

beforeAll(async () => {
  t = await createTestApp();
  hr = await login(t, t.hr);
  adm = await login(t, t.admin);
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('журнал входов', () => {
  it('успешный вход, неверный пароль и неизвестный логин — с адресом и браузером', async () => {
    await t.http().post('/api/v1/auth/login').set('User-Agent', CHROME).send({ login: t.manager.login, password: 'wrong-password-1' });
    await t.http().post('/api/v1/auth/login').set('User-Agent', CHROME).send({ login: 'nobody.here', password: 'whatever-123' });
    await signIn(t.manager);

    const res = await t.http().get(`/api/v1/login-events?login=${t.manager.login}`).set(auth(hr));
    expect(res.status).toBe(200);
    const results = (res.body.items as Array<{ result: string }>).map((e) => e.result);
    expect(results).toEqual(expect.arrayContaining(['success', 'bad_password']));
    const ok = res.body.items.find((e: { result: string }) => e.result === 'success');
    expect(ok).toMatchObject({ employeeId: t.manager.id, method: 'password', device: 'Chrome 130 · Windows' });
    expect(ok.ip).toBeTruthy();

    const unknown = await t.http().get('/api/v1/login-events?login=nobody.here').set(auth(hr));
    expect(unknown.body.items[0]).toMatchObject({ result: 'unknown_login', employeeId: null });

    const failed = await t.http().get(`/api/v1/login-events?login=${t.manager.login}&failed=true`).set(auth(hr));
    expect((failed.body.items as Array<{ result: string }>).every((e) => e.result !== 'success')).toBe(true);
  });

  it('журнал видят только администратор и кадровая служба', async () => {
    const emp = await login(t, t.employee);
    expect((await t.http().get('/api/v1/login-events').set(auth(emp))).status).toBe(403);
    expect((await t.http().get('/api/v1/login-events').set(auth(adm))).status).toBe(200);
  });

  it('последний вход и активные сеансы — в учётной записи сотрудника', async () => {
    const res = await t.http().get(`/api/v1/employees/${t.manager.id}/security`).set(auth(hr));
    expect(res.status).toBe(200);
    expect(res.body.lastLoginAt).toBeTruthy();
    expect(res.body.activeSessions).toBeGreaterThan(0);
    expect(res.body.sessions[0]).toMatchObject({ device: 'Chrome 130 · Windows' });
  });
});

describe('блокировка после неудачных попыток', () => {
  it('порог блокировки — 0 или от трёх попыток', async () => {
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ lockoutThreshold: 2 })).status).toBe(400);
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ lockoutThreshold: 3, lockoutMinutes: 15 })).status).toBe(200);
  });

  it('после трёх неудач подряд — блокировка; узнаёт о ней только знающий пароль; кадровая служба снимает', async () => {
    const victim = await person('Подбираемов Пётр Петрович', 'target.pp', 'Tq5-amber-field');
    for (let i = 0; i < 3; i++) {
      const r = await t.http().post('/api/v1/auth/login').send({ login: victim.login, password: `wrong-${i}-password` });
      expect(r.status).toBe(401);
    }
    const right = await t.http().post('/api/v1/auth/login').send({ login: victim.login, password: victim.password });
    expect(right.status).toBe(423);
    expect(right.body.type).toMatch(/auth\/account-locked$/);
    expect(right.body.detail).toMatch(/заблокирована до/);
    const wrong = await t.http().post('/api/v1/auth/login').send({ login: victim.login, password: 'still-wrong-pass' });
    expect(wrong.status).toBe(401); // подбирающий не отличает блокировку от неверного пароля

    const note = await t.prisma.notification.findFirst({ where: { employeeId: victim.id, kind: 'account_locked' } });
    expect(note?.text).toMatch(/3 неудачных попыток/);
    const journal = await t.http().get(`/api/v1/login-events?login=${victim.login}&result=locked`).set(auth(hr));
    expect(journal.body.items.length).toBeGreaterThan(0);
    const card = await t.http().get(`/api/v1/employees/${victim.id}/security`).set(auth(hr));
    expect(card.body.lockedUntil).toBeTruthy();

    expect((await t.http().post(`/api/v1/employees/${victim.id}/unlock`).set(auth(hr))).status).toBe(204);
    expect((await t.http().post('/api/v1/auth/login').send({ login: victim.login, password: victim.password })).status).toBe(200);
    const audit = await t.prisma.auditEvent.findFirst({ where: { action: 'employee.unlocked', entityId: String(victim.id) } });
    expect(audit).not.toBeNull();
  });

  it('успешный вход обнуляет счётчик: блокируют только неудачи подряд', async () => {
    const user = await person('Рассеянный Иван Ильич', 'absent.ii', 'Wv3-cedar-north');
    for (const pw of ['wrong-pass-1', 'wrong-pass-2', user.password, 'wrong-pass-3', 'wrong-pass-4']) {
      await t.http().post('/api/v1/auth/login').send({ login: user.login, password: pw });
    }
    expect((await t.http().post('/api/v1/auth/login').send({ login: user.login, password: user.password })).status).toBe(200);
  });
});

describe('сеансы', () => {
  it('список, завершение другого сеанса и всех, кроме текущего', async () => {
    const a = await signIn(t.employee, CHROME);
    const b = await signIn(t.employee, FIREFOX);
    const list = await t.http().get('/api/v1/auth/sessions').set(auth(a.token));
    expect(list.status).toBe(200);
    const items = list.body.items as Array<{ id: string; current: boolean; device: string }>;
    expect(items.find((s) => s.current)?.id).toBe(sidOf(a.token));
    expect(items.find((s) => s.id === sidOf(b.token))?.device).toBe('Firefox 131 · Linux');

    expect((await t.http().delete(`/api/v1/auth/sessions/${sidOf(b.token)}`).set(auth(a.token))).status).toBe(204);
    const dead = await t.http().get('/api/v1/auth/me').set(auth(b.token));
    expect(dead.status).toBe(401);
    expect(dead.body.type).toMatch(/auth\/token-expired$/);
    expect((await t.http().post('/api/v1/auth/refresh').set('Cookie', b.cookie)).status).toBe(401);

    const c = await signIn(t.employee, FIREFOX);
    const others = await t.http().post('/api/v1/auth/sessions/revoke-others').set(auth(a.token));
    expect(others.status).toBe(200);
    expect(others.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await t.http().get('/api/v1/auth/me').set(auth(c.token))).status).toBe(401);
    expect((await t.http().get('/api/v1/auth/me').set(auth(a.token))).status).toBe(200);
  });

  it('чужой сеанс завершить нельзя', async () => {
    const mine = await signIn(t.employee);
    const other = await signIn(t.manager);
    await t.http().delete(`/api/v1/auth/sessions/${sidOf(other.token)}`).set(auth(mine.token));
    expect((await t.http().get('/api/v1/auth/me').set(auth(other.token))).status).toBe(200);
  });

  it('выход завершает сеанс: access-токен этого сеанса больше не работает', async () => {
    const s = await signIn(t.employee);
    expect((await t.http().post('/api/v1/auth/logout').set(auth(s.token)).set('Cookie', s.cookie)).status).toBe(204);
    expect((await t.http().get('/api/v1/auth/me').set(auth(s.token))).status).toBe(401);
  });

  it('кадровая служба завершает все сеансы сотрудника; действие — в аудите', async () => {
    const s = await signIn(t.employee);
    const res = await t.http().post(`/api/v1/employees/${t.employee.id}/sessions/revoke`).set(auth(hr));
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await t.http().get('/api/v1/auth/me').set(auth(s.token))).status).toBe(401);
    const audit = await t.prisma.auditEvent.findFirst({ where: { action: 'employee.sessions_revoked', entityId: String(t.employee.id) } });
    expect(audit).not.toBeNull();
  });
});

describe('политика паролей и одноразовый пароль', () => {
  it('политика доступна без входа и меняется администратором', async () => {
    expect((await t.http().get('/api/v1/auth/password-policy')).body).toEqual({ minLength: 8 });
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ passwordMinLength: 12 })).status).toBe(200);
    expect((await t.http().get('/api/v1/auth/password-policy')).body).toEqual({ minLength: 12 });
  });

  it('смена своего пароля: длина, логин, распространённый, совпадающий с текущим', async () => {
    const token = await login(t, t.manager);
    const change = (newPassword: string) => t.http().post('/api/v1/auth/password').set(auth(token)).send({ oldPassword: t.manager.password, newPassword });
    const cases: Array<[string, RegExp]> = [
      ['Short-pw-1', /не короче 12/],
      ['Xmanager-2027-q', /логин/],
      ['Qwerty123456!', /распространён/],
      [t.manager.password, /совпадает с текущим/],
    ];
    for (const [pw, reason] of cases) {
      const res = await change(pw);
      expect(res.status, pw).toBe(400);
      expect(res.body.type).toMatch(/validation\/weak-password$/);
      expect(res.body.detail).toMatch(reason);
    }
    expect((await change('Jx2-meadow-violet')).status).toBe(204);
    t.manager.password = 'Jx2-meadow-violet';
  });

  it('пароль, заданный кадровой службой, — по политике и одноразовый: до смены доступен только профиль', async () => {
    const weak = await t.http().post('/api/v1/employees').set(auth(hr)).send({ name: 'Новичков Олег Олегович', login: 'novice.oo', password: '123456789012' });
    expect(weak.status).toBe(400);
    expect(weak.body.type).toMatch(/validation\/weak-password$/);

    const created = await t.http().post('/api/v1/employees').set(auth(hr)).send({ name: 'Новичков Олег Олегович', login: 'novice.oo', password: 'Rb6-granite-lake' });
    expect(created.status).toBe(201);
    const once = await login(t, { login: 'novice.oo', password: 'Rb6-granite-lake' });
    const blocked = await t.http().get('/api/v1/schedule?from=2027-01-01&to=2027-01-31').set(auth(once));
    expect(blocked.status).toBe(403);
    expect(blocked.body.type).toMatch(/auth\/password-change-required$/);
    const me = await t.http().get('/api/v1/auth/me').set(auth(once));
    expect(me.body.employee.mustChangePassword).toBe(true);
    expect((await t.http().post('/api/v1/events/ticket').set(auth(once))).status).toBe(200);

    expect((await t.http().post('/api/v1/auth/password').set(auth(once)).send({ oldPassword: 'Rb6-granite-lake', newPassword: 'Hd8-copper-willow' })).status).toBe(204);
    const fresh = await login(t, { login: 'novice.oo', password: 'Hd8-copper-willow' });
    expect((await t.http().get('/api/v1/schedule?from=2027-01-01&to=2027-01-31').set(auth(fresh))).status).toBe(200);
    expect((await t.http().get('/api/v1/auth/me').set(auth(fresh))).body.employee.mustChangePassword).toBe(false);
  });

  it('сброс выдаёт пароль не короче политики', async () => {
    const user = await person('Сбрасываемов Ян Янович', 'reset.yy', 'Pk9-silver-brook');
    const res = await t.http().post(`/api/v1/employees/${user.id}/password-reset`).set(auth(hr));
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect((await t.http().patch('/api/v1/settings').set(auth(adm)).send({ passwordMinLength: 8 })).status).toBe(200);
  });
});

describe('срок хранения журнала входов', () => {
  it('ежедневная задача удаляет записи старше срока — один раз за сутки', async () => {
    const old = () => t.prisma.loginEvent.create({ data: { login: 'ancient', result: 'success', method: 'password', ts: new Date(Date.now() - 400 * 86_400_000) } });
    await old();
    await t.prisma.loginEvent.create({ data: { login: 'recent', result: 'success', method: 'password' } });
    await t.prisma.$executeRaw`DELETE FROM job_runs WHERE name = 'login-retention'`;
    const jobs = t.app.get(JobsService);
    await jobs.tick(new Date());
    expect(await t.prisma.loginEvent.count({ where: { login: 'ancient' } })).toBe(0);
    expect(await t.prisma.loginEvent.count({ where: { login: 'recent' } })).toBe(1);

    await old();
    await jobs.tick(new Date()); // за эти сутки уже выполнена — повторно не удаляет
    expect(await t.prisma.loginEvent.count({ where: { login: 'ancient' } })).toBe(1);
  });
});
