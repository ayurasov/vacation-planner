// Настройки организации (изменение — только администратор).
import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { DEFAULT_UNIT_KINDS, loadTree, validUnitKinds, type UnitKind } from '../org/org.service';
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

  // Безопасность (v0.6.0): политика паролей, блокировка после неудачных попыток, журнал входов
  @IsOptional() @IsInt() @Min(8) @Max(64)
    passwordMinLength?: number;

  @IsOptional() @IsInt() @Min(0) @Max(50)
    lockoutThreshold?: number;

  @IsOptional() @IsInt() @Min(1) @Max(1440)
    lockoutMinutes?: number;

  @IsOptional() @IsInt() @Min(30) @Max(3650)
    loginRetentionDays?: number;

  // Согласование (v0.6.0): дней без решения до передачи вышестоящему; 0 — не передаётся
  @IsOptional() @IsInt() @Min(0) @Max(60)
    escalationDays?: number;

  // Извещение о начале отпуска (v0.6.0): за сколько дней; по ст. 123 ТК РФ — не меньше двух недель
  @IsOptional() @IsInt() @Min(14) @Max(60)
    noticeDays?: number;

  // Реквизиты и подписанты формы Т-7 (v0.6.0); пустая строка — очистить
  @IsOptional() @IsString() @MaxLength(300)
    orgName?: string;

  @IsOptional() @Matches(/^(\d{8}|\d{10})?$/, { message: 'ОКПО: 8 или 10 цифр' })
    orgOkpo?: string;

  @IsOptional() @IsString() @MaxLength(128)
    headPosition?: string;

  @IsOptional() @IsString() @MaxLength(128)
    headName?: string;

  @IsOptional() @IsString() @MaxLength(128)
    hrHeadPosition?: string;

  @IsOptional() @IsString() @MaxLength(128)
    hrHeadName?: string;

  /** Виды уровней структуры (v1.1.0): [{ value, label, color }] — как в «По Делу». */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30)
    unitKinds?: UnitKind[];

  /** Наибольшая глубина структуры: 2–30 уровней. */
  @IsOptional() @IsInt() @Min(2) @Max(30)
    orgMaxDepth?: number;
}

const REQUISITES = ['orgName', 'orgOkpo', 'headPosition', 'headName', 'hrHeadPosition', 'hrHeadName'] as const;

type SettingsView = {
  id: number; conflictThreshold: number; timezone: string; limitPolicy: string; defaultPlannedDays: number;
  passwordMinLength: number; lockoutThreshold: number; lockoutMinutes: number; loginRetentionDays: number;
  escalationDays: number; noticeDays: number;
  orgName: string | null; orgOkpo: string | null; headPosition: string | null; headName: string | null;
  hrHeadPosition: string | null; hrHeadName: string | null;
  unitKinds: UnitKind[]; orgMaxDepth: number;
};

@ApiTags('settings')
@Controller('api/v1/settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private async ensure(): Promise<SettingsView> {
    const s = await this.prisma.orgSettings.upsert({
      where: { id: 1 }, update: {}, create: { id: 1 },
    });
    return {
      id: s.id, conflictThreshold: s.conflictThreshold, timezone: s.timezone,
      limitPolicy: s.limitPolicy, defaultPlannedDays: s.defaultPlannedDays,
      passwordMinLength: s.passwordMinLength, lockoutThreshold: s.lockoutThreshold,
      lockoutMinutes: s.lockoutMinutes, loginRetentionDays: s.loginRetentionDays,
      escalationDays: s.escalationDays, noticeDays: s.noticeDays,
      orgName: s.orgName, orgOkpo: s.orgOkpo, headPosition: s.headPosition, headName: s.headName,
      hrHeadPosition: s.hrHeadPosition, hrHeadName: s.hrHeadName,
      unitKinds: validUnitKinds(s.unitKinds) ?? [...DEFAULT_UNIT_KINDS], orgMaxDepth: s.orgMaxDepth,
    };
  }

  @Get()
  @ApiOperation({ operationId: 'getSettings', summary: 'Настройки организации' })
  async get() {
    const s = await this.ensure();
    return {
      conflictThreshold: s.conflictThreshold, timezone: s.timezone,
      limitPolicy: s.limitPolicy, defaultPlannedDays: s.defaultPlannedDays,
      passwordMinLength: s.passwordMinLength, lockoutThreshold: s.lockoutThreshold,
      lockoutMinutes: s.lockoutMinutes, loginRetentionDays: s.loginRetentionDays,
      escalationDays: s.escalationDays, noticeDays: s.noticeDays,
      orgName: s.orgName, orgOkpo: s.orgOkpo, headPosition: s.headPosition, headName: s.headName,
      hrHeadPosition: s.hrHeadPosition, hrHeadName: s.hrHeadName,
      unitKinds: s.unitKinds, orgMaxDepth: s.orgMaxDepth,
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
    if (dto.lockoutThreshold !== undefined && dto.lockoutThreshold > 0 && dto.lockoutThreshold < 3) {
      throw new ProblemException('validation/invalid-field', 'Блокировка — после 3 и более неудачных попыток или 0 (без блокировки)');
    }
    const before = await this.ensure();
    const data: Record<string, unknown> = { ...dto };
    if (dto.unitKinds !== undefined) data.unitKinds = await this.checkKinds(dto.unitKinds);
    if (dto.orgMaxDepth !== undefined) {
      const tree = await loadTree(this.prisma);
      const deepest = Math.max(0, ...tree.children(null).map((n) => tree.height(n.id)));
      if (deepest > dto.orgMaxDepth) throw new ProblemException('validation/invalid-field', `В структуре уже ${deepest} уровней — сначала сократите её`);
    }
    for (const k of REQUISITES) if (typeof data[k] === 'string') data[k] = (data[k] as string).trim() || null;
    // Изменение и запись аудита — одной транзакцией (ADR-006, AGENTS.md): без изменения нет записи и наоборот
    await this.prisma.$transaction(async (tx) => {
      await tx.orgSettings.update({ where: { id: 1 }, data });
      await this.audit.record(tx, {
        actorId: user.sub, action: 'settings.updated', entity: 'org_settings', entityId: '1',
        before, after: dto,
      });
    });
    return this.get();
  }

  /** Виды уровней: правила «По Делу»; вид, который носят подразделения, удалить нельзя. */
  private async checkKinds(raw: unknown): Promise<UnitKind[]> {
    const kinds = validUnitKinds(raw);
    if (!kinds) throw new ProblemException('validation/invalid-field', 'Виды уровней: код латиницей, название до 40 символов, цвет #RRGGBB, коды не повторяются');
    const used = await this.prisma.department.groupBy({ by: ['kind'], _count: true });
    const missing = used.filter((u) => !kinds.some((k) => k.value === u.kind));
    if (missing.length) {
      throw new ProblemException('validation/invalid-field',
        `Вид «${missing[0].kind}» носят подразделения (${missing[0]._count}) — сначала смените их вид`);
    }
    return kinds;
  }
}
