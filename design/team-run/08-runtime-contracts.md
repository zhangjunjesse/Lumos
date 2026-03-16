# Team Runtime 开发合同

**版本**: 1.0  
**日期**: 2026-03-14  
**状态**: 可直接支撑 Phase 1 / Phase 2 开发

---

## 1. 文档目标

本文档将 [`07-main-agent-team-foundation.md`](./07-main-agent-team-foundation.md) 中的架构层级收敛成可开发的运行时合同，解决以下阻塞问题：

1. Planner 输入/输出结构不够精确
2. Run 编译产物缺少稳定 schema
3. Stage 执行 payload/result 缺少确定格式
4. 最终汇总合同未定义

本文档只定义运行时结构化合同，不定义数据库迁移和 API 端点；后两者分别见：

- [`09-storage-and-migration.md`](./09-storage-and-migration.md)
- [`10-query-projection-api.md`](./10-query-projection-api.md)

---

## 2. 版本约定

所有结构化 payload 都必须显式带版本号，避免未来演化时破坏兼容性。

```text
V1 约定
- PlannerDraftPlanV1
- CompiledRunPlanV1
- StageExecutionPayloadV1
- StageExecutionResultV1
- FinalSummaryPayloadV1
- FinalSummaryResultV1
```

版本规则：

1. 同一个对象结构发生破坏性变化时必须升主版本
2. 新增可选字段不升主版本
3. Runtime 存储时保留 `planner_version` 或 `contract_version`

---

## 3. 运行时边界

## 3.1 MVP 的 Planner 输入来源

MVP 阶段，Main Agent 在聊天中产出的 `lumos-team-plan` 是 Planner 的上游输入，不额外再插入一个强依赖的新 LLM 步骤。

即：

```text
Main Agent Team Plan
  -> normalize()
  -> validate()
  -> compile()
  -> CompiledRunPlanV1
```

后续如果加入真正的 Planner LLM，只能插在 `normalize/compile` 之间，且仍然必须产出同一个 `PlannerDraftPlanV1`。

这意味着：

- 当前主链路可以先不实现新的 Planner LLM 调用
- 运行时合同从今天开始稳定
- 后续再引入 Planner LLM 也不需要重写执行器

---

## 4. 输入合同

## 4.1 MainAgentTeamPlanV1

这是 Main Agent 对外生成的 `lumos-team-plan` 块，对应当前已存在的 JSON 结构。

```ts
interface MainAgentTeamPlanV1 {
  version: 1
  summary: string
  activationReason: 'user_requested' | 'main_agent_suggested'
  userGoal: string
  roles: Array<{
    id: string
    name: string
    kind: 'main_agent' | 'orchestrator' | 'lead' | 'worker'
    responsibility: string
    parentRoleId?: string
  }>
  tasks: Array<{
    id: string
    title: string
    ownerRoleId: string
    summary: string
    dependsOn: string[]
    expectedOutput: string
  }>
  expectedOutcome: string
  risks?: string[]
  confirmationPrompt?: string
}
```

## 4.2 PlannerDraftPlanV1

`PlannerDraftPlanV1` 是运行时真正消费的规划草案，是对 `MainAgentTeamPlanV1` 的标准化包装。

```ts
interface PlannerDraftPlanV1 {
  contractVersion: 'planner-draft/v1'
  source: 'main-agent-team-plan'
  sourceMessageId?: string
  sessionId: string
  taskId: string
  userGoal: string
  summary: string
  expectedOutcome: string
  roles: DraftRoleV1[]
  draftStages: DraftStageV1[]
  budget?: DraftBudgetV1
  risks?: string[]
}

interface DraftRoleV1 {
  externalRoleId: string
  name: string
  roleKind: 'main_agent' | 'orchestrator' | 'lead' | 'worker'
  responsibility: string
  parentExternalRoleId?: string
}

interface DraftStageV1 {
  externalTaskId: string
  title: string
  summary: string
  ownerExternalRoleId: string
  dependsOnExternalTaskIds: string[]
  expectedOutput: string
}

interface DraftBudgetV1 {
  maxParallelWorkers?: number
  maxRetriesPerTask?: number
  maxRunMinutes?: number
}
```

### 规范化规则

1. `sessionId`、`taskId` 在进入 runtime 前补入
2. `roles` 和 `draftStages` 中的外部 id 保留原值，仅用于映射
3. `budget` 缺失时使用系统默认值

---

## 5. 编译合同

