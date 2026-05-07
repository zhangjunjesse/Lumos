# Lumos 应用平台设计文档

**状态**：Draft v1
**日期**：2026-04-30
**范围**：Lumos 桌面端应用模块（Apps）

---

## 1. 背景与定位

### 1.1 现状

Lumos 当前已具备的能力：

- **AI 对话**：多模型、Provider 解析
- **工作流**：DSL 编排、调度、Agent 团队
- **MCP 插件**：内置 + 第三方
- **知识库**：BM25 + 向量混合检索
- **浏览器自动化**：内置 Chromium + CDP
- **Office 文档**：纯 Node.js 处理 Excel/Word/PDF/PPT

这些能力是**原料**，但缺少一个**产品化打包形态**——把"针对某个场景的完整解决方案"作为一个对象沉淀、分发、复用。

### 1.2 应用模块要解决的问题

1. **场景固化**：把高频场景（周报、合同审查、客户管理）打包成开箱即用的产品
2. **降低门槛**：用户不用拼工具、写 DSL，点开就用
3. **AI 协助创建**：用户用对话描述需求，AI 生成应用
4. **生态扩展**：开发者发布应用，用户安装/付费/评价
5. **沉淀路径**：对话自动化 → 工作流 → 应用，价值逐级凝固

### 1.3 设计目标

- **普通用户**：开箱即用，不需要懂 workflow / MCP
- **AI 协助**：用户用嘴说，AI 生成应用
- **进阶用户**：把自己的工作流一键提升为应用
- **开发者**：能写复杂代码应用，能发布到市场
- **平台**：分发、审核、版本、商业化

---

## 2. 产品定位

### 2.1 应用 vs 工作流 vs 自动化

三者**不冗余、按需求形态分**：

| 维度 | 应用 | 工作流 | 自动化 |
|---|---|---|---|
| **形态** | 完整产品（含 UI + 数据） | 流程编排 | 一次性 ad-hoc 任务 |
| **触发** | 用户点开 / 定时 / 事件 | 定时 / 事件 / 手动 | 对话即时触发 |
| **谁建** | Lumos / 第三方 / AI 帮用户 | 用户自己搭 | AI 临时拼 |
| **谁用** | 普通用户开箱即用 | 进阶用户 | 普通用户 |
| **生命周期** | 安装—长期使用 | 重复运行 | 用一次扔 |
| **复杂度** | 高（多页面+状态） | 中（单一流程） | 低（单步骤） |

### 2.2 三者关系

- **应用底层用工作流引擎**——不重新造轮子，应用的每个流程步骤就是一个 workflow
- **自动化不做独立模块**——它是"对话里临时跑的工作流"，作为聊天能力存在
- **沉淀路径**：用户在对话里 ad-hoc 跑（自动化）→ 高频后保存为工作流（自定义重复）→ 通用化打包成应用（产品化分发）

### 2.3 与现有模块的关系

- ✅ **复用 Workflow 引擎**：应用的流程步骤 = workflow run
- ✅ **复用 MCP 系统**：应用通过 manifest 声明依赖的 MCP
- ✅ **复用知识库**：通过 SDK 访问指定 collection
- ✅ **复用 Agent 团队**：应用可声明使用某个 agent
- ➕ **新增 App Runtime**：manifest 解析、UI 渲染器、SDK Host、生命周期管理
- ➕ **新增 App SDK**：给代码应用调用 Lumos 能力的统一接口

---

## 3. 应用形态

### 3.1 物理形态

应用是一个**文件夹/zip 包**，文件后缀 `.lumos-app`。

安装即解压到 `~/.lumos/apps/{id}/`，卸载即删除该目录 + 数据库记录。

### 3.2 标准目录结构

```
my-app.lumos-app/
├── app.json              # 应用元信息 + 依赖 + 权限声明
├── routes.json           # 应用菜单 + 路由
├── pages/                # 声明式页面（JSON）
│   ├── home.json
│   ├── customers.json
│   └── settings.json
├── components/           # 自定义代码页面（React，可选）
│   └── Whiteboard.tsx
├── workflows/            # 应用内置工作流
│   ├── analyze.json
│   └── notify.json
├── data-schema.json      # 应用专属数据表 schema（可选）
├── assets/               # 静态资源
│   └── logo.svg
├── locales/              # 多语言文案（可选）
│   ├── zh-CN.json
│   └── en-US.json
└── icon.png              # 应用图标（必须，512x512）
```

### 3.3 类比

Lumos 应用 ≈ **微信小程序** 在 Lumos 上的等价物：

