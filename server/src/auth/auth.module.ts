import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './guards';
import { LoginRateLimitGuard } from './rate-limit';
import { PrismaModule } from '../infra/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtAuthGuard, LoginRateLimitGuard],
  exports: [AuthService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
