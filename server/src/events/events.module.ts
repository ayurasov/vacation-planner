import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataVersionService } from '../infra/data-version';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [EventsService, DataVersionService],
  exports: [EventsService],
})
export class EventsModule {}
