# 网状 Agent Team 协作运行时设计方案

> 状态：设计草案 v3.1（workflow 隔离 + QMT 接入落定）· 首个落地场景：A 股实时炒股团队
> 关联：本运行时是通用能力，炒股团队是它的第一个实例化配置。

## v3 修订要点（相对 v2 的关键变化）

1. **全自动是主路径**：首版目标就是自动盯盘、自动决策、自动风控、自动下单闭环；人工确认只作为可选模式或异常兜底，不是默认路径。
2. **少做前置重工程**：前期先打通 `paper` 自动闭环，再补 UI/IM/复盘增强；不把完整安全驾驶舱作为自动闭环的前置条件。
3. **Agent 是责任常驻，不是被动订阅者**：participant 可以有自己的主动工作循环。比如新闻 Agent 自己持续抓新闻、筛选、写白板、发事件，而不是只等别人唤醒。
4. **保留最小硬安全边界**：任何 LLM agent 的会话都不注入券商写工具；只有确定性的 **OrderGateway** 持有 QMT 写权限。agent 只能产出"下单意图"，物理上够不到下单接口。
5. **运行时安全前提仍要补**：当前 `StageWorker` 用 `bypassPermissions`、不接 `canUseTool`、全量注入 MCP（已核实，见 §6）。这三处要改，但定位是工具隔离和纵深防御，不是拖慢全自动主链。
6. **副作用集中但不等于人工确认**：agent 只产出 action plan，MeshRuntime 单事务写 outbox；`order_intent` 过 Risk Gate 后可自动生成 ticket 并交给 OrderGateway。
7. **事件可靠投递**：拆出 per-subscriber 投递表，支持广播多消费者 + 重试 + 超时恢复。

---

## 0. 一句话

把一组 LLM agent 从「跑完即死的单向流水线」改造成「一直在岗、围着公共白板、靠喇叭和定向任务信封互相协作、由一道焊死的风控门兜底」的网状团队。首个用途是盯盘实时交易，但运行时本身与炒股无关，可复用。

---

## 0.5 与 workflow 的隔离边界 + QMT 接入（硬约束）

### 与 workflow 双向零影响

网状是 `src/lib/mesh/` 下的自包含子系统，和现有 workflow 物理隔离，互不影响：

1. **代码**：网状自建执行器 `mesh-worker`（自己的 SDK query options——非 `bypassPermissions`、按白名单注入 MCP、真正生效的 `canUseTool`）。**不修改** workflow 的 `stage-worker.ts / runtime-contracts.ts / runtime-tool-policy.ts / subagent.ts / engine.ts`。两者只共用最底层只读库（Claude SDK、`sdk-runtime.ts` provider 解析、SQLite）——调用 ≠ 修改。
   > workflow 现有的 `bypassPermissions`/全量注入是它自己的历史安全债，本次不碰、也不被波及；网状从诞生就是收敛的。
2. **MCP**：qmt 只读 MCP 只在 mesh-worker 内部按 participant 白名单注入给炒股 agent。**绝不**加进 Lumos 全局默认启用列表（`init-builtin-resources.ts` 的 isEnabled），否则会被 workflow 的全量注入捞走。workflow agent 永远看不到炒股 MCP。
3. **数据**：网状自己的表（`mesh_*`、`order_ticket`）、自己的 run 控制（`mesh-run-control.ts`），不碰 `scheduled_workflows / schedule_run_history / OpenWorkflow`。

### QMT 接入形态（基于现有资产 `~/Downloads/量化`，最终跑 Windows）

运行环境：**Windows + 国金 QMT 在线 + `C:\Python311`（xtquant）**。现有资产直接对接：

- **只读 MCP**（`qmt_mcp_server.py`，FastMCP/stdio，名 `qmt-readonly`，已实测）：行情 `qmt_get_tick`/`qmt_get_limit_price`、账户 `qmt_query_account`/`positions`/`orders`/`trades`、同花顺热榜。**不含任何下单。** → 直接作为炒股 agent 的 MCP 白名单。
- **下单档**：尚未建。只读 MCP 自己的红线写明"交易档将在独立文件 + 显式护栏后单独提供"——**这个"独立文件 + 护栏"就是本设计的 OrderGateway**：Windows 上独立确定性服务，持 `order_stock/cancel_order_stock` + Risk Gate；**不做成任何 agent 能见的 MCP**，只有 MeshRuntime 经 localhost 受控接口调它。
- **paper 后端**：现有 `盘中盯盘.py` 的 `check_sim` 已证明 paper 无需 QMT 模拟账户——实时行情现价撮合 + 记账即可。OrderGateway 的 paper 正式化这套（实时撮合 + DB ticket/trade + 手续费/滑点），思路同 `模拟盘.json`。
- **部署**：MeshRuntime(Node) + OrderGateway(Python) + qmt-readonly 同机跑那台 Windows，localhost 互通。

