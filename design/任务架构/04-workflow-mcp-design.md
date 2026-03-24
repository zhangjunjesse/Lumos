# Workflow MCP Server 设计文档（受限 DSL 编译方案）

## 1. 概述

**目的**：为 Scheduling Agent 提供受限工作流 DSL 的校验与编译能力

**核心方案**：受限 DSL + 编译器
- LLM 生成 `Workflow DSL v1` 结构化描述
- MCP Server 校验 DSL、解析步骤注册表、编译 workflow factory module 代码
- Workflow Engine 只执行编译产物，不直接执行任意 LLM 生成代码
- 可扩展性通过新增 `step type` 获得，不通过开放任意脚本获得
- Phase 1 仅开放 `agent / browser / notification`

**架构**：
```
Scheduling Agent (LLM)
  ↓ 生成 Workflow DSL v1
MCP Tool: generate_workflow
  ↓ 校验 DSL
  ↓ 解析 Step Registry
  ↓ 编译 OpenWorkflow 模块
  ↓ 返回 TypeScript 代码
Workflow Engine
  ↓ 加载并执行编译产物
```

---

## 2. MCP Tools 设计

### 2.1 generate_workflow

**功能**：根据受限 DSL 校验并编译 OpenWorkflow 代码

**输入 Schema**：
```typescript
{
  name: 'generate_workflow',
  description: '校验并编译 Workflow DSL v1',
  inputSchema: {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        properties: {
          version: { const: 'v1' },
          name: { type: 'string' },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: {
                  type: 'string',
                  enum: [
                    'agent',
                    'browser',
                    'notification'
                  ]
                },
                dependsOn: {
                  type: 'array',
                  items: { type: 'string' }
                },
                when: { type: 'object' },
                input: { type: 'object' },
                policy: { type: 'object' }
              },
              required: ['id', 'type']
            }
          }
        },
        required: ['version', 'name', 'steps']
      }
    },
    required: ['spec']
  }
}
```

**输出**：
```typescript
{
  code: string;  // 生成的 TypeScript 编译产物（workflow factory module）
  manifest: {
    dslVersion: 'v1';
    artifactKind: 'workflow-factory-module';
    exportedSymbol: 'buildWorkflow';
    workflowName: string;
    workflowVersion: string;  // 由规范化 DSL hash 派生
    stepTypes: string[];
    warnings: string[];
  };
  validation: {
    valid: boolean;
    errors: string[];
  }
}
```

**示例调用**：
```typescript
// LLM 调用
const result = await mcp.call('generate_workflow', {
  spec: {
    version: 'v1',
    name: 'research-report',
    steps: [
      {
        id: 'search',
        type: 'agent',
        input: { prompt: '搜索 AI 医疗应用', role: 'researcher' }
      },
      {
        id: 'analyze',
        type: 'agent',
        dependsOn: ['search'],
        input: { prompt: '分析资料生成报告', role: 'coder' }
      },
      {
        id: 'notify',
        type: 'notification',
        dependsOn: ['analyze'],
        input: { message: '报告已完成', channel: 'feishu' }
      }
    ]
  }
});

// 返回生成的代码
console.log(result.code);
```

---

## 3. 编译器内部模板

### 3.0 代码生成说明

这些模板是**编译器内部实现细节**，不是直接暴露给 LLM 的自由编程接口。
对 LLM 暴露的是 `Workflow DSL v1`，不是模板名称、不是 TypeScript 片段。

生成的代码只需要导入 OpenWorkflow API，不应直接 import 应用内的步骤实现。
编译产物统一导出 `buildWorkflow(runtimeBindings)`，由 Workflow Engine 在加载时显式注入已注册步骤能力。

```typescript
import { defineWorkflow, type Workflow } from 'openworkflow';

interface WorkflowRuntimeBindings {
  agentStep: (input: any) => Promise<any>;
  browserStep: (input: any) => Promise<any>;
  notificationStep: (input: any) => Promise<any>;
}

export function buildWorkflow(
  runtime: WorkflowRuntimeBindings
): Workflow<any, any, any> {
  const { agentStep, browserStep, notificationStep } = runtime;

  return defineWorkflow(
    { name: 'compiled-workflow', version: 'dsl-v1-a1b2c3d4' },
    async ({ input, step, run }) => {
      return {};
    }
  );
}
```

运行环境需提供：

- `WorkflowRuntimeBindings`: 编译产物允许调用的运行时函数集合
- `Step Registry`: 每种步骤类型对应的校验器、编译器、运行时定义；Engine 会由此派生 `WorkflowRuntimeBindings`

