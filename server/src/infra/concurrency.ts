// Число процессов API и размер пула соединений с БД на процесс (v0.5.0).
import { availableParallelism } from 'node:os';

/**
 * Число процессов: WEB_CONCURRENCY (auto — по числу ядер). Node обслуживает запросы одним ядром,
 * поэтому на сервере с N ядрами без кластера занято одно (v0.5.0: 66 запросов/с при 500 пользователях).
 * Общее состояние процессов — только в PostgreSQL: лимит входа, очередь писем, версия данных.
 */
export function workers(): number {
  const raw = process.env.WEB_CONCURRENCY ?? '1';
  const n = raw === 'auto' ? availableParallelism() : Number(raw);
  return Number.isInteger(n) && n > 1 ? Math.min(n, 32) : 1;
}

/** Бюджет соединений одного экземпляра server: остальное — второй экземпляр, резервное копирование, реплика. */
const INSTANCE_BUDGET = 40;

/**
 * Адрес БД с размером пула на процесс. По умолчанию Prisma берёт 2 × ядер + 1 соединений на процесс:
 * при WEB_CONCURRENCY=auto на 16 ядрах это 16 × 33 = 528 соединений при max_connections = 100.
 * Поэтому пул — min(10, 40 / процессов), не меньше 3. Явный connection_limit в DATABASE_URL
 * или DB_POOL_SIZE имеют приоритет.
 */
export function databaseUrl(url = process.env.DATABASE_URL ?? ''): string {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  const explicit = Number(process.env.DB_POOL_SIZE);
  const size = Number.isInteger(explicit) && explicit > 0
    ? explicit
    : Math.min(10, Math.max(3, Math.floor(INSTANCE_BUDGET / workers())));
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${size}`;
}
