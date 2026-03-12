# Team Run 执行引擎架构设计

**文档版本**: 1.0
**创建日期**: 2026-03-11
**负责人**: 技术负责人
**状态**: 草稿

---

## 1. 架构概述

### 1.1 设计目标

基于需求分析，Team Run 执行引擎需要实现：
- **依赖驱动的任务调度** - 自动解析依赖关系，按批次并行执行
- **Agent 生命周期管理** - 创建、执行、监控、销毁 Agent 实例
- **状态持久化与同步** - 实时更新数据库，供 UI 查询
- **容错与恢复** - 处理失败、超时、重试等异常情况

### 1.2 架构原则

**P1: 分层隔离**
- 调度层、执行层、存储层职责清晰
- 每层可独立测试和替换

**P2: 事件驱动**
- 状态变化通过事件传播
- 解耦组件间依赖

**P3: 渐进式实现**
- 第一版：批次并行 + 基础错误处理
- 第二版：完全并行 + 高级调度
- 第三版：分布式执行 + 资源优化

---

## 2. 整体架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         API Layer                            │
│  POST /api/tasks/team-runs/:id/start                        │
│  GET  /api/tasks/team-runs/:id/status                       │
│  POST /api/tasks/team-runs/:id/cancel                       │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                   Orchestrator                               │
│  - 生命周期管理 (start/pause/cancel/resume)                 │
│  - 依赖解析 (DAG 构建)                                       │
│  - 批次调度 (批次内并行)                                     │
│  - 状态协调 (聚合 Agent 状态)                               │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
┌───────▼──────┐ ┌──▼──────┐ ┌──▼──────┐
│   Worker 1   │ │ Worker 2│ │ Worker 3│  (并行执行)
│ - Agent 实例 │ │         │ │         │
│ - 任务执行   │ │         │ │         │
│ - 结果上报   │ │         │ │         │
└───────┬──────┘ └──┬──────┘ └──┬──────┘
        │           │           │
        └───────────┼───────────┘
                    │
┌───────────────────▼─────────────────────────────────────────┐
│                   State Manager                              │
│  - 状态持久化 (写入数据库)                                   │
│  - 状态查询 (读取数据库)                                     │
│  - 并发控制 (乐观锁)                                         │
└───────────────────┬─────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────┐
│                   Database (SQLite)                          │
│  - team_runs                                                 │
│  - team_run_stages                                           │
│  - team_plans                                                │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

**启动流程**:
```
1. API 接收 start 请求
2. Orchestrator 加载 TeamPlan 和 TeamRun
3. 依赖解析器构建 DAG，生成批次
4. 调度器启动第一批 Worker
5. Worker 创建 Agent 实例并执行
6. Worker 完成后上报结果
7. State Manager 更新数据库
8. Orchestrator 检查依赖，启动下一批
9. 重复 4-8 直到所有任务完成
```

**状态同步流程**:
```
1. Worker 状态变化 (running/done/failed)
2. 发送事件到 State Manager
3. State Manager 写入数据库
4. UI 轮询 API 获取最新状态
```

---

## 3. 核心组件

### 3.1 Orchestrator (编排器)

**职责**: 管理 Team Run 的完整生命周期

**核心方法**:
```typescript
class TeamRunOrchestrator {
  async startRun(runId: string): Promise<void>
  async pauseRun(runId: string): Promise<void>
  async resumeRun(runId: string): Promise<void>
  async cancelRun(runId: string): Promise<void>
  async getStatus(runId: string): Promise<TeamRunStatus>
}
```

**内部流程**:
1. **依赖解析**: 调用 `DependencyResolver.buildBatches()` 生成执行批次
2. **批次调度**: 按批次顺序执行，批次内并行
3. **Worker 管理**: 维护 Worker 池，限制并发数
4. **状态协调**: 聚合所有 Stage 状态，更新 TeamRun 状态

**状态机**:
```
pending → ready → running → [paused] → done/failed/cancelled
```

### 3.2 DependencyResolver (依赖解析器)

**职责**: 解析任务依赖关系，构建执行计划

**核心方法**:
```typescript
class DependencyResolver {
  buildBatches(stages: TeamRunStage[]): string[][]
  detectCycles(stages: TeamRunStage[]): boolean
  getReadyStages(stages: TeamRunStage[]): string[]
}
```

