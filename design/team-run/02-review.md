# Team Run 执行引擎架构评审报告

**评审人**: 架构评审专家
**评审日期**: 2026-03-11
**文档版本**: 1.0
**评审状态**: 完成

---

## 1. 执行摘要

本次评审针对 Team Run 执行引擎的初步架构设计进行全面分析。整体架构设计清晰、分层合理，技术选型务实。设计充分考虑了依赖管理、并发控制、错误处理等关键问题。

**总体评价**: ⭐⭐⭐⭐ (4/5)

**核心优势**:
- 分层架构清晰，职责边界明确
- 批次并行模型平衡了效率和复杂度
- 错误处理和恢复机制完善
- 渐进式实施策略降低风险

**主要问题**:
- Agent 间通信机制存在性能瓶颈
- 并发控制策略不够精细
- 缺少资源隔离和配额管理
- 状态同步机制可能存在竞态条件

---

## 2. 架构优势分析

### 2.1 分层设计 ✅

**优势**: 五层架构（API、Orchestrator、Worker、StateManager、Database）职责清晰，符合单一职责原则。

- API Layer 只负责请求验证和路由
- Orchestrator 专注于调度和生命周期管理
- Worker 封装 Agent 执行细节
- StateManager 统一管理持久化逻辑
- Database 作为唯一数据源

**价值**:
- 易于测试：每层可独立 mock 和测试
- 易于扩展：替换某层实现不影响其他层
- 易于维护：问题定位快速准确

### 2.2 批次并行模型 ✅

**优势**: 使用拓扑排序生成批次，批次内并行执行，是当前阶段的最优选择。

**理由**:
- 实现复杂度适中（相比完全并行调度）
- 依赖关系清晰可追溯
- 支持 maxParallelWorkers 限制
- 调试友好（批次边界明确）

**对比分析**:
| 模型 | 效率 | 复杂度 | 可调试性 |
|------|------|--------|----------|
| 顺序执行 | 低 | 低 | 高 |
| 批次并行 | 中 | 中 | 中 |
| 完全并行 | 高 | 高 | 低 |

当前选择批次并行是正确的权衡。

### 2.3 独立 Session 隔离 ✅

**优势**: 每个 Agent 使用独立的 Claude SDK session，避免状态污染。

**价值**:
- 隔离性强：Agent 之间不会相互干扰
- 可预测性高：每个 Agent 从干净状态开始
- 易于调试：问题定位到具体 Agent
- 易于重试：失败后重新创建即可

**权衡**: 启动慢（1-2秒）是可接受的代价，相比状态污染带来的不可预测性，这是正确的选择。

### 2.4 实时状态持久化 ✅

**优势**: 每次状态变化立即写入数据库，配合 WAL 模式提升性能。

**价值**:
- 崩溃恢复：进程崩溃不丢失状态
- 实时查询：UI 可以获取最新进度
- 审计追踪：完整记录执行历史

### 2.5 渐进式实施 ✅

**优势**: 分 5 个 Phase 实施，先实现核心功能，再逐步完善。

**价值**:
- 降低风险：每个阶段可独立验收
- 快速反馈：尽早发现问题
- 灵活调整：根据实际情况调整计划

---

## 3. 关键问题清单

### 3.1 【严重】Agent 间通信性能瓶颈 🔴

**问题描述**:
设计中 Agent 通过数据库字段 `latestResult` 传递数据，限制为 10KB。这存在两个问题：

1. **大小限制过严**: 10KB 无法传递复杂的架构设计、代码文件等
2. **性能问题**: 每次读取依赖都要查询数据库，批次间串行等待

**影响范围**: 核心功能

**场景示例**:
```
Stage A: 设计数据库 schema (输出 50KB JSON)
Stage B: 生成 migration 文件 (依赖 A 的输出)
→ 结果被截断，Stage B 拿到不完整数据
```

**建议方案**:
1. **短期**: 提升限制到 100KB，超出部分写入文件系统
2. **长期**: 引入 `team_run_artifacts` 表存储大文件
   ```sql
   CREATE TABLE team_run_artifacts (
     id TEXT PRIMARY KEY,
     stageId TEXT,
     type TEXT,  -- 'output' | 'file' | 'log'
     content BLOB,
     metadata TEXT
   )
   ```


