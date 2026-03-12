# Team Run API 设计文档

## 1. 概述

本文档定义 Team Run 执行引擎与前端的 REST API 接口规范。

**设计原则**：
- RESTful 风格，资源导向
- 最小化接口数量，避免过度设计
- 支持实时状态推送（SSE）
- 统一错误处理和响应格式

---

## 2. 核心资源

### 2.1 Team Run（执行实例）

```typescript
interface TeamRun {
  id: string
  planId: string
  status: 'pending' | 'ready' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  progress: {
    total: number
    completed: number
    failed: number
    running: number
    blocked: number
  }
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: string
}
```

### 2.2 Stage（执行阶段）

```typescript
interface Stage {
  id: string
  runId: string
  name: string
  roleId: string
  task: string
  status: 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'cancelled'
  dependsOn: string[]
  output?: string
  error?: string
  retryCount: number
  startedAt?: number
  completedAt?: number
  duration?: number
}
```

---

## 3. API 端点

### 3.1 创建 Run

```
POST /api/team-run/runs
```

**请求体**：
```json
{
  "planId": "plan_abc123",
  "stages": [
    {
      "name": "研究需求",
      "roleId": "researcher",
      "task": "分析用户需求并输出技术方案",
      "dependsOn": []
    },
    {
      "name": "实现功能",
      "roleId": "developer",
      "task": "根据技术方案实现代码",
      "dependsOn": ["stage_1"]
    }
  ]
}
```

**响应**：
```json
{
  "runId": "run_xyz789",
  "status": "pending",
  "stages": [
    { "id": "stage_1", "status": "pending", ... },
    { "id": "stage_2", "status": "pending", ... }
  ]
}
```

---

### 3.2 启动 Run

```
POST /api/team-run/runs/:runId/start
```

**响应**：
```json
{
  "runId": "run_xyz789",
  "status": "running"
}
```

---

### 3.3 获取 Run 状态

```
GET /api/team-run/runs/:runId
```

**响应**：
```json
{
  "id": "run_xyz789",
  "planId": "plan_abc123",
  "status": "running",
  "progress": {
    "total": 5,
    "completed": 2,
    "failed": 0,
    "running": 1,
    "blocked": 2
  },
  "stages": [
    {
      "id": "stage_1",
      "status": "done",
      "output": "技术方案已完成...",
      "duration": 45000
    },
    {
      "id": "stage_2",
      "status": "running",
      "startedAt": 1678901234567
    }
  ],
  "startedAt": 1678900000000
}
```

---

### 3.4 暂停/取消 Run

```
POST /api/team-run/runs/:runId/pause
POST /api/team-run/runs/:runId/cancel
```

**响应**：
```json
{
  "runId": "run_xyz789",
  "status": "paused"
}
```

---

### 3.5 实时状态推送（SSE）

```
GET /api/team-run/runs/:runId/stream
```

**事件流**：
```
event: status
data: {"runId":"run_xyz789","status":"running"}

event: stage-update
data: {"stageId":"stage_1","status":"running","startedAt":1678901234567}

event: stage-update
data: {"stageId":"stage_1","status":"done","output":"...","duration":45000}

event: progress
data: {"total":5,"completed":3,"failed":0,"running":1,"blocked":1}

event: complete
data: {"runId":"run_xyz789","status":"done","completedAt":1678905000000}
```

---

## 4. 错误处理

### 4.1 统一错误格式

```typescript
interface ApiError {
  error: {
    code: string
    message: string
    details?: any
  }
}
```

### 4.2 错误码

| HTTP 状态 | 错误码 | 说明 |
|----------|--------|------|
| 400 | INVALID_REQUEST | 请求参数错误 |
| 404 | RUN_NOT_FOUND | Run 不存在 |
| 409 | RUN_ALREADY_RUNNING | Run 已在运行 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

**示例**：
```json
{
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "Run run_xyz789 does not exist"
  }
}
```

---

## 5. 实现示例

### 5.1 API 路由实现

**文件**: `src/app/api/team-run/runs/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'
import { randomBytes } from 'crypto'

const orchestrators = new Map<string, TeamRunOrchestrator>()

function getOrchestrator(): TeamRunOrchestrator {
  const key = 'default'
  if (!orchestrators.has(key)) {
    const db = getDatabase()
    orchestrators.set(key, new TeamRunOrchestrator(db))
  }
  return orchestrators.get(key)!
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { planId, stages } = body

    if (!planId || !stages || !Array.isArray(stages)) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Missing planId or stages' } },
        { status: 400 }
      )
    }

    const db = getDatabase()
    const runId = randomBytes(16).toString('base64url').slice(0, 21)
    const now = Date.now()

    // 创建 run
    db.prepare(`
      INSERT INTO team_runs (id, plan_id, status, created_at)
      VALUES (?, ?, 'pending', ?)
    `).run(runId, planId, now)

    // 创建 stages
    const stageIds: string[] = []
    for (const stage of stages) {
      const stageId = randomBytes(16).toString('base64url').slice(0, 21)
      stageIds.push(stageId)

      db.prepare(`
        INSERT INTO team_run_stages (id, run_id, name, role_id, task, status, dependencies, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        stageId,
        runId,
        stage.name,
        stage.roleId,
        stage.task,
        JSON.stringify(stage.dependsOn || []),
        now,
        now
      )
    }

    return NextResponse.json({
      runId,
      status: 'pending',
      stages: stageIds.map((id, i) => ({
        id,
        name: stages[i].name,
        status: 'pending'
      }))
    })
  } catch (error) {
    console.error('Create run error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create run' } },
      { status: 500 }
    )
  }
}
```

---

### 5.2 启动 Run

**文件**: `src/app/api/team-run/runs/[runId]/start/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'

