// Уведомления: создание при событиях заявок + входящие пользователя.
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Уведомление в интерфейсе и письмо — в одной транзакции с событием. */
  async notify(
    tx: Prisma.TransactionClient,
    employeeId: number,
    kind: string,
    text: string,
    payload?: Record<string, unknown>,
  ) {
    const n = await tx.notification.create({
      data: { employeeId, kind, text, payload: payload as Prisma.InputJsonValue | undefined },
    });
    await this.mail.enqueueFor(tx, employeeId, kind, text);
    return n;
  }

  /** Одно и то же событие многим сотрудникам: уведомления и письма пачкой, в той же транзакции. */
  async notifyMany(
    tx: Prisma.TransactionClient,
    items: Array<{ employeeId: number; text: string }>,
    kind: string,
    payload?: Record<string, unknown>,
  ): Promise<number> {
    if (!items.length) return 0;
    await tx.notification.createMany({
      data: items.map((i) => ({ employeeId: i.employeeId, kind, text: i.text, payload: payload as Prisma.InputJsonValue | undefined })),
    });
    await this.mail.enqueueMany(tx, items, kind);
    return items.length;
  }

  list(userId: number, params: { page: number; perPage: number; unread?: boolean }) {
    const where = { employeeId: userId, ...(params.unread ? { isRead: false } : {}) };
    return this.prisma.$transaction([
      this.prisma.notification.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.perPage, take: params.perPage,
      }),
      this.prisma.notification.count({ where }),
    ]).then(([items, total]) => ({ items, meta: { page: params.page, perPage: params.perPage, total } }));
  }

  async markRead(userId: number, id: number): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id, employeeId: userId }, data: { isRead: true } });
  }

  /** Все непрочитанные — одним запросом (раньше клиент отправлял по запросу на уведомление). */
  async markAllRead(userId: number): Promise<number> {
    const r = await this.prisma.notification.updateMany({ where: { employeeId: userId, isRead: false }, data: { isRead: true } });
    return r.count;
  }
}
