# Team Runtime 查询投影与 API 合同

**版本**: 1.0  
**日期**: 2026-03-14  
**状态**: 可直接支撑 Phase 3 开发

---

## 1. 文档目标

本文档定义：

1. UI 应该读取哪些 projection
2. projection 由哪些真相源组合而成
3. 哪些 API 是 canonical read API
4. SSE 事件格式如何定义

本文档的原则：

```text
raw record 不是 UI 合同
projection 才是 UI 合同
```

---

## 2. Projection 设计原则

1. UI 不直接读 `tasks.description`
2. UI 不直接读 `team_run_stages` 原始行
3. Projection 必须同时提供用户态字段和运行态字段
4. Projection 返回的 id 必须明确区分 `taskId` 和 `runId`

MVP 阶段不引入新的物化 projection 表，采用：

```text
truth sources
  -> projection service
  -> REST / SSE
```

即 projection 先在代码层按需计算，性能不足时再引入物化表。

---

## 3. Projection DTO

## 3.1 TeamBannerProjectionV1

用于主聊天顶部 Team Banner。

```ts
interface TeamBannerProjectionV1 {
  projectionVersion: number
  sessionId: string
  taskId: string
  runId?: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  runStatus?: 'pending' | 'ready' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'summarizing' | 'done' | 'failed'
  title: string
  summary: string
  completedStageCount: number
  totalStageCount: number
  currentStageTitle?: string
  currentExecutorName?: string
  taskPath: string
  teamPath: string
  historyCount: number
  recent: TeamBannerHistoryItemV1[]
  workspace?: TeamWorkspaceProjectionV1
}

interface TeamBannerHistoryItemV1 {
  taskId: string
  runId?: string
  title: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  runStatus: 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed'
  currentStageTitle?: string
  currentExecutorName?: string
  taskPath: string
  teamPath: string
}
```

## 3.2 TaskCatalogItemProjectionV1

用于 `/tasks` 列表。

```ts
interface TaskCatalogItemProjectionV1 {
  projectionVersion: 1
  taskId: string
  runId?: string
  source: 'manual' | 'team'
  title: string
  summary: string
  status:
    | 'pending'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'ready'
    | 'running'
    | 'waiting'
    | 'blocked'
    | 'paused'
    | 'cancelling'
    | 'cancelled'
    | 'summarizing'
    | 'done'
  executionMode: 'main_agent' | 'team_mode'
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  updatedAt: string
  progressCompleted: number
  progressTotal: number
  currentStage?: string
  currentExecutorName?: string
  latestOutput?: string
  taskPath: string
  teamPath?: string
}
```

## 3.3 TeamCatalogItemProjectionV1

用于 `/team` 列表。

```ts
interface TeamCatalogItemProjectionV1 {
  projectionVersion: 1
  taskId: string
  runId?: string
  title: string
  summary: string
  userGoal: string
  expectedOutcome: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  runStatus?: 'pending' | 'ready' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'summarizing' | 'done' | 'failed'
  roleCount: number
  taskCount: number
  completedTaskCount: number
  currentStage?: string
  currentExecutorName?: string
  latestOutput?: string
  updatedAt: string
  relatedTaskPath: string
  teamPath: string
}
```

## 3.4 TaskDetailProjectionV1

用于 `/tasks/[id]`。

```ts
interface TaskDetailProjectionV1 {
  projectionVersion: 1
  taskId: string
  runId?: string
  title: string
  summary: string
  userGoal?: string
  expectedOutcome?: string
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  businessStatus: string
  runStatus?: string
  currentStage?: string
  currentExecutorName?: string
  outputs: string[]
  artifacts: StageArtifactProjectionV1[]
  finalSummary?: string
}

interface TaskDetailProjectionResponseV1 {
  task: TaskDetailProjectionV1
  workspace?: TeamWorkspaceProjectionV1
}
```

## 3.5 TeamRunDetailProjectionV1

用于 `/team/[id]` 和 Team workspace。

