# DeepSearch 架构设计文档

## 0. 编号结论

`08` 建议定义为 Lumos 的 **DeepSearch 独立模块**。

本主题的主文档为：

- `08-deepsearch-requirements-design.md`
- `08-deepsearch-architecture-design.md`

另外可继续追加补充文档，例如：

- `08-deepsearch-bb-browser-integration-design.md`
- `08-deepsearch-deployment-and-local-usage-design.md`
- `08-deepsearch-phase-1-implementation-design.md`
- `08-deepsearch-ui-and-interaction-design.md`
- `08-deepsearch-data-and-api-design.md`
- `08-deepsearch-engineering-implementation-design.md`

`08` 不应直接并入：

- `03 Scheduling Layer`
- `05 Workflow Engine`
- `06 SubAgent Layer`
- `07 Dynamic Capability Extension`

因为它同时覆盖：

- 独立产品 UI
- 站点登录态管理
- 基于共享浏览器上下文的执行能力
- 对话侧工具调用
- Workflow 侧能力复用

它本质上是一个**独立模块 + 多入口复用服务**。

---

## 1. 核心架构判断

### 1.1 DeepSearch 必须先独立，不先耦合 Workflow

正确顺序是：

1. 先实现独立 `DeepSearch Service`
2. 先实现独立 UI 与登录态主链
3. 再暴露给聊天
4. 最后暴露给 Workflow

错误顺序是：

1. 先把 DeepSearch 写成 Workflow 专用能力
2. 再倒推补 UI 和登录态

后者会造成：

- 运行态和产品态耦合过深
- 登录阻塞难恢复
- 结果与证据难以独立验收
- 对话与 Workflow 不能自然复用同一份状态

### 1.2 复用现有共享浏览器，但不直接暴露底层运行时

DeepSearch 要复用 Lumos 现有能力：

- 内置浏览器共享 Session / Cookie
- Browser bridge
- Chrome DevTools MCP

但这只是**底座**，不是对外接口。

对外接口必须是高层 DeepSearch service，而不是直接暴露：

- `BrowserManager`
- browser bridge HTTP 路由
- 低级浏览器 click/fill/evaluate 操作

### 1.3 LLM 看到的是高层工具，不是脚本执行器

LLM 应该调用：

- `deepsearch.start`
- `deepsearch.get_result`
- `deepsearch.pause`
- `deepsearch.resume`
- `deepsearch.cancel`

而不是：

- 直接拼 `browser.navigate + snapshot + evaluate`
- 直接控制底层页面行为

---

## 2. 总体架构

```text
用户 / 聊天 / Workflow
        ↓
DeepSearch Entry Layer
  - DeepSearch UI
  - Chat Tool Facade
  - Workflow Capability Facade
        ↓
DeepSearch Service
  - run lifecycle
  - login gating
  - result shaping
  - artifact coordination
        ↓
├── Site Session Manager
├── Search Strategy Planner
├── Browser Runtime Adapter
├── Content Extraction Pipeline
├── Evidence Builder
├── Run Repository
└── Artifact Repository
        ↓
Lumos Built-in Browser Runtime
  - BrowserManager
  - shared session partition
  - browser bridge
  - chrome-devtools MCP
```

---

## 3. 模块拆分

## 3.1 DeepSearch Service

这是对外唯一正式服务层。

职责：

- 创建和管理 DeepSearch run
- 在执行前检查站点登录态
- 根据查询和站点选择执行策略
- 编排浏览器访问、抽取和证据生成
- 输出统一结果结构
- 对外暴露可恢复状态机

不负责：

- 直接持有浏览器实现细节
- 直接负责 UI
- 直接负责 LLM 对话逻辑

## 3.2 Site Session Manager

职责：

- 检查某站点在共享浏览器上下文中的登录态
- 返回 `connected / suspected_expired / expired / missing / error`
- 打开站点登录页
- 登录完成后重新验证
- 当执行被登录态阻塞时，生成可恢复状态

关键判断：

- 登录态管理应按“站点”组织
- 后续如有必要再扩展到“站点 + 账号”

## 3.3 Browser Runtime Adapter

职责：

- 把 DeepSearch 的高层执行意图映射到现有浏览器底座
- 支持两种正式页面模式
  - `takeover_active_page`
  - `managed_page`
- 负责 tab/page 的选择、创建、切换和恢复
- 在正式执行前显式绑定 `runId + pageId`
- 封装 snapshot / evaluate / screenshot / wait 等能力

它依赖现有：

- `BrowserManager`
- browser bridge
- 内置 chrome-devtools MCP

但对 DeepSearch 上层隐藏这些实现细节。

关键约束：