| 项 | 微信小程序 | Lumos 应用 |
|---|---|---|
| 宿主 | 微信 | Lumos |
| 描述格式 | wxml + json | ui.json + app.json |
| 复杂 UI | 写 wxml/wxss/js | 写 React 组件 |
| 平台能力 | 微信 API（支付/分享/位置） | Lumos API（agent/workflow/MCP/知识库） |
| 分发 | 微信小程序市场 | Lumos 应用市场 |

---

## 4. Manifest 规范

### 4.1 app.json

应用的元信息和契约声明。AI 生成器、市场审核、权限管理都基于这个文件。

```json
{
  "$schema": "https://lumos.io/schemas/app.v1.json",

  "id": "weekly-report-helper",
  "name": "周报助手",
  "version": "1.0.0",
  "description": "自动生成本周工作总结，同步到飞书",
  "author": "zhangjun",
  "icon": "./icon.png",
  "category": "office",
  "tags": ["周报", "总结", "飞书"],

  "entry": "main",

  "requires": {
    "lumos": ">=1.0.0",
    "mcp": ["feishu", "office-docs"],
    "tools": ["bash", "python"],
    "llm": "chat",
    "knowledge": "optional"
  },

  "permissions": {
    "filesystem": {
      "read": ["~/Documents/work-logs"],
      "write": ["~/Downloads/lumos-app-{id}"]
    },
    "network": {
      "mode": "whitelist",
      "domains": ["open.feishu.cn"]
    },
    "data": "isolated",
    "system": ["notification", "schedule"]
  },

  "config": [
    {
      "key": "feishu_app_id",
      "label": "飞书 App ID",
      "type": "string",
      "required": true,
      "secret": true
    },
    {
      "key": "report_template",
      "label": "周报模板",
      "type": "textarea",
      "default": "## 本周完成\n## 下周计划"
    }
  ],

  "triggers": [
    { "type": "manual" },
    {
      "type": "schedule",
      "cron": "0 17 * * 5",
      "workflow": "generate"
    }
  ]
}
```

### 4.2 routes.json

应用菜单 + 路由表。决定了应用打开后用户看到的导航。

```json
{
  "menu": [
    {
      "id": "home",
      "label": "首页",
      "icon": "home",
      "page": "pages/home.json"
    },
    {
      "id": "customers",
      "label": "客户",
      "icon": "users",
      "page": "pages/customers.json",
      "badge": "{{db.customers.count}}"
    },
    {
      "id": "whiteboard",
      "label": "白板",
      "icon": "edit",
      "component": "components/Whiteboard"
    }
  ],
  "default": "home"
}
```

**关键设计**：菜单项可挂 `page`（声明式 JSON）或 `component`（代码组件），两者平等并列。

### 4.3 pages/*.json

每一页的 UI 描述。详见第 5 节。

### 4.4 workflows/*.json

复用现有的 Workflow DSL（V2）。应用启动一个流程时，调用的就是这里的工作流。

```json
{
  "id": "generate-report",
  "name": "生成周报",
  "version": 2,
  "steps": [
    {
      "id": "agent-write",
      "type": "agent",
      "agent": "worker",
      "prompt": "根据用户输入生成周报：{{ inputs.completed }}",
      "tools": ["python"]
    },
    {
      "id": "push-feishu",
      "type": "agent",
      "agent": "integration",
      "prompt": "调用 feishu MCP 把以下内容写入文档：{{ steps['agent-write'].output }}"
    }
  ]
}
```

### 4.5 data-schema.json（可选）

应用专属数据表的 schema。用于声明式 CRUD 和 list-detail 页面。

```json
{
  "collections": [
    {
      "name": "customers",
      "fields": [
        { "name": "id", "type": "uuid", "primary": true },
        { "name": "name", "type": "string", "required": true, "indexed": true },
        { "name": "phone", "type": "string" },
        { "name": "status", "type": "enum", "options": ["active", "inactive"] },
        { "name": "createdAt", "type": "datetime", "auto": "now" }
      ],
      "indexes": [["status", "createdAt"]]
    }
  ]
}
```

---

## 5. 页面体系

### 5.1 声明式页面（Schema-driven UI）

#### 5.1.1 原理

JSON 描述结构 + 字段 → Lumos 内置渲染器（基于 shadcn/ui） → 输出 React 页面。

学名：**Schema-driven UI**，业界成熟模式（react-jsonschema-form、Formily、微信小程序、Notion、Retool 等都用）。

#### 5.1.2 内置组件清单（v1 必须支持）

| 类别 | 组件 |
|---|---|
| **输入** | text, textarea, select, multiselect, radio, checkbox, switch, file, image-upload, date, datetime, number, slider, color, code-editor |
| **容器** | card, tabs, accordion, group, columns, wizard |
| **展示** | markdown, table, list, chart, tag, image, video, code, json-viewer, tree |
| **交互** | button, link, dialog, drawer, dropdown, tooltip, confirm |
| **数据流** | form, search, filter, pagination, sort |
| **高级** | chat（聊天界面）, kanban, calendar, timeline |
| **布局** | layout: single \| list-detail \| grid \| split |