```ts
interface TeamRunDetailProjectionV1 {
  projectionVersion: number
  taskId: string
  runId: string
  title: string
  summary: string
  userGoal: string
  expectedOutcome: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  runStatus: 'pending' | 'ready' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'summarizing' | 'done' | 'failed'
  budget: {
    maxParallelWorkers: number
    maxRetriesPerTask: number
    maxRunMinutes: number
  }
  lifecycle: {
    createdAt?: string
    startedAt?: string
    completedAt?: string
    publishedAt?: string
  }
  guardrails: {
    hierarchy: Array<'main_agent' | 'orchestrator' | 'lead' | 'worker'>
    maxDepth: number
    lockScope: 'session_runtime'
    resumeCount: number
  }
  roles: TeamRoleProjectionV1[]
  stages: TeamStageProjectionV1[]
  context: {
    summary: string
    finalSummary: string
    summarySource: 'auto' | 'manual'
    finalSummarySource: 'auto' | 'manual'
    blockedReason?: string
    lastError?: string
  }
}

interface TeamWorkspaceProjectionV1 {
  projectionVersion: 1
  taskId: string
  runId?: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  plan: TeamPlan
  run: TeamRun
}

interface TeamRoleProjectionV1 {
  roleId: string
  externalRoleId: string
  name: string
  roleKind: 'main_agent' | 'orchestrator' | 'lead' | 'worker'
  responsibility: string
}

interface TeamStageProjectionV1 {
  stageId: string
  planTaskId: string
  title: string
  status: 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'cancelled'
  ownerRoleId: string
  ownerAgentType: string
  expectedOutput: string
  dependsOnStageIds: string[]
  latestResultSummary?: string
  latestResultRef?: string
  retryCount: number
  updatedAt?: string
}

interface StageArtifactProjectionV1 {
  artifactId: string
  title: string
  type: 'output' | 'file' | 'log' | 'metadata' | 'summary'
  contentType: string
  size: number
  stageId?: string
}
```

---

## 4. Projection 组装规则

## 4.1 Task 相关 projection

`Task*Projection` 必须组合以下来源：

- `tasks`
- `team_runs`（如果 `current_run_id` 不为空）
- `team_run_stages`
- `team_run_artifacts`

## 4.2 Team 相关 projection

`Team*Projection` 以 `taskId` 为外部地址主键，以 `runId` 为内部运行主键。

原因：

- 用户看到的团队实体是“某个任务的团队执行”
- 内部运行态仍应明确区分 run

因此：

```text
/team/[taskId]
  -> server 先找到 task.current_run_id
  -> 再加载 TeamRunDetailProjectionV1
```

### Projection 派生状态

以下状态允许只存在于 projection，不要求直接持久化：

- `cancelling`
- `summarizing`

它们由 `team_runs.status` 与控制标记、汇总状态共同推导。

---

## 5. Canonical Read API

MVP 阶段建议保留旧端点兼容，但新增以下 canonical view 接口：

## 5.1 任务目录

```text
GET /api/tasks/catalog
```

响应：

```ts
interface MainAgentCatalogProjectionResponseV1 {
  tasks: TaskCatalogItemProjectionV1[]
  teams: TeamCatalogItemProjectionV1[]
  agentPresets: AgentPresetDirectoryItem[]
  teamTemplates: TeamTemplateDirectoryItem[]
}
```

说明：

- 这是 `/tasks` 和 `/team` 的统一目录入口
- `tasks` 和 `teams` 都必须来自 projection service

## 5.2 任务详情

```text
GET /api/tasks/:taskId/view
```

响应：

```ts
interface TaskDetailProjectionResponseV1 {
  task: TaskDetailProjectionV1
}
```

## 5.3 Team 详情

```text
GET /api/team-runs/:runId/view
```

响应：

```ts
interface TeamRunDetailProjectionResponseV1 {
  team: TeamRunDetailProjectionV1
}
```

## 5.4 Session Team Banner

```text
GET /api/sessions/:sessionId/team-banner
```

