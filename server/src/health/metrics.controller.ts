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
  replicas: Array<{ name: string; bytes: number | null; seconds: number | null }> | null;
  slots: Array<{ slot: string; active: boolean; retained: number | null }> | null;
  archive_enabled: boolean;
  archive_failing: boolean;
  archived_at: number | null;
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
          (SELECT sum(version)::float8 FROM data_version) AS data_version,
          -- Реплики и слоты (E40-03). Отставание в байтах видно суперпользователю или роли pg_monitor
          (SELECT json_agg(json_build_object('name', coalesce(nullif(application_name, ''), client_addr::text, 'replica'),
                  'bytes', pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::float8,
                  'seconds', coalesce(extract(epoch FROM replay_lag)::float8, 0)))
             FROM pg_stat_replication) AS replicas,
          (SELECT json_agg(json_build_object('slot', slot_name, 'active', active,
                  'retained', pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::float8))
             FROM pg_replication_slots WHERE slot_type = 'physical') AS slots,
          current_setting('archive_mode') <> 'off' AS archive_enabled,
          -- Архив «сломан», если последняя неудача позже последнего успеха; простой без записи — не сбой
          (SELECT coalesce(last_failed_time > coalesce(last_archived_time, 'epoch'), false) FROM pg_stat_archiver) AS archive_failing,
          (SELECT extract(epoch FROM last_archived_time)::float8 FROM pg_stat_archiver) AS archived_at`;
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
      // Ряды реплик и слотов есть, только когда они настроены (docker-compose.replica.yml)
      gauge('vp_db_replica_lag_bytes', 'Отставание реплики от основного сервера, байт WAL',
        (row.replicas ?? []).filter((r) => r.bytes !== null).map((r) => [{ replica: r.name }, r.bytes!])),
      gauge('vp_db_replica_lag_seconds', 'Отставание применения на реплике, секунд (0 — догнала)',
        (row.replicas ?? []).map((r) => [{ replica: r.name }, r.seconds ?? 0])),
      gauge('vp_db_replication_slot_active', 'Слот репликации используется репликой (0 — реплика отключена, WAL копится)',
        (row.slots ?? []).map((sl) => [{ slot: sl.slot }, sl.active ? 1 : 0])),
      gauge('vp_db_replication_slot_retained_bytes', 'WAL, удерживаемый слотом на основном сервере, байт',
        (row.slots ?? []).filter((sl) => sl.retained !== null).map((sl) => [{ slot: sl.slot }, sl.retained!])),
      gauge('vp_db_wal_archive_enabled', 'Архивирование WAL включено (archive_mode)', [[{}, row.archive_enabled ? 1 : 0]]),
      gauge('vp_db_wal_archive_failing', 'Архивирование WAL сейчас завершается ошибкой (1 — да)', [[{}, row.archive_failing ? 1 : 0]]),
      gauge('vp_db_wal_archive_last_success_timestamp_seconds', 'Время последнего успешно заархивированного сегмента WAL (Unix, секунд)',
        row.archived_at === null ? [] : [[{}, row.archived_at]]),
    );
    return out;
  }
}