### 3.2 【重要】并发控制策略不够精细 🟡

**问题描述**:
当前设计使用简单的 `maxParallelWorkers` 限制并发数，但没有考虑：

1. **资源差异**: 不同 Agent 消耗的资源不同（CPU、内存、API 配额）
2. **优先级**: 关键路径上的任务应优先执行
3. **动态调整**: 无法根据系统负载动态调整并发数

**影响范围**: 性能优化

**场景示例**:
```
批次 1: [A, B, C]  (A 是重型任务，B/C 是轻量任务)
当前: 只能同时执行 maxParallelWorkers 个
理想: A 单独执行，B/C 并行执行
```

**建议方案**:
1. 引入资源权重配置
   ```typescript
   interface AgentBudget {
     weight: number  // 1-10，默认 5
     maxParallelWorkers: number
   }
   ```
2. 使用加权调度算法
   ```typescript
   let currentWeight = 0
   const maxWeight = 10
   for (const stage of batch) {
     if (currentWeight + stage.weight <= maxWeight) {
       startWorker(stage)
       currentWeight += stage.weight
     }
   }
   ```

### 3.3 【重要】缺少资源隔离和配额管理 🟡

**问题描述**:
设计中提到"共享工作目录（暂不隔离文件系统）"，这存在风险：

1. **文件冲突**: 多个 Agent 可能写入同名文件
2. **数据泄露**: Agent A 可以读取 Agent B 的中间文件
3. **无配额控制**: 单个 Agent 可能占满磁盘

**影响范围**: 稳定性、安全性

**建议方案**:
1. **文件系统隔离**: 每个 Agent 使用独立工作目录
   ```typescript
   const workDir = path.join(
     LUMOS_DATA_DIR,
     'team-runs',
     runId,
     'stages',
     stageId
   )
   ```
2. **磁盘配额**: 限制单个 Stage 的磁盘使用
   ```typescript
   interface AgentBudget {
     maxDiskMB: number  // 默认 100MB
   }
   ```

### 3.4 【中等】状态同步存在竞态条件 🟡

**问题描述**:
设计中使用乐观锁（version 字段）防止并发冲突，但存在问题：

1. **ABA 问题**: version 递增无法检测中间状态变化
2. **重试风暴**: 高并发下大量更新失败重试
3. **状态不一致**: Orchestrator 聚合状态时可能读到中间状态

**影响范围**: 数据一致性

**场景示例**:
```
时刻 T1: Worker 读取 stage (version=1, status='running')
时刻 T2: 另一个进程更新 stage (version=2, status='done')
时刻 T3: Worker 更新失败 (version 不匹配)
→ Worker 需要重试，增加延迟
```

**建议方案**:
1. 使用行锁替代乐观锁
   ```typescript
   db.prepare('SELECT * FROM team_run_stages WHERE id = ? FOR UPDATE')
   ```
2. 引入状态机验证
   ```typescript
   const validTransitions = {
     pending: ['ready', 'cancelled'],
     ready: ['running', 'cancelled'],
     running: ['done', 'failed', 'cancelled']
   }
   ```


### 3.5 【中等】缺少取消和暂停的实现细节 🟡

**问题描述**:
设计中定义了 `pauseRun()` 和 `cancelRun()` 接口，但没有说明如何中断正在执行的 Agent。

**影响范围**: 用户体验

**技术挑战**:
1. Claude SDK 可能不支持中断正在执行的 session
2. 需要优雅关闭，避免数据损坏
3. 暂停后恢复需要保存中间状态

**建议方案**:
1. **取消**: 设置标志位，Worker 定期检查
   ```typescript
   class StageWorker {
     private cancelled = false
     
     async execute(stage: TeamRunStage) {
       const checkInterval = setInterval(() => {
         if (this.cancelled) {
           agent.terminate()
         }
       }, 1000)
     }
   }
   ```
2. **暂停**: 第一版不实现，标记为 "Not Supported"

### 3.6 【次要】依赖解析算法可能低效 🟢