---

## 1. 为什么不能用现有 workflow 引擎

调研结论（代码事实，非推测）：

| 维度 | 现有 workflow 引擎 | 网状团队需要 |
|---|---|---|
| 数据流 | 纯 DAG 单向：`steps.x.output.y` 编译期解析后注入下游 prompt（`src/lib/workflow/subagent.ts:291`） | agent 间双向、随时、点对点 |
| agent 生命周期 | 一次性：`StageWorker.execute()` 跑完即销毁 | 责任常驻、多轮主动 duty cycle、可被事件插队 |
| 共享状态 | 无。每个 agent 独立工作区，无全局内存/队列 | 一块所有人读写的白板 |
| 事件 | `TaskEventBus` 仅 UI 通知，agent 不能订阅/发布（`src/lib/task-event-bus.ts`） | agent 可发布、可订阅 |
| 工具权限 | **裸奔**：`permissionMode:'bypassPermissions'`、不传 `canUseTool`、全量注入 MCP（`src/lib/team-run/stage-worker.ts:603/599/538`） | 按角色隔离能力，券商写工具绝不进 LLM 会话 |

结论：**网状协作必须新建一层运行时（MeshRuntime），但底层大量复用现有设施，不重造。**

---

## 2. 核心设计判断（先讲，贯穿全文）

### 判断一：常驻 = 责任常驻 + 主动工作循环，不是只等事件

这里的“常驻”不能理解成 agent 平时什么都不干、只等事件叫醒。用户要的是一个团队里每个 agent 自己负责一摊事：新闻 agent 持续看新闻，行情 agent 持续盯盘，持仓 agent 持续看风险，决策 agent 持续综合白板变化。

实现上仍不需要让几十个 Claude 子进程 7×24 挂着。正确模型是：

- **每个 participant 是一个“责任单元”**：有自己的职责、工作循环、订阅 topic、工具白名单、状态游标和下一次工作计划。
- participant 可以被事件触发，也可以按自己的 `next_run_at / interval / backlog` 主动继续干活。
- 物理执行用网状自建的 `mesh-worker`（不碰 workflow 的 StageWorker）：运行一次 duty cycle → 读白板和自己的状态 → 跑一次 Claude SDK → 产出 action plan 和下一步计划 → 结束本轮。
- agent 的长期状态外置在 SQLite：例如新闻源游标、已读新闻 hash、关注股票池、上次扫描时间、未处理 backlog、下一轮计划。

这样产品语义上 agent 是“持续在岗、持续干活”的；工程实现上则是“短运行、多轮 duty cycle”，不需要进程挂起恢复。

### 判断二：下单靠能力隔离，不靠 LLM 守规矩

网状里 agent 会乱喊、会被注入、会幻觉。**任何"约定上不该下单"的软约束都不可靠。** 唯一可靠的是：**LLM 物理上够不到券商写接口。**

- 券商写权限（QMT `place_order`/`cancel_order`）只存在于一个确定性服务 **OrderGateway** 里。
- 任何 participant 的 SDK 会话**都不注入**下单 MCP/工具。
- agent 能做的极限只是产出一条"下单意图"（action plan 里的一项），它必须穿过 Risk Gate（规则）→ OrderGateway → 才能真正下单。人工确认只是 `confirmMode=manual` 时的可选分支，不是全自动主链。

这样 permissionMode 是不是 bypass 都不影响下单安全——工具压根不在 agent 进程的工具表里。`canUseTool` 权限矩阵仍要做，但定位是**纵深防御**，不是下单的主防线。

### 判断三：全程 LLM，但分快慢两挡

用户要求全程 LLM 在环。代价是延迟（MCP 同步阻塞、SDK 子进程，单步秒级）。解法不是把 LLM 踢出环，而是分两挡：高频盯盘用快模型（Haiku），出现机会/风险才升级强模型（Opus）。心跳上限因此是**分钟级**——A 股 T+1 本就不需要更快。

---

## 3. 概念模型

