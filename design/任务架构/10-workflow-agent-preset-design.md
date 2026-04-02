# 10 — Workflow Agent Preset 架构设计

> 状态：草稿
> 日期：2026-03-30
> 关联文件：`src/lib/workflow/types.ts`、`src/lib/workflow/step-registry.ts`、`src/lib/workflow/subagent.ts`、`src/lib/scheduling/planner-prompt.ts`

---

## 1. 背景与问题

### 1.1 现有两套 Agent 系统

目前 Lumos 存在两套互不相关的 Agent 配置系统：

| 维度 | 主 Agent 对话预设 | Workflow 执行 Agent |
|------|-----------------|-------------------|
| 存储 | `templates` 表，`type='conversation'` | 硬编码在 `agent-config.ts` |
| 字段 | `roleKind: orchestrator\|lead\|worker`、MCP 服务器列表、工具权限 | `allowedTools: workspace.read\|write\|shell.exec`、系统提示 |
| 使用场景 | 主 Agent 对话窗口 | Workflow step 执行层 |
| 用户可配置 | 是（`/workflow/agents` 页面） | 否（仅 admin 可改 JSON 设置） |
| Planner 可感知 | 否 | 否 |

### 1.2 核心痛点

1. **Planner 盲区**：LLM Planner 生成 DSL 时只能输出 `role: 'worker' | 'researcher' | 'coder' | 'integration'`，无法引用用户定义的 Agent 预设（如"飞书数据分析专员"、"代码审查员"）。

2. **用户预设无法作用于 Workflow**：用户在 `/workflow/agents` 页面创建的预设走的是主 Agent 对话系统，实际 Workflow 执行时完全不读取这些配置。

3. **扩展困难**：新增一种 Workflow Agent 角色需要同时修改 `types.ts`（union type）、`agent-config.ts`（hardcoded config）、`planner-types.ts`（Zod enum）、`step-registry.ts`（Zod enum）——四处联动，极易遗漏。

### 1.3 OpenWorkflow 约束

Lumos 的 Workflow 引擎基于 OpenWorkflow（v0.8.1）。DSL 在 `compiler.ts` 中被编译为 JS 模块后提交给 OpenWorkflow Worker 执行。`step-registry.ts` 中的 `agentStepInputSchema` 使用 `.strict()` 校验：

```typescript
// src/lib/workflow/step-registry.ts
const agentStepInputSchema = z.object({
  prompt: z.string().min(1),
  role: z.enum(supportedWorkflowAgentRoleValues).optional(),
  model: ..., tools: ..., outputMode: ..., context: ...
}).strict();  // ← 任何未声明字段都会导致编译报错
```

因此，向 `AgentStepInput` 添加任何新字段，必须在三处同步更新：

| 文件 | 作用 |
|------|------|
| `src/lib/workflow/types.ts` | TypeScript 接口定义（运行时） |
| `src/lib/workflow/step-registry.ts` | Zod 校验（OpenWorkflow 编译层） |
| `src/lib/scheduling/planner-types.ts` | Zod 校验（Planner 输出校验层） |

---

## 2. 设计目标

1. **单一系统**：只有一套 Workflow Agent 预设，不再区分"主 Agent 预设"与"Workflow 执行预设"。
2. **Planner 可感知**：LLM Planner 可在 DSL 中通过 `preset` 字段引用具名预设，用于语义化指定执行角色。
3. **向下兼容**：现有 `role` 字段继续生效，作为回退机制；历史 DSL 无需修改。
4. **用户可扩展**：用户可在 UI 中创建、编辑、删除自定义 Workflow Agent 预设。
5. **内置预设不可删除**：4 个内置角色（worker/researcher/coder/integration）作为 `category='builtin'` 预设，不允许删除，可覆盖参数。

---

## 3. 数据模型

### 3.1 复用 `templates` 表

沿用现有 `templates` 表，新增 `type='workflow-agent'`。

**实际表结构**（`migrations-lumos.ts:460`，不可修改）：

