# Lumos Main Agent/Team/Task 架构评估报告

**评估日期**: 2026-03-11
**评估范围**: Main Agent、Team、Task 功能模块
**总体评分**: 7.5/10

---

## 一、总体评价

Lumos 的 Main Agent/Team/Task 模块展现了清晰的分层架构和良好的类型安全设计。核心数据模型设计合理，API 层职责明确，但在扩展性、性能优化和错误处理方面存在改进空间。

---

## 二、优势列表

### 1. 类型系统设计优秀
- 完整的 TypeScript 类型定义（`src/types/index.ts`）
- 使用 discriminated unions（`TeamPlanRoleKind`、`TaskStatus`）
- 类型解析函数提供运行时校验（`parseTeamPlan`、`parseTeamRun`）

### 2. 数据模型清晰
- 明确的实体关系：Session → Task → TeamPlan → TeamRun
- 使用 JSON 序列化存储复杂结构（`TeamPlanTaskRecord`）
- 状态机设计合理（`TeamRunStatus`、`TaskStatus`）

### 3. API 设计符合 RESTful 规范
- 资源路由清晰：`/api/tasks`、`/api/tasks/[id]`、`/api/tasks/agents`
- HTTP 方法使用正确（GET/POST/PATCH/DELETE）
- 统一的响应格式（`TaskResponse`、`ErrorResponse`）

### 4. 职责分离良好
- API 层薄（仅处理 HTTP）
- 业务逻辑集中在 `lib/db/tasks.ts`
- 类型定义独立在 `types/index.ts`

---

## 三、问题清单（按严重程度排序）

### 🔴 严重问题

#### 1. 数据库层缺乏事务管理
**位置**: `src/lib/db/tasks.ts`
**问题**: 所有数据库操作都是独立执行，没有事务保护
```typescript
// 当前实现：多个独立操作
export function updateTeamRunPhase(taskId: string, update: {...}) {
  const task = getTask(taskId);  // 操作1
  // ... 修改数据
  db.prepare('UPDATE tasks SET ...').run(...);  // 操作2
}
```
**风险**:
- 并发更新导致数据不一致
- 部分更新失败导致状态错乱
- TeamRun 状态与 Phase 状态不同步

#### 2. 缺少数据库索引
**位置**: 数据库 schema（未在代码中体现）
**问题**:
- `tasks` 表的 `session_id` 字段无索引
- 频繁的 `WHERE session_id = ?` 查询会全表扫描
**影响**:
- 当 session 有大量 tasks 时性能下降
- `getTasksBySession` 查询变慢

#### 3. JSON 序列化存储的查询限制
**位置**: `src/lib/db/tasks.ts` - `getMainAgentCatalog`
**问题**:
- `TeamPlan`、`TeamRun` 存储在 `description` 字段的 JSON 中
- 无法通过 SQL 直接查询 TeamRun 状态
- 必须反序列化所有记录才能过滤
```typescript
// 当前实现：必须加载所有 tasks 并解析
const allTasks = db.prepare('SELECT * FROM tasks').all();
const teamTasks = allTasks.filter(t => parseTeamPlanTaskRecord(t.description));
```

### 🟡 中等问题

#### 4. API 路由缺少输入验证
**位置**: `src/app/api/tasks/[id]/route.ts`
**问题**:
- 直接信任客户端输入
- 没有验证 `phaseId`、`phaseStatus` 的有效性
```typescript
// 当前实现：无验证
const updated = body.phaseId
  ? updateTeamRunPhase(id, {
      phaseId: body.phaseId,  // 未验证是否存在
      phaseStatus: body.phaseStatus,  // 未验证枚举值
    })
```
**建议**: 使用 Zod 或 Yup 进行 schema 验证

#### 5. 错误处理过于简单
**位置**: 所有 API 路由
**问题**:
- 统一返回 500 错误
- 错误信息直接暴露给客户端
- 没有区分业务错误和系统错误
```typescript
catch (error) {
  return NextResponse.json<ErrorResponse>(
    { error: error instanceof Error ? error.message : 'Failed...' },
    { status: 500 }  // 所有错误都是 500
  );
}
```

#### 6. 缺少分页机制
**位置**: `src/app/api/tasks/catalog/route.ts`
**问题**:
- `getMainAgentCatalog` 返回所有 teams/tasks
- 当数据量大时会导致响应过大
- 前端渲染性能问题

#### 7. 类型解析函数性能问题
**位置**: `src/types/index.ts` - `parseTeamPlan`
**问题**:
- 每次查询都要重新解析 JSON
- 没有缓存机制
- 大量的字符串 trim 操作

### 🟢 轻微问题

#### 8. 代码重复
**位置**: `src/app/api/tasks/agents/route.ts` 和 `team-templates/route.ts`
**问题**:
- 两个文件结构几乎完全相同
- 错误处理逻辑重复
**建议**: 提取通用的 API handler 工厂函数