```
   用户 / UI / IM / 主 Agent
              │
              ▼
   ┌──────────────────────────┐
   │ Team Leader Agent         │  用户默认只跟 Leader 沟通
   │ 团队队长 / 对外接口        │  理解新消息、拆任务、管配置
   └──────────────────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │ Team Config / Agent       │  团队/Agent 注册表
   │ Registry                  │  add / clone / edit / disable
   └──────────────────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │ Team Control Plane        │  用户介入、指令路由、模式切换
   │ 确定性执行 / 审计层        │  只执行结构化控制命令
   └──────────────────────────┘
              │
              ▼
   observe participants                                  decide / risk / exec
   行情 持仓 新闻                                          决策 风控 执行
        │  │  │          ┌──────────────────────────┐        │  │  │
        ▼  ▼  ▼          │       MeshRuntime         │        ▲  ▲  ▲
   ┌───────────────┐     │  ┌────────────────────┐   │   ┌───────────────┐
   │ 产出 action    │────┼─▶│  Blackboard 白板    │◀──┼───│  读白板        │
   │ plan(纯输出)   │     │  │  共享状态 + 留痕     │   │   └───────────────┘
   └───────────────┘     │  └────────────────────┘   │        │
        │ (runtime 事务   │  ┌────────────────────┐   │        │
        │  写 outbox)     │  │  Event Bus 喇叭      │───┼────────┤ (订阅唤醒)
        └────────────────┼─▶│  pub/sub + per-sub   │   │        │
                         │  │  投递 + 去抖          │   │        │
                         │  ├────────────────────┤   │        │
                         │  │  Task Router 任务信封 │◀──┼────────┘ (定向请求/回执)
                         │  └────────────────────┘   │
                         │  ┌────────────────────┐   │
   下单意图 ─────────────┼─▶│  Risk Gate(规则)     │   │
                         │  └─────────┬──────────┘   │
                         └────────────┼──────────────┘
                                      ▼
                         ┌────────────────────────┐
                         │  OrderGateway(确定性)    │──▶ QMT 写接口
                         │  唯一持券商写权限·非 LLM   │   (paper / live, auto/manual)
                         └────────────────────────┘
```

一等公民：

1. **Participant**：角色 + 主动工作循环 + 订阅 topic 集 + 可用 MCP 白名单 + model 档。长期状态外置，被事件或自己的计划触发，每轮只产出 action plan。
2. **Blackboard 白板**：共享状态 + 记忆 + 复盘留痕。每条带时间戳、写入者、版本。
3. **Event Bus 喇叭**：发布-订阅，per-subscriber 投递，带去抖。
4. **Task Envelope 任务信封**：定向「请求-回执」，`to / taskId`，对方回 `replyTo`。
5. **Team Leader Agent 团队队长**：用户默认对接对象。负责理解用户新消息、拆任务、定优先级、协调各 participant、管理团队配置，并把需要确定执行的内容交给 Control Plane。
6. **Team Config / Agent Registry**：团队和 Agent 配置真源。支持新增、克隆、编辑、停用 agent，管理 system prompt、模型、工具白名单、订阅 topic、优先级和工作模式。
7. **Team Control Plane 控制面**：确定性执行/审计层。只接收结构化控制命令，不负责自由聊天。
8. **Control Command 控制命令**：暂停、恢复、停止、切模式、调整关注范围、改优先级、撤销未成交票据等可审计指令。
9. **Risk Gate**：所有下单意图的确定性规则关卡。
10. **OrderGateway**：唯一持券商写权限的确定性服务，非 LLM，支持 paper/live 后端与 auto/manual 确认模式。

### 用户介入与控制面

用户不直接对接某个新闻/行情/风控 participant，也不直接对接底层 Control Plane，而是对接 **Team Leader Agent**。这样用户能像跟“团队负责人”说话一样下达指令，同时不会破坏每个 Agent 的职责边界。

- Leader 能接收用户的新消息，例如“刚看到某公司有重大公告，重点关注一下”“今天别碰新能源”“把 600XXX 加入重点观察”“先暂停交易只看盘”
- Leader 也能处理配置诉求，例如“新增一个公告解读 agent”“把新闻 agent 的提示词改得激进一点”“给风控 agent 换强模型”“停用情绪 agent”
- Leader 把自然语言拆成三类结果：写白板的新信息、派给 participant 的任务、交给 Control Plane 的结构化控制命令
- 低阶控制命令由 Control Plane 确定性执行：`pause / resume / stop / set_mode / set_focus / reprioritize / cancel_ticket`
- 指令可以面向整个 team，也可以限定到某个 participant、某个 symbol、某个 ticket
- 任何会影响真实下单的命令仍然要走 `Risk Gate` 和 `OrderGateway`，不能绕过硬边界直达 QMT
- 用户可以临时接管节奏，但 Leader 不能把 LLM 变成无约束的券商写口

### Team Leader Agent 的职责

Leader 是团队的“对外接口”和“队长”，不是唯一决策者，也不直接下单。

- 对外沟通：用户在 UI/IM/主 Agent 里说的话，先进入 Leader
- 信息注入：用户给的新消息先写白板，并标注来源为 `user`
- 指挥调度：把用户指令拆成任务发给新闻/行情/持仓/决策/风控/执行 participant
- 优先级管理：调整某些股票、主题、风险事件的处理优先级
- 状态解释：向用户汇报团队当前在看什么、为什么下单/不下单、哪些 Agent 正在处理
- 控制转译：把“暂停交易”“只看不买”“今天重点看半导体”转成结构化 `mesh_command`
- 配置管理：新增/编辑/克隆/停用 agent，修改 system prompt、模型、工具白名单、订阅、优先级和工作模式