**问题描述**:
`buildBatches()` 使用简单的循环查找就绪任务，时间复杂度 O(n²)。

**影响范围**: 大规模任务（>100 个 Stage）

**建议方案**:
使用标准的 Kahn 算法优化到 O(n+e)：
```typescript
function buildBatches(stages: TeamRunStage[]): string[][] {
  const inDegree = new Map<string, number>()
  const graph = new Map<string, string[]>()
  
  // 构建图和入度表
  for (const stage of stages) {
    inDegree.set(stage.id, stage.dependsOn.length)
    for (const dep of stage.dependsOn) {
      if (!graph.has(dep)) graph.set(dep, [])
      graph.get(dep).push(stage.id)
    }
  }
  
  // 拓扑排序
  const batches: string[][] = []
  while (inDegree.size > 0) {
    const ready = Array.from(inDegree.entries())
      .filter(([_, degree]) => degree === 0)
      .map(([id]) => id)
    
    if (ready.length === 0) throw new Error('Cycle detected')
    
    batches.push(ready)
    ready.forEach(id => {
      inDegree.delete(id)
      graph.get(id)?.forEach(next => {
        inDegree.set(next, inDegree.get(next)! - 1)
      })
    })
  }
  
  return batches
}
```

---

## 4. 改进建议

### 4.1 架构层面

**建议 1: 引入事件总线**

当前设计中组件间通信通过直接调用，建议引入事件总线解耦：

```typescript
interface TeamRunEvent {
  type: 'stage.started' | 'stage.completed' | 'stage.failed' | 'run.completed'
  payload: any
}

class EventBus {
  private listeners = new Map<string, Function[]>()
  
  emit(event: TeamRunEvent): void
  on(type: string, handler: Function): void
}
```

**价值**:
- 解耦组件依赖
- 易于扩展（添加监控、日志等）
- 支持异步处理


**建议 2: 增强可观测性**

当前设计有基础日志，建议增强：

1. **结构化日志**: 使用 JSON 格式，便于分析
2. **Trace ID**: 为每个 Run 生成唯一 ID，串联所有日志
3. **性能指标**: 记录关键操作耗时
4. **健康检查**: 提供 `/health` 端点

```typescript
interface Metrics {
  runId: string
  startTime: number
  stages: {
    [stageId: string]: {
      startTime: number
      endTime: number
      retries: number
      status: string
    }
  }
}
```

**建议 3: 支持依赖数据过滤**

当前设计中 Stage B 会收到 Stage A 的完整输出，建议支持选择性传递：

```typescript
interface StageDependency {
  stageId: string
  selector?: string  // JSONPath 表达式
}

// 示例
{
  dependsOn: [
    { stageId: 'stage-a', selector: '$.architecture' },
    { stageId: 'stage-b', selector: '$.components[*].name' }
  ]
}
```

**价值**:
- 减少数据传输量
- 提高 Agent 上下文清晰度
- 避免信息过载

### 4.2 实现层面

**建议 4: 使用 TypeScript 严格模式**

确保所有文件启用严格类型检查：

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

**建议 5: 添加集成测试**

除了单元测试，建议添加端到端测试：

```typescript
describe('Team Run E2E', () => {
  it('should execute simple plan', async () => {
    const plan = createTestPlan([
      { id: 'A', task: 'List files', dependsOn: [] },
      { id: 'B', task: 'Count files', dependsOn: ['A'] }
    ])
    
    const run = await orchestrator.startRun(plan.id)
    await waitForCompletion(run.id)
    
    const result = await orchestrator.getStatus(run.id)
    expect(result.status).toBe('done')
    expect(result.stages).toHaveLength(2)
  })
})
```

**建议 6: 文件大小预警**

在 CI 中检查文件大小，超过 250 行时警告：

```bash
# .github/workflows/check-file-size.yml
find src/lib/team-run -name "*.ts" | while read file; do
  lines=$(wc -l < "$file")
  if [ $lines -gt 250 ]; then
    echo "Warning: $file has $lines lines"
  fi
done
```


---

## 5. 风险评估

### 5.1 技术风险

