// E2E: единый вход OIDC (E31) против тестового провайдера: discovery, JWKS, обмен кода с PKCE.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { createTestApp, destroyTestApp, type TestApp } from './helpers';
import { loginFromClaims, resetOidcCache } from '../src/auth/oidc';

// ── Тестовый провайдер ──
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
let foreignKey: KeyObject;
let idp: Server;
let issuer = '';
interface Grant { challenge: string; nonce: string; claims: Record<string, unknown>; aud?: string; key?: KeyObject }
const grants = new Map<string, Grant>();

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });
}

let t: TestApp;

beforeAll(async () => {
  foreignKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  idp = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/.well-known/openid-configuration') {
      return json(200, { issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (req.url === '/jwks') return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    if (req.url === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const g = grants.get(form.get('code') ?? '');
      const auth = Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString();
      if (!g || auth !== 'planner:secret') return json(400, { error: 'invalid_grant' });
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== g.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const idToken = jwt.sign({ nonce: g.nonce, ...g.claims }, g.key ?? privateKey, {
        algorithm: 'RS256', keyid: 'k1', issuer, audience: g.aud ?? 'planner', expiresIn: '5m', subject: 'u1',
      });
      return json(200, { access_token: 'x', token_type: 'Bearer', id_token: idToken });
    }
    return json(404, {});
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'planner', OIDC_CLIENT_SECRET: 'secret', APP_URL: 'https://otpusk.test', OIDC_LABEL: 'Keycloak',
  });
  resetOidcCache();
  t = await createTestApp();
});

afterAll(async () => {
  for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'APP_URL', 'OIDC_LABEL', 'LOCAL_LOGIN']) delete process.env[k];
  await destroyTestApp(t);
  idp.close();
});

const cookie = (res: { headers: Record<string, unknown> }, name: string) =>
  ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith(`${name}=`))?.split(';')[0];

/** start → «провайдер выдал код» → callback. Возвращает ответ callback. */
async function signIn(claims: Record<string, unknown>, tweak: Partial<Grant> & { state?: string } = {}) {
  const start = await t.http().get('/api/v1/auth/oidc/start');
  expect(start.status).toBe(302);
  const url = new URL(start.headers.location as string);
  const code = `c${grants.size + 1}`;
  grants.set(code, { challenge: url.searchParams.get('code_challenge')!, nonce: url.searchParams.get('nonce')!, claims, ...tweak });
  return t.http().get(`/api/v1/auth/oidc/callback?code=${code}&state=${tweak.state ?? url.searchParams.get('state')}`)
    .set('Cookie', cookie(start, 'vp_oidc')!);
}

describe('единый вход OIDC', () => {
  it('конфигурация для экрана входа', async () => {
    const res = await t.http().get('/api/v1/auth/oidc/config');
    expect(res.body).toEqual({ enabled: true, label: 'Keycloak', localLogin: true });
  });

  it('start: перенаправление к провайдеру с PKCE S256, state и nonce; состояние — в подписанной cookie', async () => {
    const res = await t.http().get('/api/v1/auth/oidc/start');
    const url = new URL(res.headers.location as string);
    expect(`${url.origin}${url.pathname}`).toBe(`${issuer}/auth`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'planner', code_challenge_method: 'S256', scope: 'openid profile email',
      redirect_uri: 'https://otpusk.test/api/v1/auth/oidc/callback',
    });
    expect(cookie(res, 'vp_oidc')).toBeTruthy();
    expect(((res.headers['set-cookie'] as string[]).join(';'))).toMatch(/HttpOnly/i);
  });

  it('успешный вход: сессия выдаётся сотруднику с логином из preferred_username', async () => {
    const res = await signIn({ preferred_username: 'Employee.Test@corp.test' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://otpusk.test/schedule');
    const refresh = cookie(res, 'vp_refresh')!;
    // Cookie живёт 30 дней, как refresh-токен (до v0.5.0 — 15 минут, как access-токен)
    const full = (res.headers['set-cookie'] as string[]).find((c) => c.startsWith('vp_refresh='))!;
    expect((Date.parse(/Expires=([^;]+)/i.exec(full)![1]) - Date.now()) / 86_400_000).toBeGreaterThan(29);
    const r = await t.http().post('/api/v1/auth/refresh').set('Cookie', refresh);
    expect(r.status).toBe(200);
    const me = await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${r.body.accessToken}`);
    expect(me.body.employee.login).toBe('employee.test');
  });

  it('подмена state, чужой nonce, чужой получатель, чужая подпись, неверный PKCE — отказ без сессии', async () => {
    const cases: Array<[Partial<Grant> & { state?: string }, string]> = [
      [{ state: 'forged' }, 'expired'],
      [{ nonce: 'other' }, 'invalid'],
      [{ aud: 'someone-else' }, 'invalid'],
      [{ key: foreignKey }, 'invalid'],
      [{ challenge: 'wrong' }, 'invalid'],
    ];
    for (const [tweak, reason] of cases) {
      const res = await signIn({ preferred_username: 'employee.test' }, tweak);
      expect(res.headers.location, JSON.stringify(Object.keys(tweak))).toBe(`https://otpusk.test/login?sso=${reason}`);
      expect(cookie(res, 'vp_refresh')).toBeUndefined();
    }
  });

  it('сотрудник не найден или уволен — вход отклонён', async () => {
    expect((await signIn({ preferred_username: 'stranger' })).headers.location).toBe('https://otpusk.test/login?sso=unknown');
    await t.prisma.employee.update({ where: { id: t.manager.id }, data: { isActive: false } });
    expect((await signIn({ preferred_username: 'manager.test' })).headers.location).toBe('https://otpusk.test/login?sso=unknown');
    await t.prisma.employee.update({ where: { id: t.manager.id }, data: { isActive: true } });
  });

  it('callback без cookie состояния (истекла, другой браузер) — повторить вход', async () => {
    const res = await t.http().get('/api/v1/auth/oidc/callback?code=x&state=y');
    expect(res.headers.location).toBe('https://otpusk.test/login?sso=expired');
  });

  it('LOCAL_LOGIN=false: пароль только у администраторов (аварийный вход)', async () => {
    process.env.LOCAL_LOGIN = 'false';
    try {
      expect((await t.http().get('/api/v1/auth/oidc/config')).body.localLogin).toBe(false);
      const emp = await t.http().post('/api/v1/auth/login').send({ login: t.employee.login, password: t.employee.password });
      expect(emp.status).toBe(403);
      const adm = await t.http().post('/api/v1/auth/login').send({ login: t.admin.login, password: t.admin.password });
      expect(adm.status).toBe(200);
    } finally {
      delete process.env.LOCAL_LOGIN;
    }
  });
});

describe('логин из утверждений', () => {
  it('upn, email и DOMAIN\\login приводятся к логину', () => {
    expect(loginFromClaims({ upn: 'Ivanov.II@corp.ru' }, 'upn')).toBe('ivanov.ii');
    expect(loginFromClaims({ preferred_username: 'CORP\\petrov.pp' }, 'preferred_username')).toBe('petrov.pp');
    expect(loginFromClaims({}, 'preferred_username')).toBeNull();
  });
});
