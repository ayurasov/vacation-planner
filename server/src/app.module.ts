import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infra/prisma.module';
import { ProblemFilter } from './infra/problems';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { EmployeesModule } from './employees/employees.module';
import { RequestsModule } from './requests/requests.module';
import { DirectoriesModule } from './directories/directories.module';
import { ScheduleModule } from './schedule/schedule.module';
import { CalendarModule } from './calendar/calendar.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditApiModule } from './audit/audit.api.module';
import { HealthModule } from './health/health.module';
import { ReportsModule } from './reports/reports.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ImportsModule } from './imports/imports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    EmployeesModule,
    RequestsModule,
    DirectoriesModule,
    ScheduleModule,
    CalendarModule,
    SettingsModule,
    NotificationsModule,
    AuditApiModule,
    HealthModule,
    ReportsModule,
    AnalyticsModule,
    ImportsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    // Аутентификация по умолчанию на всех эндпоинтах; публичные помечаются @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