### Team Config / Agent Registry

团队配置是运行时的正式真源，不写死在代码里。Leader 可以辅助用户修改，但最终要落到 Registry。

每个 agent 配置至少包括：

- `id / name / role`
- `enabled`
- `system_prompt`
- `model_tier / preferred_model`
- `work_mode(active_loop|event_driven)`
- `subscriptions`
- `mcp_allowlist / tool_allowlist / denylist`
- `priority / interval / budget`
- `state_schema / action_schema`

用户可通过 Leader 管配置：

- “新增一个专门看公告的 agent”
- “把新闻 agent 的 system prompt 改成只关注交易相关”
- “让风控 agent 更保守”
- “停用情绪 agent”
- “复制一个新闻 agent，专门盯政策消息”

配置变更也要落盘审计。影响下单安全边界的变更，例如给 agent 加工具、放宽风控、切 live 权限，不由 Leader 自己决定，必须交给 Control Plane / Risk Gate 按规则处理。

---

## 4. 沟通机制（三种，别混）

| 机制 | 形态 | 谁收 | 要回结果 | 用途 | 复用样板 |
|---|---|---|---|---|---|
| 广播 | 发 topic 事件 | 所有订阅者 | 否 | 通知「状态变了」 | `task-event-bus.ts` EventEmitter |
| 定向任务 | 任务信封 `to/taskId` | 点名一个 | 是（回执） | 「你办这件事并给我答案」 | `approval-waiter.ts` Promise 挂起范式 |
| 白板读写 | 共享状态 | 谁都能读 | — | 共享世界状态 + 留痕 | SQLite 新表 |

### 统一消息信封

```ts
interface MeshMessage {
  id: string
  runId: string
  from: string                 // 发起 participant id
  kind: 'event' | 'task' | 'reply' | 'command'
  topic: string
  to?: string                  // task/reply：收件人
  taskId?: string
  replyTo?: string
  payload: unknown
  createdAt: string
  dedupeKey?: string           // 去抖：同 key 在 TTL 内只产生一条
}
```

投递不靠 message 上的单一 `consumed_at`，而靠 per-subscriber 的 `mesh_message_delivery`（见 §8）——广播事件要被多个订阅者各自消费、各自重试、各自超时恢复。

### 控制命令（用户给团队下指令）

控制命令和普通 event / task 分开看：

- `runtime` 命令：暂停、恢复、停止、切 `paper/live`、切 `auto/manual`、紧急停止、全平
- `team` 命令：调整关注范围、提高某个主题优先级、要求全队重扫、切换今天策略重点
- `config` 命令：新增/克隆/编辑/停用 agent，修改 system prompt、模型、订阅、工具白名单
- `participant` 命令：只改某个 Agent 的工作关键词、扫描范围、优先级、下一轮计划
- `ticket` 命令：撤销未成交票据、改价量、强制过期

这些命令要落盘成 `mesh_command`，作为用户介入和审计记录；必要时再由 runtime 派生出 task / event / state change。

### 一条真实链路（新闻 agent 主动干活 + 下单走能力隔离）

```
新闻 agent  ── 自己的 duty loop：抓新闻/DeepSearch/读取消息源
            ── action: write 白板「新闻#600XXX」+ emit「利好#600XXX」
            ── action: update_state(next_run_at, cursor, seen_hashes)
决策 agent  ── 订「个股利好」被唤醒 ──▶ 读白板 ──▶ action: 写判断 + task{to:风控,T1,审单}
风控 agent  ── 订「给我的 task」被唤醒 ──▶ 核敞口/资金/涨跌停 ──▶ action: reply{T1,批准}
决策 agent  ── 收 T1 回执 ──▶ action: task{to:执行,下单}
执行 agent  ── action: order_intent(买 600XXX 100@18.5)   ← 注意：不是调下单工具，是产出意图
MeshRuntime ── 把 order_intent 交给 Risk Gate(规则) ──▶ 过
            ── 自动：建 order ticket(confirmed) ──▶ OrderGateway 下单
            ── 可选人工：confirmMode=manual 时 ticket(pending) 等确认
            ── QMT(paper/live 按 run mode) ──▶ 成交写回白板
```

执行 agent 产出的是**意图**，不是动作。真正下单永远是 OrderGateway 干的；但 OrderGateway 可以在 `confirmMode=auto` 下自动执行通过 Risk Gate 的票据。逻辑上谁都能影响谁，物理上所有人只连中枢（星形）。加新角色只要订 topic + 产出 action，不改别人。

---

## 5. Participant 执行循环（主动工作循环 + action plan）

