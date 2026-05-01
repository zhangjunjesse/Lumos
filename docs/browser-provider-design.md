# 浏览器接入系统 — 需求与设计

> 本文档定义 Lumos 接入第三方指纹浏览器(AdsPower / 紫鸟等)的产品需求与系统设计,**不包含详细实现**。
> 起草于 2026-04-29。

---

## 1. 背景

### 1.1 现状

Lumos 目前只能操控 **Electron 内置浏览器**。所有 DeepSearch、Workflow 浏览器步骤、Agent 自动化操作都必须发生在这一个浏览器实例里。

### 1.2 问题

跨境电商是 Lumos 的核心目标用户群之一。这类用户日常工作 90% 依赖 **指纹浏览器**(AdsPower / 紫鸟 / BitBrowser / Hubstudio / Multilogin / ixBrowser)。原因:

- 一人管几十到几百个店铺账号(Amazon / TikTok Shop / Shopee / eBay / 独立站)
- 平台严打"关联账号":同设备 / 同 IP / 同浏览器指纹登多个号 = 全部封号
- 指纹浏览器在一台电脑上模拟出 N 套独立设备指纹 + 独立代理,做账号隔离

**核心矛盾**:用户的"业务资产"(账号 cookies、登录态、指纹、代理配置)全部沉淀在指纹浏览器里。Lumos 内置浏览器是"裸的",无法直接登录用户的店铺后台,**无法承接跨境电商的真实工作流**。

### 1.3 目标

让 Lumos 能像操控内置浏览器一样,**远程操控用户已有的指纹浏览器**。用户的账号资产保留在原指纹浏览器中,Lumos 不复制、不存储、不接触账号数据。

---

## 2. 用户需求

### 2.1 目标用户

- **跨境电商卖家 / 团队**(主要):AdsPower 用户、紫鸟用户
- **多账号社媒运营者**(次要):TikTok / 抖音矩阵号、IG 矩阵号
- **普通办公用户**(沿用现状):继续用内置浏览器,无感

### 2.2 典型场景

**场景 A · 单店铺即兴操作**
卖家有一个 Amazon 美区店铺。在 Lumos chat 里说:"用美区店铺看下今天订单",Lumos 自动启动 AdsPower 里对应的 profile,接管它,导出订单。

**场景 B · 工作流定时巡检**
卖家配置一个工作流"每天 9 点登录店铺后台,导出昨日订单 + 库存预警"。工作流绑定一个固定 profile,定时跑。

**场景 C · 多店铺批量执行**
卖家有 50 个店铺。一个工作流模板 + 一个 for-each 循环,遍历 50 个 profile,每个 profile 跑一次相同的巡检逻辑。一次性收集所有店铺数据,生成日报。

**场景 D · 接管已开窗口**
卖家已经在 AdsPower 里手动开了一个 profile 在排错。临时让 Lumos 接管这个窗口,处理一批重复操作,处理完用户继续手动。

### 2.3 非目标(明确不做)

- ❌ 不替代指纹浏览器:Lumos 不做指纹生成、不做代理管理、不做账号 cookies 同步
- ❌ 不做插件市场:不开放给第三方写自定义浏览器接入
- ❌ 不发独立 npm / MCP 包:不对 Lumos 之外的生态分发
- ❌ 不复制账号资产:Lumos 卸载后,用户在指纹浏览器里的所有数据不受影响

---

## 3. 设计原则

### 3.1 浏览器是"业务资产载体",不是"工具"

不同浏览器对应不同身份。用户在 Lumos 里发起一个任务时,**任务必须落到一个明确的身份上**。这是产品语义层最重要的一条 —— 任何"自动选择"、"随便用一个"的行为都是错的,会导致账号串号风险。

### 3.2 一等公民,不是扩展

浏览器接入是 Lumos 内置功能,和 "API Provider"、"知识库"、"工作流" 同级。**不做成 MCP / Plugin / 第三方扩展**。理由:浏览器接管是强状态长连接,UI 集成度要求高,做成松耦合扩展会牺牲产品体验。

### 3.3 LLM 透明

LLM 看到的工具接口不变。无论底层是内置 Chromium、AdsPower 还是紫鸟,LLM 都通过同一套浏览器工具调用,工具参数里指定 browser context 即可。**LLM 不需要知道这是哪家指纹浏览器**。

### 3.4 资产留在原地

