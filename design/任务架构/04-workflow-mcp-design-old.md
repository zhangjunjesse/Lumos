# Workflow MCP Server 设计文档

## 1. 概述

**目的**：为 LLM（Scheduling Layer）提供稳定、结构化的工作流生成能力

**核心思路**：
- 使用 MCP Tool Schema 强制约束输入格式
- 提供模板库降低生成复杂度
- 分步骤构建，逐步验证

---

## 2. MCP Tools 设计

### 2.1 list_workflow_templates

**功能**：列出所有可用的工作流模板

**输入**：无

**输出**：
```typescript
{
  templates: [
    {
      id: 'data-collection',
      name: '数据采集工作流',
      description: '从网页采集数据并分析',
      params: ['url', 'selector']
    },
    {
      id: 'scheduled-report',
      name: '定时报告工作流',
      description: '定时生成报告并发送通知',
      params: ['schedule', 'reportType']
    }
  ]
}
```

### 2.2 get_step_types

**功能**：获取所有可用的步骤类型和配置

**输入**：无

**输出**：
```typescript
{
  stepTypes: [
    {
      type: 'agent',
      description: '调用 AI Agent 执行任务',
      config: {
        prompt: { type: 'string', required: true },
        tools: { type: 'array', required: false }
      }
    },
    {
      type: 'browser',
      description: '浏览器操作',
      config: {
        action: { type: 'enum', values: ['navigate', 'click', 'screenshot'], required: true },
        url: { type: 'string', required: false },
        selector: { type: 'string', required: false }
      }
    },
    {
      type: 'notification',
      description: '发送通知',
      config: {
        type: { type: 'enum', values: ['feishu', 'system'], required: true },
        content: { type: 'string', required: true }
      }
    }
  ]
}
```

### 2.3 create_workflow_from_template

**功能**：从模板创建工作流（最稳定）

**输入 Schema**：
```json
{
  "type": "object",
  "properties": {
    "templateId": {
      "type": "string",
      "description": "模板ID"
    },
    "name": {
      "type": "string",
      "description": "工作流名称"
    },
    "params": {
      "type": "object",
      "description": "模板参数"
    }
  },
  "required": ["templateId", "name", "params"]
}
```

**输出**：
```typescript
{
  success: true,
  workflowId: 'wf_123',
  code: '// 生成的 TypeScript 代码',
  preview: '工作流包含3个步骤：导航 → 提取数据 → 发送通知'
}
```

### 2.4 create_custom_workflow

**功能**：自定义创建工作流（灵活）

**输入 Schema**：
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "工作流名称"
    },
    "steps": {
      "type": "array",
      "description": "步骤列表",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "type": { "enum": ["agent", "browser", "notification"] },
          "config": { "type": "object" }
        },
        "required": ["id", "type", "config"]
      }
    }
  },
  "required": ["name", "steps"]
}
```

**输出**：同上

### 2.5 validate_workflow_spec

**功能**：验证工作流定义

**输入 Schema**：
```json
{
  "type": "object",
  "properties": {
    "spec": {
      "type": "object",
      "description": "工作流定义"
    }
  },
  "required": ["spec"]
}
```

**输出**：
```typescript
{
  valid: true,
  errors: [],
  warnings: ['步骤2依赖步骤1的输出']
}
```

---

## 3. MCP Server 实现

```typescript
// src/lib/workflow/mcp-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({
  name: 'lumos-workflow',
  version: '1.0.0'
});

// 工具1：列出模板
server.tool('list_workflow_templates', {
  description: '列出所有可用的工作流模板'
}, async () => {
  return { templates: WORKFLOW_TEMPLATES };
});

// 工具2：获取步骤类型
server.tool('get_step_types', {
  description: '获取所有可用的步骤类型'
}, async () => {
  return { stepTypes: STEP_TYPES };
});

// 工具3：从模板创建（推荐）
server.tool('create_workflow_from_template', {
  description: '从模板创建工作流（最稳定）',
  inputSchema: {
    type: 'object',
    properties: {
      templateId: { type: 'string' },
      name: { type: 'string' },
      params: { type: 'object' }
    },
    required: ['templateId', 'name', 'params']
  }
}, async (input) => {
  const template = WORKFLOW_TEMPLATES.find(t => t.id === input.templateId);
  const code = template.generate(input.name, input.params);
  
  return {
    success: true,
    workflowId: generateId(),
    code,
    preview: generatePreview(code)
  };
});

