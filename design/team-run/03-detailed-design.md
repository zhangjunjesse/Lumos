# Team Run 执行引擎详细设计

**文档版本**: 2.0
**创建日期**: 2026-03-11
**最后更新**: 2026-03-11（整合第二轮评审P0修复方案）
**负责人**: detail-designer
**状态**: 详细设计（已整合安全加固）

---

## 1. 执行摘要

本文档基于两轮架构评审反馈，提供 Team Run 执行引擎的详细设计方案。已整合第二轮评审中识别的 **7 个 P0 阻塞性问题**的修复方案（5个安全 + 1个性能 + 1个架构）。

**第一轮评审的 P0 问题**（已解决）:
1. Agent 通信数据大小限制（10KB 不够）→ Artifacts 表
2. Claude SDK 并行验证需求 → POC 方案
3. 文件系统隔离缺失 → Stage 级工作目录

**第二轮评审的 P0 问题**（已整合修复方案）:
1. 文件系统隔离不足 → 访问控制强制执行
2. SQL 注入风险 → 参数化查询 + ID 验证
3. 命令注入风险 → 命令白名单
4. Artifact 内容未验证 → 大小检查 + Content-Type 白名单
5. 错误信息泄露 → 错误脱敏
6. SQLite 写入频率过高 → 批量延迟写入
7. Claude SDK 并行能力未验证 → POC 补充测试

---

## 2. 安全加固方案（Phase 0）

第二轮评审识别出 5 个 P0 安全风险，必须在实施核心功能前解决。

### 2.1 文件系统访问控制

**问题**: Claude SDK 不提供强制隔离，Agent 可绕过限制访问任意文件。

**修复方案**: 文件系统监控 hook 强制执行访问控制。

```typescript
// src/lib/team-run/security/file-access-guard.ts
class FileAccessGuard {
  constructor(private allowedPaths: string[]) {}

  validatePath(path: string): void {
    const resolved = fs.realpathSync(path)
    const allowed = this.allowedPaths.some(p => resolved.startsWith(p))
    if (!allowed) {
      throw new SecurityError(`Access denied: ${path}`)
    }
  }
}
```

### 2.2 SQL 注入防护

**问题**: 动态查询未参数化，ID 验证不足。

**修复方案**: 强制参数化查询 + ID 格式验证。

```typescript
// src/lib/team-run/security/sql-validator.ts
function validateId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    throw new ValidationError('Invalid ID format')
  }
}

async function safeQuery(sql: string, params: unknown[]): Promise<unknown> {
  if (sql.includes('${') || sql.includes('`')) {
    throw new SecurityError('Template literals not allowed in SQL')
  }
  return db.all(sql, params)
}
```

### 2.3 命令执行限制

**问题**: Agent 可执行任意 shell 命令。

**修复方案**: 命令白名单 + 禁用 shell 工具。

```typescript
// src/lib/team-run/security/command-guard.ts
const ALLOWED_COMMANDS = ['git', 'npm', 'node', 'cat', 'ls', 'grep']

class CommandGuard {
  validateCommand(cmd: string): void {
    const binary = cmd.split(' ')[0]
    if (!ALLOWED_COMMANDS.includes(binary)) {
      throw new SecurityError(`Command not allowed: ${binary}`)
    }
  }
}
```

### 2.4 Artifact 内容验证

**问题**: 直接存储 Agent 输出，无内容验证。

**修复方案**: 大小检查 + Content-Type 白名单 + 内容扫描。

```typescript
// src/lib/team-run/security/artifact-validator.ts
async function validateArtifact(input: ArtifactInput): Promise<void> {
  if (input.content.length > 10 * 1024 * 1024) {
    throw new ValidationError('Artifact too large')
  }

  const allowed = ['text/plain', 'application/json', 'text/markdown']
  if (!allowed.includes(input.contentType)) {
    throw new ValidationError(`Content type not allowed: ${input.contentType}`)
  }

  if (input.contentType.startsWith('text/')) {
    const text = input.content.toString()
    if (/<script|javascript:|onerror=/i.test(text)) {
      throw new SecurityError('Potentially malicious content detected')
    }
  }
}
```

### 2.5 错误信息脱敏

**问题**: 错误消息可能包含内部路径和配置。

**修复方案**: 错误信息脱敏处理。

```typescript
// src/lib/team-run/security/error-sanitizer.ts
function sanitizeError(error: Error): SafeError {
  let message = error.message
    .replace(/\/Users\/[^/]+/g, '/Users/***')
    .replace(/\/home\/[^/]+/g, '/home/***')
    .replace(/[a-f0-9]{32,}/gi, '***')

  return new SafeError(
    'Task execution failed',
    message,
    'TASK_EXEC_ERROR'
  )
}
```

---

## 3. P0 问题解决方案（第一轮评审）

### 3.1 P0-1: Agent 通信数据大小限制

#### 3.1.1 问题分析

**当前设计**:
- 使用 `team_run_stages.latestResult` 字段（TEXT 类型）存储 Agent 输出
- 限制为 10KB，超出部分截断

**问题**:
- 架构设计、代码文件、复杂 JSON 等输出经常超过 10KB
- 截断导致下游 Agent 收到不完整数据
- 无法传递文件引用、大型配置等

**影响场景**:
```
Stage A: 设计数据库 schema
输出: 50KB JSON (包含所有表定义、索引、关系)

