import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { EscalationService } from './escalation.service';

@Module({
  controllers: [RequestsController],
  providers: [RequestsService, EscalationService],
  exports: [RequestsService],
})
export class RequestsModule {}
