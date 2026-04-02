# DeepSearch 与 bb-browser 结合评估与集成方案设计文档

## 0. 文档定位

本文是 `08 DeepSearch` 的补充方案文档，用于回答一个单独问题：

- Lumos 的 DeepSearch 是否应直接结合 `bb-browser`
- 如果要结合，应该以什么边界和方式结合
- 哪些能力值得吸收，哪些形态不应直接引入

本文不替代以下两份主文档：

- `08-deepsearch-requirements-design.md`
- `08-deepsearch-architecture-design.md`

而是补充回答 `Browser Runtime Adapter` 的一个关键技术选型问题。

---

## 1. 问题背景

当前 `08 DeepSearch` 的核心目标是：

- 复用 Lumos 内置浏览器的共享登录态
- 针对反爬站点提供更稳定的深度研究能力
- 先形成独立模块和独立 UI
- 后续再让聊天与 Workflow 复用

在这个背景下，`bb-browser` 提供了一个有参考价值的方向：

- 以真实浏览器登录态驱动网站操作
- 提供 `fetch / eval / snapshot / network` 等浏览器原语
- 提供 `site adapter` 体系，把网站能力收敛成高层命令
- 提供 CLI 与 MCP 两种调用入口

因此需要明确：Lumos 是否应直接接入 `bb-browser`，还是只吸收其部分设计。

---

## 2. 评估结论

结论先行：

- **不建议把 `bb-browser` 原样作为 Lumos DeepSearch 的核心浏览器运行时**
- **建议把 `bb-browser` 作为能力样板，吸收其 `site adapter + session fetch + compact snapshot/ref + network reverse engineering` 设计**
- **Lumos 的正式主链仍应建立在现有内置浏览器、共享 Session、browser bridge 和 DeepSearch 自有 run/artifact/UI 体系之上**

这意味着：

1. DeepSearch 的正式运行时仍然是 Lumos 内置浏览器
2. DeepSearch 不应依赖第二套受管 Chrome 或外置扩展链路
3. `bb-browser` 最适合被吸收的是“站点适配器思维”和“浏览器上下文能力原语”

---

## 3. 评估依据

### 3.1 `bb-browser` 的优势方向是正确的

`bb-browser` 的核心价值与 DeepSearch 目标高度相关：

- 它强调复用真实浏览器登录态，而不是新开 headless browser
- 它强调在页面上下文中执行 `fetch`，自动复用 Cookie / Session
- 它强调站点级 adapter，而不是每次都让 LLM 从零操作浏览器
- 它强调通过 `network` 和 `eval` 辅助逆向站点内部接口

这些能力对知乎、B 站、小红书等反爬站点尤其有价值。

### 3.2 但它的运行时边界与 Lumos 当前主线不一致

`bb-browser` 当前主要面向：

- 独立 CLI
- 独立 MCP server
- Chrome / Arc / Edge 这类外部浏览器
- Chrome 扩展或外部 CDP 连接

而 Lumos 当前 DeepSearch 主线要求的是：

- Electron 内置浏览器
- 与 Lumos UI 同页可见的共享页面实例
- Lumos 自己的登录态检查与恢复流程
- Lumos 自己的 run / artifact / detail view 持久化

如果直接引入 `bb-browser`，会在产品内部出现第二套浏览器运行时。

### 3.3 直接引入会破坏“共享登录态”这个最关键目标

DeepSearch 的核心前提是：

- 用户在 Lumos 里登录
- DeepSearch 复用同一套 Session / Cookie

而 `bb-browser` 默认具备自己的浏览器发现与受管浏览器启动逻辑，通常会落到另一套浏览器 profile。

这会带来直接问题：

- Lumos 里已经登录，不代表 `bb-browser` 那边已经登录
- 用户需要维护两套登录态
- “在 DeepSearch UI 里检查登录态”会和实际执行浏览器不一致
- UI 上看似已连接，但实际抓取仍可能失败

这与 `08` 当前的产品设计目标冲突。

### 3.4 `bb-browser` 的高价值部分其实不是“整套产品”，而是“能力模型”

对 Lumos 来说，真正有价值的不是把 `bb-browser` 整包嵌进来，而是吸收下面四类能力：

- `site adapter`
- 页面上下文 `fetch with session`
- `compact snapshot + ref` 交互方式
- `network capture / reverse engineering`

