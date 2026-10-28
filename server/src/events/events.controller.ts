// Поток событий (SSE). EventSource не умеет заголовок Authorization, а access-токен в адресе
// попал бы в журналы прокси, поэтому вход — по одноразовому билету на 60 секунд.
import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { CurrentUser, Public } from '../auth/guards';
import { TokenService, type AccessClaims } from '../auth/token.service';
import { EventsService } from './events.service';

const AUDIENCE = 'vp-events';

@ApiTags('events')
@Controller('api/v1/events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('ticket')
  @HttpCode(200)
  @ApiOperation({ operationId: 'getEventsTicket', summary: 'Билет на поток событий (60 секунд)' })
  ticket(@CurrentUser() user: AccessClaims) {
    return { ticket: this.tokens.signTransient({ sub: user.sub, pwv: user.pwv }, AUDIENCE, '60s') };
  }

  @Public()
  @Get()
  @ApiOperation({ operationId: 'streamEvents', summary: 'Поток событий: hello, notifications, data (text/event-stream)' })
  async stream(@Query('ticket') ticket: string | undefined, @Req() req: Request, @Res() res: Response) {
    const claims = ticket ? this.tokens.verifyTransient<{ sub: number; pwv: number }>(ticket, AUDIENCE) : null;
    if (!claims) throw new ProblemException('auth/invalid-credentials', 'Билет потока событий недействителен');
    // Смена пароля или увольнение после выдачи билета — поток не открывается
    const me = await this.prisma.employee.findUnique({ where: { id: claims.sub }, select: { isActive: true, pwVersion: true } });
    if (!me?.isActive || me.pwVersion !== claims.pwv) throw new ProblemException('auth/invalid-credentials');
    await this.events.connect(claims.sub, res, (cb) => req.on('close', cb));
  }
}
