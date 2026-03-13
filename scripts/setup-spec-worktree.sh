#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASE_BRANCH="${2:-$(git -C "${REPO_ROOT}" branch --show-current || true)}"
MODULE_NAME="${1:-}"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-spec-worktree.sh <module-name> [base-branch]

Example:
  scripts/setup-spec-worktree.sh browser-sidebar
  scripts/setup-spec-worktree.sh settings-panel main
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

ensure_path_free() {
  local path="$1"
  if [[ -e "${path}" ]]; then
    printf 'Path already exists: %s\n' "${path}" >&2
    exit 1
  fi
}

if [[ -z "${MODULE_NAME}" || "${MODULE_NAME}" == "-h" || "${MODULE_NAME}" == "--help" ]]; then
  usage
  exit 0
fi

ensure_git_repo

MODULE_SLUG="$(slugify "${MODULE_NAME}")"

if [[ -z "${MODULE_SLUG}" ]]; then
  printf 'Invalid module name: %s\n' "${MODULE_NAME}" >&2
  exit 1
fi

if [[ -z "${BASE_BRANCH}" ]]; then
  BASE_BRANCH="main"
fi

if ! git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  printf 'Base branch does not exist locally: %s\n' "${BASE_BRANCH}" >&2
  exit 1
fi

WORKTREE_ROOT="${LUMOS_WORKTREE_ROOT:-$(cd "${REPO_ROOT}/.." && pwd)/lumos-worktrees}"
BRANCH_NAME="spec/${MODULE_SLUG}"
WORKTREE_PATH="${WORKTREE_ROOT}/spec-${MODULE_SLUG}"

mkdir -p "${WORKTREE_ROOT}"
ensure_path_free "${WORKTREE_PATH}"

if git -C "${REPO_ROOT}" worktree list --porcelain | grep -Fq "branch refs/heads/${BRANCH_NAME}"; then
  printf 'Branch is already checked out in another worktree: %s\n' "${BRANCH_NAME}" >&2
  exit 1
fi

if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
  git -C "${REPO_ROOT}" worktree add "${WORKTREE_PATH}" "${BRANCH_NAME}"
else
  git -C "${REPO_ROOT}" worktree add -b "${BRANCH_NAME}" "${WORKTREE_PATH}" "${BASE_BRANCH}"
fi

cat <<EOF
Created spec worktree
  branch:   ${BRANCH_NAME}
  path:     ${WORKTREE_PATH}
  based on: ${BASE_BRANCH}

Use this worktree only for:
  - requirement clarification
  - code reading
  - solution comparison
  - very small prototype validation

Do not use it for:
  - full implementation
  - lockfile changes
  - global config changes
EOF
