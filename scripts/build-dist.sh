#!/usr/bin/env bash
# Дистрибутив версии (E52-02): исходные тексты, образы контейнеров для установки без интернета,
# комплект установки, документация и контрольные суммы SHA-256.
#
#   scripts/build-dist.sh [каталог]          # по умолчанию dist/
#   scripts/build-dist.sh --no-images        # без сборки образов (нет Docker)
#
# Результат — <каталог>/vacation-planner-<версия>/:
#   vacation-planner-<версия>-src.tar.gz     исходные тексты коммита (git archive)
#   vacation-planner-<версия>-images.tar.gz  образы server, web и postgres:17-alpine (docker save)
#   install/                                 docker-compose*.yml, deploy/, .env.example с VP_VERSION
#   docs/                                    PDF документов (если собраны: python3 tools/docs/build_docs.py)
#   SHA256SUMS                               контрольные суммы всех файлов
#
# Установка из дистрибутива: docker load < …-images.tar.gz; в install/.env — JWT_SECRET и VP_VERSION;
# docker compose --profile full up -d — образы уже загружены, сборка не нужна.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGES=1
OUT_BASE=dist
for a in "$@"; do
  case "$a" in
    --no-images) IMAGES=0 ;;
    *) OUT_BASE=$a ;;
  esac
done

VERSION=$(node -p "require('./server/package.json').version")
NAME="vacation-planner-$VERSION"
OUT="$OUT_BASE/$NAME"
COMMIT=$(git rev-parse --short HEAD)
if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo "В рабочем каталоге есть незафиксированные изменения: дистрибутив собирается из коммита $COMMIT без них" >&2
fi
rm -rf "$OUT"
mkdir -p "$OUT/install" "$OUT/docs"

echo "Исходные тексты $COMMIT"
git archive --format=tar.gz --prefix="$NAME/" -o "$OUT/$NAME-src.tar.gz" HEAD

if [[ $IMAGES == 1 ]]; then
  echo "Образы $VERSION"
  # Секрет нужен compose для подстановки переменных; в образы он не попадает
  export VP_VERSION=$VERSION JWT_SECRET=dist-build-only-not-a-secret-000000000
  docker compose --profile full build
  docker pull -q postgres:17-alpine >/dev/null
  docker save "vacation-planner-server:$VERSION" "vacation-planner-web:$VERSION" postgres:17-alpine \
    | gzip -9 > "$OUT/$NAME-images.tar.gz"
fi

echo "Комплект установки"
cp docker-compose.yml docker-compose.replica.yml "$OUT/install/"
cp -r deploy "$OUT/install/deploy"
# Шаблон .env стенда — как в «Руководстве по развёртыванию», раздел «Установка», и версия образов
cat > "$OUT/install/.env.example" <<EOF
# Секрет подписи токенов: случайная строка не короче 32 символов (openssl rand -base64 48)
JWT_SECRET=
# Версия загруженных образов дистрибутива
VP_VERSION=$VERSION
# Резервные копии: интервал в секундах и срок хранения в днях
BACKUP_INTERVAL=86400
BACKUP_KEEP_DAYS=14
# Адрес планировщика для ссылок в письмах и единого входа
APP_URL=https://otpusk.company.ru
# Процессы API: auto — по числу ядер (по умолчанию)
WEB_CONCURRENCY=auto
EOF

if compgen -G "docs/pdf/*.pdf" >/dev/null; then
  cp docs/pdf/*.pdf "$OUT/docs/"
  [[ -d docs/pdf/registry ]] && cp -r docs/pdf/registry "$OUT/docs/registry"
else
  echo "PDF документов не собраны (python3 tools/docs/build_docs.py) — каталог docs пуст" >&2
fi
cp CHANGELOG.md "$OUT/"

(cd "$OUT" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "Готово: $OUT ($(du -sh "$OUT" | cut -f1)); проверка — (cd $OUT && sha256sum -c SHA256SUMS)"