约 30 个组件覆盖 90%+ 应用场景。

#### 5.1.3 数据绑定

模板语法 `{{ ... }}`，访问以下命名空间：

- `{{ db.collection.field }}` — 应用数据库
- `{{ state.xxx }}` — 应用状态（持久化）
- `{{ config.xxx }}` — 用户配置（来自 app.json 的 config）
- `{{ inputs.xxx }}` — 当前页面表单输入
- `{{ steps.id.output }}` — 工作流步骤输出
- `{{ user.xxx }}` — 当前用户信息

#### 5.1.4 事件触发

`run`、`open`、`call` 三类动作，统一字符串 DSL：

- `workflow:id` — 跑工作流
- `agent:id` — 直接问 agent
- `page:id` — 跳转页面
- `dialog:id` — 弹对话框
- `db:create:collection` / `db:update` / `db:delete` — 数据操作
- `mcp:server:tool` — 直接调 MCP 工具

#### 5.1.5 完整页面示例（客户列表+详情）

`pages/customers.json`：

```json
{
  "title": "客户列表",
  "layout": "list-detail",

  "list": {
    "type": "table",
    "data": "{{ db.customers }}",
    "columns": [
      { "field": "name", "label": "姓名", "sortable": true, "search": true },
      { "field": "phone", "label": "电话" },
      { "field": "status", "label": "状态", "render": "tag" },
      { "field": "createdAt", "label": "创建时间", "render": "date" }
    ],
    "filter": [
      { "field": "status", "options": ["active", "inactive"] }
    ],
    "actions": {
      "row": [
        { "label": "查看", "open": "detail" },
        { "label": "AI 客户洞察", "run": "workflow:analyze-customer" },
        { "label": "删除", "run": "db:delete:customers", "confirm": true }
      ],
      "toolbar": [
        { "label": "新增", "open": "form:create", "primary": true },
        { "label": "批量导入", "open": "dialog:import" }
      ]
    }
  },

  "detail": {
    "tabs": [
      {
        "label": "资料",
        "view": {
          "form": [
            { "type": "text", "name": "name", "label": "姓名", "required": true },
            { "type": "text", "name": "phone", "label": "电话" },
            { "type": "select", "name": "status", "options": ["active", "inactive"] }
          ],
          "submit": { "label": "保存", "run": "db:update:customers" }
        }
      },
      {
        "label": "订单历史",
        "view": {
          "type": "table",
          "data": "{{ db.orders.where('customerId', detail.id) }}"
        }
      },
      {
        "label": "AI 洞察",
        "view": {
          "type": "result",
          "run": "workflow:analyze-customer",
          "input": { "customerId": "{{ detail.id }}" },
          "render": "markdown"
        }
      }
    ]
  }
}
```

### 5.2 代码页面（React 组件）

#### 5.2.1 何时使用

- 自由画布（白板、思维导图编辑器）
- 像素级动画 / 3D
- 高度定制的特殊交互
- 视频/图像编辑器

凡是"输入 → 处理 → 列表/详情/图表"四件套描述不出来的，写代码。

#### 5.2.2 组件文件

`components/Whiteboard.tsx`：

```tsx
import { useLumos } from '@lumos/app-sdk'
import { useState } from 'react'

export default function Whiteboard() {
  const { runWorkflow, askAgent, db, knowledge, config, state, nav, ui } = useLumos()
  const [drawing, setDrawing] = useState(null)

  const handleAnalyze = async () => {
    const result = await runWorkflow('analyze-drawing', {
      drawingId: drawing.id
    })
    ui.toast({ title: '分析完成', description: result.summary })
    nav.go('detail', { id: drawing.id })
  }

  return (
    <div className="flex flex-col h-full">
      <Canvas onChange={setDrawing} />
      <button onClick={handleAnalyze}>AI 分析</button>
    </div>
  )
}
```

#### 5.2.3 加载机制

- 应用安装时，components/ 下的 .tsx 文件经 esbuild 预编译为 .js
- 路由命中代码页面时，渲染进程动态 import 该 .js
- 模块缓存 + 热重载（开发模式）

#### 5.2.4 沙箱限制

- 不允许 `require('fs')` / `require('child_process')` 等 Node 原生模块
- `fetch` 走 Lumos 代理，自动校验 manifest 的 network 白名单
- 不允许 `eval` / `new Function`
- 资源限制：单组件渲染 CPU 时间 < 200ms（用 Profiler 监控告警）

---

## 6. Lumos App SDK

