import { createHash } from 'node:crypto';
// E2E: аутентификация и сессии (критерии историй E01-xx, docs/specs/03-backlog.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExtraApp, createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { LoginRateLimitGuard } from '../src/auth/rate-limit';

let t: TestApp;

/** Через сколько дней истекает refresh-cookie из Set-Cookie. */
const cookieDays = (setCookie: string[]): number => {
  const c = setCookie.find((h) => h.startsWith('vp_refresh='))!;
  const expires = /Expires=([^;]+)/i.exec(c)?.[1];
  return expires ? (Date.parse(expires) - Date.now()) / 86_400_000 : 0;
};

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await destroyTestApp(t);
});

describe('POST /api/v1/auth/login', () => {
  it('выдаёт access-токен и refresh-cookie', async () => {
    const res = await t.http().post('/api/v1/auth/login')
      .send({ login: t.admin.login, password: t.admin.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.permissions.isAdmin).toBe(true);
    const setCookie = res.headers['set-cookie'] as string[];
    expect(setCookie?.some((c) => c.startsWith('vp_refresh='))).toBe(true);
    // Cookie живёт как refresh-токен (30 дней), а не как access (15 минут): иначе браузер удалял
    // её вместе с истечением access-токена и через 15 минут работы выбрасывал на экран входа
    expect(cookieDays(setCookie)).toBeGreaterThan(29);
  });

  it('неверный пароль → 401 problem+json без раскрытия причины', async () => {
    const res = await t.http().post('/api/v1/auth/login')
      .send({ login: t.admin.login, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/auth\/invalid-credentials$/);
  });

  it('неизвестный логин → тот же 401', async () => {
    const res = await t.http().post('/api/v1/auth/login')
      .send({ login: 'ghost', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/auth\/invalid-credentials$/);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('отдаёт профиль и подчинённых руководителя', async () => {
    const token = await login(t, t.manager);
    const res = await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.permissions.approveSubordinates).toContain(t.employee.id);
    expect(res.body.permissions.isAdmin).toBe(false);
  });

  it('без токена → 401', async () => {
    const res = await t.http().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('токен с другим алгоритмом подписи, даже тем же секретом, не принимается', async () => {
    const me = await t.prisma.employee.findUniqueOrThrow({ where: { id: t.employee.id } });
    const live = await login(t, t.employee);
    const sid = JSON.parse(Buffer.from(live.split('.')[1], 'base64url').toString()).sid as string;
    const claims = { sub: me.id, login: me.login, isAdmin: me.isAdmin, pwv: me.pwVersion, sid };
    // Контроль: те же утверждения с HS256 принимаются — отказ ниже именно из-за алгоритма
    const hs256 = jwt.sign(claims, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' });
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${hs256}`)).status).toBe(200);
    // Без сеанса подписи секретом мало (v1.0.0): нужен живой сеанс, а не только секрет
    const sessionless = jwt.sign({ ...claims, sid: undefined }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' });
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${sessionless}`)).status).toBe(401);
    const forged = jwt.sign({ ...claims, sid: '00000000-0000-4000-8000-000000000000' }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' });
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    const hs512 = jwt.sign(claims, process.env.JWT_SECRET!, { algorithm: 'HS512', expiresIn: '5m' });
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${hs512}`)).status).toBe(401);
    const unsigned = jwt.sign(claims, null, { algorithm: 'none' });
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${unsigned}`)).status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('ротирует refresh и выдаёт новый access', async () => {
    const loginRes = await t.http().post('/api/v1/auth/login')
      .send({ login: t.employee.login, password: t.employee.password });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c) => c.startsWith('vp_refresh='));

    const first = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie!);
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTypeOf('string');
    expect(cookieDays(first.headers['set-cookie'] as unknown as string[])).toBeGreaterThan(29);

    // Старый refresh в первые 30 секунд после ротации ещё принимается — так работают две вкладки
    // с одной cookie (v0.6.0); сеанс тот же
    const parallel = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie!);
    expect(parallel.status).toBe(200);
    const fresh = (parallel.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('vp_refresh='))!;

    // Позже повторное предъявление старого токена — признак кражи: сеанс завершается целиком,
    // и даже последний выданный токен больше не работает
    const hash = createHash('sha256').update(cookie!.split(';')[0].slice('vp_refresh='.length)).digest('hex');
    await t.prisma.refreshToken.update({ where: { tokenHash: hash }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    const reuse = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie!);
    expect(reuse.status).toBe(401);
    expect((await t.http().post('/api/v1/auth/refresh').set('Cookie', fresh)).status).toBe(401);
    const journal = await t.prisma.loginEvent.findFirst({ where: { employeeId: t.employee.id, result: 'refresh_reuse' } });
    expect(journal).not.toBeNull();
  });

  it('два одновременных обновления одним токеном не выдают две независимые пары: ротация атомарна', async () => {
    const loginRes = await t.http().post('/api/v1/auth/login').send({ login: t.employee.login, password: t.employee.password });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c) => c.startsWith('vp_refresh='))!;
    const [a, b] = await Promise.all([
      t.http().post('/api/v1/auth/refresh').set('Cookie', cookie),
      t.http().post('/api/v1/auth/refresh').set('Cookie', cookie),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Оба ответа — в одном сеансе: завершение сеанса гасит оба
    const sid = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).sid as string;
    expect(sid(a.body.accessToken)).toBe(sid(b.body.accessToken));
  });
});

describe('смена пароля', () => {
  it('увольнение сразу закрывает доступ по выданному токену', async () => {
    const adm = await login(t, t.admin);
    const created = await t.http().post('/api/v1/employees').set('Authorization', `Bearer ${adm}`)
      .send({ name: 'Уходящий Иван Иванович', login: 'leaving.ii', password: 'Kq7-river-stone' });
    expect(created.status).toBe(201);
    const token = await login(t, { login: 'leaving.ii', password: 'Kq7-river-stone' });
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await t.http().delete(`/api/v1/employees/${created.body.employee.id}`).set('Authorization', `Bearer ${adm}`);
    expect((await t.http().get('/api/v1/schedule?from=2027-01-01&to=2027-01-31').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('смена убивает старые токены и требует новый пароль', async () => {
    const oldToken = await login(t, t.employee);
    const res = await t.http().put(`/api/v1/employees/${t.employee.id}/password`)
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ oldPassword: t.employee.password, newPassword: 'brand-new-pass-9' });
    expect(res.status).toBe(204);

    // старый access-токен перестаёт действовать сразу (до v0.5.0 — ещё до 15 минут)
    const stale = await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${oldToken}`);
    expect(stale.status).toBe(401);
    expect(stale.body.type).toMatch(/auth\/token-expired$/);

    const refreshRes = await t.http().post('/api/v1/auth/login')
      .send({ login: t.employee.login, password: t.employee.password });
    expect(refreshRes.status).toBe(401);

    const reLogin = await t.http().post('/api/v1/auth/login')
      .send({ login: t.employee.login, password: 'brand-new-pass-9' });
    expect(reLogin.status).toBe(200);

    // чужой пароль без прав админа менять нельзя
    const empToken = reLogin.body.accessToken;
    const forbidden = await t.http().put(`/api/v1/employees/${t.admin.id}/password`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ newPassword: 'hacked-pass-123' });
    expect(forbidden.status).toBe(403);
  });
});

describe('лимит частоты входа', () => {
  // Последний блок в файле: исчерпывает окна для адресов тест-клиента
  it('11-я попытка за минуту к одному логину с адреса → 429 rate-limited', async () => {
    await LoginRateLimitGuard.resetForTests(t.prisma);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await t.http().post('/api/v1/auth/login')
        .send({ login: 'nobody', password: 'wrong' })).status;
    }
    expect(last).toBe(429);
    const blocked = await t.http().post('/api/v1/auth/login').send({ login: 'nobody', password: 'wrong' });
    expect(blocked.headers['retry-after']).toBe('60'); // заголовок, обещанный документом 2
  });

  it('за прокси лимит считается по адресу клиента, а не nginx', async () => {
    await LoginRateLimitGuard.resetForTests(t.prisma);
    const attempt = (ip: string) => t.http().post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip).send({ login: 'nobody', password: 'wrong' });
    for (let i = 0; i < 10; i++) await attempt('10.1.1.1');
    expect((await attempt('10.1.1.1')).status).toBe(429);
    // Другой сотрудник за тем же nginx не заблокирован
    expect((await attempt('10.1.1.2')).status).toBe(401);
  });

  it('другие логины с того же адреса не блокируются лимитом одной учётной записи', async () => {
    await LoginRateLimitGuard.resetForTests(t.prisma);
    const attempt = (login: string) => t.http().post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.2.2.2').send({ login, password: 'wrong' });
    for (let i = 0; i < 10; i++) await attempt('nobody');
    expect((await attempt('nobody')).status).toBe(429);
    expect((await attempt(t.employee.login)).status).toBe(401);
    await LoginRateLimitGuard.resetForTests(t.prisma);
  });

  it('лимит общий для всех экземпляров сервера: попытки на двух экземплярах складываются', async () => {
    await LoginRateLimitGuard.resetForTests(t.prisma);
    const second = await createExtraApp();
    try {
      const attempt = (app: 1 | 2) => (app === 1 ? t.http() : request(second.getHttpServer())).post('/api/v1/auth/login')
        .set('X-Forwarded-For', '10.3.3.3').send({ login: 'nobody', password: 'wrong' });
      for (let i = 0; i < 5; i++) { await attempt(1); await attempt(2); }
      expect((await attempt(2)).status).toBe(429);
      expect((await attempt(1)).status).toBe(429);
    } finally {
      await second.close();
      await LoginRateLimitGuard.resetForTests(t.prisma);
    }
  });
});
