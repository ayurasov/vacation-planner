// Ошибки RFC 9457: единственный формат ошибок API (docs/specs/02-api-spec.md, раздел 7).
import {
  type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Injectable,
} from '@nestjs/common';
import type { Response } from 'express';

export const PROBLEM_BASE = 'https://vacation.planner/problems';

const CODE_TO_STATUS: Record<string, number> = {
  'auth/invalid-credentials': 401,
  'auth/token-expired': 401,
  'auth/forbidden': 403,
  'validation/invalid-field': 400,
  'validation/bad-date-range': 400,
  'not-found': 404,
  'overlapping-request': 409,
  'limit-exceeded': 409,
  'stale-state': 409,
  'last-admin': 409,
  'department-not-empty': 409,
  'rate-limited': 429,
  'calendar-missing': 400,
};

const CODE_TITLES: Record<string, string> = {
  'auth/invalid-credentials': 'Неверный логин или пароль',
  'auth/token-expired': 'Сессия истекла',
  'auth/forbidden': 'Недостаточно прав для этого действия',
  'validation/invalid-field': 'Некорректно заполнено поле',
  'validation/bad-date-range': 'Дата окончания раньше даты начала или даты в прошлом',
  'not-found': 'Запись не существует или удалена',
  'overlapping-request': 'Период пересекается с существующей заявкой',
  'limit-exceeded': 'Превышен остаток дней отпуска',
  'stale-state': 'Данные изменились: обновите страницу и повторите',
  'last-admin': 'Нельзя удалить или разжаловать последнего администратора',
  'department-not-empty': 'В отделе ещё есть сотрудники',
  'rate-limited': 'Слишком много запросов. Повторите позже.',
  'calendar-missing': 'Для этого года не загружен производственный календарь',
};

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
    const extra = this.code === 'rate-limited' ? { 'Retry-After': 60 } : {};
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

    if (exception instanceof ProblemException) {
      res.status(exception.getStatus()).contentType('application/problem+json')
        .json(exception.toProblem(req.originalUrl));
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
      const code = status === 401 ? 'auth/invalid-credentials'
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
     
    console.error('Необработанная ошибка', exception);
    res.status(500).contentType('application/problem+json').json({
      type: `${PROBLEM_BASE}/internal`,
      title: 'Внутренняя ошибка сервера',
      status: 500,
      instance: req.originalUrl,
    });
  }
}
