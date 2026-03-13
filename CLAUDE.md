# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---
# Lumos — 文档智能助手

## 开发命令

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
# Web 开发（仅 Next.js，无 Electron）
npm run dev

# Electron 开发（完整桌面应用）
npm run electron:dev
```

### 构建与打包
```bash
# 构建 Next.js
npm run build

# 构建并打包 Electron（所有平台）
npm run electron:pack

# 打包特定平台
npm run electron:pack:mac     # macOS
npm run electron:pack:win     # Windows
npm run electron:pack:linux   # Linux
```

### 代码检查
```bash
npm run lint
```

---

## 项目概述

**Lumos** 是基于 Claude Code SDK 的桌面 AI 助手，专注于文档处理与知识管理。

**技术栈**：Electron + Next.js 16 + React 19 + TypeScript + Tailwind CSS + shadcn/ui + better-sqlite3

**核心能力**：
1. 多模型 AI 对话（Claude、OpenAI、自定义 API）
2. 飞书文档集成（读取、编辑、图片识别）
3. MCP 插件系统（可扩展第三方服务）
4. 浏览器工作区（多 tab、AI 共享页面、workflow 录制回放）
5. 会话管理与历史记录
6. 文件附件支持（图片、文档）
7. 知识库 RAG（规划中）

---

## 项目结构

```
lumos/
├── src/                      # Next.js 应用源码
│   ├── app/                  # App Router 页面
│   │   ├── api/              # API 路由
│   │   ├── chat/             # 对话页面
│   │   ├── browser/          # 浏览器工作区页面
│   │   ├── settings/         # 设置页面
│   │   └── layout.tsx        # 全局布局
│   ├── components/           # React 组件
│   │   ├── chat/             # 对话相关组件
│   │   ├── browser/          # 浏览器工作区组件
│   │   ├── layout/           # 布局组件（侧边栏、内容面板）
│   │   ├── settings/         # 设置相关组件
│   │   └── ui/               # shadcn/ui 基础组件
│   ├── lib/                  # 核心库
│   │   ├── claude-client.ts  # Claude SDK 封装
│   │   ├── chrome-mcp.ts     # Chrome DevTools MCP 集成
│   │   ├── db/               # SQLite 数据库
│   │   └── feishu/           # 飞书 API 集成
│   ├── types/                # TypeScript 类型定义
│   │   ├── browser.ts        # 浏览器 API 类型
│   │   └── electron.d.ts     # Electron IPC 类型
│   └── i18n/                 # 国际化（中英文）
├── electron/                 # Electron 主进程
│   ├── main.ts               # 应用入口
│   ├── browser/              # 浏览器管理模块
│   │   ├── browser-manager.ts      # 浏览器实例管理
│   │   ├── browser-database.ts     # 浏览器数据持久化
│   │   ├── bridge-server.ts        # WebSocket bridge 服务器
│   │   ├── cdp-manager.ts          # Chrome DevTools Protocol
│   │   ├── cookie-sync.ts          # Cookie 同步
│   │   └── mcp-environment.ts      # MCP 环境隔离
│   ├── ipc/                  # IPC 处理器
│   │   └── browser-handlers.ts     # 浏览器 IPC 处理
│   └── preload.ts            # 预加载脚本
├── public/                   # 静态资源
│   ├── skills/               # 内置 Skills
│   └── mcp-servers/          # 内置 MCP 服务器
├── scripts/                  # 构建脚本
└── .github/workflows/        # CI/CD 配置
```

---

## 浏览器工作区架构

### 核心设计原则
- **人机共享页面**：用户手动浏览和 AI 代理操作必须使用同一个 `pageId`/tab/登录态
- **统一实例管理**：所有浏览器操作通过 `BrowserManager` 统一管理，避免多路径冲突
- **Bridge 通信**：chrome-devtools MCP 通过 WebSocket bridge 与浏览器实例通信

### 关键模块

**electron/browser/browser-manager.ts**
- 管理所有浏览器 tab 的生命周期（创建、关闭、切换）
- 维护 tab 状态（URL、标题、加载状态、导航历史）
- 处理 tab 与 BrowserView 的映射关系

**electron/browser/bridge-server.ts**
- 提供 WebSocket 服务器供 MCP 连接
- 转发 CDP (Chrome DevTools Protocol) 命令到目标 tab
- 管理 MCP 会话的认证和权限

**electron/browser/browser-database.ts**
- 持久化浏览器上下文事件（导航、加载、错误、下载等）
- 存储 workflow 定义和执行结果
- 管理采集设置（保留周期、暂停状态）

**electron/browser/cookie-sync.ts**
- 同步 Electron session cookies 到 MCP 环境
- 处理敏感 cookie 的加密和权限控制
- 支持跨域 cookie 共享

**src/lib/chrome-mcp.ts**
- 封装 chrome-devtools MCP 客户端
- 提供类型安全的 CDP 命令接口
- 处理 MCP 连接状态和重连逻辑

### Workflow 系统
- **录制**：捕获用户操作（导航、点击、输入、截图）
- **参数化**：支持将固定值替换为参数（如登录凭证）
- **回放**：稳定执行 workflow，处理等待和错误重试
- **输出**：返回 `status`、`final_url`、`downloaded_files`、`screenshots`、`extracted_data`

### 上下文采集
- 只采集内置浏览器的事件，不采集系统浏览器
- 支持暂停采集、设置保留周期、清空历史
- 敏感数据（密码、token）不采集、不持久化

---

## 数据存储

### 用户数据目录
- **生产环境**：`~/.lumos/`（已从 `~/.codepilot/` 迁移）
- **开发环境**：`~/.lumos-dev/`

### 目录结构
```
~/.lumos/
├── lumos.db              # SQLite 数据库（会话、Provider、MCP 配置）
├── .claude/              # 隔离的 Claude CLI 配置
├── sessions/             # 会话数据（JSONL 历史记录）
└── uploads/              # 用户上传的文件
```

### 数据库表
- `sessions` - 会话元数据
- `api_providers` - AI Provider 配置（支持 is_builtin 和 user_modified 字段）
- `mcp_servers` - MCP 插件配置

---

## Claude CLI 隔离机制

**问题**：Lumos 内嵌 Claude CLI，如果不隔离会继承用户本地环境（`~/.claude/`），导致：
- API 密钥混用
- MCP 服务器冲突
- Skills/Hooks 污染
- 配置不可控

**解决方案**：五层隔离

### 1. 隔离配置目录
- 使用 `~/.lumos/.claude/` 而非 `~/.claude/`
- 通过 `LUMOS_CLAUDE_CONFIG_DIR` 环境变量设置
- 配置位置：
  - `electron/main.ts` line 312（生产）
  - `dev.sh` line 12（开发）

### 2. 环境变量隔离
- 启动 SDK 前清空所有 `CLAUDE_*` 和 `ANTHROPIC_*` 变量
- 只注入应用配置：
  - API key（来自 Lumos Providers）
  - Base URL（来自 Lumos Providers）
  - `CLAUDE_CONFIG_DIR`（指向隔离目录）
- 实现：`src/lib/claude-client.ts` lines 440-470

### 3. SDK Setting Sources 隔离
- `settingSources: []` 阻止 SDK 读取：
  - `~/.claude/settings.json`（用户全局设置）
  - `~/.claude.json`（用户 MCP 配置）
  - `.claude/settings.json`（项目设置）
- 所有配置必须通过代码注入
- 实现：`src/lib/claude-client.ts` line 523

### 4. MCP 服务器隔离
- 只加载 Lumos UI 中配置的 MCP 服务器
- 用户全局 MCP（`~/.claude.json`）不会加载
- 内置飞书 MCP 服务器随应用打包
- 实现：`src/app/api/plugins/mcp/route.ts`

### 5. Skills/Hooks 隔离
- `settingSources: []` 确保不加载用户 Skills/Hooks
- 应用暂不提供 Skills/Hooks UI（未来功能）
- 用户的 `~/.claude/skills/` 完全被忽略

### 验证方法
启动应用后检查日志：
```
[main] Isolated Claude config directory exists: /path/to/.lumos/.claude
[claude-client] Isolation: using config dir: /path/to/.lumos/.claude
[claude-client] Sandbox: using bundled CLI: /path/to/cli.js
```

---

## 代码规范

### 文件大小限制
- **单文件不超过 300 行**（硬性要求）
- 超过 200 行时应考虑拆分
- 每个文件只做一件事（单一职责原则）

### 命名规范
- 文件名：kebab-case（`feishu-client.ts`）
- 函数名：camelCase（`getFeishuToken`）
- 常量：UPPER_SNAKE_CASE（`MAX_FILE_SIZE`）
- 类名/组件名：PascalCase（`ChatMessage`）
- 类型/接口：PascalCase（`ApiProvider`）

### 模块组织
- 相关功能放在同一目录
- 公共代码提取到 `lib/` 或 `utils/`
- API 路由保持薄层，业务逻辑委托给 `lib/`
- 组件按功能分组（`chat/`、`settings/`）

### 禁止事项
- ❌ 单文件超过 300 行
- ❌ 函数超过 50 行
- ❌ 硬编码配置（应使用环境变量或数据库）
- ❌ 复制粘贴代码（应提取公共函数）
- ❌ 在 API 路由中写业务逻辑（应放入 `lib/`）

---

## Git 工作流

### 提交规范
- 使用 Conventional Commits 格式：`<type>: <description>`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`
- Body 中详细说明：改了什么、为什么改、影响范围
- 修复 bug 时说明根因，不只是描述现象