响应：

```ts
interface TeamBannerProjectionResponseV1 {
  banner: TeamBannerProjectionV1 | null
}
```

---

## 6. Legacy API 兼容策略

迁移期间允许保留以下旧接口：

- `GET /api/tasks/:id`
- `GET /api/tasks?session_id=...`

但规则是：

1. UI 新代码不得再把这些接口当成 canonical view
2. 旧接口只用于迁移期兼容
3. 所有新展示逻辑都应切到 `/view` 或 `/catalog`

---

## 7. SSE 合同

## 7.1 SSE 端点

```text
GET /api/team-runs/:runId/stream
```

## 7.2 事件模型

连接成功后，服务端必须先发送一条 `snapshot`，之后发送增量事件。

### `connected`

```json
{
  "type": "connected",
  "runId": "run_123",
  "projectionVersion": 1
}
```

### `snapshot`

```json
{
  "type": "snapshot",
  "runId": "run_123",
  "projectionVersion": 12,
  "team": { "...TeamRunDetailProjectionV1" }
}
```

### `run.updated`

```json
{
  "type": "run.updated",
  "runId": "run_123",
  "projectionVersion": 13,
  "runStatus": "running"
}
```

### `stage.updated`

```json
{
  "type": "stage.updated",
  "runId": "run_123",
  "projectionVersion": 14,
  "stage": {
    "stageId": "stg_123",
    "status": "done",
    "latestResultSummary": "..."
  }
}
```

### `summary.published`

```json
{
  "type": "summary.published",
  "runId": "run_123",
  "projectionVersion": 15,
  "publishedAt": "2026-03-14T10:00:00Z"
}
```

### `completed`

```json
{
  "type": "completed",
  "runId": "run_123",
  "projectionVersion": 16,
  "runStatus": "done"
}
```

## 7.3 SSE 规则

1. 每次事件都必须带 `projectionVersion`
2. 客户端收到更高版本时才应用
3. 如果客户端断线重连，服务端至少发一条最新 `snapshot`
4. SSE 不发送原始数据库行，只发送 projection 或轻量 delta

---

## 8. Projection Service 内部接口

建议新增内部服务层：

```ts
getMainAgentCatalogProjection(): MainAgentCatalogProjectionResponseV1
getTaskDetailProjection(taskId: string): TaskDetailProjectionV1
getTeamRunDetailProjection(runId: string): TeamRunDetailProjectionV1
getSessionTeamBannerProjection(sessionId: string): TeamBannerProjectionV1 | null
```

禁止在多个路由处理器中重复拼装 projection。

---

## 9. 当前 UI 的落地映射

### `TeamModeBanner`

后续读取：

- `GET /api/sessions/:sessionId/team-banner`

### `TeamWorkspacePanel`

后续读取：

- `GET /api/team-runs/:runId/view`
- `GET /api/team-runs/:runId/stream`

### `TaskHubView` / `TeamHubView`

后续统一读取：

- `GET /api/tasks/catalog`

### `TaskDetailView`

后续读取：

- `GET /api/tasks/:taskId/view`

### `TeamRunDetailView`

后续读取：

- `GET /api/team-runs/:runId/view`
- `GET /api/team-runs/:runId/stream`

---

## 10. 错误响应合同

所有 read API 统一返回：

```ts
interface ProjectionApiErrorV1 {
  error: {
    code: string
    message: string
  }
}
```

推荐错误码：

- `TASK_NOT_FOUND`
- `RUN_NOT_FOUND`
- `PROJECTION_BUILD_FAILED`
- `STREAM_NOT_AVAILABLE`

---

## 11. 验收标准

满足以下条件，说明查询与投影合同可支撑开发：

1. UI 可以只依赖 projection，不依赖 raw record
2. `/tasks`、`/team`、banner、detail 读取的都是同一 run 投影
3. SSE 事件能驱动 detail 页面刷新
4. `taskId` 和 `runId` 在 UI 合同中不再混淆
