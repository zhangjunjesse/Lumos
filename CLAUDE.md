# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Lumos — AI 智能工作台

## 开发命令

```bash
npm install            # 安装依赖
./dev.sh               # 开发模式（推荐，自动加载 .env 和隔离环境变量）
npm run dev            # 纯 Next.js 开发（不注入隔离变量）
npm run electron:dev   # Electron 完整桌面应用开发
npm run build          # 构建 Next.js
npm run lint           # 代码检查
```

---

## 项目概述

**Lumos** 是基于 Claude Agent SDK 的桌面 AI 工作台。

**技术栈**：Electron + Next.js + React 19 + TypeScript + Tailwind CSS + shadcn/ui + better-sqlite3

**核心功能模块**：
1. **AI 对话**（`/chat`）— 多模型对话，支持 Claude / OpenAI / 自定义 Provider
2. **知识库**（`/knowledge`、`/library`）— 文档导入、RAG 检索（BM25 + 向量混合）
3. **DeepSearch**（MCP）— 通过 MCP 搜索知乎、微信公众号等平台内容
4. **工作流自动化**（`/workflow`）— 定时多 Agent 工作流，支持 DSL 编排和调度
5. **Mind**（`/mind`）— 思维导图 / 深度思考工作区
6. **对话记录**（`/conversations`）— 会话历史与文档管理
7. **MCP 插件**（`/plugins/mcp`）— 可扩展第三方 MCP 服务器
8. **Provider 管理**（`/settings`）— API 密钥、模型选择、自定义端点
9. **浏览器工作区**（`/browser`）— 内置浏览器，AI 与用户共享 tab

---

## 项目结构

```
lumos/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── api/              # API 路由（薄层，业务逻辑在 lib/）
│   │   ├── chat/             # 对话页面
│   │   ├── workflow/         # 工作流 + 定时任务
│   │   ├── knowledge/        # 知识库
│   │   ├── library/          # 文档库
│   │   ├── mind/             # 思维工作区
│   │   ├── conversations/    # 对话记录
│   │   ├── documents/        # 文档管理
│   │   ├── settings/         # 设置（Provider、MCP 等）
│   │   ├── extensions/       # 扩展管理
│   │   └── browser/          # 浏览器工作区
│   ├── components/           # React 组件（按功能分目录）
│   ├── lib/                  # 核心业务逻辑
│   │   ├── claude-client.ts  # Claude SDK 封装（对话流）
│   │   ├── claude/           # SDK 运行时、Provider 解析、本地认证
│   │   ├── db/               # SQLite 数据库（schema、迁移、查询）
│   │   ├── workflow/         # 工作流 DSL、引擎、subagent、步骤注册
│   │   ├── team-run/         # 多 Agent 编排运行时（stage-worker 等）
│   │   ├── knowledge/        # RAG 管道（分块、嵌入、BM25、搜索）
│   │   ├── deepsearch/       # DeepSearch MCP 适配器
│   │   ├── capability/       # Agent 能力定义
│   │   ├── memory/           # Agent 记忆系统
│   │   ├── mcp-resolver.ts   # MCP 服务器解析（路径替换、env 注入）
│   │   ├── provider-*.ts     # Provider 配置、解析、预设
│   │   ├── feishu/           # 飞书 API 集成
│   │   └── scheduler/        # 定时任务调度引擎
│   └── types/                # TypeScript 类型定义
├── electron/                 # Electron 主进程
│   ├── main.ts               # 应用入口
│   ├── browser/              # 浏览器管理（BrowserManager、Bridge 服务器、CDP）
│   └── preload.ts            # 预加载脚本
├── resources/
│   └── mcp-servers/          # 内置 MCP 服务器（deepsearch、bilibili 等）
├── public/
│   └── mcp-servers/          # MCP 服务器配置 JSON
└── dev.sh                    # 开发启动脚本（注入隔离环境变量）
```

---

## 工作流系统

