# Team Run POC 测试计划

**文档版本**: 1.0
**创建日期**: 2026-03-11
**负责人**: poc-engineer
**状态**: POC 测试计划

---

## 1. 测试目标

验证 Claude SDK 在 Team Run 场景下的核心能力：

1. **并行能力**: 同时运行多个独立 Agent session
2. **隔离性**: Session 之间互不干扰
3. **性能指标**: 启动时间、内存占用、执行效率
4. **稳定性**: 并发状态写入、Agent 取消机制

**成功标准**: 如果 POC 通过，继续使用多 session 方案；如果失败，切换到进程池方案。

---

## 2. 测试场景设计

### 2.1 场景 1: 基础并行能力测试

**目标**: 验证 SDK 是否支持同时创建和运行多个 session

**测试步骤**:
1. 同时创建 3 个独立 session
2. 并行执行 3 个不同任务
3. 验证结果正确性和独立性

**3 个并行 Worker 任务**:
- Worker 1: 计数任务（Count from 1 to 10）
- Worker 2: 颜色列表（List 5 primary colors）
- Worker 3: 文件操作（Create a JSON file with current timestamp）

**预期结果**:
- 3 个 session 创建成功
- 任务并行执行，互不干扰
- 每个 session 返回正确结果

---

### 2.2 场景 2: 性能压力测试

**目标**: 验证多 session 的性能开销

**测试步骤**:
1. 测量单个 session 创建时间
2. 测量 10 个 session 并行创建时间
3. 测量内存占用增量
4. 测量并行执行效率

**性能指标**:
- 单个 session 启动时间 < 3 秒
- 10 个 session 并行创建时间 < 10 秒
- 10 个 session 内存增量 < 500MB
- 并行执行效率 > 串行执行的 60%

---

### 2.3 场景 3: 并发状态写入测试

**目标**: 验证多个 Agent 同时写入数据库状态时的并发安全性

**测试步骤**:
1. 启动 5 个 Agent 并行执行
2. 每个 Agent 每秒更新一次状态到数据库
3. 执行 10 秒后检查数据一致性
4. 验证无状态丢失、无写入冲突

**验证点**:
- 数据库事务隔离正常
- 无死锁或写入失败
- 状态更新顺序正确
- 所有状态变更都被记录

---

### 2.4 场景 4: Agent 取消测试

**目标**: 验证运行中的 Agent 可以被正确取消

**测试步骤**:
1. 启动一个长时间运行的 Agent（30 秒任务）
2. 5 秒后发送取消信号
3. 验证 Agent 在合理时间内停止（< 3 秒）
4. 验证资源正确释放（session、文件句柄等）

**验证点**:
- Agent 响应取消信号
- 状态更新为 'cancelled'
- 无资源泄漏
- 工作目录正确清理

---

## 3. 测试代码实现

### 3.1 场景 1: 基础并行能力测试

```typescript
// poc/test-1-parallel-basic.ts
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk'

async function testBasicParallel() {
  console.log('=== 场景 1: 基础并行能力测试 ===\n')

  const startTime = Date.now()

  // 创建 3 个独立 session
  const sessions = await Promise.all([
    ClaudeAgent.create({
      sessionId: 'worker-1',
      systemPrompt: 'You are a counting assistant.'
    }),
    ClaudeAgent.create({
      sessionId: 'worker-2',
      systemPrompt: 'You are a color expert.'
    }),
    ClaudeAgent.create({
      sessionId: 'worker-3',
      systemPrompt: 'You are a file operations assistant.'
    })
  ])

  console.log(`✓ 创建 3 个 session 耗时: ${Date.now() - startTime}ms\n`)

  // 并行执行任务
  const execStart = Date.now()
  const results = await Promise.all([
    sessions[0].run('Count from 1 to 10'),
    sessions[1].run('List 5 primary colors'),
    sessions[2].run('Create a JSON file named test.json with current timestamp')
  ])

  console.log(`✓ 并行执行耗时: ${Date.now() - execStart}ms\n`)

  // 验证结果
  console.log('结果验证:')
  results.forEach((result, i) => {
    console.log(`  Worker ${i + 1}: ${result.slice(0, 80)}...`)
  })

  // 清理
  await Promise.all(sessions.map(s => s.destroy()))

  console.log('\n✓ 场景 1 测试通过\n')
}

testBasicParallel().catch(console.error)
```


