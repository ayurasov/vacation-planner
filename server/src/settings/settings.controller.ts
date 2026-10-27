// Настройки организации (изменение — только администратор).
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';

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
    };
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
