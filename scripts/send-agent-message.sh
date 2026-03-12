#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/send-agent-message.sh <window-name> <message>

Examples:
  scripts/send-agent-message.sh browser "首发只做右侧内容面板浏览器，share to AI 放第二阶段。"
  scripts/send-agent-message.sh main-agent "MVP 先只做 /chat 单 Agent 主控，不做多 Agent 编排。"

Notes:
  - This script sends a message into a tmux window in session `lumos-specs`.
  - Use window names: main-agent, agent-team, browser, browser-dev, knowledge, architecture, architecture-dev, bug
EOF
}

SESSION_NAME="${LUMOS_TMUX_SESSION:-lumos-specs}"
WINDOW_NAME="${1:-}"
MESSAGE="${2:-}"

if [[ -z "${WINDOW_NAME}" || -z "${MESSAGE}" ]]; then
  usage
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  printf 'tmux is not installed or not in PATH.\n' >&2
  exit 1
fi

if ! tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  printf 'tmux session not found: %s\n' "${SESSION_NAME}" >&2
  exit 1
fi

if ! tmux list-windows -t "${SESSION_NAME}" -F '#W' | grep -Fxq "${WINDOW_NAME}"; then
  printf 'tmux window not found: %s\n' "${WINDOW_NAME}" >&2
  exit 1
fi

tmux send-keys -t "${SESSION_NAME}:${WINDOW_NAME}" "${MESSAGE}" C-m

printf 'Sent message to %s:%s\n' "${SESSION_NAME}" "${WINDOW_NAME}"