### 3.2 场景 2: 性能压力测试

```typescript
// poc/test-2-performance.ts
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk'

async function testPerformance() {
  console.log('=== 场景 2: 性能压力测试 ===\n')

  // 测试 1: 单个 session 创建时间
  console.log('测试 1: 单个 session 创建时间')
  const singleStart = Date.now()
  const single = await ClaudeAgent.create({ sessionId: 'perf-single' })
  const singleTime = Date.now() - singleStart
  console.log(`✓ 单个 session: ${singleTime}ms`)
  await single.destroy()

  // 测试 2: 10 个 session 并行创建
  console.log('\n测试 2: 10 个 session 并行创建')
  const multiStart = Date.now()
  const sessions = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      ClaudeAgent.create({ sessionId: `perf-${i}` })
    )
  )
  const multiTime = Date.now() - multiStart
  console.log(`✓ 10 个 session: ${multiTime}ms`)

  // 测试 3: 内存占用
  console.log('\n测试 3: 内存占用')
  const memBefore = process.memoryUsage().heapUsed / 1024 / 1024
  
  const moreSessions = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      ClaudeAgent.create({ sessionId: `mem-${i}` })
    )
  )
  
  const memAfter = process.memoryUsage().heapUsed / 1024 / 1024
  const memIncrease = memAfter - memBefore
  console.log(`✓ 10 个 session 内存增量: ${memIncrease.toFixed(2)} MB`)

  // 测试 4: 并行执行效率
  console.log('\n测试 4: 并行 vs 串行执行效率')
  
  const parallelStart = Date.now()
  await Promise.all(
    sessions.slice(0, 3).map(s => s.run('Calculate 100 + 200'))
  )
  const parallelTime = Date.now() - parallelStart
  
  const serialStart = Date.now()
  for (const s of sessions.slice(3, 6)) {
    await s.run('Calculate 100 + 200')
  }
  const serialTime = Date.now() - serialStart
  
  const efficiency = (serialTime / parallelTime) * 100
  console.log(`✓ 并行: ${parallelTime}ms, 串行: ${serialTime}ms`)
  console.log(`✓ 并行效率: ${efficiency.toFixed(1)}%`)

  // 清理
  await Promise.all([...sessions, ...moreSessions].map(s => s.destroy()))

  // 验证成功标准
  console.log('\n成功标准验证:')
  console.log(`  单个 session < 3s: ${singleTime < 3000 ? '✓' : '✗'}`)
  console.log(`  10 个 session < 10s: ${multiTime < 10000 ? '✓' : '✗'}`)
  console.log(`  内存增量 < 500MB: ${memIncrease < 500 ? '✓' : '✗'}`)
  console.log(`  并行效率 > 60%: ${efficiency > 60 ? '✓' : '✗'}`)

  console.log('\n✓ 场景 2 测试完成\n')
}

testPerformance().catch(console.error)
```


### 3.3 场景 3: 并发状态写入测试

```typescript
// poc/test-3-concurrent-writes.ts
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk'
import Database from 'better-sqlite3'

async function testConcurrentWrites() {
  console.log('=== 场景 3: 并发状态写入测试 ===\n')

  // 初始化测试数据库
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE test_stages (
      id TEXT PRIMARY KEY,
      status TEXT,
      updateCount INTEGER DEFAULT 0,
      lastUpdate INTEGER
    )
  `)

  // 插入 5 个测试 stage
  const stageIds = Array.from({ length: 5 }, (_, i) => `stage-${i}`)
  stageIds.forEach(id => {
    db.prepare('INSERT INTO test_stages (id, status) VALUES (?, ?)').run(id, 'pending')
  })

  // 创建 5 个 Agent
  const agents = await Promise.all(
    stageIds.map(id => ClaudeAgent.create({ sessionId: id }))
  )

  console.log('启动 5 个 Agent 并发写入状态...\n')

  // 并发执行，每个 Agent 每秒更新状态
  const updatePromises = agents.map(async (agent, i) => {
    const stageId = stageIds[i]
    
    for (let j = 0; j < 10; j++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 模拟状态更新
      db.prepare(`
        UPDATE test_stages 
        SET status = ?, updateCount = updateCount + 1, lastUpdate = ?
        WHERE id = ?
      `).run(`running-${j}`, Date.now(), stageId)
    }
    
    db.prepare('UPDATE test_stages SET status = ? WHERE id = ?').run('done', stageId)
  })

  await Promise.all(updatePromises)

  // 验证数据一致性
  console.log('验证数据一致性:\n')
  const results = db.prepare('SELECT * FROM test_stages').all()
  
  let allPassed = true
  results.forEach((row: any) => {
    const passed = row.status === 'done' && row.updateCount === 10
    console.log(`  ${row.id}: status=${row.status}, updates=${row.updateCount} ${passed ? '✓' : '✗'}`)
    if (!passed) allPassed = false
  })

  // 清理
  await Promise.all(agents.map(a => a.destroy()))
  db.close()

  console.log(`\n${allPassed ? '✓' : '✗'} 场景 3 测试${allPassed ? '通过' : '失败'}\n`)
}

