# Lumos 应用平台 — 交接状态（spec/app-platform）

**截至日期**：2026-04-30
**分支**：`spec/app-platform`（在 lumos repo 上）
**Worktree**：`/Users/zhangjun/私藏/lumos-应用` 是这个分支的工作树（git worktree），与 `lumos` 主目录共享 `.git`
**作者**：Claude Opus 4.7
**接手人**：Codex

---

## 0. 一分钟摘要

**已完成**：M0 + M1 全部 + M2 + M4 B0 + M4 B1 的工具集 + 持久化层 + UI 框架 + UX 重设计。
**未完成**：M4 B2（Claude SDK 接入，让 AI 真的会说话和生成文件），其后 B3-B7、M3。
**测试**：343 / 343 passing；`tsc --noEmit` 干净。
**端到端**：从「`/apps` 列表 → +新建应用 → 名字+描述 → builder 详情页」全活；安装本地 .lumos-app 包全活；workflow→app 转换全活。**唯一缺的是 AI 真说话**（目前是 mock echo）。

---

## 1. 仓库状态

```bash
# 工作树
/Users/zhangjun/私藏/lumos                # 主目录，main 分支
/Users/zhangjun/私藏/lumos-应用            # 我们的 worktree，spec/app-platform

# 命令
cd /Users/zhangjun/私藏/lumos-应用
git log --oneline                         # 19 个 commit on top of main
npx jest src/lib/app src/components/app   # 343 passing
npx tsc --noEmit                          # clean
npm run dev                               # 起 Next.js dev server
```

**worktree 自带独立 `node_modules`**（不是 symlink，约 2.7GB）。如果空间紧张可改回 symlink，但要确保 `ajv@^8.17.1` `ajv-formats` `jszip` `@types/jszip` 在主目录的 deps 里。

**已有不相关的未提交修改**（lumos main 留下来的 WIP，不属于我们）：
- `AGENTS.md`、`src/lib/claude-client.ts` 等 9 个修改 + 几个未跟踪文件
- 这些不要 commit 到 spec/app-platform 分支

---

## 2. Commit 历史（19 个）

```
375ccb1b  redesign creation flow — name+desc dialog → app detail   ← 最新
4fcc8469  wire 应用 entry into Lumos sidebar + top-bar
80946825  M4 B1 — builder API routes + dual-pane creator UI
e7cfecc9  M4 B1 — session store + self-repair decision engine
2ab3d3bb  M4 B1 — AppBuilder tool set (11 tools)
bcd40703  M4 B0 — AppBuilder capability probe + system prompt
f509bac2  M2 — workflow → app promotion + CLI
5fe54c2c  finish M1 — assets route + real bridge + consent flow
3d0e1054  M1 Week 6 — Next.js API routes + app list page
3bf25180  M1 Week 4-5 — declarative page renderer + widgets
6d3f8c6c  M1 Week 3 — runtime context, permission gate, bindings
85fd913b  M1 Week 2 — installer, uninstaller, packer, triggers
afb1b509  secret cryptor + vault for encrypted app config
d31c5f10  fix: preserve user data on app uninstall by default
b1380703  app data store with strict app_id isolation
2c03aa83  M1 Week 1 — manifest parser & validator
8fa8bcd8  docs: original design + ai-builder drafts into branch
654cffb6  M0 schema definitions, db migration, tests
294ff4f6  docs: requirements + architecture
```

149 文件 / 19,722 行新增，全部都在仓库的 `src/lib/app/`、`src/components/app/`、`src/app/apps/`、`src/app/api/apps/`、`electron/app-platform/`、`resources/app-schemas/`、`docs/` 几个新目录下。原 lumos 代码只动了 4 处：

- `src/lib/db/schema.ts` — 加了一行调用 `migrateAppTables(db)`
- `src/lib/db/index.ts` — re-export `migrateAppTables`
- `src/components/layout/sidebar.tsx` — 加「应用」侧栏入口
- `src/components/layout/top-bar.tsx` — 加 `/apps` 面包屑

---

## 3. 文档（4 份）

```
docs/app-platform-design.md           — 总体设计（22KB，原始草稿，未改）
docs/app-platform-ai-builder.md       — AI 创建器设计（23KB，原始草稿，未改）
docs/app-platform-requirements.md     — 需求调研（决策点 + 用户故事，我写的）
docs/app-platform-architecture.md     — 架构落地（具体到 lumos 代码路径，我写的）
docs/app-platform-handoff.md          — 本文档
```

