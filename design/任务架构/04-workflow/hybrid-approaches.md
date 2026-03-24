# 混合方案设计：结合 LLM 灵活性和模板可靠性

## 1. 背景

**核心挑战**：
- LLM 直接生成 OpenWorkflow 代码：灵活但不可靠（语法错误、API 误用）
- 纯模板方案：可靠但不灵活（无法处理复杂需求）

**目标**：设计混合方案，平衡灵活性和可靠性

---

## 2. 方案一：模板库 + 参数填充

### 2.1 核心思路

预定义常见工作流模板，LLM 只需：
1. 选择合适的模板
2. 填充参数（URL、prompt、选择器等）

### 2.2 架构设计

```typescript
// 模板定义
interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  params: ParamDefinition[];
  generate: (params: Record<string, any>) => string;
}

// 参数定义
interface ParamDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  required: boolean;
  default?: any;
}
```

### 2.3 模板示例

**模板 1：数据采集**
```typescript
{
  id: 'data-collection',
  name: '数据采集工作流',
  description: '从网页采集数据并分析',
  params: [
    { name: 'url', type: 'string', required: true },
    { name: 'selector', type: 'string', required: true },
    { name: 'analysisPrompt', type: 'string', required: true }
  ],
  generate: (params) => `
import { OpenWorkflow } from 'openworkflow';

const ow = new OpenWorkflow({ backend });

const workflow = ow.defineWorkflow(
  { name: '${params.name}' },
  async ({ input, step }) => {
    await step.run({ name: 'navigate' }, async () => {
      return await browserStep({
        action: 'navigate',
        url: '${params.url}'
      });
    });

    const data = await step.run({ name: 'extract' }, async () => {
      return await agentStep('researcher',
        '从页面提取数据：${params.selector}'
      );
    });

    const analysis = await step.run({ name: 'analyze' }, async () => {
      return await agentStep('researcher',
        '${params.analysisPrompt}\\n\\n数据：' + data.output
      );
    });

    return analysis;
  }
);

export default workflow;
`
}
```

**模板 2：定时报告**
```typescript
{
  id: 'scheduled-report',
  name: '定时报告工作流',
  params: [
    { name: 'reportType', type: 'string', required: true },
    { name: 'dataSources', type: 'array', required: true },
    { name: 'notifyChannel', type: 'string', required: true }
  ],
  generate: (params) => `
// 生成定时报告代码...
`
}
```

**模板 3：并行调研**
```typescript
{
  id: 'parallel-research',
  name: '并行调研工作流',
  params: [
    { name: 'topics', type: 'array', required: true },
    { name: 'summaryPrompt', type: 'string', required: true }
  ],
  generate: (params) => `
// 生成并行调研代码...
`
}
```

### 2.4 LLM 使用流程

```
User: "创建一个工作流，从 example.com 采集数据并分析"

LLM 步骤：
1. 调用 list_workflow_templates()
2. 识别匹配的模板：data-collection
3. 提取参数：
   - url: "https://example.com"
   - selector: ".data"
   - analysisPrompt: "分析采集到的数据"
4. 调用 create_workflow_from_template({
     templateId: 'data-collection',
     name: '示例数据采集',
     params: { url, selector, analysisPrompt }
   })
5. 返回生成的代码
```

### 2.5 优势与劣势

**优势**：
- ✅ 100% 语法正确（模板预定义）
- ✅ 实现简单（字符串替换）
- ✅ 可靠性高（经过测试的模板）
- ✅ 快速生成（无需 LLM 推理代码结构）

**劣势**：
- ❌ 灵活性受限（只能使用预定义模板）
- ❌ 复杂需求难以满足（需要大量模板）
- ❌ 维护成本高（每个场景需要新模板）
- ❌ 用户体验差（无法处理自然语言的复杂意图）

### 2.6 实现难度

**难度**：⭐⭐ (低)

**开发时间**：1-2 周
- 模板引擎：2-3 天
- 5-10 个常用模板：3-5 天
- MCP 集成：2-3 天
- 测试：2-3 天

**风险**：低
- 技术成熟，无不确定性
- 主要工作是模板设计

