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
}