这些能力可以被迁移进 Lumos 的 `Browser Runtime Adapter`，而不必引入其完整 CLI / daemon / extension / managed browser 体系。

### 3.5 基于源码复核后，当前更精确的结论是“兼容 adapter”，而不只是“借鉴思路”

这一轮结合源码复核后，结论比前一版更具体：

- Lumos 不是只需要借鉴 `bb-browser` 的理念
- 而是应该在内部实现一个**兼容 `bb-site adapter` 形态的运行时**

原因是：

- `bb-browser` 的 `site adapter` 本质上就是页内执行的 `async function(args) { ... }`
- 它的核心依赖主要是浏览器原生对象：
  - `fetch`
  - `window`
  - `document`
  - `document.cookie`
- 它的输入是 JSON 参数
- 它的输出是 JSON 可序列化结构

因此：

- 对大量 Tier 1 / Tier 2 adapter 来说，Lumos 不需要引入 `bb-browser` 整套运行时
- 只需要提供一个**受控的页内函数执行器**
- 再加一个**受控的 adapter registry / review / publish 流程**
- 就可以吸收其最核心的站点适配能力

### 3.6 当前 Lumos 与 `bb-browser` 的真实差距，不在“能不能 evaluate”，而在两层运行时能力

结合源码，Lumos 当前已经具备：

- 通用 `Runtime.evaluate`
- 通用 `Page.captureScreenshot`
- 通用 cookie / session 访问
- 通用 CDP 命令发送

但真正落差最大的，是下面两层：

#### A. 更稳定的 compact snapshot / ref 模型

Lumos 当前 snapshot 更接近：

- 向页面临时注入 `data-lumos-uid`
- 基于当前 DOM 生成一批临时节点编号
- 后续根据该编号执行 click / fill

这存在明显限制：

- DOM 小幅刷新后 ref 很容易失效
- 缺少 backend node 级别的稳定定位
- 不适合复杂页面的多轮研究交互

而 `bb-browser` 已经把这一层推进到更适合 agent 的 compact snapshot / ref 结构。

但这层也需要更精确地理解：

- `bb-browser` 不是单一一种 ref 模型
- CLI 主路径当前仍大量使用 `highlightIndex -> xpath -> backendNodeId` 的解析链
- extension / CDP DOM service 才更接近 `backendDOMNodeId + xpath fallback`

因此 Lumos 不应把目标表述成“照搬 AX snapshot”：

- 更准确的目标是做一套 **compact snapshot + stable ref**
- Phase 1 可以接受 `backendNodeId 优先，xpath fallback`
- 但不应继续停留在仅靠临时 DOM attribute 的方案

#### B. 长生命周期的 CDP 事件观察层

Lumos 现在能发 CDP 命令，但还没有正式的长期事件观察层去承接：

- `Network.requestWillBeSent`
- `Network.responseReceived`
- `Runtime.consoleAPICalled`
- 页面级异常

这意味着：

- `network capture` 不是补几个 bridge endpoint 就够
- 需要增加长期监听、缓存、过滤、回收和按页面隔离的数据层

这里还有一个更深的差异：

- `bb-browser` 的 monitor 更偏浏览器级事件池
- 它的长期状态并不是天然按 `DeepSearch run / page / step` 维度隔离

而 Lumos 的正式 DeepSearch 需要的不是“浏览器里最近发生过什么”，而是：

- 某次 DeepSearch run 绑定了哪些页面
- 某个页面在该 run 中发生了哪些请求/报错/console 事件
- 哪些证据可以安全展示给用户

### 3.7 `bb-browser` 里真正值得吸收的是哪部分，也要分成熟度

结合源码，当前更值得吸收的是：

- `site adapter`
- `fetch with session`
- `compact snapshot / ref`
- `network requests` 记录

而不值得在 `08` Phase 1 直接吸收的包括：

- MCP 入口本身
- 受管浏览器
- daemon / extension 运行时
- 通用请求拦截 / mock

也就是说：

- 应优先吸收“能拿数据”和“能稳定理解页面”的能力
- 不应优先吸收“浏览器自动化工具箱”的全部表面积

### 3.8 `bb-browser MCP` 不是适合集成的层

