# Main Agent / Team Runtime 基础架构方案

**版本**: 1.0  
**日期**: 2026-03-14  
**状态**: 作为后续开发基线，批准进入实施设计

---

## 1. 文档目标

本文档定义 Lumos 当前 Main Agent / Team Mode 的目标基础架构，用于替换当前存在的两套割裂链路：

1. `tasks.ts` 中的简化自动推进骨架
2. `src/lib/team-run/*` 中未完全接入主链路的真实执行器

本文档回答 5 个核心问题：

1. 模块应该如何分层
2. 每层的职责边界是什么
3. 数据应该由谁持有，谁是唯一真相源
4. 一次团队任务从创建到完成如何流转
5. 后续开发应该按什么顺序落地

---

## 2. 当前问题

### 2.1 当前系统存在两套运行态

```text
A. tasks.description.run
   - 主链路在读
   - 当前是模拟推进

B. team_runs / team_run_stages
   - 执行器在写
   - 但没有成为主链路真相源
```

结果：

- 主聊天、任务页、团队页读到的是伪运行态
- 真实执行器没有成为产品主链路
- 代码中同时存在“模拟执行”和“真实执行”两种模型
- 后续继续开发会不断放大状态分裂

### 2.2 当前简化链路必须移除

必须移除的不是 Team Plan 本身，而是以下行为：

- 在 `tasks.ts` 中通过 timer/tick 模拟 phase 前进
- 自动生成骨架结果作为阶段输出
- 让 UI 直接依赖 task record 中的伪 run 状态

保留的部分：

- Main Agent 产出 Team Plan
- 用户审批 Team Plan
- task 作为用户级任务实体

---

## 3. 设计目标

### 3.1 核心目标

```text
主 Agent 负责理解用户和对外汇报
任务管理层负责任务真相源和结果返回
调度层负责规划、编排、控制执行
子 Agent 层负责实际执行
记忆/产物层负责上下文与结果持久化
```

### 3.2 必须满足的设计原则

1. 单一职责
   Main Agent、Planner、Orchestrator、SubAgent 不混用职责。

2. 单一真相源
   任务状态和运行状态必须分层管理，不能同时维护两套运行态。

3. 调度尽量确定性
   任务理解交给 Planner LLM；执行时序、并发、重试、状态推进交给确定性调度器。

4. 子 Agent 简单协同
   子 Agent 之间不直接通信，只与主调度层通信。

5. 记忆分区隔离
   每个子 Agent 实例有独立记忆区；Planner 和 Main Agent 不直接共享子 Agent 私有 scratchpad。

6. UI 只读投影
   UI 不能自己制造运行态，只能读取 query/projection 层投影结果。

---

## 4. 目标总体架构

```text
┌──────────────┐
│     用户      │
└──────┬───────┘
       │
       v
┌──────────────┐
│  Main Agent  │
│ 用户入口/总结 │
└──────┬───────┘
       │ create task / start run / get result
       v
┌──────────────────────────┐
│   Task Management Layer  │
│ 任务、审批、结果、查询入口 │
└──────┬───────────────────┘
       │ create run / query run / publish result
       v
┌──────────────────────────────────────────────┐
│             Scheduling Layer                │
│                                              │
│  ┌────────────────┐   ┌──────────────────┐  │
│  │ Planner LLM    │   │ Orchestrator     │  │
│  │ 理解/分解/规划   │-->| DAG/并发/重试/汇总 │  │
│  └────────────────┘   └────────┬─────────┘  │
└─────────────────────────────────┼────────────┘
                                  │ allocate / execute
                                  v
┌──────────────────────────────────────────────┐
│              SubAgent Layer                  │
│                                              │
│  ┌────────────────┐   ┌──────────────────┐  │
│  │ SubAgent       │   │ Agent Instances  │  │
│  │ Definitions    │   │ A1 / B1 / A2 ... │  │
│  └────────────────┘   └────────┬─────────┘  │
└─────────────────────────────────┼────────────┘
                                  │ read/write
                                  v
┌──────────────────────────────────────────────┐
│        Memory / Artifact / Event Layer       │
│ task memory / planner memory / agent memory  │
│ artifacts / execution events / logs          │
└──────────────────────────────────────────────┘
```