Lumos 不持久化任何账号 cookies、登录态、指纹配置。用户的所有业务资产 100% 保留在原指纹浏览器中。Lumos 只持久化 **接入配置**(API token、profile 显示名映射)。

### 3.5 上下文绑定,不是任务级选择

"用哪个浏览器" 这个决策应该绑在 **会话 / 工作流** 这一层,而不是每次 chat 让用户选。理由:每次问会非常烦,而且 LLM 自身的上下文已经天然落在某个语境里。

---

## 4. 产品形态

### 4.1 三个用户可见的入口

**入口 1 · `/settings/browsers` 浏览器接入页**

和现有 API Provider 设置页同样的视觉语言。功能:

- 添加接入(下拉选 AdsPower / 紫鸟 / 通用 CDP / 未来扩展项)
- 填写 API 凭证(各家不同,有的填 token,有的填端口)
- 测试连接(展示发现的 profile 数量)
- 管理已接入(查看 profile 列表、刷新、删除整组接入)

**入口 2 · 工作流编辑器的"浏览器"字段**

每个 agent 步骤的工具配置区域,Browser 工具下面增加一行:

```
使用浏览器: [下拉]
  - 内置浏览器
  - AdsPower / 美区店铺-001
  - AdsPower / 美区店铺-002
  - 紫鸟 / 日区账号-A
  - ...
  - ${变量}  ← 高阶用法,for-each 时绑定循环变量
```

**入口 3 · Chat 顶部 browser context 指示器**

```
🌐 内置浏览器                    [切换]
🌐 AdsPower / 美区店铺-001       [切换]
🌐 紫鸟 / 日区账号-A             [切换]
```

默认是内置。用户在对话里说"用美区店铺-1...",Lumos 检测到 profile 名匹配 → 自动切换并显示 toast 提示。也可以手动点切换器换。

### 4.2 chat 内交互流程示例

```
[新会话]
顶部: 🌐 内置浏览器

用户: 用美区店铺-001 看下今天订单

→ Lumos 检测到 "美区店铺-001" 匹配 AdsPower profile
→ 顶部切换为 🌐 AdsPower / 美区店铺-001 (toast: 已切换)
→ 启动该 profile,AdsPower 弹出 Chrome 窗口
→ Lumos 接管该窗口,执行任务
→ 后续这个会话的所有浏览器操作都用这个 profile

用户: 再开个加拿大店铺看下评论

→ Lumos 提示:"当前会话已绑定美区店铺-001,
   是否切换到加拿大店铺?或开新会话保留两个上下文?"
→ 用户选切换 / 开新会话
```

### 4.3 视觉差异(用户必须理解)

- **内置浏览器**:画面渲染在 Lumos 右侧面板内,单窗口体验
- **外接浏览器**:画面在指纹浏览器自己的独立窗口里。用户屏幕上同时存在 Lumos 主窗口 + 指纹浏览器弹出的 Chrome 窗口
- 这一点无法绕过,因为指纹浏览器的窗口由它自己渲染

### 4.4 占用语义("AI 正在操作中")

一个 profile **同时只允许 Lumos 或用户其中一方操作**,不能两边抢鼠标。

- Lumos 接管时,UI 上显示明显的占用标识
- 用户想接回手动操作 → chat 里说"我接手"或点 UI 按钮
- 占用状态跨 chat 会话协调:Chat A 在用 profile-001,Chat B 想用 → Chat B 提示"该 profile 正被另一会话使用"

---

## 5. 系统架构

### 5.1 模块边界