---

## 3. 方案二：分层生成

### 3.1 核心思路

将工作流生成分为两层：
1. **高层结构**：LLM 生成步骤列表、依赖关系（JSON 格式）
2. **代码生成**：代码生成器根据结构生成 OpenWorkflow 代码

### 3.2 架构设计

```
User Input
    ↓
LLM (生成高层结构)
    ↓
Workflow Spec (JSON)
    ↓
Code Generator
    ↓
OpenWorkflow Code
```

### 3.3 中间格式定义

```typescript
// 工作流规范（中间格式）
interface WorkflowSpec {
  name: string;
  description: string;
  steps: StepSpec[];
}

interface StepSpec {
  id: string;
  name: string;
  type: 'agent' | 'browser' | 'notification';
  config: Record<string, any>;
  dependsOn?: string[];  // 依赖的步骤 ID
}

// 示例
const spec: WorkflowSpec = {
  name: '数据采集工作流',
  description: '从网页采集数据并分析',
  steps: [
    {
      id: 'step1',
      name: '导航到页面',
      type: 'browser',
      config: {
        action: 'navigate',
        url: 'https://example.com'
      }
    },
    {
      id: 'step2',
      name: '提取数据',
      type: 'agent',
      config: {
        prompt: '从页面提取数据'
      },
      dependsOn: ['step1']
    },
    {
      id: 'step3',
      name: '分析数据',
      type: 'agent',
      config: {
        prompt: '分析数据：{{step2.output}}'
      },
      dependsOn: ['step2']
    }
  ]
};
```

### 3.4 代码生成器实现

```typescript
function generateWorkflowCode(spec: WorkflowSpec): string {
  const steps = spec.steps;

  // 分析依赖关系，确定并行和顺序
  const { parallel, sequential } = analyzeDependencies(steps);

  // 生成步骤代码
  const stepCode = generateSteps(steps, parallel, sequential);

  return `
import { OpenWorkflow } from 'openworkflow';

const ow = new OpenWorkflow({ backend });

const workflow = ow.defineWorkflow(
  { name: '${spec.name}' },
  async ({ input, step }) => {
${stepCode}
  }
);

export default workflow;
`;
}
```

### 3.5 优势与劣势

**优势**：
- ✅ 分离关注点（结构 vs 代码）
- ✅ LLM 只需生成 JSON（更可靠）
- ✅ 代码生成器保证语法正确
- ✅ 易于验证和调试（JSON 可读性好）

**劣势**：
- ❌ 需要设计中间格式
- ❌ 代码生成器复杂（处理依赖、并行）
- ❌ 灵活性仍受限（受中间格式约束）
- ❌ 两层转换增加复杂度

### 3.6 实现难度

**难度**：⭐⭐⭐ (中)

**开发时间**：3-4 周
- 中间格式设计：3-5 天
- 代码生成器：1-2 周
- LLM Prompt 优化：3-5 天
- 测试：1 周

**风险**：中
- 中间格式设计需要多次迭代
- 依赖分析算法复杂

---

## 4. 方案三：约束生成 + 验证

### 4.1 核心思路

通过 MCP Tool Schema 约束 LLM 输出，生成后自动验证：
1. LLM 通过 MCP Tool 生成代码
2. 自动验证语法和 API 使用
3. 失败则重试（最多 3 次）
4. 仍失败则降级到模板

### 4.2 架构设计

```
User Input
    ↓
LLM (调用 MCP Tool)
    ↓
Generated Code
    ↓
Validator (语法 + API 检查)
    ↓
Valid? ──No──> Retry (最多3次) ──失败──> Fallback to Template
    ↓ Yes
OpenWorkflow Code
```

### 4.3 MCP Tool Schema

```typescript
server.tool('generate_workflow_code', {
  description: '生成 OpenWorkflow 代码',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { enum: ['agent', 'browser', 'notification'] },
            config: { type: 'object' },
            dependsOn: { type: 'array', items: { type: 'string' } }
          },
          required: ['name', 'type', 'config']
        }
      }
    },
    required: ['name', 'steps']
  }
}, async (input) => {
  // 生成代码
  const code = generateCode(input);

  // 验证
  const validation = await validateCode(code);

  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      suggestion: '请修正以下问题后重试'
    };
  }

  return {
    success: true,
    code,
    workflowId: generateId()
  };
});
```

