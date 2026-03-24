# Scheduling Layer 设计文档

## 1. 模块定位

任务执行管理层，扮演**项目经理**角色。

**核心定位**：LLM Agent，负责任务分析和工作流生成。

**职责**：

- 任务分析和理解
- 策略决策（简单执行 vs 工作流编排）
- 工作流生成（通过 LLM）
- 执行监控和进度跟踪
- 结果汇总和状态同步

**不负责**：

- 任务状态存储（由 Task Management 负责）
- 工作流执行（由 Workflow Engine Layer 负责）
- 实际工作（由 SubAgent Layer 负责）
- 用户交互（由 Main Agent 负责）

## 2. 核心职责

### 2.1 任务分析

接收任务后，通过 LLM 分析任务特征和复杂度。

**分析维度**：

- 任务复杂度（简单 vs 复杂）
- 是否需要多步骤
- 是否需要并行执行
- 预估执行时间

**示例**：

```
任务："关于AI在医疗领域应用的调研报告"

LLM 分析结果：
- 复杂度：中等
- 需要多步骤：是（搜索 → 分析 → 撰写）
- 可并行：部分可并行（多个搜索任务）
- 预估时间：10-15分钟
- 建议：使用工作流编排
```

### 2.2 策略决策

根据分析结果，决定执行策略。

**决策选项**：

1. **简单执行**：直接创建单个 SubAgent
2. **工作流编排**：生成工作流，交给 Workflow Engine 执行

**决策依据**：

- 单步任务 → 简单执行
- 多步任务 → 工作流编排
- 需要并行 → 工作流编排
- 需要条件分支 → 工作流编排

### 2.3 工作流生成

**采用受限 DSL + 编译方案**

**核心思路**：
1. LLM 只生成受限的 `Workflow DSL v1` 结构化描述
2. MCP Server 校验 DSL，并将其编译为 workflow factory module 代码
3. Workflow Engine 只执行编译产物，不直接执行任意 LLM 生成代码

**设计原则**：
- 限制的是执行语义，不是业务场景
- 控制流原语保持少量稳定：顺序、并行、条件
- 业务扩展主要通过新增 `step type` 完成，而不是开放任意脚本
- Scheduling Layer 面向 DSL 规划，Workflow Engine 面向编译产物执行

**Workflow DSL v1（最小形态）**：

```typescript
type StepType =
  | 'agent'
  | 'browser'
  | 'notification';

interface WorkflowDSL {
  version: 'v1';
  name: string;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;
  type: StepType;
  dependsOn?: string[];
  when?: ConditionExpr;
  input?: Record<string, unknown>;
  policy?: {
    timeoutMs?: number;
    retry?: {
      maximumAttempts?: number;
    };
  };
}

type ConditionExpr =
  | { op: 'exists'; ref: string }
  | { op: 'eq'; left: string; right: unknown }
  | { op: 'neq'; left: string; right: unknown };
```

**边界说明**：
- DSL 允许引用 `input.xxx` 和 `steps.<stepId>.output`
- 编译器必须为每个 `stepId` 生成稳定结果绑定；即使在并行层，也不能退化成仅可位置访问的匿名数组
- DSL 不允许任意 TypeScript、`import`、自定义函数、循环、内联副作用脚本
- `step type` 由平台注册，LLM 只能从已注册能力中选择
- `Workflow DSL v1` 当前仅开放 `agent / browser / notification`
- 后续如新增 `http / data / knowledge_search` 等步骤类型，通过扩展 Step Registry 引入；不改变 `v1` 控制流语义
- `Workflow DSL v1` 暂不支持循环；如确有需要，后续通过 `v2` 扩展

**生成流程**：

