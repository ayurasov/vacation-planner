// Настройки организации (изменение — только администратор).
import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { MailService } from '../mail/mail.service';

export class SettingsUpdateDto {
  @IsOptional() @IsInt() @Min(20) @Max(80)
    conflictThreshold?: number;

  @IsOptional() @IsString() @MaxLength(64)
    timezone?: string;

  @IsOptional() @IsIn(['hard', 'soft'])
    limitPolicy?: 'hard' | 'soft';

  @IsOptional() @IsInt() @Min(20) @Max(60)
    defaultPlannedDays?: number;
}

@ApiTags('settings')
@Controller('api/v1/settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private async ensure(): Promise<{ id: number; conflictThreshold: number; timezone: string; limitPolicy: string; defaultPlannedDays: number }> {
    const s = await this.prisma.orgSettings.upsert({
      where: { id: 1 }, update: {}, create: { id: 1 },
    });
    return {
      id: s.id, conflictThreshold: s.conflictThreshold, timezone: s.timezone,
      limitPolicy: s.limitPolicy, defaultPlannedDays: s.defaultPlannedDays,
    };
  }

  @Get()
  @ApiOperation({ operationId: 'getSettings', summary: 'Настройки организации' })
  async get() {
    const s = await this.ensure();
    return {
      conflictThreshold: s.conflictThreshold, timezone: s.timezone,
      limitPolicy: s.limitPolicy, defaultPlannedDays: s.defaultPlannedDays,
      mailEnabled: this.mail.config.enabled,
    };
  }

  @Post('test-email')
  @HttpCode(200)
  @ApiOperation({ operationId: 'sendTestEmail', summary: 'Проверочное письмо администратору: проверка SMTP после развёртывания' })
  async testEmail(@CurrentUser() user: AccessClaims) {
    const me = await this.prisma.employee.findUnique({ where: { id: user.sub } });
    if (!me?.isAdmin) throw new ProblemException('auth/forbidden');
    const cfg = this.mail.config;
    if (!cfg.enabled) throw new ProblemException('validation/invalid-field', 'Почта не настроена: задайте SMTP_HOST и другие параметры SMTP в окружении сервера');
    if (!me.email) throw new ProblemException('validation/invalid-field', 'Укажите свой email в карточке сотрудника');
    await this.mail.enqueue(this.prisma, me.id, me.email, 'test', {
      subject: 'Проверка почты планировщика отпусков',
      body: `Здравствуйте!\n\nПочта настроена: письма о заявках и еженедельные сводки будут приходить с адреса ${cfg.from}.\n\n${cfg.appUrl}`,
    });
    await this.mail.flush();
    const last = await this.prisma.emailOutbox.findFirst({ where: { employeeId: me.id, kind: 'test' }, orderBy: { id: 'desc' } });
    const sent = last?.status === 'sent';
    return { to: me.email, sent, error: sent ? null : last?.lastError ?? null };
  }

  @Patch()
  @ApiOperation({ operationId: 'updateSettings', summary: 'Изменить настройки (только администратор)' })
  async update(@CurrentUser() user: AccessClaims, @Body() dto: SettingsUpdateDto) {
    const me = await this.prisma.employee.findUnique({ where: { id: user.sub } });
    if (!me?.isAdmin) throw new ProblemException('auth/forbidden');
    const before = await this.ensure();
    await this.prisma.orgSettings.update({ where: { id: 1 }, data: dto });
    await this.audit.record(this.prisma, {
      actorId: user.sub, action: 'settings.updated', entity: 'org_settings', entityId: '1',
      before, after: dto,
    });
    return this.get();
  }
}