结合源码，`bb-browser` 当前出现了一个重要分层现实：

- CLI 主路径更偏 direct CDP
- MCP 入口仍然是 daemon / extension 风格

这说明：

- 它自己的 MCP 不是最贴近核心能力的抽象层
- Lumos 如果直接对接它的 MCP，本质上是在对接一层较外围的包装面

因此：

- `bb-browser MCP` 只适合做外部实验
- 不适合做 DeepSearch 的正式集成界面

### 3.9 还有四个容易在设计上遗漏的运行时细节

#### A. 正式主链不能采用“按域名自动找 tab”

`bb-browser` 的 adapter 默认行为是：

- 如果没有显式指定 tab，就按 domain 查找一个匹配 tab
- 找不到再自动新开 tab

这对 CLI 很方便，但对 Lumos DeepSearch 是危险的：

- 同域名可能存在多个页面状态
- 用户可能在同一站点同时打开不同账号、不同组织、不同内容上下文
- DeepSearch run 的证据链会变得不可追踪

因此 Lumos 正式主链必须要求：

- 每次 DeepSearch run 显式绑定自己的 `pageId`
- adapter/runtime 只在该 `pageId` 上执行
- 不允许在正式链路里隐式“找一个同域名页面凑合执行”

#### B. 登录态判定不能依赖错误字符串启发式

`bb-browser` 当前对登录问题的提示，很大程度上基于：

- adapter 返回 `{ error, hint }`
- 再用 `401|403|unauthorized|login|required|auth` 一类正则去猜是不是登录问题

这作为 CLI 友好提示可以接受，但作为 Lumos 产品主链不够：

- 会误把限流、风控、接口升级当成登录失效
- 也会漏掉“页面仍可访问，但正文被折叠/截断/匿名化”的半失效状态

因此 Lumos 需要：

- 独立的 `checkLoginState(site, pageId)` 主链
- 站点级登录探针
- `已连接 / 疑似过期 / 已失效 / 检查失败` 这类产品态，而不只是错误文案映射

#### C. 结果回传不能假设单次 `evaluate(returnByValue)` 足够

无论是 Lumos 还是 `bb-browser`，当前很多能力都依赖：

- `Runtime.evaluate`
- `returnByValue: true`

这适合：

- 小型结构化 JSON
- 小型页面摘录

但不适合直接承载：

- 长篇正文
- 多页聚合结果
- 大型中间证据

因此 DeepSearch 正式链路还要明确：

- adapter/runtime 的“控制返回值”只用于状态、摘要、结构化元数据
- 大正文、HTML、截图、原始响应、抽取证据应落入 artifact / evidence 存储
- UI 与 LLM 读取的应是 artifact 引用，而不是大 JSON 直返

#### D. Adapter 执行世界需要显式区分模式

`bb-browser` 当前 adapter/eval 路径本质上是在页面主世界执行。

这带来两面性：

- 好处：容易访问页面内部 token、store、webpack module
- 风险：会受页面 monkey patch、风控脚本、覆盖过的 `fetch` / 原型链影响

因此 Lumos 应在设计上明确两种模式：

- `site-context mode`
  - 与页面主世界尽量一致
  - 用于 Tier 2 / 特定站点 token 提取
- `isolated-safe mode`
  - 尽量减少对页面运行时污染和反向污染
  - 用于通用抓取、探针和只读抽取

---

## 4. 与 Lumos 当前架构的关系判断

### 4.1 可直接复用的仍然是 Lumos 现有浏览器底座

DeepSearch 当前更适合继续建立在 Lumos 现有底座之上：

- `BrowserManager`
- `persist:lumos-browser` 共享 session partition
- browser bridge
- 基于 CDP 的 `navigate / evaluate / screenshot` 能力

这是因为：

- 它已经与产品 UI 在同一运行时里
- 它天然共享 Lumos 登录态
- 它更容易接入 DeepSearch 页的登录检查、运行记录与详情页

### 4.2 `bb-browser` 更适合作为 `Browser Runtime Adapter` 的设计来源

对 `08` 而言，`bb-browser` 应被视为以下模块的设计参考：

- `Browser Runtime Adapter`
- `Search Strategy Planner`
- 站点级执行策略

而不是：

- DeepSearch 的核心执行主链
- DeepSearch 的正式 UI 入口
- Lumos 的唯一浏览器接口

