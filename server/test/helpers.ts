// Тестовая обвязка e2e: приложение на in-memory HTTP + чистая тестовая БД.
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma.service';
import { hashPassword } from '../src/auth/passwords';
import { MAIL_TRANSPORT, type MailTransport } from '../src/mail/mail.service';

export const NEXT_YEAR = new Date().getFullYear() + 1;

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  http: () => request.SuperTest<request.Test>;
  // Пользователи фикстуры
  admin: { id: number; login: string; password: string };
  manager: { id: number; login: string; password: string };
  employee: { id: number; login: string; password: string };
  /** Кадровая служба — в отдельном отделе, чтобы не менять состав «Тестового отдела». */
  hr: { id: number; login: string; password: string };
}

/** mail — подмена SMTP-транспорта: письма складываются в массив теста. */
export async function createTestApp(opts: { mail?: MailTransport } = {}): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (opts.mail) builder = builder.overrideProvider(MAIL_TRANSPORT).useValue(opts.mail);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  await resetDb(prisma);

  const admin = { id: 0, login: 'admin.test', password: 'admin-pass-123' };
  const manager = { id: 0, login: 'manager.test', password: 'manager-pass-123' };
  const employee = { id: 0, login: 'employee.test', password: 'employee-pass-123' };

  const dept = await prisma.department.create({ data: { name: 'Тестовый отдел' } });
  const adminRow = await prisma.employee.create({
    data: { login: admin.login, passwordHash: await hashPassword(admin.password), name: 'Админов Тест', isAdmin: true, deptId: dept.id },
  });
  const managerRow = await prisma.employee.create({
    data: {
      login: manager.login, passwordHash: await hashPassword(manager.password), name: 'Руководителев Тест',
      role: 'manager', deptId: dept.id,
    },
  });
  const employeeRow = await prisma.employee.create({
    data: {
      login: employee.login, passwordHash: await hashPassword(employee.password), name: 'Сотрудников Тест',
      deptId: dept.id, managerId: managerRow.id, plannedDays: 56, carryOver: 0,
    },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: managerRow.id } });
  const hrDept = await prisma.department.create({ data: { name: 'Кадровая служба' } });
  const hr = { id: 0, login: 'hr.test', password: 'hr-pass-12345' };
  const hrRow = await prisma.employee.create({
    data: { login: hr.login, passwordHash: await hashPassword(hr.password), name: 'Кадровикова Тест', isHr: true, deptId: hrDept.id },
  });
  hr.id = hrRow.id;
  await prisma.orgSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  admin.id = adminRow.id;
  manager.id = managerRow.id;
  employee.id = employeeRow.id;

  return {
    app,
    prisma,
    http: () => request(app.getHttpServer()),
    admin,
    manager,
    employee,
    hr,
  };
}

async function resetDb(prisma: PrismaService): Promise<void> {
  // Порядок важен из-за внешних ключей
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.emailOutbox.deleteMany(),
    prisma.loginAttempt.deleteMany(),
    prisma.loginEvent.deleteMany(),
    prisma.loginState.deleteMany(),
    prisma.jobRun.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.requestEvent.deleteMany(),
    prisma.vacationRequest.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.workOverride.deleteMany(),
    prisma.workPattern.deleteMany(),
    prisma.groupMember.deleteMany(),
    prisma.group.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.department.deleteMany(),
    prisma.project.deleteMany(),
    prisma.orgSettings.deleteMany(),
    prisma.productionCalendar.deleteMany(),
  ]);
}

/** Второй экземпляр сервера на той же БД — без сброса данных (проверка общего состояния экземпляров). */
export async function createExtraApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

export async function destroyTestApp(t: TestApp): Promise<void> {
  await t.app.close();
}

/** Логин + access-токен. */
export async function login(t: TestApp, who: { login: string; password: string }): Promise<string> {
  const res = await t.http().post('/api/v1/auth/login').send({ login: who.login, password: who.password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}
