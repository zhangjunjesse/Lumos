#!/usr/bin/env bash
set -u

CONFIG_FILE="/etc/lumos/new-api-alert.env"
LOG_FILE="/var/log/lumos-new-api-alert.log"

title="${1:-Lumos new-api alert}"
body="${2:-No detail provided.}"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >> "$LOG_FILE"
}

if [ ! -f "$CONFIG_FILE" ]; then
  log "skip alert: config not found title=$title"
  exit 0
fi

# shellcheck disable=SC1090
. "$CONFIG_FILE"

webhook="${LUMOS_ALERT_WEBHOOK_URL:-}"
kind="${LUMOS_ALERT_WEBHOOK_TYPE:-generic}"

if [ -z "$webhook" ]; then
  log "skip alert: LUMOS_ALERT_WEBHOOK_URL empty title=$title"
  exit 0
fi

escaped_title="$(printf '%s' "$title" | sed 's/\\/\\\\/g; s/"/\\"/g')"
escaped_body="$(printf '%s' "$body" | sed 's/\\/\\\\/g; s/"/\\"/g')"

case "$kind" in
  feishu)
    payload="{\"msg_type\":\"text\",\"content\":{\"text\":\"$escaped_title\n$escaped_body\"}}"
    ;;
  wecom)
    payload="{\"msgtype\":\"text\",\"text\":{\"content\":\"$escaped_title\n$escaped_body\"}}"
    ;;
  *)
    payload="{\"title\":\"$escaped_title\",\"text\":\"$escaped_body\"}"
    ;;
esac

if curl -fsS --max-time 8 -H 'Content-Type: application/json' -d "$payload" "$webhook" >/dev/null; then
  log "alert sent title=$title"
else
  log "alert failed title=$title"
fi
