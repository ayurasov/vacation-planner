import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { databaseUrl } from './concurrency';
import { logEvent } from './log';

/** Порог медленной операции БД, мс; 0 — не отслеживать (замер каждой операции стоит процессора). */
const slowQueryMs = (): number => Number(process.env.SLOW_QUERY_MS ?? 0);

interface Operation { model?: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }

/** Текст SQL сырого запроса без параметров: Prisma.sql хранит фрагменты отдельно от значений. */
function rawText(args: unknown): string | undefined {
  const a = args as { strings?: readonly string[]; sql?: string } | readonly unknown[] | undefined;
  const sql = Array.isArray(a) ? (a[0] as { strings?: readonly string[] })?.strings?.join('?') : (a as { sql?: string })?.sql;
  return sql?.replace(/\s+/g, ' ').slice(0, 2000);
}

// Единственный клиент БД на процесс (docs/specs/01-architecture.md); размер пула — infra/concurrency.ts.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasources: { db: { url: databaseUrl() } } });
    const slow = slowQueryMs();
    if (slow > 0) {
      // Медленные операции БД (v1.0.0, E51-05). Расширение выполняется в контексте вызывающего
      // кода, поэтому строка журнала несёт идентификатор запроса API (события движка Prisma его
      // теряют). Параметры не пишутся: в них бывают персональные данные и хеши паролей.
      return this.$extends({
        query: {
          async $allOperations({ model, operation, args, query }: Operation) {
            const start = process.hrtime.bigint();
            try {
              return await query(args);
            } finally {
              const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
              if (ms >= slow) {
                logEvent('warn', 'slow query', { ms, ...(model ? { model } : {}), operation, ...(model ? {} : { query: rawText(args) }) });
              }
            }
          },
        },
      }) as unknown as PrismaService;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