// 工具4：自定义创建
server.tool('create_custom_workflow', {
  description: '自定义创建工作流',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { enum: ['agent', 'browser', 'notification'] },
            config: { type: 'object' }
          },
          required: ['id', 'type', 'config']
        }
      }
    },
    required: ['name', 'steps']
  }
}, async (input) => {
  const code = generateWorkflowCode(input);
  return {
    success: true,
    workflowId: generateId(),
    code,
    preview: generatePreview(code)
  };
});
```


---

## 4. 工作流模板库

### 4.1 数据采集模板

```typescript
{
  id: 'data-collection',
  name: '数据采集工作流',
  description: '从网页采集数据并分析',
  params: ['url', 'selector'],
  generate: (name, params) => `
import { OpenWorkflow } from 'openworkflow';

const ow = new OpenWorkflow({ backend });

const workflow = ow.defineWorkflow(
  { name: '${name}' },
  async ({ input, step }) => {
    await step.run({ name: 'navigate' }, async () => {
      await browserStep({ action: 'navigate', url: '${params.url}' });
    });

    const data = await step.run({ name: 'extract' }, async () => {
      return await agentStep('researcher', '提取数据：${params.selector}');
    });

    await step.run({ name: 'notify' }, async () => {
      await notificationStep({
        type: 'feishu',
        content: '数据采集完成'
      });
    });

    return data;
  }
);

export default workflow;`
}
```

### 4.2 定时报告模板

```typescript
{
  id: 'scheduled-report',
  name: '定时报告工作流',
  description: '定时生成报告并发送',
  params: ['schedule', 'reportType'],
  generate: (name, params) => `
import { OpenWorkflow } from 'openworkflow';

const ow = new OpenWorkflow({ backend });

const workflow = ow.defineWorkflow(
  { name: '${name}' },
  async ({ input, step }) => {
    const report = await step.run({ name: 'generate' }, async () => {
      return await agentStep('researcher', '生成${params.reportType}报告');
    });

    await step.run({ name: 'send' }, async () => {
      await notificationStep({
        type: 'feishu',
        content: report
      });
    });

    return report;
  }
);

export default workflow;`
    return await agentStep('生成${params.reportType}报告');
  });
  
  await step.run('send', async () => {
    await notificationStep({
      type: 'feishu',
      content: report
    });
  });
  
  return report;
});

export default workflow;`
}
```


---

## 5. LLM 使用示例

### 5.1 使用模板（推荐）

```
User: 创建一个数据采集工作流，从 example.com 采集数据

LLM 调用:
1. list_workflow_templates() -> 发现 'data-collection' 模板
2. create_workflow_from_template({
     templateId: 'data-collection',
     name: '示例数据采集',
     params: { url: 'https://example.com', selector: '.data' }
   })

返回: 
{
  success: true,
  workflowId: 'wf_123',
  code: '// 完整的 TypeScript 代码',
  preview: '工作流包含3个步骤：导航 → 提取数据 → 发送通知'
}
```

### 5.2 自定义创建

```
User: 创建一个工作流：先用AI分析任务，然后打开浏览器截图

LLM 调用:
1. get_step_types() -> 了解可用步骤
2. create_custom_workflow({
     name: '分析并截图',
     steps: [
       {
         id: 'analyze',
         type: 'agent',
         config: { prompt: '分析任务' }
       },
       {
         id: 'screenshot',
         type: 'browser',
         config: { action: 'screenshot' }
       }
     ]
   })
```

---

## 6. 与其他层的集成

### 6.1 更新 03 文档（Scheduling Layer）

Scheduling Layer 通过 MCP 调用工作流生成：

```typescript
// Scheduling Layer 使用 MCP
async function generateWorkflow(task: Task) {
  // 1. 列出模板
  const templates = await mcp.call('list_workflow_templates');
  
  // 2. 让 LLM 选择模板或自定义
  const result = await llm.decide(task, templates);
  
  // 3. 调用 MCP 生成工作流
  const workflow = await mcp.call('create_workflow_from_template', {
    templateId: result.templateId,
    name: task.summary,
    params: result.params
  });
  
  return workflow.code;
}
```

### 6.2 更新 04 文档（Workflow Engine）

Workflow Engine 接收 MCP 生成的代码：

```typescript
// Workflow Engine 执行 MCP 生成的代码
async function executeWorkflow(code: string, inputs: any) {
  const workflow = await loadWorkflow(code);
  const engine = getWorkflowEngine();
  return await engine.run(workflow, inputs);
}
```

---

## 7. 优势总结

**为什么 MCP 最稳定**：

1. ✅ **强制类型约束**：Tool Schema 保证输入格式正确
2. ✅ **模板库**：降低生成复杂度，提高成功率
3. ✅ **分步验证**：先列出选项，再生成代码
4. ✅ **标准化**：MCP 是标准协议，易于集成
5. ✅ **可扩展**：可以轻松添加新模板和步骤类型

**对比其他方式**：
- Prompt 生成：格式不可控，容易出错
- Skill：依赖对话，不够结构化
- CLI：手动输入，容易出错

---

## 8. 实施计划

### Phase 1：MCP Server 开发（1周）
- [ ] 实现 5 个 MCP Tools
- [ ] 定义 3-5 个工作流模板
- [ ] 代码生成器实现

### Phase 2：集成测试（1周）
- [ ] 与 Scheduling Layer 集成
- [ ] 与 Workflow Engine 集成
- [ ] 端到端测试

### Phase 3：优化（持续）
- [ ] 添加更多模板
- [ ] 优化代码生成质量
- [ ] 收集用户反馈