| 风险 | 等级 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|----------|
| SQLite 并发瓶颈 | 中 | 60% | 高 | WAL 模式 + 批量更新 + 限制并发数 |
| Claude SDK 限制 | 中 | 40% | 中 | 独立 session + 数据库传递上下文 |
| 内存占用过高 | 低 | 30% | 中 | 限制并发数 + 限制输出大小 |
| Agent 通信数据丢失 | 高 | 70% | 高 | 引入 artifacts 表 + 提升大小限制 |
| 状态同步竞态 | 中 | 50% | 中 | 使用行锁 + 状态机验证 |

**高风险项处理建议**:
- **Agent 通信数据丢失**: 必须在 Phase 1 解决，否则影响核心功能

### 5.2 实施风险

| 风险 | 等级 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|----------|
| 复杂度估算不足 | 中 | 50% | 中 | 分阶段实施 + 预留缓冲时间 |
| 测试覆盖不足 | 中 | 40% | 高 | 编写测试计划 + Code Review |
| 文件大小超标 | 低 | 30% | 低 | CI 检查 + 及时拆分 |
| 依赖 SDK 变更 | 低 | 20% | 高 | 锁定版本 + 监控更新日志 |

### 5.3 运维风险

| 风险 | 等级 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|----------|
| 数据库损坏 | 低 | 10% | 高 | 定期备份 + WAL 模式 |
| 磁盘空间不足 | 中 | 40% | 中 | 磁盘配额 + 定期清理 |
| 进程崩溃 | 中 | 30% | 中 | 实时持久化 + 恢复机制 |

---

## 6. 数据模型评审

### 6.1 现有设计评价

**优点**:
- 字段完整，覆盖核心需求
- 使用 JSON 存储依赖关系，灵活性高
- 状态字段枚举清晰

**问题**:
1. **缺少执行时间字段**: 建议新增 `startedAt` 和 `completedAt`
2. **缺少错误信息字段**: 建议新增 `errorMessage`
3. **缺少重试计数字段**: 建议新增 `retryCount`
4. **缺少版本字段**: 建议新增 `version` 用于乐观锁

### 6.2 建议的完整 Schema

```sql
CREATE TABLE team_run_stages (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  ownerRoleId TEXT,
  task TEXT,
  dependsOn TEXT,  -- JSON array
  status TEXT CHECK(status IN ('pending','ready','running','waiting','blocked','done','failed','cancelled')),
  latestResult TEXT,
  
  -- 新增字段
  retryCount INTEGER DEFAULT 0,
  errorMessage TEXT,
  startedAt INTEGER,
  completedAt INTEGER,
  version INTEGER DEFAULT 0,
  
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  
  FOREIGN KEY (runId) REFERENCES team_runs(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX idx_stages_run_status ON team_run_stages(runId, status);
CREATE INDEX idx_stages_started ON team_run_stages(startedAt) WHERE startedAt IS NOT NULL;
```


---

## 7. 接口设计评审

### 7.1 Orchestrator 接口 ✅

**评价**: 接口设计清晰，符合 CRUD 模式。

**建议**: 增加批量操作接口
```typescript
interface ITeamRunOrchestrator {
  // 现有接口
  startRun(runId: string): Promise<void>
  pauseRun(runId: string): Promise<void>
  resumeRun(runId: string): Promise<void>
  cancelRun(runId: string): Promise<void>
  getStatus(runId: string): Promise<TeamRunStatus>
  
  // 建议新增
  retryFailedStages(runId: string): Promise<void>
  getStageOutput(stageId: string): Promise<string>
}
```

### 7.2 Worker 接口 ✅

**评价**: 职责单一，易于测试。

**建议**: 增加进度回调
```typescript
interface IStageWorker {
  execute(
    stage: TeamRunStage,
    context: ExecutionContext,
    onProgress?: (progress: number) => void  // 0-100
  ): Promise<StageResult>
  
  cancel(): Promise<void>
  getStatus(): WorkerStatus
}
```

### 7.3 StateManager 接口 ⚠️

**问题**: 缺少事务支持