读这 5 份就基本掌握了产品意图和当前实现的对应关系。

---

## 4. 当前用户可点开的链路

### 4.1 应用列表 `/apps`

- 顶部两个按钮：**[+ 新建应用]** 和 **[导入本地包…]**
- 卡片网格：草稿（虚线边框 + "草稿"标签，点"继续编辑"）+ 已安装应用（点"打开"）
- 卸载 / 删除草稿都活的

### 4.2 新建应用流程

1. 点 [+ 新建应用]
2. 弹窗输入：**应用名**（必填，≤64）+ **描述**（可选，≤500）
3. 提交 → POST `/api/apps/builder/sessions` → 创建 session（持久化在 `lumos_app_builder_sessions`）
4. 跳转到 `/apps/builder/[sessionId]`

### 4.3 应用详情/构建工作台 `/apps/builder/[sessionId]`

- **顶部**：← 返回 / 应用名 / 状态徽标（"收集需求 · 草稿"）/ 描述 / [删除] [保存并安装]
- **左侧 70%**：tabs `预览` / `文件` / `设置`
  - 预览：M4 B3 才上线，目前显示占位
  - 文件：列出当前 artifacts（每个文件版本号 + status + 内容预览）
  - 设置：应用元信息 + 会话 ID + 已生成文件数
- **右侧 30%**：AI 对话面板
  - 消息流（user / assistant / tool 三种气泡风格不同）
  - 输入框，⌘/Ctrl+Enter 发送
  - **目前**：发出去后端 API 持久化用户消息，然后 mock 一条 assistant 回复（说"AI 接入是 M4 B2"）
  - **B2 要做**：把 mock 替换成真的 Claude SDK 调用，跑工具循环

### 4.4 安装应用 `/apps/[appId]`

已安装应用从这里打开 — 这条链路完全活的：
- 拉 `/api/apps/[id]` 拿 manifest
- 拉 `/api/apps/[id]/assets/routes.json`、`pages/*.json` 拿 UI
- 渲染 AppContainer + PageRenderer
- 表单 / 列表-详情 / 单页 / 结果四种 layout、14 个 widget 都活的
- `db.*` 绑定走 `/api/apps/[id]/data` 真持久化
- `workflow:*` 事件走 `/api/apps/[id]/run` —— 当前返回 503（M3 未做）

### 4.5 安装本地 .lumos-app 包

- 点 [导入本地包…] 选文件
- 后端校验 manifest → 如果需要授权 → `InstallDialog` 弹窗按风险等级勾选权限
- 点确认 → 第二次 POST 带 consent → 安装成功 → 列表刷新

---

## 5. 文件清单（按职责分组）

### 5.1 数据库 + 服务层
```
src/lib/db/migrations-app.ts                 — 9 张 lumos_app_* 表 + 索引
src/lib/db/__tests__/migrations-app.test.ts
src/lib/app/service.ts                        — getAppPlatformService() 单例
electron/app-platform/secret-cryptor-electron.ts — Electron safeStorage 实现
```

### 5.2 Schema（M0）
```
resources/app-schemas/app.schema.json
resources/app-schemas/routes.schema.json
resources/app-schemas/page.schema.json
resources/app-schemas/data-schema.schema.json
resources/app-schemas/workflow-ref.schema.json
src/lib/app/__tests__/app-schemas.test.ts
```

### 5.3 Manifest 解析与校验（M1 W1）
```
src/lib/app/manifest/types.ts
src/lib/app/manifest/ajv-instance.ts
src/lib/app/manifest/parser.ts
src/lib/app/manifest/validator.ts
src/lib/app/manifest/index.ts
src/lib/app/manifest/__tests__/{parser,validator}.test.ts
src/lib/app/manifest/__tests__/fixtures/×6      — 6 个 fixture 应用包
```

### 5.4 运行时核心（M1 W3）
```
src/lib/app/runtime/data-store.ts         — app_id 强隔离的数据 CRUD
src/lib/app/runtime/secret-cryptor.ts     — AES-GCM 软件版 + 接口（生产用 Electron safeStorage）
src/lib/app/runtime/secret-vault.ts       — config 持久化（全部加密）
src/lib/app/runtime/trigger-manager.ts    — schedule/event 触发器存储
src/lib/app/runtime/permission-gate.ts    — 运行时权限拦截
src/lib/app/runtime/binding-resolver.ts   — {{ namespace.expr }} 模板求值
src/lib/app/runtime/context.ts            — buildAppRunContext()
src/lib/app/runtime/workflow-bridge.ts    — M3 契约 + stub 实现
src/lib/app/runtime/index.ts              — 公共导出
```

