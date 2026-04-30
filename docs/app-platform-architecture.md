# Lumos 应用平台 — 架构设计（落地版）

**状态**：Draft v1
**日期**：2026-04-30
**分支**：`spec/app-platform`
**关联文档**：
- [`app-platform-design.md`](./app-platform-design.md)（总体设计）
- [`app-platform-ai-builder.md`](./app-platform-ai-builder.md)（AI 创建器）
- [`app-platform-requirements.md`](./app-platform-requirements.md)（需求调研）

本文档把总体设计的"分层框图"落到 lumos 当前代码结构上。**覆盖 MVP（平台基础 M0-M3 + AI 创建器 B0-B7 + workflow 转换）能直接动工的部分**，不重复总体设计已有内容。

**MVP 范围补充**：v1 不内置任何示例应用，应用全部由用户用 AI 创建器或 workflow 转换创造；不做代码应用、市场、商业化、web 端。

---

## 1. 落点：现有代码结构与新增模块

### 1.1 现有相关代码

| 路径 | 现状 | 与应用平台的关系 |
|---|---|---|
| `src/lib/workflow/runtime.ts` | Workflow V2 执行引擎 | 应用执行 workflow 通过它调用，需注入 `app_id` 上下文 |
| `src/lib/workflow/api.ts` | Workflow CRUD + 触发 API | 应用 SDK `runWorkflow` 内部转调 |
| `src/lib/claude/sdk-runtime.ts` | Claude Agent SDK 单例运行时 | AI 创建器 agent 复用此运行时 |
| `src/lib/mcp-resolver.ts` | MCP server 解析与启动 | 应用 manifest `requires.mcp` 校验、运行时注入 |
| `src/lib/db/migrations.ts` + `migrations-lumos.ts` | 现有 SQLite 迁移 | 新增应用相关表挂这里 |
| `src/lib/db/connection.ts` | DB 单例 | 应用 data-store 走同一连接池 |
| `src/components/settings/WorkflowBuilderLLMSection.tsx` | Workflow 构建器 LLM 配置 | 模板复制为 `AppBuilderLLMSection.tsx`（v1 必含） |
| `src/app/workflow/page.tsx` | Workflow 列表页 | 加"保存为应用"按钮（M2） |
| `src/lib/runtime-resources.ts`（未提交） | 运行时资源 manifest | Schema 文件随该机制打包到客户端 |

### 1.2 新增目录结构（MVP）

