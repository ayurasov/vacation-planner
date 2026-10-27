import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, MaxLength } from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { RequestsService, type Actor } from './requests.service';

export class CreateRequestDto {
  @IsOptional() @IsInt()
    employee?: number;

  @IsISO8601({})
    start!: string;

  @IsISO8601({})
    end!: string;

  @IsOptional() @IsString() @MaxLength(1000)
    comment?: string;
}

export class UpdateRequestDto {
  @IsOptional() @IsISO8601({})
    start?: string;

  @IsOptional() @IsISO8601({})
    end?: string;

  @IsOptional() @IsString() @MaxLength(1000)
    comment?: string;
}

export class RejectDto {
  @IsString() @Length(3, 1000)
    comment!: string;
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(1000)
    comment?: string;
}

export class ListQuery {
  @IsOptional() @IsIn(['mine', 'subordinates', 'all'])
    scope?: 'mine' | 'subordinates' | 'all';

  @IsOptional() @IsIn(['pending', 'approved', 'rejected', 'cancelled'])
    status?: string;

  @IsOptional() @IsInt()
    employee?: number;

  @IsOptional() @Min(1)
    page?: number;

  @IsOptional() @Min(1) @Max(200)
    per_page?: number;
}

@ApiTags('vacation-requests')
@Controller('api/v1/vacation-requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly prisma: PrismaService,
  ) {}

  private async actor(user: AccessClaims): Promise<Actor> {
    const me = await this.prisma.employee.findUnique({
      where: { id: user.sub },
      include: { subordinates: { where: { isActive: true }, select: { id: true } } },
    });
    if (!me) throw new ProblemException('not-found');
    return { id: me.id, isAdmin: me.isAdmin, subordinates: me.subordinates.map((s) => s.id) };
  }

  @Get()
  @ApiOperation({ operationId: 'listVacationRequests', summary: 'Заявки (свои, подчинённых или все — по правам)' })
  async list(@CurrentUser() user: AccessClaims, @Query() q: ListQuery) {
    return this.requests.list(await this.actor(user), {
      scope: q.scope ?? 'mine',
      status: q.status,
      employee: q.employee,
      page: q.page ?? 1,
      perPage: q.per_page ?? 50,
    });
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createVacationRequest', summary: 'Создать заявку (за себя или за подчинённого)' })
  async create(@CurrentUser() user: AccessClaims, @Body() dto: CreateRequestDto) {
    const created = await this.requests.create(await this.actor(user), dto);
    return this.requests.get(await this.actor(user), created.id);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getVacationRequest', summary: 'Заявка с историей' })
  async get(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    return this.requests.get(await this.actor(user), id);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateVacationRequest', summary: 'Изменить свою pending-заявку или запросить перенос approved' })
  async update(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRequestDto) {
    await this.requests.update(await this.actor(user), id, dto);
    return this.requests.get(await this.actor(user), id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'cancelVacationRequest', summary: 'Отменить заявку или запросить удаление одобренного отпуска' })
  async cancel(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    await this.requests.cancel(await this.actor(user), id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ operationId: 'approveVacationRequest', summary: 'Согласовать (руководитель или администратор)' })
  async approve(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number, @Body() dto: DecisionDto) {
    const result = await this.requests.approve(await this.actor(user), id, dto.comment);
    if ('deleted' in result) return { deleted: true };
    return this.requests.get(await this.actor(user), id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ operationId: 'rejectVacationRequest', summary: 'Отклонить с обязательным комментарием' })
  async reject(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto) {
    await this.requests.reject(await this.actor(user), id, dto.comment);
    return this.requests.get(await this.actor(user), id);
  }
}
