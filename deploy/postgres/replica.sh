#!/bin/sh
# Потоковая реплика PostgreSQL (E40-03). При первом запуске (пустой том) — роль и слот репликации
# на основном сервере, копия данных pg_basebackup и режим горячего резерва; затем обычный запуск.
# Переменные: PRIMARY_HOST, POSTGRES_USER/POSTGRES_PASSWORD (суперпользователь основного сервера),
# REPLICATION_PASSWORD, SLOT (имя слота и реплики). Аргументы скрипта — параметры postgres.
set -eu
: "${PRIMARY_HOST:=postgres}" "${SLOT:=replica1}" "${PGDATA:=/var/lib/postgresql/data}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  until pg_isready -q -h "$PRIMARY_HOST" -U "$POSTGRES_USER"; do echo "replica: ждём основной сервер"; sleep 2; done
  # Роль и слот — идемпотентно: повторное создание реплики после потери тома не падает
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
    -v pw="$REPLICATION_PASSWORD" -v slot="$SLOT" <<'SQL'
SELECT 'CREATE ROLE replicator' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') \gexec
SELECT format('ALTER ROLE replicator WITH REPLICATION LOGIN PASSWORD %L', :'pw') \gexec
SELECT pg_create_physical_replication_slot(:'slot')
 WHERE NOT EXISTS (SELECT FROM pg_replication_slots WHERE slot_name = :'slot');
SQL
  echo "replica: копия данных с $PRIMARY_HOST"
  mkdir -p "$PGDATA"
  # -R: standby.signal и primary_conninfo — сервер стартует резервом и догоняет основной по слоту;
  # application_name из строки подключения попадает в primary_conninfo — имя реплики в
  # pg_stat_replication основного сервера (метрика vp_db_replica_lag_bytes) после любого перезапуска
  PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup -d "application_name=$SLOT" -h "$PRIMARY_HOST" -U replicator \
    -D "$PGDATA" -X stream -S "$SLOT" -R -c fast
  chown -R postgres:postgres "$PGDATA"
  chmod 0700 "$PGDATA"
fi

# Параметры сервера (архив WAL и др.) — из command в docker-compose.replica.yml
exec docker-entrypoint.sh postgres "$@"
