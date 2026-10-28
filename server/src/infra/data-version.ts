// Версия данных графика (таблица data_version, триггеры миграции 20261030090000_data_version).
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class DataVersionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Текущая зафиксированная версия. Читать ДО данных: тогда версия не опережает данные. */
  async current(): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<Array<{ version: bigint | null }>>`SELECT sum(version)::bigint AS version FROM data_version`;
    return rows[0]?.version ?? 0n;
  }
}

/** Кэш готовых ответов в памяти процесса с ограничением по объёму; вытесняется давно не читавшееся. */
export class ResponseCache {
  private readonly items = new Map<string, string>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): string | undefined {
    const v = this.items.get(key);
    if (v !== undefined) { this.items.delete(key); this.items.set(key, v); } // в конец — недавно читали
    return v;
  }

  set(key: string, body: string): void {
    if (body.length > this.maxBytes) return;
    const old = this.items.get(key);
    if (old !== undefined) { this.bytes -= old.length; this.items.delete(key); }
    this.items.set(key, body);
    this.bytes += body.length;
    for (const [k, v] of this.items) {
      if (this.bytes <= this.maxBytes) break;
      this.items.delete(k);
      this.bytes -= v.length;
    }
  }

  get size(): number { return this.items.size; }
}