代码应用调用 Lumos 能力的唯一入口。Hook API。

### 6.1 完整接口

```typescript
function useLumos(): LumosContext

interface LumosContext {
  // 工作流 / Agent
  runWorkflow(id: string, input?: any): Promise<WorkflowResult>
  streamWorkflow(id: string, input?: any): AsyncIterator<WorkflowEvent>
  askAgent(prompt: string, opts?: AgentOpts): Promise<string>
  streamAgent(prompt: string, opts?: AgentOpts): AsyncIterator<string>

  // 应用数据
  db: {
    query<T>(collection: string, filter?: any): Promise<T[]>
    get<T>(collection: string, id: string): Promise<T | null>
    create<T>(collection: string, data: T): Promise<T>
    update<T>(collection: string, id: string, data: Partial<T>): Promise<T>
    delete(collection: string, id: string): Promise<void>
    subscribe<T>(collection: string, callback: (data: T[]) => void): Unsubscribe
  }

  // 知识库
  knowledge: {
    search(query: string, opts?: SearchOpts): Promise<SearchResult[]>
    getCollection(id: string): Promise<Collection>
  }

  // 配置 / 状态
  config: {
    get<T>(key: string): T
    set<T>(key: string, value: T): Promise<void>
  }
  state: {
    get<T>(key: string): T
    set<T>(key: string, value: T): Promise<void>
  }

  // 路由
  nav: {
    go(routeId: string, params?: any): void
    back(): void
    current(): RouteInfo
  }

  // UI
  ui: {
    toast(opts: ToastOpts): void
    dialog(opts: DialogOpts): Promise<DialogResult>
    confirm(message: string): Promise<boolean>
  }

  // 系统能力（受权限控制）
  system: {
    notify(opts: NotifyOpts): Promise<void>
    schedule(cron: string, workflow: string): Promise<TriggerId>
    cancelSchedule(id: TriggerId): Promise<void>
  }

  // MCP 直调（仅 manifest 声明的 MCP）
  mcp: {
    call(server: string, tool: string, args: any): Promise<any>
  }

  // 文件（受权限控制）
  fs: {
    read(path: string): Promise<Buffer>
    write(path: string, data: Buffer): Promise<void>
    list(path: string): Promise<string[]>
  }

  // 网络（白名单）
  fetch: typeof fetch
}
```

### 6.2 设计原则

- **统一入口**：所有能力走 SDK，应用不能直接 import lumos 内部模块
- **能力声明驱动**：能调什么由 manifest 决定，未声明的调用直接拒绝
- **Hook 友好**：状态变化触发重渲染（state、db.subscribe）
- **类型完备**：完整 TypeScript 类型，IDE 自动补全
- **版本兼容**：SDK 版本独立，向后兼容

---

## 7. 创建路径

### 7.1 AI 对话生成（差异化卖点）

> **完整设计见独立文档**：[`app-platform-ai-builder.md`](./app-platform-ai-builder.md)
>
> 包含：双面板 UI、AppBuilder Agent 设计（system prompt / 工具集 / 思考链）、上下文管理、需求模板库、实时预览、增量迭代、失败处理、数据存储、安全模型、推进路线图（B0-B7）。

用户体验：

```
用户：我想做一个客户管理应用，能记录客户、订单、自动分析跟进建议
  ↓
AI：好的，让我和你确认几点：
  - 字段：客户的姓名/电话，是否需要标签？
  - 跟进建议基于什么数据？
  - 要不要每周自动总结？
  ↓
用户：……
  ↓
AI：好，我会生成这些文件：
  - app.json
  - routes.json（菜单：客户/订单/统计/设置）
  - pages/customers.json
  - pages/orders.json
  - pages/stats.json
  - workflows/analyze-customer.json
  - data-schema.json（customers/orders 表）
  ↓
[AI 调用应用生成 agent 输出文件]
  ↓
[Lumos 自动安装、用户试用]
  ↓
用户：客户列表能加个标签筛选吗？
  ↓
AI：好的，更新 pages/customers.json 的 filter 字段……
  [增量更新]
```

底层实现：

- 一个专门的 `app-builder` agent
- System prompt 包含：app.json schema、组件清单、可用 MCP、可用 Agent
- 工具：写文件 / 校验 manifest / 安装应用 / 重新加载
- 输出**只能是 JSON**（除非用户明确要求复杂 UI 时生成 React）

### 7.2 工作流提升（一键变应用）

用户在工作流页面点 **"保存为应用"**：

```
工作流的 inputs → 自动生成 form 字段（pages/main.json）
工作流本体     → 复制到 workflows/main.json
工作流的 outputs → 自动生成 result 页（render markdown / json / table）
工作流的 schedule → 写入 app.json triggers
  ↓
弹出对话框让用户填：
  - 应用名
  - 描述
  - 图标
  - category
  ↓
生成 app.json + 安装
```