```
┌─────────────────────────────────────────────────────────┐
│ LLM 层(不变)                                            │
│   通过浏览器工具调用,参数携带 browser context id        │
└──────────────────────┬──────────────────────────────────┘
                       │ 工具调用
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Lumos 主进程                                            │
│                                                         │
│  ┌──────────────────────────────────────────┐          │
│  │ BrowserProvider 抽象层                    │          │
│  │  - launch / attach / dispose              │          │
│  │  - listProfiles / getProfile              │          │
│  │  - status / occupy / release              │          │
│  └──────────────────────────────────────────┘          │
│             │              │              │             │
│  ┌──────────┴──┐  ┌────────┴───┐  ┌───────┴────────┐   │
│  │ Embedded    │  │ AdsPower   │  │ ZiNiao         │   │
│  │ Provider    │  │ Provider   │  │ Provider       │   │
│  │ (Electron)  │  │ (本地 API) │  │ (本地 API)     │   │
│  └─────────────┘  └────────────┘  └────────────────┘   │
│                                   ┌────────────────┐   │
│                                   │ ExternalCDP    │   │
│                                   │ Provider (兜底) │   │
│                                   └────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 5.2 核心抽象:BrowserProvider

每个 Provider 实现统一接口,职责包括:

- **profile 发现**:列出该 provider 下的所有可用 profile
- **接管**:输入 profile id,返回一个 CDP 端点 / 浏览器句柄
- **状态**:查询 profile 当前是否运行、是否被占用
- **释放**:断开接管(不一定关闭浏览器,取决于 provider 语义)

**关键统一抽象**:`BrowserContext = (provider_id, profile_id, display_name)`。所有上层(chat 会话绑定、工作流配置、UI 显示)只认 BrowserContext,不关心底层是哪家。

### 5.3 各 Provider 实现思路

| Provider | 接入路径 | 体验 |
|---|---|---|
| Embedded | 直接走现有 BrowserManager | 画面集成在 Lumos 内 |
| AdsPower | 调本地 API(`http://127.0.0.1:50325`),启动 profile 后拿 ws endpoint | 一键启动,profile 列表自动同步 |
| 紫鸟 | 优先调它的开放 API(需调研);若不开放,降级到 ExternalCDP | 取决于紫鸟开放程度 |
| ExternalCDP | 用户手动启动浏览器 + 加 `--remote-debugging-port`,Lumos 连端口 | 兜底方案,任何 Chromium 系都能接入,首次配置多两步 |

### 5.4 持久化

需要持久化的数据(具体表设计在实现阶段定):

- **接入配置**:用户填写的 provider 类型 + API token / 端点
- **Profile 显示名映射**:用户给 profile 起的别名(用于 chat 里语义匹配,比如把"PROFILE-A1B2"标注为"美区店铺-001")
- **会话当前 BrowserContext**:每个 chat session 记一下当前用哪个 context

**不持久化**:profile 内的 cookies、登录态、指纹 —— 这些永远在原指纹浏览器里。

### 5.5 与 LLM 工具层的关系

LLM 通过 Lumos 现有的浏览器工具(如 `chrome-devtools`)调用浏览器能力。改动:

- 工具调用参数中**携带 browser context id**(由会话绑定 / 工作流配置自动注入,LLM 不需要主动指定)
- 工具内部不再直接调 BrowserManager,而是先 `BrowserProvider.attach(contextId)` 拿到句柄,再操作

LLM 的提示词、工具列表、认知模型 **完全不变**。

---

## 6. 关键设计决策

### 6.1 为什么不做成独立 MCP 进程

- 浏览器接管是 **强状态长连接**(CDP WebSocket、tab 树、当前页 DOM 快照),MCP 是 stateless 工具协议,把状态塞进 MCP 等于在 MCP 进程里重新发明一个 BrowserManager
- 关键 UI 交互(工作流编辑器列出 profile 下拉、chat 顶部指示器、占用提示)需要 Lumos 主进程随时能看到 browser 状态。MCP 进程是按需 spawn 的,UI 层拿不到
- 多 chat 会话间的 profile 占用协调需要全局视图,MCP 进程之间互不感知
- "内置 vs 外接" 的统一抽象会断成两套代码

### 6.2 为什么是会话/工作流绑定,不是任务级选择

- 跨境电商任务有强烈的"身份连续性":一个会话里的所有操作通常都属于同一个店铺,任务级选择会反复打断
- LLM 上下文天然有"语境"概念,把 browser context 绑在语境单元上是自然抽象
- 工作流场景(尤其定时任务)必须在配置时锁死身份,运行时不应再做选择

### 6.3 为什么不内置一份指纹浏览器

- 指纹生成 / 代理管理 / 反检测 / 团队协作 是一个完整产品域,有专业玩家(AdsPower / 紫鸟 / Multilogin)做了很多年
- Lumos 自做会陷入"做不如 AdsPower 好"+"用户已有 AdsPower 不会迁移"的双重失败
- 真正的产品定位:**Lumos 是 LLM 推理层 + 工作流编排层,指纹浏览器是身份/资产层,两层各做各的**

### 6.4 为什么紫鸟需要兜底方案

紫鸟相比 AdsPower 对外 API 开放度更保守(需进一步调研确认)。设计上 ExternalCDPProvider 必须先做出来,作为所有"开放度不足"或"小众"指纹浏览器的兜底。这一层做完后,**所有 Chromium 系浏览器都立即可用**,只是首次配置多两步。