```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                          -- 新增取值 'workflow-agent'
  category TEXT NOT NULL DEFAULT 'builtin',    -- 'builtin' | 'user'
  content_skeleton TEXT NOT NULL DEFAULT '',   -- JSON，存放完整预设配置
  system_prompt TEXT NOT NULL DEFAULT '',      -- workflow-agent 类型不使用
  opening_message TEXT NOT NULL DEFAULT '',    -- workflow-agent 类型不使用
  ai_config TEXT NOT NULL DEFAULT '{}',        -- workflow-agent 类型不使用
  icon TEXT NOT NULL DEFAULT '📄',
  description TEXT NOT NULL DEFAULT '',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**注意**：表中没有 `is_enabled` 和 `sort_order` 列。预设启用/排序功能需通过 `content_skeleton` JSON 内部字段实现，不新增表列，避免 migration。

### 3.2 content_skeleton JSON 结构

遵循现有 `agent-presets.ts` 的 discriminator 模式（`kind` + `version`）：

```typescript
interface WorkflowAgentPresetRecord {
  kind: 'workflow-agent-preset';  // discriminator
  version: 1;

  // 运行时配置（对应 AgentStepInput 可注入字段）
  role?: 'worker' | 'researcher' | 'coder' | 'integration';
  systemPrompt?: string;          // 完整 system prompt，内置预设从 DEFAULT_WORKFLOW_AGENT_CONFIGS 继承
  model?: string;
  allowedTools?: ('workspace.read' | 'workspace.write' | 'shell.exec')[];
  outputMode?: 'structured' | 'plain-text';
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;

  // Planner 感知字段
  expertise: string;              // 一句话描述，供 Planner 理解何时使用该预设（必填）

  // 执行层配置
  timeoutMs?: number;
  maxRetries?: number;