### 4.4 验证器实现

```typescript
async function validateCode(code: string): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. 语法检查（TypeScript）
  try {
    const result = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 }
    });
    if (result.diagnostics?.length) {
      errors.push(...result.diagnostics.map(d => d.messageText));
    }
  } catch (e) {
    errors.push(`语法错误: ${e.message}`);
  }

  // 2. API 使用检查
  const apiErrors = checkAPIUsage(code);
  errors.push(...apiErrors);

  // 3. 依赖检查
  const depErrors = checkDependencies(code);
  errors.push(...depErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}
```

### 4.5 重试机制

```typescript
async function generateWithRetry(userInput: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await llm.call('generate_workflow_code', {
      input: userInput,
      previousErrors: i > 0 ? lastErrors : undefined
    });

    if (result.success) {
      return result.code;
    }

    lastErrors = result.errors;
  }

  // 降级到模板
  return fallbackToTemplate(userInput);
}
```

### 4.6 优势与劣势

**优势**：
- ✅ 平衡灵活性和可靠性
- ✅ 自动验证保证质量
- ✅ 重试机制提高成功率
- ✅ 降级机制保证可用性

**劣势**：
- ❌ 重试增加延迟
- ❌ 验证器需要维护
- ❌ 仍可能失败（3 次后）
- ❌ LLM 成本较高（多次调用）

### 4.7 实现难度

**难度**：⭐⭐⭐⭐ (中高)

**开发时间**：4-5 周
- MCP Tool 实现：1 周
- 验证器：1-2 周
- 重试逻辑：3-5 天
- 降级机制：3-5 天
- 测试：1 周

**风险**：中高
- 验证器可能漏检
- 重试可能仍失败
- LLM 成本需要控制

---

## 5. 方案四：渐进式生成（推荐）

### 5.1 核心思路

结合模板和 LLM 的优势：
1. 用模板生成骨架代码（保证语法）
2. LLM 填充具体逻辑（保证灵活性）

### 5.2 架构设计

```
User Input
    ↓
LLM (分析意图，选择模板)
    ↓
Template (生成骨架)
    ↓
LLM (填充参数和 prompt)
    ↓
Complete Code
```

### 5.3 实现示例

**步骤 1：LLM 分析意图**
```
User: "创建一个工作流，从 example.com 采集数据，用 AI 分析后发送到飞书"

LLM 分析：
- 需要 browser 步骤（导航）
- 需要 agent 步骤（提取数据）
- 需要 agent 步骤（分析数据）
- 需要 notification 步骤（发送飞书）
- 依赖关系：顺序执行
```

**步骤 2：选择模板骨架**
```typescript
// 选择 "sequential-workflow" 模板
const template = `
import { OpenWorkflow } from 'openworkflow';

const ow = new OpenWorkflow({ backend });

const workflow = ow.defineWorkflow(
  { name: '{{WORKFLOW_NAME}}' },
  async ({ input, step }) => {
    {{STEPS}}
    return {{RETURN_VALUE}};
  }
);

export default workflow;
`;
```

**步骤 3：LLM 填充步骤**
```typescript
// LLM 生成步骤内容（只需填充参数，不需要写完整代码）
const steps = [
  {
    template: 'browser-step',
    params: {
      name: 'navigate',
      action: 'navigate',
      url: 'https://example.com'
    }
  },
  {
    template: 'agent-step',
    params: {
      name: 'extract',
      prompt: '从页面提取数据'
    }
  },
  {
    template: 'agent-step',
    params: {
      name: 'analyze',
      prompt: '分析以下数据：{{extract.output}}'
    }
  },
  {
    template: 'notification-step',
    params: {
      name: 'notify',
      type: 'feishu',
      content: '分析完成：{{analyze.output}}'
    }
  }
];
```

