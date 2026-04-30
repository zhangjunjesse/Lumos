# IM 模块架构设计（feature/im-module）

> **本文档是这个模块的护栏**：所有 AI / 人类对 `src/lib/im/` 的改动，必须先读完这一份再动手。
> 如果你打算违反下文任何一条「硬规则」，**先改本文档并取得 review**，再改代码。

---

## 0. 背景与目标

### 业务目标

把 lumos 的 IM 接入从「飞书写死的特例」改造成「**多 IM 可插拔**」：

1. 用户能在 settings 里开关每个 IM、设默认 IM
2. 飞书继续工作，行为零变化
3. 接入微信（**通过 QClaw 协议**，腾讯官方 OpenClaw 微信桥）
4. 后续接钉钉/QQ/公众号/企业微信/Telegram/Discord 时，AI 套模板就能完成，不用碰核心层

### 工程目标（同等重要）

**这个模块的代码全部由 AI 编写**。架构必须满足：

- AI 改动一个 IM 不需要读其它 IM 的代码
- AI 用最小上下文（≤ 500 行）就能在某个 provider 内完成端到端修改
- AI 跨边界改动（修改公共契约）必须显式跨过 `core/` 边界，触发人工审查
- 任何改动有清晰的回归边界，单 provider 测试可独立运行

---

## 1. 顶层目录约定

```
src/lib/im/
├── core/                    ★ 稳定层（修改需谨慎）
│   ├── types.ts             契约：IMAdapter / IMProviderManifest / IMConfigSchema
│   ├── registry.ts          静态注册表 + 默认 IM 解析
│   ├── config-store.ts      统一 settings 读写（namespace: im.<id>.*）
│   ├── runtime.ts           运行态 adapter 实例 + 出站发送入口
│   └── README.md            "改这里之前必读"
│
├── providers/               ★ 可独立修改层（每个 IM 一个垂直切片）
│   ├── feishu/
│   ├── wechat-qclaw/
│   └── wechat-work/         （后续）
│
└── index.ts                 列出所有 provider import + registry.register

src/app/api/im/              REST API 薄层
src/components/settings/im/  Settings UI（schema-form 自动渲染配置）
electron/bridge/platforms/   每个 provider 在主进程的 runtime（如需要）
```

**单一入口原则**：外部代码（chat、workflow、agent 主动外发等）只通过 `import { ... } from '@/lib/im'` 访问 IM 能力，禁止直接 import `providers/*` 内部文件。

---

## 1.5 集成点：IM 模块对 lumos 的所有出口

> 不规定清楚出口，IMAdapter 接口会被乱加东西、最后臃肿到没人能改。
> 下表是**唯一允许的出口列表**。新增出口必须先改本文档。

### P0 — 所有 IM 必须支持（IMAdapter 强制实现）

| 编号 | 场景 | 触发方向 | 调用入口（lumos 这边） | IMAdapter 用到的方法 |
|---|---|---|---|---|
| **A** | 入站对话桥：用户在 IM 发消息 → lumos session → AI 回复 → 发回 IM | 入站 | `electron/bridge/runtime-manager` 启动后轮询 `consumeOne` | `start/stop/isRunning/consumeOne/send` |
| **B** | 工作流通知：定时任务/workflow 完成 → 发结果到 IM | 出站 | DSL `notification` step → runtime → `getDefaultProvider().send()` | `send` |
| **C** | Agent 主动外发：长任务结束 / 系统告警 / 提醒 | 出站 | `lib/im` 暴露 `sendToDefault(text, target?)` 函数 | `send` |
| **D** | Session ↔ Chat 双向绑定：lumos 会话与 IM 群/私聊双向同步 | 双向 | `BindingManager` UI / `/api/bridge/bindings` | `start/send/consumeOne` + 复用 `session_bindings` 表 |

### P1 — 可选 capability（manifest 声明，按需实现）

