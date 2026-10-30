#!/usr/bin/env bash
# Рост данных (E51-08): наполнение численности с историей, размеры таблиц до и после сроков хранения
# (ежедневная задача data-retention), время копирования pg_dump и восстановления pg_restore.
#
#   tools/load/growth.sh <каталог> [численность] [лет истории]
#
# Только база стенда нагрузки (с «load» в имени); восстановление проверяется в отдельную базу
# <база>_restore, которая удаляется после замера. Нужен собранный сервер.
set -euo pipefail
OUT=$1 POP=${2:-2000} YEARS=${3:-5}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export DATABASE_URL=${DATABASE_URL:-postgresql://vacation:vacation@localhost:5432/vacation_load}
PORT=${PORT:-8097}
[[ $DATABASE_URL == *load* ]] || { echo "Только база стенда нагрузки (с «load» в имени)" >&2; exit 1; }
DB=${DATABASE_URL##*/}
RESTORE_URL=${DATABASE_URL%/*}/${DB}_restore
mkdir -p "$OUT"

sizes() {
  psql "$DATABASE_URL" -c "SELECT relname AS таблица, n_live_tup AS строк,
           pg_size_pretty(pg_total_relation_size(relid)) AS размер, pg_total_relation_size(relid) AS байт
      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15" \
       -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS база"
}

(cd "$ROOT/server" && npx tsx prisma/load-seed.ts --employees "$POP" --history "$YEARS") > "$OUT/seed.log" 2>&1
psql "$DATABASE_URL" -qc 'VACUUM ANALYZE'
sizes > "$OUT/sizes-before.txt"

# Сроки хранения: задача выполняется на первом проходе плановых задач после старта
psql "$DATABASE_URL" -qc "DELETE FROM job_runs WHERE name = 'data-retention'"
(cd "$ROOT/server" && env PORT="$PORT" WEB_CONCURRENCY=1 JOBS_POLL_SECONDS=5 MAIL_POLL_SECONDS=0 \
  JWT_SECRET="$(head -c 32 /dev/urandom | base64)" LOG_FORMAT=json node dist/main.js > "$OUT/api.log" 2>&1 &)
for _ in $(seq 120); do
  [[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM job_runs WHERE name = 'data-retention'") == 1 ]] && break
  sleep 1
done
sleep 5
kill -TERM "$(pgrep -f -o 'node dist/main.js')"
grep -h 'Сроки хранения' "$OUT/api.log" > "$OUT/retention.txt" || echo 'нечего удалять' > "$OUT/retention.txt"
psql "$DATABASE_URL" -qc 'VACUUM FULL ANALYZE'
sizes > "$OUT/sizes-after.txt"

# Копирование и восстановление
T0=$(date +%s.%N)
pg_dump -Fc "$DATABASE_URL" -f "$OUT/backup.dump"
T1=$(date +%s.%N)
psql "${DATABASE_URL%/*}/postgres" -qc "DROP DATABASE IF EXISTS ${DB}_restore" -c "CREATE DATABASE ${DB}_restore"
pg_restore -j 2 -d "$RESTORE_URL" "$OUT/backup.dump"
T2=$(date +%s.%N)
psql "${DATABASE_URL%/*}/postgres" -qc "DROP DATABASE ${DB}_restore"
{
  echo "Копия pg_dump -Fc: $(du -h "$OUT/backup.dump" | cut -f1), $(echo "$T1 - $T0" | bc) с"
  echo "Восстановление pg_restore -j 2: $(echo "$T2 - $T1" | bc) с"
} | tee "$OUT/backup.txt"
rm -f "$OUT/backup.dump"