Stage B: 生成 migration 文件
依赖: Stage A 的完整输出
结果: 只收到前 10KB，后续表定义丢失
```

#### 3.1.2 解决方案：引入 Artifacts 表

**设计原则**:
- 小数据（< 10KB）继续使用 `latestResult` 字段，保持简单
- 大数据（≥ 10KB）存储到 `team_run_artifacts` 表
- `latestResult` 存储引用指针（artifact ID）

**数据库 Schema**:

```sql
CREATE TABLE team_run_artifacts (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  stageId TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('output', 'file', 'log', 'metadata')),
  content BLOB,
  contentType TEXT,  -- 'text/plain', 'application/json', 'image/png'
  size INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,

  FOREIGN KEY (runId) REFERENCES team_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (stageId) REFERENCES team_run_stages(id) ON DELETE CASCADE
);

CREATE INDEX idx_artifacts_stage ON team_run_artifacts(stageId, type);
CREATE INDEX idx_artifacts_run ON team_run_artifacts(runId);
```

**字段说明**:
- `type`: 区分不同类型的产物
  - `output`: Agent 主要输出结果
  - `file`: 生成的文件内容
  - `log`: 执行日志
  - `metadata`: 元数据（如性能指标）
- `content`: BLOB 类型，支持二进制数据
- `contentType`: MIME 类型，便于解析
- `size`: 内容大小（字节），用于配额控制

**存储策略**:

```typescript
interface StageOutput {
  type: 'inline' | 'artifact'
  data?: string  // type=inline 时使用
  artifactId?: string  // type=artifact 时使用
  size: number
}

async function saveStageOutput(stageId: string, output: string): Promise<void> {
  const size = Buffer.byteLength(output, 'utf8')

  if (size < 10 * 1024) {
    // 小数据：直接存储到 latestResult
    await db.run(
      'UPDATE team_run_stages SET latestResult = ? WHERE id = ?',
      [output, stageId]
    )
  } else {
    // 大数据：存储到 artifacts 表
    const artifactId = generateId()
    await db.run(
      'INSERT INTO team_run_artifacts (id, runId, stageId, type, content, contentType, size, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [artifactId, runId, stageId, 'output', output, 'text/plain', size, Date.now()]
    )

    // latestResult 存储引用
    const reference = JSON.stringify({ type: 'artifact', artifactId, size })
    await db.run(
      'UPDATE team_run_stages SET latestResult = ? WHERE id = ?',
      [reference, stageId]
    )
  }
}
```

**读取策略**:

```typescript
async function getStageOutput(stageId: string): Promise<string> {
  const stage = await db.get('SELECT latestResult FROM team_run_stages WHERE id = ?', stageId)

  if (!stage.latestResult) return ''

  // 尝试解析为引用
  try {
    const ref = JSON.parse(stage.latestResult)
    if (ref.type === 'artifact') {
      // 从 artifacts 表读取
      const artifact = await db.get(
        'SELECT content FROM team_run_artifacts WHERE id = ?',
        ref.artifactId
      )
      return artifact.content.toString('utf8')
    }
  } catch {
    // 不是 JSON，直接返回
  }

  return stage.latestResult
}
```

**配额控制**:

```typescript
interface ArtifactQuota {
  maxSizePerStage: number  // 默认 10MB
  maxTotalSize: number     // 默认 100MB per run
}

async function checkArtifactQuota(runId: string, newSize: number): Promise<boolean> {
  const { totalSize } = await db.get(
    'SELECT SUM(size) as totalSize FROM team_run_artifacts WHERE runId = ?',
    runId
  )

  return (totalSize + newSize) <= quota.maxTotalSize
}
```

#### 3.1.3 实施影响

**优势**:
- ✅ 支持任意大小的输出（受配额限制）
- ✅ 保持小数据的简单性（无需额外查询）
- ✅ 支持二进制数据（图片、压缩文件等）
- ✅ 便于清理（CASCADE DELETE）

**成本**:
- 增加一张表（约 100 行代码）
- 读取大数据需要额外查询（可接受）

---

### 3.2 P0-2: Claude SDK 并行验证

#### 3.2.1 问题分析

**架构假设**:
- 多个 Agent 可以并行执行
- 每个 Agent 使用独立的 Claude SDK session
- Session 之间互不干扰

**需要验证**:
1. SDK 是否支持同时创建多个 session？
2. 多个 session 并行调用 `run()` 是否会冲突？
3. 性能是否可接受（启动时间、内存占用）？

#### 3.2.2 POC 验证方案

**测试代码**:

```typescript
// poc/claude-sdk-parallel.ts
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk'

