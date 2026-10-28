// Аудит: append-only журнал; запись всегда в транзакции с изменением (ADR-006).
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Вызывать только внутри tx клиента, переданного вторым аргументом. */
  record(
    tx: Prisma.TransactionClient,
    data: {
      actorId: number | null;
      action: string;
      entity: string;
      entityId: string | number;
      before?: unknown;
      after?: unknown;
    },
  ) {
    return tx.auditEvent.create({
      data: {
        actorId: data.actorId,
        action: data.action,
        entity: data.entity,
        entityId: String(data.entityId),
        before: data.before == null ? undefined : (data.before as Prisma.InputJsonValue),
        after: data.after == null ? undefined : (data.after as Prisma.InputJsonValue),
      },
    });
  }

  list(params: { page: number; perPage: number; employee?: number; entity?: string }) {
    const where = {
      ...(params.employee ? { actorId: params.employee } : {}),
      ...(params.entity ? { entity: params.entity } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { ts: 'desc' },
        skip: (params.page - 1) * params.perPage,
        take: params.perPage,
        include: { actor: { select: { name: true } } },
      }),
      this.prisma.auditEvent.count({ where }),
    ]).then(([items, total]) => ({
      items: items.map(({ actor, ...e }) => ({ ...e, actorName: actor?.name ?? null })),
      meta: { page: params.page, perPage: params.perPage, total },
    }));
  }
}