| 编号 | 场景 | mixin 接口 | 触发入口 |
|---|---|---|---|
| **E** | Slash Command：IM 里发 `/查文档 xxx` 触发 lumos 能力 | `IMCommandHandler`（注册 command → handler 的 router） | 入站消息进 `consumeOne` 后，先过 command-router |
| **F** | Agent 工具调用：AI 在对话中说"发给老板"时调用 send | `IMTargetDirectory`（暴露 `listTargets()` 给 AI） | Agent SDK MCP 工具 `im_send`、`im_list_targets` |
| **J** | 流式预览卡片：AI 流式回答时在 IM 里实时刷新带打字效果的卡片 | `IMStreamingPreview`（`sendPreview/updatePreview/finalizePreview`） | bridge 的 inbound pipeline，在收到 `assistant` partial 时调用 |

### P2 — 预留接口（core/types.ts 写好类型，M1-M5 不实现）

| 编号 | 场景 | mixin 接口 | 备注 |
|---|---|---|---|
| **G** | IM 文档 / 文件导入到知识库 | `IMDocumentProvider` | 飞书目前的 `src/lib/feishu/doc-content.ts` 等代码**保持不动**，未来可考虑迁入 |
| **H** | IM 账号 OAuth 登录 lumos | `IMAuthProvider` | 飞书目前的 `src/lib/feishu-auth.ts` + `/api/feishu/auth/*` 保持不动 |
| **I** | 群消息归档进 RAG | `IMArchiveProvider` | wechat-export 是另一个独立模块，不与此合并 |

> 重要：P2 接口在 M1 时只**写类型签名**，不实现。后续要做时直接补 implements。这样 core/types.ts 一次定型，未来加能力不破坏现有 provider。

### 接口分层全貌（写进 `core/types.ts`）

```ts
// 强制
export interface IMAdapter {
  readonly id: IMProviderId;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  consumeOne(): Promise<InboundMessage | null>;
  send(msg: OutboundMessage): Promise<SendResult>;
  probe(): Promise<ProbeResult>;
  validateConfig(): string | null;
}

// 可选 mixin（P1）
export interface IMCommandHandler {
  listCommands(): IMCommand[];
  handleCommand(ctx: IMCommandContext): Promise<IMCommandResult>;
}
export interface IMTargetDirectory {
  listTargets(opts?: ListTargetsOptions): Promise<IMTarget[]>;
  resolveTarget(query: string): Promise<IMTarget | null>;
}
export interface IMStreamingPreview {
  startPreview(addr: ChannelAddress): Promise<PreviewHandle>;
  updatePreview(handle: PreviewHandle, chunk: string): Promise<void>;
  finalizePreview(handle: PreviewHandle, finalText: string): Promise<void>;
}

// 可选 mixin（P2 - 仅类型，M1-M5 不实现）
export interface IMDocumentProvider { /* 见 core/types.ts */ }
export interface IMAuthProvider { /* 见 core/types.ts */ }
export interface IMArchiveProvider { /* 见 core/types.ts */ }
```

### Provider 能力矩阵（M5 完成时的目标）

| Provider | A | B | C | D | E | F | J | G | H | I |
|---|---|---|---|---|---|---|---|---|---|---|
| feishu       | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | (保留旧实现，不进 IM 模块) | (同) | – |
| wechat-qclaw | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ 视 QClaw 能力 | – | – | – |
| wechat-work  | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | – | – | – |

---

## 2. 9 条硬规则（违反必须先改本文档）

### R1. 垂直切片
一个 IM = 一个 `providers/<id>/` 文件夹，全部代码（adapter、client、send、monitor、UI hint、迁移）都在里面。**不允许跨 provider 导入**：providers/feishu 不能 import providers/wechat-qclaw。

### R2. Manifest 优先
每个 provider 有 `manifest.ts`，集中声明 `id`、`label`、`docsUrl`、`configSchema`、`capabilities`、`defaults`。**AI 第一个要读的文件就是 manifest.ts**——读完就知道这个 IM 长啥样、有几个配置字段、能做什么。

