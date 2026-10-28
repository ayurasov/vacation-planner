import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { DataVersionService } from '../infra/data-version';

@Module({
  controllers: [ScheduleController],
  providers: [ScheduleService, DataVersionService],
  exports: [DataVersionService],
})
export class ScheduleModule {}