```
docs/
├── app-platform-design.md            # 已有
├── app-platform-ai-builder.md        # 已有
├── app-platform-requirements.md      # 本分支新增
└── app-platform-architecture.md      # 本文档

resources/app-schemas/                # M0 新增（随客户端打包）
├── app.schema.json                   # app.json 的 JSON Schema
├── routes.schema.json
├── page.schema.json
├── data-schema.schema.json
└── workflow-ref.schema.json

src/lib/app/                          # M1 新增 — 应用平台核心
├── manifest/
│   ├── parser.ts                     # 解析 + ajv 校验
│   ├── validator.ts                  # 跨文件一致性校验
│   ├── types.ts                      # TypeScript 类型（从 schema 生成）
│   └── __tests__/
├── installer/
│   ├── install.ts                    # 安装：解压 → 校验 → 注册
│   ├── uninstall.ts
│   ├── pack.ts                       # 打包 .lumos-app（M2 用）
│   └── update.ts                     # 占位（M7）
├── runtime/
│   ├── route-registry.ts             # 应用路由注册到 Lumos
│   ├── context.ts                    # 应用执行上下文（app_id 注入）
│   ├── data-store.ts                 # 应用专属数据 CRUD（强制 app_id）
│   ├── permission-gate.ts            # 运行时权限拦截
│   ├── secret-vault.ts               # secret config 加密存取
│   └── trigger-manager.ts            # 应用 cron / event 触发
├── sdk-host/                         # M6 才完整实现，M1 只暴露最小 IPC
│   ├── ipc-router.ts
│   └── api-handlers/
│       ├── run-workflow.ts
│       ├── db.ts
│       └── nav.ts
├── workflow-promote/                 # workflow → app 一键转换
│   └── promote.ts
├── builder/                          # AI 创建器（v1 必含）
│   ├── agent.ts                      # AppBuilder Agent 实例化（复用 sdk-runtime）
│   ├── system-prompt.ts              # 角色 + 输出契约 + 设计模式（静态部分）
│   ├── capabilities.ts               # list_capabilities 实现：探测当前 MCP/Agent/工具
│   ├── session.ts                    # 创建器会话状态机
│   ├── needs-summary.ts              # 阶段 1 需求摘要生成与维护
│   ├── stage-pipeline.ts             # 阶段 1-6 流水线编排
│   ├── tools/                        # AppBuilder Agent 的工具集
│   │   ├── read-schema.ts
│   │   ├── list-capabilities.ts
│   │   ├── query-user.ts
│   │   ├── generate-manifest.ts
│   │   ├── generate-routes.ts
│   │   ├── generate-page.ts
│   │   ├── generate-workflow.ts
│   │   ├── generate-data-schema.ts
│   │   ├── validate-app.ts
│   │   ├── preview-page.ts
│   │   ├── install-app.ts
│   │   ├── update-app-file.ts
│   │   └── get-app-state.ts
│   ├── self-repair.ts                # 自检自修循环（最多 3 次）
│   ├── templates/                    # 模板库加载与裁剪（B5）
│   │   ├── registry.ts
│   │   └── apply.ts
│   └── __tests__/
└── __tests__/

src/components/app/                   # MVP 新增 — 渲染器与 UI
├── container/
│   ├── AppContainer.tsx              # 应用主容器
│   ├── AppSidebar.tsx                # 应用内菜单
│   └── AppHeader.tsx
├── declarative/
│   ├── PageRenderer.tsx              # 顶层 page 渲染器
│   ├── BindingResolver.ts            # {{ db.x }} 模板求值
│   ├── EventDispatcher.ts            # workflow:/db: 事件分发
│   ├── layouts/
│   │   ├── SingleLayout.tsx
│   │   ├── ListDetailLayout.tsx
│   │   ├── FormLayout.tsx
│   │   └── ResultLayout.tsx
│   ├── mock-data.ts                  # 创建器预览用：依据 data-schema 生成假数据
│   └── widgets/                      # 内置 ~15 个组件
│       ├── form/                     # text/textarea/select/checkbox/...
│       ├── display/                  # markdown/table/tag/...
│       ├── action/                   # button/dialog/confirm
│       └── data/                     # form/list/...
├── install-flow/
│   ├── InstallDialog.tsx             # 安装时权限确认
│   └── PermissionList.tsx
├── manage/
│   ├── AppListPage.tsx               # /apps
│   ├── AppDetailPage.tsx
│   └── AppSettingsPage.tsx
└── builder/                          # AI 创建器 UI（双面板）
    ├── BuilderPage.tsx               # /apps/create 主页面
    ├── ChatPanel.tsx                 # 左：对话流
    ├── PreviewPanel.tsx              # 右：文件树 + 预览
    ├── FileTree.tsx
    ├── PreviewRenderer.tsx           # JSON 高亮 / page 实时渲染 / diff
    ├── DiffView.tsx
    └── TemplatePicker.tsx

src/app/apps/                         # MVP 新增 — Next.js 路由
├── page.tsx                          # 应用列表
├── create/page.tsx                   # AI 创建器入口（双面板）
├── [id]/
│   ├── page.tsx                      # 应用入口（包 AppContainer）
│   └── settings/page.tsx
└── manage/page.tsx                   # 应用管理

src/app/api/apps/                     # MVP 新增 — Next.js API
├── route.ts                          # GET 列表 / POST 安装（上传 .lumos-app）
├── [id]/
│   ├── route.ts                      # GET 详情 / DELETE 卸载
│   ├── run/route.ts                  # 应用触发 workflow
│   ├── data/route.ts                 # 应用数据 CRUD（受 app_id 限制）
│   ├── config/route.ts
│   └── permissions/route.ts
├── validate/route.ts                 # manifest 校验工具
└── builder/                          # AI 创建器 API
    ├── sessions/route.ts             # POST 新会话 / GET 列表
    ├── sessions/[id]/route.ts        # 详情 / 删除
    ├── sessions/[id]/messages/route.ts  # 流式对话
    └── templates/route.ts            # 模板列表

src/lib/db/migrations-app.ts          # MVP 新增 — 应用相关表迁移

resources/app-templates/              # AI 创建器模板库（B5）
├── crm/
├── content-generator/
├── document-analyzer/
├── chatbot-with-kb/
├── data-pipeline/
├── monitor-dashboard/
└── ...                               # 共 10-20 个

src/components/settings/AppBuilderLLMSection.tsx  # AI 创建器 LLM 配置
```

### 1.3 暂不创建的目录（明确推后）

