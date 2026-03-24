# SubAgent Layer 设计文档

## 1. 模块定位

SubAgent Layer 是任务执行架构的**资源层**，提供 Agent 执行能力。

**职责**：
- 定义 Agent 角色类型
- 提供 agentStep 接口供 Workflow 调用
- 管理 Agent 配置（Prompt、Tools、资源限制）

**不负责**：
- 任务分析和决策（由 Scheduling Layer 负责）
- 工作流编排（由 Workflow Engine 负责）
- 任务状态管理（由 Task Management 负责）

---

## 2. Agent 角色类型

### 2.1 Scheduling Agent（调度代理）

**职责**：分析任务、生成工作流、监控执行

**System Prompt**：

```markdown
# Role: Scheduling Agent

你是项目经理，负责分析任务并生成工作流。

## 职责
1. 分析任务复杂度
2. 决定执行策略（简单执行 vs 工作流）
3. 使用 Workflow MCP 生成工作流
4. 监控执行进度

## 可用工具
- Workflow MCP: generate_workflow
- Task Management API: updateTaskStatus

## 决策规则
- 单步任务 → 直接执行
- 多步任务 → 生成工作流
- 需要并行 → 使用并行工作流

## 约束
- 不执行具体工作
- 不直接调用外部 API
- 专注于规划和协调
```

---

### 2.2 Worker Agent（工作代理）

**职责**：执行单一任务、调用工具、返回结果

**System Prompt**：

```markdown
# Role: Worker Agent

你是工作代理，负责执行具体任务。

## 职责
1. 执行分配的任务
2. 调用适当的工具
3. 返回结构化结果

## 可用工具
{{tools}}

## 任务上下文
{{task_description}}

## 输出格式
{{output_format}}

## 约束
- 只执行分配的任务
- 不做分析或规划
- 按指定格式返回结果
```

---

### 2.3 Research Agent（研究代理）

**职责**：信息搜索、数据分析、结果摘要

**适用场景**：
- 网络搜索
- 文档分析
- 竞品调研

---

### 2.4 Code Agent（代码代理）

**职责**：代码生成、代码审查、测试编写

**适用场景**：
- 代码生成
- 代码重构
- 测试编写

---

### 2.5 Integration Agent（集成代理）

**职责**：第三方服务集成、API 调用、消息通知

**适用场景**：
- 飞书集成
- 浏览器操作
- 消息通知

---

## 3. agentStep 实现

### 3.1 核心接口

```typescript
// Agent 配置
interface AgentConfig {
  systemPrompt?: string;
  tools?: string[];
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

// Agent 结果
interface AgentResult {
  success: boolean;
  output: any;
  error?: string;
}

interface AgentStepInput {
  prompt: string;
  role?: AgentRole;
  tools?: string[];
  model?: string;
  timeoutMs?: number;
}

// agentStep 函数
async function agentStep(input: AgentStepInput): Promise<AgentResult> {
  // 1. 创建 Agent Session
  const session = await createAgentSession(input.role, {
    tools: input.tools,
    model: input.model,
    timeoutMs: input.timeoutMs
  });

  // 2. 执行任务
  const result = await session.execute(input.prompt);

  // 3. 返回结果
  return result;
}
```

**接口约定**：
- `agentStep` 采用对象入参，便于与 `browserStep`、`notificationStep` 保持一致
- `role` 是可选扩展字段，当前最小实现至少需要 `prompt`
- Workflow 中调用时始终通过 `step.run({ name }, () => agentStep(...))` 包装为 durable step

### 3.2 使用示例

```typescript
// 在 Workflow 中使用
const workflow = ow.defineWorkflow(
  { name: 'analyze-doc' },
  async ({ input, step }) => {
    // 步骤1：研究代理搜索信息
    const searchResult = await step.run({ name: 'search' }, () =>
      agentStep({ role: 'researcher', prompt: '搜索关于 OpenWorkflow 的信息' })
    );

    // 步骤2：代码代理生成示例
    const codeResult = await step.run({ name: 'generate' }, () =>
      agentStep({ role: 'coder', prompt: `根据以下信息生成代码示例：${searchResult.output}` })
    );

    // 步骤3：集成代理发送通知
    await step.run({ name: 'notify' }, () =>
      agentStep({ role: 'integration', prompt: '发送飞书通知：代码已生成' })
    );

    return { searchResult, codeResult };
  }
);
```

