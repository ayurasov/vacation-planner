// График: интервалы за период + конфликты отделов (Ф5, Ф6).
// Ответ одинаков для всех пользователей, поэтому кэшируется по версии данных: повторное
// открытие без изменений — 304 по ETag, без пересчёта и без передачи тела (v0.5.0).
import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { IsInt, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProblemException } from '../infra/problems';
import { DataVersionService, ResponseCache } from '../infra/data-version';
import { calendarDays } from '../requests/balance';
import { ScheduleService } from './schedule.service';

export class ScheduleQuery {
  @IsISO8601({})
    from!: string;

  @IsISO8601({})
    to!: string;

  @IsOptional() @IsString() @MaxLength(128)
    dept?: string;

  @IsOptional() @IsInt()
    project?: number;
}

@ApiTags('schedule')
@Controller('api/v1/schedule')
export class ScheduleController {
  private readonly cache = new ResponseCache(64 * 1024 * 1024);

  constructor(
    private readonly schedule: ScheduleService,
    private readonly version: DataVersionService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'getSchedule', summary: 'График отпусков и режимов за период (ETag, 304 без изменений)' })
  async get(@Query() q: ScheduleQuery, @Req() req: Request, @Res() res: Response) {
    if (q.from > q.to) throw new ProblemException('validation/bad-date-range');
    if (calendarDays(q.from, q.to) > 370) {
      throw new ProblemException('validation/invalid-field', 'Период не длиннее 370 дней');
    }
    const version = await this.version.current(); // до данных: версия не опережает данные
    const key = `${version}|${q.from}|${q.to}|${q.dept ?? ''}|${q.project ?? ''}`;
    const etag = `W/"s${version}-${createHash('sha1').update(key).digest('base64url').slice(0, 12)}"`;
    // private: ответ только для вошедших; no-cache: браузер каждый раз сверяет ETag
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    let body = this.cache.get(key);
    if (body === undefined) {
      body = JSON.stringify(await this.schedule.build(q));
      this.cache.set(key, body);
    }
    res.status(200).type('application/json').send(body);
  }
}