---

## 5. 模块划分与职责边界

## 5.1 Main Agent

### 职责

- 面向用户理解请求
- 判断是单 agent 模式还是团队模式
- 在需要团队模式时发起顶层任务
- 接收最终汇总并回到用户对话

### 不负责

- 不直接维护 DAG
- 不直接分配子 Agent
- 不直接管理 stage 生命周期
- 不直接保存运行时状态

### 输入

- 用户消息
- 当前会话上下文
- 任务管理层返回的任务状态与最终结果

### 输出

- `TaskCreateRequest`
- `TaskStartTeamRunRequest`
- 面向用户的解释或最终总结

---

## 5.2 Task Management Layer

### 职责

- 管理用户级任务实体
- 管理任务审批状态
- 作为 Main Agent 的统一入口
- 保存任务级结果
- 对 UI 和主对话返回可查询状态

### 核心原则

```text
Task Management 管“任务业务态”
Scheduling Runtime 管“运行执行态”
```

### 管理的对象

- `Task`
- `TaskRun`
- `TaskApproval`
- `TaskResultSummary`
- `TaskProjection`

### 典型接口

```text
createTask(userGoal, sessionContext) -> taskId
submitTeamPlan(taskId, plan) -> taskId
approveTaskPlan(taskId) -> runId
getTask(taskId) -> TaskView
getTaskResult(taskId) -> FinalResult
publishRunSummary(taskId, summary) -> ok
```

### 边界

- 不负责具体并发调度
- 不直接执行子 Agent
- 不持有子 Agent 私有记忆

---

## 5.3 Scheduling Layer

调度层必须拆成两个部分，不能合并。

```text
Scheduling Layer = Planner LLM + Deterministic Orchestrator
```

### 5.3.1 Planner LLM

### 职责

- 理解顶层任务
- 进行任务分解
- 构造阶段 DAG
- 定义每个阶段的输入、输出和验收标准
- 指定所需子 Agent 类型

### 输出的不是自然语言，而是结构化 Plan

```text
Plan
- run goal
- stages[]
- dependencies[]
- output contracts[]
- required agent type[]
- budget / timeout / retry policy
```

### 约束

- Planner 只负责规划，不直接执行
- Planner 输出必须结构化、可校验
- Planner 不能直接改写任务最终状态

### 5.3.2 Orchestrator

### 职责

- 接收 Planner 产出的结构化 Plan
- 计算 ready stages
- 按并发策略调度执行
- 分配子 Agent 实例
- 收集结果，驱动状态流转
- 触发重试、失败收敛、完成汇总

### 特征

- 尽量确定性
- 不承担“理解用户任务”的职责
- 所有状态推进都通过显式状态机完成

### 典型接口

```text
planRun(runId) -> CompiledRunPlan
startRun(runId) -> ok
pauseRun(runId) -> ok
cancelRun(runId) -> ok
resumeRun(runId) -> ok
onStageFinished(stageId, result) -> next actions
```

---

## 5.4 SubAgent Layer

## 5.4.1 SubAgent Manager

### 职责

- 管理子 Agent 定义
- 按要求创建 agent 实例
- 回收 agent 实例
- 分配实例对应的记忆区和工作区

### 典型接口

```text
registerAgentDefinition(definition)
allocateAgent(stageRequirement) -> agentInstanceId
releaseAgent(agentInstanceId)
getAgentDefinition(agentType)
```

## 5.4.2 SubAgent Definition

每类子 Agent 都是一个模板定义，不是具体运行实例。

```text
AgentDefinition
- agentType
- roleName
- responsibility
- systemPrompt
- capabilityTags
- allowedTools
- outputSchema
- memoryPolicy
- concurrencyLimit
```

## 5.4.3 SubAgent Instance