```typescript
type WorkflowGenerationResult =
  | {
      mode: 'workflow';
      workflowDsl: WorkflowDSL;
      workflowCode: string;
      workflowManifest: GenerateWorkflowManifest;
    }
  | {
      mode: 'simple';
      reason: string;
    };

// Scheduling Layer 通过 MCP 生成工作流（含错误处理）
async function generateWorkflow(task: Task): Promise<WorkflowGenerationResult> {
  const MAX_RETRIES = 2;
  const LLM_TIMEOUT = 30000; // 30秒
  const MCP_TIMEOUT = 10000; // 10秒

  let workflowDsl: WorkflowDSL;

  // 步骤 1: LLM 分析任务，生成受限 DSL
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      workflowDsl = await Promise.race([
        this.llm.analyze({
          system: `分析任务，生成 Workflow DSL v1。

	输出格式：
	{
	  version: 'v1',
	  name: string,
	  steps: [
	    {
	      id: string,
	      type: 'agent' | 'browser' | 'notification',
	      dependsOn?: string[],
	      when?: ConditionExpr,
	      input?: { ... },
	      policy?: { timeoutMs?: number, retry?: { maximumAttempts?: number } }
	    }
  ]
}

	可用步骤类型：
	- agent: AI Agent 调用，input: { prompt: string, role?: string }
	- browser: 浏览器操作，input: { action: 'navigate'|'click'|'fill'|'screenshot', url?: string, selector?: string }
	- notification: 发送通知，input: { message: string, channel?: string }

	注意：
	- id 必须唯一
	- 只能引用 input 和已定义步骤输出
	- 不允许生成任意 TypeScript/JavaScript 代码
- 如任务过于简单，可只生成 1 个 agent 步骤`,
          user: `任务：${task.summary}\n要求：${task.requirements.join(', ')}`
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT)
        )
      ]);

      // 验证 DSL
      validateWorkflowDsl(workflowDsl);
      break;

    } catch (error) {
      if (attempt === MAX_RETRIES) {
        // 降级策略 1: 使用简单 DSL 模板
        console.warn('LLM 分析失败，降级到简单 DSL 模板');
        return await fallbackToSimpleTemplate(task);
      }
      console.warn(`LLM 分析失败 (尝试 ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
      await sleep(1000 * (attempt + 1)); // 指数退避
    }
  }

  // 步骤 2: 调用 MCP 校验并编译 DSL
  try {
    const result = await Promise.race([
      mcp.call('generate_workflow', {
        spec: workflowDsl
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MCP timeout')), MCP_TIMEOUT)
      )
    ]);

    // 验证生成的代码
    if (!result.validation.valid) {
      throw new Error(`代码验证失败: ${result.validation.errors.join(', ')}`);
    }

    return {
      mode: 'workflow',
      workflowDsl,
      workflowCode: result.code,
      workflowManifest: result.manifest
    };

  } catch (error) {
    console.error('MCP 生成失败:', error);
    // 降级策略 2: 直接创建 SubAgent（简单执行）
    return await fallbackToSimpleExecution(task);
  }
}

// 验证 DSL
function validateWorkflowDsl(spec: WorkflowDSL): void {
  if (spec.version !== 'v1' || !spec.name || !spec.steps) {
    throw new Error('缺少必填字段');
  }

  if (spec.steps.length < 1 || spec.steps.length > 20) {
    throw new Error('步骤数量必须在 1-20 之间');
  }

  const stepIds = spec.steps.map(step => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    throw new Error('步骤 ID 必须唯一');
  }

  for (const step of spec.steps) {
    if (!SUPPORTED_STEP_TYPES.includes(step.type)) {
      throw new Error(`不支持的步骤类型: ${step.type}`);
    }
  }

  validateDag(spec.steps);
  validateReferences(spec);
}
```

**降级策略实现**：

```typescript
// 降级策略 1: 使用简单 DSL 模板
async function fallbackToSimpleTemplate(task: Task): Promise<WorkflowGenerationResult> {
  console.log('使用简单 DSL 模板');

  const fallbackDsl: WorkflowDSL = {
    version: 'v1',
    name: sanitizeWorkflowName(task.summary),
    steps: [
      {
        id: 'execute',
        type: 'agent',
        input: {
          prompt: task.summary
        }
      }
    ]
  };

  const result = await mcp.call('generate_workflow', {
    spec: fallbackDsl
  });

  return {
    mode: 'workflow',
    workflowDsl: fallbackDsl,
    workflowCode: result.code,
    workflowManifest: result.manifest
  };
}

// 降级策略 2: 直接创建 SubAgent（简单执行）
async function fallbackToSimpleExecution(task: Task): Promise<WorkflowGenerationResult> {
  console.log('降级到简单执行模式');

  // 通知 Task Management 切换到简单执行
  await taskManagement.updateTaskStatus(task.id, {
    status: 'running',
    strategy: 'simple',
    message: '工作流生成失败，已切换到简单执行模式'
  });

  // 直接创建 SubAgent
  const agent = await subAgentLayer.createAgent({
    role: 'general',
    task: task.summary
  });

  return {
    mode: 'simple',
    reason: '工作流生成失败，已切换到简单执行模式'
  };
}
```

**MCP Server 内部逻辑**：

```typescript
interface GenerateWorkflowManifest {
  dslVersion: 'v1';
  artifactKind: 'workflow-factory-module';
  exportedSymbol: 'buildWorkflow';
  workflowName: string;
  workflowVersion: string;
  stepTypes: string[];
  warnings: string[];
}