### 4.3 对 LLM 的调用形态仍不应暴露为 `bb-browser` 命令集合

Lumos 内部最终不应该让 LLM 直接面向这些低层调用：

- `browser_snapshot`
- `browser_click`
- `browser_eval`
- `site_run`

DeepSearch 对 LLM 的正式接口仍应保持为高层能力，例如：

- `deepsearch.start`
- `deepsearch.get_result`
- `deepsearch.pause`
- `deepsearch.resume`
- `deepsearch.cancel`

这样才能保证：

- 登录态阻塞能被统一处理
- 运行态能进入统一的 DeepSearch run 状态机
- 结果能进入统一的 artifact / evidence 展示

### 4.4 更精确的结合方式：不是“接入 bb-browser”，而是“在 Lumos 内兼容 bb-site adapter”

这是这轮 review 后最重要的新收敛：

- 推荐结合方式不是把 `bb-browser` 当成外部浏览器工具接进来
- 而是在 Lumos 内部实现一个 **`bb-site compatibility runtime`**

它的目标不是完全兼容 `bb-browser` 的全部命令，而是兼容它最有价值的那部分：

- adapter 元数据
- `async function(args)` 适配器形态
- 浏览器页内 `fetch / DOM / cookie` 执行方式
- 标准错误返回格式

这样做的好处是：

- 可以吸收其 adapter 生态思维
- 不需要引入第二套浏览器运行时
- 运行结果天然回到 DeepSearch 的 run / artifact / UI 主链

---

## 5. 备选结合方式评估

## 5.1 方案 A：直接把 `bb-browser MCP` 接进 Lumos

### 方案描述

- 在 Lumos 内新增一个 MCP server 配置
- 让聊天或 Workflow 直接调用 `bb-browser` 暴露的 MCP tools

### 好处

- 接入快
- 现成有 `snapshot / click / eval / site_run`
- 便于快速做实验

### 坏处

- MCP 调用的是 `bb-browser` 的工具语义，不是 DeepSearch 语义
- 登录态和执行浏览器可能与 Lumos UI 不一致
- 无法自然接入 DeepSearch 的 run / artifact / detail view
- 容易把 DeepSearch 退化成“LLM 直接操作浏览器”
- 对用户来说产品心智混乱

### 结论

- **不建议作为正式主链**
- 仅可作为内部实验或对比验证手段

## 5.2 方案 B：把 `bb-browser` 作为外部 sidecar runtime

### 方案描述

- Lumos DeepSearch service 作为主调度层
- 某些站点访问由外部 `bb-browser` 进程负责
- 通过 CLI / RPC 拉回结果

### 好处

- 可以较快复用其 `site adapter`
- 对站点接入初期可能省一部分实现时间

### 坏处

- 运行时边界复杂
- 登录态对齐困难
- 调试和问题定位成本高
- 需要长期维护协议兼容与进程管理
- 会让 Lumos 同时维护两套浏览器语义

### 结论

- **不建议作为 Phase 1 正式方案**
- 仅在某些极特殊站点上，后续可作为临时桥接策略评估

## 5.3 方案 C：吸收其设计并内建到 Lumos

### 方案描述

- Lumos 保持现有内置浏览器为唯一正式运行时
- 在 `Browser Runtime Adapter` 内补齐 `fetch / compact snapshot / network capture`
- 在 DeepSearch 内新增站点级 `adapter registry`
- 在 Lumos 内新增 `bb-site compatibility runtime`
- 用 Lumos 自己的 run / artifact / UI 体系承接结果

### 好处

- 与 Lumos 登录态完全对齐
- 与产品 UI 完全对齐
- 与 DeepSearch run 状态机完全对齐
- 后续聊天 / Workflow 可统一复用
- 架构边界清晰，可长期维护

### 坏处

- 初期实现量更大
- 需要自己补齐 adapter runtime 和治理能力

### 结论

- **这是推荐方案**

---

## 6. 推荐集成方案

## 6.1 总体原则

推荐方案是：

- **Lumos 保留内置浏览器为唯一正式执行底座**
- **在 Lumos 内部吸收 `bb-browser` 的高价值能力模型**
- **DeepSearch 统一对外暴露高层服务接口**

总体形态如下：