`compilePlan()` 的输入是 `PlannerDraftPlanV1`，输出是 `CompiledRunPlanV1`。

## 5.1 CompiledRunPlanV1

```ts
interface CompiledRunPlanV1 {
  contractVersion: 'compiled-run-plan/v1'
  taskId: string
  sessionId: string
  runId: string
  plannerMode: 'direct_plan_v1'
  workspaceRoot: string
  publicTaskContext: {
    userGoal: string
    summary: string
    expectedOutcome: string
    risks: string[]
  }
  roles: CompiledRoleV1[]
  budget: CompiledBudgetV1
  stages: CompiledStageV1[]
  stageOrder: string[]
  createdAt: string
}

interface CompiledRoleV1 {
  roleId: string
  externalRoleId: string
  name: string
  roleKind: 'main_agent' | 'orchestrator' | 'lead' | 'worker'
  responsibility: string
  parentRoleId?: string
  agentType: string
}

interface CompiledBudgetV1 {
  maxParallelWorkers: number
  maxRetriesPerTask: number
  maxRunMinutes: number
}

interface CompiledStageV1 {
  stageId: string
  externalTaskId: string
  title: string
  description: string
  ownerRoleId: string
  ownerAgentType: string
  dependsOnStageIds: string[]
  inputContract: StageInputContractV1
  outputContract: StageOutputContractV1
  acceptanceCriteria: string[]
}
```

## 5.2 Stage contract

```ts
interface StageInputContractV1 {
  requiredDependencyOutputs: Array<{
    fromStageId: string
    kind: 'summary' | 'artifact_ref'
    required: true
  }>
  taskContext: {
    includeUserGoal: true
    includeExpectedOutcome: true
    includeRunSummary: boolean
  }
}

interface StageOutputContractV1 {
  primaryFormat: 'markdown'
  mustProduceSummary: true
  mayProduceArtifacts: boolean
  artifactKinds: Array<'file' | 'log' | 'metadata' | 'report'>
}
```

## 5.3 编译规则

### ID 编译

外部 `task.id` 和 `role.id` 不直接进入 runtime 主键。

原因：

- 外部 id 由 LLM 生成，不保证满足内部正则
- 依赖校验和 SQL 存储需要稳定内部 id

规则：

```text
externalTaskId -> stageId
externalRoleId -> roleId
```

内部 id 要求：

```text
^[a-zA-Z0-9_-]{8,64}$
```

### 编译失败条件

以下情况 `compilePlan()` 必须失败并返回结构化错误，而不能进入运行态：

1. 角色为空
2. 阶段为空
3. `ownerExternalRoleId` 不存在
4. `dependsOnExternalTaskIds` 引用了不存在的 task
5. 依赖图存在环
6. `maxParallelWorkers < 1`
7. `maxRetriesPerTask < 0`

### 默认预算

```ts
const DEFAULT_RUN_BUDGET_V1: CompiledBudgetV1 = {
  maxParallelWorkers: 3,
  maxRetriesPerTask: 1,
  maxRunMinutes: 120,
}
```

---

## 6. 执行输入合同

## 6.1 StageExecutionPayloadV1

每次调度一个 stage，Orchestrator 必须构造以下 payload 交给子 Agent。

```ts
interface StageExecutionPayloadV1 {
  contractVersion: 'stage-execution-payload/v1'
  taskId: string
  sessionId: string
  runId: string
  stageId: string
  attempt: number
  workspace: WorkspaceBindingV1
  agent: AgentExecutionBindingV1
  taskContext: {
    userGoal: string
    summary: string
    expectedOutcome: string
  }
  stage: {
    title: string
    description: string
    acceptanceCriteria: string[]
    inputContract: StageInputContractV1
    outputContract: StageOutputContractV1
  }
  dependencies: DependencyResultRefV1[]
  memoryRefs: {
    taskMemoryId: string
    plannerMemoryId: string
    agentMemoryId: string
  }
}

interface WorkspaceBindingV1 {
  sessionWorkspace: string
  runWorkspace: string
  stageWorkspace: string
  sharedReadDir: string
  artifactOutputDir: string
}

interface AgentExecutionBindingV1 {
  agentDefinitionId: string
  agentType: string
  roleName: string
  systemPrompt: string
  allowedTools: string[]
  memoryPolicy: 'ephemeral-stage' | 'sticky-run'
}

interface DependencyResultRefV1 {
  stageId: string
  title: string
  summary: string
  artifactRefs: string[]
}
```

### 输入约束

