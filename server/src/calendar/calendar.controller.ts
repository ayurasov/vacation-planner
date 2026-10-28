// Производственный календарь (ADR-008): чтение — без входа, правка — кадровая служба и администратор.
import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsISO8601, ValidateNested } from 'class-validator';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { AuditService } from '../audit/audit.service';
import { assertStaff } from '../auth/access';
import { CurrentUser, Public } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';

export class TransferDto {
  /** Выходной, который становится рабочим днём. */
  @IsISO8601({ strict: true })
    from!: string;

  /** Рабочий день, который становится выходным. */
  @IsISO8601({ strict: true })
    to!: string;
}

export class CalendarDto {
  @IsArray() @ArrayMaxSize(60) @IsISO8601({ strict: true }, { each: true })
    holidays!: string[];

  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => TransferDto)
    transfers!: TransferDto[];
}

function checkYear(year: number): void {
  if (year < 2024 || year > 2100) throw new ProblemException('validation/invalid-field', 'Год: 2024–2100');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Даты календаря принадлежат году, без повторов; перенос — из выходного в рабочий день и обратно. */
export function normalizeCalendar(year: number, dto: CalendarDto): { holidays: string[]; transfers: Array<{ from: string; to: string }> } {
  const inYear = (d: string) => DATE.test(d) && d.startsWith(`${year}-`) && !Number.isNaN(Date.parse(d));
  const bad = dto.holidays.find((d) => !inYear(d));
  if (bad) throw new ProblemException('validation/invalid-field', `Праздник ${bad} не относится к ${year} году`);
  const holidays = [...new Set(dto.holidays)].sort();
  const transfers = dto.transfers.map((t) => ({ from: t.from, to: t.to }));
  for (const t of transfers) {
    if (!DATE.test(t.from) || !DATE.test(t.to) || (!t.from.startsWith(`${year}-`) && !t.to.startsWith(`${year}-`))) {
      throw new ProblemException('validation/invalid-field', `Перенос ${t.from} → ${t.to} не относится к ${year} году`);
    }
    if (t.from === t.to) throw new ProblemException('validation/invalid-field', 'Перенос на тот же день');
  }
  transfers.sort((a, b) => a.to.localeCompare(b.to));
  return { holidays, transfers };
}

@ApiTags('calendar')
@Controller('api/v1/calendar')
export class CalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('holidays/:year')
  @ApiOperation({ operationId: 'getHolidays', summary: 'Праздники и переносы производственного календаря' })
  async holidays(@Param('year', ParseIntPipe) year: number) {
    checkYear(year);
    const cal = await this.prisma.productionCalendar.findUnique({ where: { year } });
    if (!cal) throw new ProblemException('calendar-missing', `Для ${year} года календарь не загружен`);
    return { year: cal.year, holidays: cal.holidays, transfers: cal.transfers };
  }

  @Put('holidays/:year')
  @ApiOperation({ operationId: 'setHolidays', summary: 'Загрузить или изменить календарь года (кадровая служба, администратор)' })
  async setHolidays(
    @CurrentUser() user: AccessClaims,
      @Param('year', ParseIntPipe) year: number,
      @Body() dto: CalendarDto,
  ) {
    checkYear(year);
    const actor = await assertStaff(this.prisma, user, 'hr');
    const data = normalizeCalendar(year, dto);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.productionCalendar.findUnique({ where: { year } });
      await tx.productionCalendar.upsert({ where: { year }, update: data, create: { year, ...data } });
      await this.audit.record(tx, {
        actorId: actor.id, action: before ? 'calendar.updated' : 'calendar.created', entity: 'calendar', entityId: year,
        before: before ? { holidays: before.holidays, transfers: before.transfers } : null, after: data,
      });
    });
    return { year, ...data };
  }
}
