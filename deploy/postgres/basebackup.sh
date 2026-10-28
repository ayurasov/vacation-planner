#!/bin/sh
# Физические копии для восстановления на момент времени (E40-03): pg_basebackup раз в
# BASEBACKUP_INTERVAL секунд, хранится BASEBACKUP_KEEP последних; WAL старше самой старой
# хранимой копии удаляется из архива. Восстановление — руководство по развёртыванию.
set -u
: "${BASEBACKUP_INTERVAL:=86400}" "${BASEBACKUP_KEEP:=7}"
: "${ARCHIVE:=/wal-archive}"
mkdir -p "$ARCHIVE/base"

while true; do
  stamp=$(date +%Y%m%d-%H%M%S)
  # Метка до начала копии: WAL, заархивированные раньше неё, этой копии не нужны
  touch "$ARCHIVE/base/$stamp.started"
  # -X none: нужные копии WAL берутся из архива (archive_mode=on на основном сервере)
  if pg_basebackup -D "$ARCHIVE/base/$stamp.tmp" -Ft -z -X none -c fast; then
    mv "$ARCHIVE/base/$stamp.tmp" "$ARCHIVE/base/$stamp"
    echo "basebackup: $stamp"
  else
    rm -rf "$ARCHIVE/base/$stamp.tmp" "$ARCHIVE/base/$stamp.started"
    echo "basebackup: ОШИБКА"
  fi
  # Хранение: последние BASEBACKUP_KEEP копий, затем WAL до старта самой старой из них
  ls -1 "$ARCHIVE/base" | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r | awk -v keep="$BASEBACKUP_KEEP" 'NR > keep' |
    while read -r old; do rm -rf "${ARCHIVE:?}/base/$old" "$ARCHIVE/base/$old.started"; done
  oldest=$(ls -1 "$ARCHIVE/base" | grep -E '^[0-9]{8}-[0-9]{6}$' | sort | head -1)
  if [ -n "$oldest" ] && [ -f "$ARCHIVE/base/$oldest.started" ]; then
    # *.history — файлы линий времени после переключения: нужны восстановлению всегда
    find "$ARCHIVE" -maxdepth 1 -type f ! -name '*.history' ! -newer "$ARCHIVE/base/$oldest.started" -delete
  fi
  sleep "$BASEBACKUP_INTERVAL"
done
