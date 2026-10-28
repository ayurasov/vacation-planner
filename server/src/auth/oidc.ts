// Единый вход по OpenID Connect (E31): authorization code + PKCE, конфиденциальный клиент.
// Без новых зависимостей: discovery и JWKS — fetch, проверка подписи id_token — jsonwebtoken
// с ключом из JWKS (node:crypto). Сопоставление с сотрудником — по логину из утверждения.
import { createHash, createPublicKey, randomBytes, type JsonWebKey, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Утверждение с логином: preferred_username (Keycloak), upn или email (ADFS) — до «@», если есть. */
  loginClaim: string;
  label: string;
  /** Вход по паролю для сотрудников; администраторам он остаётся всегда — аварийный доступ. */
  localLogin: boolean;
  redirectUri: string;
  appUrl: string;
}

export function oidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig {
  const appUrl = (env.APP_URL || 'http://localhost').replace(/\/+$/, '');
  const issuer = (env.OIDC_ISSUER ?? '').replace(/\/+$/, '');
  return {
    enabled: !!issuer && !!env.OIDC_CLIENT_ID,
    issuer,
    clientId: env.OIDC_CLIENT_ID ?? '',
    clientSecret: env.OIDC_CLIENT_SECRET ?? '',
    loginClaim: env.OIDC_LOGIN_CLAIM || 'preferred_username',
    label: env.OIDC_LABEL || 'корпоративную учётную запись',
    localLogin: env.LOCAL_LOGIN !== 'false',
    redirectUri: `${appUrl}/api/v1/auth/oidc/callback`,
    appUrl,
  };
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }

const TTL = 60 * 60 * 1000;
const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, { at: number; keys: Map<string, KeyObject> }>();

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function discovery(cfg: OidcConfig): Promise<Discovery> {
  const hit = discoveryCache.get(cfg.issuer);
  if (hit && Date.now() - hit.at < TTL) return hit.doc;
  const doc = await getJson<Discovery>(`${cfg.issuer}/.well-known/openid-configuration`);
  if (doc.issuer.replace(/\/+$/, '') !== cfg.issuer) throw new Error('issuer в discovery не совпадает с OIDC_ISSUER');
  discoveryCache.set(cfg.issuer, { at: Date.now(), doc });
  return doc;
}

async function signingKey(jwksUri: string, kid: string | undefined): Promise<KeyObject> {
  const load = async () => {
    const { keys } = await getJson<{ keys: Array<JsonWebKey & { kid?: string; use?: string }> }>(jwksUri);
    const map = new Map<string, KeyObject>();
    for (const k of keys) if (!k.use || k.use === 'sig') map.set(k.kid ?? '', createPublicKey({ key: k, format: 'jwk' }));
    jwksCache.set(jwksUri, { at: Date.now(), keys: map });
    return map;
  };
  const cached = jwksCache.get(jwksUri);
  let map = cached && Date.now() - cached.at < TTL ? cached.keys : await load();
  // Ротация ключей у провайдера: неизвестный kid — перечитать JWKS один раз
  if (kid && !map.has(kid)) map = await load();
  const key = kid ? map.get(kid) : map.size === 1 ? [...map.values()][0] : undefined;
  if (!key) throw new Error('Ключ подписи id_token не найден в JWKS');
  return key;
}

const b64url = (b: Buffer) => b.toString('base64url');

export interface OidcState { state: string; nonce: string; verifier: string }

export function newState(): OidcState {
  return { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)) };
}

export function authorizationUrl(cfg: OidcConfig, d: Discovery, s: OidcState): string {
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: 'openid profile email',
    state: s.state, nonce: s.nonce,
    code_challenge: b64url(createHash('sha256').update(s.verifier).digest()), code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

/** Обмен кода на токены и проверка id_token: подпись, издатель, получатель, срок, nonce. */
export async function exchangeCode(cfg: OidcConfig, code: string, s: OidcState): Promise<Record<string, unknown>> {
  const d = await discovery(cfg);
  const tokens = await getJson<{ id_token?: string }>(d.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: s.verifier, client_id: cfg.clientId,
    }),
  });
  if (!tokens.id_token) throw new Error('Провайдер не вернул id_token');
  const header = jwt.decode(tokens.id_token, { complete: true })?.header;
  const key = await signingKey(d.jwks_uri, header?.kid);
  const claims = jwt.verify(tokens.id_token, key, {
    algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'ES256'], issuer: d.issuer, audience: cfg.clientId, clockTolerance: 60,
  }) as Record<string, unknown>;
  if (claims.nonce !== s.nonce) throw new Error('nonce id_token не совпадает');
  return claims;
}

/** Логин сотрудника из утверждений: «ivanov.ii@corp.ru» → «ivanov.ii», «CORP\\ivanov.ii» → «ivanov.ii». */
export function loginFromClaims(claims: Record<string, unknown>, claim: string): string | null {
  const raw = claims[claim];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().split('\\').pop()!.split('@')[0].toLowerCase();
}

/** Сброс кэшей — для тестов с несколькими провайдерами. */
export function resetOidcCache(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
