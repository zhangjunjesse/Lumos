# Workflow Engine Layer 设计文档

## 1. 模块定位

工作流执行引擎，负责执行 Scheduling Layer 生成的工作流。

**核心技术**：OpenWorkflow（轻量级 TypeScript 工作流引擎）

**职责**：

- 接收并执行 DSL 编译产物
- 管理工作流执行状态
- 步骤编排和执行
- 自动重试和错误处理
- 维护执行投影、进度跟踪和结果汇总

**不负责**：

- 工作流生成（由 Scheduling Layer 的 LLM 负责）
- 实际工作执行（由步骤函数调用相应模块）
- 任务状态管理（由 Task Management 负责）

---

## 2. OpenWorkflow 简介

### 2.1 为什么选择 OpenWorkflow

**轻量级**：
- 内存占用仅 5-10 MB
- 无需额外进程
- 集成在应用中

**技术匹配**：
- TypeScript 原生
- 支持 SQLite
- 与 Lumos 技术栈一致

**功能完整**：
- 持久化和可恢复
- 自动重试
- 并行执行
- 内置监控面板

### 2.2 核心概念

**工作流定义**：
```typescript
import { OpenWorkflow } from 'openworkflow';

const ow = new OpenWorkflow({ backend });

const workflow = ow.defineWorkflow(
  { name: 'my-workflow' },
  async ({ input, step }) => {
    // 步骤定义
    const result = await step.run({ name: 'step-name' }, async () => {
      // 步骤逻辑
      return 'result';
    });

    return result;
  }
);
```

**步骤（Step）**：
- 工作流的基本执行单元
- 自动持久化状态
- 支持自动重试
- 崩溃后可恢复
- OpenWorkflow 原生 Step API 只有 `step.run`、`step.sleep`、`step.runWorkflow`

**Lumos 约定**：
- `agentStep`、`browserStep`、`notificationStep` 是 Lumos 的业务封装，不是 OpenWorkflow 原生 Step 类型
- 对外暴露的进度回调和状态查询来自 Lumos 自己维护的执行投影，不是 OpenWorkflow 原生事件流

### 2.3 受限工作流语言边界

Workflow Engine 不直接面向任意 TypeScript，而是面向 MCP 编译后的受限 workflow factory module。

**允许的扩展**：
- 新增 `step type`
- 扩展步骤输入输出 schema
- 扩展步骤默认超时、重试、权限策略
- 扩展 DSL 版本（如 `v2`）

**不允许的能力**：
- 任意 `import`
- 任意自定义函数或脚本片段
- 任意循环和无限控制流
- 未注册步骤类型的直接执行

**V1 控制流边界**：
- 顺序执行
- 并行执行
- 条件执行
- 子工作流不属于 `v1`
- `v1` 暂不支持循环

### 2.4 运行时扩展点

运行时扩展性主要通过 Step Registry 获得，而不是通过开放任意代码。

```typescript
interface StepRuntimeDefinition {
  type: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  defaultPolicy?: {
    timeoutMs?: number;
    retry?: {
      maximumAttempts?: number;
    };
  };
  execute: (input: any, ctx: StepContext) => Promise<StepResult>;
}

interface WorkflowRuntimeBindings {
  agentStep: (input: AgentStepInput) => Promise<AgentStepOutput>;
  browserStep: (input: BrowserStepInput) => Promise<BrowserStepOutput>;
  notificationStep: (input: NotificationStepInput) => Promise<NotificationStepOutput>;
}
```

**边界说明**：
- Step Registry 是 Lumos 自己的运行时元数据
- 编译产物不会直接读取 Step Registry，而是只接受 `WorkflowRuntimeBindings`
- OpenWorkflow 最终只看到 `defineWorkflow(...)` 产出的 `Workflow` 对象与其 `spec/fn`

**扩展原则**：
- 新业务能力优先新增 `step type`
- 新步骤必须有输入校验
- 新步骤必须声明副作用边界和默认策略
- 只有确实需要新的控制流原语时，才升级 DSL 版本

### 2.5 工作流运转机制

**1. 并行执行**

使用 Promise.all 实现并行：