interface GenerateWorkflowResult {
  code: string;
  manifest: GenerateWorkflowManifest;
  validation: {
    valid: boolean;
    errors: string[];
  };
}

// MCP Server 的 generate_workflow 工具
async function generateWorkflow(input: { spec: WorkflowDSL }): Promise<GenerateWorkflowResult> {
  validateWorkflowDsl(input.spec);
  const code = compileWorkflowDsl(input.spec);

  return {
    code,
    manifest: {
      dslVersion: 'v1',
      artifactKind: 'workflow-factory-module',
      exportedSymbol: 'buildWorkflow',
      workflowName: input.spec.name,
      workflowVersion: createWorkflowVersion(input.spec),
      stepTypes: input.spec.steps.map(step => step.type),
      warnings: []
    },
    validation: {
      valid: true,
      errors: []
    }
  };
}
```

**优势**：
- ✅ 语法 100% 正确（编译器保证）
- ✅ 业务灵活（LLM 仍然可自由组合步骤）
- ✅ MCP Tool Schema 约束输入格式
- ✅ 易于验证和调试
- ✅ 覆盖 80%+ 场景
- ✅ 可扩展性通过新增 `step type` 获得，而不是开放任意代码

### 2.3.1 任务拆解质量保证

**核心问题**：工作流质量取决于 Scheduling Agent 的任务拆解质量。

**质量保证机制**：

**1. Tool Schema 约束**

通过 MCP Tool Schema 强制约束 LLM 输出 DSL：

```typescript
{
  name: 'generate_workflow',
  inputSchema: {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        properties: {
          version: { const: 'v1' },
          name: { type: 'string', minLength: 1 },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$' },
	                type: {
	                  type: 'string',
	                  enum: ['agent', 'browser', 'notification']
	                },
                dependsOn: {
                  type: 'array',
                  items: { type: 'string' }
                },
                when: { type: 'object' },
                input: { type: 'object' },
                policy: {
                  type: 'object',
                  properties: {
                    timeoutMs: { type: 'number', minimum: 1 },
                    retry: {
                      type: 'object',
                      properties: {
                        maximumAttempts: { type: 'number', minimum: 1 }
                      }
                    }
                  }
                }
              },
              required: ['id', 'type']
            }
          }
        }
      }
    },
    required: ['spec']
  }
}
```

**2. System Prompt 优化**

在 Scheduling Agent 的 System Prompt 中明确拆解原则：

```markdown
# 任务拆解原则

1. **单一职责**：每个步骤只做一件事
2. **合理粒度**：1-20 个步骤
3. **明确依赖**：用 `dependsOn` 和 `when` 表达顺序/并行/条件分支
4. **选择正确的步骤类型**：
   - agent: AI 分析、生成内容
   - browser: 网页操作、数据采集
   - notification: 发送通知
5. **禁止任意代码**：不要生成 TypeScript、函数体、脚本字符串

# 输出示例

