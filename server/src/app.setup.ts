// Общая настройка HTTP-приложения: используется main.ts и тестовой обвязкой (test/helpers.ts),
// чтобы e2e-тесты проверяли ту же конфигурацию, что работает в продакшене.
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { httpMetrics } from './infra/metrics';

export function configureApp(app: NestExpressApplication): void {
  // Адрес клиента из X-Forwarded-For только от доверенных прокси (nginx стенда и прокси организации
  // в частных сетях). Без этого req.ip — адрес nginx, и лимит входа общий на всех (auth/rate-limit.ts).
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  app.use(httpMetrics); // задержки и коды ответов по маршрутам для /metrics
  app.use(cookieParser());
  // Security-заголовки ответов API (статику SPA защищает nginx, включая CSP — web/nginx.conf)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // неизвестные поля игнорируются (совместимость вперёд)
    transform: true,
    transformOptions: { enableImplicitConversion: true }, // query-параметры приходят строками
    validationError: { target: false },
  }));
}