---

## 7. 与现有规则的衔接

### 7.1 CLAUDE.md 中"DeepSearch / 浏览器运行时规则"需要修订

现规则适用于 **内置浏览器**:自动化必须 background、不抢用户当前 tab。外接浏览器场景下语义需要扩展:

| 规则项 | 内置浏览器 | 外接浏览器 |
|---|---|---|
| background 模式 | 沿用现规则 | 不适用(窗口前后台由指纹浏览器控制) |
| 不抢用户 tab | 沿用现规则 | 改为"profile 独占语义":同一 profile 同时只能 AI 或用户操作 |
| `LUMOS_BROWSER_BACKGROUND=1` 环境注入 | 沿用 | 不适用(进程不在 Lumos 控制下) |

修订时机:Provider 抽象落地后,在 CLAUDE.md 加一节"外接浏览器运行时规则"。

### 7.2 DeepSearch 默认走内置

DeepSearch 语义是"公开内容检索",不需要登录态。固定使用内置浏览器,不暴露 browser context 选择。

实施时必须避免 `LUMOS_BROWSER_CONTEXT_ID` 这类全局调试/POC 变量意外影响 DeepSearch。DeepSearch service / tool facade 调用 browser bridge 时应显式传 `embedded:default`。

### 7.3 现有 BrowserManager 的演进

`electron/browser/BrowserManager` 是当前唯一的浏览器操控入口。演进路径:

- 把 BrowserManager 现有能力包装为 `EmbeddedProvider`
- 抽出两层接口:
  - `BrowserProvider`:负责配置、profile 发现、attach / release、占用状态
  - `BrowserAutomationSession`:负责单个已接管上下文里的 tab / CDP / screenshot / evaluate 等自动化动作
- 上层(bridge、chat、workflow)通过 `BrowserProvider` 调用,不再直接依赖 BrowserManager 类

不破坏当前内置浏览器的任何行为,只是底层多一层间接。

### 7.4 实施修正:context 不是 bridge 单点参数

当前代码里浏览器调用链不只经过 `electron/browser/bridge-server.ts`。要让同一个浏览器身份贯穿产品,至少要同时覆盖:

- `chrome-devtools` MCP 脚本到 bridge 的请求
- `src/lib/browser-runtime/bridge-client.ts` 的共享 HTTP client
- workflow `ctx.browser` 的 `createBrowserBridgeApi`
- chat route / MCP env enricher 的运行时环境注入
- DeepSearch 的显式默认内置浏览器策略

因此一期基础层必须先落 `browserContextId` 的全链路透传,默认值为 `embedded:default`。任何新 Provider 在这个基础层之前接入,都容易退回到单实例隐含假设。

### 7.5 实施修正:pageId 只在 context 内有效

现有 `pageId` 是单个 BrowserManager 内的 tab id。多浏览器上下文后,`pageId` 不能被视为全局唯一。接口返回必须携带 `browserContextId`,并且后续请求应在同一个 `browserContextId` 下解释 `pageId`。后续 UI 展示和调试日志也应同时显示浏览器上下文与页面 id,避免串 profile 时难以排查。

---

## 8. 范围与里程碑(粗略)

### 8.1 一期(MVP)交付内容

- BrowserProvider / BrowserAutomationSession 抽象层
- EmbeddedProvider(等价于现有能力),并保持 `embedded:default` 默认上下文完全兼容旧路径
- bridge / MCP / workflow `ctx.browser` 的 `browserContextId` 全链路透传
- ExternalCDPProvider(通用兜底,所有 Chromium 系可用):第一版可先通过本地环境变量 `LUMOS_EXTERNAL_CDP_ENDPOINT` / `LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT` 接入 DevTools HTTP base 或 browser websocket endpoint,暴露 `external-cdp:default`;正式产品仍需要设置页和连接测试
- AdsPowerProvider(头部用户量,API 最成熟):第一版可先通过 `LUMOS_ADSPOWER_USER_ID` / `LUMOS_ADSPOWER_PROFILE_ID` 指定单个 profile,通过 AdsPower Local API 启动后复用 `data.ws.puppeteer` 接入 CDP;正式产品仍需要 profile 列表、别名和占用提示
- `/settings/browsers` 接入页
- chat 顶部 browser context 指示器 + 切换
- 工作流编辑器的浏览器字段(单选,不含变量绑定)