async function testParallelSessions() {
  console.log('=== Claude SDK 并行测试 ===\n')

  // 测试 1: 创建多个 session
  console.log('测试 1: 创建 3 个独立 session')
  const startTime = Date.now()

  const sessions = await Promise.all([
    ClaudeAgent.create({ sessionId: 'test-1', systemPrompt: 'You are Agent 1' }),
    ClaudeAgent.create({ sessionId: 'test-2', systemPrompt: 'You are Agent 2' }),
    ClaudeAgent.create({ sessionId: 'test-3', systemPrompt: 'You are Agent 3' })
  ])

  console.log(`✓ 创建耗时: ${Date.now() - startTime}ms\n`)

  // 测试 2: 并行执行
  console.log('测试 2: 并行执行任务')
  const execStart = Date.now()

  const results = await Promise.all([
    sessions[0].run('Count to 5'),
    sessions[1].run('List 3 colors'),
    sessions[2].run('Name 2 animals')
  ])

  console.log(`✓ 执行耗时: ${Date.now() - execStart}ms`)
  console.log('结果:', results.map((r, i) => `Agent ${i+1}: ${r.slice(0, 50)}...`))

  // 测试 3: 内存占用
  console.log('\n测试 3: 内存占用')
  const memBefore = process.memoryUsage().heapUsed / 1024 / 1024

  const moreSessions = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      ClaudeAgent.create({ sessionId: `test-${i+10}` })
    )
  )

  const memAfter = process.memoryUsage().heapUsed / 1024 / 1024
  console.log(`✓ 10 个 session 增加内存: ${(memAfter - memBefore).toFixed(2)} MB`)

  // 补充测试 4: 并发状态写入
  console.log('\n测试 4: 并发状态写入')
  const writes = Array.from({ length: 10 }, (_, i) =>
    db.run('UPDATE team_run_stages SET status=? WHERE id=?', ['running', `stage-${i}`])
  )
  await Promise.all(writes)
  console.log('✓ 并发写入测试通过')

  // 补充测试 5: Agent 取消
  console.log('\n测试 5: Agent 取消')
  const testAgent = await ClaudeAgent.create({ sessionId: 'test-cancel' })
  const task = testAgent.run('Count to 1000000')
  setTimeout(() => testAgent.terminate(), 1000)
  await task.catch(err => console.log('✓ 取消成功:', err.message))

  // 清理
  await Promise.all([...sessions, ...moreSessions].map(s => s.destroy()))

  console.log('\n=== 测试完成 ===')
}

testParallelSessions().catch(console.error)
```

**验收标准**:
- ✅ 可以同时创建 10+ 个 session
- ✅ 并行执行不会相互干扰
- ✅ 单个 session 启动时间 < 3 秒
- ✅ 10 个 session 内存增量 < 500MB
- ✅ 并发状态写入无冲突
- ✅ Agent 取消机制正常

#### 3.2.3 备选方案

**如果 SDK 不支持真并行**:

方案 A: 使用进程池
```typescript
// 每个 Agent 在独立进程中运行
class ProcessPoolWorker {
  async execute(stage: TeamRunStage): Promise<StageResult> {
    const worker = fork('./agent-worker.js')
    return new Promise((resolve, reject) => {
      worker.send({ stage, context })
      worker.on('message', resolve)
      worker.on('error', reject)
    })
  }
}
```

方案 B: 降级为批次串行
```typescript
// 批次内串行执行，批次间保持依赖关系
for (const batch of batches) {
  for (const stageId of batch) {
    await worker.execute(stages[stageId])
  }
}
```

**决策依据**:
- POC 通过 → 继续使用多 session 方案
- POC 失败 → 采用方案 A（进程池）或方案 B（串行）

---

### 3.3 P0-3: 文件系统隔离

#### 3.3.1 问题分析

**当前设计**:
- 所有 Agent 共享同一个工作目录
- 无文件访问控制

**风险**:
1. **文件冲突**: Agent A 和 Agent B 同时写入 `output.json`
2. **数据泄露**: Agent A 可以读取 Agent B 的中间文件
3. **误删除**: Agent A 可能删除 Agent B 正在使用的文件

**影响场景**:
```
Stage A: 生成 schema.sql
Stage B: 生成 migration.sql (同时运行)

冲突: 两者都尝试写入 temp/output.sql
结果: 文件内容混乱或覆盖
```

#### 3.3.2 解决方案：Stage 级工作目录隔离

**目录结构**:

```
~/.lumos/team-runs/
├── {runId}/
│   ├── shared/              # 共享目录（只读）
│   │   ├── project/         # 项目文件
│   │   └── context/         # 上下文文件
│   └── stages/
│       ├── {stageId-1}/     # Stage 1 工作目录
│       │   ├── input/       # 依赖输入
│       │   ├── output/      # 输出文件
│       │   └── temp/        # 临时文件
│       ├── {stageId-2}/     # Stage 2 工作目录
│       └── {stageId-3}/
```

**实现**:

```typescript
interface WorkspaceConfig {
  stageWorkDir: string      // Stage 独占目录（读写）
  sharedReadDir: string     // 共享只读目录
  outputDir: string         // 输出目录
}

