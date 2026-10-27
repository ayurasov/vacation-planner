// Начальное наполнение БД из демонстрационного snapshot (docs/specs/04-data-model.md, раздел 6).
// Пароли демо-данных хешируются scrypt; исходные пароли из snapshot не сохраняются.
import { PrismaClient, RequestStatus, RequestType, WorkMode } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64');
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64');
  return `scrypt$16384$${salt}$${hash}`;
}

interface LegacyRequest {
  start: string; end: string; status?: string; type?: string;
  pendingDeletion?: boolean; changeRequest?: { prevStart: string; prevEnd: string };
  comment?: string; rejectionComment?: string;
}
interface LegacyEmployee {
  id: number; name: string; position?: string; dept?: string; role?: string;
  isAdmin?: boolean; empType?: string; manager?: number | null; projectId?: number | null;
  planned_days?: number; carry_over?: number; vacationRequests?: LegacyRequest[];
  workPattern?: Record<string, string>;
}

async function main() {
  const snapshot = JSON.parse(readFileSync(join(here, 'seed-data', 'seed.json'), 'utf-8'));

  // org_settings
  await prisma.orgSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, conflictThreshold: snapshot.conflictThreshold ?? 50 },
  });

  // Производственный календарь: 2026 — из легаси-набора, 2027 — предварительный
  await prisma.productionCalendar.upsert({
    where: { year: 2026 },
    update: {},
    create: {
      year: 2026,
      holidays: [
        '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05',
        '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
        '2026-02-21', '2026-02-23', '2026-03-07', '2026-03-08', '2026-03-09',
        '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-09', '2026-05-10', '2026-05-11',
        '2026-06-12', '2026-06-13', '2026-06-14', '2026-11-04', '2026-12-31',
      ],
      transfers: [],
    },
  });
  await prisma.productionCalendar.upsert({
    where: { year: 2027 },
    update: {},
    create: {
      year: 2027,
      holidays: [
        '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05',
        '2027-01-06', '2027-01-07', '2027-01-08',
        '2027-02-22', '2027-02-23', '2027-03-08', '2027-05-01', '2027-05-03',
        '2027-05-09', '2027-05-10', '2027-06-12', '2027-06-14', '2027-11-04',
      ],
      transfers: [],
    },
  });

  // Отделы и руководители
  const deptNames: string[] = snapshot.departments ?? [];
  const deptIds = new Map<string, number>();
  for (const name of deptNames) {
    const d = await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
    deptIds.set(name, d.id);
  }

  // Проекты (легаси-идентификаторы сохраняются)
  const legacyProjects: Array<{ id: number; name: string; managerId?: number | null }> = snapshot.projects ?? [];
  for (const p of legacyProjects) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: { name: p.name },
      create: { id: p.id, name: p.name },
    });
  }

  // Сотрудники (идентификаторы сохраняются; пароли — scrypt-хеши)
  const employees: LegacyEmployee[] = snapshot.employees ?? [];
  const legacyToNew = new Map<number, number>();
  for (const e of employees) {
    const login = snapshot.logins?.[String(e.id)] ?? `emp${e.id}`;
    const password = snapshot.passwords?.[String(e.id)] ?? `changeme-${e.id}`;
    const created = await prisma.employee.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id,
        login,
        passwordHash: hashPassword(password),
        name: e.name,
        position: e.position ?? null,
        deptId: e.dept ? deptIds.get(e.dept) ?? null : null,
        role: e.role === 'manager' ? 'manager' : 'employee',
        isAdmin: !!e.isAdmin,
        empType: e.empType === 'ipsz' ? 'ipsz' : 'staff',
        managerId: null, // связи проставим вторым проходом (легаси-id могут идти вперёд)
        projectId: null,
        plannedDays: e.planned_days ?? 28,
        carryOver: e.carry_over ?? 0,
      },
    });
    legacyToNew.set(e.id, created.id);
  }
  for (const e of employees) {
    const mgr = e.manager ? legacyToNew.get(e.manager) ?? null : null;
    const prj = e.projectId ? legacyToNew.get(e.projectId) ?? null : null;
    if (mgr || prj) {
      await prisma.employee.update({
        where: { id: legacyToNew.get(e.id)! },
        data: { managerId: mgr, projectId: prj },
      });
    }
    // недельный шаблон режимов
    const pattern = e.workPattern ?? {};
    for (const [wd, mode] of Object.entries(pattern)) {
      if (mode === 'office' || mode === 'remote' || mode === 'off') {
        await prisma.workPattern.upsert({
          where: { employeeId_weekday: { employeeId: legacyToNew.get(e.id)!, weekday: Number(wd) } },
          update: { mode: mode as WorkMode },
          create: { employeeId: legacyToNew.get(e.id)!, weekday: Number(wd), mode: mode as WorkMode },
        });
      }
    }
  }

  // Руководители отделов из легаси-справочника
  const deptManagers: Record<string, number> = snapshot.deptManagers ?? {};
  for (const [deptName, legacyManagerId] of Object.entries(deptManagers)) {
    const deptId = deptIds.get(deptName);
    const managerId = legacyToNew.get(legacyManagerId);
    if (deptId && managerId) {
      await prisma.department.update({ where: { id: deptId }, data: { managerId } });
    }
  }

  // Заявки на отпуск (легаси-статусы переносятся как есть)
  for (const e of employees) {
    const employeeId = legacyToNew.get(e.id)!;
    const requests = e.vacationRequests ?? [];
    for (const r of requests) {
      const status = (['pending', 'approved', 'rejected', 'cancelled'] as const)
        .includes(r.status as never) ? r.status as RequestStatus : 'approved';
      const type = r.type === 'maternity' ? RequestType.maternity : RequestType.vacation;
      await prisma.vacationRequest.create({
        data: {
          employeeId,
          startDate: new Date(r.start),
          endDate: new Date(r.end),
          type,
          status,
          pendingDeletion: !!r.pendingDeletion,
          changeFromStart: r.changeRequest ? new Date(r.changeRequest.prevStart) : null,
          changeFromEnd: r.changeRequest ? new Date(r.changeRequest.prevEnd) : null,
          comment: r.comment || null,
          rejectionComment: r.rejectionComment || null,
          createdBy: employeeId,
          events: {
            create: { actorId: employeeId, action: 'created', comment: 'Перенесено из данных прототипа' },
          },
        },
      });
    }
  }

  const stats = await prisma.$transaction([
    prisma.employee.count(),
    prisma.department.count(),
    prisma.vacationRequest.count(),
  ]);
  console.log(`Seed завершён: сотрудников ${stats[0]}, отделов ${stats[1]}, заявок ${stats[2]}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