---

## 4. Agent 配置管理

### 4.1 System Prompt 模板

```typescript
interface PromptTemplate {
  role: AgentRole;
  template: string;
  variables: string[];
}

// 模板变量替换
function renderPrompt(template: PromptTemplate, vars: Record<string, any>): string {
  let prompt = template.template;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replace(`{{${key}}}`, String(value));
  }
  return prompt;
}
```

### 4.2 Tools 配置

```typescript
interface ToolConfig {
  mcpServers?: string[];      // MCP 服务器列表
  builtinTools?: string[];    // 内置工具列表
}

// 按角色预设工具
const ROLE_TOOLS: Record<AgentRole, ToolConfig> = {
  researcher: {
    mcpServers: ['web-search', 'feishu'],
    builtinTools: ['read_file']
  },
  coder: {
    builtinTools: ['read_file', 'write_file', 'search_code']
  },
  integration: {
    mcpServers: ['feishu', 'chrome-devtools']
  }
};
```

### 4.3 资源限制

```typescript
interface ResourceLimits {
  timeout: number;           // 超时时间（ms）
  maxRetries: number;        // 最大重试次数
  maxConcurrency: number;    // 最大并发数
}

// 默认限制
const DEFAULT_LIMITS: ResourceLimits = {
  timeout: 300000,           // 5分钟
  maxRetries: 3,
  maxConcurrency: 5
};
```

---

## 5. 错误处理

### 5.1 重试策略

```typescript
async function executeWithRetry(
  fn: () => Promise<AgentResult>,
  maxRetries: number
): Promise<AgentResult> {
  let lastError: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        await sleep(1000 * Math.pow(2, i)); // 指数退避
      }
    }
  }

  return {
    success: false,
    output: null,
    error: lastError.message
  };
}
```

### 5.2 超时处理

```typescript
async function executeWithTimeout(
  fn: () => Promise<AgentResult>,
  timeout: number
): Promise<AgentResult> {
  const timeoutPromise = new Promise<AgentResult>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), timeout)
  );

  return Promise.race([fn(), timeoutPromise]);
}
```

---

## 6. 实施计划

### Phase 1：核心实现（1周）
- [ ] agentStep 函数实现
- [ ] 5种 Agent 角色的 System Prompt
- [ ] Agent Session 管理

### Phase 2：配置系统（1周）
- [ ] Prompt 模板引擎
- [ ] Tools 配置加载
- [ ] 资源限制实现

### Phase 3：集成测试（1周）
- [ ] 与 Workflow Engine 集成
- [ ] 错误处理和重试
- [ ] 端到端测试

---

## 7. 参考文档

- `03-scheduling-layer-design.md` - Scheduling Layer 设计
- `04-workflow-mcp-design.md` - Workflow MCP 设计
- `05-workflow-engine-design.md` - Workflow Engine 设计

---

## 8. 实现复盘（2026-03-20）

**已完成**：
- `workflow/steps/agentStep.ts` 已从简单 mock 替换为真实的 workflow-side SubAgent runtime adapter
- 新增 `src/lib/workflow/subagent.ts`，将 doc 06 的 workflow 角色映射到受控 `StageExecutionPayloadV1 / AgentExecutionBindingV1` 契约，再复用现有 `team-run/StageWorker`
- Scheduling Layer 的 `simple execution fallback` 已直接复用同一套 runtime，不再只服务于 Workflow Engine
- `researcher / coder / integration` 三个文档角色已落到运行时；同时新增 `worker` 作为最小默认执行角色，供单步 task workflow 使用
- 为兼容已有单步调度模板，`general` 只作为 legacy alias 保留在校验层，新生成 DSL 已改为使用 `worker`
- compiler 现在会给每个 step 注入内部 `__runtime` context，至少包含：
  - `workflowRunId`
  - `stepId`
  - `stepType`
