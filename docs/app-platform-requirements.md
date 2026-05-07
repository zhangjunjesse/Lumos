# Lumos 应用平台 — 需求调研

**状态**：Draft v1
**日期**：2026-04-30
**分支**：`spec/app-platform`
**关联文档**：
- [`app-platform-design.md`](./app-platform-design.md)（总体设计）
- [`app-platform-ai-builder.md`](./app-platform-ai-builder.md)（AI 创建器）
- [`app-platform-architecture.md`](./app-platform-architecture.md)（具体架构落地）

本文档不复述前两份的内容，只补充：**用户画像、用户故事、MVP 范围、竞品对照、决策点表态、开放问题落地**。目的是让 M0 启动有明确的"做什么、不做什么、怎么算成功"。

---

## 1. 用户画像（Personas）

为避免设计被"理想用户"误导，先把目标人群分清楚。下面 4 个画像中，**前两个是 v1 必须服务好的，后两个是 v3+ 才会成为重点**。

### 1.1 P1 — 普通效率用户「小敏」（v1 主目标）

- 背景：30 岁，市场专员；电脑日常用 Word/Excel/飞书；不会写代码
- 现状痛点：每周做周报、整理客户线索、导出竞品分析，大部分时间在搬运信息
- 对 Lumos 的认知：知道能聊天、能跑工作流，但 workflow DSL 看不懂
- **使用方式**：打开 AI 创建器，用嘴说想要什么应用 → AI 生成 → 点装 → 跑
- **场景 1**：跟 AI 说"做个周报助手，填工作内容点一下生成，再推飞书"
- **场景 2**：跟 AI 说"做个简单的客户记录本，能加客户、跟踪状态"
- **诉求**：对话能听懂模糊描述、生成的应用直接能用、改起来也是说话不是改代码
- **成功标准**：从打开创建器到第一个应用跑通 ≤ 15 分钟

### 1.2 P2 — 进阶/折腾用户「老王」（v1 次目标）

- 背景：35 岁，运营负责人；写过简单 Python 脚本、玩过 Notion/n8n/Coze
- 现状痛点：搭了几个 Lumos workflow 自用，想分享给团队同事但同事不会用 DSL 画布
- **场景 1**：把现有 workflow 一键变应用，发给同事，同事点开就能跑
- **场景 2**：用 AI 创建器搓个"招聘简历筛选"应用，再手动改 JSON 调字段
- **诉求**：一键转应用、改 JSON 比改 DSL 更顺手、能本地分享 .lumos-app 文件
- **成功标准**：现有 workflow 可零代码升级为应用 + 同事装上能用

### 1.3 P3 — 第三方开发者「大刘」（v3+ 主目标）

- 背景：35 岁，独立开发者；做过 Chrome 插件 / Notion 模板 / VSCode 扩展
- 诉求：写代码组件、调用 Lumos 能力、发到市场赚钱
- v1 阶段我们**不主动服务**，但要保证：**架构留口子**（manifest 规范公开、SDK 接口稳定、`components/` 路径已支持）

### 1.4 P4 — 企业/团队管理员「林总」（v3+ 主目标）

- 诉求：私有部署应用市场、内部审核、统一权限管理
- v1 阶段**不需要支持**，但 manifest 的 `source` / `signature` 字段要为此预留

### 1.5 谁不是目标用户

- 想做"完整 SaaS 替代品"的（Lumos 应用是单机/单人为主，不是多租户后端）
- 需要复杂工作流编排但不想要 UI 的（继续用 workflow 模块即可）
- 期待"图形化拖拽搭页面"的（v1 不做画布编辑器，只做 JSON + AI）

---

## 2. 用户故事（按优先级）

### 2.1 P0 — MVP 必须