### 8.1.1 当前实施状态(严格口径)

- 已落地:两层 Provider 抽象、`embedded:default` 包装、bridge / MCP / workflow / browser runtime client 的 `browserContextId` 透传、环境变量启用的 `external-cdp:default` 最小 Provider、环境变量启用的单 profile `adspower:<profileId>` POC Provider。
- 已落地:本地 SQLite 配置表 `browser_provider_configs` / `browser_profile_aliases`、`chat_sessions.browser_context_id` 字段、运行时配置文件 `~/.lumos/runtime/browser-providers.json` 同步、Electron Provider registry 热加载本地配置。
- 已落地:`/settings/browsers` 第一版 UI,可看到内置浏览器、添加 / 编辑 / 删除 AdsPower 或通用 CDP 接入、测试连接并展示测试结果;添加 / 编辑 AdsPower 时也可先通过 Local API 发现 profile 列表,支持单个绑定到当前配置或批量导入为多条浏览器配置,减少手抄 `user_id` 的出错风险;第三方浏览器列表和发现到的 Profile 列表也已支持按名称 / 别名 / Profile ID / Context / 分组搜索,并可按 Provider / 启用状态 / AI 操作中 / AdsPower 分组筛选;批量导入和单个绑定会把 AdsPower 分组 / 序号写入备注;chat 顶部也已新增浏览器上下文选择器,可把当前会话切到已配置的浏览器 context,后续聊天浏览器工具会携带该 context。
- 已落地:AdsPower 多 Profile 分组视图与手动同步第一版;设置页会按 AdsPower 分组展示第三方浏览器卡片,并提供"同步 AdsPower"按钮,从本机 Local API 分页拉取最多 500 个 Profile,先展示新增 / 更新 / 不变 / 跳过的同步预览,用户确认后才会自动创建缺失配置、刷新已有配置的 Profile 名称 / 分组 / 序号,同时保留用户自定义显示名和人工备注。当前还没有自动周期同步和大账号实机分页验收。
- 已落地:工作流任务的浏览器字段第一版;新建 / 编辑任务时可选择内置浏览器或已配置的 AdsPower / CDP context,保存到 `scheduled_workflows.browser_context_id`,执行时通过 `__lumosRuntime.browserContextId` 传给 workflow `ctx.browser` 和 StageWorker 的 `chrome_devtools` MCP。
- 已落地:工作流浏览器绑定的服务端收口与历史快照;任务创建 / 编辑会校验所选浏览器存在且启用,立即运行接口不再接受隐藏 `browserContextId` 覆盖,每条 `schedule_run_history` 会保存当次实际 `browser_context_id`,任务列表 / 任务详情 / 执行历史 / 执行详情页会显示配置名称(例如 `AdsPower · 浏览器1`)而不是只显示 `adspower:<profileId>`。
- 已落地:chat route 第一版 profile 名精确匹配;当用户明确说出已配置的浏览器显示名 / Profile 显示名 / profile_id,例如"浏览器1",服务端会自动把当前会话切到对应 browser context;显式浏览器操作请求会隔离到 `chrome_devtools` MCP,禁用 `Bash` / `Task` / WebFetch / WebSearch / 常规文件工具,并强制开启新的 Claude SDK 会话,避免复用旧会话工具集或退回系统默认 Chrome。
- 已落地:Claude SDK 侧的 chrome-devtools MCP 注册名已映射为 `chrome_devtools`,聊天与工作流代理提示也改为 `mcp__chrome_devtools__...`;同时 `chrome_devtools` MCP 已改为项目内轻量 stdio JSON-RPC 实现,不再依赖缺失的 `@modelcontextprotocol/sdk` 目录。显式浏览器操作请求会跳过 DeepSearch MCP,避免浏览器失败后绕到 DeepSearch。
- 已修正:聊天前端旧请求头 `x-lumos-browser-context-id: embedded:default` 曾覆盖服务端已匹配到的 `浏览器1 / adspower:k1c1fbjj`,导致模型虽然调用 `mcp__chrome_devtools__new_page`,实际工具结果仍是 `browserContextId: embedded:default`。当前服务端已改为显式 profile 匹配优先,且 MCP env 注入优先使用服务端解析后的 `browserContextId`,避免旧 embedded 请求头把操作路由回内置浏览器。
- 已修正:bridge `/v1/site-pages/*` 的持久站点页缓存现在按 `browserContextId + domain` 隔离,不再把内置浏览器和 AdsPower / CDP 的同站点 `pageId` 串用。
- 已落地:浏览器配置生命周期第一版防护;启用配置时会要求 AdsPower profile_id 或 CDP endpoint 有效,聊天会话切换和工作流运行前都会重新校验 context;删除、停用或修改会改变 context 的 profile_id 时,若仍有聊天会话或工作流任务引用该浏览器,会阻止操作并给出可见错误。
- 已落地:Profile 别名第一版;设置页可维护浏览器别名,chat route 匹配用户说出的浏览器名称时会同时检查显示名、Profile 显示名、profile_id 和别名。
- 已落地:AdsPower context 唯一性防护;同一个 `profile_id` 不允许重复创建成多个 `adspower:<profileId>` 配置,批量导入时会自动跳过已存在的 profile。
- 已落地:引用提示第一版;设置页浏览器卡片会展示当前被聊天会话 / 工作流任务引用的数量,后端删除、停用、改 profile_id 时也会返回同一类引用信息。
- 已落地:运行态占用锁第一版;browser bridge 会对非内置浏览器上下文的写操作按 session / workflow owner 做内存租约,同一 owner 可连续续租,其他 owner 在租约未过期时会先做最长 10 秒短等待,若期间对方释放则自动接续,仍未释放时返回 `BROWSER_CONTEXT_IN_USE`、`waitedMs` 和 `retryAfterMs`,且 `chrome_devtools` MCP 会把 bridge 返回的中文冲突说明一并暴露;设置页也已能读取运行态占用状态并提供"释放占用"按钮,用于用户手动接回或清理卡住的租约,并会定时刷新占用状态。该能力还没有完整 FIFO 排队、冲突弹窗和任务内接手确认,因此不能算完整占用协调。
- 已落地:运行态占用冲突 UI 第一版;聊天页会识别 `BROWSER_CONTEXT_IN_USE` 工具错误并显示"浏览器正在被占用"横幅,提供释放占用、释放并重试、切回内置浏览器;工作流执行详情页也会在占用失败时显示同类提示,并提供释放占用 / 返回任务详情入口。该能力仍不是完整排队系统。
- 已验证:当前本机 `浏览器1` / `adspower:k1c1fbjj` 可通过 Lumos browser bridge 和 `chrome_devtools` MCP 列出页面,并已通过同一条 MCP 工具链打开 `https://www.baidu.com/` 与 `https://www.zhihu.com/`;这证明 provider / bridge / MCP 层可用,但聊天 UI 主链仍需用户从界面复测确认。
- 未落地:AdsPower 自动周期同步 / 大账号分页实机验收、完整 FIFO 等待队列 / 更完整任务内接手确认、更系统的外部浏览器实机验收、跨平台打包验收。
- 因此当前只能算基础架构 + 设置页 / chat / Workflow 绑定第一版,还不能算第三方指纹浏览器主链打通。

