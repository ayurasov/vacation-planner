import { Module } from '@nestjs/common';
import { DelegationsController } from './delegations.controller';
import { DelegationsService } from './delegations.service';

@Module({
  controllers: [DelegationsController],
  providers: [DelegationsService],
})
export class DelegationsModule {}
