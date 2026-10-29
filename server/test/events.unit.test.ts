// Проверка отозванных сеансов в потоке событий (v1.0.0): поток, подключившийся, пока шли запросы
// проверки, не получает ложный revoked. Без БД: Prisma и потоки — заглушки, запрос сеансов
// придерживается, пока подключается новый поток.
import { afterEach, describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { EventsService } from '../src/events/events.service';
import type { PrismaService } from '../src/infra/prisma.service';
import type { DataVersionService } from '../src/infra/data-version';

interface FakeStream { res: Response; frames: string[]; ended: () => boolean }

function stream(): FakeStream {
  const frames: string[] = [];
  let ended = false;
  const res = {
    status: () => res, setHeader: () => res, flushHeaders: () => undefined,
    write: (chunk: string) => { frames.push(chunk); return true; },
    end: () => { ended = true; },
    get writableEnded() { return ended; },
  };
  return { res: res as unknown as Response, frames, ended: () => ended };
}

const revoked = (s: FakeStream) => s.frames.some((f) => f.startsWith('event: revoked'));

/** Сеансы: живые id; запрос живых сеансов ждёт release(), если hold. */
function fakePrisma(alive: Set<string>, hold = false) {
  let release!: () => void;
  const gate = hold ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
  const prisma = {
    notification: {
      aggregate: async () => ({ _max: { id: 0 } }),
      groupBy: async () => [],
    },
    employee: { findMany: async () => [{ id: 1, isActive: true, pwVersion: 0 }] },
    refreshToken: {
      findMany: async ({ where }: { where: { sessionId: { in: string[] } } }) => {
        const asked = where.sessionId.in; // сеансы на момент запроса — до ожидания
        await gate;
        return asked.filter((sid) => alive.has(sid)).map((sessionId) => ({ sessionId }));
      },
    },
  };
  return { prisma: prisma as unknown as PrismaService, release: () => release?.() };
}

const version = { current: async () => 1n } as unknown as DataVersionService;
let service: EventsService | null = null;
afterEach(() => { service?.onApplicationShutdown(); service = null; });

const check = (s: EventsService) => (s as unknown as { closeRevoked(): Promise<void> }).closeRevoked();
const connect = (s: EventsService, f: FakeStream, sid: string) => s.connect(1, 0, f.res, () => undefined, sid);

describe('поток событий: отозванные сеансы', () => {
  it('поток, подключившийся во время проверки, не получает ложный revoked', async () => {
    const db = fakePrisma(new Set(['s1', 's2']), true);
    service = new EventsService(db.prisma, version);
    const first = stream();
    await connect(service, first, 's1');
    const pending = check(service); // проверка спросила только сеанс s1 и ждёт ответа
    const second = stream();
    await connect(service, second, 's2'); // вторая вкладка того же сотрудника — новый вход
    db.release();
    await pending;
    expect(revoked(first)).toBe(false);
    expect(revoked(second)).toBe(false);
    expect(second.ended()).toBe(false);
    expect(service.connections).toBe(2);
  });

  it('завершённый сеанс закрывает свой поток и не трогает другие', async () => {
    const db = fakePrisma(new Set(['s2']));
    service = new EventsService(db.prisma, version);
    const ended = stream();
    const live = stream();
    await connect(service, ended, 's1');
    await connect(service, live, 's2');
    await check(service);
    expect(revoked(ended)).toBe(true);
    expect(ended.ended()).toBe(true);
    expect(revoked(live)).toBe(false);
    expect(service.connections).toBe(1);
  });
});