1. 子 Agent 只收到上游依赖结果，不收到全量阶段结果
2. `dependencies.summary` 必须是受控长度摘要，不直接塞原始大文本
3. 原始大文本通过 `artifactRefs` 获取

---

## 7. 执行输出合同

## 7.1 StageExecutionResultV1

```ts
interface StageExecutionResultV1 {
  contractVersion: 'stage-execution-result/v1'
  runId: string
  stageId: string
  attempt: number
  outcome: 'done' | 'failed' | 'blocked'
  summary: string
  detailArtifactRef?: string
  artifacts: Array<{
    kind: 'file' | 'log' | 'metadata' | 'report'
    artifactId: string
    title: string
  }>
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  memoryAppend?: Array<{
    scope: 'agent'
    content: string
  }>
  metrics: {
    startedAt: string
    finishedAt: string
    durationMs: number
    tokensUsed?: number
    apiCalls?: number
  }
}
```

## 7.2 结果规则

### `outcome = done`

必须满足：

- `summary` 非空
- `error` 为空

### `outcome = failed`

必须满足：

- `summary` 可为空
- `error` 非空

### `outcome = blocked`

用于表示：

- 输入缺失
- 前置条件不满足
- 需要人工处理才能继续

`blocked` 不是 `failed`，但不会自动继续。

---

## 8. 最终汇总合同

## 8.1 FinalSummaryPayloadV1

```ts
interface FinalSummaryPayloadV1 {
  contractVersion: 'final-summary-payload/v1'
  taskId: string
  sessionId: string
  runId: string
  userGoal: string
  expectedOutcome: string
  stageResults: Array<{
    stageId: string
    title: string
    status: 'done' | 'failed' | 'blocked' | 'cancelled'
    summary: string
    artifactRefs: string[]
  }>
  runSummary: string
}
```

## 8.2 FinalSummaryResultV1

```ts
interface FinalSummaryResultV1 {
  contractVersion: 'final-summary-result/v1'
  runId: string
  finalSummary: string
  keyOutputs: string[]
  publishableMessage: string
}
```

### 约束

1. `finalSummary` 用于任务页、团队页
2. `publishableMessage` 用于回写 Main Agent 聊天
3. 这两个字段都必须来自同一份最终汇总结果，禁止各写一套

---

## 9. AgentDefinition 合同

## 9.1 AgentDefinitionV1

```ts
interface AgentDefinitionV1 {
  id: string
  agentType: string
  roleName: string
  responsibility: string
  systemPrompt: string
  allowedTools: string[]
  capabilityTags: string[]
  outputSchema: 'stage-execution-result/v1'
  memoryPolicy: 'ephemeral-stage' | 'sticky-run'
  concurrencyLimit: number
}
```

## 9.2 MVP 的 agentType 映射规则

MVP 阶段不做复杂智能匹配，采用确定性映射：

```text
roleKind = orchestrator -> agentType = orchestrator.default
roleKind = lead         -> agentType = lead.default
roleKind = worker       -> agentType = worker.default
```

如果未来接入用户自定义 Agent Preset，可在编译阶段覆盖默认映射，但 `CompiledRunPlanV1` 仍保持不变。

---

## 10. 编译与执行的伪代码

```ts
function createRunFromApprovedTask(task: TaskRecord): CompiledRunPlanV1 {
  const draft = normalizeMainAgentPlanToDraft(task)
  validatePlannerDraft(draft)
  return compilePlan(draft)
}

function executeStage(stage: CompiledStageV1): StageExecutionResultV1 {
  const payload = buildStageExecutionPayload(stage)
  return subAgentExecutor.execute(payload)
}
```

---

## 11. 与现有代码的映射

### 当前 `lumos-team-plan`

可直接映射到：

- `MainAgentTeamPlanV1`
- `PlannerDraftPlanV1`

### 当前 `team_run_stages`

后续应以以下字段语义对齐：

- `name` -> `title`
- `task` -> `description`
- `role_id` -> `ownerRoleId` 或 `agentDefinitionId`
- `dependencies` -> `dependsOnStageIds`

### 当前 `StageWorker`

必须改为消费 `StageExecutionPayloadV1`，并产出 `StageExecutionResultV1`。

---

## 12. 实施验收标准

满足以下条件，说明运行时合同已经足够支撑开发：

1. 编译前后的对象都有明确 schema
2. Stage 执行输入输出可独立测试
3. 最终汇总有统一格式
4. 子 Agent 结果可以脱离 UI 独立落库
5. 新增 Planner LLM 时不破坏执行器接口