✅ 正确示例：
{
  "version": "v1",
  "name": "research-report",
  "steps": [
    { "id": "search", "type": "agent", "input": { "prompt": "搜索资料" } },
    { "id": "analyze", "type": "agent", "dependsOn": ["search"], "input": { "prompt": "分析资料" } },
    { "id": "notify", "type": "notification", "dependsOn": ["analyze"], "input": { "message": "完成" } }
  ]
}
```

**3. 编译器与注册表设计**

MCP Server 提供：
- 受限 DSL 校验器
- Step Registry（步骤类型注册表）
- 编译器（将 DSL 转为 OpenWorkflow 模块）

**Step Registry（Phase 1）**：
- `agent` - AI Agent 调用
- `browser` - 浏览器操作
- `notification` - 发送通知

**Step Registry（Phase 2 候选扩展）**：
- `http` - HTTP 请求
- `data` - 数据处理
- `knowledge_search` - 知识库检索

**质量保证**：
- Tool Schema 强制约束输入格式（1-20 步骤）
- Step Registry 控制可用能力边界
- 编译器保证语法 100% 正确
- TypeScript 编译器验证生成代码


**控制流能力（DSL v1）**：
- **顺序工作流**：通过 `dependsOn` 串联
- **并行工作流**：多个步骤共享同一依赖层
- **条件工作流**：通过 `when` 表达式控制是否执行
- **子工作流**：`v1` 不支持；若后续引入，需要单独设计取消、隔离和可观测语义
- **循环工作流**：`v1` 不支持

### 2.4 执行监控

监控工作流执行状态，跟踪进度。

**监控内容**：

- 当前执行的步骤
- 已完成的步骤
- 失败的步骤
- 整体进度百分比

**进度计算**：

```typescript
progress = (completedSteps.length / totalSteps) × 100
```

### 2.5 结果汇总

工作流执行完成后，汇总结果。

**汇总内容**：

- 各节点的输出
- 最终结果
- 执行时间
- 错误信息（如有）

## 3. 数据结构

### WorkflowDefinition - 工作流定义

```typescript
interface WorkflowDefinition {
  id: string;                    // 工作流ID
  name: string;                  // 工作流名称
  version: string;               // 版本号
  code: string;                  // MCP 编译后的 workflow factory module 代码
  createdBy: 'llm' | 'user';     // 创建方式
  createdAt: Date;
}
```

### ExecutionContext - 执行上下文

```typescript
interface ExecutionContext {
  taskId: string;                // 任务ID
  workflowId: string;            // 工作流执行ID
  status: ExecutionStatus;       // 执行状态

  // 进度
  progress: number;              // 0-100
  currentStep?: string;          // 当前执行的步骤
  completedSteps: string[];      // 已完成的步骤

  // 时间
  startedAt: Date;
  completedAt?: Date;
}

enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled'
}
```

## 4. API 接口规范

### 4.1 对上游（Task Management）提供的接口

#### acceptTask - 接收任务

**接口说明**：接收 Task Management 提交的任务，分析并决定执行策略。

**请求参数**：

```typescript
interface AcceptTaskRequest {
  taskId: string;                // 必填，任务ID
  task: Task;                    // 必填，完整任务对象
}
```

**返回结果**：

```typescript
interface AcceptTaskResponse {
  accepted: boolean;             // 是否接受
  strategy: 'simple' | 'workflow'; // 执行策略
  workflowId?: string;           // 工作流ID（如果使用工作流）
  estimatedDuration?: number;    // 预计耗时（秒）
}
```

**错误码**：

- `400` - 任务格式不正确
- `503` - 资源不足，无法接受任务
- `500` - 服务器内部错误

---

#### cancelTask - 取消任务

**接口说明**：取消正在执行的任务。

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

---

### 4.2 对下游（Workflow Engine）的调用接口

#### submitWorkflow - 提交工作流

**接口说明**：将生成的工作流代码提交给 Workflow Engine 执行。

**请求参数**：

```typescript
interface SubmitWorkflowRequest {
  taskId: string;                // 任务ID
  workflowCode: string;          // MCP 编译后的 workflow factory module 代码
  workflowManifest: GenerateWorkflowManifest; // 编译产物元数据，用于执行前校验
  inputs: Record<string, any>;   // 输入参数
}
```

**返回结果**：

```typescript
interface SubmitWorkflowResponse {
  workflowId: string;            // 工作流执行ID
  status: 'accepted' | 'rejected';
}
```

---

#### getWorkflowStatus - 查询工作流状态

**接口说明**：查询工作流执行状态。

**请求参数**：

```typescript
interface GetWorkflowStatusRequest {
  workflowId: string;            // 工作流ID
}
```

**返回结果**：

```typescript
interface GetWorkflowStatusResponse {
  status: ExecutionStatus;       // 执行状态
  progress: number;              // 进度 0-100
  currentStep?: string;          // 当前执行的步骤
  completedSteps: string[];      // 已完成的步骤
}
```

---

#### cancelWorkflow - 取消工作流

**接口说明**：取消正在执行的工作流。

**请求参数**：

```typescript
interface CancelWorkflowRequest {
  workflowId: string;            // 工作流ID
}
```

**返回结果**：

```typescript
interface CancelWorkflowResponse {
  success: boolean;
}
```

### 4.3 回调上游（Task Management）的接口

Scheduling Layer 通过调用 Task Management 的 `updateTaskStatus` 接口来同步状态。

**调用时机**：

- 任务开始执行时（status: running）
- 进度更新时（progress: 0-100）
- 任务完成时（status: completed, result）
- 任务失败时（status: failed, errors）

---

### 4.4 接收下游（Workflow Engine）的回调

#### onWorkflowProgress - 工作流进度回调

**接口说明**：Workflow Engine 基于自身维护的执行投影定期上报进度。该回调不是 OpenWorkflow 原生事件流。

**请求参数**：

```typescript
interface WorkflowProgressEvent {
  workflowId: string;            // 工作流ID
  taskId: string;                // 任务ID
  progress: number;              // 进度 0-100
  currentStep?: string;          // 当前执行的步骤
  completedSteps: string[];      // 已完成的步骤
}
```

---

#### onWorkflowCompleted - 工作流完成回调

**接口说明**：Workflow Engine 完成工作流后的回调。

**请求参数**：

```typescript
interface WorkflowCompletedEvent {
  workflowId: string;            // 工作流ID
  taskId: string;                // 任务ID
  result: any;                   // 执行结果
  duration: number;              // 实际耗时（毫秒）
}
```

---

#### onWorkflowFailed - 工作流失败回调

**接口说明**：Workflow Engine 执行失败后的回调。

**请求参数**：

```typescript
interface WorkflowFailedEvent {
  workflowId: string;            // 工作流ID
  taskId: string;                // 任务ID
  error: {
    code: string;
    message: string;
    stepName?: string;           // 失败的步骤
  };
}
```

## 5. 错误处理和降级策略

### 5.1 错误分类

**LLM 分析错误**：
- 超时（>30秒）
- 返回格式错误
- 缺少必填字段
- 步骤数量不合理

**MCP 生成错误**：
- 超时（>10秒）
- 代码验证失败
- 模板不存在
- 参数格式错误

**工作流执行错误**：
- 由 Workflow Engine 处理（见 05 文档）

### 5.2 降级策略

**策略 1：重试（LLM 分析失败）**
- 触发条件：LLM 超时或返回格式错误
- 重试次数：最多 2 次
- 退避策略：指数退避（1s, 2s）
- 失败后：降级到策略 2

**策略 2：简单模板（LLM 多次失败）**
- 触发条件：LLM 重试 2 次后仍失败
- 行为：生成单步 agent 工作流
- 通知用户：工作流已简化

**策略 3：简单执行（MCP 生成失败）**
- 触发条件：MCP 调用失败或代码验证失败
- 行为：跳过工作流，直接创建 SubAgent
- 通知用户：已切换到简单执行模式

**策略 4：人工介入（所有策略失败）**
- 触发条件：所有自动降级失败
- 行为：标记任务为 failed，通知用户
- 用户选项：重试或手动处理

### 5.3 错误通知

所有降级都通过 `updateTaskStatus` 通知 Task Management：

```typescript
await taskManagement.updateTaskStatus(taskId, {
  status: 'running',
  strategy: 'fallback',
  message: '工作流生成失败，已降级到简单模板'
});
```

## 6. 核心流程

### 6.1 任务接收和分析流程

```
Task Management 调用 acceptTask
  ↓
Scheduling Layer 接收任务
  ↓
调用 LLM 分析任务
  ↓
判断执行策略
  ↓
├─ 简单执行 → 直接创建 SubAgent
└─ 工作流编排 → 生成工作流定义
  ↓
返回接受确认
  ↓
调用 Task Management 的 updateTaskStatus
  (status: running, progress: 0)
```

### 6.2 工作流生成流程

```
Scheduling Layer 决定使用工作流
  ↓
构造 LLM Prompt
  ↓
调用 LLM 生成工作流定义
  ↓
验证工作流定义
  ↓
保存工作流（可选）
  ↓
提交给 Workflow Engine
  (调用 submitWorkflow)
  ↓
等待执行结果
```

### 6.3 进度同步流程

```
Workflow Engine 调用 onWorkflowProgress
  ↓
Scheduling Layer 接收进度更新
  ↓
计算总进度
  ↓
调用 Task Management 的 updateTaskStatus
  (progress: totalProgress)
```

### 6.4 任务取消流程

```
Task Management 调用 cancelTask
  ↓
Scheduling Layer 接收取消请求
  ↓
调用 Workflow Engine 的 cancelWorkflow
  ↓
等待工作流终止
  ↓
