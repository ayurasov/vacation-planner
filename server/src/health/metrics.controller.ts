import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/guards';
import { PrismaService } from '../infra/prisma.service';
import { collectAll, type Family, render } from '../infra/metrics';

interface DbRow {
  connections: Record<string, number> | null;
  max_connections: number;
  outbox: Record<string, number> | null;
  outbox_oldest: number | null;
  jobs: Record<string, number> | null;
  pending_requests: number;
  active_employees: number;
  data_version: number | null;
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * Метрики для Prometheus (E40-01). Порт API не публикуется наружу: nginx проксирует только /api/,
 * поэтому /metrics доступен из внутренней сети стенда. METRICS_TOKEN — дополнительно требовать
 * `Authorization: Bearer <токен>` (если Prometheus ходит через общую сеть организации).
 */
@ApiExcludeController()
@Controller()
@Public()
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async metrics(@Headers('authorization') auth?: string): Promise<string> {
    const token = process.env.METRICS_TOKEN;
    if (token) {
      const given = /^Bearer (.+)$/.exec(auth ?? '')?.[1];
      if (!given || !timingSafeEqual(digest(given), digest(token))) throw new UnauthorizedException();
    }
    const [procs, db] = await Promise.all([collectAll(), this.database()]);
    return render([...procs, ...db]);
  }

  /** Показатели из БД: общие для всех процессов и экземпляров, поэтому снимаются одним запросом. */
  private async database(): Promise<Family[]> {
    const started = process.hrtime.bigint();
    let row: DbRow | undefined;
    try {
      [row] = await this.prisma.$queryRaw<DbRow[]>`
        SELECT
          (SELECT json_object_agg(s, n) FROM (
             SELECT coalesce(state, 'other') AS s, count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND backend_type = 'client backend' GROUP BY 1) a) AS connections,
          current_setting('max_connections')::int AS max_connections,
          (SELECT json_object_agg(status, n) FROM (
             SELECT status, count(*)::int AS n FROM email_outbox WHERE status IN ('pending', 'failed') GROUP BY 1) o) AS outbox,
          (SELECT extract(epoch FROM now() - min(created_at))::float8 FROM email_outbox WHERE status = 'pending') AS outbox_oldest,
          (SELECT json_object_agg(name, t) FROM (
             SELECT name, extract(epoch FROM max(ran_at))::float8 AS t FROM job_runs GROUP BY 1) j) AS jobs,
          (SELECT count(*)::int FROM vacation_requests WHERE status = 'pending') AS pending_requests,
          (SELECT count(*)::int FROM employees WHERE is_active) AS active_employees,
          (SELECT sum(version)::float8 FROM data_version) AS data_version`;
    } catch {
      row = undefined; // БД недоступна: метрики процессов всё равно отдаются, vp_db_up = 0
    }
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const gauge = (name: string, help: string, samples: Array<[Record<string, string>, number]>): Family =>
      ({ name, help, type: 'gauge', agg: 'sum', samples: samples.map(([labels, value]) => ({ labels, value })) });
    const out: Family[] = [
      gauge('vp_db_up', 'БД отвечает на запрос сбора метрик (1 — да)', [[{}, row ? 1 : 0]]),
      gauge('vp_db_scrape_seconds', 'Время запроса показателей БД, секунд', [[{}, seconds]]),
    ];
    if (!row) return out;
    // Состояния соединений: active — выполняет запрос, idle — свободно в пуле,
    // idle in transaction — держит транзакцию (долго — признак зависшего запроса)
    const conn = { active: 0, idle: 0, 'idle in transaction': 0, ...(row.connections ?? {}) };
    const outbox = { pending: 0, failed: 0, ...(row.outbox ?? {}) };
    out.push(
      gauge('vp_db_connections', 'Соединения с БД планировщика по состоянию (все процессы и экземпляры)',
        Object.entries(conn).map(([state, n]) => [{ state }, n])),
      gauge('vp_db_max_connections', 'Предел соединений PostgreSQL (max_connections)', [[{}, row.max_connections]]),
      gauge('vp_mail_outbox', 'Письма в очереди по состоянию: pending — ждут отправки, failed — исчерпаны попытки',
        Object.entries(outbox).map(([status, n]) => [{ status }, n])),
      gauge('vp_mail_outbox_oldest_seconds', 'Возраст самого старого неотправленного письма, секунд', [[{}, row.outbox_oldest ?? 0]]),
      gauge('vp_job_last_run_timestamp_seconds', 'Время последнего запуска фоновой задачи (Unix, секунд)',
        Object.entries(row.jobs ?? {}).map(([job, t]) => [{ job }, t])),
      gauge('vp_vacation_requests_pending', 'Заявки, ожидающие согласования', [[{}, row.pending_requests]]),
      gauge('vp_employees_active', 'Активные сотрудники', [[{}, row.active_employees]]),
      gauge('vp_data_version', 'Версия данных графика (растёт при каждом изменении)', [[{}, row.data_version ?? 0]]),
    );
    return out;
  }
}
