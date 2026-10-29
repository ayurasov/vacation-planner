// Журнал входов для кадровой службы и ИБ (v0.6.0, E62-01).
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { PrismaService } from '../infra/prisma.service';
import { assertStaff } from './access';
import { CurrentUser } from './guards';
import type { AccessClaims } from './token.service';
import { LOGIN_RESULTS, LoginJournal, type LoginResultCode } from './login-journal.service';

export class LoginEventsQuery {
  @IsOptional() @IsInt() @Min(1)
    page?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
    per_page?: number;

  @IsOptional() @IsInt()
    employee?: number;

  @IsOptional() @IsString() @MaxLength(64)
    login?: string;

  @IsOptional() @IsIn(LOGIN_RESULTS)
    result?: LoginResultCode;

  /** Только неуспешные: неверный пароль, неизвестный логин, блокировки, отказы по частоте. */
  @IsOptional() @Transform(({ obj }) => obj.failed === true || obj.failed === 'true') @IsBoolean()
    failed?: boolean;

  @IsOptional() @IsISO8601({ strict: true })
    from?: string;

  @IsOptional() @IsISO8601({ strict: true })
    to?: string;
}

@ApiTags('audit')
@Controller('api/v1/login-events')
export class LoginEventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: LoginJournal,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listLoginEvents', summary: 'Журнал входов (администратор, кадровая служба)' })
  async list(@CurrentUser() user: AccessClaims, @Query() q: LoginEventsQuery) {
    await assertStaff(this.prisma, user, 'hr');
    return this.journal.list({
      page: q.page ?? 1, perPage: q.per_page ?? 50, employee: q.employee, login: q.login,
      result: q.result, failedOnly: q.failed, from: q.from?.slice(0, 10), to: q.to?.slice(0, 10),
    });
  }
}