function prepareStageWorkspace(runId: string, stageId: string): WorkspaceConfig {
  const baseDir = path.join(LUMOS_DATA_DIR, 'team-runs', runId)
  const stageDir = path.join(baseDir, 'stages', stageId)

  // 创建目录结构
  fs.mkdirSync(path.join(stageDir, 'input'), { recursive: true })
  fs.mkdirSync(path.join(stageDir, 'output'), { recursive: true })
  fs.mkdirSync(path.join(stageDir, 'temp'), { recursive: true })

  return {
    stageWorkDir: stageDir,
    sharedReadDir: path.join(baseDir, 'shared'),
    outputDir: path.join(stageDir, 'output')
  }
}
```

**Agent 配置**:

```typescript
async function createAgent(role: TeamPlanRole, workspace: WorkspaceConfig): Promise<Agent> {
  return ClaudeAgent.create({
    sessionId: generateSessionId(),
    systemPrompt: role.systemPrompt,
    workingDirectory: workspace.stageWorkDir,  // 设置工作目录
    environment: {
      STAGE_WORK_DIR: workspace.stageWorkDir,
      SHARED_READ_DIR: workspace.sharedReadDir,
      OUTPUT_DIR: workspace.outputDir
    }
  })
}
```

**依赖输入准备**:

```typescript
async function prepareDependencyInputs(
  stage: TeamRunStage,
  workspace: WorkspaceConfig
): Promise<void> {
  for (const depId of stage.dependsOn) {
    const depOutput = await getStageOutput(depId)

    // 将依赖输出写入 input/ 目录
    const inputFile = path.join(workspace.stageWorkDir, 'input', `${depId}.json`)
    await fs.promises.writeFile(inputFile, depOutput)
  }
}
```

**输出收集**:

```typescript
async function collectStageOutputs(workspace: WorkspaceConfig): Promise<string> {
  const outputDir = workspace.outputDir
  const files = await fs.promises.readdir(outputDir)

  const outputs: Record<string, string> = {}
  for (const file of files) {
    const content = await fs.promises.readFile(path.join(outputDir, file), 'utf8')
    outputs[file] = content
  }

  return JSON.stringify(outputs)
}
```

#### 3.3.3 访问控制策略

**权限模型**:

```typescript
interface FileAccessPolicy {
  allowRead: string[]   // 允许读取的目录
  allowWrite: string[]  // 允许写入的目录
  denyPaths: string[]   // 禁止访问的路径
}

function getStageAccessPolicy(workspace: WorkspaceConfig): FileAccessPolicy {
  return {
    allowRead: [
      workspace.stageWorkDir,
      workspace.sharedReadDir
    ],
    allowWrite: [
      workspace.stageWorkDir
    ],
    denyPaths: [
      path.join(LUMOS_DATA_DIR, 'lumos.db'),  // 禁止访问数据库
      path.join(process.env.HOME, '.env'),     // 禁止访问敏感文件
      path.join(process.env.HOME, '.ssh')      // 禁止访问 SSH 密钥
    ]
  }
}
```

**强制执行**（整合安全加固）:
- 使用 FileAccessGuard（见 2.1 节）在文件操作前验证路径
- 在 Agent system prompt 中说明访问规范
- 后续可通过 hooks 或 wrapper 强制执行

#### 3.3.4 清理策略

```typescript
async function cleanupStageWorkspace(runId: string, stageId: string): Promise<void> {
  const stageDir = path.join(LUMOS_DATA_DIR, 'team-runs', runId, 'stages', stageId)

  // 保留 output/ 目录，删除 temp/
  await fs.promises.rm(path.join(stageDir, 'temp'), { recursive: true, force: true })
}

async function cleanupTeamRun(runId: string, keepOutputs: boolean = true): Promise<void> {
  const runDir = path.join(LUMOS_DATA_DIR, 'team-runs', runId)

  if (keepOutputs) {
    // 只删除临时文件
    const stagesDir = path.join(runDir, 'stages')
    const stages = await fs.promises.readdir(stagesDir)
    for (const stageId of stages) {
      await cleanupStageWorkspace(runId, stageId)
    }
  } else {
    // 删除整个 run 目录
    await fs.promises.rm(runDir, { recursive: true, force: true })
  }
}
```

---

## 4. 核心接口定义

### 4.1 Orchestrator 接口

```typescript
interface ITeamRunOrchestrator {
  // 生命周期管理
  startRun(runId: string): Promise<void>
  pauseRun(runId: string): Promise<void>
  resumeRun(runId: string): Promise<void>
  cancelRun(runId: string): Promise<void>

  // 状态查询
  getStatus(runId: string): Promise<TeamRunStatus>
  getStageStatus(stageId: string): Promise<StageStatus>

  // 高级操作
  retryFailedStages(runId: string): Promise<void>
  skipStage(stageId: string, reason: string): Promise<void>
}

interface TeamRunStatus {
  runId: string
  planId: string
  status: RunStatus
  progress: RunProgress
  stages: StageStatus[]
  startedAt?: number
  completedAt?: number
  error?: string
}

type RunStatus = 'pending' | 'ready' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

interface RunProgress {
  total: number
  completed: number
  failed: number
  running: number
  blocked: number
}

