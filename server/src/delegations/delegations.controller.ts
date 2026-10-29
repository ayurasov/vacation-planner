import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional } from 'class-validator';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { DelegationsService } from './delegations.service';

export class DelegationCreateDto {
  /** Руководитель; по умолчанию — сам. За другого назначает кадровая служба. */
  @IsOptional() @IsInt()
    managerId?: number;

  @IsInt()
    deputyId!: number;

  @IsISO8601({ strict: true })
    start!: string;

  @IsISO8601({ strict: true })
    end!: string;
}

export class DelegationsQuery {
  @IsOptional() @IsInt()
    manager?: number;
}

@ApiTags('delegations')
@Controller('api/v1/delegations')
export class DelegationsController {
  constructor(private readonly delegations: DelegationsService) {}

  @Get()
  @ApiOperation({ operationId: 'listDelegations', summary: 'Замещения: переданные мной и полученные мной; кадровая служба — любого руководителя' })
  list(@CurrentUser() user: AccessClaims, @Query() q: DelegationsQuery) {
    return this.delegations.list(user, q.manager);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createDelegation', summary: 'Передать согласование заместителю на период' })
  create(@CurrentUser() user: AccessClaims, @Body() dto: DelegationCreateDto) {
    return this.delegations.create(user, { ...dto, start: dto.start.slice(0, 10), end: dto.end.slice(0, 10) });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'revokeDelegation', summary: 'Отменить замещение (руководитель или кадровая служба)' })
  async revoke(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    await this.delegations.revoke(user, id);
  }
}