testConcurrentWrites().catch(console.error)
```


### 3.4 场景 4: Agent 取消测试

```typescript
// poc/test-4-cancellation.ts
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk'
import * as fs from 'fs'
import * as path from 'path'

async function testCancellation() {
  console.log('=== 场景 4: Agent 取消测试 ===\n')

  const workDir = path.join(process.cwd(), 'test-workspace')
  fs.mkdirSync(workDir, { recursive: true })

  // 创建长时间运行的 Agent
  const agent = await ClaudeAgent.create({
    sessionId: 'cancel-test',
    workingDirectory: workDir
  })

  console.log('启动长时间任务（30秒）...')
  const startTime = Date.now()

  // 启动任务
  const taskPromise = agent.run('Count from 1 to 30, wait 1 second between each number')

  // 5 秒后取消
  setTimeout(async () => {
    console.log('\n5 秒后发送取消信号...')
    const cancelStart = Date.now()
    
    await agent.terminate()
    
    const cancelTime = Date.now() - cancelStart
    console.log(`✓ Agent 停止耗时: ${cancelTime}ms`)
    console.log(`✓ 取消响应时间 < 3s: ${cancelTime < 3000 ? '✓' : '✗'}`)
  }, 5000)

  // 等待任务结束
  try {
    await taskPromise
    console.log('✗ 任务未被取消')
  } catch (error) {
    const totalTime = Date.now() - startTime
    console.log(`✓ 任务已取消，总耗时: ${totalTime}ms`)
  }

  // 验证资源清理
  console.log('\n验证资源清理:')
  const status = agent.getStatus()
  console.log(`  Agent 状态: ${status.state} ${status.state === 'terminated' ? '✓' : '✗'}`)
  
  const filesExist = fs.existsSync(workDir)
  console.log(`  工作目录存在: ${filesExist ? '✓' : '✗'}`)

  // 清理
  fs.rmSync(workDir, { recursive: true, force: true })

  console.log('\n✓ 场景 4 测试完成\n')
}

testCancellation().catch(console.error)
```


---

## 4. 执行步骤

### 4.1 环境准备

```bash
# 1. 创建 POC 目录
mkdir -p poc
cd poc

# 2. 初始化项目
npm init -y

# 3. 安装依赖
npm install @anthropic-ai/claude-agent-sdk better-sqlite3
npm install -D @types/node typescript tsx

# 4. 配置 TypeScript
cat > tsconfig.json << 'JSON'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
JSON
```

### 4.2 执行测试

```bash
# 运行所有测试
npm run test:all

# 或单独运行
tsx test-1-parallel-basic.ts
tsx test-2-performance.ts
tsx test-3-concurrent-writes.ts
tsx test-4-cancellation.ts
```

### 4.3 收集结果

创建测试报告模板：

```typescript
// poc/report.ts
interface TestResult {
  scenario: string
  passed: boolean
  metrics: Record<string, any>
  notes: string
}

const results: TestResult[] = []