**步骤 4：代码生成器组装**
```typescript
function assembleWorkflow(template: string, steps: StepConfig[]) {
  const stepCode = steps.map(s => generateStepCode(s)).join('\n\n');

  return template
    .replace('{{WORKFLOW_NAME}}', workflowName)
    .replace('{{STEPS}}', stepCode)
    .replace('{{RETURN_VALUE}}', steps[steps.length - 1].name);
}
```

### 5.4 MCP Tool 设计

```typescript
server.tool('create_workflow_progressive', {
  description: '渐进式创建工作流（推荐）',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      templateType: {
        enum: ['sequential', 'parallel', 'mixed'],
        description: '工作流类型'
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stepTemplate: {
              enum: ['agent-step', 'browser-step', 'notification-step']
            },
            params: { type: 'object' }
          }
        }
      }
    },
    required: ['name', 'templateType', 'steps']
  }
}, async (input) => {
  const skeleton = getTemplateSkeleton(input.templateType);
  const code = assembleWorkflow(skeleton, input.steps);

  return {
    success: true,
    code,
    workflowId: generateId()
  };
});
```


### 5.5 优势与劣势

**优势**：
- ✅ 语法保证（模板骨架）
- ✅ 内容灵活（LLM 填充）
- ✅ 实现简单（组合现有技术）
- ✅ 成功率高（LLM 只需填参数）
- ✅ 易于调试（骨架固定）

**劣势**：
- ❌ 需要设计步骤模板
- ❌ 仍需要一定模板维护

### 5.6 实现难度

**难度**：⭐⭐⭐ (中)

**开发时间**：2-3 周
- 骨架模板：3-5 天
- 步骤模板：3-5 天
- 组装逻辑：3-5 天
- MCP 集成：3-5 天
- 测试：1 周

**风险**：低
- 技术成熟，风险可控
- 失败率低（模板保证语法）

---

## 6. 方案对比

| 维度 | 方案一：模板库 | 方案二：分层生成 | 方案三：约束验证 | 方案四：渐进式（推荐）|
|------|--------------|----------------|----------------|-------------------|
| **可靠性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **灵活性** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **实现难度** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **维护成本** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **开发时间** | 1-2周 | 3-4周 | 4-5周 | 2-3周 |
| **LLM 成本** | 低 | 中 | 高 | 中 |
| **用户体验** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 7. 推荐方案：渐进式生成

### 7.1 选择理由

**平衡性最佳**：
- 可靠性接近纯模板（骨架固定）
- 灵活性接近自由生成（LLM 填充）
- 实现难度适中（2-3 周）
- 维护成本可控（模板数量少）

**技术可行性**：
- 模板技术成熟
- LLM 填充参数成功率高
- 组装逻辑简单

**用户体验**：
- 支持自然语言输入
- 生成速度快（无需多次重试）
- 结果可预测

### 7.2 实施路线

**Phase 1：核心模板（1 周）**
- [ ] 设计 3 种骨架模板（sequential、parallel、mixed）
- [ ] 设计 5 种步骤模板（agent、browser、notification、condition、loop）
- [ ] 实现组装逻辑

**Phase 2：MCP 集成（1 周）**
- [ ] 实现 MCP Tool
- [ ] 设计 Tool Schema
- [ ] 测试 LLM 调用

**Phase 3：优化测试（1 周）**
- [ ] Prompt 优化
- [ ] 边界情况测试
- [ ] 性能优化

### 7.3 降级策略

如果渐进式生成失败，降级顺序：
1. 渐进式生成（首选）
2. 纯模板生成（降级 1）
3. 手动编写（降级 2）

---

## 8. 实现细节

### 8.1 骨架模板

```typescript
const SKELETON_TEMPLATES = {
  sequential: `
import { OpenWorkflow } from 'openworkflow';
const ow = new OpenWorkflow({ backend });
const workflow = ow.defineWorkflow(
  { name: '{{NAME}}' },
  async ({ input, step }) => {
    {{STEPS}}
    return {{RETURN}};
  }
);
export default workflow;
`,

  parallel: `