调用 Task Management 的 updateTaskStatus
  (status: canceled)
```

## 7. 与其他层的交互

### 7.1 与 Task Management 的交互

```
Task Management
  ↓ submitTask (通过 acceptTask 接口)
Scheduling Layer
  ↓ 分析任务，生成工作流
  ↓ updateTaskStatus (回调)
Task Management
  ↓ 更新数据库
  ↓ 触发 Main Agent 通知用户
```

**交互特点**：

- Task Management 主动提交任务
- Scheduling Layer 被动接收，主动回调状态
- 异步执行，通过回调同步状态

### 7.2 与 Workflow Engine 的交互

```
Scheduling Layer
  ↓ submitWorkflow (提交工作流)
Workflow Engine
  ↓ 执行工作流
  ↓ onWorkflowProgress (回调进度)
Scheduling Layer
  ↓ 同步进度到 Task Management
  ↓
Workflow Engine
  ↓ onWorkflowCompleted (回调结果)
Scheduling Layer
  ↓ 汇总结果，上报完成
```

**交互特点**：

- Scheduling Layer 主动提交工作流
- Workflow Engine 被动执行，主动回调进度和结果
- 工作流执行由 Workflow Engine 全权负责

## 8. 设计总结

### 核心要点

1. **Scheduling Layer = LLM Agent**
   - 本质是 LLM 驱动的智能代理
   - 通过 LLM 分析任务并生成工作流

2. **核心职责 = 分析和决策**
   - 任务分析：理解任务复杂度和需求
   - 策略决策：选择简单执行或工作流编排
   - 工作流生成：通过 LLM 生成工作流定义
   - 执行监控：跟踪进度，汇总结果

3. **交互方式 = API + 回调**
   - 对上游：提供 acceptTask / cancelTask 接口
   - 对下游：调用 submitWorkflow / getWorkflowStatus / cancelWorkflow
   - 状态同步：通过回调 updateTaskStatus 上报状态

4. **工作流驱动 + LLM 生成**
   - 工作流由 LLM 动态生成，不是预定义模板
   - 工作流执行由 Workflow Engine 负责
   - Scheduling Layer 只负责生成和监控

### 与其他层的关系

```
Main Agent (对话决策)
  ↓ 创建任务
Task Management (状态管理)
  ↓ 提交任务
Scheduling Layer (分析决策、工作流生成) ← 本文档
  ↓ 提交工作流
Workflow Engine (工作流执行)
  ↓ 调用资源