- `src/lib/app/sdk-host/` 仅放最小 IPC 骨架，完整实现等 M6（代码应用）
- `@lumos/app-sdk/` 独立 npm 包推到 M6
- `cli/` 用 npm script 简化版即可，独立包推到 M7（应用市场）
- `resources/builtin-apps/` **v1 不创建**，用户用 AI 创建器自己造

---

## 2. 数据库设计与迁移

### 2.1 与总体设计第 11 节的差异

总体设计给的 schema 整体可用。本文档**只补充落地细节**：

1. 表名前缀统一 `lumos_app_`（避免与现有 `apps` 之类名字冲突，先 grep 检查）
2. 加 `previous_version` / `previous_install_path` 列，配合 9 决策（版本回滚）
3. 加 `metrics_json` 到 `app_runs`（Q7 性能监控）
4. 加 `synced_at INTEGER NULL` 预留同步（Q9）
5. JSON 列统一用 `TEXT` + 应用层校验，不依赖 SQLite JSON 函数（更稳）

### 2.2 迁移文件位置

新增 `src/lib/db/migrations-app.ts`，模仿现有 `migrations-team-run.ts` 模式：

```ts
import Database from 'better-sqlite3';

export function migrateAppTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lumos_app_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      previous_version TEXT,
      manifest_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('builtin','local','market','ai-generated','workflow-promoted')),
      source_meta_json TEXT,
      install_path TEXT NOT NULL,
      previous_install_path TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      last_used_at INTEGER,
      size_bytes INTEGER,
      synced_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lumos_app_configs (
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_encrypted TEXT NOT NULL,    -- 所有 value 都过 secret-vault（即使非 secret），统一接口
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, key),
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_permissions (
      app_id TEXT NOT NULL,
      permission TEXT NOT NULL,         -- 规范见 §3.4
      granted INTEGER NOT NULL,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, permission),
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_data (
      app_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, collection, id),
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lumos_app_data_collection
      ON lumos_app_data(app_id, collection, updated_at DESC);

    CREATE TABLE IF NOT EXISTS lumos_app_runs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      page_id TEXT,
      workflow_id TEXT,
      workflow_run_id TEXT,
      triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual','schedule','event')),
      input_json TEXT,
      output_json TEXT,
      metrics_json TEXT,
      status TEXT NOT NULL CHECK (status IN ('running','success','failed','cancelled')),
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      error_message TEXT,
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lumos_app_runs_app
      ON lumos_app_runs(app_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS lumos_app_triggers (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('schedule','event')),
      config_json TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    -- AI 创建器：会话
    CREATE TABLE IF NOT EXISTS lumos_app_builder_sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('gathering','generating','installed','iterating','failed')),
      needs_summary_json TEXT,
      app_id TEXT,                    -- 安装后填
      template_id TEXT,               -- 起手用的模板（可空）
      llm_model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- AI 创建器：对话消息
    CREATE TABLE IF NOT EXISTS lumos_app_builder_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
      content_json TEXT NOT NULL,
      tool_name TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES lumos_app_builder_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lumos_app_builder_msgs
      ON lumos_app_builder_messages(session_id, created_at);

    -- AI 创建器：生成的文件（每次迭代是一版）
    CREATE TABLE IF NOT EXISTS lumos_app_builder_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,        -- 相对应用根
      content TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','committed','rolled_back')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES lumos_app_builder_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lumos_app_builder_artifacts
      ON lumos_app_builder_artifacts(session_id, file_path, version DESC);
  `);
}
```

注册到 `src/lib/db/index.ts` 现有的迁移调用链中。

### 2.3 数据隔离保证

`src/lib/app/runtime/data-store.ts` 是访问 `lumos_app_data` 的**唯一**入口，签名：

```ts
export function createAppDataStore(appId: string) {
  return {
    query(collection, filter): rows where app_id = appId AND collection = ...
    get(collection, id): row where app_id = appId AND ...
    create(collection, data): INSERT 强制 app_id = appId
    update(collection, id, patch): UPDATE 强制 app_id = appId
    delete(collection, id): DELETE 强制 app_id = appId
  }
}
```

ESLint rule（自定义 + Grep 兜底）禁止其他文件直接 SELECT/INSERT `lumos_app_data` 表。CI 加单测：跨 app_id 注入尝试必须返回 0 行。

---

## 3. Manifest Schema（M0 交付）

### 3.1 顶层结构

```
.lumos-app/
├── app.json                # 必须
├── routes.json             # 必须
├── pages/*.json            # 必须 ≥ 1 个
├── workflows/*.json        # 可选
├── data-schema.json        # 可选
├── components/*.tsx        # M6 才用
├── locales/*.json          # 可选
├── assets/*                # 可选
└── icon.png                # 必须，512x512
```

### 3.2 `app.json` Schema 关键字段

总体设计第 4.1 节给了示例。M0 Schema 定义关键收紧：

- `id`: pattern `^[a-z][a-z0-9-]{2,63}$`（kebab-case，3-64 字符）
- `version`: pattern `^\\d+\\.\\d+\\.\\d+(-[\\w.]+)?$`（semver）
- `requires.mcp`: array of string，必须是当前已注册 MCP server 的 id（运行时校验）
- `requires.tools`: enum `["bash", "python", "file", "web-fetch"]`（封闭集合）
- `permissions.network.mode`: enum `["disabled", "whitelist"]`（**没有 `*`**）
- `permissions.network.domains`: array of string，每个 string pattern 限定（不允许通配符）
- `permissions.filesystem.read/write`: array of string，必须以 `~/` 或 `/Users/.../lumos-app-{id}` 开头（运行时变量替换）
- `permissions.data`: enum `["isolated", "shared"]`（v1 强制 isolated，shared 字段保留但安装时拒绝）

### 3.3 跨文件一致性校验（`validator.ts`）

ajv 之外，单独实现：

1. `routes.menu[].page` 引用的 page 文件必须存在
2. `routes.menu[].component` 引用的 .tsx 必须存在（M6+）
3. 所有 page 中 `run: "workflow:xxx"` 引用的 workflow 必须在 `workflows/` 内
4. workflow 步骤里调的 MCP / tools 必须在 `app.json` 声明范围内
5. `{{ db.xxx.field }}` 引用的 collection 必须在 `data-schema.json` 定义
6. `data-schema` 中 indexed 字段类型不能是 `text > 1KB` / `binary`
7. icon 必须是 PNG、512x512、< 100KB

校验失败返回结构化错误：

```ts
type ValidationIssue = {
  level: 'error' | 'warning';
  file: string;
  jsonPath: string;
  message: string;
  hint?: string;
};
```

**为什么结构化**：AI 创建器（v1 必含）拿到 issue 数组直接回灌给 LLM 自修，不用解析自然语言。

### 3.4 权限标识规范

`lumos_app_permissions.permission` 列的字符串规范：

| 形式 | 示例 |
|---|---|
| `fs.read:<path>` | `fs.read:~/Documents/customers` |
| `fs.write:<path>` | `fs.write:~/Downloads/lumos-app-{id}` |
| `net:<domain>` | `net:open.feishu.cn` |
| `mcp:<server>` | `mcp:feishu` |
| `mcp.tool:<server>:<tool>` | `mcp.tool:feishu:send_message`（细粒度，v1 不强制） |
| `tool:<name>` | `tool:bash`, `tool:python` |
| `system:<cap>` | `system:notification`, `system:schedule` |
| `data:shared` | （v3+） |

权限拦截器（`permission-gate.ts`）以这个字符串为 key 查询 `granted` 标志。

---

## 4. 渲染器设计（M1 实现要点）

### 4.1 数据绑定（`BindingResolver.ts`）

模板语法 `{{ <namespace>.<expr> }}`，命名空间已在总体设计第 5.1.3 节列出。M1 实现：

- **解析**：用简单正则 + 栈式解析（不引入 mustache 等库，保持轻量）
- **求值**：每个命名空间挂一个 resolver；`db.customers.where('status','active')` 解析为 `dataStore.query('customers', {status:'active'})`
- **响应式**：基于 React `useSyncExternalStore` + `dataStore.subscribe`，db 变更触发组件重渲染
- **沙箱**：表达式不允许 `(`/`)` 之外的方法调用——显式白名单 `where / orderBy / limit / count`

**性能**：
- 模板字符串编译为函数，缓存到 `pageJson` ID 映射
- 大列表用虚拟滚动（react-virtual）
- 数据订阅按 collection 粒度，避免单条变更触发全列表重渲

### 4.2 事件分发（`EventDispatcher.ts`）

事件 DSL 字符串解析：

```
workflow:<id> [+ inputs]   → src/lib/workflow/api.ts 启动 run，标记 app_id
db:create:<collection>     → dataStore.create
db:update:<collection>     → dataStore.update
db:delete:<collection>     → dataStore.delete + confirm? 弹窗
page:<id>                  → router.push
dialog:<id>                → 内部 dialog 状态机
```

错误处理：所有事件包一层 `try/catch` → toast + 写 `app_runs` 表。

### 4.3 内置组件（M1 必含 15 个）

精简清单（覆盖 90% MVP 场景）：

- **form**: text, textarea, select, checkbox, switch, file
- **display**: markdown, table, tag, badge
- **action**: button, link, dialog, confirm
- **container**: card

每个组件单独文件 + `__tests__/`，限定 props（不允许"扩展任意属性"）。组件注册表：

```ts
export const widgetRegistry: Record<string, ComponentDef> = {
  text: { component: TextInput, schema: textInputSchema },
  ...
};
```

`PageRenderer.tsx` 根据 JSON 的 `type` 字段查表渲染。

---

## 5. Workflow 与 App 集成

### 5.1 调用路径（详细）

```
[用户在应用里点 button.run="workflow:analyze"]
    ↓
EventDispatcher.dispatch("workflow:analyze", inputs)
    ↓
src/lib/app/runtime/context.ts → buildAppRunContext(appId, pageId, inputs)
    ↓ 注入 { appId, allowedTools, allowedMcps, dataStore, secretsResolver }
    ↓
src/lib/workflow/api.ts → startWorkflowRun(workflowId, inputs, ctx)
    ↓
src/lib/workflow/runtime.ts 现有引擎执行
    ↓ 每个 step 执行前检查 ctx.allowedTools / allowedMcps
    ↓ MCP 调用走 mcp-resolver，拒绝未声明 server
    ↓ secret 引用 {{ config.feishu_token }} 由 secretsResolver 注入
    ↓
执行结果 → app_runs 表记录 → resolve Promise → 页面渲染 result
```

### 5.2 Workflow runtime 需要新增的入口

`src/lib/workflow/api.ts` 加：

```ts
export async function startWorkflowRunInAppContext(
  workflowDoc: WorkflowDocV2,
  input: Record<string, unknown>,
  appCtx: AppRunContext,
): Promise<WorkflowRunHandle>
```

不是改现有 API，加 sibling，避免影响现有 workflow 单独运行的链路。

### 5.3 Workflow → App 提升（M2）

`src/lib/app/workflow-promote/promote.ts`：

```ts
export async function promoteWorkflowToApp(
  workflowId: string,
  meta: { name, description, icon, category },
): Promise<{ appPath: string }>
```

实现步骤：
1. 读 workflow doc
2. 推断 inputs schema → 生成 form 字段（pages/main.json）
3. 推断 outputs → 生成 result 渲染
4. 复制 workflow 到 `workflows/main.json`
5. 推断需要的 MCP / tools → 写 `app.json.requires`
6. 默认权限：仅声明检测到的；网络/fs 让用户在 UI 二次确认
7. 打包到 `~/.lumos/apps/{id}/`

---

## 6. 安装/卸载实现要点

### 6.1 安装流程（`installer/install.ts`）

```ts
async function installApp(source: { type: 'file'|'builtin'|'url', ... }): Promise<InstalledApp> {
  // 1. 解压到临时目录
  const tmpDir = await unpack(source);
  // 2. 校验 manifest
  const manifest = await parser.parse(tmpDir);
  const validation = await validator.validate(tmpDir, manifest);
  if (!validation.ok) throw new InstallError(validation.issues);
  // 3. 检查 id 冲突
  const existing = await db.getApp(manifest.id);
  if (existing && existing.version === manifest.version) throw new ConflictError();
  // 4. 弹安装确认 UI（IPC → 渲染进程）
  const userConsent = await requestPermissionConsent(manifest.permissions);
  if (!userConsent) { cleanup(tmpDir); throw new UserCancelled(); }
  // 5. 原子移动到 ~/.lumos/apps/{id}/{version}/
  const installPath = await atomicMove(tmpDir, manifest.id, manifest.version);
  // 6. 版本回滚预留：旧版本不删，DB 记 previous_install_path
  if (existing) await retainPreviousVersion(existing);
  // 7. 注册到 DB
  await db.upsertApp({ ...manifest, installPath, source });
  await db.upsertPermissions(manifest.id, userConsent.granted);
  // 8. 创建 data collections
  await dataStore.ensureSchema(manifest.id, manifest.dataSchema);
  // 9. 注册 triggers
  await triggerManager.register(manifest.id, manifest.triggers);
  return { appId: manifest.id, ... };
}
```

幂等性：每步失败有 cleanup；用 SQLite 事务包 step 7-9。

### 6.2 卸载流程

```ts
async function uninstallApp(appId: string, opts: { keepData: boolean }) {
  await triggerManager.unregister(appId);
  await db.deleteApp(appId);  // FK CASCADE 删 configs/permissions/triggers/runs
  if (!opts.keepData) await dataStore.deleteAllForApp(appId);
  await fs.rm(installPath, { recursive: true });
}
```

### 6.3 应用来源

v1 应用三个合法来源（写入 `lumos_app_apps.source`）：

| source | 来源 | 触发 |
|---|---|---|
| `ai-generated` | AI 创建器生成 | 创建器会话 commit 时调用 `install.ts` |
| `workflow-promoted` | 现有 workflow 转换 | workflow 详情页"保存为应用"按钮 |
| `local` | 用户从 .lumos-app 文件导入 | 应用列表"安装本地包"按钮 |

`builtin` 与 `market` 在 schema 中保留，**v1 不使用**。

---

## 7. 安全实现细节

### 7.1 权限拦截点

| 入口 | 拦截位置 |
|---|---|
| 应用 SDK `db.*` | `data-store.ts` 强制 app_id |
| 应用 SDK `runWorkflow` | `permission-gate` 检查 manifest 是否声明此 workflow id |
| Workflow step → MCP 调用 | `mcp-resolver` 加 hook：`if (ctx.appId) checkAllowed('mcp:'+server)` |
| Workflow step → tool 执行 | `tool-runner` 同上 |
| 应用 SDK `fetch` | M6 才有；通过代理 host 校验 |
| 应用 SDK `fs.*` | M6 才有；路径前缀白名单 |

### 7.2 Secret 存取（`secret-vault.ts`）

- 加密算法：AES-256-GCM，key 由本机派生（macOS Keychain / Windows DPAPI / Linux libsecret，复用 lumos 现有 `src/lib/auth/` 中的 OS keyring 抽象）
- secret 配置项：用户输入后立即加密入 DB；解密只在主进程内；渲染进程拿不到原文
- workflow step 中 `{{ config.x_secret }}` 模板替换由 `secretsResolver` 在主进程完成

### 7.3 沙箱（M6 才完整，M1 仅声明式无沙箱压力）

M1 阶段所有渲染都是声明式 JSON → 内置 React 组件，没有用户代码执行风险。仅需做：

- JSON 解析容量限制（单文件 < 1MB）
- 模板表达式禁用 `eval` / 函数调用（白名单方法）
- markdown 组件用 sanitize（DOMPurify），禁止 `<script>` / `on*` 事件

M6 加代码应用时再补：worker_threads 隔离 + 模块白名单（已记录在 §1.3 占位）。

---

## 8. IPC / API 层设计（M1）

### 8.1 Next.js API（HTTP）

为渲染进程内（页面）提供，走 Next.js route handler：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/apps` | 列表 |
| POST | `/api/apps` | 上传安装（multipart .lumos-app） |
| GET | `/api/apps/:id` | 详情 |
| DELETE | `/api/apps/:id` | 卸载 |
| POST | `/api/apps/:id/run` | 触发 workflow（带 page_id, inputs） |
| GET/POST/DELETE | `/api/apps/:id/data` | 应用数据（强制 app_id 校验） |
| GET/POST | `/api/apps/:id/config` | 配置 |
| POST | `/api/apps/validate` | manifest 校验工具（开发者用） |

### 8.2 Electron IPC（主进程能力）

| Channel | 方向 | 用途 |
|---|---|---|
| `app:install` | R→M | 文件系统操作（解压/原子移动） |
| `app:uninstall` | R→M | 文件系统清理 |
| `app:list-apps` | R→M | 读 DB |
| `app:request-consent` | M→R | 主进程要弹权限确认对话框 |
| `app:secret.set` / `.get` | R→M | secret 加解密只在主进程 |

主/渲染进程职责切分：
- **主进程**：DB 写、文件系统、加密、MCP 调用、workflow 执行
- **渲染进程**：UI 渲染、声明式模板求值、组件交互

---

## 9. 测试策略

### 9.1 必须的测试（M1 出口）

- **manifest-parser/validator**：每个 schema 字段正/负 case，覆盖 ≥ 90%
- **跨文件一致性**：构造 5 类不一致样本（缺失引用、循环依赖等）必须挡下
- **data-store**：跨 app_id 注入测试（fuzz）
- **install/uninstall**：失败回滚（解压成功但权限拒绝、DB 写失败但文件已 move 等）
- **renderer**：snapshot 测试 4 个 layout × 5 种数据形态
- **workflow 集成**：mock workflow，验证 app context 注入和权限拦截
- **e2e（平台基础）**：Playwright 跑"装 fixture 应用 → 跑一次交互 → 卸载"完整链路
- **e2e（AI 创建器）**：mock LLM replay → "需求描述 → 生成 → 安装 → 第一次交互"全链路

### 9.2 Dogfooding 与回归

v1 不内置示例应用。回归测试用 **fixture manifest**（不含 git 主线，仅在 `__tests__/fixtures/` 下）覆盖 4 种设计模式 × 各 1 个，CI 跑：

- 安装 fixture → 校验数据表创建 → 跑一次模拟交互 → 卸载 → 验证清理干净
- AI 创建器以确定性 mock LLM（录制的真实响应 replay）跑端到端：从需求描述 → 生成 → 安装

真实 dogfooding 由用户（产品/owner）用 AI 创建器手动跑，不进 CI。

---

## 10. 性能与监控

### 10.1 关键性能指标

| 指标 | 目标 | 监控点 |
|---|---|---|
| 应用容器冷启动 | ≤ 500ms | Performance.mark 渲染过程 |
| Page render（首屏）| ≤ 200ms | RUM |
| Workflow 启动延迟（应用 → API → 引擎）| ≤ 100ms | api log |
| 数据查询（小集合 < 1000 行）| ≤ 50ms | data-store |
| Manifest 校验 | ≤ 200ms | parser |

### 10.2 埋点

- `app_runs.metrics_json` 记录每次执行的：duration、token 用量、最大内存、错误位置
- 每个声明式组件 useEffect 上加 render time 采样（生产模式抽样 1%）

---

## 11. 推进里程碑

MVP 由两条并行线组成：**平台基础线**（M0-M3）与 **AI 创建器线**（B0-B7）。前者提供"应用怎么跑"，后者提供"应用怎么造"。两条线在第 1 周共享 M0（Schema 定稿），之后并行推进，第 8-10 周首次集成（B1 落到 M1 上跑通），第 14-19 周整体完成 MVP。

### 11.1 平台基础线

#### M0（Schema 定稿，1 周，两条线共享）

- [ ] 评审 `app-platform-requirements.md` + `app-platform-architecture.md`（本 PR）
- [ ] 起草 `resources/app-schemas/*.schema.json` 5 个文件
- [ ] 用 5 个 mock manifest 验证 schema（覆盖 4 种模式 + 1 个反例）
- [ ] `migrations-app.ts` review + merge
- [ ] AppBuilder system prompt 草稿 + 工具集签名评审

#### M1（基础架构，4-6 周）

| Week | 任务 |
|---|---|
| 1 | `manifest/parser.ts` + `validator.ts` + 单测 |
| 2 | `installer/install.ts` + `uninstall.ts` + `runtime/data-store.ts` + 主进程 IPC handlers |
| 3 | `runtime/context.ts` + `permission-gate.ts` + workflow API 接入点 |
| 4 | 渲染器骨架（`PageRenderer` + `BindingResolver` + 4 layout） |
| 5 | 15 个内置 widget + 安装确认 UI |
| 6 | 应用列表 / 设置页 / 卸载流 + fixture e2e |

**M1 出口**：手写一个 fixture manifest 能装能跑能卸（不依赖 AI 创建器）。

#### M2（Workflow → 应用一键转换，1-2 周）

- `workflow-promote/promote.ts`
- Workflow 详情页加"保存为应用"按钮 + 元信息弹窗
- 简易 CLI（npm script）：`pack` / `validate`

#### M3（声明式 UI 完整化，3-4 周，与 AI 创建器后期并行）

- 补齐总体设计第 5.1.2 节列出的全部 ~30 个组件（M1 的 15 个之外）
- 补齐 layout 相关：tabs / accordion / wizard
- 数据绑定方法补全：where / orderBy / limit / count
- 性能优化：虚拟滚动、selector 化重渲

### 11.2 AI 创建器线（B0-B7）

完整设计见 `app-platform-ai-builder.md`。落地节奏：

| 阶段 | 周次 | 范围 | 依赖 | 出口 |
|---|---|---|---|---|
| **B0 能力探测** | W1（与 M0 并行） | `capabilities.ts` + system prompt 动态注入 | 无 | AppBuilder Agent 启动时拿到当前 Lumos 真实能力清单 |
| **B1 单文件应用生成** | W3-W5（M1 进行中） | tools/ 全套 + 模式 1（输入-处理-输出）流水线 | M1 的 parser/validator 可用 | 生成最简 form+button+result 应用，能落盘但暂不安装 |
| **B1 集成** | W6（M1 出口后） | install_app 工具接 M1 的安装器 | M1 完成 | **第一次端到端 dogfooding：用嘴说造一个简单应用并跑通** |
| **B2 完整流程** | W7-W10 | 4 种设计模式全覆盖、阶段 1-5 流水线 | M1 渲染器 4 layout 就位 | 任意常见业务应用能生成 |
| **B3 实时预览** | W8-W10（与 B2 并行） | 双面板 UI、流式渲染、mock 数据 | M1 渲染器 | 用户边聊边看页面 |
| **B4 增量迭代** | W11-W12 | 改动定位 + update_app_file + diff 显示 | B2/B3 | 装完后对话改应用 |
| **B5 模板库** | W13-W15 | 10-20 个内置模板 + 类比已有应用 | B2 | 冷启动加速 |
| **B6 自检自修** | W13-W14（与 B5 并行） | validate_app 错误回灌 + 3 次重试 | B2 | 失败收敛 |
| **B7 用户保存模板** | W16 | 用户造的应用可"保存为模板" | B5 | 模板库可生长 |

### 11.3 总体时间线

```
W1     M0 Schema + B0 能力探测
W2-6   M1 平台基础 ──────────┐
W3-5         B1 单文件生成（与 M1 并行开发）
W6           B1 + M1 集成 → 第一次端到端 dogfooding ★
W7-8   M2 workflow 转换
W7-10        B2 + B3 完整生成 + 实时预览
W9-12  M3 声明式 UI 完整化（与 AI 线后期并行）
W11-12       B4 增量迭代
W13-15       B5 模板库 + B6 自检自修
W16          B7 模板保存 → MVP 整体完成 ★★
```

**关键内部里程碑**：
- W6（约 1.5 个月后）：**第一次端到端 dogfooding**——能用嘴造出简单应用
- W16（约 4 个月后）：**MVP 整体完成**——AI 创建器 4 种模式全覆盖 + 模板库 + 自修

### 11.4 风险与应对

- **B1 提前依赖 M1**：W6 集成点是关键里程碑。如果 M1 延期，B1 可先用本地落盘验收（不安装），不阻塞 B2 启动
- **AI 生成质量在 B2 落地前不可知**：W7 启动 B2 时如果发现 mock 测试不达标，立即把 LLM 模型从 Sonnet 切到 Opus（决策已在 ai-builder 第 14 节）
- **模板库 B5 工作量被低估的风险**：模板库是脚手架不是完整应用，每个模板控制在 200 行 JSON 内

---

## 12. 与其他正在进行的特性的协调

当前 lumos 仓库存在多个并行 spec/task 分支（见 git branches）：

| 分支 | 协调点 |
|---|---|
| `task/202-main-agent-team-foundation` | 应用可声明 `requires.agentTeams`，等 main-agent-team 落定后定接口 |
| `feature/browser-provider` | 应用 manifest `requires.browser` 字段预留；M3+ 才实际接入 |
| `spec/knowledge-cards-graph` | 应用 SDK `knowledge.search` 等 knowledge 模块定型后再实现 |
| `task/203-knowledge-import-fixes` | 不直接影响应用平台，但应用使用知识库前需此分支稳定 |

策略：本分支**不依赖**上述任何分支落地；预留接口字段，集成等对方稳定后跟进。

---

## 13. 总结

本架构设计的核心选择：

1. **MVP 含完整 AI 创建器**：B0-B7 与平台基础并行开发，第 6 周首次端到端 dogfooding，第 16 周 MVP 完成
2. **不内置示例应用**：第一批应用全部由用户用 AI 创建器或 workflow 转换创造
3. **数据强隔离**：单一 data-store 入口 + DB 强 app_id 约束 + 自动测试覆盖
4. **权限模型统一**：workflow 步骤的 tool/MCP 检查与应用 manifest 共用一张权限表
5. **不重写已有引擎**：workflow / MCP / Claude SDK / DB 全复用，只加 app_id 上下文
6. **代码应用 / 市场 / 商业化全部后置**：M6+/M7+ 再做，MVP 阶段架构留口子但不实现

下一步：本分支 PR 评审通过后，启动 M0（Schema 定稿 + B0 能力探测，1 周）。
