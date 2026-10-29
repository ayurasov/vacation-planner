import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsService } from './jobs.service';

@Global()
@Module({
  imports: [AuthModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
