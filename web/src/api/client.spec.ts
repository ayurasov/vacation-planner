import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSessionLost, setAccess } from './client';

// Ответы сервера по порядку вызовов fetch; ошибка — обрыв соединения
type Reply = { status: number; body?: unknown } | Error;

function serve(...replies: Reply[]) {
  const calls: Array<{ url: string; auth?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, auth: (init.headers as Record<string, string> | undefined)?.Authorization });
    const r = replies.shift();
    if (!r) throw new Error(`лишний запрос ${url}`);
    if (r instanceof Error) throw new TypeError('fetch failed', { cause: r });
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
    });
  }));
  return calls;
}

const expired = { status: 401, body: { type: 'https://vacation.planner/problems/auth/invalid-credentials', title: 'Не авторизован' } };
const overloaded = { status: 503, body: { type: 'https://vacation.planner/problems/service-unavailable', title: 'Сервис перегружен', requestId: 'r-1' } };
const lost = vi.fn();

beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 0)); // общий refresh прошлого теста сбрасывается следующим тиком
  setAccess('old-token');
  lost.mockReset();
  onSessionLost(lost);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('обновление токена по 401', () => {
  it('новый токен — запрос повторяется с ним', async () => {
    const calls = serve(expired, { status: 200, body: { accessToken: 'new-token' } }, { status: 200, body: { ok: true } });
    await expect(api.get('/balance')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/balance', '/api/v1/auth/refresh', '/api/v1/balance']);
    expect(calls[2].auth).toBe('Bearer new-token');
    expect(lost).not.toHaveBeenCalled();
  });

  it('refresh отклонён (401) — сеанс потерян, экран входа', async () => {
    serve(expired, expired);
    await expect(api.get('/balance')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('сервер перегружен (503) — сеанс не теряется, ошибка 503 с кодом запроса', async () => {
    serve(expired, overloaded);
    const error = await api.get('/balance').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: 'service-unavailable', requestId: 'r-1' });
    expect(lost).not.toHaveBeenCalled();
  });

  it('обрыв соединения при обновлении — сеанс не теряется', async () => {
    serve(expired, new Error('ECONNREFUSED'));
    await expect(api.get('/balance')).rejects.toMatchObject({ status: 503, code: 'service-unavailable' });
    expect(lost).not.toHaveBeenCalled();
  });

  it('восстановление при запуске: true только при выданном токене', async () => {
    serve({ status: 200, body: { accessToken: 't' } });
    await expect(api.restore()).resolves.toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    serve(overloaded);
    await expect(api.restore()).resolves.toBe(false);
  });
});