interface StageStatus {
  id: string
  roleId: string
  task: string
  status: StageStatusType
  dependsOn: string[]
  output?: StageOutput
  error?: string
  retryCount: number
  startedAt?: number
  completedAt?: number
  duration?: number
}

type StageStatusType = 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'cancelled'
```

### 4.2 Worker 接口

```typescript
interface IStageWorker {
  execute(stage: TeamRunStage, context: ExecutionContext): Promise<StageResult>
  cancel(): Promise<void>
  getStatus(): WorkerStatus
}

interface ExecutionContext {
  runId: string
  workspace: WorkspaceConfig
  dependencies: DependencyData[]
  budget: AgentBudget
}

interface DependencyData {
  stageId: string
  output: string
  artifacts: ArtifactReference[]
}

interface StageResult {
  stageId: string
  status: 'done' | 'failed'
  output: string
  artifacts: string[]  // artifact IDs
  error?: string
  duration: number
  metrics: ExecutionMetrics
}

interface WorkerStatus {
  stageId: string
  state: 'idle' | 'preparing' | 'running' | 'finishing' | 'cancelled'
  progress?: number  // 0-100
}

interface ExecutionMetrics {
  agentStartTime: number
  agentEndTime: number
  tokensUsed?: number
  apiCalls?: number
}
```

### 4.3 StateManager 接口

```typescript
interface IStateManager {
  // Stage 状态管理
  updateStageStatus(stageId: string, status: StageStatusType): Promise<void>
  updateStageResult(stageId: string, result: string): Promise<void>
  updateStageError(stageId: string, error: string): Promise<void>
  incrementRetryCount(stageId: string): Promise<number>

  // Run 状态管理
  updateRunStatus(runId: string, status: RunStatus): Promise<void>
  getRunStatus(runId: string): Promise<TeamRun>

  // 依赖查询
  getDependencyResults(stageIds: string[]): Promise<DependencyData[]>
  getStageOutput(stageId: string): Promise<string>

  // Artifact 管理（整合安全验证）
  saveArtifact(artifact: ArtifactInput): Promise<string>
  getArtifact(artifactId: string): Promise<Artifact>
  listStageArtifacts(stageId: string): Promise<Artifact[]>

  // 批量操作（性能优化）
  batchUpdateStages(updates: StageUpdate[]): Promise<void>
  flush(): Promise<void>  // 立即刷新待写入数据
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
}

interface ArtifactInput {
  runId: string
  stageId: string
  type: 'output' | 'file' | 'log' | 'metadata'
  content: Buffer | string
  contentType: string
  // 安全字段
  validated?: boolean  // 是否已通过安全验证
}

interface Artifact {
  id: string
  runId: string
  stageId: string
  type: string
  content: Buffer
  contentType: string
  size: number
  createdAt: number
}

interface StageUpdate {
  stageId: string
  status?: StageStatusType
  result?: string
  error?: string
}
```

**批量延迟写入实现**（性能优化 P0）:

```typescript
class StateManager implements IStateManager {
  private pendingUpdates: StageUpdate[] = []
  private flushTimer: NodeJS.Timeout

  updateStageStatus(stageId: string, status: StageStatusType) {
    this.pendingUpdates.push({ stageId, status, updatedAt: Date.now() })

    if (this.pendingUpdates.length >= 10) {
      this.flush()
    } else {
      clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => this.flush(), 500)
    }
  }

  async flush() {
    if (this.pendingUpdates.length === 0) return

    await db.transaction(() => {
      this.pendingUpdates.forEach(u => {
        db.run('UPDATE team_run_stages SET status=?, updatedAt=? WHERE id=?',
               [u.status, u.updatedAt, u.stageId])
      })
    })()
    this.pendingUpdates = []
  }
}
```

### 4.4 DependencyResolver 接口

```typescript
interface IDependencyResolver {
  buildBatches(stages: TeamRunStage[]): ExecutionBatch[]
  detectCycles(stages: TeamRunStage[]): boolean
  getReadyStages(stages: TeamRunStage[], completed: Set<string>): string[]
  validateDependencies(stages: TeamRunStage[]): ValidationResult
}

interface ExecutionBatch {
  batchIndex: number
  stageIds: string[]
  estimatedDuration?: number
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}
```

### 4.5 AgentFactory 接口

```typescript
interface IAgentFactory {
  createAgent(config: AgentConfig): Promise<Agent>
  destroyAgent(agentId: string): Promise<void>
  getAgent(agentId: string): Agent | null
}

interface AgentConfig {
  sessionId: string
  role: TeamPlanRole
  workspace: WorkspaceConfig
  budget: AgentBudget
  environment: Record<string, string>
  // 安全配置（整合安全加固）
  security?: SecurityConfig
}

interface SecurityConfig {
  disabledTools?: string[]  // 禁用的工具（如 'bash', 'shell'）
  allowedCommands?: string[]  // 允许的命令白名单
  fileAccessPolicy?: FileAccessPolicy  // 文件访问策略
}

