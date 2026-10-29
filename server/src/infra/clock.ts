// Даты по времени организации (v0.6.0): начало суток, сроки замещения и извещений считаются
// не по UTC сервера, а в часовом поясе из правил организации.
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Дата «ГГГГ-ММ-ДД» в часовом поясе. */
export function dateIn(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Сегодня по времени организации. */
export async function orgToday(db: Db, now = new Date()): Promise<string> {
  const s = await db.orgSettings.findUnique({ where: { id: 1 }, select: { timezone: true } });
  return dateIn(s?.timezone ?? 'Europe/Moscow', now);
}