### 5.5 安装器（M1 W2 + 收尾）
```
src/lib/app/installer/permissions.ts      — 派生权限 + 风险等级
src/lib/app/installer/install.ts          — 安装流程 + sanitizeZipPath
src/lib/app/installer/uninstall.ts
src/lib/app/installer/pack.ts             — 目录 → .lumos-app
src/lib/app/installer/asset-resolver.ts   — 资源路径安全解析
src/lib/app/installer/types.ts
src/lib/app/installer/index.ts
```

### 5.6 渲染器（M1 W4-5）
```
src/components/app/container/AppContainer.tsx
src/components/app/container/AppSidebar.tsx
src/components/app/declarative/PageRenderer.tsx
src/components/app/declarative/WidgetRenderer.tsx
src/components/app/declarative/event-dispatcher.ts
src/components/app/declarative/dispatch.ts
src/components/app/declarative/bridge.ts
src/components/app/declarative/api-bridge.ts
src/components/app/declarative/binding-context.tsx
src/components/app/declarative/page-collector.ts
src/components/app/declarative/layouts/×4         — Single/Form/ListDetail/Result
src/components/app/declarative/widgets/×11        — 14 个组件
src/components/app/install-flow/InstallDialog.tsx
```

### 5.7 Workflow 转应用（M2）
```
src/lib/app/workflow-promote/promote.ts
src/app/api/apps/promote/route.ts
scripts/lumos-app.mjs                      — CLI: validate / pack
```

### 5.8 AI 创建器（M4 B0+B1）
```
src/lib/app/builder/capabilities.ts        — 探测 lumos 当前能力
src/lib/app/builder/system-prompt.ts       — 5 段动态注入的系统 prompt
src/lib/app/builder/session.ts             — 会话/消息/版本化 artifact 持久化
src/lib/app/builder/self-repair.ts         — 自检循环决策（最多 3 次重试）
src/lib/app/builder/tools/                 — 11 个工具（pure TS）
  ├─ types.ts                               — ToolDefinition / ToolResult / ok / err
  ├─ read-schema.ts
  ├─ list-capabilities.ts
  ├─ generate.ts                            — 5 个 generate_* 工具
  ├─ validate-app.ts
  ├─ install-app.ts
  ├─ update-app-file.ts
  ├─ get-app-state.ts
  └─ index.ts                               — buildToolRegistry(deps)
```

### 5.9 API 路由
```
src/app/api/apps/route.ts                            — GET 列表（含 drafts） / POST 安装
src/app/api/apps/[id]/route.ts                        — GET 详情 / DELETE 卸载
src/app/api/apps/[id]/data/route.ts                   — 应用数据 CRUD
src/app/api/apps/[id]/config/route.ts                 — 配置 CRUD
src/app/api/apps/[id]/run/route.ts                    — 工作流触发（503 stub）
src/app/api/apps/[id]/assets/[...path]/route.ts       — 静态资源
src/app/api/apps/promote/route.ts                     — workflow 一键转应用
src/app/api/apps/validate/route.ts                    — 包校验工具
src/app/api/apps/builder/sessions/route.ts            — 会话 CRUD
src/app/api/apps/builder/sessions/[id]/route.ts
src/app/api/apps/builder/sessions/[id]/messages/route.ts
src/app/api/apps/builder/sessions/[id]/artifacts/route.ts
```

### 5.10 页面
```
src/app/apps/page.tsx                            — 列表 + 新建对话框
src/app/apps/builder/[sessionId]/page.tsx        — 应用工作台（双面板）
src/app/apps/[id]/page.tsx                        — 已安装应用入口
```

---

## 6. 测试矩阵（343 / 343 passing）