interface AgentBudget {
  maxRunMinutes: number
  maxRetriesPerTask: number
  maxParallelWorkers: number
  maxDiskMB: number
  maxArtifactSizeMB: number
}

interface Agent {
  id: string
  sessionId: string
  run(task: string, options?: RunOptions): Promise<string>
  terminate(): Promise<void>
  getStatus(): AgentStatus
}

interface RunOptions {
  timeout?: number
  onProgress?: (progress: number) => void
}

interface AgentStatus {
  state: 'idle' | 'running' | 'terminated'
  currentTask?: string
}
```

**安全集成示例**:

```typescript
async function createSecureAgent(config: AgentConfig): Promise<Agent> {
  return ClaudeAgent.create({
    sessionId: config.sessionId,
    systemPrompt: config.role.systemPrompt,
    workingDirectory: config.workspace.stageWorkDir,
    disabledTools: ['bash', 'shell'],  // 禁用 shell 工具
    commandValidator: (cmd) => {
      const guard = new CommandGuard()
      guard.validateCommand(cmd)
    },
    environment: config.environment
  })
}
```

---

## 5. 数据库变更

## 5. 数据库变更

### 5.1 team_run_stages 表扩展

```sql
-- 基于现有表，新增字段
ALTER TABLE team_run_stages ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE team_run_stages ADD COLUMN last_error TEXT;
ALTER TABLE team_run_stages ADD COLUMN workspace_dir TEXT;
ALTER TABLE team_run_stages ADD COLUMN started_at INTEGER;
ALTER TABLE team_run_stages ADD COLUMN completed_at INTEGER;
ALTER TABLE team_run_stages ADD COLUMN version INTEGER DEFAULT 1;  -- 乐观锁

-- 索引优化
CREATE INDEX idx_stages_run_status ON team_run_stages(runId, status);
CREATE INDEX idx_stages_started ON team_run_stages(startedAt) WHERE startedAt IS NOT NULL;
```

### 5.2 team_run_artifacts 表（新增）

```sql
CREATE TABLE team_run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('output', 'file', 'log', 'metadata')),
  content BLOB NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- 安全字段
  validated INTEGER DEFAULT 0,  -- 是否已通过安全验证

  FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES team_run_stages(id) ON DELETE CASCADE
);

CREATE INDEX idx_artifacts_stage ON team_run_artifacts(stage_id, type);
CREATE INDEX idx_artifacts_run ON team_run_artifacts(run_id);
CREATE INDEX idx_artifacts_size ON team_run_artifacts(size) WHERE size > 1048576;  -- 大于1MB的
```

### 5.3 数据库迁移脚本

```sql
-- migrations/001_add_team_run_artifacts.sql
CREATE TABLE IF NOT EXISTS team_run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('output', 'file', 'log', 'metadata')),
  content BLOB NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  validated INTEGER DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_artifacts_run_id ON team_run_artifacts(run_id);
CREATE INDEX idx_artifacts_stage_id ON team_run_artifacts(stage_id);

-- 添加新字段到 team_run_stages
ALTER TABLE team_run_stages ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE team_run_stages ADD COLUMN last_error TEXT;
ALTER TABLE team_run_stages ADD COLUMN workspace_dir TEXT;
ALTER TABLE team_run_stages ADD COLUMN started_at INTEGER;
ALTER TABLE team_run_stages ADD COLUMN completed_at INTEGER;
ALTER TABLE team_run_stages ADD COLUMN version INTEGER DEFAULT 1;
```

---

## 6. 执行流程设计

### 6.1 启动流程状态机

```
pending → ready → running → done
                    ↓
                  paused → running
                    ↓
                  failed
                    ↓
                  cancelled