### 提交后自动 push
当用户要求提交代码时，commit 完成后自动执行 `git push`，无需额外确认

### 发版纪律
**禁止自动发版**：代码提交可以正常进行，但推送 tag 必须等待用户明确指示"发版"或"发布"

---

## 发版流程

### 版本号管理
1. 更新 `package.json` 的 `version` 字段
2. 运行 `npm install` 同步 `package-lock.json`
3. 提交代码并推送到 `main` 分支

### CI 自动构建
4. 创建并推送 tag：`git tag v{版本号} && git push origin v{版本号}`
5. CI 自动触发（`.github/workflows/build.yml`）：
   - macOS / Windows / Linux 并行构建
   - 收集产物：DMG、exe、AppImage、deb、rpm
   - 自动创建 GitHub Release 并上传
6. 在 Release 页面补充更新说明

### 注意事项
- **不要手动创建 GitHub Release**（会与 CI 冲突）
- 本地测试打包：`npm run electron:pack:mac`（不要上传）
- 查看 CI 状态：`gh run list`
- 重试失败任务：`gh run rerun <id> --failed`

---

## 开发规范

### 提交前必须测试
- 充分测试所有改动的功能，确认无回归
- UI 改动需实际启动应用验证（`npm run dev` 或 `npm run electron:dev`）
- 构建改动需完整执行打包流程验证
- 多平台改动需考虑平台差异