**建议**: 增加事务接口
```typescript
interface IStateManager {
  // 现有接口
  updateStageStatus(stageId: string, status: StageStatus): Promise<void>
  updateStageResult(stageId: string, result: string): Promise<void>
  getDependencyResults(stageIds: string[]): Promise<DependencyResult[]>
  getRunStatus(runId: string): Promise<TeamRun>
  
  // 建议新增
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
  batchUpdate(updates: StageUpdate[]): Promise<void>
}
```

---

## 8. 性能评估

### 8.1 预期性能指标

基于设计估算：

| 指标 | 预期值 | 备注 |
|------|--------|------|
| 启动 Team Run | < 1s | 加载数据 + 依赖解析 |
| 启动单个 Agent | 1-2s | Claude SDK session 创建 |
| 状态查询 | < 100ms | 单表查询 + 索引优化 |
| 状态更新 | < 50ms | WAL 模式 + 批量更新 |
| 并行效率 | 70-80% | 批次边界损失 |

### 8.2 性能瓶颈分析

**瓶颈 1: Agent 启动时间**
- 每个 Agent 启动需要 1-2 秒
- 10 个 Agent 顺序启动需要 10-20 秒
- **缓解**: 批次内并行启动

**瓶颈 2: 数据库写入**
- 每次状态变化都写入数据库
- 高并发下可能成为瓶颈
- **缓解**: WAL 模式 + 批量更新

**瓶颈 3: 依赖数据传递**
- 每次读取依赖都查询数据库
- 大数据量时性能下降
- **缓解**: 引入缓存层


### 8.3 扩展性评估

**当前设计支持规模**:
- Stage 数量: < 50 (批次并行模型)
- 并发 Worker: < 10 (受限于内存和 API 配额)
- Run 时长: < 30 分钟 (受限于超时设置)

**扩展路径**:
1. **Phase 2**: 完全并行调度 → 支持 100+ Stage
2. **Phase 3**: 分布式执行 → 支持 1000+ Stage

---

## 9. 安全性评审

### 9.1 潜在安全风险

**风险 1: Agent 权限过大**
- Agent 可以访问整个工作目录
- 可能读取敏感文件（.env、密钥等）
- **建议**: 文件系统隔离 + 白名单机制

**风险 2: 代码注入**
- Agent 输出可能包含恶意代码
- 后续 Agent 可能执行恶意代码
- **建议**: 输出内容过滤 + 沙箱执行

**风险 3: 资源耗尽攻击**
- 恶意 Agent 可能占满磁盘/内存
- **建议**: 资源配额 + 监控告警

### 9.2 安全加固建议

```typescript
interface SecurityConfig {
  // 文件访问控制
  allowedPaths: string[]
  deniedPaths: string[]
  
  // 资源限制
  maxDiskMB: number
  maxMemoryMB: number
  maxCPUPercent: number
  
  // 网络控制
  allowedDomains: string[]
  blockExternalNetwork: boolean
}
```

---

## 10. 可维护性评审

### 10.1 代码组织 ✅

**优点**:
- 文件按功能分组，结构清晰
- 单文件不超过 300 行，符合规范
- 类型定义集中管理

**建议**:
- 添加 JSDoc 注释
- 使用 ESLint 强制代码风格
- 添加 pre-commit hook

### 10.2 测试策略 ⚠️

**当前设计**: 提到测试覆盖率 > 80%，但缺少具体策略。

**建议测试金字塔**:
```
E2E 测试 (10%)
  ├─ 完整 Team Run 执行
  └─ 错误恢复流程

集成测试 (30%)
  ├─ Orchestrator + Worker
  ├─ Worker + StateManager
  └─ DependencyResolver + Database

单元测试 (60%)
  ├─ DependencyResolver
  ├─ StateManager
  ├─ AgentFactory
  └─ 工具函数
```

### 10.3 文档完整性 ✅

**优点**:
- 架构文档详细，包含流程图和代码示例
- 接口定义清晰
- 实施计划明确

**建议**:
- 添加 API 文档（OpenAPI/Swagger）
- 添加故障排查指南
- 添加性能调优指南


---

## 11. 与现有系统集成评审

### 11.1 数据库集成 ✅

**优点**: 复用现有 SQLite 数据库，无需额外依赖。