- 允许正式接管用户当前浏览器中的活动页
- 允许复用已经绑定到当前 run 的受管页
- 不允许按域名隐式挑一个 tab 执行

## 3.4 Site Adapter Registry

职责：

- 维护 `native adapter / compatible adapter` 元数据
- 声明站点需要的登录前置条件和推荐页面模式
- 声明站点支持的任务类型、提取策略和审查状态
- 为 Search Strategy Planner 和 Site Adapter Runtime 提供统一站点能力目录

## 3.5 Search Strategy Planner

职责：

- 根据站点类型、任务目标、登录态和页面形态选择执行策略
- 根据 `strict / best_effort` 选择站点失败处理方式
- 例如：
  - 搜索入口页策略
  - 站内搜索结果列表策略
  - 详情页正文抽取策略
  - 分页 / 滚动 / 展开策略

注意：

- 它不是全局调度层 `03` 的替代品
- 它只负责 DeepSearch 模块内部的搜索执行策略

## 3.6 Site Adapter Runtime

职责：

- 在显式绑定的 run/page 上执行站点适配器
- 统一翻译站点内部错误、登录问题和风控问题
- 把 adapter 原始结果交给内容抽取和证据构建层

## 3.7 Content Extraction Pipeline

职责：

- 从真实页面中抽取正文、摘要、标题、作者、发布时间等信息
- 对不同页面类型做统一结构化输出
- 区分“只拿到列表摘要”和“拿到完整正文”
- 记录页面级失败原因

## 3.8 Evidence Builder

职责：

- 生成页面级证据包
- 保存截图
- 保存文本摘录
- 保存来源 URL 和抓取时间
- 对最终结果提供“可追溯证据集合”

## 3.9 Run Repository

职责：

- 持久化 run 状态
- 支持历史记录查询
- 支持恢复和重跑
- 支持 UI / 聊天 / Workflow 读取相同运行结果

## 3.10 Artifact Repository

职责：

- 保存正文内容
- 保存截图
- 保存结构化结果 JSON
- 为详情页和聊天结果提供统一读取入口

## 3.11 Tool Facade

职责：

- 向主 Agent / 对话层暴露高层 tool
- 负责把 service 结果转成 LLM 友好的结构化响应

## 3.12 Workflow Facade

职责：

- 把 DeepSearch Service 暴露成一个 Workflow capability
- Workflow 只消费 service，不直接消费底层浏览器

## 3.13 模块执行顺序与所有权

正式主链建议固定为：

1. `Search Strategy Planner`
   - 负责把任务目标拆成站点级执行计划，并产出 strictness/page mode 决策
2. `Browser Runtime Adapter`
   - 负责拿到本次 run 要使用的页面，并完成 `runId + pageId` 绑定
3. `Site Session Manager`
   - 负责在已绑定页面上判断登录态是否满足执行前提
4. `Site Adapter Runtime`
   - 负责执行站点适配器，产出原始抓取结果
5. `Content Extraction Pipeline`
   - 负责把原始抓取结果归一为页面级内容结构
6. `Evidence Builder`
   - 负责形成证据摘录、截图和失败证据
7. `Artifact Repository`
   - 负责落长正文、截图、结构化结果和其他大对象
8. `Run Repository`
   - 负责回写 run 状态、checkpoint、计数器和最终摘要

这样可以避免：

- Planner 越权直接操作浏览器
- Adapter Runtime 越权决定最终状态
- Evidence / Artifact / Run 状态互相写乱

---

## 4. 对外形态选择

## 4.1 核心形态：内置模块

DeepSearch 的核心形态必须是内置模块 / service。

原因：

- 它要直接复用 Lumos 内置浏览器共享上下文
- 它需要稳定的运行态、artifact 和结果存储
- 它要被多个入口统一复用

## 4.2 不适合用 skill 作为核心形态

skill 只适合提示、工作方法或知识扩展，不适合：

- 登录态管理
- 抓取状态机
- 证据持久化
- 可恢复执行

## 4.3 MCP 作为可选 facade，而不是第一落点

后续如果需要把 DeepSearch 暴露给更多外部 Agent，可提供一层薄 MCP facade。

但 MCP 只应是：

- 统一输入输出协议层

而不是：

- 核心实现所在层

---

## 5. 数据模型

## 5.1 SiteConnection

```ts
interface SiteConnection {
  siteId: string;
  displayName: string;
  loginState:
    | 'missing'
    | 'connected'
    | 'suspected_expired'
    | 'expired'
    | 'error';
  lastCheckedAt?: string;
  lastLoginAt?: string;
  blockingReason?: string;
}
```

## 5.2 DeepSearchRun