import { OpenWorkflow } from 'openworkflow';
const ow = new OpenWorkflow({ backend });
const workflow = ow.defineWorkflow(
  { name: '{{NAME}}' },
  async ({ input, step }) => {
    const results = await Promise.all([
      {{PARALLEL_STEPS}}
    ]);
    {{POST_PROCESS}}
    return {{RETURN}};
  }
);
export default workflow;
`,

  mixed: `
import { OpenWorkflow } from 'openworkflow';
const ow = new OpenWorkflow({ backend });
const workflow = ow.defineWorkflow(
  { name: '{{NAME}}' },
  async ({ input, step }) => {
    {{SEQUENTIAL_PART}}
    const parallelResults = await Promise.all([
      {{PARALLEL_PART}}
    ]);
    {{FINAL_PART}}
    return {{RETURN}};
  }
);
export default workflow;
`
};
```

### 8.2 步骤模板

```typescript
const STEP_TEMPLATES = {
  'agent-step': (params) => `
    const ${params.name} = await step.run({ name: '${params.name}' }, async () => {
      return await agentStep('${params.agent || 'researcher'}', '${params.prompt}');
    });
  `,

  'browser-step': (params) => `
    const ${params.name} = await step.run({ name: '${params.name}' }, async () => {
      return await browserStep({
        action: '${params.action}',
        ${params.url ? `url: '${params.url}',` : ''}
        ${params.selector ? `selector: '${params.selector}'` : ''}
      });
    });
  `,

  'notification-step': (params) => `
    await step.run({ name: '${params.name}' }, async () => {
      return await notificationStep({
        type: '${params.type}',
        content: '${params.content}'
      });
    });
  `
};
```

### 8.3 组装函数

```typescript
function assembleWorkflow(config: WorkflowConfig): string {
  const skeleton = SKELETON_TEMPLATES[config.type];
  const steps = config.steps.map(s =>
    STEP_TEMPLATES[s.template](s.params)
  ).join('\n');

  return skeleton
    .replace('{{NAME}}', config.name)
    .replace('{{STEPS}}', steps)
    .replace('{{RETURN}}', config.returnValue);
}
```

---

## 9. 总结

### 9.1 最终决策

**推荐方案**：渐进式生成（方案四）

**理由**：
1. 可靠性高（模板骨架保证语法）
2. 灵活性好（LLM 填充内容）
3. 实现可行（2-3 周）
4. 用户体验佳（自然语言输入）

### 9.2 备选方案

如果渐进式生成遇到问题，可以：
- 短期：使用纯模板（方案一）快速上线
- 长期：优化为约束验证（方案三）提高灵活性

### 9.3 下一步

1. 与 team-lead 确认方案
2. 开始实施 Phase 1（核心模板）
3. 迭代优化

---

## 附录：示例对比

### 用户输入
"创建一个工作流，从 example.com 采集数据，用 AI 分析后发送到飞书"

### 方案一：模板库
```
❌ 无匹配模板（需要新建模板）
```

### 方案二：分层生成
```json
{
  "name": "数据采集分析",
  "steps": [
    { "id": "s1", "type": "browser", "config": {...}, "dependsOn": [] },
    { "id": "s2", "type": "agent", "config": {...}, "dependsOn": ["s1"] },
    { "id": "s3", "type": "agent", "config": {...}, "dependsOn": ["s2"] },
    { "id": "s4", "type": "notification", "config": {...}, "dependsOn": ["s3"] }
  ]
}
```
✅ 生成 JSON → 转换为代码

### 方案三：约束验证
```typescript
// LLM 直接生成代码
const workflow = ow.defineWorkflow(...);
```
⚠️ 可能有语法错误 → 重试

### 方案四：渐进式（推荐）
```typescript
// 1. 选择 sequential 骨架
// 2. LLM 填充步骤参数
{
  type: 'sequential',
  steps: [
    { template: 'browser-step', params: { name: 'nav', url: '...' } },
    { template: 'agent-step', params: { name: 'extract', prompt: '...' } },
    { template: 'agent-step', params: { name: 'analyze', prompt: '...' } },
    { template: 'notification-step', params: { name: 'notify', type: 'feishu' } }
  ]
}
// 3. 组装为完整代码
```
✅ 语法保证 + 内容灵活
