// E2E: поток событий (E40-04) — билет, hello с состоянием, уведомление приходит потоком.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestApp, destroyTestApp, login, NEXT_YEAR, type TestApp } from './helpers';
import { EventsService } from '../src/events/events.service';

let t: TestApp;
let port = 0;
let emp: string;
let mgr: string;

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen(0, '127.0.0.1');
  port = (t.app.getHttpServer().address() as AddressInfo).port;
  emp = await login(t, t.employee);
  mgr = await login(t, t.manager);
});

let closed = false; // последний тест останавливает приложение сам
afterAll(async () => {
  if (!closed) await destroyTestApp(t);
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Открыть поток и собирать события; close() — отключиться. */
function open(ticket: string): Promise<{ status: number; type: string; events: Array<{ event: string; data: unknown }>; next: (name: string) => Promise<unknown>; close: () => void; ended: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: `/api/v1/events?ticket=${encodeURIComponent(ticket)}` }, (res: IncomingMessage) => {
      const events: Array<{ event: string; data: unknown }> = [];
      const waiters: Array<{ name: string; resolve: (d: unknown) => void }> = [];
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!name || !data) continue;
          const ev = { event: name, data: JSON.parse(data) };
          events.push(ev);
          const w = waiters.findIndex((x) => x.name === name);
          if (w >= 0) waiters.splice(w, 1)[0].resolve(ev.data);
        }
      });
      const next = (name: string) => new Promise<unknown>((ok) => {
        const have = events.find((e) => e.event === name);
        if (have) { events.splice(events.indexOf(have), 1); ok(have.data); } else waiters.push({ name, resolve: ok });
      });
      const ended = new Promise<void>((ok) => { res.on('end', () => ok()); res.on('close', () => ok()); });
      resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), events, next, close: () => req.destroy(), ended });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('поток событий', () => {
  it('без билета или с чужим токеном вместо билета — 401', async () => {
    expect((await t.http().get('/api/v1/events')).status).toBe(401);
    expect((await t.http().get(`/api/v1/events?ticket=${emp}`)).status).toBe(401); // access-токен — не билет
  });

  it('hello с непрочитанными; новое уведомление приходит потоком', async () => {
    const { body } = await t.http().post('/api/v1/events/ticket').set(auth(mgr));
    const stream = await open(body.ticket);
    try {
      expect(stream.status).toBe(200);
      expect(stream.type).toContain('text/event-stream');
      const hello = await stream.next('hello') as { unread: number; version: string };
      expect(hello.unread).toBe(0);
      expect(Number(hello.version)).toBeGreaterThanOrEqual(0);
      // сотрудник подаёт заявку → руководителю уведомление → событие при следующем опросе
      await t.http().post('/api/v1/vacation-requests').set(auth(emp)).send({ start: `${NEXT_YEAR}-04-06`, end: `${NEXT_YEAR}-04-10` });
      await t.app.get(EventsService).poll();
      expect(await stream.next('notifications')).toEqual({ unread: 1 });
    } finally {
      stream.close();
    }
  });

  it('после смены пароля старый билет не открывает поток', async () => {
    const { body } = await t.http().post('/api/v1/events/ticket').set(auth(emp));
    await t.http().post('/api/v1/auth/password').set(auth(emp)).send({ oldPassword: t.employee.password, newPassword: 'new-pass-12345' });
    expect((await t.http().get(`/api/v1/events?ticket=${encodeURIComponent(body.ticket)}`)).status).toBe(401);
  });

  it('отзыв сеанса закрывает уже открытый поток: событие revoked и конец соединения', async () => {
    const { body } = await t.http().post('/api/v1/events/ticket').set(auth(mgr));
    const stream = await open(body.ticket);
    try {
      await stream.next('hello');
      // пароль руководителя сменён в другом месте (другой процесс, кадровая служба)
      await t.prisma.employee.update({ where: { id: t.manager.id }, data: { pwVersion: { increment: 1 } } });
      const events = t.app.get(EventsService);
      (events as unknown as { lastSessionCheck: number }).lastSessionCheck = 0; // проверка — без ожидания 10 с
      await events.poll();
      expect(await stream.next('revoked')).toEqual({});
    } finally {
      stream.close();
    }
  });

  // Последний: останавливает приложение. До v1.0.0 потоки закрывались после остановки HTTP-сервера,
  // а сервер ждал открытые соединения — остановка висела до таймаута (15 с в кластере, SIGKILL в Docker)
  it('остановка приложения закрывает открытые потоки и не ждёт их', async () => {
    const adm = await login(t, t.admin);
    const { body } = await t.http().post('/api/v1/events/ticket').set(auth(adm));
    const stream = await open(body.ticket);
    await stream.next('hello');
    const started = Date.now();
    await t.app.close();
    closed = true;
    expect(Date.now() - started).toBeLessThan(3000);
    await stream.ended;
  });
});
