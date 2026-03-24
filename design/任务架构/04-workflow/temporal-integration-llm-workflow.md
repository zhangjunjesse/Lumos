# LLM 工作流生成方案设计

## 1. 概述

本文档设计如何让 LLM 动态生成、管理和运行 Temporal 工作流，实现 AI Agent 的复杂任务编排能力。

### 核心目标
- LLM 根据用户需求生成 TypeScript 工作流代码
- 动态编译、注册和执行工作流
- 提供模板库加速常见场景
- 确保代码安全和可维护性

---

## 2. LLM 生成工作流

### 2.1 Prompt 设计

#### 系统 Prompt（注入 Temporal API 文档）

```typescript
const WORKFLOW_GENERATION_SYSTEM_PROMPT = `
你是 Temporal 工作流专家。根据用户需求生成 TypeScript 工作流代码。

## Temporal API 参考

### 工作流定义
\`\`\`typescript
import { proxyActivities } from '@temporalio/workflow';

// 定义 Activity 接口
interface Activities {
  fetchData(url: string): Promise<string>;
  processData(data: string): Promise<any>;
  saveResult(result: any): Promise<void>;
}

// 代理 Activities（设置超时）
const activities = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 }
});

// 工作流函数
export async function myWorkflow(input: WorkflowInput): Promise<WorkflowOutput> {
  const data = await activities.fetchData(input.url);
  const result = await activities.processData(data);
  await activities.saveResult(result);
  return { success: true, result };
}
\`\`\`

### 常用 API

**并行执行**
\`\`\`typescript
const [result1, result2] = await Promise.all([
  activities.task1(),
  activities.task2()
]);
\`\`\`

**条件分支**
\`\`\`typescript
if (condition) {
  await activities.branchA();
} else {
  await activities.branchB();
}
\`\`\`

**循环重试**
\`\`\`typescript
for (const item of items) {
  await activities.processItem(item);
}
\`\`\`

**超时控制**
\`\`\`typescript
import { sleep } from '@temporalio/workflow';

await sleep('5 seconds');
\`\`\`

**信号处理**
\`\`\`typescript
import { defineSignal, setHandler } from '@temporalio/workflow';

const pauseSignal = defineSignal('pause');
let isPaused = false;

setHandler(pauseSignal, () => { isPaused = true; });
\`\`\`

## 生成规则

1. **只生成工作流函数**，不生成 Activity 实现
2. **使用 proxyActivities** 调用 Activity
3. **明确输入输出类型**
4. **添加错误处理**
5. **代码简洁，避免复杂逻辑**

## 输出格式

\`\`\`json
{
  "workflowName": "myWorkflow",
  "code": "export async function myWorkflow(...) { ... }",
  "activities": ["fetchData", "processData", "saveResult"],
  "inputSchema": { "type": "object", "properties": {...} },
  "outputSchema": { "type": "object", "properties": {...} }
}
\`\`\`
`;
```

#### 用户 Prompt 示例

```typescript
// 示例 1：简单调研任务
const userPrompt1 = `
创建一个调研工作流：
1. 搜索关键词 "Temporal workflow patterns"
2. 抓取前 5 个搜索结果的内容
3. 用 LLM 总结关键信息
4. 保存到文档
`;

// 示例 2：数据处理管道
const userPrompt2 = `
创建数据处理工作流：
1. 从 API 获取用户列表
2. 并行处理每个用户的订单数据
3. 聚合统计结果
4. 发送报告邮件
`;

// 示例 3：定时任务
const userPrompt3 = `
创建定时监控工作流：
1. 每小时检查网站状态
2. 如果异常，发送告警
3. 记录日志
`;
```

### 2.2 代码生成流程

```typescript
// src/lib/workflow/generator.ts

interface WorkflowGenerationRequest {
  description: string;
  context?: string; // 额外上下文
  template?: string; // 基于模板生成
}

interface WorkflowGenerationResult {
  workflowName: string;
  code: string;
  activities: string[];
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  explanation: string;
}