```
触发一次 duty cycle：
  - 自己的 next_run_at 到期
  - 自己还有 backlog
  - 事件命中订阅
  - 收到定向 task
   │
   ├─ 1. MeshRuntime 读白板 + participant 自己的状态游标/backlog
   ├─ 2. 构 payload（systemPrompt=职责, model=档位, mcpServers=该角色白名单）
   ├─ 3. mesh-worker 执行一次 — 网状自建执行器，一次性，强制 structured output
   ├─ 4. agent 返回 action plan（结构化，纯数据，无副作用）：
   │       [{write_blackboard}, {emit_event}, {send_task}, {reply}, {order_intent}, {update_state}]
   ├─ 5. MeshRuntime 校验 action plan（含 order_intent 过 Risk Gate）
   └─ 6. 单事务写 outbox（白板写 + 事件投递 + 任务入队 + 更新下一轮计划），幂等 → 等下一轮 duty cycle
```

**关键修正（Medium）**：副作用只在第 6 步由 runtime 事务提交，**agent 执行过程中不产生任何外部副作用**。这样第 3 步 StageWorker 失败/重试不会造成重复事件或半提交——同一次唤醒重跑产出同样 plan，runtime 按 `action id` 去重。

因此 **mesh-collab MCP 只读**（`mesh.read(key)` 查白板），写类动作（publish/send_task/reply/order_intent）一律走 action plan，不做成"agent 主动调的写工具"。

### 快慢两挡 model

| participant | 触发 | model 档 | 理由 |
|---|---|---|---|
| 行情/持仓/新闻（observe） | 主动 duty loop + 心跳 | 快（Haiku） | 自己负责持续观察；90% 轮没事，便宜快 |
| 决策/风控 | 事件触发 | 强（Opus） | 真要动钱才算，要准 |
| 执行 | 决策触发 | 快 | 只把决策落成意图 |
| 盘后复盘 | 收盘一次 | 强 | 深度归因 |

model 路由复用 `src/lib/claude/sdk-runtime.ts`。

---

## 6. 安全：能力隔离 + 纵深防御（核心，最重要）

### 网状自建安全执行器（不碰 workflow）

不改 workflow 的 `stage-worker`，而是新建 `src/lib/mesh/mesh-worker.ts` 作为网状自己的 agent 执行器，从诞生就是安全的：

| 维度 | workflow 的 stage-worker（不动它） | 网状 mesh-worker（新建） |
|---|---|---|
| permissionMode | `bypassPermissions` | 非 bypass，让 `canUseTool` 生效 |
| canUseTool | 不传（裸放行） | 真按 toolName+白名单判定，自带强制拦截测试 |
| MCP 注入 | 全量注入所有启用 MCP | 按 participant 白名单注入（只读 qmt + mesh-collab 只读） |
| agent 契约 | `AgentExecutionBindingV1`（workspace/shell 级） | 自己的 `mesh_agent_config`（含 MCP 白名单） |

mesh-worker 复用底层只读库（Claude SDK、provider 解析、SDK 本地 auth、SQLite），但执行策略全是自己的。`stage-worker.ts` 等 workflow 文件一行不动。

### 防线一（主）：能力隔离

- 券商写工具（`mcp__qmt__place_order`/`cancel_order`）**不出现在任何 participant 的 MCP 注入集合里**。
- 它只被 OrderGateway（确定性服务，非 LLM 进程）持有。
- LLM agent 物理上无法调用下单接口，幻觉/注入都越不过去。

### 防线二（纵深）：participant 级 MCP 白名单 + canUseTool

每个 participant 只注入自己角色需要的 MCP：

| participant | 注入的 MCP（白名单） |
|---|---|
| Leader | 行情查询、持仓查询、DeepSearch、mesh-collab(只读)，可通过 Control Plane 提交结构化控制命令 |
| observe（行情/持仓/新闻） | 行情查询、持仓查询、DeepSearch、mesh-collab(只读) |
| 决策/风控 | 行情查询、持仓查询、mesh-collab(只读) |
| 执行 | 行情查询、mesh-collab(只读)。**无任何写接口** |
| OrderGateway | 非 agent，不走 SDK；直接持 QMT 写 SDK |

`canUseTool` 在 SDK 层兜底拦截白名单外调用 + 接上 `validateToolInput` 的路径/命令守卫。

### 防线三：Risk Gate（确定性规则，不靠 LLM）

order_intent 经 Risk Gate 校验，任一不过即拒 + 写白板原因 + 广播 `order_rejected`：

- 单笔/单标的/总敞口上限 · 当日累计亏损熔断 · 最大回撤
- 涨跌停不追 · 可用资金校验 · 标的黑名单 · 幂等键防重复下单

**风控参数分两类（High 修正）**：

- **硬上限**：确定性配置 + 用户确认后的**版本化策略**。agent **只读**，不可改。
- **变更建议**：agent 可提案（写白板），但**任何放宽风险的变更**（调高上限、缩黑名单、关熔断）**必须人工确认 + 留痕**后才生效。收紧可设为自动生效。