完整的运行环境示例见第 5 节。

### 3.1 骨架模板

编译器会根据依赖图分析结果选择骨架组织方式。`sequential / parallel / conditional` 是编译器内部 lowering 结果，不是 DSL 的顶层类型字段。

**sequential（顺序执行）**：
```typescript
export const sequentialTemplate = (
  name: string,
  workflowVersion: string,
  steps: string
) => `
import { defineWorkflow } from 'openworkflow';

export function buildWorkflow(runtime) {
  const { agentStep, browserStep, notificationStep } = runtime;

  return defineWorkflow(
    { name: '${name}', version: '${workflowVersion}' },
    async ({ input, step, run }) => {
      const stepOutputs = {};
${steps}
      return stepOutputs;
    }
  );
}
`;
```

**parallel（并行执行）**：
```typescript
export const parallelTemplate = (
  name: string,
  workflowVersion: string,
  bindings: string,
  stepPromises: string,
  resultAssignments: string
) => `
import { defineWorkflow } from 'openworkflow';

export function buildWorkflow(runtime) {
  const { agentStep, browserStep, notificationStep } = runtime;

  return defineWorkflow(
    { name: '${name}', version: '${workflowVersion}' },
    async ({ input, step, run }) => {
      const stepOutputs = {};
      const [${bindings}] = await Promise.all([
${stepPromises}
      ]);
${resultAssignments}
      return stepOutputs;
    }
  );
}
`;
```

**注意**：parallel 模板不能退化成匿名 `results[]`。编译器必须保留 `stepId -> 变量名 -> stepOutputs[stepId]` 的稳定映射，才能支撑后续 `steps.<stepId>.output` 引用。

**conditional（条件分支）**：
```typescript
export const conditionalTemplate = (
  name: string,
  workflowVersion: string,
  condition: string,
  thenSteps: string,
  elseSteps: string
) => `
import { defineWorkflow } from 'openworkflow';

export function buildWorkflow(runtime) {
  const { agentStep, browserStep, notificationStep } = runtime;

  return defineWorkflow(
    { name: '${name}', version: '${workflowVersion}' },
    async ({ input, step, run }) => {
      const stepOutputs = {};
      const conditionResult = ${condition};

      if (conditionResult) {
${thenSteps}
      } else {
${elseSteps}
      }

      return stepOutputs;
    }
  );
}
`;
```

### 3.2 步骤模板（Phase 1）

代码生成必须走安全序列化，不能直接把 DSL 输入用 `'${...}'` 拼成源码。

```typescript
function emitLiteral(value: unknown): string {
  return JSON.stringify(value);
}
```

**agentStep**：
```typescript
export const agentStepTemplate = (stepId: string, input: any) => `
    const ${stepId}Result = await step.run(
      { name: ${emitLiteral(stepId)} },
      () => agentStep(${emitLiteral(input)})
    );
    stepOutputs[${emitLiteral(stepId)}] = ${stepId}Result;
`;
```

**browserStep**：
```typescript
export const browserStepTemplate = (stepId: string, input: any) => `
    const ${stepId}Result = await step.run(
      { name: ${emitLiteral(stepId)} },
      () => browserStep(${emitLiteral(input)})
    );
    stepOutputs[${emitLiteral(stepId)}] = ${stepId}Result;
`;
```

**notificationStep**：
```typescript
export const notificationStepTemplate = (stepId: string, input: any) => `
    const ${stepId}Result = await step.run(
      { name: ${emitLiteral(stepId)} },
      () => notificationStep(${emitLiteral(input)})
    );
    stepOutputs[${emitLiteral(stepId)}] = ${stepId}Result;
`;
```

### 3.3 并行步骤模板（用于 parallel 工作流）

并行模式下，步骤需要生成 Promise 表达式而非完整语句：

**agentStepPromise**：
```typescript
export const agentStepPromiseTemplate = (stepId: string, input: any) => ({
  bindingName: `${stepId}Result`,
  promiseExpr: `step.run({ name: ${emitLiteral(stepId)} }, () => agentStep(${emitLiteral(input)}))`,
  assignmentExpr: `stepOutputs[${emitLiteral(stepId)}] = ${stepId}Result;`
});
```