### R3. 同名同义
所有 provider 用统一文件名：

| 文件名 | 职责 | 期望大小 |
|---|---|---|
| `manifest.ts` | 元数据声明 | 30-60 行 |
| `index.ts` | 装配 + 导出 plugin 对象 | 20-50 行 |
| `adapter.ts` | 实现 `IMAdapter` 接口（生命周期 + 入站消费 + 出站派发） | 150-250 行 |
| `client.ts` | 远端 API 客户端（HTTP/WS 封装） | 100-200 行 |
| `config.ts` | 配置读写、credential 解析、默认值 | 50-100 行 |
| `send.ts` | 出站消息（文本/卡片/媒体） | 80-150 行 |
| `monitor.ts` | 入站监听（WebSocket / 长轮询） | 100-200 行 |
| `targets.ts` | 目标地址规范化（chatId/userId/openId 等） | 40-100 行 |
| `probe.ts` | 健康检查 / 凭据校验 | 30-80 行 |
| `__tests__/*.test.ts` | 单元 + fixture | 不限 |

新加文件名前**先在本文档提议**。命名漂移会让 AI 跨 provider 学习失效。

### R4. 文件大小硬上限
- **≤ 200 行**：常态
- **≤ 250 行**：已经偏大，下次改时考虑拆
- **> 300 行**：禁止合并；拆 helpers 或者新增分类文件

理由：AI 一次性读完整个文件 + 类型定义后能在一次 turn 内做出无误的修改。

### R5. 类型即契约
`core/types.ts` 是唯一跨边界类型定义：

```ts
// 节选示意，最终代码以 src/lib/im/core/types.ts 为准
export type IMProviderId = string;          // 'feishu' | 'wechat-qclaw' | ...

export interface IMConfigField {
  key: string;
  label: string;
  type: 'string' | 'secret' | 'url' | 'enum' | 'boolean';
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  description?: string;
  enumValues?: Array<{ value: string; label: string }>;
}

export interface IMProviderManifest {
  id: IMProviderId;
  label: string;
  description: string;
  docsUrl?: string;
  configSchema: IMConfigField[];        // UI / 校验 / CLI 全派生于此
  capabilities: {
    chatTypes: Array<'direct' | 'group' | 'channel'>;
    media: boolean;
    reactions: boolean;
    threads: boolean;
    edit: boolean;
  };
  defaults?: Record<string, unknown>;
}

export interface IMAdapter {
  readonly id: IMProviderId;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  consumeOne(): Promise<InboundMessage | null>;
  send(msg: OutboundMessage): Promise<SendResult>;
  probe(): Promise<ProbeResult>;
  validateConfig(): string | null;
}

export interface IMPlugin {
  manifest: IMProviderManifest;
  createAdapter(config: Record<string, unknown>): IMAdapter;
}
```

**改 `core/types.ts` = 跨所有 provider 的兼容性事件**。改之前：
1. 跑 `npm test -- src/lib/im` 全绿
2. 走 PR review
3. 改本文档相关章节

### R6. 依赖单向
```
providers/<id>/* ──→ core/types
core/registry    ──→ providers/<id>/index   (静态 import)
api/im/*         ──→ core + providers
components/settings/im/* ──→ api/im/*  (fetch only, 不 import lib)
electron/bridge/platforms/* ──→ core/types  (主进程通过 IPC/HTTP 拿 config)
```