### 职责

- 接收单个 stage 的执行指令
- 读取该 stage 可见上下文
- 执行并产出结构化结果
- 写入自己的实例记忆和 artifact

### 协同约束

```text
子 Agent 之间不直接通信
子 Agent 只和 Orchestrator / Planner 交互
上游协作只通过 stage result 完成
```

### 实例模型

MVP 阶段采用短生命周期实例：

- 一个 stage 默认对应一个 agent instance
- 同一 agent type 可以并发多个实例
- 一个实例执行完该 stage 后即可回收

后续才考虑升级为长会话可复用实例。

---

## 5.5 Memory / Artifact / Event Layer

该层不是一个单一表，而是一组清晰分区的存储。

### 5.5.1 Memory 分区

```text
Task Memory
- 任务全局上下文
- 用户目标、约束、对外摘要

Planner Memory
- 规划历史
- 拆解决策
- 阶段汇总

Agent Instance Memory
- 某个子 Agent 实例的局部记忆
- 私有 scratchpad
- 工具执行记录摘要
```

### 5.5.2 Artifact Store

保存：

- 阶段输出
- 文件产物
- 日志片段
- 汇总结果
- 大文本结果

### 5.5.3 Event Store

保存：

- run 创建/启动/暂停/取消事件
- stage 分配/开始/完成/失败事件
- agent 实例分配/回收事件
- planner 重规划事件

---

## 5.6 Query / Projection Layer

这是当前设计里必须明确补上的一层。

### 职责

- 将 task + run + stage + artifact 投影成 UI 所需视图
- 为 `/tasks`、`/team`、主聊天 banner 提供统一查询模型

### 原则

```text
UI 永远不直接拼装运行态
UI 只读取 Projection
Projection 从真相源投影
```

---

## 6. 单一真相源定义

## 6.1 业务真相源

```text
Task
- 谁发起了任务
- 用户目标是什么
- 是否批准团队执行
- 当前关联哪个 run
- 最终对外结果是什么
```

## 6.2 运行真相源

```text
TaskRun / Stage / AgentExecution / Artifact / Event
- 任务如何被规划
- 正在跑哪些阶段
- 哪个子 Agent 在执行
- 实际产出是什么
- 错误和日志是什么
```

## 6.3 明确禁止

禁止继续维护以下模型：

- 在 task description 中维护伪 run 状态
- 用定时 tick 人工推进阶段状态
- 让 UI 混合读取 task record 和 runtime 自己拼状态

---

## 7. 数据模型

## 7.1 核心实体关系图

```text
Task
 ├─ 1:N -> TaskRun
 └─ 1:1 -> CurrentTaskProjection

TaskRun
 ├─ 1:N -> Stage
 ├─ 1:N -> PlannerDecision
 ├─ 1:N -> RunEvent
 └─ 1:N -> Artifact

Stage
 ├─ N:1 -> TaskRun
 ├─ 1:N -> StageExecutionAttempt
 ├─ N:N -> StageDependency
 ├─ 1:N -> Artifact
 └─ 0:1 -> AssignedAgentDefinition

StageExecutionAttempt
 ├─ N:1 -> Stage
 ├─ 0:1 -> AgentInstance
 └─ 1:N -> ExecutionEvent

AgentDefinition
 └─ 1:N -> AgentInstance

AgentInstance
 ├─ N:1 -> AgentDefinition
 ├─ 1:1 -> MemorySpace
 └─ 1:N -> StageExecutionAttempt

MemorySpace
 ├─ task scope
 ├─ planner scope
 └─ agent-instance scope
```

## 7.2 推荐实体定义

### Task

```text
Task
- id
- sessionId
- userGoal
- title
- mode: single | team
- approvalStatus: pending | approved | rejected
- currentRunId
- businessStatus: draft | planned | running | summarizing | done | failed | cancelled
- finalResultSummary
- createdAt
- updatedAt
```

### TaskRun