```ts
interface DeepSearchRun {
  id: string;
  query: string;
  goal: 'browse' | 'evidence' | 'full-content' | 'research-report';
  sites: string[];
  pageMode: 'takeover_active_page' | 'managed_page';
  strictness: 'strict' | 'best_effort';
  maxPages: number;
  maxDepth: number;
  keepEvidence: boolean;
  keepScreenshots: boolean;
  status:
    | 'pending'
    | 'running'
    | 'waiting_login'
    | 'paused'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockedSiteIds?: string[];
  checkpointId?: string;
  pageCount: number;
  evidenceCount: number;
  summary?: string;
  error?: string;
}
```

## 5.3 DeepSearchRunPage

```ts
interface DeepSearchRunPage {
  id: string;
  runId: string;
  pageId: string;
  siteId?: string;
  bindingType: 'taken_over_active_page' | 'managed_page';
  role: 'seed' | 'search' | 'detail' | 'login';
  attachedAt: string;
  releasedAt?: string;
  lastKnownUrl?: string;
}
```

## 5.4 DeepSearchCheckpoint

```ts
interface DeepSearchCheckpoint {
  id: string;
  runId: string;
  stage:
    | 'planning'
    | 'login_gate'
    | 'site_execution'
    | 'content_extraction'
    | 'finalizing';
  nextSiteIds: string[];
  completedSiteIds: string[];
  skippedSiteIds: string[];
  blockedSiteIds: string[];
  resumeToken?: string;
  updatedAt: string;
}
```

## 5.5 DeepSearchRecord

```ts
interface DeepSearchRecord {
  id: string;
  runId: string;
  runPageId: string;
  siteId: string;
  url: string;
  title?: string;
  contentState: 'list-only' | 'partial' | 'full' | 'failed';
  snippet?: string;
  evidenceCount: number;
  failureStage?: 'login' | 'navigation' | 'extraction' | 'normalization';
  loginRelated?: boolean;
  contentArtifactId?: string;
  screenshotArtifactId?: string;
  fetchedAt: string;
  error?: string;
}
```

## 5.6 DeepSearchArtifact

```ts
interface DeepSearchArtifact {
  id: string;
  runId: string;
  recordId?: string;
  kind:
    | 'content'
    | 'screenshot'
    | 'structured-json'
    | 'evidence-snippet'
    | 'network-trace'
    | 'html-snapshot';
  path: string;
  metadata?: Record<string, unknown>;
}
```

---

## 6. 核心状态机

```text
pending
  ↓
running
  ↓
├── waiting_login
│     ↓ 登录校验通过 + resume
│   pending
│
├── paused
│     ↓ resume
│   pending
│
├── completed
├── partial
├── failed
└── cancelled
```

关键要求：

- `waiting_login` 不是报错兜底，而是正式状态
- `paused` 是正式人工暂停状态
- `partial` 用于 `best_effort` 模式下“部分站点成功、部分失败或阻塞”的场景
- `resume` 是动作，不是单独状态；恢复后回到 `pending`

## 6.1 严格度矩阵

任务级 `strictness` 必须进入正式运行语义：

- `strict`
  - 关键站点登录不满足时，直接进入 `waiting_login`
  - 关键站点执行失败时，直接 `failed`
- `best_effort`
  - 能跑的站点继续跑
  - 失败或阻塞站点记录到 checkpoint 和 detail
  - 最终只要有目标站点未完成，就收口为 `partial`

## 6.2 页面归属策略

页面绑定必须明确区分：

- `takeover_active_page`
  - 正式接管用户当前浏览器中的活动页
  - 适合用户已手动打开目标页面、希望沿当前上下文继续执行
- `managed_page`
  - 由 DeepSearch 创建和维护页面
  - 适合批量抓取和减少对用户当前浏览过程的干扰

无论哪种模式，都必须：

- 显式创建 `DeepSearchRunPage`
- 把后续证据、失败、日志和 artifact 绑定回该 run page
- 禁止按域名自动挑 tab

## 6.3 存储枚举与 UI 文案映射

为避免前后端各自发明状态名，建议明确以下映射：

- Run status
  - `pending` -> `等待开始`
  - `running` -> `运行中`
  - `waiting_login` -> `等待登录`
  - `paused` -> `已暂停`
  - `completed` -> `已完成`
  - `partial` -> `部分完成`
  - `failed` -> `失败`
  - `cancelled` -> `已取消`
- Site connection
  - `missing` -> `未连接`
  - `connected` -> `已连接`
  - `suspected_expired` -> `疑似过期`
  - `expired` -> `已失效`
  - `error` -> `检查失败`

---

## 7. 核心执行流程

## 7.1 UI 直接使用