```typescript
const workflow = ow.defineWorkflow(
  { name: 'parallel-example' },
  async ({ input, step }) => {
    // 并行执行多个步骤
    const [result1, result2, result3] = await Promise.all([
      step.run({ name: 'task1' }, () => agentStep({ role: 'researcher', prompt: '搜索主题A' })),
      step.run({ name: 'task2' }, () => agentStep({ role: 'researcher', prompt: '搜索主题B' })),
      step.run({ name: 'task3' }, () => agentStep({ role: 'researcher', prompt: '搜索主题C' }))
    ]);

    // 汇总结果
    return { result1, result2, result3 };
  }
);
```

**2. 依赖等待机制**

通过 async/await 自动等待上游步骤完成：

```typescript
const workflow = ow.defineWorkflow(
  { name: 'sequential-example' },
  async ({ input, step }) => {
    // 步骤1：搜索信息
    const searchResult = await step.run({ name: 'search' }, () =>
      agentStep({ role: 'researcher', prompt: '搜索 OpenWorkflow' })
    );

    // 步骤2：等待步骤1完成，使用其输出
    const codeResult = await step.run({ name: 'generate' }, () =>
      agentStep({ role: 'coder', prompt: `根据以下信息生成代码：${searchResult.output}` })
    );

    // 步骤3：等待步骤2完成
    await step.run({ name: 'notify' }, () =>
      notificationStep({ channel: 'feishu', message: '代码已生成' })
    );

    return codeResult;
  }
);
```

**等待机制说明**：
- 每个 `step.run()` 返回 Promise
- `await` 确保等待上游步骤完成
- 步骤结果自动传递给下游
- 无需额外的"信号"机制

**3. 标准化输入输出**

OpenWorkflow 的 `step.run()` 接收的是零参数闭包，业务参数通过闭包传入步骤封装函数。Lumos 侧约定统一使用对象入参：

```typescript
type AgentRole = 'researcher' | 'coder' | 'integration';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface AgentStepInput {
  prompt: string;
  role?: AgentRole;
  model?: string;
  tools?: string[];
}

interface BrowserStepInput {
  action: 'navigate' | 'click' | 'screenshot';
  url?: string;
  selector?: string;
}

interface NotificationStepInput {
  message: string;
  level?: 'info' | 'warning' | 'error';
  channel?: 'feishu' | 'system';
  sessionId?: string;
}

interface StepResult<TOutput extends JsonValue = JsonValue> {
  success: boolean;
  output: TOutput;
  error?: string;
}

// agentStep 标准输出
interface AgentStepOutput extends StepResult<string> {
  metadata?: {         // 可选元数据
    model?: string;
    tokens?: number;
    duration?: number;
  };
}

// browserStep 标准输出
interface BrowserStepOutput extends StepResult<{
  url?: string;
  screenshot?: string;  // base64
  html?: string;
}> {}

// notificationStep 标准输出
interface NotificationStepOutput extends StepResult<{
  messageId?: string | null;
}> {}
```

**输出使用示例**：

```typescript
const workflow = ow.defineWorkflow(
  { name: 'typed-example' },
  async ({ input, step }) => {
    // 步骤1：类型化输出
    const searchResult: AgentStepOutput = await step.run({ name: 'search' }, () =>
      agentStep({ role: 'researcher', prompt: '搜索信息' })
    );

    // 步骤2：检查上游是否成功
    if (!searchResult.success) {
      throw new Error(`搜索失败：${searchResult.error}`);
    }

    // 步骤3：使用上游输出
    const codeResult: AgentStepOutput = await step.run({ name: 'generate' }, () =>
      agentStep({ role: 'coder', prompt: `生成代码：${searchResult.output}` })
    );

    return codeResult;
  }
);
```

**4. 多依赖场景**

某个节点依赖多个上游步骤的输出：

