#!/usr/bin/env bash
set -euo pipefail

DB_PATH="/opt/new-api/data/one-api.db"
BACKUP_DIR="/opt/new-api/backups"
LOG_FILE="/var/log/lumos-new-api-backup.log"
RETENTION_DAYS=30
LOCK_FILE="/run/lumos-new-api-backup.lock"
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
  log "backup failed at line=$line"
  alert "Lumos new-api backup failed" "Backup failed at line $line on $(hostname). Check $LOG_FILE."
}

trap 'on_error "$LINENO"' ERR

mkdir -p "$BACKUP_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "backup skipped: another backup is running"
  exit 0
fi

if [ ! -f "$DB_PATH" ]; then
  log "backup failed: database not found at $DB_PATH"
  alert "Lumos new-api backup failed" "Database not found at $DB_PATH on $(hostname)."
  exit 1
fi

stamp="$(date '+%Y%m%d-%H%M%S')"
tmp_db="$BACKUP_DIR/one-api.$stamp.db.tmp"
backup_db="$BACKUP_DIR/one-api.$stamp.db"
archive="$backup_db.zst"

log "backup started source=$DB_PATH"
sqlite3 "$DB_PATH" ".backup '$tmp_db'"

integrity="$(sqlite3 "$tmp_db" 'PRAGMA integrity_check;' 2>&1)"
if [ "$integrity" != "ok" ]; then
  rm -f "$tmp_db"
  log "backup failed: integrity_check=$integrity"
  alert "Lumos new-api backup failed" "SQLite integrity_check failed on $(hostname): $integrity"
  exit 1
fi

mv "$tmp_db" "$backup_db"
zstd -q -T0 --rm "$backup_db" -o "$archive"
chmod 0600 "$archive"

find "$BACKUP_DIR" -type f -name 'one-api.*.db.zst' -mtime +"$RETENTION_DAYS" -delete

size="$(du -h "$archive" | awk '{print $1}')"
count="$(find "$BACKUP_DIR" -type f -name 'one-api.*.db.zst' | wc -l | tr -d ' ')"
log "backup completed archive=$archive size=$size retained=$count"
