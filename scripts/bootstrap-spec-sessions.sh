#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKTREE_ROOT="${LUMOS_WORKTREE_ROOT:-$(cd "${REPO_ROOT}/.." && pwd)/lumos-worktrees}"
SESSION_NAME="${1:-lumos-specs}"
AI_CLI="${2:-codex}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  }
}

ensure_dir() {
  local path="$1"
  if [[ ! -d "${path}" ]]; then
    printf 'Directory does not exist: %s\n' "${path}" >&2
    exit 1
  fi
}

ensure_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    printf 'File does not exist: %s\n' "${path}" >&2
    exit 1
  fi
}

copy_card_into_worktree() {
  local source_file="$1"
  local worktree_path="$2"
  local target_file="${worktree_path}/tasks/discovery/$(basename "${source_file}")"

  mkdir -p "${worktree_path}/tasks/discovery"
  cp "${source_file}" "${target_file}"
}

write_prompt_file() {
  local worktree_path="$1"
  local prompt="$2"
  local target_file="${worktree_path}/.codex-spec-prompt.txt"

  cat > "${target_file}" <<EOF
${prompt}
EOF
}

start_window() {
  local window_name="$1"
  local worktree_path="$2"
  local prompt_file="$3"
  local cmd=""

  tmux new-window -t "${SESSION_NAME}" -n "${window_name}" -c "${worktree_path}" >/dev/null
  tmux setw -t "${SESSION_NAME}:${window_name}" automatic-rename off >/dev/null

  case "${AI_CLI}" in
    codex)
      printf -v cmd '%s' "codex --no-alt-screen --full-auto \"\$(cat $(printf '%q' "${prompt_file}"))\""
      ;;
    claude)
      printf -v cmd '%s' "claude --permission-mode acceptEdits \"\$(cat $(printf '%q' "${prompt_file}"))\""
      ;;
    *)
      printf 'Unsupported AI CLI: %s\n' "${AI_CLI}" >&2
      exit 1
      ;;
  esac

  tmux send-keys -t "${SESSION_NAME}:${window_name}" "${cmd}" C-m
}

build_prompt() {
  local module_name="$1"
  local card_name="$2"
  local scope_hint="$3"

  cat <<EOF
你现在只负责模块【${module_name}】的需求澄清，不进入正式开发。

先做这几步：
1. 阅读 tasks/discovery/${card_name}
2. 阅读与该模块最相关的代码目录：${scope_hint}
3. 总结当前实现、现有能力和明显空白
4. 把需要我确认的问题整理成一个短清单
5. 给出 MVP 边界建议和非目标建议

限制：
- 只允许更新这张需求澄清卡
- 不要进入正式实现
- 不要修改 package.json、package-lock.json、全局配置、migration
- 如果需要验证想法，只做极小范围原型或代码阅读记录

输出要求：
- 先给我当前理解
- 再给我 3 到 7 个关键澄清问题
- 最后给一个建议的 MVP 范围
EOF
}

require_cmd tmux
require_cmd "${AI_CLI}"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  printf 'tmux session already exists: %s\n' "${SESSION_NAME}" >&2
  exit 1
fi

MAIN_CARD="${REPO_ROOT}/tasks/discovery/lumos-main-agent.md"
TEAM_CARD="${REPO_ROOT}/tasks/discovery/agent-team.md"
BROWSER_CARD="${REPO_ROOT}/tasks/discovery/browser-module.md"
KNOWLEDGE_CARD="${REPO_ROOT}/tasks/discovery/knowledge-cards-graph.md"

MAIN_WORKTREE="${WORKTREE_ROOT}/spec-lumos-main-agent"
TEAM_WORKTREE="${WORKTREE_ROOT}/spec-agent-team"
BROWSER_WORKTREE="${WORKTREE_ROOT}/spec-browser-module"
KNOWLEDGE_WORKTREE="${WORKTREE_ROOT}/spec-knowledge-cards-graph"

for path in \
  "${MAIN_CARD}" \
  "${TEAM_CARD}" \
  "${BROWSER_CARD}" \
  "${KNOWLEDGE_CARD}"
do
  ensure_file "${path}"
done

for path in \
  "${MAIN_WORKTREE}" \
  "${TEAM_WORKTREE}" \
  "${BROWSER_WORKTREE}" \
  "${KNOWLEDGE_WORKTREE}"
do
  ensure_dir "${path}"
done

copy_card_into_worktree "${MAIN_CARD}" "${MAIN_WORKTREE}"
copy_card_into_worktree "${TEAM_CARD}" "${TEAM_WORKTREE}"
copy_card_into_worktree "${BROWSER_CARD}" "${BROWSER_WORKTREE}"
copy_card_into_worktree "${KNOWLEDGE_CARD}" "${KNOWLEDGE_WORKTREE}"

write_prompt_file \
  "${MAIN_WORKTREE}" \
  "$(build_prompt "Lumos 主 AI Agent" "lumos-main-agent.md" "src/app/chat, src/components/chat, src/app/api/ai-assistant, src/lib, electron")"

write_prompt_file \
  "${TEAM_WORKTREE}" \
  "$(build_prompt "Agent Team" "agent-team.md" "src/components, src/lib, src/app/chat, src/app/mind, src/app/extensions")"

write_prompt_file \
  "${BROWSER_WORKTREE}" \
  "$(build_prompt "浏览器功能模块" "browser-module.md" "src/app/browser, src/components/browser, electron/browser, src/lib/chrome-mcp.ts")"

write_prompt_file \
  "${KNOWLEDGE_WORKTREE}" \
  "$(build_prompt "知识卡片与知识图谱" "knowledge-cards-graph.md" "src/app/knowledge, src/components/knowledge, src/lib/knowledge, src/lib/db")"

tmux new-session -d -s "${SESSION_NAME}" -n main -c "${REPO_ROOT}"
tmux setw -t "${SESSION_NAME}:main" automatic-rename off >/dev/null

start_window \
  "main-agent" \
  "${MAIN_WORKTREE}" \
  ".codex-spec-prompt.txt"

start_window \
  "agent-team" \
  "${TEAM_WORKTREE}" \
  ".codex-spec-prompt.txt"

start_window \
  "browser" \
  "${BROWSER_WORKTREE}" \
  ".codex-spec-prompt.txt"

start_window \
  "knowledge" \
  "${KNOWLEDGE_WORKTREE}" \
  ".codex-spec-prompt.txt"

tmux select-window -t "${SESSION_NAME}:main"

cat <<EOF
Created tmux session: ${SESSION_NAME}
AI CLI: ${AI_CLI}

Windows
  main        -> ${REPO_ROOT}
  main-agent  -> ${MAIN_WORKTREE}
  agent-team  -> ${TEAM_WORKTREE}
  browser     -> ${BROWSER_WORKTREE}
  knowledge   -> ${KNOWLEDGE_WORKTREE}

Attach with:
  tmux attach -t ${SESSION_NAME}
EOF