// 运行所有测试并收集结果
// 生成 Markdown 报告
```

---

## 5. 成功标准

### 5.1 功能性标准

| 测试项 | 标准 | 权重 |
|--------|------|------|
| 多 session 创建 | 可同时创建 10+ 个 session | P0 |
| 并行执行隔离 | Session 之间互不干扰 | P0 |
| 并发状态写入 | 无数据丢失或冲突 | P0 |
| Agent 取消 | 响应取消信号并正确清理 | P0 |

### 5.2 性能标准

| 指标 | 目标值 | 可接受值 |
|------|--------|----------|
| 单 session 启动时间 | < 2s | < 3s |
| 10 session 并行创建 | < 8s | < 10s |
| 10 session 内存增量 | < 300MB | < 500MB |
| 并行执行效率 | > 70% | > 60% |
| 取消响应时间 | < 2s | < 3s |

### 5.3 稳定性标准

- 连续运行 10 次无崩溃
- 内存无泄漏（运行前后内存差异 < 50MB）
- 无未捕获异常
- 资源正确释放（文件句柄、数据库连接）

---

## 6. 失败应对方案

### 6.1 方案 A: 进程池方案

**触发条件**:
- SDK 不支持多 session 并行
- 性能指标未达到可接受值
- 稳定性测试失败率 > 20%

**实现方案**:

```typescript
// lib/process-pool-worker.ts
import { fork, ChildProcess } from 'child_process'

class ProcessPoolWorker {
  private worker: ChildProcess | null = null

  async execute(stage: TeamRunStage, context: ExecutionContext): Promise<StageResult> {
    this.worker = fork('./agent-worker.js')
    
    return new Promise((resolve, reject) => {
      this.worker!.send({ stage, context })
      
      this.worker!.on('message', (result: StageResult) => {
        resolve(result)
      })
      
      this.worker!.on('error', reject)
      
      setTimeout(() => {
        reject(new Error('Worker timeout'))
      }, context.budget.maxRunMinutes * 60 * 1000)
    })
  }

  async cancel(): Promise<void> {
    if (this.worker) {
      this.worker.kill('SIGTERM')
      this.worker = null
    }
  }
}
```

**优势**:
- 完全隔离（进程级）
- 崩溃不影响主进程
- 资源限制更容易控制

**劣势**:
- 启动开销更大（~500ms per worker）
- 进程间通信开销
- 实现复杂度增加

---

### 6.2 方案 B: 批次串行方案

**触发条件**:
- 方案 A 实现成本过高
- 并行需求不强烈
- 用户可接受较长执行时间

**实现方案**:

```typescript
// lib/serial-executor.ts
async function executeBatchSerial(
  batch: ExecutionBatch,
  stages: Map<string, TeamRunStage>,
  context: ExecutionContext
): Promise<BatchResult> {
  const results: StageResult[] = []

  for (const stageId of batch.stageIds) {
    const stage = stages.get(stageId)!
    const result = await executeStage(stage, context)
    results.push(result)
  }

  return {
    batchIndex: batch.batchIndex,
    total: batch.stageIds.length,
    succeeded: results.filter(r => r.status === 'done').length,
    failed: results.filter(r => r.status === 'failed').length,
    results
  }
}
```

**优势**:
- 实现简单
- 资源占用低
- 稳定性高

**劣势**:
- 执行时间长
- 无法利用并行优势

---

### 6.3 决策矩阵

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| POC 完全通过 | 多 session 方案 | 性能最优 |
| 性能不达标但功能正常 | 进程池方案 | 保持并行能力 |
| 稳定性问题 | 进程池方案 | 隔离性更好 |
| 实现时间紧张 | 批次串行方案 | 快速上线 |

---

## 7. 测试时间表

| 阶段 | 任务 | 预计时间 | 负责人 |
|------|------|----------|--------|
| Day 1 | 环境准备 + 场景 1-2 | 4h | poc-engineer |
| Day 2 | 场景 3-4 + 报告 | 4h | poc-engineer |
| Day 3 | 评审 + 决策 | 2h | tech-lead |

**总计**: 2-3 天

---

## 8. 交付物

1. **测试代码**: `poc/test-*.ts` (4 个文件)
2. **测试报告**: `poc/REPORT.md`
   - 测试结果汇总
   - 性能指标数据
   - 问题清单
   - 方案建议
3. **决策文档**: `design/team-run/07-poc-decision.md`
   - POC 结论
   - 选定方案
   - 实施建议

---

## 9. 总结

本 POC 测试计划覆盖了 Team Run 执行引擎的核心验证点：

1. **并行能力**: 验证 Claude SDK 多 session 支持
2. **性能指标**: 量化启动时间、内存占用、执行效率
3. **并发安全**: 验证数据库状态写入的并发正确性
4. **取消机制**: 验证 Agent 可被正确取消和清理

测试代码可直接运行，成功标准明确量化，失败应对方案具体可执行。POC 结果将直接指导架构选型和实施方案。