```text
TaskRun
- id
- taskId
- plannerVersion
- planningInput
- planningOutput
- runtimeStatus: created | planning | ready | running | paused | cancelling | cancelled | summarizing | done | failed
- budget
- workspaceRoot
- summary
- finalSummary
- startedAt
- completedAt
- updatedAt
```

### Stage

```text
Stage
- id
- runId
- title
- description
- ownerAgentType
- inputContract
- outputContract
- dependsOn[]
- status: pending | ready | assigned | running | retrying | blocked | done | failed | cancelled
- latestResultRef
- lastError
- retryCount
- startedAt
- completedAt
- updatedAt
```

### AgentDefinition

```text
AgentDefinition
- id
- agentType
- roleName
- systemPrompt
- capabilityTags[]
- allowedTools[]
- outputSchema
- memoryPolicy
- concurrencyLimit
```

### AgentInstance

```text
AgentInstance
- id
- agentDefinitionId
- runId
- stageId
- memorySpaceId
- status: idle | allocated | running | completed | failed | released
- createdAt
- releasedAt
```

### Artifact

```text
Artifact
- id
- runId
- stageId?
- ownerType: planner | agent | system
- type: output | file | log | metadata | summary
- contentRef
- contentType
- size
- createdAt
```

### Event

```text
RunEvent
- id
- runId
- stageId?
- eventType
- payload
- createdAt
```

---

## 8. 状态机

## 8.1 Task 状态机

```text
draft
  -> planned
  -> rejected

planned
  -> approved
  -> rejected

approved
  -> running
  -> cancelled

running
  -> summarizing
  -> failed
  -> cancelled

summarizing
  -> done
  -> failed
```

说明：

- `Task` 的状态面向业务和用户
- `TaskRun` 的状态面向运行时
- 两者可以相关，但不要求完全一一对应
- 本节状态机是概念模型；持久化状态集合和 projection 派生规则以后续合同文档为准，见 [`09-storage-and-migration.md`](./09-storage-and-migration.md)、[`10-query-projection-api.md`](./10-query-projection-api.md)、[`11-runtime-control-semantics.md`](./11-runtime-control-semantics.md)

## 8.2 TaskRun 状态机

```text
created
  -> planning
  -> failed

planning
  -> ready
  -> failed

ready
  -> running
  -> cancelled

running
  -> paused
  -> summarizing
  -> failed
  -> cancelling

paused
  -> running
  -> cancelled

cancelling
  -> cancelled
  -> failed

summarizing
  -> done
  -> failed
```

## 8.3 Stage 状态机

```text
pending
  -> ready

ready
  -> assigned
  -> blocked
  -> cancelled

assigned
  -> running
  -> failed

running
  -> done
  -> failed
  -> retrying
  -> cancelled

retrying
  -> ready
  -> failed

blocked
  -> ready
  -> failed

done
  -> terminal

failed
  -> terminal
```

## 8.4 AgentInstance 状态机

```text
idle
  -> allocated

allocated
  -> running
  -> released

running
  -> completed
  -> failed
  -> released

completed
  -> released

failed
  -> released
```

---

## 9. 时序图

## 9.1 创建与审批

```text
用户
  -> Main Agent: 请求复杂任务
Main Agent
  -> Task Management: createTask()
Main Agent
  -> Task Management: submitTeamPlan()
Task Management
  -> UI Projection: 返回待审批状态

用户
  -> Main Agent/UI: 批准 Team Plan
Task Management
  -> Scheduling Layer: createRunFromPlan(taskId, plan)
Scheduling Layer
  -> Planner LLM: compile/validate plan
Scheduling Layer
  -> Runtime Store: create TaskRun + Stages
Scheduling Layer
  -> Orchestrator: startRun(runId)
```

## 9.2 执行循环

