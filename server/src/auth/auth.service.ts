import { Injectable } from '@nestjs/common';
import type { Prisma, Employee } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { hashPassword, verifyPassword } from './passwords';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';

export interface LoginResult {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string; // выставляется контроллером в httpOnly cookie
  user: Employee & { subordinates: number[] };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async login(login: string, password: string): Promise<LoginResult> {
    const employee = await this.prisma.employee.findFirst({
      where: { login: { equals: login, mode: 'insensitive' }, isActive: true },
      include: { subordinates: { where: { isActive: true }, select: { id: true } } },
    });
    // Единая ошибка: не раскрываем, что именно неверно
    if (!employee || !verifyPassword(password, employee.passwordHash)) {
      throw new ProblemException('auth/invalid-credentials');
    }
    const pwv = employee.pwVersion;
    const access = this.tokens.signAccess({
      sub: employee.id, login: employee.login, isAdmin: employee.isAdmin, pwv,
    });
    const refresh = this.tokens.newRefresh();
    await this.prisma.refreshToken.create({
      data: { userId: employee.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });
    return {
      accessToken: access.token,
      expiresAt: access.expiresAt,
      refreshToken: refresh.token,
      user: { ...employee, subordinates: employee.subordinates.map((s) => s.id) },
    };
  }

  /** Ротация refresh: старый отзывается, выдаётся новая пара. */
  async refresh(token: string): Promise<LoginResult> {
    const hash = this.tokens.hashRefresh(token);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new ProblemException('auth/invalid-credentials', 'Refresh-токен недействителен');
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueFor(stored.userId);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.tokens.hashRefresh(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changeOwnPassword(userId: number, oldPassword: string, newPassword: string): Promise<void> {
    const me = await this.prisma.employee.findUnique({ where: { id: userId } });
    if (!me || !verifyPassword(oldPassword, me.passwordHash)) {
      throw new ProblemException('auth/invalid-credentials', 'Старый пароль неверен');
    }
    await this.setPassword(userId, newPassword);
  }

  /** Смена пароля; `resetBy` — кто сбросил чужой пароль (попадает в аудит, сам пароль — нет). */
  async setPassword(userId: number, newPassword: string, resetBy?: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: userId },
        data: { passwordHash: hashPassword(newPassword), pwVersion: { increment: 1 } },
      });
      // Смена пароля отзывает все refresh-токены
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (resetBy !== undefined) {
        await this.audit.record(tx, {
          actorId: resetBy, action: 'employee.password_reset', entity: 'employee', entityId: userId,
        });
      }
    });
  }

  async me(userId: number): Promise<Employee & { subordinates: number[] }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: userId },
      include: { subordinates: { where: { isActive: true }, select: { id: true } } },
    });
    if (!employee || !employee.isActive) throw new ProblemException('not-found');
    return { ...employee, subordinates: employee.subordinates.map((s) => s.id) };
  }

  private async issueFor(userId: number): Promise<LoginResult> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: userId },
      include: { subordinates: { where: { isActive: true }, select: { id: true } } },
    });
    if (!employee || !employee.isActive) throw new ProblemException('not-found');
    const access = this.tokens.signAccess({
      sub: employee.id, login: employee.login, isAdmin: employee.isAdmin, pwv: employee.pwVersion,
    });
    const refresh = this.tokens.newRefresh();
    await this.prisma.refreshToken.create({
      data: { userId: employee.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });
    return {
      accessToken: access.token, expiresAt: access.expiresAt, refreshToken: refresh.token,
      user: { ...employee, subordinates: employee.subordinates.map((s) => s.id) },
    };
  }
}

export type EmployeeWithSubs = Employee & { subordinates: number[] };
export type PrismaTx = Prisma.TransactionClient;