**建议**: 确保数据库迁移脚本完整
```typescript
// src/lib/db/migrations/add-team-run-fields.ts
export function migrate(db: Database) {
  db.exec(`
    ALTER TABLE team_run_stages ADD COLUMN retryCount INTEGER DEFAULT 0;
    ALTER TABLE team_run_stages ADD COLUMN errorMessage TEXT;
    ALTER TABLE team_run_stages ADD COLUMN startedAt INTEGER;
    ALTER TABLE team_run_stages ADD COLUMN completedAt INTEGER;
    ALTER TABLE team_run_stages ADD COLUMN version INTEGER DEFAULT 0;
    
    CREATE INDEX idx_stages_run_status ON team_run_stages(runId, status);
  `)
}
```

### 11.2 Claude SDK 集成 ⚠️

**问题**: 设计假设 SDK 支持多 session 并行，需要验证。

**建议**: 在 Phase 1 前进行 POC 验证
```typescript
// POC: 验证并行 session
const sessions = await Promise.all([
  sdk.createSession({ sessionId: 'test-1' }),
  sdk.createSession({ sessionId: 'test-2' }),
  sdk.createSession({ sessionId: 'test-3' })
])

await Promise.all(sessions.map(s => s.run('echo hello')))
```

### 11.3 UI 集成 ✅

**优点**: API 设计符合 RESTful 规范，易于前端调用。

**建议**: 提供 WebSocket 接口支持实时推送
```typescript
// ws://localhost:3000/api/tasks/team-runs/:id/stream
{
  type: 'stage.started',
  stageId: 'stage-1',
  timestamp: 1234567890
}
```

---

## 12. 总结与建议

### 12.1 必须解决的问题（Phase 1 前）

🔴 **P0 - 阻塞性问题**:
1. **Agent 通信数据大小限制** - 引入 artifacts 表或提升限制到 100KB
2. **Claude SDK 并行验证** - POC 验证多 session 并行是否可行
3. **文件系统隔离** - 避免 Agent 间文件冲突

### 12.2 建议优化的问题（Phase 2-3）

🟡 **P1 - 重要优化**:
1. 并发控制策略优化（资源权重）
2. 状态同步机制改进（行锁替代乐观锁）
3. 取消和暂停功能实现

🟢 **P2 - 次要优化**:
1. 依赖解析算法优化（Kahn 算法）
2. 事件总线引入
3. 依赖数据过滤

### 12.3 架构演进路线图

```
Phase 1 (当前设计)
  ├─ 批次并行
  ├─ 独立 session
  ├─ 实时持久化
  └─ 基础错误处理

Phase 2 (3-6 个月后)
  ├─ 完全并行调度
  ├─ 资源权重调度
  ├─ 事件总线
  └─ 高级监控

Phase 3 (6-12 个月后)
  ├─ 分布式执行
  ├─ Agent 间消息传递
  ├─ 共享文件系统
  └─ 动态扩缩容
```

### 12.4 最终评价

**架构成熟度**: ⭐⭐⭐⭐ (4/5)

**推荐决策**: ✅ **批准进入详细设计阶段**

**前提条件**:
1. 解决 Agent 通信数据大小限制问题
2. 完成 Claude SDK 并行验证 POC
3. 补充文件系统隔离设计

**预期收益**:
- 支持 10-50 个 Stage 的并行执行
- 提供完整的错误处理和恢复机制
- 为未来扩展奠定基础

---

## 13. 行动项

| 优先级 | 行动项 | 负责人 | 预计时间 |
|--------|--------|--------|----------|
| P0 | 设计 artifacts 表方案 | detail-designer | 1 天 |
| P0 | Claude SDK 并行 POC | tech-lead | 1 天 |
| P0 | 文件系统隔离设计 | detail-designer | 1 天 |
| P1 | 补充数据库 migration 脚本 | detail-designer | 0.5 天 |
| P1 | 编写测试计划 | tech-lead | 1 天 |
| P2 | 优化依赖解析算法 | detail-designer | 0.5 天 |

---

**评审结论**: 架构设计整体合理，建议解决 P0 问题后进入详细设计阶段。

**下一步**: 等待 detail-designer 完成细化设计。