这是**最低成本的"应用化"**——零额外开发即可让任意 workflow 变成应用。

### 7.3 开发者手写

提供 CLI：

```bash
npx @lumos/cli create my-app           # 脚手架
cd my-app
# 编辑 app.json / pages / components
npx @lumos/cli dev                     # 本地开发模式（热重载）
npx @lumos/cli validate                # 校验 manifest
npx @lumos/cli pack                    # 打包成 .lumos-app
npx @lumos/cli publish                 # 发布到市场（v3+）
```

---

## 8. 全生命周期

### 8.1 创建（Author）

三种路径见第 7 节，最终产物都是同一个 `.lumos-app` 包。

### 8.2 安装（Install）

流程：

1. 用户双击 `.lumos-app` 或从市场点"安装"
2. Lumos 校验 manifest（schema、签名、版本兼容）
3. 检查权限声明，**弹窗让用户确认**：
   ```
   "客户管理"应用申请：
   ✓ 访问 ~/Documents/customers
   ✓ 调用飞书 API（open.feishu.cn）
   ✓ 使用本地 Python 工具
   ✗ 网络访问其他域名（已禁用）
   [拒绝] [允许]
   ```
4. 解压到 `~/.lumos/apps/{id}/`
5. 注册到 SQLite `apps` 表
6. 创建应用专属数据表（基于 data-schema.json）
7. 引导用户填 config 项
8. 注册菜单入口、定时任务

### 8.3 运行（Run）

- 用户点击应用图标 → 路由到 `/apps/{id}`
- App Runtime 加载 manifest → 渲染默认页面
- 应用接管整个内容区，左侧出现应用自己的菜单
- 应用内 navigation 切换 page
- 表单提交 → 调 workflow → 结果渲染回页面

### 8.4 管理（Manage）

`/apps/manage` 页面：

- 已安装应用列表（启用/禁用、最近使用、占用空间）
- 单击应用 → 详情：
  - 基本信息
  - 权限审查（撤销 / 重新授权）
  - 配置编辑
  - 执行历史
  - 卸载（含数据清理选项）

### 8.5 更新（Update）

- 后台轮询市场 / 应用源
- 发现新版本 → 通知用户
- 用户确认 → 下载、备份旧版、原子替换、迁移数据
- 失败回滚

### 8.6 卸载（Uninstall）

- 删除 `~/.lumos/apps/{id}/`
- 删除 `apps` / `app_configs` / `app_permissions` 表记录
- **应用专属数据**：默认保留（用户可选删除）
- 取消注册的定时任务

---

## 9. 架构设计

### 9.1 分层

```
┌──────────────────────────────────────────────────────┐
│ 应用层（消费）                                         │
│  应用列表 / 应用市场 / AI 创建器 / 应用管理 / 应用容器  │
├──────────────────────────────────────────────────────┤
│ App Runtime（新增）                                   │
│  Manifest 解析 / 路由 / 渲染器 / SDK Host / 权限管理  │
├──────────────────────────────────────────────────────┤
│ 执行层（已有）                                         │
│  工作流引擎 / 调度器 / Agent 团队 / StageWorker        │
├──────────────────────────────────────────────────────┤
│ 能力层（已有）                                         │
│  MCP / LLM / 知识库 / 浏览器 / Office / DB             │
└──────────────────────────────────────────────────────┘
```

### 9.2 新增模块

```
src/lib/app/
├── manifest-parser.ts          # 解析 + 校验 manifest
├── installer.ts                # 安装/卸载/更新
├── packager.ts                 # 打包 .lumos-app
├── runtime.ts                  # 加载应用、暴露 API
├── sdk-host.ts                 # SDK 实现（在主进程跑业务）
├── permission-manager.ts       # 权限审查、授予、撤销
├── data-store.ts               # 应用专属数据库管理
├── route-registry.ts           # 应用路由注册
├── trigger-manager.ts          # 应用定时/事件触发
└── code-loader.ts              # 代码应用加载器（动态 import）

src/components/app/
├── AppContainer.tsx            # 应用容器（渲染 routes + page）
├── AppSidebar.tsx              # 应用内菜单
├── declarative/
│   ├── PageRenderer.tsx        # 声明式页面渲染器
│   ├── FormRenderer.tsx
│   ├── ListRenderer.tsx
│   ├── DetailRenderer.tsx
│   └── components/             # 各内置组件实现
└── code/
    └── CodePageRenderer.tsx    # 代码页面渲染器

src/app/apps/
├── page.tsx                    # 应用列表
├── manage/page.tsx             # 应用管理
├── create/page.tsx             # AI 创建器入口
├── market/page.tsx             # 应用市场（v3+）
└── [id]/
    ├── page.tsx                # 应用入口
    └── settings/page.tsx       # 应用设置

src/app/api/apps/
├── route.ts                    # 列表 / 安装
├── [id]/route.ts               # 详情 / 卸载 / 更新
├── [id]/run/route.ts           # 调用应用 workflow
├── [id]/data/route.ts          # 应用数据 CRUD
└── [id]/permissions/route.ts   # 权限管理

@lumos/app-sdk/                 # 给代码应用用的 SDK 包
├── src/index.ts
├── src/hooks/useLumos.ts
└── package.json
```

