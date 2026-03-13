#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_BASE_BRANCH="$(git -C "${REPO_ROOT}" branch --show-current || true)"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-worktrees.sh <task-id> <short-name> [base-branch]

Example:
  scripts/setup-worktrees.sh 101 chat-toolbar
  scripts/setup-worktrees.sh 102 settings-cleanup main

Environment:
  LUMOS_WORKTREE_ROOT  Override the default sibling directory for worktrees.
EOF
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

ensure_git_repo() {
  git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null
}

ensure_clean_path() {
  local path="$1"
  if [[ -e "${path}" ]]; then
    printf 'Path already exists: %s\n' "${path}" >&2
    exit 1
  fi
}

ensure_valid_task_id() {
  local task_id="$1"
  if [[ ! "${task_id}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
    printf 'Invalid task id: %s\n' "${task_id}" >&2
    exit 1
  fi
}

ensure_branch_free() {
  local branch="$1"
  if git -C "${REPO_ROOT}" worktree list --porcelain | grep -Fq "branch refs/heads/${branch}"; then
    printf 'Branch is already checked out in another worktree: %s\n' "${branch}" >&2
    exit 1
  fi
}

ensure_worktree_root_outside_repo() {
  local repo_realpath worktree_root_realpath

  repo_realpath="$(cd "${REPO_ROOT}" && pwd)"
  worktree_root_realpath="$(cd "${WORKTREE_ROOT}" && pwd)"

  if [[ "${worktree_root_realpath}" == "${repo_realpath}" || "${worktree_root_realpath}" == "${repo_realpath}/"* ]]; then
    printf 'Worktree root must live outside the repository: %s\n' "${worktree_root_realpath}" >&2
    exit 1
  fi
}

TASK_ID="${1:-}"
SHORT_NAME="${2:-}"
BASE_BRANCH="${3:-${DEFAULT_BASE_BRANCH:-main}}"

if [[ -z "${TASK_ID}" || -z "${SHORT_NAME}" ]]; then
  usage
  exit 1
fi

ensure_git_repo
ensure_valid_task_id "${TASK_ID}"

TASK_SLUG="$(slugify "${SHORT_NAME}")"

if [[ -z "${TASK_SLUG}" ]]; then
  printf 'Invalid short name: %s\n' "${SHORT_NAME}" >&2
  exit 1
fi

BRANCH_NAME="task/${TASK_ID}-${TASK_SLUG}"
WORKTREE_ROOT="${LUMOS_WORKTREE_ROOT:-$(cd "${REPO_ROOT}/.." && pwd)/lumos-worktrees}"
WORKTREE_PATH="${WORKTREE_ROOT}/${TASK_ID}-${TASK_SLUG}"

if ! git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  printf 'Base branch does not exist locally: %s\n' "${BASE_BRANCH}" >&2
  exit 1
fi

mkdir -p "${WORKTREE_ROOT}"
ensure_worktree_root_outside_repo
ensure_clean_path "${WORKTREE_PATH}"
ensure_branch_free "${BRANCH_NAME}"

if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
  git -C "${REPO_ROOT}" worktree add "${WORKTREE_PATH}" "${BRANCH_NAME}"
else
  git -C "${REPO_ROOT}" worktree add -b "${BRANCH_NAME}" "${WORKTREE_PATH}" "${BASE_BRANCH}"
fi

cat <<EOF
Created worktree
  branch:   ${BRANCH_NAME}
  path:     ${WORKTREE_PATH}
  based on: ${BASE_BRANCH}

Next steps
  1. Copy tasks/_template.md to a real task card and freeze the task.
  2. Open a new AI/dev session in:
     ${WORKTREE_PATH}
  3. Keep this worktree isolated to this single task.
EOF