const orchestrators = new Map<string, TeamRunOrchestrator>()

function getOrchestrator(): TeamRunOrchestrator {
  const key = 'default'
  if (!orchestrators.has(key)) {
    const db = getDatabase()
    orchestrators.set(key, new TeamRunOrchestrator(db))
  }
  return orchestrators.get(key)!
}

export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const { runId } = params
    const db = getDatabase()

    const run = db.prepare('SELECT * FROM team_runs WHERE id = ?').get(runId)
    if (!run) {
      return NextResponse.json(
        { error: { code: 'RUN_NOT_FOUND', message: `Run ${runId} not found` } },
        { status: 404 }
      )
    }

    const orchestrator = getOrchestrator()
    await orchestrator.startRun(runId)

    return NextResponse.json({ runId, status: 'running' })
  } catch (error) {
    console.error('Start run error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to start run' } },
      { status: 500 }
    )
  }
}
```

---

### 5.3 获取状态

**文件**: `src/app/api/team-run/runs/[runId]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'

const orchestrators = new Map<string, TeamRunOrchestrator>()

function getOrchestrator(): TeamRunOrchestrator {
  const key = 'default'
  if (!orchestrators.has(key)) {
    const db = getDatabase()
    orchestrators.set(key, new TeamRunOrchestrator(db))
  }
  return orchestrators.get(key)!
}

export async function GET(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const { runId } = params
    const orchestrator = getOrchestrator()
    const status = await orchestrator.getStatus(runId)

    return NextResponse.json(status)
  } catch (error) {
    console.error('Get status error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to get status' } },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const { runId } = params
    const orchestrator = getOrchestrator()
    await orchestrator.cancelRun(runId)

    return NextResponse.json({ runId, status: 'cancelled' })
  } catch (error) {
    console.error('Cancel run error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel run' } },
      { status: 500 }
    )
  }
}
```

---

### 5.4 SSE 实时推送

**文件**: `src/app/api/team-run/runs/[runId]/stream/route.ts`

```typescript
import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params
  const db = getDatabase()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // 发送初始状态
      const run = db.prepare('SELECT * FROM team_runs WHERE id = ?').get(runId) as any
      if (!run) {
        controller.close()
        return
      }

      sendEvent('status', { runId, status: run.status })

      // 轮询状态变化
      const interval = setInterval(() => {
        const currentRun = db.prepare('SELECT * FROM team_runs WHERE id = ?').get(runId) as any
        const stages = db.prepare('SELECT * FROM team_run_stages WHERE run_id = ?').all(runId) as any[]

        sendEvent('progress', {
          total: stages.length,
          completed: stages.filter(s => s.status === 'done').length,
          failed: stages.filter(s => s.status === 'failed').length,
          running: stages.filter(s => s.status === 'running').length,
          blocked: stages.filter(s => s.status === 'blocked').length
        })

        if (currentRun.status === 'done' || currentRun.status === 'failed' || currentRun.status === 'cancelled') {
          sendEvent('complete', { runId, status: currentRun.status, completedAt: currentRun.completed_at })
          clearInterval(interval)
          controller.close()
        }
      }, 1000)

      req.signal.addEventListener('abort', () => {
        clearInterval(interval)
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
```

---

## 6. 前端集成示例

### 6.1 创建并启动 Run

```typescript
async function createAndStartRun(planId: string, stages: any[]) {
  // 创建 run
  const createRes = await fetch('/api/team-run/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, stages })
  })
  const { runId } = await createRes.json()

  // 启动 run
  await fetch(`/api/team-run/runs/${runId}/start`, { method: 'POST' })

  return runId
}
```

### 6.2 监听实时状态

```typescript
function subscribeToRun(runId: string, onUpdate: (event: any) => void) {
  const eventSource = new EventSource(`/api/team-run/runs/${runId}/stream`)

  eventSource.addEventListener('status', (e) => {
    onUpdate({ type: 'status', data: JSON.parse(e.data) })
  })

  eventSource.addEventListener('progress', (e) => {
    onUpdate({ type: 'progress', data: JSON.parse(e.data) })
  })

  eventSource.addEventListener('complete', (e) => {
    onUpdate({ type: 'complete', data: JSON.parse(e.data) })
    eventSource.close()
  })

  return () => eventSource.close()
}
```

---

## 7. 安全考虑

1. **输入验证**: 所有 API 输入必须验证（已在 StateManager 中实现 SQLValidator）
2. **权限控制**: 未来需添加用户认证和 Run 所有权验证
3. **资源限制**: 限制单个用户的并发 Run 数量
4. **错误信息**: 不暴露内部实现细节（已在 ErrorSanitizer 中实现）

---

## 8. 性能优化

1. **Orchestrator 单例**: 避免重复创建数据库连接
2. **SSE 轮询间隔**: 1秒间隔平衡实时性和性能
3. **大数据处理**: 超过 10KB 的输出存储到 artifacts 表
4. **连接管理**: SSE 连接在 Run 完成后自动关闭

---

## 9. 总结

本 API 设计遵循以下原则：
- **最小化**: 仅 5 个核心端点
- **RESTful**: 资源导向，语义清晰
- **实时性**: SSE 推送状态变化
- **健壮性**: 统一错误处理和安全验证

所有接口已与执行引擎完全对齐，可直接实现。