### 9.3 与 workflow 引擎集成

应用调 workflow 的路径：

```
应用页面 button.run = "workflow:analyze"
   ↓
PageRenderer 触发事件
   ↓
SDK Host.runWorkflow("analyze", input)
   ↓
权限校验（应用是否声明了对应能力）
   ↓
注入应用上下文（applicationId、permissions、data namespace）
   ↓
调用现有 src/lib/workflow/runtime.ts
   ↓
工作流执行（agent 步骤可调代码工具，受 manifest 工具白名单约束）
   ↓
结果回传 → 页面渲染
```

**关键**：应用的 workflow 跑在现有 OpenWorkflow 引擎上，不重写。但加一层"上下文隔离"——应用的 workflow run 会标记 `app_id`，权限检查、数据访问都基于这个标记。

---

## 10. 安全模型

### 10.1 威胁模型

- **恶意应用**：偷数据、加密勒索、反向 shell
- **过度授权**：应用申请超出场景所需的权限
- **代码注入**：应用 manifest 里塞 eval、动态 require
- **供应链**：应用依赖的 MCP 或上游服务被劫持

### 10.2 防护层

#### 10.2.1 manifest 静态校验

- JSON Schema 强类型校验
- 权限声明必须明确（无通配符）
- 敏感权限需要额外字段（如 `network.domains` 不能为空数组等同 `*`）

#### 10.2.2 安装时确认

- 列出所有权限请求
- 高危权限（如 `tools: bash`）红字提示
- 用户必须勾选所有项才能继续

#### 10.2.3 运行时拦截

- SDK Host 是唯一入口，所有 API 调用先过权限闸
- 文件系统：只允许 manifest 声明的目录前缀
- 网络：只允许声明的域名（http/https，禁止 ws/raw socket）
- MCP：只允许声明的 server，且不能访问应用未声明的 tool
- 代码应用 fetch：自动注入域名校验

#### 10.2.4 沙箱（代码应用）

- 渲染进程的 worker 隔离（参考 Electron contextIsolation）
- 模块系统：白名单 import（react、@lumos/app-sdk、自身 components）
- 禁止 `eval`、`Function constructor`、`require('fs')` 等
- 资源限制：CPU、内存、磁盘配额

#### 10.2.5 签名（v3+）

- 开发者注册账号 → 生成证书
- 发布时签名应用包
- Lumos 安装时校验签名
- 未签名应用：警告 + 严格沙箱
- 已签名应用：根据开发者信誉 + 应用审核状态展示标识

### 10.3 数据隔离

- 默认每个应用有独立的数据命名空间
- 应用 A 看不到应用 B 的数据
- 跨应用数据共享必须：
  - app.json 声明 `permissions.data: shared`
  - 用户安装时确认
  - 通过 SDK 显式访问 `lumos.shared.xxx`

---

## 11. 数据存储

### 11.1 主数据库 schema

```sql
-- 应用安装记录
CREATE TABLE apps (
  id TEXT PRIMARY KEY,              -- 全局唯一（市场 id）
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,      -- 完整 manifest 缓存
  source TEXT NOT NULL,             -- 'market' | 'local' | 'ai-generated' | 'workflow-promoted'
  source_meta_json TEXT,            -- 来源元数据（市场 url、签名等）
  installed_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  install_path TEXT NOT NULL,       -- ~/.lumos/apps/{id}/
  size_bytes INTEGER,
  last_used_at INTEGER
);

-- 用户配置（每个 app 一份）
CREATE TABLE app_configs (
  app_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,              -- secret 项加密存储
  is_secret INTEGER DEFAULT 0,
  PRIMARY KEY (app_id, key),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

-- 权限授权
CREATE TABLE app_permissions (
  app_id TEXT NOT NULL,
  permission TEXT NOT NULL,         -- 'fs.read:~/Documents', 'net:open.feishu.cn', 'mcp:feishu'
  granted INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  granted_by TEXT,                  -- 用户 id
  PRIMARY KEY (app_id, permission),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

-- 应用专属数据（KV + JSON 形式存储 collection）
CREATE TABLE app_data (
  app_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, collection, id),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX idx_app_data_collection ON app_data(app_id, collection, updated_at DESC);

-- 执行历史
CREATE TABLE app_runs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  page_id TEXT,                     -- 哪个页面触发
  workflow_id TEXT,                 -- 调用的工作流
  workflow_run_id TEXT,             -- 关联到 schedule_run_history
  triggered_by TEXT NOT NULL,       -- 'manual' | 'schedule' | 'event'
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL,             -- 'running' | 'success' | 'failed' | 'cancelled'
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  error_message TEXT,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX idx_app_runs_app ON app_runs(app_id, started_at DESC);

-- 应用触发器
CREATE TABLE app_triggers (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'schedule' | 'event'
  config_json TEXT NOT NULL,        -- cron / event 配置
  workflow_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);
```