```text
DeepSearch UI / Chat / Workflow
        ↓
DeepSearch Service
        ↓
DeepSearch Browser Adapter Layer
  - session fetch
  - compact snapshot / ref
  - network capture
  - controlled eval
  - site adapter runtime
  - bb-site compatibility runtime
        ↓
Lumos Built-in Browser Runtime
  - BrowserManager
  - shared session partition
  - browser bridge
  - CDP
```

### 6.1.1 `bb-site compatibility runtime` 的定义

这是 Lumos 内部新增的一层兼容运行时，目标是：

- 在 Lumos 当前页面上下文里运行受控 adapter
- 尽量兼容 `bb-browser` 的 adapter 组织形式
- 但不引入其 CLI / MCP / daemon / extension 体系

建议执行合同：

- 输入：
  - `adapterMeta`
  - `args`
  - `siteContext`
  - `pageId`
  - `runId`
  - `pageMode`
- 执行环境：
  - 浏览器页内 JS
  - 可访问 `fetch / document / window / location / document.cookie`
- 输出：
  - 必须是 JSON 可序列化结果
  - 支持 `{ error, hint }` 结构
- 运行控制：
  - 超时
  - 取消
  - 结果大小限制
  - 调试日志摘录

这里建议再补四条硬约束：

- 必须显式绑定 `pageId`
  - 不允许兼容 `bb-browser` 的“自动按 domain 找 tab”语义进入正式主链
  - 允许 `takeover_active_page`，但必须是显式接管当前活动页，而不是自动猜测
- 必须显式绑定 `runId`
  - 产物、日志、网络证据都要能追溯到某次 DeepSearch run
- 必须声明执行模式
  - `site-context mode` 或 `isolated-safe mode`
- 必须声明输出策略
  - `inline summary` 或 `artifact-backed result`

## 6.2 应吸收的能力

### A. Site Adapter 体系

为 DeepSearch 增加站点级适配器概念，例如：

- `zhihu.search`
- `zhihu.question`
- `bilibili.search`
- `bilibili.video`

每个 adapter 负责：

- 站点内部入口选择
- 接口/页面优先策略
- 正文抽取规则
- 错误识别与登录提示

并进一步区分两类来源：

- `native adapter`
  - Lumos 自己维护和发布
- `compatible adapter`
  - 形态兼容 `bb-site`
  - 但必须经过 Lumos 导入、审查和发布

### B. Session Fetch 能力

在 Lumos 浏览器上下文内增加受控能力：

- `fetchWithSession(url, options, pageId?)`

它负责：

- 自动在已登录站点上下文中发起请求
- 自动携带站点 Cookie / Session
- 区分正文抓取与内部 API 请求

这是吸收 `bb-browser` 价值最高、且最应该最早落地的一层。

### C. Compact Snapshot / Ref 能力

在现有 snapshot 之外，补一套更适合 agent 的紧凑快照：

- 优先基于 CDP backend node / 可访问性树 / 结构化页面树
- 保留相对稳定的 `ref`
- 降低 token 消耗

这适合做：

- 登录页状态检查
- 轻量交互 fallback
- 页面结构粗粒度理解

这里的重点不是复刻 `bb-browser` 的命令名，而是把 Lumos 当前偏临时 `uid` 的 snapshot 升级为更稳定的 DeepSearch 运行时快照。

### D. Network Capture 能力

增加页面级网络观察能力：

- 请求列表
- 过滤
- 关键 body 抓取
- adapter 开发时的逆向辅助

这不是给 LLM 直接裸用的主链，而是：

- 给内部 adapter 开发
- 给 DeepSearch 策略诊断
- 给特定站点接入时做证据收集

但结合源码复核，当前不建议把以下内容放进 `08` Phase 1：

- 请求拦截
- mock response
- 通用 traffic rewrite

另外还必须补上三个实现约束，否则这层很容易从“调试能力”变成“安全漏洞”：

- **按 run/page 隔离**
  - 不能只有全局浏览器事件池
  - 必须能回答“这次 DeepSearch 的这个页面发过哪些请求”
- **预算与截断**
  - 需要限制请求数量、request body、response body、单页总缓存量
  - 否则长时间运行或高频站点会迅速膨胀
