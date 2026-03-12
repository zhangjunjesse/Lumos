#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/start-lumos-dev-instance.sh <instance-name> <port>

Example:
  scripts/start-lumos-dev-instance.sh browser 3101
  scripts/start-lumos-dev-instance.sh team 3102

Environment:
  LUMOS_INSTANCE_ROOT   Override the base directory for per-instance data.
EOF
}

INSTANCE_NAME="${1:-}"
PORT="${2:-}"

if [[ -z "${INSTANCE_NAME}" || -z "${PORT}" ]]; then
  usage
  exit 1
fi

if [[ ! "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  printf 'Invalid port: %s\n' "${PORT}" >&2
  exit 1
fi

NEXT_BIN="${REPO_ROOT}/node_modules/.bin/next"
WAIT_ON_BIN="${REPO_ROOT}/node_modules/.bin/wait-on"
CONCURRENTLY_BIN="${REPO_ROOT}/node_modules/.bin/concurrently"
ELECTRON_BIN="${REPO_ROOT}/node_modules/.bin/electron"

for bin_path in \
  "${NEXT_BIN}" \
  "${WAIT_ON_BIN}" \
  "${CONCURRENTLY_BIN}" \
  "${ELECTRON_BIN}"
do
  if [[ ! -x "${bin_path}" ]]; then
    printf 'Missing local dependency binary: %s\n' "${bin_path}" >&2
    printf 'Run npm install in this worktree first.\n' >&2
    exit 1
  fi
done

INSTANCE_ROOT="${LUMOS_INSTANCE_ROOT:-${HOME}/.lumos-instances}"
INSTANCE_DIR="${INSTANCE_ROOT}/${INSTANCE_NAME}"
CLAUDE_DIR="${INSTANCE_DIR}/.claude"

mkdir -p "${INSTANCE_DIR}" "${CLAUDE_DIR}"

cat <<EOF
Starting Lumos dev instance
  name:       ${INSTANCE_NAME}
  repo:       ${REPO_ROOT}
  port:       ${PORT}
  data dir:   ${INSTANCE_DIR}
  claude dir: ${CLAUDE_DIR}

Open in Electron after the Next server is ready.
Stop with Ctrl+C.
EOF

export PORT="${PORT}"
export LUMOS_DEV_SERVER_PORT="${PORT}"
export LUMOS_SERVER_PORT="${PORT}"
export LUMOS_DATA_DIR="${INSTANCE_DIR}"
export LUMOS_CLAUDE_CONFIG_DIR="${CLAUDE_DIR}"

"${CONCURRENTLY_BIN}" -k -n web,electron -c auto \
  "${NEXT_BIN} dev -p ${PORT}" \
  "node scripts/build-electron.mjs && ${WAIT_ON_BIN} http://127.0.0.1:${PORT} && ${ELECTRON_BIN} ."