**平台基础**
| ID | 故事 | 验收 |
|---|---|---|
| US-1 | 作为小敏，我能在应用列表里看到自己装/造过的应用，点开即用 | 应用列表 + 应用容器 |
| US-2 | 安装应用时我能看到清晰的权限请求，能拒绝某些权限 | 安装弹窗列出 fs/net/mcp，逐项可勾选 |
| US-3 | 应用内能填表 → 点按钮 → 看到 AI 生成的结果（声明式 form + run + result）| 4 layout + 15 组件渲染正常 |
| US-4 | 我能配置应用（飞书 token 等），并能改、删 | 应用设置页，secret 字段加密存储 |
| US-5 | 我能卸载应用，并选择是否保留数据 | 卸载弹窗带"同时清理数据"复选框 |
| US-6 | 应用执行的 workflow 失败时，错误回到应用页面有人话提示 | 错误展示组件 + 重试按钮 |
| US-7 | 我能通过校验工具检查 manifest 是否合法 | 内置 IPC 校验 + CLI |

**AI 创建器（v1 必含）**
| ID | 故事 | 验收 |
|---|---|---|
| US-8 | 作为小敏，我能在创建器里用日常话描述需求，AI 多轮澄清后给出大纲让我确认 | B1-B2，4 种设计模式都能识别 |
| US-9 | 生成过程中我能在右侧面板实时看到文件被写出来、页面被渲染出来（用 mock 数据）| B3 双面板 |
| US-10 | 生成完后能一键安装 + AI 引导我填配置 | 与安装流程对接 |
| US-11 | 装完后我说"加个搜索框"，AI 增量改 JSON 并显示 diff，我能反悔 | B4 增量迭代 |
| US-12 | AI 写错了能自己重试（最多 3 次），仍然失败时明确告诉我卡在哪 | B6 自检自修 |
| US-13 | 我可以从内置模板库选一个起手（CRM / 看板 / 助手 等 10-20 个） | B5 模板库 |
| US-14 | 我能把自己造的应用保存为新模板，下次基于它快速创建 | B7 模板贡献 |

**Workflow 转应用**
| ID | 故事 | 验收 |
|---|---|---|
| US-15 | 作为老王，在 workflow 详情页点"保存为应用"，30 秒生成可装应用 | 确定性转换 + 简单元信息表单 |

### 2.2 P2 — v2 再做

| ID | 故事 |
|---|---|
| US-16 | 应用市场（在线源）+ 一键安装 |
| US-17 | 代码应用（components/Whiteboard.tsx）+ SDK + 沙箱 |
| US-18 | 应用调度（cron 定时）+ 执行历史 |
| US-19 | 应用更新机制（含权限 diff） |

### 2.3 P3 — v3+ 才做

| ID | 故事 |
|---|---|
| US-20 | 开放第三方提交 + 签名审核 |
| US-21 | 商业化（付费、订阅、分成） |
| US-22 | 企业内部市场 / 多用户协作 |

---

## 3. MVP 范围

> **MVP 定义**：用户能用 AI 创建器对话生成一个应用，应用安装后能跑通；进阶用户能把已有 workflow 一键转成应用。**仓库不内置任何示例应用，第一批应用由用户用 AI 创建器自己造**。

### 3.1 MVP 必含

**平台基础**
- ✅ Manifest schema（app.json / routes.json / pages.*.json / data-schema.json / workflows.*.json）
- ✅ 应用安装/卸载（从 .lumos-app 文件、AI 创建器输出、workflow 转换三个来源）
- ✅ 应用容器（左菜单 + 内容区）
- ✅ 声明式 UI 渲染器：4 种 layout — `single` / `list-detail` / `form` / `result`
- ✅ 内置组件：约 15 个（form 类 + table + markdown + button + tag + dialog 等）
- ✅ 数据绑定：`{{ db.* }}`、`{{ inputs.* }}`、`{{ config.* }}`、`{{ steps.*.output }}`
- ✅ 事件触发：`workflow:`、`db:` 两类
- ✅ 应用专属数据存储（基于 `lumos_app_data` 表）
- ✅ 权限确认弹窗 + 运行时拦截（fs / net / mcp）
- ✅ 应用与 workflow 引擎的集成（带 app_id 上下文）

**两条创建路径（v1 必含）**
- ✅ **AI 创建器完整功能**（B0-B7 全套）
  - B0 能力探测 + 动态 prompt
  - B1 单文件应用生成
  - B2 完整流程 + 4 种设计模式（输入-处理-输出 / 列表-详情 / 仪表板 / 对话）
  - B3 双面板实时预览
  - B4 增量迭代 + diff
  - B5 模板库（10-20 个内置模板）
  - B6 自检与自修循环
  - B7 用户保存为模板
