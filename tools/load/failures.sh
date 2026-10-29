#!/usr/bin/env bash
# Отказы под нагрузкой (E51-07, регламент docs/performance/runbook.md): на фоне профиля average —
# аварийное завершение одного процесса API, перезапуск API целиком, перезапуск PostgreSQL. Лента
# генератора по 10 секунд показывает окно ошибок и время восстановления; журнал API — что видел сервер.
#
#   tools/load/failures.sh <каталог> [численность]
#
# Ядра: API и PostgreSQL — STAND_CPUS (по умолчанию 0,1), генератор — GEN_CPUS (2,3); процессов API — 2,
# чтобы проверить перезапуск процесса внутри кластера. Переключение на реплику проверяет задание CI
# «Реплика PostgreSQL, архив WAL и переключение» (docker-compose.replica.yml).
# Нужны root (pg_ctlcluster, привязка процессов PostgreSQL) и собранный сервер.
set -euo pipefail
OUT=$1 POP=${2:-2000}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export DATABASE_URL=${DATABASE_URL:-postgresql://vacation:vacation@localhost:5432/vacation_load}
PORT=${PORT:-8097} STAND_CPUS=${STAND_CPUS:-0,1} GEN_CPUS=${GEN_CPUS:-2,3}
PG_CLUSTER=${PG_CLUSTER:-16 main}
[[ $DATABASE_URL == *load* ]] || { echo "Только база стенда нагрузки (с «load» в имени)" >&2; exit 1; }
mkdir -p "$OUT"
JWT=$(head -c 32 /dev/urandom | base64)
log() { echo "$(date -u +%T) $*" | tee -a "$OUT/events.log"; }
pin_pg() { local pm; pm=$(pgrep -o -u postgres -x postgres); for p in $pm $(pgrep -P "$pm"); do taskset -pc "$1" "$p" >/dev/null 2>&1 || true; done; }
start_api() {
  (cd "$ROOT/server" && taskset -c "$STAND_CPUS" env PORT="$PORT" WEB_CONCURRENCY=2 JWT_SECRET="$JWT" \
    LOG_FORMAT=json REQUEST_LOG=slow SLOW_REQUEST_MS=500 node dist/main.js >> "$OUT/api.log" 2>&1 &)
  for _ in $(seq 60); do curl -sf "http://127.0.0.1:$PORT/readyz" >/dev/null && return 0; sleep 1; done
  return 1
}
api_pid() { pgrep -f -o "node dist/main.js"; }
cleanup() { kill -TERM "$(api_pid)" 2>/dev/null || true; pin_pg "0-$(( $(nproc --all) - 1 ))"; }
trap cleanup EXIT

(cd "$ROOT/server" && npx tsx prisma/load-seed.ts --employees "$POP" --history 5) > "$OUT/seed.log" 2>&1
psql "$DATABASE_URL" -qc 'VACUUM ANALYZE'
pin_pg "$STAND_CPUS"
start_api && log "API запущен"

# Профиль average на 20 минут с лентой по 10 секунд
taskset -c "$GEN_CPUS" node "$ROOT/tools/load/run.mjs" --url "http://127.0.0.1:$PORT" --profile average \
  --population "$POP" --duration 1080 --tick 10 --out "$OUT/result.json" > "$OUT/result.md" 2>&1 &
GEN=$!

sleep 300
W=$(pgrep -P "$(api_pid)" | head -1)
log "1. аварийное завершение процесса API $W (kill -9): кластер перезапускает его"
kill -9 "$W"

sleep 240
log "2. перезапуск API целиком (SIGTERM, затем запуск)"
kill -TERM "$(api_pid)"
for _ in $(seq 30); do api_pid >/dev/null || break; sleep 1; done
start_api && log "   API снова отвечает"

sleep 240
log "3. перезапуск PostgreSQL"
pg_ctlcluster $PG_CLUSTER restart
pin_pg "$STAND_CPUS"
log "   PostgreSQL перезапущен"

wait "$GEN" || true
log "Нагрузка завершена"
