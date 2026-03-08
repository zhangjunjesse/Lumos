# Claude 记忆模板规范（Lumos 优先）

本文给出一套可落地的模板内容规范，目标是同一份记忆设计可同时用于：

- Lumos 内嵌 Claude Agent SDK（优先）
- 纯本地 Claude Code（补充）

## 1. 运行架构（推荐）

1. 捕获层：识别用户显式记忆指令（如“记住/always/never/prefer”）。
2. 存储层：主存储写入 Lumos SQLite `memories`，并镜像到 Claude 项目记忆文件。
3. 检索层：在 `UserPromptSubmit` hook 注入相关记忆到 prompt。
4. 治理层：开关化控制（是否启用记忆系统、是否加载项目规则）。

当前 Lumos 代码已实现上述闭环，模板的职责是定义“记什么、怎么写、何时覆盖”。

## 2. 模板目录（建议）

```text
memory-template/
  global/
    CLAUDE.md.template
    settings.json.template
  project/
    CLAUDE.md.template
    .claude/
      settings.json.template
      rules/
        memory-policy.md
        coding-preferences.md
      hooks/
        memory-hooks.md
```

## 3. 全局模板内容

### `global/CLAUDE.md.template`

```md
# Global Memory Policy

## Objective
- Keep responses aligned with stable user preferences.
- Prefer current user request over historical memory if conflict exists.

## Memory Priorities
1. Current user request (highest)
2. Project memory
3. Global memory (lowest)

## Memory Safety
- Do not memorize secrets, tokens, passwords, private keys.
- Treat unverified one-off statements as temporary hints.
- Ask before saving high-impact constraints.
```

### `global/settings.json.template`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "Bash": "ask",
    "Read": "allow",
    "Edit": "allow",
    "Write": "ask"
  }
}
```

## 4. 项目模板内容

### `project/CLAUDE.md.template`

```md
# Project Memory Contract

## Stable Facts
- Stack: <fill>
- Package manager: <npm|pnpm|yarn|bun>
- Test command: <fill>

## Preferences
- Code style: <fill>
- Architecture preferences: <fill>

## Constraints
- Never: modify lockfile without request
- Never: expose secrets in logs
- Always: run lint before final change

## Conflict Resolution
- If memory conflicts with current request, follow current request.
- If project memory conflicts with global memory, follow project memory.
```

### `project/.claude/settings.json.template`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "Bash": "ask",
    "Read": "allow",
    "Edit": "allow",
    "Write": "ask"
  }
}
```

### `project/.claude/rules/memory-policy.md`

```md
# Memory Writing Policy

Only save memory when one of these is true:
- user explicitly says: 记住 / remember / always / never / prefer
- repeated correction appears >= 2 times
- project stable fact is confirmed by repository files

Memory line format:
- [YYYY-MM-DD] [category] content

Allowed categories:
- preference
- constraint
- fact
- workflow
- other
```

### `project/.claude/rules/coding-preferences.md`

```md
# Coding Preferences

- Prefer minimal diffs.
- Keep backward compatibility unless user asks for breaking change.
- Do not change unrelated files.
```

### `project/.claude/hooks/memory-hooks.md`

```md
# Hook Strategy (Documentation)

Lumos mode:
- Memory capture and retrieval are handled inside Lumos runtime and SDK hooks.
- Keep project hooks lightweight; avoid duplicate memory write logic.

Pure Claude local mode:
- Optional: use local hook scripts to append validated memories into
  ~/.claude/projects/<encoded-project-path>/memory/MEMORY.md
- Enforce same format and conflict rules as this template.
```

## 5. MEMORY.md 规范

推荐每条一行，避免长段落：

```md
# MEMORY

- [2026-03-07] [preference] User prefers bun over npm.
- [2026-03-07] [constraint] Do not modify package.json unless explicitly requested.
- [2026-03-07] [workflow] Run lint for changed files before final response.
```

治理建议：

1. 上限 200 行，超出后保留头部说明和最近记录。
2. 每周清理过期或错误记忆。
3. 明确禁止写入 secrets/PII。

## 6. 运行策略

### A. Lumos 嵌入模式（默认）

1. 打开设置：
   - `Memory System = ON`
   - `Load Project CLAUDE Rules = ON`（仅可信仓库）
2. 在对话中发送显式指令，如“记住我以后用 bun 不用 npm”。
3. 后续提问时，系统自动注入相关 `<lumos_memory>` 上下文。

### B. 本地 Claude 模式（补充）

1. 复制模板到 `~/.claude` 和项目 `.claude`。
2. 按模板维护 `CLAUDE.md` 与 `MEMORY.md`。
3. 使用 `/memory` 定期审查和修订。

## 7. 与 Lumos 代码实现映射

- 记忆存储：`src/lib/db/memories.ts`
- 迁移建表：`src/lib/db/migrations-lumos.ts`
- 运行时捕获/检索：`src/lib/memory/runtime.ts`
- 对话接入：`src/app/api/chat/route.ts`
- SDK Hook 注入：`src/lib/claude-client.ts`
- 开关设置：`src/app/api/settings/app/route.ts`