### 防线四：下单票据（独立 order ticket，自动为主、人工可选）

不直接复用 workflow approval 表。交易执行需要独立建模，因为现有 `approval_requests` 是 workflow step 语义，没有交易域字段；`approval-waiter` 的进程内 EventEmitter 只能当信令，不能当可靠队列。

这里的 ticket 不是“必须人工确认”的意思，而是**每笔 order_intent 的确定性执行凭证**：记录风险快照、策略版本、幂等键和最终下单参数。`confirmMode=auto` 时，Risk Gate 通过后 ticket 直接进入 confirmed 并交给 OrderGateway；`confirmMode=manual` 时才 pending 等人确认。

```
order_ticket  独立表
  id, run_id, intent_id, idempotency_key,
  account, symbol, side, qty, price, order_type,
  risk_snapshot(json),               -- 下单时点的敞口/资金/规则版本
  status(pending|confirmed|rejected|expired|submitted|filled|failed),
  confirm_mode(auto|manual), decided_by, decided_at,
  broker_order_id, mode(paper|live),
  created_at, expires_at
```

- **全自动主路径**：Risk Gate 过 → 建 ticket(confirmed, confirm_mode=auto) → OrderGateway 按 ticket 下单 → 回写提交/成交结果。
- **人工确认可选**：`confirmMode=manual` 时，Risk Gate 过 → 建 ticket(pending) → IM/UI 推送 → 用户确认（可改价量，写回 ticket）→ OrderGateway 下单。超时 → expired（不下单）。
- 可靠性靠 **DB ticket + idempotency_key**，不靠进程内 Promise；进程重启后扫 pending ticket 恢复。

---

## 7. 炒股团队实例化

| participant | 主动职责 / 订阅 | 产出 action | model | MCP 白名单 |
|---|---|---|---|---|
| Leader（团队队长） | 用户消息 / 控制命令 / 团队状态 | 写白板、派 task、提交 mesh_command、向用户汇报 | 强 | 行情/持仓查询+DeepSearch+mesh(只读)+Control Plane |
| 盘前研究（扫描/技术/基本面/情绪，并行） | 盘前主动扫描 | 标的池+参数 → 白板 | 强 | 行情查询+DeepSearch+mesh(只读) |
| 行情 | 持续盯盘 duty loop | `quote_anomaly#code` | 快 | 行情查询+mesh(只读) |
| 持仓 | 持续检查持仓/风险 duty loop | `stop_loss_near#code` | 快 | 持仓查询+mesh(只读) |
| 新闻 | 持续抓新闻/消息源 duty loop | `news#code` | 快 | DeepSearch+mesh(只读) |
| 决策 | `quote_anomaly`/`news`/`stop_loss_near` | `order_intent` + task→风控 | 强 | 行情/持仓查询+mesh(只读) |
| 风控 | `order_intent` 的 task | 批准/驳回回执；盯总敞口 | 强 | 持仓查询+mesh(只读) |
| 执行 | 风控批准 | `order_intent`（→Risk Gate→OrderGateway） | 快 | 行情查询+mesh(只读)。**无写接口** |
| 盘后复盘 | scheduler 收盘事件 | 归因+次日建议 → 白板 | 强 | 全查询+mesh(只读) |

心跳复用 `src/lib/scheduler/cron-engine.ts`（已有 60s tick），但心跳不是唯一触发源。MeshRuntime 还要维护 participant 自己的 `next_run_at`、backlog 和状态游标，让新闻/行情/持仓这类 agent 能按职责持续推进自己的工作。

---

## 8. 数据模型（SQLite 新表，`~/.lumos/lumos.db`）

```
mesh_run               一次 team run（生命周期语义对齐 schedule_run_history）
  id, team_id, mode(paper|live), status(running|paused|stopped|done),
  confirm_mode(auto|manual), started_at, finished_at

mesh_team_config       team 配置版本
  id, name, version, status(active|archived), mode_defaults(json),
  risk_policy_version, created_at, updated_at

mesh_agent_config      agent 配置真源
  id, team_id, name, role, enabled, system_prompt, model_tier, preferred_model,
  work_mode, subscriptions(json), mcp_allowlist(json), tool_allowlist(json),
  denylist(json), priority, interval_ms, budget(json), state_schema(json),
  action_schema(json), created_at, updated_at

mesh_config_change     配置变更审计
  id, team_id, actor, target_type(team|agent|risk_policy), target_id,
  before(json), after(json), reason, status(applied|rejected), created_at

mesh_blackboard        白板（共享状态 + 留痕）
  run_id, key, value(json), version, written_by, written_at
  PK(run_id, key, version)            -- 保留历史版本，复盘可追

mesh_message           事件/任务/回执（统一信封）
  id, run_id, from, kind, topic, to, task_id, reply_to,
  payload(json), dedupe_key, created_at

mesh_message_delivery  per-subscriber 投递（支撑广播多消费者）  ← High 修正
  message_id, participant_id, status(pending|leased|done|failed),
  lease_until, attempts, updated_at
  PK(message_id, participant_id)

mesh_command           用户/系统控制命令审计
  id, run_id, source(user|system|participant), target_type(runtime|team|participant|ticket),
  target_id, kind, payload(json), status(pending|applied|rejected|expired),
  created_at, resolved_at

mesh_participant       participant 运行态
  run_id, participant_id, role, subscriptions(json), model_tier,
  status(idle|running|paused|failed), work_mode(active_loop|event_driven),
  state(json), backlog(json), next_run_at, last_run_at

order_ticket           交易确认票据（见 §6 防线四）
```