### 新功能前必须调研
- 充分调研技术方案、API 兼容性、最佳实践
- Electron API 需确认版本支持
- 第三方库需确认依赖兼容性
- Claude SDK 需确认实际支持的功能
- 不确定的技术点先做 POC，不要直接试错

---

## 构建说明

### 产物
- **macOS**：DMG（arm64 + x64 universal）
- **Windows**：NSIS 安装包 / zip
- **Linux**：AppImage、deb、rpm

### 原生模块处理
- `scripts/after-pack.js` 会在打包时重编译 `better-sqlite3` 为 Electron ABI
- 构建前清理：`rm -rf release/ .next/`
- 构建 Windows 包后恢复开发环境：`npm rebuild better-sqlite3`

### 跨平台构建
- macOS 交叉编译 Windows 需要 Wine（Apple Silicon 可能不可用）
- 可用 zip 替代 NSIS 安装包

---

## 飞书集成

### API 配置
- 需要飞书应用的 `appId` 和 `appSecret`
- 文档需要授权给应用才能访问
- `tenant_access_token` 自动缓存，提前 5 分钟刷新

### 功能支持
- ✅ 读取文档内容（文本、表格、代码块）
- ✅ 图片识别（下载后转 base64 发送给 Claude）
- ✅ 编辑文档块
- ✅ 追加内容到文档末尾
- ❌ 飞书画板（API 不支持，需手动导出为图片）

---

## 环境变量

### 生产环境
```bash
LUMOS_DATA_DIR=~/.lumos                    # 数据目录
LUMOS_CLAUDE_CONFIG_DIR=~/.lumos/.claude   # Claude CLI 配置
```

### 开发环境
```bash
LUMOS_DATA_DIR=~/.lumos-dev
LUMOS_CLAUDE_CONFIG_DIR=~/.lumos-dev/.claude
```

### 向后兼容
应用会自动检测旧环境变量（`CODEPILOT_*`、`CLAUDE_GUI_*`）并迁移数据

---

## 本地参考项目

为便于分析与实现对照，本机已拉取以下参考仓库：
- craft-agents-oss: `/Users/op7418/Documents/code/资料/craft-agents-oss`
- opencode: `/Users/op7418/Documents/code/资料/opencode`

---

## Release Notes 规范

标题：`Lumos v{版本号}`

正文必须包含：
- **New Features** - 新功能列表
- **Bug Fixes** - 修复的问题
- **Downloads** - 各平台安装包说明
- **Installation** - 安装步骤
- **Requirements** - 系统要求
- **Changelog** - commit 列表

---

## 已知问题与解决方案

### 1. 数据库路径迁移
**问题**：从 CodePilot 升级到 Lumos 后找不到数据库
**解决**：应用启动时自动检测 `~/.codepilot/codepilot.db` 并复制到 `~/.lumos/lumos.db`

### 2. 飞书画板无法读取
**问题**：飞书画板（block_type 43）只返回 token，API 不支持获取内容
**解决**：手动导出为图片后上传识别，或在画板下方用文字描述

### 3. Claude CLI 会话管理
**问题**：每次对话都是独立的，没有上下文
**解决**：使用 `--continue` 参数保持会话上下文

---

## 未来规划

### Phase 1：知识库功能
- 数据层：collections、items、chunks、bm25_index 表
- 文档解析：Word/Excel/PDF/Markdown 导入
- 混合搜索：向量检索 + BM25
- UI：知识库管理界面

### Phase 2：Tiptap 编辑器
- 富文本编辑（标题、列表、表格、代码块）
- AI 工具栏（润色/续写/翻译/总结）
- 斜杠命令（`/ai 帮我...`）

### Phase 3：UI 改版
- 文档中心布局（参考 Notion/语雀）
- 左侧导航：文档/对话/知识库/扩展/设置
- 卡片式文档列表

详见：`~/.claude/plans/splendid-stargazing-treehouse.md`