- ✅ workflow → 应用一键转换（确定性转换，不依赖 AI）

### 3.2 MVP 明确不做

- ❌ **不内置任何示例应用**（不做周报助手、客户管理等——用户用 AI 创建器自己造）
- ❌ 代码应用 / SDK / 沙箱（推到 M6+）
- ❌ 应用市场（推到 M7+）
- ❌ 应用间互调
- ❌ 跨设备同步
- ❌ i18n 强制
- ❌ 版本回滚 UI（数据库结构预留，UI 不做）
- ❌ 应用更新机制（推到 M7+）
- ❌ 复杂 layout（kanban / calendar / timeline）
- ❌ 多用户 / 团队协作 / 商业化

### 3.3 MVP 成功指标

- **可达性**：用户从"打开 AI 创建器"到"装上自己造的第一个应用并跑通"≤ 15 分钟（不含 LLM 调用排队）
- **AI 生成质量**：B2 落地后，10 个真实需求中 ≥ 8 个一次生成可装可跑（schema 校验 + 自检通过）
- **稳定性**：应用安装成功率 ≥ 99%、运行 100 次崩溃 ≤ 1 次
- **覆盖性**：4 种设计模式各能用 AI 造出至少 1 个可用应用
- **workflow 转换**：3 个真实 workflow 一键转应用后无需手改即可使用
- **性能**：应用容器冷启动 ≤ 500ms；AI 创建器单文件生成 ≤ 30s（含 LLM 调用）

---

## 4. 竞品对照

### 4.1 横向对比

| 维度 | Coze | Dify | Retool | Notion | Open WebUI / Skills | Lumos 应用 |
|---|---|---|---|---|---|---|
| **目标用户** | 普通用户 | 开发者+用户 | 开发者 | 普通用户 | 开发者 | **普通用户 + 进阶用户** |
| **打包形态** | Bot | App | App | 模板 | Skill 文件夹 | **.lumos-app（含 UI+流程+数据）** |
| **UI 形态** | 对话为主 | 对话为主 | 拖拽组件 | 模板填充 | 无 UI（CLI/对话） | **声明式 JSON + 代码兜底** |
| **流程能力** | Workflow（弱） | 强（DSL） | 弱（前端为主） | 弱 | 强（Agent SDK） | **强（复用 Lumos workflow 引擎）** |
| **数据存储** | 云端 | 云端 | 数据库连接 | 自有 | 文件 | **本地 SQLite + 隔离命名空间** |
| **AI 生成应用** | 部分（Bot 调优） | 无 | 无 | 有（AI 模板） | 无 | **核心特性（AI 创建器）** |
| **市场** | 有 | Marketplace | Library | Templates | 有 | **v3+ 才做** |
| **私有部署** | 不支持 | 支持 | 企业版 | 不支持 | 支持 | **天然单机** |

### 4.2 关键差异化

1. **强流程 + 强 UI 组合**——Coze/Dify 流程强但 UI 是对话；Retool UI 强但流程弱；Lumos 两边都有
2. **本地优先**——其他都依赖云端，Lumos 数据完全在本机，对隐私敏感场景（合同/HR/医疗）天然友好
3. **AI 自然语言生成完整应用**——其他平台 AI 顶多生成 prompt 或表单，Lumos 生成包含 UI + 流程 + 数据 schema 的完整应用
4. **沉淀路径连续**——对话 → workflow → 应用是同一套 DSL 演进，没有重写成本

### 4.3 借鉴

- **微信小程序**：app.json + pages 结构最清晰，直接抄
- **Retool**：组件清单完整、数据绑定语法成熟（query/state）
- **Notion**：数据库 schema 与视图分离的思路
- **Claude Skills**：能力声明（capability declaration）的设计，对应 Lumos 的 manifest.requires
- **Chrome Extension**：permission model（host_permissions / api_permissions / install-time consent）

### 4.4 反对意见与回应