```typescript
const workflow = ow.defineWorkflow(
  { name: 'multi-dependency' },
  async ({ input, step }) => {
    // 场景1：并行执行，单节点依赖多个并行结果
    const [search1, search2, search3] = await Promise.all([
      step.run({ name: 'search-topic-a' }, () => agentStep({ role: 'researcher', prompt: '搜索主题A' })),
      step.run({ name: 'search-topic-b' }, () => agentStep({ role: 'researcher', prompt: '搜索主题B' })),
      step.run({ name: 'search-topic-c' }, () => agentStep({ role: 'researcher', prompt: '搜索主题C' }))
    ]);

    // 步骤4：依赖上面3个步骤的输出
    const summary = await step.run({ name: 'summarize' }, () =>
      agentStep({ role: 'researcher', prompt: `汇总以下信息：
        主题A: ${search1.output}
        主题B: ${search2.output}
        主题C: ${search3.output}
      ` })
    );

    // 场景2：顺序执行，节点依赖多个顺序结果
    const step1 = await step.run({ name: 'step1' }, () => agentStep({ role: 'researcher', prompt: '步骤1' }));
    const step2 = await step.run({ name: 'step2' }, () => agentStep({ role: 'coder', prompt: '步骤2' }));
    const step3 = await step.run({ name: 'step3' }, () => agentStep({ role: 'integration', prompt: '步骤3' }));

    // 步骤4：依赖前面3个顺序步骤
    const final = await step.run({ name: 'final' }, () =>
      agentStep({ role: 'researcher', prompt: `整合结果：
        ${step1.output}
        ${step2.output}
        ${step3.output}
      ` })
    );

    // 场景3：混合模式（部分并行 + 部分顺序）
    // 第一批并行
    const [dataA, dataB] = await Promise.all([
      step.run({ name: 'fetch-a' }, () => agentStep({ role: 'integration', prompt: '获取数据A' })),
      step.run({ name: 'fetch-b' }, () => agentStep({ role: 'integration', prompt: '获取数据B' }))
    ]);

    // 中间步骤（依赖第一批）
    const processed = await step.run({ name: 'process' }, () =>
      agentStep({ role: 'coder', prompt: `处理数据：${dataA.output}, ${dataB.output}` })
    );

    // 第二批并行（依赖中间步骤）
    const [result1, result2] = await Promise.all([
      step.run({ name: 'analyze-1' }, () => agentStep({ role: 'researcher', prompt: `分析：${processed.output}` })),
      step.run({ name: 'analyze-2' }, () => agentStep({ role: 'coder', prompt: `生成代码：${processed.output}` }))
    ]);

    // 最终步骤（依赖第二批）
    return await step.run({ name: 'finalize' }, () =>
      agentStep({ role: 'integration', prompt: `发送结果：${result1.output}, ${result2.output}` })
    );
  }
);
```

**依赖处理规则**：
- 使用 `Promise.all` 等待多个并行步骤
- 使用 `await` 等待单个步骤
- 可以任意组合并行和顺序
- 步骤结果可以传递给任意下游步骤

---

## 3. 核心功能

### 3.1 工作流执行

**动态加载工作流**：
```typescript
import { type OpenWorkflow, type Workflow } from 'openworkflow';
import { createJiti } from 'jiti';
import { createHash } from 'crypto';
import { isWorkflow } from 'openworkflow/internal';
import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const jiti = createJiti(import.meta.url);
const registeredWorkflows = new Set<string>();
const compiledWorkflowDir = path.join(
  process.env.LUMOS_DATA_DIR ?? process.cwd(),
  'compiled-workflows'
);

interface WorkflowRuntimeBindings {
  agentStep: typeof agentStep;
  browserStep: typeof browserStep;
  notificationStep: typeof notificationStep;
}

interface CompiledWorkflowManifest {
  dslVersion: 'v1';
  artifactKind: 'workflow-factory-module';
  exportedSymbol: 'buildWorkflow';
  workflowName: string;
  workflowVersion: string;
  stepTypes: string[];
  warnings: string[];
}

interface CompiledWorkflowModule {
  buildWorkflow: (runtime: WorkflowRuntimeBindings) => Workflow<any, any, any>;
}

function getWorkflowRegistryKey(workflow: Workflow<any, any, any>) {
  return workflow.spec.version
    ? `${workflow.spec.name}@${workflow.spec.version}`
    : workflow.spec.name;
}

function createWorkflowRuntimeBindings(): WorkflowRuntimeBindings {
  return { agentStep, browserStep, notificationStep };
}

// 接收 MCP 编译出的 workflow factory module，注入 runtime bindings 后得到 Workflow 定义
async function loadWorkflowDefinition(
  code: string,
  manifest: CompiledWorkflowManifest
) {
  const fileName = `${manifest.workflowVersion}.mjs`;
  const filePath = path.join(compiledWorkflowDir, fileName);
  const cacheBust = createHash('sha256').update(code).digest('hex');

  await fs.mkdir(compiledWorkflowDir, { recursive: true });
  await fs.writeFile(filePath, code, 'utf8');

  const module = await jiti.import<CompiledWorkflowModule>(
    `${pathToFileURL(filePath).href}?v=${cacheBust}`
  );

  if (typeof module.buildWorkflow !== 'function') {
    throw new Error('No buildWorkflow export found');
  }

  const workflow = module.buildWorkflow(createWorkflowRuntimeBindings());
  if (!isWorkflow(workflow)) {
    throw new Error('buildWorkflow did not return a Workflow object');
  }

  if (
    workflow.spec.name !== manifest.workflowName ||
    workflow.spec.version !== manifest.workflowVersion
  ) {
    throw new Error('Compiled workflow manifest does not match workflow spec');
  }

  return workflow as Workflow<any, any, any>;
}

function ensureWorkflowRegistered(ow: OpenWorkflow, workflow: Workflow<any, any, any>) {
  const key = getWorkflowRegistryKey(workflow);
  if (registeredWorkflows.has(key)) {
    return;
  }

  ow.implementWorkflow(workflow.spec, workflow.fn);
  registeredWorkflows.add(key);
}
```

