# Task Management Layer 设计文档

## 1. 模块定位

任务状态管理中心，轻量级汇报层。

**职责**：
- 任务注册和状态管理
- 提供查询接口
- 协调 Main Agent 和 Scheduling Layer

**不负责**：
- 任务编排和拆解
- 任务执行
- 资源分配

## 2. 架构分层

```
Main Agent (LLM)
  ↓ 调用 Skill
Skill Layer (适配层)
  ↓ 调用 API
Task Management (独立模块)
  ↓ 数据库
Database
```

## 3. 数据结构

### Task - 任务对象

```typescript
interface Task {
  // 基本信息
  id: string;                    // 任务ID，唯一标识
  sessionId: string;             // 关联的会话ID

  // 任务内容
  summary: string;               // 任务摘要（Main Agent 总结）
  requirements: string[];        // 具体要求列表

  // 状态信息
  status: TaskStatus;            // 当前状态
  progress?: number;             // 进度百分比 0-100

  // 时间信息
  createdAt: Date;               // 创建时间
  startedAt?: Date;              // 开始执行时间
  completedAt?: Date;            // 完成时间
  estimatedDuration?: number;    // 预计耗时（秒）

  // 结果信息
  result?: TaskResult;           // 任务结果
  errors?: TaskError[];          // 错误列表

  // 元数据
  metadata?: Record<string, any>;
}
```

### TaskStatus - 任务状态

```typescript
enum TaskStatus {
  PENDING = 'pending',       // 待处理
  RUNNING = 'running',       // 执行中
  COMPLETED = 'completed',   // 已完成
  FAILED = 'failed',         // 失败
  CANCELLED = 'cancelled'    // 已取消
}
```

## 4. API 接口规范

### 4.1 对 Main Agent 提供的接口（通过 Skill 调用）

#### createTask - 创建任务

**接口说明**：接收 Main Agent 的任务创建请求，构造任务对象并注册到系统。

**请求参数**：
```typescript
interface CreateTaskRequest {
  taskSummary: string;           // 必填，任务摘要（Main Agent 总结后的内容）
  requirements: string[];        // 必填，具体要求列表
  context: {
    sessionId: string;           // 必填，会话ID
    relevantMessages?: string[]; // 可选，相关对话片段
  }
}
```

**返回结果**：
```typescript
interface CreateTaskResponse {
  taskId: string;                // 任务ID
  status: 'pending';             // 初始状态
  createdAt: string;             // 创建时间（ISO 8601）
}
```

**错误码**：
- `400` - 参数验证失败（taskSummary 包含第一人称等）
- `500` - 服务器内部错误

**示例**：
```typescript
// 请求
{
  taskSummary: "关于AI在医疗领域应用的调研报告",
  requirements: ["重点关注医疗领域", "包含案例分析"],
  context: {
    sessionId: "session_123"
  }
}

// 响应
{
  taskId: "task_456",
  status: "pending",
  createdAt: "2026-03-16T07:16:56.775Z"
}
```

---

#### listTasks - 查询任务列表

**接口说明**：查询任务列表，支持按状态和会话过滤。

**请求参数**：
```typescript
interface ListTasksRequest {
  sessionId?: string;            // 可选，按会话ID过滤
  status?: TaskStatus[];         // 可选，按状态过滤（可多选）
  limit?: number;                // 可选，返回数量限制，默认20，最大100
  offset?: number;               // 可选，分页偏移，默认0
}
```

**返回结果**：
```typescript
interface ListTasksResponse {
  tasks: TaskSummary[];          // 任务摘要列表
  total: number;                 // 总数量
}

interface TaskSummary {
  id: string;                    // 任务ID
  summary: string;               // 任务摘要
  status: TaskStatus;            // 当前状态
  progress?: number;             // 进度
  createdAt: string;             // 创建时间
}
```

**错误码**：
- `400` - 参数验证失败
- `500` - 服务器内部错误

**示例**：
```typescript
// 请求：查询未完成的任务
{
  sessionId: "session_123",
  status: ["pending", "running"]
}

// 响应
{
  tasks: [
    {
      id: "task_456",
      summary: "关于AI在医疗领域应用的调研报告",
      status: "running",
      progress: 30,
      createdAt: "2026-03-16T07:16:56.775Z"
    }
  ],
  total: 1
}
```

---

#### getTaskDetail - 获取任务详情

**接口说明**：获取任务的完整信息。

**请求参数**：
```typescript
interface GetTaskDetailRequest {
  taskId: string;                // 必填，任务ID
}
```

**返回结果**：
```typescript
interface GetTaskDetailResponse {
  task: Task;                    // 完整的任务对象
}
```

**错误码**：
- `404` - 任务不存在
- `500` - 服务器内部错误

---

#### cancelTask - 取消任务

**接口说明**：取消正在执行或待执行的任务。

**请求参数**：
```typescript
interface CancelTaskRequest {
  taskId: string;                // 必填，任务ID
  reason?: string;               // 可选，取消原因
}
```

**返回结果**：
```typescript
interface CancelTaskResponse {
  success: boolean;              // 是否成功
  message?: string;              // 说明信息
}
```

**错误码**：
- `404` - 任务不存在
- `400` - 任务已完成，无法取消
- `500` - 服务器内部错误

---

### 4.2 对 Scheduling Layer 提供的接口

#### submitTask - 提交任务

**接口说明**：将新创建的任务提交给 Scheduling Layer 进行编排和执行。

**请求参数**：
```typescript
interface SubmitTaskRequest {
  taskId: string;                // 必填，任务ID
  task: Task;                    // 必填，完整任务对象
}
```

**返回结果**：
```typescript
interface SubmitTaskResponse {
  accepted: boolean;             // 是否接受任务
  message?: string;              // 说明信息
}
```

**错误码**：
- `400` - 任务格式不正确
- `503` - Scheduling Layer 不可用
- `500` - 服务器内部错误

---

#### updateTaskStatus - 更新任务状态

**接口说明**：接收 Scheduling Layer 的状态更新通知。

**请求参数**：
```typescript
interface UpdateTaskStatusRequest {
  taskId: string;                // 必填，任务ID
  status: TaskStatus;            // 必填，新状态
  progress?: number;             // 可选，进度 0-100
  result?: any;                  // 可选，任务结果（status=completed时）
  errors?: TaskError[];          // 可选，错误列表（status=failed时）
  metadata?: Record<string, any>; // 可选，额外元数据
}

interface TaskError {
  code: string;                  // 错误码
  message: string;               // 错误信息
  details?: any;                 // 错误详情
}
```

**返回结果**：
```typescript
interface UpdateTaskStatusResponse {
  success: boolean;              // 是否成功
}
```

**错误码**：
- `404` - 任务不存在
- `400` - 状态转换不合法
- `500` - 服务器内部错误

**状态转换规则**：
- `pending` → `running` / `cancelled`
- `running` → `completed` / `failed` / `cancelled`
- `completed` / `failed` / `cancelled` → 终态，不可再转换