```text
Orchestrator
  -> Runtime Store: query ready stages
Orchestrator
  -> SubAgent Manager: allocate agent instance
SubAgent Manager
  -> Memory Layer: provision instance memory
SubAgent Manager
  -> Agent Instance: execute(stage payload)
Agent Instance
  -> Memory Layer: read own memory + stage context
Agent Instance
  -> Tools/LLM: execute
Agent Instance
  -> Artifact Store: save outputs
Agent Instance
  -> Orchestrator: return structured result
Orchestrator
  -> Runtime Store: update stage status/result
Orchestrator
  -> Runtime Store: unlock downstream stages
Orchestrator
  -> Query Projection: publish new view
```

## 9.3 完成与回传

```text
Orchestrator
  -> Runtime Store: detect all stages done
Orchestrator
  -> Planner LLM or Summarizer: create final summary
Orchestrator
  -> Task Management: publish final result
Task Management
  -> Main Agent: task completed summary
Main Agent
  -> 用户: 最终回复
```

---

## 10. 记忆模型

## 10.1 可见性规则

### Main Agent 可读

- task summary
- final result
- planner 汇总结果

### Main Agent 不直接读

- 子 Agent 私有 scratchpad
- 子 Agent 中间推理记录

### Planner LLM 可读

- task memory
- 所有 stage 结果
- planner 自己的历史决策

### Planner LLM 不直接读

- 其他 agent 的原始私有记忆全文

### SubAgent Instance 可读

- 当前 stage payload
- 上游依赖结果
- 自己的 agent instance memory
- 必要的 task-level public context

### SubAgent Instance 不可读

- 其他 agent 的私有 memory
- 非依赖链路上的中间结果

## 10.2 记忆写入规则

```text
Task Memory
- 只写入对整个任务长期有用的上下文

Planner Memory
- 只写入规划和汇总层面的结构化信息

Agent Instance Memory
- 只写入当前 agent 执行相关的局部上下文
- 默认不跨 stage 共享，除非未来明确引入长寿命 agent
```

---

## 11. 工作区模型

这是当前“真实执行器”要补齐的关键部分。

## 11.1 原则

子 Agent 不能默认跑在空的临时 stage 目录中。  
子 Agent 应该基于用户真实工作目录执行，再叠加 run/stage 级隔离目录。

## 11.2 推荐目录模型

```text
Session Workspace
  = 用户当前项目目录

Run Workspace
  = Session Workspace + .lumos/team-runs/<runId>/

Stage Workspace
  = Run Workspace/stages/<stageId>/
```

## 11.3 访问规则

### 子 Agent 默认可读

- Session Workspace
- Run shared directory
- 当前 Stage directory
- 上游 artifacts

### 子 Agent 默认可写

- 当前 Stage directory
- 允许写入的项目目录范围
- Artifact output directory

### 不允许

- 任意写系统临时目录作为唯一执行目录
- 不经约束地写其他 stage 私有目录

---

## 12. 调度与执行策略

## 12.1 并发策略

- 并发控制由 Orchestrator 持有
- Planner 只提供预算建议，不直接控制执行线程
- 默认并发上限来自 `run budget`

## 12.2 重试策略

- 仅失败阶段允许重试
- 重试次数由 `maxRetriesPerTask` 限制
- 重试前必须记录失败原因和 attempt 编号
- 对确定性校验失败和环境失败使用不同重试策略

## 12.3 阻塞策略

- 上游失败时，下游阶段可进入 `blocked`
- `blocked` 不等于 `failed`
- 支持人工恢复或未来的自动重规划

## 12.4 汇总策略

最后结果汇总应该独立为一个阶段或一个明确步骤，不要隐式混在最后一个 worker 里。

---

## 13. 观测性与审计

必须具备以下观测能力：

1. Run 级事件流
2. Stage 级状态变更历史
3. Agent 实例分配与释放日志
4. Planner 决策记录
5. Artifact 清单
6. 面向 UI 的投影更新时间

推荐最少事件类型：

- `run.created`
- `run.planned`
- `run.started`
- `run.paused`
- `run.cancelled`
- `stage.ready`
- `stage.assigned`
- `stage.started`
- `stage.completed`
- `stage.failed`
- `stage.blocked`
- `agent.allocated`
- `agent.released`
- `summary.published`