**加载约束**：
- 编译产物必须导出 `buildWorkflow(runtimeBindings)`，而不是依赖应用内相对 import
- `buildWorkflow(...)` 必须返回 `defineWorkflow(...)` 生成的 `Workflow` 对象
- Workflow Engine 必须校验 `workflow.spec.name/version` 与 MCP manifest 一致
- OpenWorkflow 的 registry 以 `name + version` 去重，同名同版本只能注册一次
- 编译器必须为每个 DSL 产物生成稳定 `workflowVersion`
- 同名但不同 DSL 的产物不能共用同一个 `version`
- 编译产物写入 Engine 自己管理的缓存目录，不从任意用户路径直接 import

**执行工作流**：
```typescript
// 1. 获取 OpenWorkflow 实例与全局 Worker
const ow = await getWorkflowEngine();
await getOrCreateWorker(ow);

// 2. 加载并注册工作流定义
const workflow = await loadWorkflowDefinition(code, manifest);
ensureWorkflowRegistered(ow, workflow);

// 3. 根据 workflow.spec 调度执行
const runHandle = await ow.runWorkflow(workflow.spec, inputs);

// 4. 等待结果
const result = await runHandle.result({ timeoutMs: 15 * 60 * 1000 });
```

**说明**：
- `result()` 的实现是轮询 `getWorkflowRun()`，适合等待最终结果，不适合承担实时进度推送
- 进度事件需要由 Lumos 基于执行投影主动上报
- Worker 应长期运行；Web 请求里不应按次创建和停止 Worker

**Worker 管理**：
```typescript
// 应用启动时创建全局 Worker
let globalWorker: Worker | null = null;

async function getOrCreateWorker(ow: OpenWorkflow) {
  if (!globalWorker) {
    globalWorker = ow.newWorker({ concurrency: 5 });
    await globalWorker.start();
  }
  return globalWorker;
}

// 应用关闭时停止 Worker
async function shutdownWorker() {
  if (globalWorker) {
    await globalWorker.stop();
    globalWorker = null;
  }
}
```

### 3.2 自定义步骤封装

**Agent 步骤**：
```typescript
interface AgentStepInput {
  prompt: string;
  role?: AgentRole;
  model?: string;
  tools?: string[];
}

export async function agentStep(input: AgentStepInput): Promise<AgentStepOutput> {
  const result = await callClaudeAgent(input);
  return result;
}
```

**Browser 步骤**：
```typescript
export async function browserStep(
  config: BrowserStepInput
): Promise<BrowserStepOutput> {
  const bridge = resolveBrowserBridgeRuntimeConfig();
  if (!bridge) {
    return buildSyntheticBrowserResult(config);
  }

  switch (config.action) {
    case 'navigate':
      return await runBrowserNavigate(bridge, config);
    case 'click':
      return await runBrowserClick(bridge, config);
    case 'fill':
      return await runBrowserFill(bridge, config);
    case 'screenshot':
      return await runBrowserScreenshot(bridge, config);
  }
}
```

**Notification 步骤**：
```typescript
export async function notificationStep(
  config: NotificationStepInput
): Promise<NotificationStepOutput> {
  let messageId: string | null = null;

  if (config.channel === 'feishu') {
    messageId = await sendFeishuMessageViaBridge(config);
  } else if (config.sessionId) {
    messageId = appendSystemNotificationMessage(config.sessionId, config.message);
  } else {
    console.log(`[SYSTEM] ${config.message}`);
  }

  return {
    success: true,
    output: { messageId }
  };
}
```

### 3.3 状态管理

