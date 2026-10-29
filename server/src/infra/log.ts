// Журнал сервера (v1.0.0, E50-03, E51-05): строки JSON с идентификатором запроса — по нему
// связываются ответ пользователю (заголовок X-Request-Id, поле requestId ошибки), строка журнала
// сервера, медленный SQL и запись журнала входов или аудита. Тела запросов, параметры SQL,
// пароли и токены в журнал не пишутся.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { routeOf } from './metrics';

export interface RequestContext {
  id: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const currentRequestId = (): string | undefined => requestContext.getStore()?.id;

export type Level = 'debug' | 'info' | 'warn' | 'error';

const JSON_FORMAT = () => (process.env.LOG_FORMAT ?? 'text') === 'json';

/** Строка журнала. В формате text — для разработки: время, уровень, сообщение и поля. */
export function logEvent(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const reqId = currentRequestId();
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (JSON_FORMAT()) {
    out.write(`${JSON.stringify({ ts: new Date().toISOString(), level, msg, pid: process.pid, ...(reqId ? { reqId } : {}), ...fields })}\n`);
    return;
  }
  const extra = Object.entries({ ...(reqId ? { reqId } : {}), ...fields })
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  out.write(`${new Date().toISOString()} ${level.toUpperCase()} ${msg}${extra ? ` ${extra}` : ''}\n`);
}

// Перечень модулей и маршрутов при старте — сотня строк на каждый процесс, в эксплуатации не нужна
const STARTUP_NOISE = new Set(['InstanceLoader', 'RoutesResolver', 'RouterExplorer']);

/** Сообщения Nest (старт, плановые задачи, ошибки модулей) — тем же форматом. */
export class AppLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    if (context && STARTUP_NOISE.has(context)) return;
    logEvent('info', String(message), context ? { context } : {});
  }
  warn(message: unknown, context?: string): void { logEvent('warn', String(message), context ? { context } : {}); }
  error(message: unknown, trace?: string, context?: string): void {
    logEvent('error', String(message), { ...(context ? { context } : {}), ...(trace ? { stack: trace } : {}) });
  }
  debug(): void { /* отладочные сообщения Nest не нужны в эксплуатации */ }
  verbose(): void { /* то же */ }
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Идентификатор запроса и журнал запросов. Идентификатор берётся из X-Request-Id прокси
 * (если он правильного вида) или создаётся; возвращается в ответе. Режим REQUEST_LOG:
 * slow (по умолчанию) — запросы дольше SLOW_REQUEST_MS (1000 мс) и ответы 5xx; all — все; off.
 */
export function requestTracking(req: Request, res: Response, next: NextFunction): void {
  const given = req.get('x-request-id');
  const id = given && REQUEST_ID.test(given) ? given : randomUUID();
  res.setHeader('X-Request-Id', id);
  const mode = process.env.REQUEST_LOG ?? 'slow';
  if (mode !== 'off') {
    const slowMs = Number(process.env.SLOW_REQUEST_MS ?? 1000);
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      // Поток событий открыт часами — его длительность не медленность
      const stream = String(res.getHeader('content-type') ?? '').startsWith('text/event-stream');
      const slow = !stream && ms >= slowMs;
      if (mode !== 'all' && !slow && res.statusCode < 500) return;
      const user = (req as Request & { user?: { sub?: number } }).user?.sub;
      requestContext.run({ id }, () => logEvent(res.statusCode >= 500 ? 'error' : slow ? 'warn' : 'info', slow ? 'slow request' : 'request', {
        method: req.method, route: routeOf(req), status: res.statusCode, ms,
        ...(user ? { user } : {}), ip: req.ip,
      }));
    });
  }
  requestContext.run({ id }, next);
}