```

**状态转换规则**:

```typescript
const validTransitions: Record<RunStatus, RunStatus[]> = {
  pending: ['ready', 'cancelled'],
  ready: ['running', 'cancelled'],
  running: ['paused', 'done', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  done: [],
  failed: ['running'],  // 允许重试
  cancelled: []
}

function validateTransition(from: RunStatus, to: RunStatus): boolean {
  return validTransitions[from]?.includes(to) ?? false
}
```

### 6.2 Stage 执行流程（整合安全检查点）

```typescript
async function executeStage(
  stage: TeamRunStage,
  context: ExecutionContext
): Promise<StageResult> {
  const startTime = Date.now()

  try {
    // 🔒 安全检查点 1: 验证 Stage ID
    validateId(stage.id)

    // 1. 准备工作空间
    const workspace = prepareStageWorkspace(context.runId, stage.id)
    await prepareDependencyInputs(stage, workspace, context.dependencies)

    // 🔒 安全检查点 2: 设置文件访问控制
    const fileGuard = new FileAccessGuard([
      workspace.stageWorkDir,
      workspace.sharedReadDir
    ])

    // 2. 更新状态
    await stateManager.updateStageStatus(stage.id, 'running')

    // 3. 创建 Agent（带安全配置）
    const role = await db.getTeamPlanRole(stage.ownerRoleId)
    const agent = await agentFactory.createAgent({
      sessionId: `${context.runId}-${stage.id}`,
      role,
      workspace,
      budget: context.budget,
      environment: { STAGE_ID: stage.id, RUN_ID: context.runId },
      security: {
        disabledTools: ['bash', 'shell'],
        allowedCommands: ALLOWED_COMMANDS,
        fileAccessPolicy: getStageAccessPolicy(workspace)
      }
    })

    // 4. 执行任务
    const output = await agent.run(stage.task, {
      timeout: context.budget.maxRunMinutes * 60 * 1000
    })

    // 5. 收集输出
    const artifacts = await collectStageArtifacts(workspace)

    // 🔒 安全检查点 3: 验证 Artifacts
    for (const artifact of artifacts) {
      await validateArtifact(artifact)
    }

    // 6. 保存结果
    await saveStageOutput(stage.id, output)
    for (const artifact of artifacts) {
      await stateManager.saveArtifact({ ...artifact, validated: true })
    }

    // 7. 更新状态
    await stateManager.updateStageStatus(stage.id, 'done')

    return {
      stageId: stage.id,
      status: 'done',
      output,
      artifacts: artifacts.map(a => a.id),
      duration: Date.now() - startTime,
      metrics: { agentStartTime: startTime, agentEndTime: Date.now() }
    }

  } catch (error) {
    // 🔒 安全检查点 4: 错误信息脱敏
    const safeError = sanitizeError(error)

    await stateManager.updateStageStatus(stage.id, 'failed')
    await stateManager.updateStageError(stage.id, safeError.message)

    return {
      stageId: stage.id,
      status: 'failed',
      output: '',
      artifacts: [],
      error: safeError.userMessage,
      duration: Date.now() - startTime,
      metrics: { agentStartTime: startTime, agentEndTime: Date.now() }
    }
  } finally {
    await cleanupStageWorkspace(context.runId, stage.id)
  }
}
```

### 6.3 批次并行执行流程

```typescript
async function executeBatch(
  batch: ExecutionBatch,
  stages: Map<string, TeamRunStage>,
  context: ExecutionContext
): Promise<BatchResult> {
  const workers: Promise<StageResult>[] = []
  const limit = Math.min(batch.stageIds.length, context.budget.maxParallelWorkers)

  // 启动并行 Worker
  for (let i = 0; i < limit; i++) {
    const stageId = batch.stageIds[i]
    const stage = stages.get(stageId)!

    const worker = new StageWorker()
    workers.push(worker.execute(stage, context))
  }

  // 等待完成
  const results = await Promise.allSettled(workers)

  // 统计结果
  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.status === 'done').length
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'failed')).length

  return {
    batchIndex: batch.batchIndex,
    total: batch.stageIds.length,
    succeeded,
    failed,
    results: results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as StageResult[]
  }
}

interface BatchResult {
  batchIndex: number
  total: number
  succeeded: number
  failed: number
  results: StageResult[]
}
```

---

## 7. 错误处理策略

### 7.1 错误分类与处理

```typescript
enum ErrorType {
  TASK_EXECUTION_FAILED = 'task_execution_failed',
  TIMEOUT = 'timeout',
  DEPENDENCY_FAILED = 'dependency_failed',
  RESOURCE_EXHAUSTED = 'resource_exhausted',
  SYSTEM_ERROR = 'system_error'
}

interface ErrorHandler {
  canRetry(error: ErrorType): boolean
  getRetryDelay(retryCount: number): number
  shouldBlockDependents(error: ErrorType): boolean
}

const defaultErrorHandler: ErrorHandler = {
  canRetry(error: ErrorType): boolean {
    return error === ErrorType.TASK_EXECUTION_FAILED || error === ErrorType.TIMEOUT
  },

  getRetryDelay(retryCount: number): number {
    return Math.min(1000 * Math.pow(2, retryCount), 30000)  // 最多 30 秒
  },

  shouldBlockDependents(error: ErrorType): boolean {
    return error !== ErrorType.TIMEOUT  // 超时不阻塞，其他错误阻塞
  }
}
```

### 7.2 重试机制

```typescript
async function executeWithRetry(
  stage: TeamRunStage,
  context: ExecutionContext,
  errorHandler: ErrorHandler
): Promise<StageResult> {
  let lastError: Error
  const maxRetries = context.budget.maxRetriesPerTask

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = errorHandler.getRetryDelay(attempt - 1)
        await sleep(delay)
        await stateManager.incrementRetryCount(stage.id)
      }

      return await executeStage(stage, context)

    } catch (error) {
      lastError = error

      if (attempt < maxRetries && errorHandler.canRetry(classifyError(error))) {
        console.log(`Stage ${stage.id} failed, retrying (${attempt + 1}/${maxRetries})`)
        continue
      }

      break
    }
  }

  throw lastError
}

function classifyError(error: Error): ErrorType {
  if (error.message.includes('timeout')) return ErrorType.TIMEOUT
  if (error.message.includes('dependency')) return ErrorType.DEPENDENCY_FAILED
  if (error.message.includes('quota')) return ErrorType.RESOURCE_EXHAUSTED
  return ErrorType.TASK_EXECUTION_FAILED
}
```

### 7.3 依赖失败处理

```typescript
async function handleDependencyFailure(
  stage: TeamRunStage,
  failedDeps: string[]
): Promise<void> {
  await stateManager.updateStageStatus(stage.id, 'blocked')
  await stateManager.updateStageError(
    stage.id,
    `Blocked by failed dependencies: ${failedDeps.join(', ')}`
  )
}