按文件：
- `migrations-app.test.ts` (9)
- `app-schemas.test.ts` (26)
- `manifest/parser.test.ts` (9) + `validator.test.ts` (14)
- `runtime/data-store.test.ts` (17)
- `runtime/secret-cryptor.test.ts` (9) + `secret-vault.test.ts` (19)
- `runtime/trigger-manager.test.ts` (10)
- `runtime/permission-gate.test.ts` (20)
- `runtime/binding-resolver.test.ts` (24)
- `runtime/context.test.ts` (12)
- `installer/install.test.ts` (12) + `uninstall.test.ts` (5) + `pack.test.ts` (5)
- `installer/permissions.test.ts` (12) + `sanitize-zip-path.test.ts` (8)
- `installer/asset-resolver.test.ts` (24)
- `workflow-promote/promote.test.ts` (14)
- `builder/capabilities.test.ts` (10) + `system-prompt.test.ts` (11)
- `builder/session.test.ts` (18) + `self-repair.test.ts` (10)
- `builder/tools/tools.test.ts` (26)
- `declarative/event-dispatcher.test.ts` (21) + `page-collector.test.ts` (4)

按类型：纯 TS 逻辑全单测；React 组件靠 typecheck（lumos 项目的 jest 只跑 `*.test.ts`，不跑 `*.test.tsx`，所以 UI 不写 jest 单测，等 e2e 用 Playwright）。

---

## 7. 下一个最重要的任务：M4 B2（Claude SDK 接入）

这是让 AI 创建器从"骨架"变成"活的"的关键一步。**当前的 mock**：

`src/app/apps/builder/[sessionId]/page.tsx` line ~110:
```ts
// Mock assistant echo until the Claude SDK bridge lands (M4 B2).
await fetch(`/api/apps/builder/sessions/${sessionId}/messages`, {
  method: 'POST',
  body: JSON.stringify({ role: 'assistant', content: 'AI 创建器目前还在接入 Claude SDK…' }),
});
```

### 7.1 需要做什么

把"用户发消息 → 立即 mock 回复"换成：

1. 用户消息入库（已经在做）
2. **新增一个流式端点** `POST /api/apps/builder/sessions/[id]/run`：
   - 收到请求后，加载历史消息（`store.listMessages`）
   - 加载当前 artifacts（`store.getCurrentArtifacts`）
   - 构造 system prompt（`buildAppBuilderSystemPrompt(probeCapabilities(db, ...))`）
   - 通过 lumos 的 `buildClaudeSdkInvocationContext` + Claude Agent SDK 启动一轮对话
   - 把 `buildToolRegistry(deps)` 的工具喂给 SDK
   - 流式返回 SSE 事件：`{ type: 'message', ... }` / `{ type: 'tool_use', ... }` / `{ type: 'tool_result', ... }` / `{ type: 'done' }`
   - 每个事件**也写入** `lumos_app_builder_messages`（角色 user/assistant/tool）和 `lumos_app_builder_artifacts`（每次 generate_* / install_app 成功）
3. 前端 `/apps/builder/[sessionId]/page.tsx`：
   - 点发送后改成读 SSE 流
   - 流中 `tool_use: generate_page` → 显示"正在生成 pages/main.json…"
   - 流中 `tool_result` 含 artifact → 立刻刷新右侧文件列表
   - 完成后 refresh 一次取最终状态

### 7.2 关键集成点（lumos 已有的）

```
src/lib/claude/sdk-runtime.ts
  - buildClaudeSdkRuntimeBootstrap(options)
  - buildClaudeSdkInvocationContext(...)

src/lib/claude-client.ts (line ~413)
  - 现有的 chat 调用走它，可以参考调用 SDK 的姿势

src/lib/team-run/stage-worker.ts (line ~482)
  - 另一个 SDK 集成的范例
```

我们已经有：
- `buildToolRegistry(deps)` 返回 `ToolDefinition[]` —— 但 ToolDefinition 是我们的格式，需要适配 Claude tool-use 的格式（name + description + input_schema + 一个执行 callback）。lumos 的 SDK 应该有相应的 Tool 类型。
- `buildAppBuilderSystemPrompt(capabilities)` 返回字符串 —— 直接喂 system prompt
- `createSessionStore(db)` 持久化 —— agent loop 跑的时候每个 turn 都 append message + 工具结果

### 7.3 推荐实施顺序

1. **先看 `src/lib/claude/sdk-runtime.ts` 和 `claude-client.ts`** —— 摸清 lumos 怎么调 Claude SDK，包括 Provider 配置、模型默认值、token 上限、流式输出协议
2. **写一个 `src/lib/app/builder/agent-runtime.ts`** —— 单个函数 `runAgentTurn(sessionId, userMessage)`：
   - 加载历史 + system prompt + tools
   - 启动 Claude Agent SDK
   - 处理 tool_use 事件 → 调对应 ToolDefinition.execute → 返回结果给 SDK
   - 流式产出事件（用 ReadableStream 或类似）
