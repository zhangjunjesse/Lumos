#!/usr/bin/env bash
set -u

LOG_FILE="/var/log/lumos-new-api-healthcheck.log"
FAIL_FILE="/run/lumos-new-api-healthcheck.failures"
MAX_FAILURES=3
ALERT_BIN="/usr/local/sbin/lumos-new-api-alert.sh"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >> "$LOG_FILE"
}

alert() {
  if [ -x "$ALERT_BIN" ]; then
    "$ALERT_BIN" "$1" "$2" >/dev/null 2>&1 || true
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

clear_failure
exit 0