#### 9. 魔法字符串
**位置**: `src/lib/db/tasks.ts`
**问题**:
- SQL 查询中的字段名是字符串字面量
- 容易拼写错误且难以重构
```typescript
db.prepare('SELECT id, session_id, title, status FROM tasks WHERE ...')
```

#### 10. 缺少日志记录
**位置**: 所有业务逻辑
**问题**:
- 没有操作日志
- 难以追踪 TeamRun 状态变化
- 调试困难

---

## 四、改进建议

### 1. 引入事务管理（高优先级）
```typescript
// 建议实现
export function updateTeamRunPhase(taskId: string, update: {...}) {
  const db = getDb();
  const transaction = db.transaction(() => {
    const task = getTask(taskId);
    // ... 所有更新操作
  });
  transaction();
}
```

### 2. 添加数据库索引（高优先级）
```sql
CREATE INDEX idx_tasks_session_id ON tasks(session_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);
```

### 3. 重构数据模型（中优先级）
**方案 A**: 将 TeamRun 状态提升到 tasks 表
```sql
ALTER TABLE tasks ADD COLUMN team_run_status TEXT;
ALTER TABLE tasks ADD COLUMN team_run_current_phase TEXT;
```

**方案 B**: 创建独立的 team_runs 表
```sql
CREATE TABLE team_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  status TEXT NOT NULL,
  current_phase_id TEXT,
  ...
);
```

### 4. 添加输入验证中间件（中优先级）
```typescript
// lib/api/validation.ts
import { z } from 'zod';

export const UpdateTaskSchema = z.object({
  phaseId: z.string().optional(),
  phaseStatus: z.enum(['pending', 'ready', 'running', ...]).optional(),
  ...
});

// 在 API 路由中使用
const body = UpdateTaskSchema.parse(await request.json());
```

### 5. 实现分页和过滤（中优先级）
```typescript
// API: GET /api/tasks/catalog?page=1&limit=20&status=running
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const status = searchParams.get('status');

  const catalog = getMainAgentCatalog({ page, limit, status });
  return NextResponse.json(catalog);
}
```

### 6. 添加缓存层（低优先级）
```typescript
// lib/cache/task-cache.ts
const taskCache = new Map<string, { data: TaskItem; expiry: number }>();

export function getCachedTask(id: string): TaskItem | null {
  const cached = taskCache.get(id);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  return null;
}
```

### 7. 统一错误处理（中优先级）
```typescript
// lib/api/errors.ts
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
  }
}

// 在 API 中使用
catch (error) {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  // 系统错误不暴露细节
  console.error(error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

### 8. 添加操作日志（低优先级）
```typescript
// lib/audit/logger.ts
export function logTaskUpdate(taskId: string, changes: Partial<TaskItem>) {
  const log = {
    timestamp: new Date().toISOString(),
    taskId,
    action: 'update',
    changes,
  };
  // 写入日志表或文件
}
```

---

## 五、扩展性评估

### 当前架构支持的扩展
✅ 添加新的 Agent Preset
✅ 添加新的 Team Template
✅ 扩展 TeamRun 状态机
✅ 添加新的 API 端点

### 当前架构难以支持的扩展
❌ 多租户隔离（缺少 tenant_id）
❌ 实时协作（缺少 WebSocket 支持）
❌ 任务优先级队列（缺少调度器）
❌ 跨 Session 的 Team 共享（Session 强绑定）

---

## 六、性能考虑

### 潜在瓶颈
1. **数据库查询**: `getMainAgentCatalog` 需要全表扫描并解析 JSON
2. **JSON 序列化**: 每次读取 Task 都要解析 `description` 字段
3. **无缓存**: 重复查询相同数据
4. **N+1 查询**: `getMainAgentCatalog` 中多次查询 sessions

### 优化建议
- 为高频查询添加物化视图
- 使用 Redis 缓存热点数据
- 批量查询替代循环查询
- 考虑使用 PostgreSQL 的 JSONB 类型（支持索引）

---

## 七、总结

Lumos 的 Main Agent/Team/Task 模块具有坚实的基础架构，类型系统和 API 设计都很优秀。主要问题集中在数据库层的事务管理、索引优化和错误处理。建议优先解决事务管理和索引问题，然后逐步完善输入验证和错误处理机制。

**立即行动项**:
1. 为 `tasks.session_id` 添加索引
2. 在 `updateTeamRunPhase` 等关键操作中引入事务
3. 添加 Zod schema 验证

**短期改进**:
4. 实现统一的错误处理机制
5. 为 catalog API 添加分页
6. 提取重复的 API handler 代码

**长期规划**:
7. 考虑将 TeamRun 独立为表
8. 引入缓存层
9. 添加操作审计日志
