import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { NotificationsService } from './notifications.service';

export class ListQuery {
  @IsOptional() @Min(1)
    page?: number;

  @IsOptional() @Min(1) @Max(200)
    per_page?: number;

  @IsOptional() @IsBoolean()
    unread?: boolean;
}

@ApiTags('notifications')
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ operationId: 'listNotifications', summary: 'Уведомления текущего пользователя' })
  async list(@CurrentUser() user: AccessClaims, @Query() q: ListQuery) {
    return this.notifications.list(user.sub, {
      page: q.page ?? 1, perPage: q.per_page ?? 50, unread: q.unread,
    });
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ operationId: 'markAllNotificationsRead', summary: 'Пометить прочитанными все уведомления' })
  async readAll(@CurrentUser() user: AccessClaims) {
    return { marked: await this.notifications.markAllRead(user.sub) };
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiOperation({ operationId: 'markNotificationRead', summary: 'Пометить прочитанным' })
  async read(@CurrentUser() user: AccessClaims, @Param('id', ParseIntPipe) id: number) {
    await this.notifications.markRead(user.sub, id);
  }
}