OpenWorkflow 自动管理：
- 工作流执行状态
- 步骤执行记录
- Durable 执行历史
- 崩溃恢复
- 工作流级和步骤级重试

Lumos 额外维护：
- `progress`、`currentStep`、`completedSteps`
- 对 Scheduling Layer 的回调投递
- `taskId -> workflowRunId` 映射
- 工作流定义缓存和版本管理

### 3.4 错误处理

**OpenWorkflow 原生重试策略**：
```typescript
const workflow = ow.defineWorkflow({
  name: 'agent-workflow',
  retryPolicy: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s'
  }
}, async ({ step }) => {
  return await step.run(
    {
      name: 'search',
      retryPolicy: { maximumAttempts: 5 }
    },
    () => agentStep({ role: 'researcher', prompt: '搜索信息' })
  );
});
```

**结果等待与错误捕获**：
```typescript
try {
  const result = await runHandle.result({ timeoutMs: 15 * 60 * 1000 });
} catch (error) {
  callbacks.onFailed({
    workflowId,
    taskId,
    error: {
      code: 'WORKFLOW_ERROR',
      message: error instanceof Error ? error.message : String(error)
    }
  });
}
```

**取消语义**：
- `runHandle.cancel()` 和 `ow.cancelWorkflowRun(workflowId)` 都可以取消运行中的 workflow run
- OpenWorkflow 支持 `canceled` 终态
- 当前 Lumos `Workflow DSL v1` 不开放子工作流；如果未来引入 `step.runWorkflow()`，需要额外处理父子工作流的级联取消

---

## 4. 接口定义

### 4.1 对上游（Scheduling Layer）提供的接口

```typescript
// 提交工作流
interface SubmitWorkflowRequest {
  taskId: string;
  workflowCode: string;  // MCP 编译后的 workflow factory module 代码
  workflowManifest: {
    dslVersion: 'v1';
    artifactKind: 'workflow-factory-module';
    exportedSymbol: 'buildWorkflow';
    workflowName: string;
    workflowVersion: string;
    stepTypes: string[];
    warnings: string[];
  };
  inputs: Record<string, any>;
}

interface SubmitWorkflowResponse {
  workflowId: string;
  status: 'accepted' | 'rejected';
}

// 查询状态
interface GetWorkflowStatusRequest {
  workflowId: string;
}

interface GetWorkflowStatusResponse {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
  progress: number;
  currentStep?: string;
  completedSteps: string[];
  result?: any;
  error?: {
    code: string;
    message: string;
    stepName?: string;
  };
}

// 取消工作流
interface CancelWorkflowRequest {
  workflowId: string;
}
```

### 4.2 回调 Scheduling Layer 的接口

Workflow Engine 通过回调接口向 Scheduling Layer 上报执行状态。这里的回调来自 Lumos 自己维护的执行投影，不是 OpenWorkflow 原生事件接口。

```typescript
// 回调接口定义
interface WorkflowCallbacks {
  onProgress: (event: WorkflowProgressEvent) => void;
  onCompleted: (event: WorkflowCompletedEvent) => void;
  onFailed: (event: WorkflowFailedEvent) => void;
}

// 进度事件
interface WorkflowProgressEvent {
  workflowId: string;
  taskId: string;
  progress: number;              // 0-100
  currentStep?: string;
  completedSteps: string[];
}

// 完成事件
interface WorkflowCompletedEvent {
  workflowId: string;
  taskId: string;
  result: any;
  duration: number;              // 执行时长（毫秒）
}

// 失败事件
interface WorkflowFailedEvent {
  workflowId: string;
  taskId: string;
  error: {
    code: string;
    message: string;
    stepName?: string;           // 失败的步骤
  };
}
```

### 4.3 实现示例

