import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, Public } from './guards';
import { LoginRateLimitGuard } from './rate-limit';
import { AuthService } from './auth.service';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
    login!: string;

  @IsString() @IsNotEmpty() @MaxLength(128)
    password!: string;
}

export class PreferencesDto {
  @IsBoolean()
    emailNotifications!: boolean;
}

export class ChangePasswordDto {
  @IsString()
    oldPassword!: string;

  @IsString() @MinLength(8) @MaxLength(128)
    newPassword!: string;
}

export const REFRESH_COOKIE = 'vp_refresh';

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/v1/auth',
    expires: expiresAt,
  });
}

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(LoginRateLimitGuard)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ operationId: 'login', summary: 'Вход по логину и паролю' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.login, dto.password);
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    return {
      accessToken: result.accessToken,
      expiresAt: result.expiresAt.toISOString(),
      user: this.toMe(result.user),
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ operationId: 'refresh', summary: 'Обновление пары токенов' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.[REFRESH_COOKIE] as string) ?? '';
    const result = await this.auth.refresh(token);
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    return { accessToken: result.accessToken, expiresAt: result.expiresAt.toISOString() };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ operationId: 'logout', summary: 'Завершить сессию' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Get('me')
  @ApiOperation({ operationId: 'getMe', summary: 'Текущий пользователь и его права' })
  async me(@CurrentUser() user: { sub: number }) {
    const me = await this.auth.me(user.sub);
    return this.toMe(me);
  }

  @Patch('me')
  @ApiOperation({ operationId: 'updateMyPreferences', summary: 'Личные настройки: письма о заявках' })
  async updateMe(@CurrentUser() user: { sub: number }, @Body() dto: PreferencesDto) {
    return this.toMe(await this.auth.setPreferences(user.sub, dto.emailNotifications));
  }

  @Post('password')
  @HttpCode(204)
  @ApiOperation({ operationId: 'changeOwnPassword', summary: 'Смена своего пароля' })
  async changePassword(
    @CurrentUser() user: { sub: number },
      @Body() dto: ChangePasswordDto,
      @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changeOwnPassword(user.sub, dto.oldPassword, dto.newPassword);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  private toMe(e: { id: number; name: string; login: string; position: string | null; email: string | null; emailNotifications: boolean; role: string; isAdmin: boolean; isHr: boolean; empType: string; deptId: number | null; projectId: number | null; managerId: number | null; plannedDays: number; carryOver: number; subordinates: number[] }) {
    return {
      employee: {
        id: e.id, name: e.name, login: e.login, email: e.email, emailNotifications: e.emailNotifications,
        position: e.position, deptId: e.deptId,
        projectId: e.projectId, managerId: e.managerId, role: e.role, isAdmin: e.isAdmin, isHr: e.isHr,
        empType: e.empType, plannedDays: e.plannedDays, carryOver: e.carryOver,
      },
      permissions: {
        approveSubordinates: e.subordinates,
        isAdmin: e.isAdmin,
        isHr: e.isHr,
        // кадровые операции: сотрудники, оргструктура, календарь, импорт, выгрузки, аудит
        manageStaff: e.isAdmin || e.isHr,
        manageDirectories: e.isAdmin || e.isHr,
        manageSettings: e.isAdmin,
      },
    };
  }
}