  // 内部控制（替代不存在的表列）
  isEnabled?: boolean;            // 默认 true
  sortOrder?: number;
}
```

**与现有 conversation preset 的区别**：conversation preset 使用 `kind: 'main-agent-agent-preset'`，workflow-agent preset 使用 `kind: 'workflow-agent-preset'`，两者通过 `type` 列 + `kind` 字段双重区分。

### 3.3 WorkflowAgentPresetConfig（对外接口）

DB 模块对外暴露的配置接口，从 `WorkflowAgentPresetRecord` 中剥离 discriminator 和内部控制字段：

```typescript
interface WorkflowAgentPresetConfig {
  role?: 'worker' | 'researcher' | 'coder' | 'integration';
  systemPrompt?: string;
  model?: string;
  allowedTools?: ('workspace.read' | 'workspace.write' | 'shell.exec')[];
  outputMode?: 'structured' | 'plain-text';
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  expertise: string;
  timeoutMs?: number;
  maxRetries?: number;
}
```

`parseWorkflowAgentPresetRecord()` 负责从 `content_skeleton` JSON 解析出 `WorkflowAgentPresetRecord`，验证 `kind='workflow-agent-preset'` 后提取为 `WorkflowAgentPresetConfig`（去掉 `kind`、`version`、`isEnabled`、`sortOrder`）。`isEnabled` 和 `sortOrder` 提升到 `WorkflowAgentPreset` 接口的顶层字段。

### 3.4 内置预设种子数据

内置预设使用可读 ID（非 UUID），方便 DSL 中引用和调试：

| preset id | name | role | expertise |
|-----------|------|------|-----------|
| `builtin-worker` | 通用执行者 | worker | 执行通用工作流步骤，适合代码编写、文件操作、shell 命令 |
| `builtin-researcher` | 研究员 | researcher | 只读分析和归纳，适合从已有上下文中提炼事实、生成摘要 |
| `builtin-coder` | 代码专家 | coder | 仓库内代码实现和代码级分析，适合编写、修改、审查代码 |
| `builtin-integration` | 集成专员 | integration | 准备集成载荷和交付说明，适合 API 对接、消息组装、格式转换 |

**排除 `scheduling` 角色**：scheduling 是 Planner 自身使用的角色（在 `planner.ts` 中通过 `getSchedulingPlannerConfig()` 读取），不参与 workflow step 执行，因此不作为预设暴露给用户或 Planner。

`systemPrompt` 和 `allowedTools` 从 `DEFAULT_WORKFLOW_AGENT_CONFIGS` 中对应角色的值复制，作为种子初始值。

---

## 4. Schema 变更（三处同步）

### 4.1 `src/lib/workflow/types.ts`

```typescript
// 变更：添加 preset 字段
export interface AgentStepInput extends WorkflowStepRuntimeCarrier {
  prompt: string;
  preset?: string;              // ← 新增：WorkflowAgentPreset.id
  role?: WorkflowAgentRole;
  model?: string;
  tools?: string[];
  context?: Record<string, unknown>;
  outputMode?: 'structured' | 'plain-text';
}
```

### 4.2 `src/lib/workflow/step-registry.ts`

```typescript
// 变更：在 agentStepInputSchema 中添加 preset
const agentStepInputSchema: z.ZodType<Record<string, unknown>> = z.object({
  prompt: z.string().min(1),
  preset: z.string().min(1).optional(),   // ← 新增
  role: z.enum(supportedWorkflowAgentRoleValues).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();
```

### 4.3 `src/lib/scheduling/planner-types.ts`

```typescript
// 变更：在 plannerAgentStepInputSchema 中添加 preset
export const plannerAgentStepInputSchema = z.object({
  prompt: z.string().min(1),
  preset: z.string().min(1).optional(),   // ← 新增
  role: z.enum(['worker', 'researcher', 'coder', 'integration', 'general']).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();
```

---

## 5. 运行时解析链

`src/lib/workflow/subagent.ts` 中的 `resolveWorkflowAgentDefinition()` 按以下优先级解析。

**注意**：此函数保持同步（better-sqlite3 全程同步），不引入 async。

```
input.preset (有值)
  └─ DB 查询 getWorkflowAgentPreset(id)（同步）
       ├─ 找到 → 用 preset 作为 base config，DSL input 字段可覆盖（见下方合并规则）
       └─ 未找到 → 警告日志 + 回退到 input.role

input.role (有值或 preset 未找到)
  └─ getWorkflowExecutionRoleConfig(role)
       └─ 找不到 → 'worker' 默认配置

最终结果：ResolvedWorkflowAgentDefinition（system prompt、工具列表、超时等）
```

### 5.1 合并规则

当 `input.preset` 指向有效预设时：

| 字段 | 来源 | 说明 |
|------|------|------|
| `systemPrompt` | preset | 完整 system prompt，不与默认值拼接 |
| `allowedTools` | preset | preset 定义的工具白名单 |
| `capabilityTags` | preset | |
| `memoryPolicy` | preset | |
| `concurrencyLimit` | preset | |
| `model` | DSL input 优先，preset 回退 | DSL 可以覆盖 preset 的模型选择 |
| `tools` | DSL input 优先，preset 回退 | DSL 可以缩小/替换 prompt capability 列表 |
| `outputMode` | DSL input 优先，preset 回退 | |
| `prompt` | DSL input（必填） | preset 不提供 prompt |
| `context` | DSL input | preset 不提供 context |

简而言之：**preset 提供"这个 agent 是谁"（身份配置），DSL input 提供"这次要做什么"（任务参数）**。DSL input 中的 `model`、`tools`、`outputMode` 可以覆盖 preset 的对应值。

代码示意：

```typescript
// src/lib/workflow/subagent.ts（同步）
function resolveWorkflowAgentDefinition(input: AgentStepInput): ResolvedWorkflowAgentDefinition {
  if (input.preset) {
    const preset = getWorkflowAgentPreset(input.preset);
    if (preset) {
      return buildDefinitionFromPreset(preset, input);
    }
    console.warn(`[subagent] Preset '${input.preset}' not found, falling back to role`);
  }

  // 现有逻辑不变：role → getWorkflowExecutionRoleConfig → 默认 worker
  const role = resolveWorkflowAgentRole(input.role);
  const roleDefinition = getWorkflowExecutionRoleConfig(role);
  // ...
}

// buildDefinitionFromPreset 需要复制现有 role 路径的 prompt capability 注入逻辑：
function buildDefinitionFromPreset(
  preset: WorkflowAgentPreset,
  input: AgentStepInput,
): ResolvedWorkflowAgentDefinition {
  const baseSystemPrompt = preset.config.systemPrompt || '';
  // 与 role 路径一致：将 input.tools 中的 prompt capability 拼接到 system prompt
  const capabilityPrompt = buildPromptCapabilitiesSystemPrompt(input.tools);
  const enhancedSystemPrompt = baseSystemPrompt + capabilityPrompt;
  // ... 构建 binding，应用合并规则
}
```

---

## 6. agent-config.ts 的处置方案

### 6.1 现状

`agent-config.ts`（460 行）包含：
- `DEFAULT_WORKFLOW_AGENT_CONFIGS`：5 个角色的硬编码定义（含 scheduling）
- `WorkflowAgentRoleOverrideStore`：通过 `settings` 表存储的 JSON 覆盖层
- `getWorkflowExecutionRoleConfig(role)`：被 `subagent.ts` 调用
- `getSchedulingPlannerConfig()`：被 `planner.ts` 调用

### 6.2 迁移策略：渐进替代，不一次性删除

**Phase 1**：preset 与 agent-config 共存

- `resolveWorkflowAgentDefinition()` 新增 preset 查询路径（优先于 role 路径）
- `getWorkflowExecutionRoleConfig()` 保留，作为 `role` 回退路径
- `getSchedulingPlannerConfig()` 完全不受影响（scheduling 不是预设）
- 现有 `settings` 表覆盖继续生效（通过 role 回退路径）

**Phase 2**（后续版本）：合并覆盖层

- 种子内置预设时，检查 `settings` 表中 `workflow_agent_role_overrides_v1` 是否有覆盖
- 如果有，将覆盖值合并到对应 builtin preset 的 `content_skeleton` 中
- 合并完成后清除 `settings` 表中的旧覆盖条目
- `DEFAULT_WORKFLOW_AGENT_CONFIGS` 中 4 个执行角色的定义降级为"种子模板"，仅在首次 seed 时使用

**不在 Phase 1 删除 `agent-config.ts` 的原因**：
- scheduling 角色的配置仍然需要 `agent-config.ts`
- 现有 UI 的角色配置页面（`/workflow/agents/roles`）仍在使用 `listWorkflowAgentRoleProfiles()`
- 已有用户可能存储了覆盖，需要平滑迁移

---

## 7. Planner 集成

### 7.1 新增 `buildWorkflowAgentPlanningContext()`

在 `src/lib/scheduling/planner-capabilities.ts` 中添加：

```typescript
export interface WorkflowAgentPlanningContext {
  available: WorkflowAgentPresetSummary[];
}

export interface WorkflowAgentPresetSummary {
  id: string;
  name: string;
  expertise: string;
  category: 'builtin' | 'user';
}

export function buildWorkflowAgentPlanningContext(): WorkflowAgentPlanningContext {
  const presets = listPublishedWorkflowAgentPresets();
  return {
    available: presets.map((p) => ({
      id: p.id,
      name: p.name,
      expertise: p.config.expertise,
      category: p.category,
    })),
  };
}
```

### 7.2 注入 Planner Prompt（四处变更）

在 `buildPlannerUserPrompt()` 中需要修改三处：

**a) 新增 `availableAgents` 段**：

```
## Available Workflow Agent Presets
Use the `preset` field in agent steps to reference these presets by id.
If no suitable preset exists, omit `preset` and use `role` instead.

- builtin-worker (通用执行者): 执行通用工作流步骤，适合代码编写、文件操作、shell 命令
- builtin-researcher (研究员): 只读分析和归纳，适合从已有上下文中提炼事实、生成摘要
- [user-defined presets...]
```

**b) 更新 `responseSchema` 中的 step input 描述**（现有 line 117）：

```diff
  input: {
    prompt: 'string',
+   preset: 'optional preset id from availableAgents',
    role: 'optional worker | researcher | coder | integration',
    ...
  },
```

**c) 更新 `workflowDslConstraints` 规则**（现有 line 82）：

```diff
- 'Agent step input only supports: prompt, role, model, tools, outputMode, context.',
+ 'Agent step input only supports: prompt, preset, role, model, tools, outputMode, context.',
```

**d) 更新 `workflowExamples` 至少一处使用 `preset`**：

当前两个示例全部使用 `role`。LLM 从示例学习 DSL 结构的权重极高——如果所有示例都只用 `role`，Planner 会倾向于忽略 `preset`。至少将 `browserSearchSynthesis` 示例中的 `role: 'researcher'` 步骤改为 `preset: 'builtin-researcher'`：

```diff
  {
    id: 'analyze',
    type: 'agent',
    input: {
      prompt: 'Analyze the research task and define evidence collection scope.',
-     role: 'researcher',
+     preset: 'builtin-researcher',
    },
  },
```

### 7.3 Planner 输出示例

```json
{
  "strategy": "workflow",
  "workflowDsl": {
    "version": "v1",
    "name": "analyze-and-report",
    "steps": [
      {
        "id": "research",
        "type": "agent",
        "input": {
          "prompt": "收集相关资料",
          "preset": "builtin-researcher"
        }
      },
      {
        "id": "report",
        "type": "agent",
        "dependsOn": ["research"],
        "input": {
          "prompt": "整理成报告",
          "preset": "user-custom-report-writer"
        }
      }
    ]
  }
}
```

---

## 8. DB 模块设计

新建 `src/lib/db/workflow-agent-presets.ts`（复用 `templates` 表，200 行以内）：

```typescript
export interface WorkflowAgentPreset {
  id: string;
  name: string;
  description: string;
  category: 'builtin' | 'user';
  config: WorkflowAgentPresetConfig;
  isEnabled: boolean;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

// 从 content_skeleton JSON 解析，需验证 kind='workflow-agent-preset'
export function parseWorkflowAgentPresetRecord(raw: unknown): WorkflowAgentPresetConfig | null;

export function listWorkflowAgentPresets(): WorkflowAgentPreset[];
export function listPublishedWorkflowAgentPresets(): WorkflowAgentPreset[];  // isEnabled !== false
export function getWorkflowAgentPreset(id: string): WorkflowAgentPreset | undefined;
export function createWorkflowAgentPreset(data: CreateWorkflowAgentPresetInput): WorkflowAgentPreset;
export function updateWorkflowAgentPreset(id: string, data: UpdateWorkflowAgentPresetInput): WorkflowAgentPreset;
export function deleteWorkflowAgentPreset(id: string): void;  // 拒绝删除 category='builtin'
export function seedBuiltinWorkflowAgentPresets(): void;       // 幂等，INSERT OR IGNORE
```

所有函数同步（better-sqlite3）。`seedBuiltinWorkflowAgentPresets()` 在应用启动时由 `init-builtin-resources.ts` 调用。

---

## 9. UI 变更

### 9.1 `/workflow/agents` 页面重构

**当前问题**：`AgentPresetList` 使用主 Agent 对话预设的 schema（`roleKind`, `mcpServers`），完全不适用于 Workflow 执行语境。

**变更方向**：
- 替换为 `WorkflowAgentPresetList` 组件
- 内置预设：展示完整配置，支持修改 `systemPrompt`、`allowedTools`、`timeoutMs`（写入 `content_skeleton`）
- 用户预设：完整 CRUD，`expertise` 字段为必填（供 Planner 理解）
- 展示每个预设的 `id`（供用户在手动编写 DSL 时引用）

### 9.2 API 路由

复用 `src/app/api/workflow/agent-presets/` 目录，更新 handler 调用新的 DB 模块。

---

## 10. 实施计划

### Phase 1 — 后端基础（优先）

1. `src/lib/db/workflow-agent-presets.ts` — DB CRUD 模块 + `seedBuiltinWorkflowAgentPresets()`
2. `src/lib/workflow/types.ts` — 添加 `preset?: string` 到 `AgentStepInput`
3. `src/lib/workflow/step-registry.ts` — `agentStepInputSchema` 添加 `preset`
4. `src/lib/scheduling/planner-types.ts` — `plannerAgentStepInputSchema` 添加 `preset`
5. `src/lib/workflow/subagent.ts` — `resolveWorkflowAgentDefinition()` 新增 preset 查询路径（含 `buildPromptCapabilitiesSystemPrompt` 注入）
6. `src/lib/scheduling/planner-validation.ts` — `validatePlannerWorkflowSemantics()` 适配 preset（见下方说明）
7. `src/lib/init-builtin-resources.ts` — 调用 `seedBuiltinWorkflowAgentPresets()`
8. `src/lib/scheduling/planner-capabilities.ts` — 新增 `buildWorkflowAgentPlanningContext()`
9. `src/lib/scheduling/planner.ts` — `resolveSchedulingPlan()` 调用 `buildWorkflowAgentPlanningContext()` 并传给 `buildPlannerUserPrompt()`
10. `src/lib/scheduling/planner-prompt.ts` — `buildPlannerUserPrompt()` 新增 `agentContext` 参数，注入 `availableAgents` 段 + 更新 responseSchema + 更新 constraints + 更新 workflowExamples

**planner-validation.ts 适配说明**：

`validatePlannerWorkflowSemantics()` 中 researcher 写保护规则（line 51-53）当前只检查 `input.role`：

```typescript
const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
if (role === 'researcher' && promptRequestsFileWrite(prompt)) { ... }
```

当 Planner 输出 `preset: 'builtin-researcher'` 而省略 `role` 时，此校验被绕过。需要扩展为同时检查 preset 所对应的 role：

```typescript
const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
const presetRole = typeof input.preset === 'string'
  ? resolvePresetRole(input.preset)  // 同步查 DB，返回 preset.config.role 或 undefined
  : undefined;
const effectiveRole = role || presetRole || '';
if (effectiveRole === 'researcher' && promptRequestsFileWrite(prompt)) { ... }
```

`resolvePresetRole()` 为轻量函数，只读取 preset 的 `config.role` 字段，不构建完整定义。

### Phase 2 — 测试验证

- 更新 `src/lib/scheduling/__tests__/api.test.ts` — 验证 preset 字段透传
- 新增 `src/lib/db/__tests__/workflow-agent-presets.test.ts` — CRUD + seed 测试
- 手动测试 Planner 输出含 `preset` 的 DSL

### Phase 3 — UI 重构 + 覆盖迁移

- 新建 `src/components/workflow/WorkflowAgentPresetList.tsx`
- 更新 `/workflow/agents` 页面
- 更新 `src/app/api/workflow/agent-presets/` 路由
- 实现 `settings` 表覆盖 → builtin preset `content_skeleton` 的一次性迁移

---

## 11. 不在范围内

- 主 Agent 对话预设系统不受此设计影响，`type='conversation'` 的记录继续由现有 `agent-presets.ts` 管理
- `agent-config.ts` 在 Phase 1 保留，不删除（scheduling 角色仍依赖它，且需平滑迁移覆盖数据）
- Workflow DSL 中 `role` 字段不废弃，保持向后兼容
- 不引入 `preset` 的必填约束（始终可选，降低迁移成本）
- `scheduling` 角色不作为预设暴露（它是 Planner 自身的角色，不参与 step 执行）
