import 'reflect-metadata';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
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

/**
 * Число процессов: WEB_CONCURRENCY (auto — по числу ядер). Node обслуживает запросы одним ядром,
 * поэтому на сервере с N ядрами без кластера занято одно (v0.5.0: 66 запросов/с при 500 пользователях).
 * Общее состояние процессов — только в PostgreSQL: лимит входа, очередь писем, версия данных.
 */
function workers(): number {
  const raw = process.env.WEB_CONCURRENCY ?? '1';
  const n = raw === 'auto' ? availableParallelism() : Number(raw);
  return Number.isInteger(n) && n > 1 ? Math.min(n, 32) : 1;
}

function primary(n: number): void {
  console.log(`Запуск ${n} процессов API`);
  let stopping = false;
  const restarts: number[] = [];
  for (let i = 0; i < n; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    if (stopping) return;
    // Упавший процесс перезапускается; частые падения (5 за минуту) — останов, чтобы оркестратор увидел сбой
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && restarts[0] < now - 60_000) restarts.shift();
    if (restarts.length > 5) {
      console.error('Процессы API падают слишком часто — останов');
      process.exit(1);
    }
    console.warn(`Процесс API ${worker.process.pid} завершился (${signal ?? code}), перезапуск`);
    cluster.fork();
  });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      stopping = true;
      for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(sig);
      setTimeout(() => process.exit(0), 15_000).unref();
      cluster.on('exit', () => { if (!Object.keys(cluster.workers ?? {}).length) process.exit(0); });
    });
  }
}

const n = workers();
if (n > 1 && cluster.isPrimary) {
  primary(n);
} else {
  bootstrap().catch((e) => { console.error(e); process.exit(1); });
}