```typescript
// src/lib/workflow/api.ts
export async function submitWorkflow(
  request: SubmitWorkflowRequest,
  callbacks: WorkflowCallbacks
): Promise<SubmitWorkflowResponse> {
  try {
    // 1. 加载工作流
    const workflow = await loadWorkflowDefinition(
      request.workflowCode,
      request.workflowManifest
    );

    // 2. 获取 OpenWorkflow 实例
    const ow = await getWorkflowEngine();

    // 3. 获取或创建全局 Worker
    await getOrCreateWorker(ow);

    // 4. 注册工作流定义
    ensureWorkflowRegistered(ow, workflow);

    // 5. 运行工作流
    const runHandle = await ow.runWorkflow(workflow.spec, request.inputs);
    const workflowId = runHandle.workflowRun.id;
    const startTime = Date.now();

    // 6. 初始化执行投影
    await upsertWorkflowExecution({
      workflowId,
      taskId: request.taskId,
      status: 'pending',
      progress: 0,
      completedSteps: []
    });

    // 7. 异步跟踪进度（轮询投影表，而不是依赖 OpenWorkflow 原生事件）
    void watchWorkflowExecution(workflowId, callbacks);

    // 8. 异步等待最终结果
    void runHandle.result({ timeoutMs: 15 * 60 * 1000 })
      .then(result => {
        callbacks.onCompleted({
          workflowId,
          taskId: request.taskId,
          result,
          duration: Date.now() - startTime
        });
      })
      .catch(error => {
        callbacks.onFailed({
          workflowId,
          taskId: request.taskId,
          error: {
            code: error?.code || 'WORKFLOW_ERROR',
            message: error instanceof Error ? error.message : String(error),
            stepName: error?.stepName
          }
        });
      });

    return { workflowId, status: 'accepted' };
  } catch (error) {
    return { workflowId: '', status: 'rejected' };
  }
}
```

---

## 5. 数据存储

### 5.1 OpenWorkflow 自动管理

OpenWorkflow 使用 SQLite 自动创建和管理：
- 工作流执行记录
- 步骤执行状态
- 执行历史

### 5.2 Lumos 维护的表

```sql
-- 工作流定义表
CREATE TABLE workflow_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  code TEXT NOT NULL,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 工作流与任务的关联
CREATE TABLE workflow_task_mapping (
  workflow_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  execution_id TEXT,
  PRIMARY KEY (workflow_id, task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Lumos 维护的执行投影
CREATE TABLE workflow_executions (
  workflow_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  current_step TEXT,
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  error_json TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. 实施计划

### Phase 1：POC 验证（1周）

- [ ] 安装 OpenWorkflow
- [ ] 实现简单工作流（Agent → Browser → Notification）
- [ ] 测试 SQLite 集成
- [ ] 验证性能和资源占用

### Phase 2：核心功能（3-4周）

**Week 1**：基础设施
- [ ] OpenWorkflow 集成到 Lumos
- [ ] 步骤封装（agentStep、browserStep、notificationStep）
- [ ] 工作流存储

**Week 2**：动态执行
- [ ] 动态代码加载与注册缓存
- [ ] 错误处理
- [ ] 与 Scheduling Layer 接口对接

**Week 3-4**：测试和优化
- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能优化

### Phase 3：增强功能（2-3周）

- [ ] 更多步骤类型（文件操作、数据库等）
- [ ] 执行历史集成
- [ ] 监控和调试工具

---

## 7. 与其他层的集成

```
┌─────────────────────────────────────────────┐
│      Scheduling Layer (LLM Agent)           │
│  - 分析任务                                  │
│  - 生成 workflow factory module + manifest   │
└─────────────────┬───────────────────────────┘
                  │ submitWorkflow(workflowCode, workflowManifest)
                  ↓
┌─────────────────────────────────────────────┐
│    Workflow Engine (OpenWorkflow)           │
│  - 注入 bindings，构造并注册 workflow 定义    │
│  - 执行步骤                                  │
│  - 维护执行投影                              │
└─────────────────┬───────────────────────────┘
                  │ agentStep / browserStep / notificationStep
                  ↓
