-- Самые затратные запросы по pg_stat_statements (v1.0.0, E51-05; регламент docs/runbooks/diagnostics.md).
--   docker compose exec -T postgres psql -U vacation -d vacation -f - < deploy/postgres/top-queries.sql
-- Сбросить статистику перед замером: SELECT pg_stat_statements_reset();
-- Библиотека загружается при старте (shared_preload_libraries в docker-compose.yml); расширение
-- создаётся здесь, а не миграцией: у пользователя БД организации может не быть прав суперпользователя.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

\echo 'Топ-15 по суммарному времени'
SELECT round(total_exec_time::numeric, 0)             AS total_ms,
       calls,
       round(mean_exec_time::numeric, 2)              AS mean_ms,
       round((100 * total_exec_time / nullif(sum(total_exec_time) OVER (), 0))::numeric, 1) AS pct,
       rows,
       shared_blks_read                               AS disk_blocks,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY total_exec_time DESC
 LIMIT 15;

\echo 'Топ-10 по среднему времени (не меньше 20 вызовов)'
SELECT round(mean_exec_time::numeric, 2) AS mean_ms, round(max_exec_time::numeric, 1) AS max_ms, calls,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND calls >= 20
 ORDER BY mean_exec_time DESC
 LIMIT 10;

\echo 'Таблицы с последовательным чтением больших объёмов'
SELECT relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
  FROM pg_stat_user_tables
 WHERE seq_tup_read > 100000
 ORDER BY seq_tup_read DESC
 LIMIT 10;
