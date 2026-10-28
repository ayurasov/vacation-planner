import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  configureApp(app);
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