进程重启幂等：状态全在 DB；listener 丢了靠重入恢复；`dedupe_key` 防重复事件；`idempotency_key` 防重复下单；扫 `delivery.status=leased && lease_until<now` 回收僵尸投递。

---

## 9. 关键风险与防呆

| 风险 | 防呆 |
|---|---|
| 喊话循环（A 触发 B、B 又触发 A） | `dedupe_key`+TTL；event 最大扇出上限 |
| 成本失控（全程 LLM） | 快慢分层；空转轮快模型一句"无机会"即返回；心跳级非毫秒级 |
| 主动 agent 空转烧钱 | 每个 participant 有 interval、backlog 上限、每日调用上限和空转退避；没有新输入时延长 next_run_at |
| 多 agent 对同一只票反向信号 | 决策 agent 是唯一出 `order_intent` 的角色（单一仲裁） |
| 进程重启丢状态/重复下单 | 状态外置 DB；重入恢复；`idempotency_key` |
| LLM 幻觉/注入越权下单 | 能力隔离（物理够不到）+ Risk Gate（规则）+ OrderGateway（确定性执行）三重 |
| LLM 偷偷放宽风控 | 硬上限版本化只读；放宽必人工确认留痕 |
| StageWorker 重试致重复副作用 | agent 纯产出 action plan，runtime 单事务 outbox + action id 幂等 |
| 广播事件被首个消费者吞掉 | per-subscriber `mesh_message_delivery`，各自消费/重试/超时 |

---

## 10. 生命周期与运行时定位

**MeshRuntime 是独立运行时**（不是 workflow 的一种 step/执行模式）——它的执行模型（事件驱动、无终点循环、pub/sub）和 OpenWorkflow 的 DAG 根本不同，硬塞会两边都扭曲。但它**复用 workflow 的生命周期/取消/审计真源**，不另起孤岛：

- run 记录、取消链路对齐 `src/lib/workflow/schedule-run-control.ts` 范式（新建 `mesh-run-control.ts`）。
- 它最终是「内置级炒股应用」的运行时后端，UI/IM/验收页逐步补齐；不阻塞第一阶段自动闭环。

关闭/删除/停止一个 run，集中走控制服务，同步处理所有层（遵守 CLAUDE.md 任务生命周期铁律）：

- 停心跳订阅、取消正在跑的 `StageWorker`（向 abort controller 传播中断）
- `mesh_run` 写终态、把 `mesh_participant` 置为 `paused/stopped`，清空未处理 backlog 或标记为已取消
- 取消挂起或未成交的 `order_ticket`（pending/submitted → cancelled/failed，已成交只补偿记录不伪装撤回）
- 收盘自动停循环；一次性 run 不再自动触发

**禁止**把删 UI 记录当成停止执行。

---

## 11. 复用 vs 新建

**直接复用**：底层只读库（Claude SDK `query()` / `sdk-runtime.ts` provider 解析 / SDK 本地 auth / `mcp-resolver` 配置解析）· approval 的状态机/超时/授权思想（不直接用其表）· `cron-engine.ts`（心跳）· `mcp-resolver.ts`（MCP 注入，需加按 participant 过滤）· SQLite/Memory V2（白板底层）· `task-event-bus.ts` EventEmitter 范式（喇叭信令）· `schedule-run-control.ts` 范式（生命周期）

**必须新建**：
- `src/lib/mesh/` — MeshRuntime（调度、白板、event bus、task router、Risk Gate、outbox 事务）
- **Team Leader Agent + Team Control Plane + Agent Registry** — Leader 作为用户对接入口，Control Plane 负责结构化控制命令执行和审计，Registry 保存团队/Agent 配置
- **OrderGateway** — 唯一持券商写权限的确定性服务（paper/live 双后端）
- 网状 agent 契约 `mesh_agent_config`（含 participant 级 **MCP 白名单 + denylist**）—— 网状自己的契约，不扩 workflow 的 `AgentExecutionBindingV1`
- 网状自建执行器 `src/lib/mesh/mesh-worker.ts`（自己的 permissionMode/canUseTool/MCP 白名单）+ 强制拦截测试。**不改 workflow 的 stage-worker**
- `mesh-collab` in-process MCP（只读）
- `order_ticket` 交易执行票据 + 交易语义 UI
- 10 张 `mesh_*`/`order_ticket` 表（含 `mesh_command`、`mesh_team_config`、`mesh_agent_config`、`mesh_config_change`）
- 炒股 team 配置（participant 清单 + 订阅图 + 风控硬上限策略）