```text
DeepSearch 页面发起任务
  ↓
DeepSearch Service 创建 run
  ↓
选择页面模式
  ↓
├── 接管当前活动页：绑定当前 active `pageId`
└── 新建受管页：创建受管 `pageId`
  ↓
检查目标站点登录态
  ↓
├── strict 且关键站点未登录：标记 waiting_login，返回登录引导
└── 已满足执行条件：进入搜索执行
          ↓
      浏览器访问 / 内容抽取 / 证据留存
          ↓
      结果持久化
          ↓
      完成 / partial / failed
          ↓
      UI 展示摘要、记录和详情
```

## 7.2 登录恢复

```text
run 进入 waiting_login
  ↓
用户点击“去登录”
  ↓
共享浏览器打开登录页
  ↓
Site Session Manager 重新检查站点状态
  ↓
更新 checkpoint
  ↓
用户或系统触发 resume
  ↓
run 回到 pending
  ↓
继续执行剩余站点和剩余步骤
```

## 7.3 LLM 调用

```text
LLM 调用 deepsearch.start
  ↓
Tool Facade 调用 DeepSearch Service
  ↓
返回结构化状态
  ↓
如果 waiting_login，则提示用户登录而不是盲重试
  ↓
LLM 通过 deepsearch.get_result / pause / resume 继续读取结果和控制 run
```

## 7.4 Workflow 调用

```text
Workflow capability step
  ↓
Workflow Facade
  ↓
DeepSearch Service
  ↓
统一 run / artifact / result
```

---

## 8. 与现有 Lumos 的集成边界

## 8.1 与内置浏览器

DeepSearch 必须复用现有共享浏览器上下文，而不是新起一套无状态 Playwright 浏览器。

收益：

- 可复用登录态
- 用户可手动介入登录和验证
- 对话、手动浏览、DeepSearch 共享同一真实页面运行时

正式页面策略进一步要求：

- 支持正式接管当前活动页
- 支持新建受管页
- 任何执行都必须在显式绑定的 `runId + pageId` 上发生

## 8.2 与浏览器 bridge

DeepSearch 不直接暴露 bridge，但内部通过 adapter 复用现有 bridge 能力。

## 8.3 与聊天

聊天层不负责实现抓取，只负责：

- 发起调用
- 处理状态
- 展示摘要
- 指导用户登录或查看详细结果

## 8.4 与 Workflow

Workflow 不承载 DeepSearch 内部逻辑。

Workflow 只做：

- 调用 DeepSearch
- 消费 DeepSearch 结果
- 与其他能力编排

---

## 9. 结果展示策略

为避免 DeepSearch 结果分散在多个入口，建议统一：

- 详情页以 `DeepSearch` 模块自己的 run detail 为主
- 聊天只展示摘要和可点击详情入口
- Workflow 只展示能力调用摘要和 artifact 引用

这样用户不会在三个界面里分别找“正文在哪、截图在哪、失败在哪”。

---

## 10. 安全与治理边界

## 10.1 登录态边界

- 只复用 Lumos 自身共享浏览器上下文
- 不要求用户手动导入 Cookie 作为主链
- 外部工具读取 Cookie 仍应经过明确权限控制

## 10.2 执行边界

- DeepSearch 可执行受控浏览器动作与抽取逻辑
- 不开放任意脚本执行作为正式主链能力
- 对 `evaluate` 类能力需保留白名单和执行边界

## 10.3 证据边界

- 保留页面来源、时间、截图与正文来源
- 对敏感查询参数和表单内容继续做脱敏

---

## 11. Phase 规划

### Phase 1：独立模块可用

- DeepSearch Service
- Site Session Manager
- DeepSearch UI 正式页
- Run / Artifact 持久化
- `takeover_active_page / managed_page`
- `strict / best_effort`
- Chat Tool Facade

### Phase 2：结果质量增强与 Workflow 复用

- 更多站点策略
- 更稳定的正文提取
- Workflow capability facade
- 更细的 run 状态回写
- 统一 artifact 展示

### Phase 3：外部形态与高级治理

- MCP facade
- 配额、限流、审计
- 更强的站点策略管理

---

## 12. 当前结论

DeepSearch 的正确架构形态是：

- **核心：独立内置模块 / service**
- **底座：复用现有共享浏览器与 bridge**
- **入口：独立 UI**
- **页面：正式支持接管当前活动页或新建受管页**
- **执行：正式区分 `strict` 与 `best_effort`，非严格模式下可返回 `partial`**
- **复用：聊天 tool + Workflow capability**
- **MCP：后续可选 facade**

如果一开始就把它写成 Workflow 专属能力，会把产品入口、登录态管理、执行状态和结果展示全部绑死在任务主链里，无法成为一个真正可用的系统能力。
