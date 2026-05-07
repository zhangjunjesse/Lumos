#!/usr/bin/env bash
set -u

LOG_FILE="/var/log/lumos-new-api-healthcheck.log"
FAIL_FILE="/run/lumos-new-api-healthcheck.failures"
MAX_FAILURES=3
ALERT_BIN="/usr/local/sbin/lumos-new-api-alert.sh"
DATA_DIR="/opt/new-api/data"
BACKUP_DIR="/opt/new-api/backups"
DISK_WARN_PERCENT="${LUMOS_NEW_API_DISK_WARN_PERCENT:-85}"
BACKUP_MAX_AGE_HOURS="${LUMOS_NEW_API_BACKUP_MAX_AGE_HOURS:-30}"
ALERT_THROTTLE_SECONDS="${LUMOS_NEW_API_ALERT_THROTTLE_SECONDS:-3600}"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >> "$LOG_FILE"
}

alert() {
  if [ -x "$ALERT_BIN" ]; then
    "$ALERT_BIN" "$1" "$2" >/dev/null 2>&1 || true
  fi
}

alert_throttled() {
  local key="$1"
  local title="$2"
  local body="$3"
  local state_file="/run/lumos-new-api-alert-$key.last"
  local now
  local last

  now="$(date +%s)"
  last="$(cat "$state_file" 2>/dev/null || printf '0')"
  case "$last" in
    ''|*[!0-9]*) last=0 ;;
  esac

  if [ $((now - last)) -ge "$ALERT_THROTTLE_SECONDS" ]; then
    printf '%s' "$now" > "$state_file"
    alert "$title" "$body"
  fi
}

check_disk_usage() {
  local target="$1"
  local usage

  if [ ! -e "$target" ]; then
    log "disk check skipped missing=$target"
    return
  fi

  usage="$(df -P "$target" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  case "$usage" in
    ''|*[!0-9]*)
      log "disk check skipped unreadable target=$target usage=$usage"
      return
      ;;
  esac

  if [ "$usage" -ge "$DISK_WARN_PERCENT" ]; then
    log "disk warning target=$target usage=${usage}% threshold=${DISK_WARN_PERCENT}%"
    alert_throttled \
      "disk-${target//\//_}" \
      "Lumos new-api disk usage warning" \
      "Disk usage for $target is ${usage}% on $(hostname). Threshold: ${DISK_WARN_PERCENT}%."
  fi
}

check_backup_freshness() {
  local latest
  local now
  local modified
  local age_hours

  if [ ! -d "$BACKUP_DIR" ]; then
    log "backup freshness warning backup_dir_missing=$BACKUP_DIR"
    alert_throttled \
      "backup-missing" \
      "Lumos new-api backup missing" \
      "Backup directory $BACKUP_DIR is missing on $(hostname)."
    return
  fi

  latest="$(find "$BACKUP_DIR" -type f -name 'one-api.*.db.zst' -print | sort | tail -n 1)"
  if [ -z "$latest" ]; then
    log "backup freshness warning no_backup_archive"
    alert_throttled \
      "backup-empty" \
      "Lumos new-api backup missing" \
      "No backup archive was found in $BACKUP_DIR on $(hostname)."
    return
  fi

  now="$(date +%s)"
  modified="$(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest" 2>/dev/null || printf '0')"
  case "$modified" in
    ''|*[!0-9]*) modified=0 ;;
  esac
  age_hours=$(( (now - modified) / 3600 ))

  if [ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]; then
    log "backup freshness warning latest=$latest age_hours=$age_hours max_age_hours=$BACKUP_MAX_AGE_HOURS"
    alert_throttled \
      "backup-stale" \
      "Lumos new-api backup stale" \
      "Latest backup is $latest, age ${age_hours}h on $(hostname). Max age: ${BACKUP_MAX_AGE_HOURS}h."
  fi
}

record_failure() {
  local reason="$1"
  local count=1

  if [ -f "$FAIL_FILE" ]; then
    count="$(cat "$FAIL_FILE" 2>/dev/null || printf '0')"
    case "$count" in
      ''|*[!0-9]*) count=0 ;;
    esac
    count=$((count + 1))
  fi

  printf '%s' "$count" > "$FAIL_FILE"
  log "failure count=$count reason=$reason"

  if [ "$count" -ge "$MAX_FAILURES" ]; then
    log "restart new-api after $count consecutive failures"
    docker restart new-api >> "$LOG_FILE" 2>&1 || log "docker restart new-api failed"
    alert "Lumos new-api restarted" "Reason: $reason. Consecutive failures: $count. Host: $(hostname)."
    rm -f "$FAIL_FILE"
  fi
}

clear_failure() {
  if [ -f "$FAIL_FILE" ]; then
    log "service recovered"
    rm -f "$FAIL_FILE"
  fi
}

if ! systemctl is-active --quiet nginx; then
  log "nginx inactive, restarting"
  if systemctl restart nginx >> "$LOG_FILE" 2>&1; then
    alert "Lumos new-api Nginx restarted" "Nginx was inactive and has been restarted on $(hostname)."
  else
    log "nginx restart failed"
    alert "Lumos new-api Nginx restart failed" "Nginx was inactive and restart failed on $(hostname)."
  fi
fi

if ! docker inspect -f '{{.State.Running}}' new-api 2>/dev/null | grep -q '^true$'; then
  log "new-api container not running, starting"
  docker start new-api >> "$LOG_FILE" 2>&1 || true
fi

if ! curl -fsS --max-time 5 -H 'Host: api.miki.zj.cn' http://127.0.0.1/healthz >/dev/null; then
  record_failure "nginx healthz failed"
  exit 1
fi

if ! curl -fsS --max-time 8 http://127.0.0.1:3000/api/status >/dev/null; then
  record_failure "new-api api/status failed"
  exit 1
fi

check_disk_usage /
check_disk_usage "$DATA_DIR"
check_backup_freshness

clear_failure
exit 0
