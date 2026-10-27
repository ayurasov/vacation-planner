import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.use(cookieParser());
  // Базовые security-заголовки (полный CSP — после аудита v0.3, см. ADR-011/backlog)
  app.use((req: import('express').Request, res: import('express').Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.setGlobalPrefix('');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // неизвестные поля игнорируются (совместимость вперёд)
    transform: true,
    transformOptions: { enableImplicitConversion: true }, // query-параметры приходят строками
    validationError: { target: false },
  }));
  app.enableShutdownHooks();

  // Спецификация реализации; источник истины — contracts/openapi-vacation-api-v1.yaml
  const doc = new DocumentBuilder()
    .setTitle('Vacation Planner API')
    .setDescription('Автогенерируемая спецификация реализации (сверяется с contracts/ в CI)')
    .setVersion(process.env.npm_package_version ?? '0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  console.log(`API планировщика отпусков слушает порт ${port}; документация: /api/docs`);
}

bootstrap().catch((e) => { console.error(e); process.exit(1); });
