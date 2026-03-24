# Agent与Workflow Engine集成方案

## 1. agentStep实现

### 1.1 核心接口

```typescript
// src/lib/workflow/steps/agent-step.ts
import { step } from '@openworkflow/core';
import { createAgentSession } from '@/lib/agent/session';

interface AgentStepConfig {
  prompt: string;
  tools?: string[];
  model?: string;
  timeout?: number;
  context?: Record<string, any>;
}

interface AgentStepResult {
  success: boolean;
  output: string;
  toolCalls?: Array<{
    tool: string;
    input: any;
    output: any;
  }>;
  error?: string;
}

export async function agentStep(
  config: AgentStepConfig
): Promise<AgentStepResult> {
  return await step.run('agent-execution', async () => {
    const session = await createAgentSession({
      model: config.model || 'claude-opus-4',
      tools: config.tools || [],
      timeout: config.timeout || 300000
    });

    try {
      const result = await session.sendMessage({
        content: config.prompt,
        context: config.context
      });

      return {
        success: true,
        output: result.content,
        toolCalls: result.toolCalls
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error.message
      };
    } finally {
      await session.close();
    }
  });
}
```

### 1.2 Agent Session管理

```typescript
// src/lib/agent/session.ts
interface AgentSession {
  id: string;
  sendMessage(req: MessageRequest): Promise<MessageResponse>;
  close(): Promise<void>;
}

export async function createAgentSession(
  config: SessionConfig
): Promise<AgentSession> {
  const sessionId = generateId();

  return {
    id: sessionId,
    async sendMessage(req) {
      // 调用Claude SDK
      const response = await claudeClient.sendMessage({
        sessionId,
        ...req
      });
      return response;
    },
    async close() {
      // 清理资源
      await claudeClient.closeSession(sessionId);
    }
  };
}
```

## 2. 执行模式

### 2.1 同步执行（默认）

```typescript
const workflow = defineWorkflow({
  name: 'sync-agent-workflow'
}, async (input) => {
  // 步骤1：Agent分析
  const analysis = await agentStep({
    prompt: `分析以下内容：${input.content}`
  });

  // 步骤2：基于结果执行
  if (analysis.success) {
    const action = await browserStep({
      action: 'navigate',
      url: analysis.output
    });
    return action;
  }
});
```

**特点**：
- 步骤顺序执行
- 后续步骤依赖前面结果
- 适合线性流程

### 2.2 异步执行（并行）

```typescript
const workflow = defineWorkflow({
  name: 'parallel-agent-workflow'
}, async (input) => {
  // 并行执行多个Agent
  const [summary, translation, keywords] = await Promise.all([
    agentStep({ prompt: `总结：${input.text}` }),
    agentStep({ prompt: `翻译：${input.text}` }),
    agentStep({ prompt: `提取关键词：${input.text}` })
  ]);

  return { summary, translation, keywords };
});
```

**特点**：
- 多个Agent并行执行
- 互不依赖
- 提高执行效率

### 2.3 流式执行（实时反馈）

```typescript
const workflow = defineWorkflow({
  name: 'streaming-agent-workflow'
}, async (input) => {
  const result = await step.run('agent-stream', async () => {
    const session = await createAgentSession({});

    let output = '';
    await session.sendMessageStream({
      content: input.prompt,
      onChunk: (chunk) => {
        output += chunk;
        // 实时更新进度
        step.updateProgress({ text: output });
      }
    });

    return output;
  });

  return result;
});
```

**特点**：
- 实时输出
- 用户可见进度
- 适合长时间任务

## 3. 错误处理和重试

### 3.1 自动重试配置

```typescript
// src/lib/workflow/engine.ts
import { WorkflowEngine } from '@openworkflow/core';

export function createWorkflowEngine() {
  return new WorkflowEngine({
    storage: {
      type: 'sqlite',
      path: getDataDir() + '/workflow.db'
    },
    retryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelay: 1000,
      maxDelay: 30000,
      retryableErrors: [
        'RATE_LIMIT',
        'TIMEOUT',
        'NETWORK_ERROR'
      ]
    }
  });
}
```