- **脱敏**
  - 默认不应把 `cookie / authorization / set-cookie / csrf token` 原样展示到正式 UI
  - 正式页应优先展示脱敏后的 headers/body 摘录

## 6.3 不应直接吸收的部分

以下部分不建议直接引入为 Lumos 正式主链：

- `bb-browser` 独立 CLI 交互模型
- `bb-browser` 独立 MCP tool 集合
- `bb-browser` 受管 Chrome 启动逻辑
- `bb-browser` Chrome extension / daemon 体系
- 外部社区 adapter 仓库直接执行

原因是：

- 它们与 Lumos 产品边界不一致
- 会引入第二套浏览器运行时
- 会扩大安全与治理面

---

## 7. 建议新增的 Lumos 模块

## 7.1 DeepSearch Browser Adapter Layer

这是 `08` 内部建议新增的一层，用于承接对 `bb-browser` 思路的吸收。

职责：

- 对现有 browser bridge 做能力增强
- 提供 DeepSearch 专用的受控浏览器原语
- 屏蔽底层 CDP / 页面管理细节

建议原语：

- `prepareRunPage(site, pageMode)`
- `attachActivePage(runId)`
- `checkLoginState(site)`
- `fetchWithSession(pageId, request)`
- `captureCompactSnapshot(pageId)`
- `runControlledEval(pageId, expression, mode)`
- `captureNetworkTrace(pageId, filters)`

这里还建议新增两项更细粒度原语：

- `runAdapterFunction(pageId, adapterSource, args, runtimePolicy)`
- `normalizeAdapterResult(rawResult, adapterMeta)`

这里建议再增加三项职责约束：

- `prepareRunPage(site, pageMode)` 只允许两种正式来源
  - 显式接管当前活动页
  - 复用已经绑定到当前 run 的受管页
- `checkLoginState(site)` 不能只看 HTTP 状态码，还要支持站点级页面探针
- `normalizeAdapterResult(...)` 要能把“大结果”自动转成 artifact 引用，而不是强塞回同步 JSON

## 7.2 Site Adapter Registry

职责：

- 维护站点 adapter 元数据
- 维护 adapter 版本
- 声明站点所需登录前置条件
- 声明站点支持的任务类型

建议元数据：

- `siteId`
- `displayName`
- `domains`
- `requiresLogin`
- `supportedActions`
- `preferredStrategy`
- `extractors`
- `adapterTier`
- `adapterSourceType`
- `reviewStatus`
- `runtimePolicy`

## 7.3 Site Adapter Runtime

职责：

- 运行站点适配器
- 调用底层浏览器原语
- 输出统一结构化结果
- 把站点内部错误翻译成 DeepSearch 语义错误

注意：

- Phase 1 不建议直接运行外部任意 JS adapter
- 应优先使用内置 adapter 或受控注册 adapter
- 更建议先支持两类 adapter：
  - Tier 1：纯 `fetch(credentials: include)` 适配器
  - Tier 2：读取 token / cookie / DOM 后发请求的适配器
- Tier 3：Webpack / Pinia / 内部状态注入类 adapter 不应直接进入正式主链

## 7.3.1 Adapter Tier 策略

结合 `bb-browser` 的 adapter 分层，Lumos 应明确执行策略：

### Tier 1

特征：

- 主要依赖浏览器登录态
- 主要通过 `fetch(..., { credentials: 'include' })` 获取数据

建议：

- 直接纳入 `08` Phase 1 / Phase 2 正式能力范围

### Tier 2

特征：

- 需要从 cookie / DOM 中取 token
- 需要拼接特定请求头

建议：

- 可以纳入正式能力
- 但必须经过站点级验证和受控审查

### Tier 3

特征：

- 依赖 Webpack 模块搜索
- 依赖 Vue / React 内部状态
- 依赖站点内部 store / queryId / minified export

建议：

- 不进入 `08` Phase 1 正式主链
- 仅作为内部实验能力或后续高级站点支持

原因：

- 维护成本高
- 风险高
- 易随站点前端发布波动失效

## 7.4 Adapter Development Toolkit

这是面向内部开发的工具层，而不是直接面向终端用户的产品层。

职责：

- 利用 `network capture` 辅助逆向
- 利用 `AX snapshot` 辅助页面结构观察
- 调试 adapter 结果

它可以后续做成内部调试页或开发命令，但不应替代正式 DeepSearch UI。

