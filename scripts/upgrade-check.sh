#!/usr/bin/env bash
# Проверка обновления на данных: схема предыдущего выпуска (миграции из main) → данные → миграции ветки.
# Миграция, исправная на пустой БД, может упасть на заполненной: в v0.6.0 UPDATE таблицы с отложенным
# триггером перед CREATE INDEX на ней же давал «pending trigger events» — тесты на пустой БД этого не видят.
#
#   UPGRADE_DATABASE_URL=postgresql://…/vacation_test?schema=upgrade_check scripts/upgrade-check.sh
#
# Схема из параметра schema создаётся заново; другие схемы БД не затрагиваются.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${UPGRADE_DATABASE_URL:?нужен UPGRADE_DATABASE_URL с параметром schema=…}"
SCHEMA=$(sed -n 's/.*[?&]schema=\([A-Za-z0-9_]*\).*/\1/p' <<<"$UPGRADE_DATABASE_URL")
[ -n "$SCHEMA" ] || { echo "В UPGRADE_DATABASE_URL нужен параметр schema=…"; exit 2; }
BASE=${UPGRADE_BASE:-origin/main}
git rev-parse --verify -q "$BASE" >/dev/null || git fetch -q --depth=1 origin "${BASE#origin/}:refs/remotes/$BASE"

OLD=$(git ls-tree -d --name-only "$BASE" server/prisma/migrations/ | xargs -n1 basename)
NEW=()
for d in server/prisma/migrations/*/; do
  n=$(basename "$d")
  grep -qx "$n" <<<"$OLD" || NEW+=("$n")
done
if [ ${#NEW[@]} -eq 0 ]; then echo "Новых миграций относительно $BASE нет — проверять нечего"; exit 0; fi
echo "Миграции $BASE: $(wc -l <<<"$OLD"); новые: ${NEW[*]}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -r server/prisma "$TMP/prisma"
for n in "${NEW[@]}"; do rm -rf "$TMP/prisma/migrations/$n"; done

cd server
run() { DATABASE_URL="$UPGRADE_DATABASE_URL" "$@"; }
printf 'DROP SCHEMA IF EXISTS "%s" CASCADE;\n' "$SCHEMA" | run npx prisma db execute --stdin --url "$UPGRADE_DATABASE_URL"
run npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma"
{ printf 'SET search_path TO "%s";\n' "$SCHEMA"; cat ../scripts/upgrade-fixture.sql; } | run npx prisma db execute --stdin --url "$UPGRADE_DATABASE_URL"
run npx prisma migrate deploy
DIFF=$(run npx prisma migrate diff --from-url "$UPGRADE_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script)
if ! grep -q 'This is an empty migration' <<<"$DIFF"; then
  echo "$DIFF"
  echo "Схема после обновления расходится с schema.prisma"
  exit 1
fi
printf 'DROP SCHEMA IF EXISTS "%s" CASCADE;\n' "$SCHEMA" | run npx prisma db execute --stdin --url "$UPGRADE_DATABASE_URL"
echo "Обновление на данных прошло: ${#NEW[@]} новых миграций"