### 11.2 文件系统

```
~/.lumos/
├── apps/                          # 已安装应用
│   ├── weekly-report/
│   │   ├── app.json
│   │   ├── pages/
│   │   ├── components/
│   │   └── ...
│   └── customer-mgmt/
├── app-data/                      # 应用大文件附件（图片/视频/上传）
│   ├── weekly-report/
│   └── customer-mgmt/
├── app-runs/                      # 应用 workflow 执行的工作目录
│   └── {run-id}/
└── lumos.db                       # 主数据库
```

---

## 12. UI 集成

### 12.1 侧边栏调整

```
探索
├ 工作空间
└ 应用              ← NEW

自动化
├ 工作流
├ 任务
└ 团队

拓展
├ Mind
└ 插件
```

"应用" 项放在"探索"组下，与"工作空间"并列——同属"打开就能用的东西"。

### 12.2 应用相关页面

| 路由 | 用途 |
|---|---|
| `/apps` | 应用列表（已装 + 推荐）|
| `/apps/create` | AI 创建器入口（对话引导） |
| `/apps/manage` | 应用管理（启用/禁用/更新/卸载） |
| `/apps/market` | 应用市场（v3+） |
| `/apps/[id]` | 具体应用入口（应用接管 UI） |
| `/apps/[id]/settings` | 应用设置（配置/权限） |

### 12.3 应用容器

应用打开后的视图层级：

```
┌──────────────────────────────────────────────────┐
│ Lumos 顶部栏（可隐藏让应用全屏）                   │
├──────────┬───────────────────────────────────────┤
│ Lumos    │  ┌──────┬─────────────────────────┐  │
│ 侧栏     │  │ 应用  │                         │  │
│          │  │ 菜单  │   应用页面内容          │  │
│          │  │      │                         │  │
│          │  │ 客户  │                         │  │
│          │  │ 订单  │                         │  │
│          │  │ 统计  │                         │  │
│          │  │ 设置  │                         │  │
│          │  └──────┴─────────────────────────┘  │
│          │  ↑ 由 routes.json 渲染                │
└──────────┴───────────────────────────────────────┘
```

应用内允许选择"全屏模式"，隐藏 Lumos 自身的侧栏。

---

## 13. 应用市场（远期）

分阶段做，不要一上来就重。

### 13.1 阶段 1：本地导入 + 内置应用（v1）

- 用户从本地 `.lumos-app` 安装
- Lumos 内置 5-10 个官方应用（首次启动可选装）
- 不做市场后端

### 13.2 阶段 2：在线源 + 推荐（v2）

- 在 lumos-web（已有官网）上挂应用列表
- Lumos 客户端拉取列表、显示推荐
- 一键安装（从在线 URL 下载）
- 仍不开放第三方提交

### 13.3 阶段 3：开放市场（v3）

- 开发者注册、签名机制
- 第三方提交应用、人工审核
- 评分、评论、版本管理
- 客户端有完整的市场 UI

### 13.4 阶段 4：商业化（v4+）

- 付费应用
- 订阅制
- 开发者分成
- 企业内部市场（私有部署）

---

## 14. 推进路线图