- `agentStep` 现在可以拿到稳定 `stepId`，并把它回写到 step result metadata，和 doc 05 的执行投影保持一致
- SubAgent workspace 已按最小修正方案落地：
  - `sessionWorkspace` 指向当前项目工作目录，而不是空的临时目录
  - `runWorkspace / stageWorkspace / artifactOutputDir` 落在 `LUMOS_DATA_DIR/workflow-agent-runs/...`
- 受控执行模式已落地：
  - `LUMOS_WORKFLOW_AGENT_STEP_MODE=claude` 强制真实 Claude 执行
  - `LUMOS_WORKFLOW_AGENT_STEP_MODE=synthetic` 强制 synthetic fallback
  - 默认 `auto`：检测到 Anthropic 凭据则走 `claude`，否则走 `synthetic`
- 为真实 cancel smoke 增加了仅测试用途的 synthetic 延迟钩子 `LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS`，用于稳定复现“step 执行中取消”而不扩展 DSL
- `StageWorker` 现已持有可传播的 `AbortController`，并把 cancel 信号继续传给 Claude SDK
- workflow-side subagent runtime 已维护活动执行注册表；`simple execution` 与 Workflow Engine cancel 都会向活动中的 agent step 发送中断信号
- 已补最小验证：
  - `src/lib/workflow/__tests__/subagent.test.ts`
  - `src/lib/workflow/__tests__/compiler-context.test.ts`
  - `src/lib/workflow/workflow-cancel.smoke.ts`

**部分完成**：
- `integration` 角色当前只负责生成集成相关结果，不直接开放浏览器/通知副作用；这些能力仍严格留在 `browserStep / notificationStep`
- 文档里的“Agent Session 管理”没有单独做一层新会话系统，当前直接复用 `StageWorker` 作为最小可运行执行单元
- 取消能力虽然已下传到底层执行体，但更完整的代理生命周期、独立会话语义和配置系统仍未全部补齐

**当前实现偏差 / 冲突点**：
- **角色体系冲突**：
  - doc 06 使用 `researcher / coder / integration`
  - 现有 `team-run` 编译产物使用 `main_agent / orchestrator / lead / worker`
  - 最小修正方案不是重写 `team-run` taxonomy，而是在 workflow 侧增加一层 role catalog，把 doc 06 角色映射到受控 `AgentExecutionBindingV1`
- **workspace 冲突**：
  - 直接复用 `StageWorker` 时，如果不给 `sessionWorkspace` 真实项目目录，agent 会在空目录里执行
  - 当前实现按 OpenWorkflow/Workflow 场景单独组装 workspace，保留 `StageWorker` 约束，同时把代码库上下文暴露给 agent
- **DSL 边界控制**：
  - 文档示例里的 `timeoutMs` 仍没有下放到 `agentStep.input`
  - 当前继续沿用 doc 04 / doc 05 已确定的做法：超时通过 workflow step `policy.timeoutMs` 表达，避免在 DSL v1 上提前扩字段
- **工具配置边界**：
  - `input.tools` 目前只允许安全映射到既有 runtime capabilities（例如 `read_file -> workspace.read`）
  - 不接受任意工具名直通 Claude SDK，更不会开放任意脚本执行边界

**全面 review 结论**：
- doc 06 的 Phase 1 最小目标已经落地到真实代码，不再停留在“未来要做的 Agent Session”层面
- 当前最关键的设计冲突都已经有代码级修正方案，而不是抽象讨论：
  - 角色体系冲突：通过 workflow-side role catalog 解耦
  - workspace 冲突：通过 `sessionWorkspace=project cwd` 修正
  - 无凭据环境：通过 `synthetic` fallback 保住最小闭环
- 真实 running-cancel 验证已经补齐，而且 cancel 已继续下传到 `StageWorker / Claude SDK`，说明 doc 06 在“状态取消 + 执行体中断”这条核心链路上已经成立
- 当前最值得继续做的，不是扩角色或扩 DSL，而是把独立会话管理、配置系统、资源限制这些 doc 06 的剩余尾项继续收口