function getBlockedStages(
  stages: TeamRunStage[],
  failedStageIds: Set<string>
): string[] {
  return stages
    .filter(s => s.dependsOn.some(dep => failedStageIds.has(dep)))
    .map(s => s.id)
}
```

---

## 8. 实施检查清单

### 8.1 安全加固验证（Phase 0 - P0）

- [ ] FileAccessGuard 实现并测试
- [ ] SQL 注入防护（参数化查询 + ID 验证）
- [ ] 命令白名单实现
- [ ] Artifact 内容验证（大小 + Content-Type + 内容扫描）
- [ ] 错误信息脱敏

### 8.2 P0 问题解决验证

- [ ] Artifacts 表已创建并测试
- [ ] 大数据存储/读取功能正常
- [ ] Claude SDK 并行 POC 已完成（含补充测试）
- [ ] 文件系统隔离已实现
- [ ] Stage 工作目录创建/清理正常

### 8.3 性能优化验证（P0）

- [ ] 批量延迟写入实现（500ms 或 10 条）
- [ ] 状态更新延迟 < 20ms
- [ ] SQLite 并发写入无 SQLITE_BUSY 错误

### 8.4 核心功能验证

- [ ] 依赖解析正确（拓扑排序）
- [ ] 批次并行执行正常
- [ ] 状态持久化实时更新
- [ ] 错误重试机制生效
- [ ] Agent 生命周期管理正常

### 8.5 性能指标验证

- [ ] 启动 Team Run < 1 秒
- [ ] 状态查询 < 100ms
- [ ] 10 个并行 Agent 内存 < 500MB
- [ ] 数据库写入延迟 < 50ms

---

## 9. 更新后的实施计划

基于第二轮评审，实施计划调整为 **18-24 天**（原 11-15 天）。

### Phase 0: 安全加固（新增，3-4 天）

| 任务 | 工作量 | 交付物 |
|------|--------|--------|
| 文件访问控制 | 1 天 | FileAccessGuard 实现 |
| SQL 注入防护 | 0.5 天 | validateId + safeQuery |
| 命令执行限制 | 1 天 | CommandGuard + 白名单 |
| Artifact 验证 | 0.5 天 | validateArtifact |
| 错误信息脱敏 | 0.5 天 | sanitizeError |

### Phase 1: 核心执行引擎（5-6 天，原 3-4 天）

| 任务 | 工作量 | 交付物 |
|------|--------|--------|
| Claude SDK 并行 POC | 1 天 | POC 验证报告（含补充测试） |
| Orchestrator + Worker | 2-3 天 | 核心执行逻辑 |
| AgentFactory | 2 天 | Agent 生命周期管理 |
| 安全集成 | 1 天 | 整合安全模块 |

### Phase 2: 状态管理（3-4 天，原 2-3 天）

| 任务 | 工作量 | 交付物 |
|------|--------|--------|
| StateManager 基础 | 1 天 | 基本状态管理 |
| 批量延迟写入 | 1 天 | 性能优化（P0） |
| Artifacts 缓存 | 1 天 | LRU 缓存 |
| 数据库迁移 | 1 天 | 迁移脚本 + 测试 |

### Phase 3-5: 保持原计划（6-10 天）

- Phase 3: 依赖解析（2-3 天）
- Phase 4: 错误处理（3-4 天）
- Phase 5: 集成测试（2-3 天）

---

## 10. 总结

本详细设计文档（v2.0）已整合第二轮评审的所有 P0 修复方案：

**安全加固（5 个 P0）**:
1. ✅ 文件系统访问控制 - FileAccessGuard 强制执行
2. ✅ SQL 注入防护 - 参数化查询 + ID 验证
3. ✅ 命令注入防护 - 命令白名单
4. ✅ Artifact 内容验证 - 大小 + Content-Type + 内容扫描
5. ✅ 错误信息脱敏 - sanitizeError

**性能优化（1 个 P0）**:
6. ✅ SQLite 批量延迟写入 - 500ms 或 10 条触发

**架构验证（1 个 P0）**:
7. ✅ Claude SDK 并行 POC - 补充并发写入和取消测试

**核心接口更新**:
- StateManager 增加 `flush()` 和批量写入逻辑
- AgentFactory 增加 `SecurityConfig` 配置
- 执行流程增加 4 个安全检查点

**数据库变更**:
- team_run_stages 增加 `version`（乐观锁）、`retry_count`、`last_error` 等字段
- team_run_artifacts 增加 `validated` 安全字段

**实施计划调整**:
- 总工作量：18-24 天（原 11-15 天）
- 新增 Phase 0（安全加固，3-4 天）
- Phase 1-2 工作量增加（含 POC 和性能优化）

**下一步**: 等待 tech-lead 批准后，开始 Phase 0 安全加固实施。