| 反对 | 回应 |
|---|---|
| "为什么不直接用 workflow？普通用户学一下不就行了" | 实测：用户对"流程图"有天然抗拒，而填表→点按钮的认知成本接近于零。workflow 留给老王，应用给小敏 |
| "为什么不嵌 Retool / Appsmith" | 体积、依赖云端、Lumos 能力（agent/workflow/MCP/知识库）无法集成。声明式 UI 不复杂，自己实现成本可控（M1+M3 估 7-10 周） |
| "AI 生成 UI 不靠谱，会出垃圾应用" | 用 JSON Schema 强约束 + 自检循环最多 3 次重试 + 模板库锚定方向把生成空间收窄；workflow 转换作为兜底路径，让 AI 失败时仍有可走通的应用化路径 |
| "应用市场 v3 才做，开发者会等不下去" | v1 manifest 规范公开，开发者可本地分发 .lumos-app；GitHub releases 临时充当市场。v3+ 再做正式市场 |

---

## 5. 决策点表态（对应总体设计第 15 节）

总体设计列了 10 个决策点。下面给出**明确选择 + 决策理由 + 实施约束**：

| # | 决策 | 选择 | 实施约束 |
|---|---|---|---|
| 1 | manifest 格式 | **JSON + JSON Schema 2020-12** | 用 `ajv` 校验；Schema 单独放 `resources/app-schemas/`，build 时打入 |
| 2 | UI 形态 | **混合（声明式优先 + 代码兜底）** | M1-M3 只做声明式；M6 才放开代码 |
| 3 | 应用间互调 | **v1 禁止；v3 通过事件总线开放** | 数据库 `app_data` 已含 `app_id` 字段，跨应用查询直接拒绝 |
| 4 | 数据隔离 | **默认隔离 + 显式 `permissions.data: shared` 解锁** | shared 模式 v1 不实现，但保留 manifest 字段 |
| 5 | 包格式 | **zip（魔数 + 校验和）** | 用 Node 内置 `zlib`/`unzipper` 即可，避免 native deps |
| 6 | SDK 风格 | **Hook（`useLumos()`）** | M6 才需要；M1 不实现 |
| 7 | 代码沙箱 | **白名单 import + 资源限制** | M6 实现；用 Electron `contextIsolation: true` + Node `vm.Module` + `worker_threads` 配额 |
| 8 | 跨设备同步 | **v1 不做** | DB schema 预留 `synced_at` 字段，结构兼容 |
| 9 | i18n | **可选（locales/ 目录）** | M3 渲染器读 locales，不强制 |
| 10 | 版本回滚 | **支持，保留上一版** | 安装目录采用 `apps/{id}/{version}/`，`current` 软链；DB 加 `previous_version` 列 |

---

## 6. 开放问题落地（对应总体设计第 16 节）

总体设计列了 10 个开放问题，下面给出**初步答案或处理方式**：

### Q1：AI 创建器单轮 vs 多轮？错误如何修复？

**答**：**多轮 + 自修循环**。AI 创建器设计文档已明确（第 4.3 节阶段 1-6），自修最多 3 次失败后降级到"需要开发者介入"。**v1 必含完整 AI 创建器（B0-B7）**，与平台基础并行开发。Manifest 校验工具（`validate_app`）既给 AI 创建器用，也给开发者用。

### Q2：应用的多用户模式？

**答**：**v1 只支持单人**。Lumos 当前是单机桌面应用，无登录体系。多用户依赖 Lumos 整体的账号/团队架构，不在应用平台范围。Manifest 不包含 `multi_user` 字段，避免做半成品。

### Q3：离线模式？

**答**：**应用默认离线可用**（声明式 UI + 本地数据）。需要联网的应用通过 `requires.network = true` 显式声明，未声明时网络调用直接拒绝。

### Q4：应用之间事件总线？

**答**：**v3 决策**。短期方案是 v3 用现有 Lumos 内部 EventBus（`src/lib/events/` 目录预留）暴露给应用 SDK，topic 命名空间 `app:{id}:*`，订阅必须双方都在 manifest 声明。

### Q5：应用更新策略？

**答**：**询问式 + 可设静默**。应用列表显示"有更新"红点，用户点击后弹更新摘要 + 权限 diff。允许在设置里勾选"自动更新"（仅当无新增权限）。