### 3.2 错误分类处理

```typescript
export async function agentStep(
  config: AgentStepConfig
): Promise<AgentStepResult> {
  return await step.run('agent-execution', async () => {
    try {
      const result = await executeAgent(config);
      return { success: true, output: result };
    } catch (error) {
      // 分类错误
      if (isRetryableError(error)) {
        // 可重试错误：抛出让引擎重试
        throw error;
      } else {
        // 不可重试错误：返回失败结果
        return {
          success: false,
          output: '',
          error: error.message
        };
      }
    }
  });
}

function isRetryableError(error: Error): boolean {
  const retryable = [
    'rate_limit_error',
    'timeout',
    'connection_error'
  ];
  return retryable.some(type =>
    error.message.toLowerCase().includes(type)
  );
}
```

### 3.3 降级策略

```typescript
const workflow = defineWorkflow({
  name: 'fallback-workflow'
}, async (input) => {
  // 尝试主模型
  let result = await agentStep({
    prompt: input.prompt,
    model: 'claude-opus-4'
  });

  // 失败则降级
  if (!result.success) {
    result = await agentStep({
      prompt: input.prompt,
      model: 'claude-sonnet-4'
    });
  }

  return result;
});
```

## 4. 结果传递机制

### 4.1 直接传递

```typescript
const workflow = defineWorkflow({
  name: 'direct-pass'
}, async (input) => {
  const step1 = await agentStep({
    prompt: '分析文档'
  });

  // 直接使用上一步输出
  const step2 = await browserStep({
    action: 'navigate',
    url: step1.output
  });

  return step2;
});
```

### 4.2 转换传递

```typescript
const workflow = defineWorkflow({
  name: 'transform-pass'
}, async (input) => {
  const analysis = await agentStep({
    prompt: '分析需求',
    context: { format: 'json' }
  });

  // 解析并转换
  const parsed = JSON.parse(analysis.output);

  const action = await browserStep({
    action: parsed.action,
    url: parsed.url
  });

  return action;
});
```

### 4.3 累积传递

```typescript
const workflow = defineWorkflow({
  name: 'accumulate-pass'
}, async (input) => {
  const context = { history: [] };

  // 步骤1
  const step1 = await agentStep({
    prompt: '第一步分析',
    context
  });
  context.history.push(step1.output);

  // 步骤2：包含历史
  const step2 = await agentStep({
    prompt: '第二步处理',
    context
  });
  context.history.push(step2.output);

  return context.history;
});
```

### 4.4 条件传递

```typescript
const workflow = defineWorkflow({
  name: 'conditional-pass'
}, async (input) => {
  const decision = await agentStep({
    prompt: '判断是否需要浏览器操作'
  });

  if (decision.output.includes('需要')) {
    return await browserStep({
      action: 'navigate',
      url: input.url
    });
  } else {
    return await notificationStep({
      type: 'system',
      content: '无需操作'
    });
  }
});
```

## 5. 完整示例

### 5.1 复杂工作流示例

```typescript
// 示例：飞书文档分析 + 浏览器验证 + 结果通知
import { defineWorkflow } from '@openworkflow/core';
import { agentStep } from './steps/agent-step';
import { browserStep } from './steps/browser-step';
import { notificationStep } from './steps/notification-step';

export const documentAnalysisWorkflow = defineWorkflow({
  name: 'document-analysis',
  version: '1.0.0'
}, async (input: { docUrl: string; sessionId: string }) => {

  // 步骤1：Agent读取文档
  const docContent = await agentStep({
    prompt: `读取飞书文档：${input.docUrl}`,
    tools: ['feishu_read_doc']
  });

  if (!docContent.success) {
    throw new Error('文档读取失败');
  }

  // 步骤2：Agent分析内容
  const analysis = await agentStep({
    prompt: `分析以下文档内容，提取关键信息和待验证的URL：\n${docContent.output}`,
    context: { format: 'json' }
  });

  const { summary, urls } = JSON.parse(analysis.output);

  // 步骤3：并行验证URL
  const validations = await Promise.all(
    urls.map(url =>
      browserStep({
        action: 'navigate',
        url,
        timeout: 10000
      })
    )
  );

  // 步骤4：汇总结果
  const report = await agentStep({
    prompt: `生成分析报告：\n摘要：${summary}\n验证结果：${JSON.stringify(validations)}`
  });

  // 步骤5：发送通知
  await notificationStep({
    type: 'feishu',
    content: report.output,
    sessionId: input.sessionId
  });

  return {
    summary,
    validations,
    report: report.output
  };
});
```