SubAgent Layer (实际执行)
```

Scheduling Layer 是任务执行的**大脑**，负责分析和决策，但不负责实际执行。

### 设计优势

1. **灵活性**：LLM 动态生成工作流，适应各种任务
2. **可扩展性**：工作流定义标准化，易于扩展节点类型
3. **可复用性**：工作流可以保存和复用
4. **可观测性**：清晰的状态跟踪和进度上报

### 后续扩展

1. **工作流最佳实践库**：沉淀常用 DSL 片段与推荐组合
2. **工作流优化**：根据执行结果优化工作流生成
3. **可视化编辑器**：提供 UI 编辑工作流
4. **工作流市场**：分享和下载工作流模板

### 8.1 实现复盘（2026-03-20）

**已完成**：
- `Task Management -> Scheduling Layer -> Workflow MCP -> Workflow Engine` 的最小闭环已打通
- Scheduling Layer 已落地为本地模块，接管 `task-management/api.ts` 中原有 `setTimeout` mock
- 调度层已具备“规则预判 + 模型分析优先、失败回退”的规划器，可在 `simple / workflow` 之间决策，并生成受限 `Workflow DSL v1`
- 对“是否需要并行执行”这条分析维度，当前已落地最小受限实现：多链接浏览器任务可生成稳定的并行浏览器计划
- 模型分析现在已具备超时、重试、退避与回退诊断：
  - 超时阈值：30 秒
  - 最多重试：2 次
  - 回退后会把失败记录、尝试次数、回退原因写回调度元数据
- Workflow Engine 回调已接入 Task Management 的 `updateTaskStatus`，可同步 `running / completed / failed`
- 任务 `metadata` 中已回写 `workflowDsl / validation / workflowManifest / workflowId / progress`
- `acceptTask` 现在会同步返回预览决策信息，包括：
  - 执行策略
  - 预计耗时
  - 规划来源
  - 调度判断原因
  - 分析结果
  - 预览 DSL（若为 workflow）
- Task Management 已将真实调度结果持久化到任务记录，而不是固定写死为 `workflow`：
  - `strategy`
  - `estimatedDuration`
  - `planner reason / source / analysis`
  - `workflowDsl`
- `/task-management-test` 页面已能直接查看：
  - 执行方式
  - 预计耗时
  - 调度判断
  - 模型重试 / 回退信息
  - 当前执行环节
  - 计划步骤
- `/task-management-test` 页面现在也可直接：
  - 创建测试任务
  - 套用简单 / 浏览器 / 并行浏览器样例
  - 对运行中的任务发取消请求
- `cancelTask` 已接入 scheduling cancellation，并可在任务进入 workflow 之前或之后请求取消
- `simple execution fallback` 已接通：当 `generate_workflow` 校验失败、工具抛错、或 workflow submit 被拒绝时，Scheduling Layer 会直接复用 doc 06 的 SubAgent runtime 执行单步任务
- simple execution 的产出也保持稳定 `stepId -> output` 映射，当前固定回写为 `main -> result`
- 已补 focused test，覆盖：
  - `acceptTask` 返回预览决策信息
  - workflow validation 失败 -> simple execution
  - workflow submit 被拒 -> simple execution
  - simple execution 运行中取消 -> 底层 agent interrupt
  - createTask 后调度策略/预计耗时/判断依据正确落库
- smoke 已验证两条路径：
  - 完成路径：`createTask -> completed`
  - 取消路径：`createTask -> cancelTask -> cancelled`

**部分完成**：
- 当前 Scheduling Layer 仍是单机进程内模块，不是独立服务；接口语义已对齐文档，但部署形态还是 POC
- `acceptTask` 立即返回 `accepted`，`workflowId` 不是同步返回，而是在 engine 接受后通过 task metadata 异步回写
- 当前调度智能仍以受限结构化规划为主，浏览器/通知判断和耗时估算还偏启发式，离完整产品化调度层还有差距
- 当前并行能力仍是受限实现：主要覆盖“多目标浏览器任务”这一类可安全表达的并行场景，还没有扩展到更广泛的多代理汇总规划
- 虽然已有测试页可直接验收，但主产品路径里还没有完整的调度可视化与操作入口

**当前实现偏差 / 冲突点**：
- 文档里把 Scheduling Layer 描述成独立 LLM Agent 服务；当前实现为了最小闭环，先以内嵌模块方式落地在应用进程内
- 文档里默认 Scheduling Layer 通过 MCP transport 调用 `generate_workflow`；当前实现复用了应用内 `generate_workflow` tool handler，本质仍经过 tool 边界，但没有再绕一层 stdio/HTTP transport
- 文档里的 simple execution 示意图是“独立 SubAgent session”；当前最小修正方案没有再造一层新 session 管理，而是直接复用 doc 06 的 `executeWorkflowAgentStep -> StageWorker` 链路
- 文档示例里默认 `acceptTask` 就能同步拿到最终 `workflowId`；当前实际实现仍采用“先接受任务，再异步提交 workflow，随后把 `workflowId` 回写到 task metadata”的方式，更贴近真实执行链路

**全面 review 结论**：
- doc 03 的最小 POC 范围已经从“固定模板”推进到“真实调度预判 + 受限结构化规划 + 调度信息持久化 + UI 可查看”
- `是否需要并行执行` 已不再只是文档要求；当前至少在多链接浏览器场景下，已有真实的并行分析与并行 DSL 生成
- `错误处理和降级策略` 已不再停留在文档：当前已经具备超时、重试、退避、回退与诊断回写
- 对 UI-only 验收者来说，03 当前已至少具备一个可直接操作的测试入口，而不是只能依赖其他页面间接触发任务
- 与用户锁定约束仍保持一致：只生成 DSL、不执行任意 LLM TypeScript、Engine 只执行编译产物、结果保持 `stepId -> output` 稳定映射
- 当前最主要未闭环点已经从“有没有调度层”收敛为“调度智能是否足够产品化”：
  - 规划质量仍需继续增强
  - 独立服务形态还未落地
  - UI 可验收范围仍主要集中在测试页和任务结果，而非完整产品主界面
- 下一步不应提前扩 DSL 或 subworkflow；更合理的是继续增强 03 的调度质量与可验收呈现，再回头收 04 / 05 / 06 的剩余工程尾项