### Q6：本地开发体验？

**答**：v1 提供 `npx @lumos/cli dev`（M2 后），监听文件改动 → 重新打包 → IPC 通知应用容器热重载。代码应用（M6）支持 esbuild watch + module HMR。

### Q7：应用性能监控？

**答**：v1 在 SDK Host 加埋点：每个 API 调用记录耗时、内存峰值。超过阈值（如单 API 调用 > 5s、单组件渲染 > 200ms）记录到 `app_runs` 表的 `metrics_json` 字段。**v1 不做强制限制**，只做观测+告警；M6 代码应用启用后再加限制。

### Q8：大文件处理？

**答**：分两类：
- **应用专属附件**：放 `~/.lumos/app-data/{app_id}/`，不入 SQLite，仅保存元信息
- **应用 workflow 中转文件**：放 `~/.lumos/app-runs/{run_id}/`，run 结束后保留 7 天清理
- 单文件 > 100MB 时给 SDK 的 fs.write 加流式 API

### Q9：应用导出/迁移？

**答**：v2+ 提供。命令：导出 `app + data + config + secrets(加密)` 为单个 `.lumos-app-bundle` 文件；目标机导入时重新走安装流程并解密 secrets（用本机密钥派生）。v1 不做，但 DB schema 不阻塞此能力。

### Q10：市场审核标准？

**答**：v3+ 决策。先列**红线（自动拒）**：
- 申请 `tools: bash` 或 `tools: shell` 但没说明用途
- `network.domains` 含通配符或 `*`
- manifest 引用不存在的 MCP（用 `validate_app` 静态拦截）
- 包大小 > 50MB
- 静态分析检测到 `eval` / 动态 `require`（代码应用）

**人工审核**关注：合规、UI 体验、隐私文案、payment 流程；SLA 5 工作日。

---

## 7. 风险与缓解

| 风险 | 级别 | 缓解 |
|---|---|---|
| 声明式 UI 表达力不够，用户/AI 撞墙 | 高 | 早期建立"撞墙库"——记录哪些场景声明式做不到，定期补内置组件；M6 代码应用兜底 |
| 应用与 workflow 边界含糊，用户不知道何时用哪个 | 高 | 入口/导航明显分开（侧栏不同组）；workflow 详情页明确"这是工具"，应用列表明确"这是产品" |
| MVP 周期过长（含 AI 创建器全套约 14-19 周） | 中 | 平台基础与 AI 创建器并行开发；先打通"AI 生成模式 1（输入-处理-输出）"作为内部里程碑（约第 8-10 周），其余模式增量补 |
| AI 创建器生成质量不稳定 | 高 | JSON Schema 强约束 + 自检循环（最多 3 次重试）+ 模板库锚定方向；用户负责验收（dogfooding 即创造者本人）；保留 workflow 转换路径作为兜底 |
| 数据隔离实现漏洞，应用 A 读到应用 B 数据 | 高 | 所有 app_data 查询强制走 `data-store.ts` 单一入口；写单测覆盖跨 app_id 注入；M1 接入前过 security review |
| 性能：应用容器嵌套 Lumos 主 UI 双层渲染 | 中 | 用 React Server Components / 路由级懒加载；声明式渲染器避免每键重渲染（用 useMemo + 数据绑定 selector） |
| 与现有 workflow 的命名/权限模型不一致 | 中 | M0 阶段做"统一权限抽象"——workflow 步骤的 tool 白名单与应用 manifest 的 tools 白名单合并到同一个权限表 |
| 包格式碎片化（开发者乱传 zip） | 低 | 严格校验：必须有 `app.json` 在根；版本字段必须 semver；icon.png 必须 512x512 |

---

## 8. 与现有模块的边界澄清

### 8.1 应用 vs Workflow 决策树（用户视角）

```
我有一个明确的、重复的、要给别人用的场景吗？
├─ 是 → 应用
└─ 否 → 我想跑一次性任务吗？
        ├─ 是 → 直接对话（自动化）
        └─ 否 → 我自己要重复跑、不分享 → workflow
```

### 8.2 应用 vs Agent 团队

