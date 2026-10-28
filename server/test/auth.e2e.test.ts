// E2E: аутентификация и сессии (критерии историй E01-xx, docs/specs/03-backlog.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, login, type TestApp } from './helpers';
import { LoginRateLimitGuard } from '../src/auth/rate-limit';

let t: TestApp;

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
});

describe('POST /api/v1/auth/refresh', () => {
  it('ротирует refresh и выдаёт новый access', async () => {
    const loginRes = await t.http().post('/api/v1/auth/login')
      .send({ login: t.employee.login, password: t.employee.password });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c) => c.startsWith('vp_refresh='));

    const first = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie!);
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTypeOf('string');

    // Повторное использование старого refresh отклоняется (ротация)
    const second = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie!);
    expect(second.status).toBe(401);
  });
});

describe('смена пароля', () => {
  it('смена убивает старые токены и требует новый пароль', async () => {
    const oldToken = await login(t, t.employee);
    const res = await t.http().put(`/api/v1/employees/${t.employee.id}/password`)
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ oldPassword: t.employee.password, newPassword: 'brand-new-pass-9' });
    expect(res.status).toBe(204);

    // access-токен живёт до 15 минут, но версия пароля инвалидирует refresh
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
    LoginRateLimitGuard.resetForTests();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await t.http().post('/api/v1/auth/login')
        .send({ login: 'nobody', password: 'wrong' })).status;
    }
    expect(last).toBe(429);
  });

  it('за прокси лимит считается по адресу клиента, а не nginx', async () => {
    LoginRateLimitGuard.resetForTests();
    const attempt = (ip: string) => t.http().post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip).send({ login: 'nobody', password: 'wrong' });
    for (let i = 0; i < 10; i++) await attempt('10.1.1.1');
    expect((await attempt('10.1.1.1')).status).toBe(429);
    // Другой сотрудник за тем же nginx не заблокирован
    expect((await attempt('10.1.1.2')).status).toBe(401);
  });

  it('другие логины с того же адреса не блокируются лимитом одной учётной записи', async () => {
    LoginRateLimitGuard.resetForTests();
    const attempt = (login: string) => t.http().post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.2.2.2').send({ login, password: 'wrong' });
    for (let i = 0; i < 10; i++) await attempt('nobody');
    expect((await attempt('nobody')).status).toBe(429);
    expect((await attempt(t.employee.login)).status).toBe(401);
    LoginRateLimitGuard.resetForTests();
  });
});