┌─────────────────────────────────────────────┐
│    SubAgent / Browser / Bridge              │
│  - 实际执行工作                              │
└─────────────────────────────────────────────┘
```

---

## 8. 总结

### 核心决策

**使用 OpenWorkflow 作为工作流引擎**

**理由**：
- ✅ 轻量级（5-10 MB）
- ✅ 无需额外进程
- ✅ 支持 SQLite
- ✅ TypeScript 原生

### 职责边界

**Workflow Engine 负责**：
- 接收和执行工作流代码
- 管理执行状态
- 步骤编排

**Workflow Engine 不负责**：
- 工作流生成（Scheduling Layer）
- 实际工作执行（步骤函数）
- 任务状态管理（Task Management）

### 开发时间

- **POC**：1周
- **核心功能**：3-4周
- **增强功能**：2-3周
- **总计**：6-8周

### 8.1 实现复盘（2026-03-20）

**已完成**：
- Workflow Engine 已支持加载 MCP 编译产物、注入 `runtime bindings`、校验 `manifest`、注册到 OpenWorkflow 并执行
- 编译产物仍保持 `buildWorkflow(runtimeBindings)` 形态，Engine 不直接执行任意 LLM 生成 TypeScript
- `agentStep` 已接到 doc 06 的 SubAgent runtime adapter，不再是简单 mock 响应；当前会根据运行环境在 `claude` 与 `synthetic` 之间做受控切换
- 已补齐 Lumos 侧持久化表：
  - `workflow_definitions`
  - `workflow_task_mapping`
  - `workflow_executions`
- Engine 已在 `workflow_executions` 中维护执行投影，包含：
  - `status`
  - `progress`
  - `currentStep`
  - `completedSteps`
  - `result/error`
- Compiler 现在会在每个 step 周围生成生命周期 hook，利用 OpenWorkflow 暴露的 `run.id` 将 step 事件回写到执行投影
- `getWorkflowStatus` 已优先从执行投影读取，不再只依赖进程内 `Map`
- `cancelWorkflow` 已支持在仅剩执行投影时继续发起取消，而不是完全依赖内存态
- 已补 focused cancel 验证，覆盖“运行中取消后底层结果晚到”的场景；Engine 现在在 `runHandle.result()` resolve 后会再次检查是否已取消，避免把 `cancelled` 误覆盖成 `completed`
- 已修正执行投影的 terminal freeze 语义：workflow 进入 `cancelled / completed / failed` 后，晚到的 `onStepStarted / onStepCompleted / onStepSkipped` 不再把 projection 状态改回非终态
- `browserStep` 已接入 Electron browser bridge：
  - bridge 可用时，`navigate / click / fill / screenshot` 会走真实浏览器执行
  - bridge 不可用时，仍保留受控 synthetic fallback，避免在无 Electron runtime 的测试/服务端环境直接中断
- `notificationStep` 已接入最小真实通知通道：
  - `channel=feishu` 时，复用 Bridge Service 走真实 Feishu 发送
  - `channel=system` 时，若有 `sessionId` 则写入会话消息表作为 assistant-style 系统通知；否则回退到 server log
- 已补运行时 smoke：
  - 单步 `agent` workflow
  - 多步 `agent -> browser -> notification` workflow
  - MCP 编译后提交执行链路
  - 真实 OpenWorkflow running-cancel smoke，验证 `running -> cancelled -> settled(cancelled)` 链路
  - 新增 `workflow-browser-runtime.smoke.ts` 与 `scripts/browser-workflow-electron-smoke.mjs`
  - 已实际在隔离的 Next + Electron dev 实例中跑通 browser bridge runtime smoke，验证 `agent -> browser.navigate -> browser.screenshot -> notification.system` 完整链路
  - 实际 smoke 结果已确认：
    - workflow status = `completed`
    - `browse` / `capture` 的 `executionMode = browser-bridge`
    - `notify` 的 `deliveryMode = session-message`
    - screenshot artifact 已真实落盘并可读取

**部分完成**：
- `browserStep` 虽已接真实 browser bridge，但当前 `click / fill` 仍通过固定 evaluate script + CSS selector 实现，不是直接复用 browser bridge 的 DOM uid 协议
- `notificationStep` 的 `system` 通道当前是“会话内系统消息 / server log”，不是 Electron OS-level toast
- Engine 的回调桥接仍是进程内 callback；进程重启后不会自动恢复对 Scheduling Layer 的回调订阅
- `currentStep` 在并行场景下目前表示“最近一个仍在运行的 step”，不是完整运行中 step 集合；完整集合只保存在 projection 内部字段

**当前实现偏差 / 备注**：
- 文档示例里用“轮询执行投影表”来驱动状态上报；当前实现采用“编译期注入 step hook + 终态回调”更新 projection，避免额外 watcher 轮询，但语义上仍然是 Lumos 自维护执行投影
- 文档中的 `workflow_executions` 只列了 `completed_steps_json`；当前实现额外维护了 `running_steps_json / skipped_steps_json / step_ids_json`，用于更稳定地计算进度和并行状态
- 当前 `workflow_definitions.id` 使用 `workflowName@workflowVersion`，与 OpenWorkflow registry key 对齐；没有单独再引入一层随机 definition id
- 为了稳定复现真实 running-cancel，本轮新增了仅供 smoke / test 使用的 synthetic 延迟钩子；它不扩展 DSL，也不改变 Engine 对外接口
- `browserStep.screenshot` 当前会把截图产物落到 `LUMOS_DATA_DIR/workflow-browser-runs/...`，并将路径与 base64 一起回写到 step output；这比文档里的纯 base64 返回更接近真实工程形态
- Browser runtime 的 bridge 发现逻辑当前来自 `LUMOS_BROWSER_BRIDGE_URL/TOKEN` 或 `runtime/browser-bridge.json`，而不是直接在 Workflow Engine 内部持有 BrowserManager 实例
- 为了让真实 browser runtime smoke 不污染现有开发实例，runner 现在会注入独立的 `LUMOS_NEXT_DIST_DIR`、`HOME / USERPROFILE / XDG_CONFIG_HOME`；`next.config.ts` 与 `tsconfig.json` 已补 runner 专用 distDir 支持
- 为了让真实 browser runtime smoke 在冷启动的 Next + Electron 环境里稳定收敛，smoke 目标页已改成 runner 本地的 `/api/health`，并把 smoke 轮询超时提升为默认 `90s`；原因是实测首页冷编译可到 `39s+`，原先 `20s` 超时会误判运行中 workflow
- Engine 加载编译产物时，动态模块加载已改成保留原生 `import()` 语义的 runtime helper；原因是 `tsc -> cjs` 的 smoke runner 会把普通 `import(moduleUrl)` 错误降级成 `require(file://...)`
- 针对 Jest/CJS 环境下的 loader 回归验证，编译产物加载逻辑已抽到独立模块；测试现在直接验证 dynamic import fallback，而不再把 OpenWorkflow 的 ESM 包解析问题混进 loader 单测

**全面 review 结论**：
- doc 05 的“最小可运行闭环”现在已经不只是 POC 主链，而是连同执行投影和细粒度状态一起落地了
- `browserStep` / `notificationStep` 已经从 mock runtime 进入“最小真实运行时”阶段，剩余问题更多是能力深度与交互质量，而不是有没有接上真实执行层
- “运行中 cancel”的核心状态机现在已有两层验证：
  - focused unit test：覆盖底层结果晚到时不覆盖 `cancelled`
  - real smoke：覆盖真实 OpenWorkflow cancel 后 projection 不被晚到 step lifecycle 改写
- Engine cancel 现在会继续向活动中的 workflow agent step 下传中断信号，并在 cancel 握手期间用 `cancellationRequested` 防住“agent abort 先返回、workflow cancel 后落库”的竞态
- browser bridge runtime smoke 已从“存在入口”升级为“真实 Electron/browser runtime 实际执行通过”
- 2026-03-20 已再次实跑验证：
  - `workflowId = 2ea27cf7-d4fd-4572-b2b9-0a182542988d`
  - `completedSteps = [draft, browse, capture, notify]`
  - `browse/capture/notify` 的真实运行结果与 manifest stepIds 稳定对齐
- 当前剩余风险不在架构分层，而在运行时工程细节：
  - Electron/browser runtime 仍有 `webContents` deprecated warning
  - browser runtime smoke 执行过程中出现 `MaxListenersExceededWarning`
  - 这些属于后续工程清理项，不影响 doc 05 主链设计成立
- 当前 cancel 方向的核心缺口已从“状态维护”推进到“状态维护 + agent abort”一体化；剩余更多是 browser/notification runtime 的工程清理项，而不是取消语义本身

---

## 参考资料

- [OpenWorkflow 官网](https://openworkflow.dev)
- [OpenWorkflow GitHub](https://github.com/openworkflowdev/openworkflow)


---

## 9. MCP 集成

### 9.1 Workflow MCP Server

Workflow MCP Server 是独立编译层；Scheduling Layer 调用它生成编译产物，Workflow Engine 只负责加载和执行。

**详细设计**：参见 `04-workflow-mcp-design.md`

**核心工具**：
- `generate_workflow` - 校验 `Workflow DSL v1` 并编译 OpenWorkflow 模块

### 9.2 为什么使用 MCP

**稳定性保障**：
- ✅ Tool Schema 强制约束输入格式
- ✅ 100% 语法正确
- ✅ Step Registry 控制可用能力边界

**对比其他方式**：
- Prompt 生成：格式不可控 ❌
- MCP：结构化约束 ✅

### 9.3 集成流程

```
Scheduling Layer (LLM)
    ↓ 生成 Workflow DSL v1
generate_workflow (MCP)
    ↓ 返回 code + manifest + validation
Workflow Engine
    ↓ 加载编译产物
OpenWorkflow
```