---

## 12. 边界（首版不做）

- **全自动是首版主路径**：首版必须支持 `confirmMode=auto` 的自动闭环。
- 前期优先打通 `paper` 自动闭环；`live` 是同一 OrderGateway 的后端模式，由用户在设置里显式切换，不要求每笔人工确认。
- **半自动只是可选模式**：用于调试、异常兜底或用户临时切换，不作为首版默认路径。
- 不做 tick/秒级高频，LLM 不进毫秒执行环。
- A 股 T+1：不做日内同标的反复买卖。
- 不为本模块改动内置浏览器等全局公共设施。

---

## 13. 落地顺序（每步都是完整实现，不是占位）

按“先自动闭环、再增强可见性”的顺序落地，避免前期把系统做得过重：

### 产品能力分阶段

**P0：最小可用自动团队**

目标：用户能启动团队、看懂当前状态、通过 Leader 下指令、管理基础 agent，并且能随时停。

- Team Leader 对话入口：用户所有自然语言指令先到 Leader
- 团队总览：运行状态、paper/live、auto/manual、当前关注股票/主题、最近意图/订单
- 最小控制面：暂停、恢复、停止、紧急停机、切模式、调整关注范围、重扫
- Agent 配置页：新增、编辑、克隆、停用 agent；改 system prompt、模型、订阅、工具白名单
- 风控基础配置：单笔上限、单票上限、总仓位、黑名单、只看不买/只卖出
- 交易意图时间线：从触发信号到下单/拒单的关键链路可见
- 用户指令历史：用户说了什么、Leader 如何理解、生成了什么命令、影响了哪些对象
- 一键停止团队 / 一键停止下单

**P1：可信复盘与调优**

目标：用户能理解系统表现，并逐步调优团队，而不是只看结果。

- 每日复盘：交易、拒单、错过机会、风控触发、明日关注
- Agent 贡献视图：哪些 Agent 提供了有效信号、哪些误报多、哪些经常被采纳
- 交易解释：为什么买/卖/不买，引用白板证据和参与 Agent
- 策略/风控配置页增强：时段限制、行业/主题限制、尾盘/开盘规则、持仓风险策略
- 异常中心：数据源断开、QMT 异常、Agent 卡住、成本超限、风控熔断

**P2：规模化管理**

目标：让用户能长期维护多个团队和多套配置。

- 团队模板：稳健短线、新闻驱动、低频观察、持仓风控、盘前研究等
- 配置版本管理：Agent prompt、团队配置、风控策略的版本、差异、回滚
- Agent 评估排行榜：贡献、误报、采纳率、收益/亏损关联
- 多团队管理：不同策略团队并行运行，互不抢账户/资金边界
- 高级审计导出：交易链路、用户指令、配置变更、风控决策导出

1. **最小自动安全闭环**：网状执行器 `mesh-worker`（自带 canUseTool + MCP 白名单，不碰 workflow）+ Risk Gate 规则引擎 + OrderGateway paper 后端（正式化 `check_sim` 的实时现价撮合）+ order_ticket。目标跑通 `order_intent -> Risk Gate -> ticket(auto) -> paper 撮合 -> 回写结果`。
2. **网状骨架**：MeshRuntime + 10 张表 + `mesh-collab`(只读) + Agent Registry + action plan/outbox 事务 + 把 mesh-worker 包成 participant 循环（白板/喇叭/任务信封/per-sub 投递跑通）。
3. **炒股 team 实例化**：8 个 participant + 订阅图 + 风控硬上限 + 心跳接 scheduler，跑全自动 paper 闭环。
4. **P0 最小可用 UI/IM**：Leader 对话入口、团队总览、最近意图/订单、拒单原因、交易意图时间线、用户指令历史、停止运行、停止下单、paper/live 模式、auto/manual 模式、团队控制面、Agent 配置页、风控基础配置。先做能看、能停、能切模式、能指挥团队、能管配置、能看清关键链路，不追求一步到位的完整驾驶舱。
5. **接 live 后端**：复用同一 OrderGateway 接 QMT live；是否逐笔确认由 `confirmMode` 决定，默认产品主路径仍支持全自动。

> 注：CLAUDE.md「缺失步骤类型：approval」一句已过时（approval 设施已存在），建议后续更新该说明。
