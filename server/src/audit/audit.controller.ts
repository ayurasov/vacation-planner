import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { JwtAuthGuard, CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { AuditService } from './audit.service';

export class AuditQuery {
  @IsOptional() @Min(1)
    page?: number;

  @IsOptional() @Min(1) @Max(200)
    per_page?: number;

  @IsOptional() @IsInt()
    employee?: number;

  @IsOptional() @IsString() @MaxLength(64)
    entity?: string;
}

@ApiTags('audit')
@Controller('api/v1/audit-events')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listAuditEvents', summary: 'Журнал изменений (администратор)' })
  async list(@CurrentUser() user: AccessClaims, @Query() q: AuditQuery) {
    const me = await this.prisma.employee.findUnique({ where: { id: user.sub } });
    if (!me?.isAdmin) throw new ProblemException('auth/forbidden');
    return this.audit.list({
      page: q.page ?? 1, perPage: q.per_page ?? 50,
      employee: q.employee, entity: q.entity,
    });
  }
}
