#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/opt/new-api/backups"
LOG_FILE="/var/log/lumos-new-api-restore-check.log"
ALERT_BIN="/usr/local/sbin/lumos-new-api-alert.sh"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >> "$LOG_FILE"
}

alert() {
  if [ -x "$ALERT_BIN" ]; then
    "$ALERT_BIN" "$1" "$2" >/dev/null 2>&1 || true
  fi
}

on_error() {
  local line="$1"
  log "restore check failed at line=$line"
  alert "Lumos new-api restore check failed" "Restore check failed at line $line on $(hostname). Check $LOG_FILE."
}

trap 'on_error "$LINENO"' ERR

latest="$(find "$BACKUP_DIR" -type f -name 'one-api.*.db.zst' -print | sort | tail -n 1)"
if [ -z "$latest" ]; then
  log "restore check failed: no backup archive found"
  alert "Lumos new-api restore check failed" "No backup archive found in $BACKUP_DIR on $(hostname)."
  exit 1
fi

tmp_db="$(mktemp /tmp/lumos-new-api-restore-check.XXXXXX.db)"
cleanup() {
  rm -f "$tmp_db"
}
trap cleanup EXIT

log "restore check started archive=$latest"
zstd -q -d -c "$latest" > "$tmp_db"

integrity="$(sqlite3 "$tmp_db" 'PRAGMA integrity_check;' 2>&1)"
if [ "$integrity" != "ok" ]; then
  log "restore check failed: integrity_check=$integrity"
  alert "Lumos new-api restore check failed" "SQLite integrity_check failed for $latest on $(hostname): $integrity"
  exit 1
fi

table_count="$(sqlite3 "$tmp_db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")"
if [ "${table_count:-0}" -le 0 ]; then
  log "restore check failed: table_count=$table_count"
  alert "Lumos new-api restore check failed" "No tables found after restoring $latest on $(hostname)."
  exit 1
fi

log "restore check completed archive=$latest tables=$table_count"