3. **写 SSE 端点** `src/app/api/apps/builder/sessions/[id]/run/route.ts`
4. **改 `/apps/builder/[sessionId]/page.tsx`** 用 EventSource 消费
5. **加自检循环**：当 generate_* 返回 SchemaInvalid，调 `decideRepair` 决定是否重试，重试时把 issues 反馈给 Claude（renderRepairPrompt）

### 7.4 设计决策需要你拍

- **默认模型**：lumos 有 chat / reasoning / fast 三档；AI 创建器用哪个？我倾向 reasoning（Claude Opus），ai-builder 设计文档第 14.2 节也是这么写的
- **Provider 配置位置**：是在 lumos 全局 settings 里加一个 `provider_override:app-builder` 字段（参照 `provider_override:workflow`）？还是用一个全局默认？
- **Token 预算上限**：单次 run 是否要硬限？建议有
- **失败重试**：除了 schema 自修，应该也包含 LLM 端的 transient 错误（rate limit, network）

---

## 8. 其他待办（按优先级）

### 8.1 M4 B3 — 实时预览
当前 `/apps/builder/[sessionId]` 的"预览"标签是占位。要把当前 artifacts 在内存里组装成一个虚拟的 `ParsedApp`，喂给 `PageRenderer`，配合 mock 数据填充 db.* 绑定。
关键文件：要新建 `src/components/app/declarative/draft-preview.tsx`，复用 `binding-context.tsx` 的 `bindingContextFromSnapshot`。

### 8.2 M4 B4 — 增量迭代 + diff
artifact 已经版本化（`saveArtifact` 自动 bump version），缺的是：
- 文件 tab 上点版本切换
- 显示新旧版本 diff（推荐用 lumos 已有的 streamdown 或 react-diff-viewer，看用哪个不冲突）
- "回滚到上一版"按钮 → 调 `store.rollbackArtifact`

### 8.3 M4 B5 — 模板库
计划目录：`resources/app-templates/{crm,content-generator,document-analyzer,chatbot-with-kb,monitor-dashboard,...}/`，每个含 `description.md` + `prompt-hints.md` + 部分填空的 manifest。
新建对话框需要加"从模板开始"选项。

### 8.4 M4 B6 — 自检循环 UI
后端逻辑已就绪（`self-repair.ts` 全套），只是没接到 agent runtime。B2 完成后，B6 是把"尝试 1/3 失败，重试中…"这种状态展示到对话面板。

### 8.5 M4 B7 — 保存为模板
草稿成功安装后，加一个"另存为模板"按钮 → 把当前 artifacts 写到 `resources/app-templates/<id>/`。要决定模板存哪儿（用户级 vs 全局）。

### 8.6 M3 — workflow-bridge 实装
当前 `/api/apps/[id]/run` 返回 503。要做的事：
- 读 app 的 `workflows/<id>.json`（已存为 V3 直通格式）
- 用 lumos 的 `compiler-v3-*` 编译为可执行 JS
- 调 `submitWorkflow`，注入 AppRunContext（permission gate 钩进 mcp-resolver / tool-runner）
- 流式返回 step events
契约已经在 `src/lib/app/runtime/workflow-bridge.ts` 定好了；只要替换 stub 即可。

### 8.7 资源更新提示
应用安装目录下的 `routes.json` / `pages/*.json` 在 update_app_file 改了之后，AppContainer 需要重新拉。当前是 `Cache-Control: no-store`，但前端有自己的 useState 缓存。要在 update 成功后通知 `/apps/[id]` 页面刷新（可以用 Next.js revalidate 或 simple polling）。

---

## 9. 架构里的硬约束（不要违反）

