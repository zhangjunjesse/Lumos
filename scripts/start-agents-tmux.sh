#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/start-agents-tmux.sh [session-name] [main-dir] [dev1-dir] [dev2-dir] [review-dir]

Example:
  scripts/start-agents-tmux.sh lumos-agents \
    /Users/zhangjun/私藏/lumos \
    /Users/zhangjun/私藏/lumos-worktrees/101-chat-toolbar \
    /Users/zhangjun/私藏/lumos-worktrees/102-settings-cleanup \
    /Users/zhangjun/私藏/lumos-worktrees/103-review-import-flow
EOF
}

SESSION_NAME="${1:-lumos-agents}"
MAIN_DIR="${2:-${REPO_ROOT}}"
DEV1_DIR="${3:-${MAIN_DIR}}"
DEV2_DIR="${4:-${MAIN_DIR}}"
REVIEW_DIR="${5:-${MAIN_DIR}}"

require_tmux() {
  command -v tmux >/dev/null 2>&1 || {
    printf 'tmux is not installed or not in PATH.\n' >&2
    exit 1
  }
}

ensure_dir() {
  local target_dir="$1"
  if [[ ! -d "${target_dir}" ]]; then
    printf 'Directory does not exist: %s\n' "${target_dir}" >&2
    exit 1
  fi
}

create_window() {
  local session="$1"
  local window_name="$2"
  local target_dir="$3"

  tmux new-window -t "${session}" -n "${window_name}" -c "${target_dir}" >/dev/null
}

require_tmux

if [[ "${SESSION_NAME}" == "-h" || "${SESSION_NAME}" == "--help" ]]; then
  usage
  exit 0
fi

ensure_dir "${MAIN_DIR}"
ensure_dir "${DEV1_DIR}"
ensure_dir "${DEV2_DIR}"
ensure_dir "${REVIEW_DIR}"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  printf 'tmux session already exists: %s\n' "${SESSION_NAME}" >&2
  exit 1
fi

tmux new-session -d -s "${SESSION_NAME}" -n main -c "${MAIN_DIR}"
create_window "${SESSION_NAME}" dev-1 "${DEV1_DIR}"
create_window "${SESSION_NAME}" dev-2 "${DEV2_DIR}"
create_window "${SESSION_NAME}" review "${REVIEW_DIR}"
tmux select-window -t "${SESSION_NAME}:main"

cat <<EOF
Created tmux session: ${SESSION_NAME}

Windows
  main   -> ${MAIN_DIR}
  dev-1  -> ${DEV1_DIR}
  dev-2  -> ${DEV2_DIR}
  review -> ${REVIEW_DIR}

Attach with:
  tmux attach -t ${SESSION_NAME}
EOF