**browserStepPromise**：
```typescript
export const browserStepPromiseTemplate = (stepId: string, input: any) => ({
  bindingName: `${stepId}Result`,
  promiseExpr: `step.run({ name: ${emitLiteral(stepId)} }, () => browserStep(${emitLiteral(input)}))`,
  assignmentExpr: `stepOutputs[${emitLiteral(stepId)}] = ${stepId}Result;`
});
```

**notificationStepPromise**：
```typescript
export const notificationStepPromiseTemplate = (stepId: string, input: any) => ({
  bindingName: `${stepId}Result`,
  promiseExpr: `step.run({ name: ${emitLiteral(stepId)} }, () => notificationStep(${emitLiteral(input)}))`,
  assignmentExpr: `stepOutputs[${emitLiteral(stepId)}] = ${stepId}Result;`
});
```

### Phase 2 预留步骤类型（暂不实现）

- `http`
- `data`
- `knowledge_search`

---

## 4. 代码生成逻辑

### 4.1 核心生成函数

```typescript
interface WorkflowDSL {
  version: 'v1';
  name: string;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;
  type: string;
  dependsOn?: string[];
  when?: ConditionExpr;
  input?: Record<string, unknown>;
  policy?: {
    timeoutMs?: number;
    retry?: { maximumAttempts?: number };
  };
}

interface StepCompilerDefinition {
  type: string;
  inputSchema: JsonSchema;
  compile: (step: WorkflowStep, ctx: CompileContext) => CompiledStep;
}

async function compileWorkflowDsl(spec: WorkflowDSL): Promise<string> {
  validateWorkflowDsl(spec);
  const workflowVersion = createWorkflowVersion(spec);

  // 1. 拓扑排序并按依赖层分组
  const layers = buildExecutionLayers(spec.steps);

  // 2. 每个步骤交给对应 StepType 编译器处理
  const compiledLayers = layers.map(layer =>
    layer.map(step => resolveStepType(step.type).compile(step, { spec }))
  );

  // 3. 根据 layer 大小决定是顺序还是并行 lowering
  const body = compiledLayers
    .map(layer =>
      layer.length === 1
        ? emitSequentialLayer(layer[0])
        : emitParallelLayer(layer)
    )
    .join('\n');

  // 4. 包装成 OpenWorkflow 模块
  return wrapWorkflowModule(spec.name, workflowVersion, body);
}
```

### 4.2 Step Registry

```typescript
const STEP_REGISTRY: Record<string, StepCompilerDefinition> = {
  agent: agentStepDefinition,
  browser: browserStepDefinition,
  notification: notificationStepDefinition
};

function resolveStepType(type: string): StepCompilerDefinition {
  const definition = STEP_REGISTRY[type];
  if (!definition) {
    throw new Error(`Unknown step type: ${type}`);
  }
  return definition;
}
```

运行时加载的不是上面的编译接口，而是 `WorkflowRuntimeBindings`。`Step Registry` 是 Lumos 自己的运行时元数据；OpenWorkflow 只认最终注册进去的 `Workflow` 对象。

### 4.3 编译阶段

```typescript
// 1. DSL Schema 验证
// 2. StepType 输入校验
// 3. DAG 验证（无环）
// 4. 引用验证（只能引用 input / 已存在步骤输出）
// 5. 编译为 OpenWorkflow 模块
// 6. TypeScript 语法验证
```

---

## 5. 运行环境设置

生成的工作流代码需要在特定环境中运行。运行时的核心不是“执行任意代码”，而是“加载编译产物 + 注入已注册步骤能力”。

**运行时职责**：
- 提供 OpenWorkflow backend
- 提供 Phase 1 Step Registry 对应的运行时实现
- 提供 DSL 编译产物加载能力
- 控制步骤权限、默认重试、默认超时