- **Agent 团队**：长期协作，多 Agent 互相对话；适合"客服中心 / 编辑部"
- **应用**：单一场景闭环；适合"周报 / CRM"
- 两者可组合：应用内嵌 Agent 团队 → manifest 声明 `requires.agentTeams: ["xxx"]`，SDK 提供 `useTeam(id)` 调用

### 8.3 应用 vs 知识库

- 知识库是**数据**，应用是**用数据做事的产品**
- 应用 manifest 可声明"我用这个 collection"，安装时让用户选实际 collection 绑定
- 应用不持有知识库 ownership

### 8.4 应用 vs Skills

- Skills（Claude Skill / Lumos Skill）：给 LLM 看的能力包，加进 system prompt
- 应用：给用户看的产品包，含 UI
- **复用关系**：应用的 workflow 步骤里 agent 加载的 skills 列表，由 manifest `requires.skills` 声明

---

## 9. M0 交付物（本分支即开始）

启动条件：本文档 + `app-platform-architecture.md` + JSON Schema 草案评审通过。

### 9.1 文档（本分支提交）

- ✅ `docs/app-platform-design.md`（已存在，主文档）
- ✅ `docs/app-platform-ai-builder.md`（已存在）
- ✅ `docs/app-platform-requirements.md`（**本文档**）
- ⏳ `docs/app-platform-architecture.md`（同分支配套提交）

### 9.2 Schema 草案

- ⏳ `resources/app-schemas/app.schema.json`
- ⏳ `resources/app-schemas/routes.schema.json`
- ⏳ `resources/app-schemas/page.schema.json`
- ⏳ `resources/app-schemas/workflow-ref.schema.json`（应用内 workflow 引用现有 V2 DSL）
- ⏳ `resources/app-schemas/data-schema.schema.json`

Schema 设计原则：
- 所有 `additionalProperties: false`，严格拒绝未知字段
- 必须用 `$id` + `$schema`，可被 ajv 编译为 strict mode
- 大对象（页面）拆 `$defs` 复用
- 错误信息友好（自定义 `errorMessage` 让 AI 创建器能回灌）

### 9.3 评审清单（M0 出口）

- [ ] 用 5 个 mock manifest（覆盖 4 种设计模式 + 1 个反例）跑 schema 校验
- [ ] 老王/小敏的核心用户故事可在文档里走通（纸面演练）
- [ ] 所有 10 个决策点有明确选择（已完成）
- [ ] 所有 10 个开放问题有方向（已完成）
- [ ] 安全模型走查：3 个攻击场景能挡住（恶意 fs path、未声明 MCP、跨 app 数据读）
- [ ] DB 迁移 SQL 走 `migrations-app.ts` review
- [ ] AI 创建器 system prompt 草稿 + 工具集签名评审

---

## 10. 不做事项清单（明确边界）

下列事项**v1 一律不做**，避免范围蔓延：

- 内置/示例应用（用户用 AI 创建器自己造，不预置）
- 代码应用 / SDK / 沙箱（M6+）
- 应用市场（M7+）
- 多用户/多账号 / 团队协作
- 跨设备同步
- 应用付费/订阅/分成
- 应用签名 + 证书校验
- 应用之间通信
- i18n 强制
- 应用主题/换肤
- 视觉化拖拽编辑器（永远不做，让位给 AI 创建器 + JSON）
- web 端（Lumos 仅桌面端）

---

## 11. 下一步

1. **本周**：本文档 + `app-platform-architecture.md` 评审定稿
2. **下周**：M0 Schema 编写 + DB 迁移 PR
3. **2 周后**：两条线并行启动
   - **平台基础线**（M1-M3）：parser → installer → 渲染器 → workflow 集成
   - **AI 创建器线**（B0-B2）：能力探测 → 单文件生成 → 完整流程 + 4 模式
4. **第一次内部 dogfooding（约 8-10 周后）**：用 AI 创建器从 0 造一个真实应用并跑通；此时 AI 创建器只支持模式 1（输入-处理-输出），其他模式增量补
5. **MVP 完整发布（约 14-19 周后）**：AI 创建器 B7 完整、4 模式全覆盖、模板库就位