1. **数据隔离**：`lumos_app_data` 表**没有外键**指向 `lumos_app_apps`。卸载默认保留数据。所有 data 操作必须走 `createAppDataStore(db, appId)`，**禁止**在其他文件里直接 SELECT/INSERT/DELETE 这张表。
2. **路径安全**：任何接受相对路径的入口都要走 `resolveAssetPath`（资源读）或 `sanitizeZipPath`（zip 解压）或 `update-app-file.ts` 里那套同款检查。`components/`、`.history/`、`.git/`、`node_modules/` 永远拒绝。
3. **secret 不出站**：`/api/apps/[id]/config` GET 对 `is_secret = 1` 的项绝对不返回 value（只返 metadata）。`SecretVault.resolveAll()` 只能在主进程内用，注释里说得很死。
4. **权限 snapshot**：`PermissionGate` 是构造时快照，**不会**反映之后的授权变化。授权改了就得 `createPermissionGate(db, appId)` 重新建一个。
5. **schema 是受信源**：所有 manifest 验证都通过 `resources/app-schemas/*.schema.json` + ajv。改 schema 要同步改类型 (`src/lib/app/manifest/types.ts`)。
6. **drafts 是 sessions**：草稿应用没有 `lumos_app_apps` 行，只是 `lumos_app_builder_sessions` 里 `app_id IS NULL` 的会话。装上后 session.app_id 才被设上。
7. **CLI 用 esbuild bundle**：`scripts/lumos-app.mjs` 启动时 esbuild bundle TS 文件 + ESM banner shim `__dirname` + `LUMOS_APP_SCHEMA_DIR` 环境变量找 schema。改这块要小心 path resolution。
8. **lumos main 不要碰**：所有改动尽量在新文件里。已有原代码改动只有 4 处（schema.ts、index.ts、sidebar.tsx、top-bar.tsx），都是最小入口注册。

---

## 10. 已知 gotcha

1. **node_modules 是独立的**（不是 symlink），所以 `npm install` 在 lumos 主目录加的依赖不会自动出现在 worktree 里。要么在 lumos 主目录装好后改 `lumos-应用/package.json` 跟着走 + worktree 内 `npm install`，要么改回 symlink。
2. **3 个 lumos main 已有的测试是失败状态**（`migrations-core.test.ts`、`tasks-team-plan.test.ts`、`migrations-team-run.test.ts`），跟我们无关，是 ts-jest 解析某个 ESM-only 包的旧问题。**不要管**。
3. **scripts/lumos-app.mjs 第一次跑会编译 TS**（约 1-2 秒）。CI 跑的话可能慢点，但 dev 流程没影响。
4. **icon.png 在 fixture 里是文本占位符**（`PNG_PLACEHOLDER`）—— 不是真 PNG。当前 validator 只检查存在 + 大小，不查格式。要做严格 PNG 校验需要在 installer 加 magic bytes 检查。
5. **WorkflowBridge 是 stub**，调用会抛 `WorkflowBridgeNotReadyError`。目前 `/api/apps/[id]/run` 直接返 503 不调 bridge，所以不会真的抛出来。
6. **i18n key 没加**：sidebar / top-bar 里的"应用"是硬编码字符串（跟 workflow / 任务 / 团队 一样的处理），如果 lumos 后续做完整 i18n，需要补 key。
7. **InstallDialog 的高风险权限默认不勾**（只勾 safe + moderate）。这是有意的安全保守，但如果用户体验觉得别扭可以调整 `InstallDialog.tsx` 里的 `useEffect` 默认值。
8. **流程没接 e2e 测试**。Playwright 配置在 `playwright.config.ts` 里，可以加 `tests/e2e/app-platform.spec.ts`。

---

## 11. Quick Reference

```bash
# 进入工作树
cd /Users/zhangjun/私藏/lumos-应用

# 起 dev server（注意 lumos 主目录可能也要起，看你项目怎么配的）
npm run dev

# 跑测试
npx jest src/lib/app src/components/app src/lib/db/__tests__/migrations-app.test.ts

# typecheck
npx tsc --noEmit

# lint（pre-commit hook 会自动跑）
npm run lint

# CLI 工具（开发者用）
npm run lumos-app -- validate src/lib/app/manifest/__tests__/fixtures/valid-form-tool
npm run lumos-app -- pack <dir> <out.lumos-app>

# 重要 API（用 curl 试）
curl http://localhost:3000/api/apps                          # 列表（含 drafts）
curl -X POST http://localhost:3000/api/apps/builder/sessions \
  -H 'Content-Type: application/json' \
  -d '{"appName":"测试","appDescription":"hello"}'             # 创建会话
curl http://localhost:3000/api/apps/builder/sessions/<id>     # 详情
```

---

## 12. 一句话给 codex 的建议

**最值得先做的**：M4 B2（Claude SDK 接入）。架构、工具、持久化、UI 全都已经就绪，只差一个 `runAgentTurn` 函数把 lumos 的 SDK 跟我们的 ToolDefinition[] 桥起来。所有我提到的"mock"在仓库里都用 `M4 B2` 标记了 grep 一下就找得到。