### 8.2 二期内容

- 紫鸟 Provider(取决于一期调研结论)
- 工作流变量绑定 profile(支持 for-each 多店铺批量场景)
- profile 占用全局协调 UI
- 其他指纹浏览器 Provider(BitBrowser / Hubstudio / Multilogin / ixBrowser)按用户呼声排期

### 8.3 一期外明确不做

- 多 Provider 之间的 profile 跨家迁移
- profile 自动命名 / 智能匹配的高阶语义(一期只做精确名称匹配)
- 第三方 Provider 扩展机制
- 接管模式下的 Lumos 内嵌画面预览

---

## 9. 待确认事项

- **紫鸟 API 开放程度**:决定它是单独做 Provider 还是走 ExternalCDP 兜底,需要在动手前调研一次
- **AdsPower API 在不同版本之间的稳定性**:是否需要适配多版本
- **占用协调的具体 UX**:跨会话占用冲突时,默认排队 / 默认拒绝 / 让用户选?(可在原型阶段定)
- **CLAUDE.md 修订的具体措辞**:Provider 落地后再写

---

## 10. 相关文档

- `docs/image-provider-architecture.md` — 图片服务商系统(Provider 抽象的同类参考)
- `docs/multi-agent-workflow.md` — 工作流系统(浏览器字段最终落地点之一)
- `CLAUDE.md` § "DeepSearch / 浏览器运行时规则" — 现行规则,后续需修订