### 架构
- **DSL**（`src/lib/workflow/dsl.ts`）：声明式多步骤 Agent 工作流
- **引擎**（`src/lib/workflow/engine.ts`）：步骤调度、依赖解析、并发控制
- **subagent**（`src/lib/workflow/subagent.ts`）：每个 Agent 步骤的执行入口，负责构建 payload、调用 StageWorker、持久化执行结果
- **StageWorker**（`src/lib/team-run/stage-worker.ts`）：调用 Claude Agent SDK，捕获 trace 事件（tool calls、results、thinking）
- **调度器**（`src/lib/scheduler/`）：定时触发工作流执行（interval-based cron）

### Agent 工具权限
`src/lib/team-run/runtime-tool-policy.ts` 中 `canUseTool` 对所有工具返回 allow（包括 MCP 工具）。MCP 服务器通过 `src/lib/mcp-resolver.ts` 统一注入。

### 执行目录
Agent 的工作目录（`sessionWorkspace`）优先使用 schedule 配置的 `workingDirectory`，未配置时 fallback 到 `LUMOS_DATA_DIR`（即 `~/.lumos`），**不使用 `process.cwd()`**，避免在开发环境下读取项目文件。

### 执行记录
- 存储于 `schedule_run_history` 表
- 每个步骤结果通过 `step-output-formatter.ts` 格式化为 Markdown，含执行 trace
- UI：`/workflow/schedules/[id]/runs/[runId]`

---

## 数据存储

### 用户数据目录
开发和生产均使用 `~/.lumos/`（通过 `dev.sh` 注入 `LUMOS_DATA_DIR`）

```
~/.lumos/
├── lumos.db                  # SQLite 主数据库
├── .claude/                  # 隔离的 Claude CLI 配置
├── sessions/                 # 对话 JSONL 历史
├── uploads/                  # 用户上传文件
└── workflow-agent-runs/      # 工作流 Agent 执行工作区
```

### 主要数据库表
- `sessions` — 会话元数据
- `messages` — 对话消息（JSON content blocks）
- `api_providers` — AI Provider 配置
- `mcp_servers` — MCP 插件配置
- `scheduled_workflows` — 定时工作流定义
- `schedule_run_history` — 执行历史记录
- `knowledge_collections` / `knowledge_items` / `knowledge_chunks` — 知识库

---

## Claude SDK 隔离机制

Lumos 内嵌 Claude CLI，通过五层隔离防止污染用户本地环境：

1. **配置目录隔离**：使用 `~/.lumos/.claude/` 而非 `~/.claude/`，通过 `LUMOS_CLAUDE_CONFIG_DIR` 设置
2. **环境变量隔离**：启动 SDK 前清空 `CLAUDE_*` / `ANTHROPIC_*`，只注入应用配置的 API Key 和 Base URL
3. **`settingSources: []`**：阻止 SDK 读取用户全局 settings.json 和 MCP 配置
4. **MCP 服务器隔离**：只加载 Lumos UI 中配置的 MCP 服务器（`mcp-resolver.ts`）
5. **Skills/Hooks 隔离**：`settingSources: []` 确保不加载用户 Skills/Hooks

实现入口：`src/lib/claude-client.ts`、`src/lib/claude/sdk-runtime.ts`

---

## 代码规范

- **单文件不超过 300 行**（硬性要求），超 200 行考虑拆分
- **函数不超过 50 行**
- 文件名：kebab-case；函数：camelCase；常量：UPPER_SNAKE_CASE；类/组件/类型：PascalCase
- API 路由只做参数解析和响应，业务逻辑放 `lib/`
- 禁止硬编码配置，禁止复制粘贴代码

---

## Git 工作流

- Conventional Commits：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf`
- 提交后自动 `git push`，无需额外确认
- **禁止自动发版**：推送 tag 必须等用户明确指示

---

## 发版流程

1. 更新 `package.json` version → `npm install` → commit & push
2. `git tag v{版本号} && git push origin v{版本号}`
3. CI 自动构建（`.github/workflows/build.yml`）并创建 GitHub Release
4. 不要手动创建 GitHub Release（会与 CI 冲突）

构建产物：macOS DMG（universal）/ Windows NSIS / Linux AppImage + deb + rpm

---

## 飞书集成

- 需要 `appId` + `appSecret`，文档需授权给应用
- 支持：读取文档内容、图片识别、编辑文档块、追加内容
- 不支持：飞书画板（API 限制，需手动导出图片）