## 7.5 DeepSearch CDP Observer

这是本轮源码复核后建议显式补上的一个模块。

职责：

- 长期监听已附着页面的 CDP 事件
- 维护页面级 network 请求缓存
- 维护 console / error 诊断缓存
- 为 adapter 开发与 DeepSearch 调试提供统一观察数据

原因：

- 现有 Lumos CDP 层虽能发命令，但缺少正式的长期事件观察器
- `network capture` 若没有这一层，会持续退化成临时调试代码

### 7.5.1 DeepSearch CDP Observer 的正式状态维度

这一层不建议照搬 `bb-browser` 的 monitor state，而应至少按以下维度建模：

- `runId`
- `pageId`
- `siteId`
- `eventType`
- `timestamp`

这样才能在正式产品里稳定回答：

- 这次 DeepSearch 用了哪个页面
- 命中了哪些站点内部接口
- 哪个页面出现了登录失效、风控、CSR F/token 异常或脚本错误
- 哪些事件可以进入用户可见证据，哪些只进入内部调试日志

---

## 8. 安全与治理要求

如果吸收 `bb-browser` 的 adapter 思想，必须同步定义治理边界。

Phase 1 建议：

- 不直接执行社区远端 adapter 仓库
- 不允许 LLM 即时生成任意 adapter JS 并直接上线为正式主链
- adapter 只允许调用受控原语，不直接持有任意 Node / shell 权限
- adapter 结果必须进入统一 evidence / artifact 存储
- 兼容 `bb-site` 风格不等于直接信任 `bb-site` 源码
- 所有 compatible adapter 都应经过“导入 -> 审查 -> 发布”流程
- network / console / error 证据默认按脱敏视图展示
- 任何可能泄露登录态的 header / cookie / token 都不能直接进入正式用户 UI
- 不把“抓包原文”默认暴露给 LLM 主上下文

否则会出现：

- 运行权限失控
- 登录态滥用
- 难以追踪某次抓取到底执行了什么逻辑

---

## 9. 分阶段落地建议

## 9.1 Phase 1

目标：

- 保持 Lumos 内置浏览器为唯一执行底座
- 正式支持接管当前活动页，并绑定 `runId + pageId`
- 补齐 `session fetch`
- 补齐更稳定的 compact snapshot / ref
- 建立最小 `site adapter registry`
- 建立最小 `bb-site compatibility runtime`
- 建立 DeepSearch 专属 `pageId / runId` 显式绑定规则
- 建立最小 artifact-backed result 存储
- 为 1 到 2 个高价值站点落地内置 adapter

建议优先站点：

- `知乎`
- `B 站`

建议优先 adapter 范围：

- 只做 Tier 1 / Tier 2
- 不做 Tier 3

## 9.2 Phase 2

目标：

- 补齐 `network capture`
- 补齐 `DeepSearch CDP Observer`
- 补齐 adapter 调试工具
- 扩展更多站点 adapter
- 让 DeepSearch UI 可展示 adapter 命中情况与运行策略
- 补齐网络脱敏、预算控制与正式证据视图

## 9.3 Phase 3

目标：

- 评估是否兼容受控导入外部 adapter
- 评估是否增加 adapter 发布、审批、回滚机制
- 评估是否开放给 `07 动态能力扩展` 体系统一治理

---

## 10. 最终决策建议

对于 `08 DeepSearch`，关于 `bb-browser` 的正式架构决策建议如下：

- 不把 `bb-browser` 原样引入为正式浏览器运行时
- 不把 `bb-browser MCP` 直接作为 DeepSearch 的正式能力入口
- 不引入其受管浏览器作为 Lumos 的第二浏览器主链
- 吸收其 `site adapter / session fetch / compact snapshot / network reverse engineering` 设计
- 在 Lumos 内部实现 `DeepSearch Browser Adapter Layer`
- 在内部增加 `bb-site compatibility runtime`
- 先只承接 Tier 1 / Tier 2 compatible adapter
- 让 DeepSearch UI、聊天和 Workflow 统一复用 Lumos 自己的 DeepSearch service

一句话总结：

- **借鉴 `bb-browser` 的能力模型，并在 Lumos 内实现兼容型 adapter runtime；不照搬其运行时产品形态。**
