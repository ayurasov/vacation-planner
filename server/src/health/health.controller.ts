import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infra/prisma.service';
import { Public } from '../auth/guards';

@ApiTags('health')
@Controller()
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  @ApiOperation({ operationId: 'healthz', summary: 'Живость процесса' })
  healthz(): { ok: true } {
    return { ok: true };
  }

  @Get('readyz')
  @ApiOperation({ operationId: 'readyz', summary: 'Готовность: БД отвечает' })
  async readyz(): Promise<{ ok: true; db: 'up' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, db: 'up' };
  }
}
