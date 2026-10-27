// Производственный календарь (ADR-008).
import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infra/prisma.service';
import { ProblemException } from '../infra/problems';
import { Public } from '../auth/guards';

@ApiTags('calendar')
@Controller('api/v1/calendar')
@Public()
export class CalendarController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('holidays/:year')
  @ApiOperation({ operationId: 'getHolidays', summary: 'Праздники и переносы производственного календаря' })
  async holidays(@Param('year', ParseIntPipe) year: number) {
    if (year < 2024 || year > 2100) throw new ProblemException('validation/invalid-field', 'Год: 2024–2100');
    const cal = await this.prisma.productionCalendar.findUnique({ where: { year } });
    if (!cal) throw new ProblemException('calendar-missing', `Для ${year} года календарь не загружен`);
    return { year: cal.year, holidays: cal.holidays, transfers: cal.transfers };
  }
}