```typescript
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

// 1. 初始化 backend
const backend = BackendSqlite.connect("./workflow.db");

// 2. 创建 OpenWorkflow 实例
const ow = new OpenWorkflow({ backend });

// 3. 定义步骤实现函数
async function agentStep(params: { prompt: string; role?: string }) {
  // 调用 AI Agent 执行任务
  const result = await callAgent(params);
  return result;
}

async function browserStep(params: { action: string; url?: string; selector?: string }) {
  // 调用浏览器执行操作
  const result = await executeBrowserAction(params);
  return result;
}

async function notificationStep(params: { message: string }) {
  // 发送通知
  const messageId = await sendNotification(params.message);
  return {
    success: true,
    output: { messageId: messageId ?? null }
  };
}

interface StepRuntimeDefinition {
  type: string;
  execute: (input: any, ctx: StepContext) => Promise<StepResult>;
}

// 4. Phase 1 Step Runtime Registry（Lumos 内部元数据）
const STEP_RUNTIME_REGISTRY: Record<string, StepRuntimeDefinition> = {
  agent: { type: 'agent', execute: agentStep },
  browser: { type: 'browser', execute: browserStep },
  notification: { type: 'notification', execute: notificationStep }
};

interface WorkflowRuntimeBindings {
  agentStep: typeof agentStep;
  browserStep: typeof browserStep;
  notificationStep: typeof notificationStep;
}

function createWorkflowRuntimeBindings(): WorkflowRuntimeBindings {
  return {
    agentStep: (input) => STEP_RUNTIME_REGISTRY.agent.execute(input, { stepType: 'agent' }),
    browserStep: (input) => STEP_RUNTIME_REGISTRY.browser.execute(input, { stepType: 'browser' }),
    notificationStep: (input) =>
      STEP_RUNTIME_REGISTRY.notification.execute(input, { stepType: 'notification' })
  };
}

// 5. 加载 workflow factory module，并注入 runtime bindings
// 注意：此处加载的是 MCP 编译产物，而不是用户任意上传的脚本
```

---

## 6. 实施计划

### Phase 1：核心功能（Week 1-3）

#### Week 1：DSL 与编译器基础
- [ ] 定义 `Workflow DSL v1`
- [ ] 实现 DSL 校验器
- [ ] 实现依赖图分析与 layer lowering
- [ ] 实现代码组装逻辑
- [ ] 单元测试

#### Week 2：Step Registry 与 MCP 集成
- [ ] 实现 Step Registry
- [ ] 实现 `agent / browser / notification` 编译器
- [ ] 实现 generate_workflow 工具
- [ ] Tool Schema 定义
- [ ] 代码验证逻辑
- [ ] 集成测试

#### Week 3：优化和测试
- [ ] Prompt 优化
- [ ] 端到端测试
- [ ] 性能优化
- [ ] 文档完善

### 6.1 实现复盘（2026-03-20）

**已完成**：
- `Workflow DSL v1` 类型定义与校验器
- Phase 1 Step Registry（`agent / browser / notification`）
- 依赖图 layer lowering（顺序 / 并行）
- `generate_workflow` 的核心编译逻辑
- 编译产物统一导出 `buildWorkflow(runtimeBindings)`
- MCP stdio server `workflow_mcp.mjs`
- `/api/workflow/generate` 本地 API 入口
- 编译后代码的 TypeScript 语法验证
- 正向 smoke：`initialize -> tools/list -> tools/call(generate_workflow) -> engine load -> register -> run`
- 反向 smoke：非法 DSL 通过 `validation.valid = false` 返回错误

**部分完成**：
- `browser / notification` 已具备 DSL 校验与编译能力，但当前只完成最小运行时封装，尚未补真实执行 smoke
- `generate_workflow` 已作为 MCP tool 对外提供，但当前 stdio server 通过本地 API route 代理到编译器，而不是在 server 进程内直接 import 编译器

**当前实现偏差 / 备注**：
- 文档中的“代码验证逻辑”已落地为编译后 TypeScript 语法检查；若编译产物语法非法，会通过 `validation.errors` 返回
- 当前 MCP server 是一个轻量 transport adapter，核心编译逻辑仍复用应用内 TypeScript 实现，目的是避免重复维护两份 compiler
- 端到端闭环已跑通单步 `agent` workflow；复杂条件分支、并行引用与多 step runtime smoke 仍待后续补充

### Phase 2：扩展功能（待定）
- [ ] 实现 `http` StepType
- [ ] 实现 `data` StepType
- [ ] 实现 `knowledge_search` StepType
- [ ] 评估 `subworkflow` 是否需要作为 `v2` 控制流能力引入
- [ ] 扩展更多步骤类型
- [ ] 性能优化
- [ ] 文档完善

---

## 7. 优势

1. **安全边界清晰**：只接受受限 DSL，不执行任意脚本
2. **语法保证**：编译器生成，100% 正确
3. **灵活性**：LLM 仍可自由组合步骤和依赖
4. **可扩展**：新增步骤类型只需注册到 Step Registry
5. **可调试**：DSL、编译产物、运行时职责分层清晰

---

## 8. 降级策略

如果 DSL 编译方案无法满足需求：
1. 降级到简单 DSL 模板（单步 agent / 顺序模板）
2. 降级到 simple execution，不进入工作流引擎