---

## 14. 安全边界

## 14.1 权限边界

- Main Agent 继承用户会话权限边界
- 子 Agent 默认继承该边界的受限版本
- allowed tools 必须从 AgentDefinition 中显式声明

## 14.2 审批边界

MVP 阶段继续复用主运行时审批体系，但审批结果应体现在 runtime event 中，而不是仅体现在 UI。

## 14.3 数据边界

- 子 Agent 间无直接内存共享
- 大结果通过 artifact 传递
- 不允许通过 prompt 注入无限增长的上游输出

---

## 15. 与现有代码的映射关系

## 15.1 保留

- Main Agent 产出 Team Plan
- Team Plan 审批入口
- `src/lib/team-run/*` 作为真实运行时基础

## 15.2 移除

- `tasks.ts` 中基于 timer/tick 的 run 自动推进骨架
- 在 task record 中伪造阶段结果
- 让 task record 承担 runtime 真相源

## 15.3 重构方向

### 现有 `tasks.ts`

后续只保留：

- task 业务记录
- team plan 持久化
- approval 更新
- query/projection 聚合入口

### 现有 `team-run/*`

后续升级为：

- `Planner integration`
- `Run orchestration`
- `State manager`
- `Agent execution`
- `Artifact store`
- `Projection support`

---

## 16. 分阶段实施方案

## Phase 1: 统一真相源

目标：

- task record 不再保存伪 run 状态
- task 只保存 `plan + approval + currentRunId`
- `team_runs / team_run_stages` 成为唯一运行真相源

交付：

- 数据结构收敛
- 查询入口改造
- 自动 tick 骨架移除

## Phase 2: 接通真实执行链路

目标：

- 批准 Team Plan 后创建真实 run
- run 进入 `orchestrator`
- stage 真正执行并回写 SQLite

交付：

- `createRunFromPlan`
- `startRun`
- run/stage 状态同步

## Phase 3: 投影层替换 UI 读取

目标：

- `/tasks`
- `/team`
- 主聊天 Team banner
- Team workspace

全部改为读取 runtime projection。

## Phase 4: 工作区与记忆隔离

目标：

- 接入真实 session workspace
- 子 Agent 实例记忆落库
- artifacts 统一管理

## Phase 5: 恢复与汇总

目标：

- pause/cancel/resume 语义补齐
- final summary 明确化
- 回写 Main Agent 聊天

---

## 17. MVP 能力边界

基于本方案落地后的 MVP，能够做到：

- 主 Agent 理解任务并触发团队模式
- Planner LLM 做任务分解
- Orchestrator 按 DAG 和并发限制调度
- 子 Agent 多实例并发执行
- 每个子 Agent 拥有独立记忆区
- 子 Agent 只与主调度层通信
- UI 展示真实运行态

仍然不能做到：

- 真正自治的 agent-to-agent 通信网络
- 长寿命、自主演化的持久子 Agent
- 共享黑板式复杂协作
- 高阶自组织团队结构

这不是缺陷，而是明确的 MVP 范围控制。

---

## 18. 实施验收标准

满足以下条件，才算完成基础架构切换：

1. 主链路批准后不再走模拟 tick
2. UI 不再依赖 task record 中的伪 run 状态
3. 每个 stage 的状态来自真实 runtime
4. 团队页和任务页展示同一 run 的一致投影
5. 子 Agent 执行发生在真实工作区模型上
6. 最终 summary 由 runtime 发布回 Main Agent

---

## 19. 最终结论

后续开发应以本方案为基线，遵守以下三条硬规则：

1. `Task` 是业务入口，不是执行器。
2. `TaskRun / Stage / AgentExecution` 是运行真相源。
3. `Main Agent -> Task Management -> Scheduling -> SubAgent` 是唯一允许的主链路。

如果后续实现与本文档冲突，以本文档定义的职责边界和真相源划分为准；旧文档中的模拟执行链路视为被本方案替代。
