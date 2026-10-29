// Ошибки RFC 9457: единственный формат ошибок API (docs/specs/02-api-spec.md, раздел 7).
import {
  type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { dbErrors } from './metrics';
import { logEvent } from './log';

export const PROBLEM_BASE = 'https://vacation.planner/problems';

const CODE_TO_STATUS: Record<string, number> = {
  'auth/invalid-credentials': 401,
  'auth/token-expired': 401,
  'auth/forbidden': 403,
  'auth/account-locked': 423,
  'auth/password-change-required': 403,
  'validation/invalid-field': 400,
  'validation/weak-password': 400,
  'validation/bad-date-range': 400,
  'not-found': 404,
  'overlapping-request': 409,
  'limit-exceeded': 409,
  'stale-state': 409,
  'last-admin': 409,
  'department-not-empty': 409,
  'rate-limited': 429,
  'calendar-missing': 400,
  'service-unavailable': 503,
};

const CODE_TITLES: Record<string, string> = {
  'auth/invalid-credentials': 'Неверный логин или пароль',
  'auth/token-expired': 'Сессия истекла',
  'auth/forbidden': 'Недостаточно прав для этого действия',
  'auth/account-locked': 'Учётная запись временно заблокирована после неудачных попыток входа',
  'auth/password-change-required': 'Смените пароль, выданный администратором',
  'validation/invalid-field': 'Некорректно заполнено поле',
  'validation/weak-password': 'Пароль не соответствует политике паролей',
  'validation/bad-date-range': 'Дата окончания раньше даты начала или даты в прошлом',
  'not-found': 'Запись не существует или удалена',
  'overlapping-request': 'Период пересекается с существующей заявкой',
  'limit-exceeded': 'Превышен остаток дней отпуска',
  'stale-state': 'Данные изменились: обновите страницу и повторите',
  'last-admin': 'Нельзя удалить или разжаловать последнего администратора',
  'department-not-empty': 'В отделе ещё есть сотрудники',
  'rate-limited': 'Слишком много запросов. Повторите позже.',
  'calendar-missing': 'Для этого года не загружен производственный календарь',
  'service-unavailable': 'Сервис перегружен. Повторите через несколько секунд.',
};

/** Через сколько секунд повторять запрос (заголовок Retry-After). */
const RETRY_AFTER: Record<string, number> = { 'rate-limited': 60, 'service-unavailable': 5 };

// Ошибки Prisma, означающие перегрузку или недоступность БД, а не ошибку в запросе:
// P2024 — нет свободного соединения в пуле за pool_timeout, P2028 — транзакция не началась
// или не завершилась вовремя, P1001/P1002/P1017 — БД недоступна или разорвала соединение.
const DB_UNAVAILABLE = new Set(['P2024', 'P2028', 'P1001', 'P1002', 'P1017']);

@Injectable()
export class ProblemException extends HttpException {
  constructor(
    public readonly code: string,
    public readonly detail?: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    const status = CODE_TO_STATUS[code] ?? HttpStatus.BAD_REQUEST;
    super({ code, detail }, status);
  }

  toProblem(instance?: string) {
    // Поле в теле — для совместимости с v0.4.0; клиентам следует читать заголовок
    const extra = this.code === 'rate-limited' ? { 'Retry-After': RETRY_AFTER['rate-limited'] } : {};
    return {
      ...extra,
      type: `${PROBLEM_BASE}/${this.code}`,
      title: CODE_TITLES[this.code] ?? 'Ошибка запроса',
      status: this.getStatus(),
      detail: this.detail,
      instance: instance,
      ...(this.meta ?? {}),
    };
  }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ originalUrl?: string }>();
    // Каждый ответ об ошибке несёт идентификатор запроса (v1.0.0): пользователь сообщает его в
    // поддержку, а по нему находится строка журнала сервера (infra/log.ts)
    const requestId = typeof res.getHeader === 'function' ? res.getHeader('X-Request-Id') : undefined;
    if (requestId) {
      const send = res.json.bind(res);
      res.json = (body: unknown) => send(body && typeof body === 'object' ? { ...body, requestId: String(requestId) } : body);
    }

    if (exception instanceof ProblemException) {
      const retry = RETRY_AFTER[exception.code];
      if (retry) res.setHeader('Retry-After', String(retry));
      res.status(exception.getStatus()).contentType('application/problem+json')
        .json(exception.toProblem(req.originalUrl));
      return;
    }
    // Перегрузка БД — 503 с Retry-After: клиент или балансировщик повторит запрос, а в метриках
    // это видно отдельно от ошибок кода (vp_db_errors_total)
    const e = exception as { code?: unknown; errorCode?: unknown } | null;
    const prismaCode = e?.code ?? e?.errorCode; // errorCode — у ошибок инициализации (P1001)
    if (typeof prismaCode === 'string' && DB_UNAVAILABLE.has(prismaCode)) {
      dbErrors.inc({ code: prismaCode });
      logEvent('warn', 'database unavailable', { code: prismaCode });
      const p = new ProblemException('service-unavailable');
      res.setHeader('Retry-After', String(RETRY_AFTER['service-unavailable']));
      res.status(p.getStatus()).contentType('application/problem+json').json(p.toProblem(req.originalUrl));
      return;
    }
    // Нарушение уникальности при гонке (два импорта, два создания с одним логином) —
    // данные изменились параллельно: 409 из каталога, а не 500
    if ((exception as { code?: unknown })?.code === 'P2002') {
      const p = new ProblemException('stale-state', 'Запись с такими данными только что создана другим запросом — обновите страницу и повторите');
      res.status(p.getStatus()).contentType('application/problem+json').json(p.toProblem(req.originalUrl));
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 413) {
        const p = new ProblemException('validation/invalid-field', 'Файл слишком большой: не больше 2 МБ');
        res.status(p.getStatus()).contentType('application/problem+json').json(p.toProblem(req.originalUrl));
        return;
      }
      if (status === 400) {
        // Ошибки валидации пайплайна — единый код каталога
        const body = exception.getResponse();
        const detail = typeof body === 'string' ? body : 'Проверьте заполнение полей';
        res.status(400).contentType('application/problem+json').json({
          type: `${PROBLEM_BASE}/validation/invalid-field`,
          title: CODE_TITLES['validation/invalid-field'],
          status: 400,
          detail,
          instance: req.originalUrl,
        });
        return;
      }
      // Код из каталога, переданный исключением ({ code }), сохраняется: так клиент отличает
      // истёкший сеанс (auth/token-expired) от неверных данных входа. До v0.5.0 любой 401
      // превращался в auth/invalid-credentials.
      const given = (exception.getResponse() as { code?: unknown })?.code;
      const code = typeof given === 'string' && given in CODE_TITLES ? given
        : status === 401 ? 'auth/invalid-credentials'
          : status === 403 ? 'auth/forbidden'
            : status === 404 ? 'not-found' : 'internal';
      res.status(status).contentType('application/problem+json').json({
        type: `${PROBLEM_BASE}/${code}`,
        title: CODE_TITLES[code] ?? 'Ошибка',
        status,
        instance: req.originalUrl,
      });
      return;
    }
     
    const err = exception instanceof Error ? exception : new Error(String(exception));
    logEvent('error', 'unhandled error', { error: err.message, stack: err.stack });
    res.status(500).contentType('application/problem+json').json({
      type: `${PROBLEM_BASE}/internal`,
      title: 'Внутренняя ошибка сервера',
      status: 500,
      instance: req.originalUrl,
    });
  }
}