**算法**: 拓扑排序 (Kahn's Algorithm)
```typescript
// 输入
stages = [
  { id: 'A', dependsOn: [] },
  { id: 'B', dependsOn: ['A'] },
  { id: 'C', dependsOn: ['A'] },
  { id: 'D', dependsOn: ['B', 'C'] }
]

// 输出
batches = [
  ['A'],      // 批次 0: 无依赖
  ['B', 'C'], // 批次 1: 依赖 A
  ['D']       // 批次 2: 依赖 B 和 C
]
```

### 3.3 Worker (执行器)

**职责**: 执行单个 Stage，管理 Agent 生命周期

**核心方法**:
```typescript
class StageWorker {
  async execute(stage: TeamRunStage): Promise<StageResult>
  async cancel(): Promise<void>
  getStatus(): WorkerStatus
}
```

**执行流程**:
```typescript
async execute(stage: TeamRunStage) {
  // 1. 加载 Role 配置
  const role = await loadRole(stage.ownerRoleId)

  // 2. 准备上下文
  const context = await prepareDependencyContext(stage.dependsOn)

  // 3. 创建 Agent 实例
  const agent = await createAgent(role, context)

  // 4. 执行任务
  const result = await agent.run(stage.task)

  // 5. 上报结果
  await reportResult(stage.id, result)

  return result
}
```

### 3.4 AgentFactory (Agent 工厂)

**职责**: 创建和配置 Agent 实例

**核心方法**:
```typescript
class AgentFactory {
  async createAgent(role: TeamPlanRole, context: AgentContext): Promise<Agent>
  async destroyAgent(agentId: string): Promise<void>
}
```

**Agent 配置**:
```typescript
interface AgentConfig {
  sessionId: string          // 唯一会话 ID
  systemPrompt: string       // 来自 Role 或 Preset
  workingDirectory: string   // 工作目录
  environment: Record<string, string> // 环境变量
  budget: AgentBudget        // 资源限制
}
```

**隔离策略**:
- 每个 Agent 使用独立的 Claude SDK session
- 共享工作目录（暂不隔离文件系统）
- 环境变量继承 + 注入 `AGENT_ROLE_ID`

### 3.5 StateManager (状态管理器)

**职责**: 管理状态持久化和并发控制

**核心方法**:
```typescript
class StateManager {
  async updateStageStatus(stageId: string, status: StageStatus): Promise<void>
  async updateStageResult(stageId: string, result: string): Promise<void>
  async getRunStatus(runId: string): Promise<TeamRun>
  async lockStage(stageId: string): Promise<boolean>
}
```

**并发控制**: 乐观锁
```typescript
// 使用版本号防止并发冲突
UPDATE team_run_stages
SET status = ?, result = ?, version = version + 1
WHERE id = ? AND version = ?
```

**事务策略**:
- 单个 Stage 更新：独立事务
- 批量更新：批量事务
- 跨表更新：嵌套事务

---

## 4. 技术选型

### 4.1 执行模型

**选择**: 批次并行 (Batch Parallel)

**理由**:
- ✅ 平衡效率和复杂度
- ✅ 依赖关系清晰，易于调试
- ✅ 支持 `maxParallelWorkers` 限制
- ❌ 批次边界可能不是最优（可接受）

**实现**:
```typescript
for (const batch of batches) {
  // 批次内并行执行
  await Promise.all(
    batch.slice(0, maxParallelWorkers).map(stageId =>
      worker.execute(stages[stageId])
    )
  )
}
```

### 4.2 Agent 实例化

**选择**: 每次创建新 session

**理由**:
- ✅ 隔离性好，无状态污染
- ✅ 实现简单，易于管理
- ❌ 启动慢（可接受，1-2 秒）
- ❌ 无上下文（通过依赖传递解决）

**实现**:
```typescript
const agent = await sdk.createSession({
  sessionId: `team-run-${runId}-stage-${stageId}`,
  systemPrompt: role.systemPrompt,
  // 不使用 --continue，每次独立
})
```

### 4.3 状态持久化

**选择**: 实时写入 + WAL 模式

**理由**:
- ✅ 数据最新，崩溃不丢失
- ✅ WAL 模式提升并发性能
- ❌ 写入频繁（通过 WAL 优化）

**实现**:
```typescript
// 启用 WAL 模式
db.pragma('journal_mode = WAL')

// 每次状态变化立即写入
await stateManager.updateStageStatus(stageId, 'running')
```

### 4.4 错误恢复

**选择**: 继续执行 + 重试机制

**理由**:
- ✅ 最大化完成任务数
- ✅ 灵活，用户可选择重试
- ❌ 可能浪费资源（通过超时控制）

**实现**:
```typescript
try {
  await worker.execute(stage)
} catch (error) {
  if (stage.retryCount < maxRetries) {
    stage.retryCount++
    await worker.execute(stage) // 重试
  } else {
    stage.status = 'failed'
    // 继续执行其他任务
  }
}
```

### 4.5 通信机制

**选择**: 数据库字段 (latestResult)

**理由**:
- ✅ 简单，无额外依赖
- ✅ 与现有数据模型一致
- ❌ 大数据存储效率低（限制 10KB）

**实现**:
```typescript
// Stage A 输出
await stateManager.updateStageResult('stage-a', JSON.stringify({
  architecture: 'MVC',
  components: ['Controller', 'Model', 'View']
}))

// Stage B 读取
const deps = await stateManager.getDependencyResults(['stage-a'])
const input = JSON.parse(deps[0].result)
```

---

## 5. 文件组织

### 5.1 目录结构

```
src/lib/team-run/
├── orchestrator.ts          # 编排器 (主入口)
├── dependency-resolver.ts   # 依赖解析器
├── worker.ts                # Stage 执行器
├── agent-factory.ts         # Agent 工厂
├── state-manager.ts         # 状态管理器
└── types.ts                 # 类型定义

src/app/api/tasks/team-runs/
├── [id]/
│   ├── start/route.ts       # POST 启动
│   ├── cancel/route.ts      # POST 取消
│   └── status/route.ts      # GET 状态查询
```

### 5.2 文件大小控制

**原则**: 单文件不超过 300 行

**预估**:
- `orchestrator.ts`: ~250 行 (生命周期管理 + 调度逻辑)
- `dependency-resolver.ts`: ~150 行 (拓扑排序)
- `worker.ts`: ~200 行 (Agent 执行 + 错误处理)
- `agent-factory.ts`: ~150 行 (Agent 创建 + 配置)
- `state-manager.ts`: ~250 行 (数据库操作 + 并发控制)
- `types.ts`: ~100 行 (类型定义)

**总计**: ~1100 行 (6 个文件)

---

## 6. 核心接口设计

### 6.1 Orchestrator 接口

```typescript
interface ITeamRunOrchestrator {
  // 启动 Team Run
  startRun(runId: string): Promise<void>

  // 暂停执行
  pauseRun(runId: string): Promise<void>

  // 恢复执行
  resumeRun(runId: string): Promise<void>

  // 取消执行
  cancelRun(runId: string): Promise<void>

  // 查询状态
  getStatus(runId: string): Promise<TeamRunStatus>
}

interface TeamRunStatus {
  runId: string
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  progress: {
    total: number
    completed: number
    failed: number
    running: number
  }
  stages: StageStatus[]
}
```

### 6.2 DependencyResolver 接口

```typescript
interface IDependencyResolver {
  // 构建执行批次
  buildBatches(stages: TeamRunStage[]): string[][]

  // 检测循环依赖
  detectCycles(stages: TeamRunStage[]): boolean

  // 获取就绪任务
  getReadyStages(stages: TeamRunStage[], completed: Set<string>): string[]
}
```

### 6.3 Worker 接口

```typescript
interface IStageWorker {
  // 执行 Stage
  execute(stage: TeamRunStage, context: ExecutionContext): Promise<StageResult>

  // 取消执行
  cancel(): Promise<void>

  // 获取状态
  getStatus(): WorkerStatus
}

interface ExecutionContext {
  runId: string
  dependencies: DependencyResult[]  // 依赖任务的输出
  budget: AgentBudget
}

interface StageResult {
  stageId: string
  status: 'done' | 'failed'
  output: string
  error?: string
  duration: number
}
```

### 6.4 StateManager 接口

```typescript
interface IStateManager {
  // 更新 Stage 状态
  updateStageStatus(stageId: string, status: StageStatus): Promise<void>

  // 更新 Stage 结果
  updateStageResult(stageId: string, result: string): Promise<void>

  // 获取依赖结果
  getDependencyResults(stageIds: string[]): Promise<DependencyResult[]>

  // 获取 Run 状态
  getRunStatus(runId: string): Promise<TeamRun>

  // 批量更新
  batchUpdate(updates: StageUpdate[]): Promise<void>
}
```

---

## 7. 关键流程设计

### 7.1 启动流程

```typescript
async function startRun(runId: string) {
  // 1. 加载数据
  const run = await db.getTeamRun(runId)
  const plan = await db.getTeamPlan(run.planId)
  const stages = await db.getTeamRunStages(runId)

  // 2. 验证状态
  if (run.status !== 'ready') {
    throw new Error('Run must be in ready state')
  }

  // 3. 依赖解析
  const batches = dependencyResolver.buildBatches(stages)
  if (dependencyResolver.detectCycles(stages)) {
    throw new Error('Circular dependency detected')
  }

  // 4. 更新状态
  await stateManager.updateRunStatus(runId, 'running')

  // 5. 执行批次
  for (const batch of batches) {
    await executeBatch(batch, stages, run.budget)
  }

  // 6. 标记完成
  await stateManager.updateRunStatus(runId, 'done')
}
```

### 7.2 批次执行流程

```typescript
async function executeBatch(
  batch: string[],
  stages: Map<string, TeamRunStage>,
  budget: TeamRunBudget
) {
  const workers: Promise<StageResult>[] = []

  // 限制并发数
  const limit = Math.min(batch.length, budget.maxParallelWorkers)

  for (let i = 0; i < limit; i++) {
    const stageId = batch[i]
    const stage = stages.get(stageId)

    // 准备上下文
    const context = await prepareContext(stage, stages)

    // 创建 Worker 并执行
    const worker = new StageWorker()
    workers.push(worker.execute(stage, context))
  }

  // 等待所有任务完成
  const results = await Promise.allSettled(workers)

  // 处理结果
  for (const result of results) {
    if (result.status === 'fulfilled') {
      await handleSuccess(result.value)
    } else {
      await handleFailure(result.reason)
    }
  }
}
```

### 7.3 Agent 执行流程

```typescript
async function executeStage(
  stage: TeamRunStage,
  context: ExecutionContext
): Promise<StageResult> {
  const startTime = Date.now()

  try {
    // 1. 更新状态为 running
    await stateManager.updateStageStatus(stage.id, 'running')

    // 2. 加载 Role 配置
    const role = await db.getTeamPlanRole(stage.ownerRoleId)

    // 3. 创建 Agent
    const agent = await agentFactory.createAgent(role, context)

    // 4. 执行任务
    const output = await agent.run(stage.task, {
      timeout: context.budget.maxRunMinutes * 60 * 1000
    })

    // 5. 更新结果
    await stateManager.updateStageResult(stage.id, output)
    await stateManager.updateStageStatus(stage.id, 'done')

    return {
      stageId: stage.id,
      status: 'done',
      output,
      duration: Date.now() - startTime
    }
  } catch (error) {
    // 6. 处理错误
    await stateManager.updateStageStatus(stage.id, 'failed')
    await stateManager.updateStageResult(stage.id, error.message)

    return {
      stageId: stage.id,
      status: 'failed',
      output: '',
      error: error.message,
      duration: Date.now() - startTime
    }
  } finally {
    // 7. 清理资源
    await agentFactory.destroyAgent(agent.id)
  }
}
```

### 7.4 依赖解析流程

```typescript
function buildBatches(stages: TeamRunStage[]): string[][] {
  const batches: string[][] = []
  const completed = new Set<string>()
  const remaining = new Set(stages.map(s => s.id))

  while (remaining.size > 0) {
    // 找出所有依赖已满足的任务
    const ready = Array.from(remaining).filter(stageId => {
      const stage = stages.find(s => s.id === stageId)
      return stage.dependsOn.every(dep => completed.has(dep))
    })

    if (ready.length === 0) {
      throw new Error('Circular dependency or missing dependency')
    }

    // 加入当前批次
    batches.push(ready)

    // 标记为已完成
    ready.forEach(id => {
      completed.add(id)
      remaining.delete(id)
    })
  }

  return batches
}
```

---

## 8. 错误处理策略

### 8.1 错误分类

**E1: 任务执行失败**
- Agent 执行出错
- 代码错误、API 调用失败等
- **处理**: 重试 (maxRetriesPerTask)，失败后标记 failed

**E2: 超时**
- 超过 maxRunMinutes
- **处理**: 取消执行，标记 failed，记录超时原因

**E3: 依赖失败**
- 依赖的任务失败
- **处理**: 标记为 blocked，不执行

**E4: 系统错误**
- 数据库连接失败、内存不足等
- **处理**: 记录错误，标记 TeamRun 为 failed，通知用户

### 8.2 重试机制

```typescript
async function executeWithRetry(
  stage: TeamRunStage,
  context: ExecutionContext
): Promise<StageResult> {
  let lastError: Error

  for (let i = 0; i <= context.budget.maxRetriesPerTask; i++) {
    try {
      return await executeStage(stage, context)
    } catch (error) {
      lastError = error
      if (i < context.budget.maxRetriesPerTask) {
        await sleep(1000 * Math.pow(2, i)) // 指数退避
      }
    }
  }

  throw lastError
}
```

### 8.3 超时控制

```typescript
async function executeWithTimeout(
  stage: TeamRunStage,
  timeoutMs: number
): Promise<StageResult> {
  return Promise.race([
    executeStage(stage),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    )
  ])
}
```

---

## 9. 数据模型扩展

### 9.1 现有表结构

当前 `team_run_stages` 表已包含必要字段：
```sql
CREATE TABLE team_run_stages (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  ownerRoleId TEXT,
  task TEXT,
  dependsOn TEXT,  -- JSON array
  status TEXT,     -- pending/ready/running/waiting/blocked/done/failed
  latestResult TEXT,
  createdAt INTEGER,
  updatedAt INTEGER
)
```

### 9.2 需要新增的字段

```sql
ALTER TABLE team_run_stages ADD COLUMN retryCount INTEGER DEFAULT 0;
ALTER TABLE team_run_stages ADD COLUMN errorMessage TEXT;
ALTER TABLE team_run_stages ADD COLUMN startedAt INTEGER;
ALTER TABLE team_run_stages ADD COLUMN completedAt INTEGER;
ALTER TABLE team_run_stages ADD COLUMN version INTEGER DEFAULT 0;  -- 乐观锁
```

### 9.3 索引优化

```sql
CREATE INDEX idx_stages_run_status ON team_run_stages(runId, status);
CREATE INDEX idx_stages_depends ON team_run_stages(dependsOn);
```

---

## 10. 性能优化

### 10.1 数据库优化

**WAL 模式**:
```typescript
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
```

**批量更新**:
```typescript
async function batchUpdateStages(updates: StageUpdate[]) {
  const stmt = db.prepare(`
    UPDATE team_run_stages
    SET status = ?, updatedAt = ?
    WHERE id = ?
  `)

  db.transaction(() => {
    updates.forEach(u => stmt.run(u.status, Date.now(), u.id))
  })()
}
```

### 10.2 并发控制

**Worker 池**:
```typescript
class WorkerPool {
  private workers: StageWorker[] = []
  private maxWorkers: number

  async execute(stage: TeamRunStage): Promise<StageResult> {
    // 等待空闲 Worker
    while (this.workers.length >= this.maxWorkers) {
      await this.waitForFreeWorker()
    }

    const worker = new StageWorker()
    this.workers.push(worker)

    try {
      return await worker.execute(stage)
    } finally {
      this.removeWorker(worker)
    }
  }
}
```

### 10.3 内存优化

**限制输出大小**:
```typescript
const MAX_RESULT_SIZE = 10 * 1024 // 10KB

function truncateResult(result: string): string {
  if (result.length > MAX_RESULT_SIZE) {
    return result.slice(0, MAX_RESULT_SIZE) + '\n... (truncated)'
  }
  return result
}
```

---

## 11. 可观测性

### 11.1 日志记录

**关键操作日志**:
```typescript
logger.info('TeamRun started', { runId, planId, stageCount })
logger.info('Stage started', { stageId, roleId, task })
logger.info('Stage completed', { stageId, duration, outputSize })
logger.error('Stage failed', { stageId, error, retryCount })
```

**日志级别**:
- ERROR: 系统错误、任务失败
- WARN: 重试、超时警告
- INFO: 生命周期事件
- DEBUG: 详细执行信息

### 11.2 性能指标

```typescript
interface Metrics {
  runDuration: number          // 总执行时间
  stageDurations: Map<string, number>  // 每个 Stage 耗时
  parallelEfficiency: number   // 并行效率 (实际时间 / 理论时间)
  retryCount: number           // 总重试次数
}
```

### 11.3 调试模式

```typescript
if (process.env.DEBUG_TEAM_RUN) {
  // 输出详细日志
  // 保存中间状态
  // 记录 Agent 输入输出
}
```

---

## 12. 实施计划

### 12.1 Phase 1: 核心执行引擎 (3-5 天)

**目标**: 实现基础的顺序执行

**任务**:
1. 实现 `DependencyResolver` - 依赖解析和拓扑排序
2. 实现 `StateManager` - 数据库操作和状态管理
3. 实现 `AgentFactory` - Agent 创建和配置
4. 实现 `StageWorker` - 单个 Stage 执行
5. 实现 `Orchestrator` - 顺序执行逻辑

**验收**:
- [ ] 可以启动 Team Run
- [ ] 可以按依赖顺序执行任务
- [ ] 可以更新状态到数据库
- [ ] 可以记录任务输出

### 12.2 Phase 2: 并行执行 (2-3 天)

**目标**: 支持批次并行

**任务**:
1. 实现批次调度逻辑
2. 实现 Worker 池管理
3. 实现并发控制 (maxParallelWorkers)
4. 优化数据库并发性能 (WAL 模式)

**验收**:
- [ ] 无依赖的任务可以并行执行
- [ ] 并行数不超过限制
- [ ] 依赖任务等待前置任务完成

### 12.3 Phase 3: 错误处理 (2-3 天)

**目标**: 完善错误处理和恢复

**任务**:
1. 实现重试机制
2. 实现超时控制
3. 实现依赖失败处理
4. 实现恢复机制 (resumeRun)

**验收**:
- [ ] 任务失败可以重试
- [ ] 超时可以正确处理
- [ ] 依赖失败导致后续任务 blocked
- [ ] 可以从失败点恢复

### 12.4 Phase 4: API 集成 (1-2 天)

**目标**: 集成到现有 API

**任务**:
1. 实现 `/api/tasks/team-runs/:id/start`
2. 实现 `/api/tasks/team-runs/:id/status`
3. 实现 `/api/tasks/team-runs/:id/cancel`
4. 更新 UI 调用逻辑

**验收**:
- [ ] UI 可以启动 Team Run
- [ ] UI 可以查看实时状态
- [ ] UI 可以取消执行

### 12.5 Phase 5: 测试与优化 (2-3 天)

**目标**: 测试和性能优化

**任务**:
1. 编写单元测试
2. 编写集成测试
3. 性能测试和优化
4. 文档完善

**验收**:
- [ ] 测试覆盖率 > 80%
- [ ] 启动 Team Run < 1 秒
- [ ] 状态查询 < 100ms

---

## 13. 风险与挑战

### 13.1 技术风险

**R1: SQLite 并发限制**
- **风险**: SQLite 不支持真正的并发写入
- **缓解**: 使用 WAL 模式，批量更新，避免长事务

**R2: Claude SDK 限制**
- **风险**: SDK 不支持真正的多 Agent 协作
- **缓解**: 每个 Agent 独立 session，通过数据库传递上下文

**R3: 内存占用**
- **风险**: 多个 Agent 并行可能占用大量内存
- **缓解**: 限制并行数，限制输出大小，及时清理资源

### 13.2 实施风险

**R4: 复杂度估算不足**
- **风险**: 实际实现比预期复杂
- **缓解**: 分阶段实施，先实现最简单版本

**R5: 测试覆盖不足**
- **风险**: 边界情况未测试，生产环境出错
- **缓解**: 编写完善的单元测试和集成测试

---

## 14. 未来扩展

### 14.1 完全并行调度

当前批次并行可能不是最优，未来可以实现：
- 任务完成后立即启动下一个就绪任务
- 动态调整并行度
- 优先级调度

### 14.2 分布式执行

当前单机执行，未来可以支持：
- 多机并行执行
- 任务分发和负载均衡
- 分布式状态同步

### 14.3 高级通信

当前通过数据库传递，未来可以支持：
- Agent 间消息传递
- 实时流式输出
- 共享文件系统

---

## 15. 总结

### 15.1 架构亮点

✅ **分层清晰** - Orchestrator、Worker、StateManager 职责明确
✅ **渐进式** - 先实现批次并行，未来可扩展为完全并行
✅ **容错性** - 重试、超时、恢复机制完善
✅ **可观测** - 日志、指标、调试模式齐全

### 15.2 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 执行模型 | 批次并行 | 平衡效率和复杂度 |
| Agent 实例化 | 每次新建 | 隔离性好，无状态污染 |
| 状态持久化 | 实时写入 | 数据最新，崩溃不丢失 |
| 错误恢复 | 继续执行 | 最大化完成任务数 |
| 通信机制 | 数据库字段 | 简单，无额外依赖 |

### 15.3 下一步

1. ✅ 需求分析完成
2. ✅ 架构设计完成
3. ⏭️ 等待架构评审
4. ⏭️ 详细设计（接口定义、数据结构）
5. ⏭️ 开始实施

---

**文档状态**: 待评审
**评审人**: architecture-reviewer
**预计评审时间**: 2026-03-11