### 5.2 使用示例

```typescript
// src/lib/workflow/executor.ts
import { createWorkflowEngine } from './engine';
import { documentAnalysisWorkflow } from './workflows/document-analysis';

export async function executeDocumentAnalysis(
  docUrl: string,
  sessionId: string
) {
  const engine = createWorkflowEngine();

  const result = await engine.run(
    documentAnalysisWorkflow,
    { docUrl, sessionId }
  );

  return result;
}
```

## 6. 监控和调试

### 6.1 进度跟踪

```typescript
export async function agentStep(
  config: AgentStepConfig
): Promise<AgentStepResult> {
  return await step.run('agent-execution', async () => {
    // 更新进度
    step.updateProgress({
      status: 'running',
      message: `执行Agent: ${config.prompt.slice(0, 50)}...`
    });

    const result = await executeAgent(config);

    step.updateProgress({
      status: 'completed',
      message: '执行完成'
    });

    return result;
  });
}
```

### 6.2 日志记录

```typescript
import { logger } from '@/lib/logger';

export async function agentStep(
  config: AgentStepConfig
): Promise<AgentStepResult> {
  const startTime = Date.now();

  logger.info('Agent step started', {
    prompt: config.prompt,
    tools: config.tools
  });

  const result = await step.run('agent-execution', async () => {
    // 执行逻辑
  });

  logger.info('Agent step completed', {
    duration: Date.now() - startTime,
    success: result.success
  });

  return result;
}
```

## 7. 性能优化

### 7.1 Session复用

```typescript
// 复用Session避免重复初始化
const sessionPool = new Map<string, AgentSession>();

export async function agentStep(
  config: AgentStepConfig
): Promise<AgentStepResult> {
  const key = `${config.model}-${config.tools?.join(',')}`;

  let session = sessionPool.get(key);
  if (!session) {
    session = await createAgentSession(config);
    sessionPool.set(key, session);
  }

  return await step.run('agent-execution', async () => {
    return await session.sendMessage({
      content: config.prompt,
      context: config.context
    });
  });
}
```

### 7.2 结果缓存

```typescript
const resultCache = new Map<string, AgentStepResult>();

export async function agentStep(
  config: AgentStepConfig
): Promise<AgentStepResult> {
  const cacheKey = hashConfig(config);

  if (resultCache.has(cacheKey)) {
    return resultCache.get(cacheKey)!;
  }

  const result = await step.run('agent-execution', async () => {
    // 执行逻辑
  });

  resultCache.set(cacheKey, result);
  return result;
}
```

## 8. 总结

### 核心设计要点

1. **agentStep封装**：统一接口，隐藏复杂性
2. **执行模式**：支持同步、异步、流式
3. **错误处理**：自动重试 + 降级策略
4. **结果传递**：直接、转换、累积、条件
5. **监控调试**：进度跟踪 + 日志记录

### 技术选型

- **OpenWorkflow**：轻量级工作流引擎
- **Step封装**：标准化步骤接口
- **SQLite持久化**：自动状态管理

### 开发优先级

1. 实现基础agentStep（同步执行）
2. 添加错误处理和重试
3. 实现结果传递机制
4. 添加监控和日志
5. 性能优化（Session复用、缓存）