**禁止反向**：
- core 不能 import providers/* 的内部文件（只能 import providers/<id> 的 index）
- providers/* 不能 import api/* 或 components/*
- components/* 不能 import lib/im/*（隔离主/渲染进程）

### R7. 静态注册零反射
`src/lib/im/index.ts` 是一个手写数组：

```ts
import { feishuPlugin } from './providers/feishu';
import { wechatQclawPlugin } from './providers/wechat-qclaw';
// import { wechatWorkPlugin } from './providers/wechat-work';

import { registerPlugin } from './core/registry';

registerPlugin(feishuPlugin);
registerPlugin(wechatQclawPlugin);
// registerPlugin(wechatWorkPlugin);

export { getPlugin, listPlugins, getDefaultProvider, setDefaultProvider } from './core/registry';
export { getProviderConfig, setProviderConfig, isProviderEnabled } from './core/config-store';
export type { IMAdapter, IMPlugin, IMProviderManifest, IMConfigField } from './core/types';
```

**加新 IM = 改这一个文件 + 新建一个目录**。AI 改动可预测、可 review。
禁止 fs.readdirSync / 动态 import / glob 扫描，杜绝魔法。

### R8. configSchema 即 UI
配置字段在 `manifest.ts` 用 `IMConfigField[]` 声明，`schema-form.tsx` 自动渲染。**禁止**：
- 在 UI 组件里写死字段名
- 在 API route 里硬编码字段校验（统一从 manifest.configSchema 派生）
- 用 React state 表达 IM 配置（用 `react-hook-form` + manifest）

加配置字段：只改 `providers/<id>/manifest.ts`。UI / API / 持久化自动跟上。

### R9. 测试即规格
每个 provider 的 `__tests__/` 至少包含：
- `adapter.test.ts`：start/stop/isRunning 状态机
- `send.test.ts`：出站消息编码（含 mock client）
- `monitor.test.ts`：入站事件解析（含 fixture）
- `probe.test.ts`：健康检查
- `config.test.ts`：config 读写 + 迁移

CI 配 path-filter：改 `providers/feishu/` 只跑 feishu 测试，PR 速度 < 30s。

---

## 3. 配置存储约定

沿用 lumos 已有的 `settings` 单表 key/value，namespace：

| Key | 含义 | 示例 |
|---|---|---|
| `im.<id>.<field>` | 单个 provider 的某个配置字段 | `im.feishu.app_id` |
| `im.enabled` | 启用列表 (JSON array of provider id) | `["feishu","wechat-qclaw"]` |
| `im.default` | 默认 provider id | `"feishu"` |

**读写统一走 `core/config-store.ts`**，禁止 provider 直接 `setSetting('im.foo.bar')`。

**迁移**：core/config-store 只提供 `isMigrationApplied(version)` / `markMigrationApplied(version)` 原语；具体的 key 映射（如 `feishu_app_id` → `im.feishu.app_id`）住在对应 provider 内部，例如 `providers/feishu/migrations.ts`。**core 不知道任何 provider 的字段名**——这是 R6 单向依赖的硬性体现。每个 provider 在 register 时一次性运行自己的 migration，靠 markMigrationApplied 防重复。

---

## 4. 数据库与电子桥

### 不动的东西
- `session_bindings` / `bridge_events` / `bridge_connections` 已用 `platform` 字段通用化，**不需要 schema 迁移**
- `electron/bridge/runtime-manager.ts` 重命名为 `ImRuntimeManager`，从只跑 Feishu 改成按 enabled providers 多路并行；行为对单 provider 用户保持不变

### Electron 主进程层
若某个 provider 需要在主进程跑（如长连接 / 系统通知 / 文件下载），在 `electron/bridge/platforms/<id>-runtime.ts` 写一份 thin runtime，通过 IPC/HTTP 与渲染进程的 adapter 通信。**不必每个 provider 都有**——QClaw 走 HTTP polling 就不需要主进程进程驻留。

---

## 5. UI / API 层

### API 路由（每文件 < 150 行）

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/im/providers` | GET | 列出已注册 IM + 当前 configured/enabled/default 状态 |
| `/api/im/config/[provider]` | GET / PUT | 读写单个 provider 配置（按 manifest.configSchema 校验、secret 字段 mask） |
| `/api/im/enable/[provider]` | POST | body `{ enabled: bool }` |
| `/api/im/default` | GET / PUT | body `{ provider: string }` |
| `/api/im/probe/[provider]` | POST | 测试当前配置可用性，返回 ProbeResult |

### Settings UI

```
SettingsLayout sidebar 加一项 "IM"（icon: MessageMultiple01）
  └─ ImSection.tsx
       ├─ ImDefaultPicker.tsx          顶部：默认 IM 单选
       └─ map(providers).render(ImProviderCard)
            ├─ 标题 + ImEnableSwitch + 健康点
            ├─ schema-form.tsx 渲染 manifest.configSchema
            └─ "测试连接" 按钮 → /api/im/probe/[id]
```

`schema-form.tsx` 是**单一通用组件**，根据 `IMConfigField[]` 渲染不同 input。所有 IM 复用，不允许 per-provider 写自己的配置表单。

---

## 6. 微信 (QClaw) 接入要点

QClaw 是腾讯出品的 OpenClaw 微信桥，**用户在自己机器上装 QClaw**，通过 ClawBot 与个人微信号互通；lumos 通过 QClaw 暴露的 HTTP/WS API 收发消息。

### configSchema (`providers/wechat-qclaw/manifest.ts`)

| field | type | 说明 |
|---|---|---|
| `qclawHost` | url | QClaw 服务地址，默认 `http://localhost:8080` |
| `qclawToken` | secret | QClaw 鉴权 token |
| `botName` | string | ClawBot 名（可选，用于 @ 触发） |

### thin client 自己写
对接 QClaw HTTP API（发消息）+ WS（收事件）。**不引入 openclaw-china 等三方包**——避免外部依赖污染 lumos 类型/打包。代码量预估 ~300 行/provider。

---

## 7. M1-M5 实施分期

| Phase | 范围 | 文件改动量 | 验收 |
|---|---|---|---|
| **M0** | 本文档 + tasks | docs/im-module-design.md | 用户 review |
| **M1** | core/ 4 文件 + core/README | ~600 行 | unit test + types.ts 编译通过 |
| **M2** | providers/feishu/ 完整迁移 | ~1200 行（含搬迁） | 飞书 e2e 不回归 |
| **M3** | API + Settings UI | ~1500 行 | settings 页可读写飞书配置 |
| **M4** | providers/wechat-qclaw/ | ~1500 行 | QClaw 实例发收消息 |
| **M5** | providers/wechat-work/ | ~1200 行 | 企微自建应用发收消息 |

每期独立 commit，feature/im-module 分支累积，全部通过后整体合 main。

---

## 8. 给后续 AI 的"工作姿势"

1. **改某个 provider** → 只读 `providers/<id>/*` + `core/types.ts`，**不要读其它 provider**
2. **加配置字段** → 只改 `providers/<id>/manifest.ts`，UI / API / 校验自动跟上
3. **新增 IM** → 复制 `providers/feishu/` 为模板，全部文件名保持一致；最后改 `src/lib/im/index.ts` 加一行 register
4. **改 core/types.ts** → 必须跨 provider 检查 + 改本文档 + 走 review
5. **遇到「需要在 core 加字段才好做」的需求** → 先停下，提案到本文档讨论，**别为了一个 IM 污染 core**
6. **写代码前先读 manifest** → manifest 是 IM 的"目录"，先看目录再写章节

---

## 9. 决策记录（不要删）

- 2026-04-30：选择「自己写 thin client」而非引入 openclaw-china NPM 包，理由：避免外部依赖、AI 完全可控、打包体积友好
- 2026-04-30：选择「Feishu 同步迁移到新框架」而非保留两套并存，理由：长期看两套代码会让 AI 混淆，短痛优于长痛
- 2026-04-30：选择「QClaw 个人微信」作为 WeChat P0，企业微信 P1
- 2026-04-30：集成点 P0=A/B/C/D, P1=E/F/J 进 M1-M5；P2=G/H/I 仅在 core/types.ts 预留类型不实现；飞书已有的文档/OAuth 实现**留在原 `src/lib/feishu/` 和 `src/lib/feishu-auth.ts`**，本次不动，避免大爆炸式重构