| 里程碑 | 范围 | 时长估计 | 输出 |
|---|---|---|---|
| **M0：Schema 定稿** | app.json / routes.json / pages.*.json 的 JSON Schema 定稿、评审 | 1 周 | `schemas/` 目录 |
| **M1：基础架构** | manifest 解析、安装/卸载、应用容器、声明式 UI 渲染器（form/list/detail） | 4-6 周 | 能装能跑一个最简单应用 |
| **M2：工作流提升** | "保存为应用" 按钮、自动转换 manifest | 1-2 周 | 现有工作流可一键变应用 |
| **M3：完整声明式 UI** | 所有内置组件、数据绑定、事件、layout 模板 | 3-4 周 | 90% 应用纯 JSON 可写 |
| **M4：AI 创建器** | app-builder agent、对话引导、增量更新 | 2-3 周 | 用户可对话生成应用 |
| **M5：内置应用** | 5-10 个官方应用作为 dogfooding | 持续 | 周报、合同审查、简历筛选等 |
| **M6：代码应用** | components/ 支持、Lumos App SDK、动态加载、沙箱 | 4-6 周 | 长尾场景可写 React |
| **M7：在线源** | lumos-web 应用列表 + 客户端拉取 | 2-3 周 | 在线推荐 + 一键安装 |
| **M8：开放市场** | 开发者中心、签名、审核、评分 | 8-10 周 | 第三方应用生态 |
| **M9：商业化** | 付费、订阅、分成 | 持续 | 商业模式 |

每阶段**只加能力、不破坏前一代应用**。

---

## 15. 关键决策点

需要在 M0 阶段确认的设计决策：

| # | 决策 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|
| 1 | manifest 格式 | JSON / YAML | **JSON + JSON Schema** | AI 写 JSON 更稳，工具链丰富 |
| 2 | UI 形态 | 单一声明式 / 单一代码 / 混合 | **混合** | 90% 声明式 + 10% 代码兜底 |
| 3 | 应用间互调 | 允许 / 禁止 | **v1 禁止，v3 开放** | 避免依赖地狱 |
| 4 | 数据隔离 | 默认隔离 / 默认共享 | **默认隔离 + 可声明共享** | 安全优先 |
| 5 | 包格式 | zip / tar / 自定义 | **zip** | 通用、跨平台 |
| 6 | SDK 风格 | Hook / Class / Imperative | **Hook** | React 生态友好 |
| 7 | 代码应用沙箱 | 不沙箱 / 受限 / 强沙箱 | **受限**（白名单 import + 资源限制） | 平衡能力和安全 |
| 8 | 跨设备同步 | v1 不做 / v1 做 | **v1 不做** | 先把单机跑通 |
| 9 | 应用 i18n | 必须 / 可选 | **可选**（locales/ 目录） | 不强制，但留接口 |
| 10 | 版本回滚 | 支持 / 不支持 | **支持**（保留上一版） | 体验更好 |

---

## 16. 开放问题

以下问题留待 M1 实施过程中决策：

1. **AI 创建器的细节交互** — 是单轮生成完整应用还是多轮迭代？错误如何修复？
2. **应用的多用户模式** — 团队/多人共享一个应用实例？数据怎么隔离？
3. **离线模式** — 哪些应用允许离线工作？需要在 manifest 声明吗？
4. **应用之间的事件总线** — v3 开放互调时，是 IPC 还是事件订阅？
5. **应用更新策略** — 强制更新 / 静默 / 询问？
6. **本地开发体验** — 开发者如何快速迭代？热重载支持到哪一层？
7. **应用性能监控** — 如何检测某个应用拖慢 Lumos？资源限制怎么强制？
8. **大文件处理** — 应用要处理几 GB 视频时数据怎么存？
9. **应用导出/迁移** — 用户能否导出应用 + 数据，迁移到另一台 Lumos？
10. **市场审核标准** — 哪些行为禁止？审核 SLA？

---

## 17. 与现有工作流模块的协调

应用模块**不会替代** workflow 模块，两者长期共存：

| 模块 | 定位 | 用户 | 入口 |
|---|---|---|---|
| **Workflow** | 用户自己搭流程的工具 | 进阶用户 / 团队 | 侧栏「自动化」组 |
| **Application** | 别人/AI 已搭好的产品 | 普通用户 | 侧栏「探索」组 |

工作流模块 **不动**：保留 DSL、画布、调度、Agent 团队管理界面。

**唯一新增交互**：工作流详情页加一个"保存为应用"按钮，作为应用的来源之一。

---

## 18. 总结

**Lumos 应用 = 标准化的场景解决方案包**，由 manifest + 工作流 + UI（声明式 / 代码）+ 数据 schema 组成。

核心设计原则：

1. **应用底层复用 workflow 引擎**，不重新造轮子
2. **声明式优先**：90% 应用纯 JSON 描述，AI 能稳定生成
3. **代码兜底**：复杂场景允许写 React 组件，通过 SDK 调 Lumos 能力
4. **能力声明驱动**：应用能干什么由 manifest 决定，安全模型清晰
5. **沉淀路径**：对话自动化 → 工作流 → 应用，价值逐级凝固
6. **架构留口子**：第一天就预留代码应用、市场、签名的扩展点

下一步：

1. 评审本文档，确认第 15 节的决策点
2. 完成 M0：起草 JSON Schema
3. 启动 M1：基础架构 + 一个 dogfooding 应用（推荐"周报助手"）
