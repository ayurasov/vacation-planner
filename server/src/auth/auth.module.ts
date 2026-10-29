import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OidcController } from './oidc.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './guards';
import { LoginRateLimitGuard } from './rate-limit';
import { LoginJournal } from './login-journal.service';
import { LoginEventsController } from './login-events.controller';
import { PrismaModule } from '../infra/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, OidcController, LoginEventsController],
  providers: [AuthService, TokenService, JwtAuthGuard, LoginRateLimitGuard, LoginJournal],
  exports: [AuthService, TokenService, JwtAuthGuard, LoginJournal],
})
export class AuthModule {}
