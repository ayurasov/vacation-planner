#!/usr/bin/env bash
# Один прогон сайзинга (E51-02, регламент docs/performance/runbook.md): API и PostgreSQL — на заданных
# ядрах, генератор и сборщик ресурсов — на остальных. Свежие данные, обнулённая статистика БД; в каталог
# результатов — конфигурация, итог генератора, ресурсы, топ запросов БД, медленные маршруты, журнал API.
#
#   tools/load/pinned.sh <каталог> <численность> <ядра стенда> <профиль> [параметры run.mjs]
#   GEN_CPUS=2,3 tools/load/pinned.sh /tmp/sizing/2000-1cpu-average 2000 0 average
#
# DATABASE_URL — база с «load» в имени (по умолчанию vacation_load); PORT — порт API (8097);
# WEB_CONCURRENCY — процессов API (auto — по ядрам стенда); GEN_CPUS — ядра генератора (2,3);
# SEED=0 — не наполнять заново. Нужны root (привязка процессов PostgreSQL) и собранный сервер.
set -euo pipefail
OUT=$1 POP=$2 CPUS=$3 PROFILE=$4
shift 4
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export DATABASE_URL=${DATABASE_URL:-postgresql://vacation:vacation@localhost:5432/vacation_load}
PORT=${PORT:-8097}
GEN_CPUS=${GEN_CPUS:-2,3}
ALL_CPUS=0-$(( $(nproc --all) - 1 ))
[[ $DATABASE_URL == *load* ]] || { echo "DATABASE_URL должна указывать на базу стенда нагрузки (с «load» в имени)" >&2; exit 1; }
! curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null || { echo "Порт $PORT занят другим API" >&2; exit 1; }
mkdir -p "$OUT"

pin_pg() {
  local pm
  pm=$(pgrep -o -u postgres -x postgres)
  for p in $pm $(pgrep -P "$pm"); do taskset -pc "$1" "$p" >/dev/null 2>&1 || true; done
}
API='' SAMPLER=''
cleanup() {
  [[ -n $SAMPLER ]] && kill "$SAMPLER" 2>/dev/null || true
  if [[ -n $API ]] && kill -0 "$API" 2>/dev/null; then
    kill -TERM "$API"
    for _ in $(seq 30); do kill -0 "$API" 2>/dev/null || break; sleep 1; done
  fi
  pin_pg "$ALL_CPUS"
}
trap cleanup EXIT

if [[ ${SEED:-1} != 0 ]]; then
  (cd "$ROOT/server" && npx tsx prisma/load-seed.ts --employees "$POP" --history 5) > "$OUT/seed.log" 2>&1
  psql "$DATABASE_URL" -qc 'VACUUM ANALYZE'
fi

pin_pg "$CPUS"
cd "$ROOT/server"
taskset -c "$CPUS" env PORT="$PORT" WEB_CONCURRENCY="${WEB_CONCURRENCY:-auto}" \
  JWT_SECRET="${JWT_SECRET:-$(head -c 32 /dev/urandom | base64)}" \
  LOG_FORMAT=json REQUEST_LOG=slow SLOW_REQUEST_MS=500 SLOW_QUERY_MS=0 \
  node dist/main.js > "$OUT/api.log" 2>&1 &
API=$!
for _ in $(seq 60); do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 1; done
sleep 3 # все процессы кластера слушают порт

psql "$DATABASE_URL" -qAt -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements' \
  -c 'SELECT pg_stat_statements_reset()' -c 'SELECT pg_stat_reset()' >/dev/null
{
  echo "Дата: $(date -u +%FT%TZ)"
  echo "Коммит: $(git -C "$ROOT" rev-parse --short HEAD), версия $(node -p "require('./package.json').version")"
  echo "Узел: $(nproc --all) ядер, $(free -g | awk '/Mem:/ {print $2}') ГБ; $(lscpu | sed -n 's/^Model name: *//p')"
  echo "Ядра стенда (API и PostgreSQL): $CPUS; ядра генератора: $GEN_CPUS"
  echo "Процессов API: $(( $(pgrep -f -c 'node dist/main.js') > 1 ? $(pgrep -f -c 'node dist/main.js') - 1 : 1 ))"
  echo "PostgreSQL: $(psql "$DATABASE_URL" -Atc "SELECT current_setting('server_version') || ', shared_buffers ' || current_setting('shared_buffers') || ', max_connections ' || current_setting('max_connections')")"
  echo "Численность: $POP; размер базы: $(psql "$DATABASE_URL" -Atc 'SELECT pg_size_pretty(pg_database_size(current_database()))')"
  echo "Профиль: $PROFILE $*"
} > "$OUT/config.txt"

taskset -c "$GEN_CPUS" node "$ROOT/tools/load/sample.mjs" --db "$DATABASE_URL" --metrics "http://127.0.0.1:$PORT/metrics" \
  --interval 5 --out "$OUT/resources.csv" &
SAMPLER=$!
taskset -c "$GEN_CPUS" node "$ROOT/tools/load/run.mjs" --url "http://127.0.0.1:$PORT" --profile "$PROFILE" \
  --population "$POP" --out "$OUT/result.json" "$@" | tee "$OUT/result.md"

kill "$SAMPLER" 2>/dev/null || true
SAMPLER=''
curl -s "http://127.0.0.1:$PORT/metrics" > "$OUT/metrics.txt" || true
psql "$DATABASE_URL" -f "$ROOT/deploy/postgres/top-queries.sql" > "$OUT/top-queries.txt" 2>&1 || true
jq -rR 'fromjson? | select(.msg=="slow request") | .route' "$OUT/api.log" | sort | uniq -c | sort -rn > "$OUT/slow-routes.txt" || true
echo "Готово: $OUT"