export async function generateWorkflow(
  request: WorkflowGenerationRequest
): Promise<WorkflowGenerationResult> {
  // 1. 构建 prompt
  const prompt = buildPrompt(request);

  // 2. 调用 LLM
  const response = await callLLM({
    system: WORKFLOW_GENERATION_SYSTEM_PROMPT,
    user: prompt
  });

  // 3. 解析响应
  const result = parseWorkflowResponse(response);

  // 4. 验证代码
  await validateWorkflowCode(result.code);

  return result;
}
```

### 2.3 代码验证和安全检查

```typescript
// src/lib/workflow/validator.ts

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateWorkflowCode(code: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. TypeScript 语法检查
  try {
    const ts = await import('typescript');
    const result = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 }
    });
    if (result.diagnostics?.length) {
      errors.push(...result.diagnostics.map(d => d.messageText.toString()));
    }
  } catch (e) {
    errors.push(`Syntax error: ${e.message}`);
  }

  // 2. 安全检查（禁止危险操作）
  const dangerousPatterns = [
    /require\s*\(/,           // 禁止 require
    /eval\s*\(/,              // 禁止 eval
    /Function\s*\(/,          // 禁止 new Function
    /process\.exit/,          // 禁止退出进程
    /child_process/,          // 禁止子进程
    /fs\./,                   // 禁止文件系统（除非白名单）
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      errors.push(`Dangerous pattern detected: ${pattern}`);
    }
  }

  // 3. 必须导出工作流函数
  if (!/export\s+(async\s+)?function/.test(code)) {
    errors.push('Must export workflow function');
  }

  // 4. 必须使用 proxyActivities
  if (!/proxyActivities/.test(code)) {
    warnings.push('Should use proxyActivities for external calls');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
```

---

## 3. 工作流模板库

### 3.1 模板结构

```typescript
// src/lib/workflow/templates.ts

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'research' | 'data-processing' | 'automation' | 'monitoring';
  parameters: TemplateParameter[];
  code: string;
  activities: string[];
}

interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: any;
}
```

### 3.2 内置模板

#### 模板 1：网页调研

```typescript
export const webResearchTemplate: WorkflowTemplate = {
  id: 'web-research',
  name: '网页调研',
  description: '搜索关键词，抓取内容，LLM 总结',
  category: 'research',
  parameters: [
    { name: 'keyword', type: 'string', description: '搜索关键词', required: true },
    { name: 'maxResults', type: 'number', description: '最大结果数', required: false, default: 5 }
  ],
  code: `
export async function webResearch(input: { keyword: string; maxResults: number }): Promise<{ summary: string }> {
  const { keyword, maxResults } = input;

  // 搜索
  const searchResults = await activities.searchWeb({ query: keyword, limit: maxResults });

  // 并行抓取内容
  const contents = await Promise.all(
    searchResults.map(url => activities.fetchWebContent({ url }))
  );

  // LLM 总结
  const summary = await activities.summarizeWithLLM({
    texts: contents,
    prompt: \`总结关于 "\${keyword}" 的关键信息\`
  });

  // 保存结果
  await activities.saveDocument({ title: keyword, content: summary });

  return { summary };
}
  `,
  activities: ['searchWeb', 'fetchWebContent', 'summarizeWithLLM', 'saveDocument']
};
```

#### 模板 2：数据处理管道

```typescript
export const dataProcessingTemplate: WorkflowTemplate = {
  id: 'data-processing',
  name: '数据处理管道',
  description: '获取数据，并行处理，聚合结果',
  category: 'data-processing',
  parameters: [
    { name: 'dataSource', type: 'string', description: '数据源 URL', required: true },
    { name: 'batchSize', type: 'number', description: '批处理大小', required: false, default: 10 }
  ],
  code: `
export async function dataProcessing(input: { dataSource: string; batchSize: number }): Promise<{ total: number }> {
  const { dataSource, batchSize } = input;

  // 获取数据
  const rawData = await activities.fetchData({ url: dataSource });

  // 分批处理
  const batches = chunk(rawData, batchSize);
  const results = [];

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(item => activities.processItem({ item }))
    );
    results.push(...batchResults);
  }

  // 聚合
  const aggregated = await activities.aggregateResults({ results });

  return { total: results.length };
}

function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}
  `,
  activities: ['fetchData', 'processItem', 'aggregateResults']
};
```

#### 模板 3：定时监控

```typescript
export const monitoringTemplate: WorkflowTemplate = {
  id: 'monitoring',
  name: '定时监控',
  description: '定期检查状态，异常告警',
  category: 'monitoring',
  parameters: [
    { name: 'targetUrl', type: 'string', description: '监控目标 URL', required: true },
    { name: 'interval', type: 'string', description: '检查间隔（如 "1h"）', required: false, default: '1h' }
  ],
  code: `
import { sleep } from '@temporalio/workflow';

export async function monitoring(input: { targetUrl: string; interval: string }): Promise<void> {
  const { targetUrl, interval } = input;

  while (true) {
    // 检查状态
    const status = await activities.checkHealth({ url: targetUrl });

    if (!status.healthy) {
      // 发送告警
      await activities.sendAlert({
        message: \`\${targetUrl} is down: \${status.error}\`
      });
    }

    // 记录日志
    await activities.logStatus({ url: targetUrl, status });

    // 等待下次检查
    await sleep(interval);
  }
}
  `,
  activities: ['checkHealth', 'sendAlert', 'logStatus']
};
```

### 3.3 模板参数化

```typescript
// src/lib/workflow/template-engine.ts

export function instantiateTemplate(
  template: WorkflowTemplate,
  params: Record<string, any>
): string {
  let code = template.code;

  // 验证必填参数
  for (const param of template.parameters) {
    if (param.required && !(param.name in params)) {
      throw new Error(`Missing required parameter: ${param.name}`);
    }
  }

  // 填充默认值
  const finalParams = { ...template.parameters.reduce((acc, p) => {
    if (p.default !== undefined) acc[p.name] = p.default;
    return acc;
  }, {}), ...params };

  // 替换占位符（简单实现，实际可用模板引擎）
  for (const [key, value] of Object.entries(finalParams)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    code = code.replace(placeholder, JSON.stringify(value));
  }

  return code;
}
```

### 3.4 模板组合

```typescript
// 组合多个模板创建复杂工作流
export function combineTemplates(
  templates: WorkflowTemplate[],
  orchestration: 'sequential' | 'parallel'
): string {
  if (orchestration === 'sequential') {
    return `
export async function combinedWorkflow(input: any): Promise<any> {
  ${templates.map((t, i) => `
  const result${i} = await ${t.id}(input);
  `).join('\n')}
  return { results: [${templates.map((_, i) => `result${i}`).join(', ')}] };
}
    `;
  } else {
    return `
export async function combinedWorkflow(input: any): Promise<any> {
  const results = await Promise.all([
    ${templates.map(t => `${t.id}(input)`).join(',\n    ')}
  ]);
  return { results };
}
    `;
  }
}
```

---

## 4. 动态编译执行

### 4.1 TypeScript 动态编译

```typescript
// src/lib/workflow/compiler.ts

import * as ts from 'typescript';
import { Worker } from '@temporalio/worker';

interface CompilationResult {
  success: boolean;
  code?: string;
  error?: string;
}

export async function compileWorkflow(
  sourceCode: string,
  workflowName: string
): Promise<CompilationResult> {
  try {
    // 1. 添加必要的 import
    const fullCode = `
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const activities = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 }
});

${sourceCode}
    `;

    // 2. 编译为 JavaScript
    const result = ts.transpileModule(fullCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        skipLibCheck: true
      }
    });

    if (result.diagnostics?.length) {
      return {
        success: false,
        error: result.diagnostics.map(d => d.messageText).join('\n')
      };
    }

    // 3. 写入临时文件
    const workflowPath = `/tmp/workflows/${workflowName}.js`;
    await fs.promises.writeFile(workflowPath, result.outputText);

    return { success: true, code: result.outputText };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### 4.2 工作流注册

```typescript
// src/lib/workflow/registry.ts

interface WorkflowMetadata {
  name: string;
  version: string;
  code: string;
  compiledPath: string;
  createdAt: Date;
  activities: string[];
}

class WorkflowRegistry {
  private workflows = new Map<string, WorkflowMetadata>();

  async register(
    name: string,
    code: string,
    activities: string[]
  ): Promise<void> {
    // 1. 编译代码
    const compiled = await compileWorkflow(code, name);
    if (!compiled.success) {
      throw new Error(`Compilation failed: ${compiled.error}`);
    }

    // 2. 生成版本号
    const version = `v${Date.now()}`;

    // 3. 保存元数据
    this.workflows.set(name, {
      name,
      version,
      code,
      compiledPath: `/tmp/workflows/${name}.js`,
      createdAt: new Date(),
      activities
    });

    // 4. 通知 Worker 重新加载
    await this.reloadWorker();
  }

  get(name: string): WorkflowMetadata | undefined {
    return this.workflows.get(name);
  }

  list(): WorkflowMetadata[] {
    return Array.from(this.workflows.values());
  }

  private async reloadWorker(): Promise<void> {
    // 触发 Worker 热更新（见下节）
  }
}

export const workflowRegistry = new WorkflowRegistry();
```

### 4.3 热更新机制

```typescript
// src/lib/workflow/hot-reload.ts

import { Worker } from '@temporalio/worker';
import { workflowRegistry } from './registry';

class WorkflowHotReloader {
  private worker: Worker | null = null;
  private isReloading = false;

  async startWorker(): Promise<void> {
    // 动态加载所有已注册的工作流
    const workflowsPath = '/tmp/workflows';

    this.worker = await Worker.create({
      workflowsPath,
      activities: await this.loadActivities(),
      taskQueue: 'lumos-tasks'
    });

    await this.worker.run();
  }

  async reload(): Promise<void> {
    if (this.isReloading) return;
    this.isReloading = true;

    try {
      // 1. 优雅关闭旧 Worker
      if (this.worker) {
        await this.worker.shutdown();
      }

      // 2. 启动新 Worker（加载最新代码）
      await this.startWorker();
    } finally {
      this.isReloading = false;
    }
  }

  private async loadActivities(): Promise<Record<string, Function>> {
    // 加载所有 Activity 实现
    const activities = {};
    const allWorkflows = workflowRegistry.list();

    for (const workflow of allWorkflows) {
      for (const activityName of workflow.activities) {
        if (!activities[activityName]) {
          activities[activityName] = await this.loadActivity(activityName);
        }
      }
    }

    return activities;
  }

  private async loadActivity(name: string): Promise<Function> {
    // 从 Activity 注册表加载（见 temporal-integration-activities.md）
    const { activityRegistry } = await import('./activity-registry');
    return activityRegistry.get(name);
  }
}

export const hotReloader = new WorkflowHotReloader();
```

---

## 5. 完整示例

### 5.1 LLM Prompt 示例

**用户输入**：
```
我需要一个工作流来监控竞品动态：
1. 每天早上 9 点抓取竞品官网的新闻页面
2. 提取新发布的文章标题和摘要
3. 用 AI 分析是否有重要产品更新
4. 如果有，发送飞书通知给产品团队
```

**LLM 响应**：
```json
{
  "workflowName": "competitorMonitoring",
  "code": "export async function competitorMonitoring(input: { competitorUrl: string }): Promise<{ hasUpdate: boolean }> {\n  const { competitorUrl } = input;\n\n  // 抓取新闻页面\n  const html = await activities.fetchWebContent({ url: competitorUrl });\n\n  // 提取文章列表\n  const articles = await activities.extractArticles({ html });\n\n  // 过滤今天发布的\n  const today = new Date().toISOString().split('T')[0];\n  const newArticles = articles.filter(a => a.date === today);\n\n  if (newArticles.length === 0) {\n    return { hasUpdate: false };\n  }\n\n  // AI 分析\n  const analysis = await activities.analyzeWithLLM({\n    texts: newArticles.map(a => `${a.title}: ${a.summary}`),\n    prompt: '判断是否有重要产品更新（新功能、定价变化、重大合作）'\n  });\n\n  if (analysis.hasImportantUpdate) {\n    // 发送飞书通知\n    await activities.sendFeishuMessage({\n      chatId: 'product-team',\n      content: `竞品动态：${analysis.summary}`\n    });\n  }\n\n  return { hasUpdate: analysis.hasImportantUpdate };\n}",
  "activities": [
    "fetchWebContent",
    "extractArticles",
    "analyzeWithLLM",
    "sendFeishuMessage"
  ],
  "inputSchema": {
    "type": "object",
    "properties": {
      "competitorUrl": { "type": "string" }
    },
    "required": ["competitorUrl"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "hasUpdate": { "type": "boolean" }
    }
  },
  "explanation": "该工作流每天抓取竞品新闻，用 AI 分析是否有重要更新，并通过飞书通知团队。"
}
```

### 5.2 生成的工作流代码

```typescript
// 自动生成的文件：/tmp/workflows/competitorMonitoring.ts

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const {
  fetchWebContent,
  extractArticles,
  analyzeWithLLM,
  sendFeishuMessage
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 }
});

export async function competitorMonitoring(
  input: { competitorUrl: string }
): Promise<{ hasUpdate: boolean }> {
  const { competitorUrl } = input;

  // 抓取新闻页面
  const html = await fetchWebContent({ url: competitorUrl });

  // 提取文章列表
  const articles = await extractArticles({ html });

  // 过滤今天发布的
  const today = new Date().toISOString().split('T')[0];
  const newArticles = articles.filter(a => a.date === today);

  if (newArticles.length === 0) {
    return { hasUpdate: false };
  }

  // AI 分析
  const analysis = await analyzeWithLLM({
    texts: newArticles.map(a => `${a.title}: ${a.summary}`),
    prompt: '判断是否有重要产品更新（新功能、定价变化、重大合作）'
  });

  if (analysis.hasImportantUpdate) {
    // 发送飞书通知
    await sendFeishuMessage({
      chatId: 'product-team',
      content: `竞品动态：${analysis.summary}`
    });
  }

  return { hasUpdate: analysis.hasImportantUpdate };
}
```

### 5.3 完整使用流程

```typescript
// src/app/api/workflows/generate/route.ts

import { generateWorkflow } from '@/lib/workflow/generator';
import { validateWorkflowCode } from '@/lib/workflow/validator';
import { compileWorkflow } from '@/lib/workflow/compiler';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(req: Request) {
  const { description } = await req.json();

  // 1. LLM 生成工作流
  const generated = await generateWorkflow({ description });

  // 2. 验证代码
  const validation = await validateWorkflowCode(generated.code);
  if (!validation.valid) {
    return Response.json({ error: validation.errors }, { status: 400 });
  }

  // 3. 编译代码
  const compiled = await compileWorkflow(generated.code, generated.workflowName);
  if (!compiled.success) {
    return Response.json({ error: compiled.error }, { status: 500 });
  }

  // 4. 注册工作流
  await workflowRegistry.register(
    generated.workflowName,
    generated.code,
    generated.activities
  );

  return Response.json({
    workflowName: generated.workflowName,
    activities: generated.activities,
    explanation: generated.explanation
  });
}
```

```typescript
// src/app/api/workflows/execute/route.ts

import { Connection, Client } from '@temporalio/client';

export async function POST(req: Request) {
  const { workflowName, input } = await req.json();

  // 1. 连接 Temporal
  const connection = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection });

  // 2. 启动工作流
  const handle = await client.workflow.start(workflowName, {
    taskQueue: 'lumos-tasks',
    workflowId: `${workflowName}-${Date.now()}`,
    args: [input]
  });

  // 3. 返回执行 ID
  return Response.json({
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId
  });
}
```

---

## 6. 架构总结

### 6.1 核心组件

```
┌─────────────────────────────────────────────────────────────┐
│                         Lumos UI                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ 工作流编辑器  │  │ 模板库       │  │ 执行监控     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Generator                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ LLM Prompt   │→ │ Code Gen     │→ │ Validator    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Compiler                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ TypeScript   │→ │ JavaScript   │→ │ Registry     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Temporal Worker                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Workflows    │  │ Activities   │  │ Hot Reload   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 数据流

```
用户描述
   │
   ▼
LLM 生成代码
   │
   ▼
安全验证
   │
   ▼
TypeScript 编译
   │
   ▼
注册到 Registry
   │
   ▼
Worker 热加载
   │
   ▼
执行工作流
   │
   ▼
返回结果
```

### 6.3 关键设计决策

| 决策 | 理由 |
|------|------|
| **只生成工作流，不生成 Activity** | Activity 是可复用的原子操作，应预定义；工作流是业务编排逻辑，适合动态生成 |
| **使用 TypeScript** | 类型安全，IDE 支持好，便于验证 |
| **动态编译而非 eval** | 安全性更高，可以做静态分析和沙箱隔离 |
| **模板库 + LLM 生成** | 常见场景用模板快速启动，复杂场景用 LLM 定制 |
| **热更新机制** | 避免重启应用，提升开发体验 |
| **版本管理** | 支持工作流迭代，可回滚到历史版本 |

---

## 7. 安全考虑

### 7.1 代码沙箱

```typescript
// 使用 VM2 或 isolated-vm 隔离执行
import { VM } from 'vm2';

export function executeInSandbox(code: string, context: any): any {
  const vm = new VM({
    timeout: 60000,
    sandbox: context,
    eval: false,
    wasm: false
  });

  return vm.run(code);
}
```

### 7.2 权限控制

```typescript
// 工作流只能调用白名单 Activity
const ALLOWED_ACTIVITIES = [
  'fetchWebContent',
  'searchWeb',
  'analyzeWithLLM',
  'sendFeishuMessage',
  // ...
];

function validateActivities(activities: string[]): boolean {
  return activities.every(a => ALLOWED_ACTIVITIES.includes(a));
}
```

### 7.3 资源限制

```typescript
// 限制工作流执行时间和资源消耗
const WORKFLOW_LIMITS = {
  maxExecutionTime: '1 hour',
  maxActivities: 100,
  maxParallelActivities: 10
};
```

---

## 8. 未来扩展

### 8.1 可视化编辑器
- 拖拽式工作流设计
- 节点连线表示依赖关系
- 实时预览生成的代码

### 8.2 工作流市场
- 用户分享自己的工作流
- 评分和评论系统
- 一键导入他人的工作流

### 8.3 AI 优化建议
- 分析工作流执行日志
- 识别性能瓶颈
- 自动建议优化方案

### 8.4 多语言支持
- 支持 Python、Go 等语言编写工作流
- 跨语言 Activity 调用

---

## 9. 实现优先级

### P0（核心功能）
- [x] LLM 生成工作流代码
- [x] TypeScript 编译和验证
- [x] 工作流注册和执行
- [x] 3-5 个常用模板

### P1（增强体验）
- [ ] 热更新机制
- [ ] 工作流版本管理
- [ ] 执行日志和监控
- [ ] 错误处理和重试

### P2（高级功能）
- [ ] 可视化编辑器
- [ ] 工作流市场
- [ ] AI 优化建议
- [ ] 多语言支持

---

## 10. 参考资料

- [Temporal TypeScript SDK](https://docs.temporal.io/typescript)
- [Dynamic Code Generation Best Practices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#never_use_eval!)
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [VM2 Sandbox](https://github.com/patriksimek/vm2)
```
```

