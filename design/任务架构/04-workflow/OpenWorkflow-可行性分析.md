# OpenWorkflow 可行性分析

## 问题 1：LLM 能否定义生成和管理工作流？

### OpenWorkflow 的工作流定义方式

```typescript
import { defineWorkflow, step } from '@openworkflow/core';

const myWorkflow = defineWorkflow({
  name: 'my-workflow',
  version: '1.0.0'
}, async (input: { url: string }) => {

  const data = await step.run('fetch', async () => {
    return await fetchData(input.url);
  });

  const result = await step.run('process', async () => {
    return await processData(data);
  });

  await step.run('save', async () => {
    await saveResult(result);
  });

  return result;
});
```

### LLM 生成工作流的可行性

**✅ 完全可行**

OpenWorkflow 的工作流是纯 TypeScript 代码，LLM 可以生成。

**实现方案**：

```typescript
// 1. LLM 生成工作流代码
async function generateWorkflow(userPrompt: string) {
  const llmResponse = await claude.generate({
    prompt: `
根据用户需求生成 OpenWorkflow 工作流代码：
${userPrompt}

示例格式：
\`\`\`typescript
import { defineWorkflow, step } from '@openworkflow/core';

const workflow = defineWorkflow({
  name: 'workflow-name',
  version: '1.0.0'
}, async (input) => {
  const result1 = await step.run('step1', async () => {
    // 步骤1逻辑
  });

  const result2 = await step.run('step2', async () => {
    // 步骤2逻辑
  });

  return result2;
});

export default workflow;
\`\`\`

可用的步骤类型：
- agentStep: 调用 AI Agent
- browserStep: 浏览器操作
- notificationStep: 发送通知
- codeStep: 执行代码
    `
  });

  return llmResponse.code;
}

// 2. 动态执行生成的工作流
async function executeGeneratedWorkflow(code: string, input: any) {
  // 方案A：使用 eval（简单但不安全）
  const workflow = eval(code);

  // 方案B：保存为文件后动态 import（推荐）
  const filePath = `/tmp/workflow-${Date.now()}.ts`;
  await fs.writeFile(filePath, code);
  const workflow = await import(filePath);

  // 执行工作流
  const engine = createWorkflowEngine();
  return await engine.run(workflow.default, input);
}

// 3. 工作流存储和管理
interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  code: string;  // 生成的 TypeScript 代码
  createdAt: Date;
  createdBy: 'llm' | 'user';
}

// 存储到数据库
function saveWorkflow(workflow: WorkflowDefinition) {
  db.prepare(`
    INSERT INTO workflows (id, name, version, code, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    workflow.id,
    workflow.name,
    workflow.version,
    workflow.code,
    workflow.createdAt.toISOString(),
    workflow.createdBy
  );
}
```

**需要自定义开发的部分**：

1. ✅ **LLM Prompt 设计**（1-2天）
   - 设计工作流生成的 System Prompt
   - 提供步骤类型的文档和示例
   - 处理 LLM 输出的代码提取和验证

2. ✅ **动态代码执行**（2-3天）
   - 实现安全的代码执行机制
   - 处理 TypeScript 编译
   - 错误处理和沙箱隔离

3. ✅ **工作流存储**（1-2天）
   - 数据库表设计
   - CRUD 接口
   - 版本管理

**总计**：4-7天开发时间

---

## 问题 2：工作流能否支持代码执行、浏览器操作、消息通知？

### OpenWorkflow 的扩展机制

**✅ 完全支持**

OpenWorkflow 本身只是工作流引擎，不提供具体的执行能力。但它提供了完全的扩展性，我们可以在 `step.run()` 中调用任何 Node.js 代码。

### 实现方案

#### 1. Agent 步骤（代码执行）

```typescript
// src/lib/workflow/steps/agent-step.ts
import { callClaudeAgent } from '@/lib/claude-client';

export async function agentStep(prompt: string, tools?: string[]) {
  const result = await callClaudeAgent({
    prompt,
    tools,
    // 其他配置
  });

  return {
    output: result.output,
    toolCalls: result.toolCalls,
  };
}

// 在工作流中使用
const workflow = defineWorkflow({
  name: 'agent-workflow'
}, async (input) => {
  const result = await step.run('analyze', async () => {
    return await agentStep('分析这个任务：' + input.task);
  });

  return result;
});
```

#### 2. 浏览器步骤

```typescript
// src/lib/workflow/steps/browser-step.ts
import { getBrowserManager } from '@/electron/browser/browser-manager';

export async function browserStep(config: {
  action: 'navigate' | 'click' | 'input' | 'screenshot';
  url?: string;
  selector?: string;
  value?: string;
}) {
  const browserManager = getBrowserManager();

  switch (config.action) {
    case 'navigate':
      await browserManager.navigate(config.url!);
      break;
    case 'click':
      await browserManager.click(config.selector!);
      break;
    case 'input':
      await browserManager.input(config.selector!, config.value!);
      break;
    case 'screenshot':
      return await browserManager.screenshot();
  }
}

// 在工作流中使用
const workflow = defineWorkflow({
  name: 'browser-workflow'
}, async (input) => {
  await step.run('open-page', async () => {
    await browserStep({ action: 'navigate', url: input.url });
  });

  const screenshot = await step.run('capture', async () => {
    return await browserStep({ action: 'screenshot' });
  });

  return screenshot;
});
```

#### 3. 通知步骤

```typescript
// src/lib/workflow/steps/notification-step.ts
import { getBridgeService } from '@/lib/bridge/app/bridge-service';

export async function notificationStep(config: {
  type: 'feishu' | 'system';
  title: string;
  content: string;
  sessionId?: string;
}) {
  if (config.type === 'feishu' && config.sessionId) {
    const bridgeService = getBridgeService();
    await bridgeService.sendMessage({
      sessionId: config.sessionId,
      content: config.content,
    });
  } else if (config.type === 'system') {
    // 系统通知
    new Notification(config.title, {
      body: config.content,
    });
  }
}

// 在工作流中使用
const workflow = defineWorkflow({
  name: 'notification-workflow'
}, async (input) => {
  await step.run('notify', async () => {
    await notificationStep({
      type: 'feishu',
      title: '任务完成',
      content: '工作流执行完成',
      sessionId: input.sessionId,
    });
  });
});
```

#### 4. 完整示例：组合多种能力

```typescript
// 完整的工作流：Agent + Browser + Notification
const complexWorkflow = defineWorkflow({
  name: 'data-collection-workflow',
  version: '1.0.0'
}, async (input: { url: string; sessionId: string }) => {

  // 步骤1：Agent 分析任务
  const analysis = await step.run('analyze-task', async () => {
    return await agentStep(`分析这个网页需要采集什么数据：${input.url}`);
  });

  // 步骤2：浏览器打开页面
  await step.run('open-page', async () => {
    await browserStep({ action: 'navigate', url: input.url });
  });

  // 步骤3：浏览器截图
  const screenshot = await step.run('capture-screenshot', async () => {
    return await browserStep({ action: 'screenshot' });
  });

  // 步骤4：Agent 分析截图并提取数据
  const data = await step.run('extract-data', async () => {
    return await agentStep(
      `从这个截图中提取数据：${analysis.output}`,
      ['vision']
    );
  });

  // 步骤5：发送通知
  await step.run('send-notification', async () => {
    await notificationStep({
      type: 'feishu',
      title: '数据采集完成',
      content: `已从 ${input.url} 采集数据`,
      sessionId: input.sessionId,
    });
  });

  return data;
});
```

**需要自定义开发的部分**：

1. ✅ **步骤封装**（3-5天）
   - agentStep: 封装 claude-agent-sdk 调用
   - browserStep: 封装浏览器工作区 API
   - notificationStep: 封装飞书/系统通知
   - 其他自定义步骤（文件操作、数据库等）

2. ✅ **错误处理**（1-2天）
   - 统一的错误处理机制
   - 重试策略
   - 失败回滚

**总计**：4-7天开发时间

---

## 问题 3：还需要哪些自定义开发？是否有 UI？

### OpenWorkflow 自带的功能

**✅ 内置监控面板**

OpenWorkflow 提供了内置的监控面板（Dashboard），可以：
- 查看所有工作流执行记录
- 查看每个步骤的状态和耗时
- 查看执行日志
- 可视化工作流执行过程

**访问方式**：
```typescript
import { createDashboard } from '@openworkflow/dashboard';

const dashboard = createDashboard({
  port: 3001,
  adapter: sqliteAdapter
});

// 访问 http://localhost:3001
```

### 需要自定义开发的部分

#### 1. 工作流管理界面（必须）

**功能需求**：
- 工作流列表（显示所有已创建的工作流）
- 创建工作流（LLM 生成或手动编写）
- 编辑工作流（代码编辑器）
- 删除工作流
- 工作流版本管理

**UI 设计**：
```
┌─────────────────────────────────────────────────────┐
│  Lumos - 工作流管理                    [+ 新建工作流] │
├─────────────────────────────────────────────────────┤
│                                                       │
│  📋 我的工作流                                        │
│  ┌───────────────────────────────────────────────┐  │
│  │ 🤖 数据采集工作流              v1.0.0  [编辑]  │  │
│  │ 最后执行：2026-03-18 10:30    成功             │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ 📊 定时报告工作流              v1.0.0  [编辑]  │  │
│  │ 最后执行：2026-03-17 09:00    成功             │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

**开发工作量**：5-7天

#### 2. LLM 工作流生成界面（必须）

**功能需求**：
- 自然语言输入框
- LLM 生成工作流代码
- 代码预览和编辑
- 一键保存和执行

**UI 设计**：
```
┌─────────────────────────────────────────────────────┐
│  创建工作流 - AI 生成                                 │
├─────────────────────────────────────────────────────┤
│                                                       │
│  📝 描述你的工作流需求：                              │
│  ┌───────────────────────────────────────────────┐  │
│  │ 每天早上9点，从飞书文档读取待办事项，用AI分析  │  │
│  │ 优先级，发送通知到飞书                         │  │
│  └───────────────────────────────────────────────┘  │
│                                          [生成工作流] │
│                                                       │
│  💻 生成的代码：                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │ const workflow = defineWorkflow({             │  │
│  │   name: 'daily-todo-workflow',                │  │
│  │   version: '1.0.0'                            │  │
│  │ }, async (input) => {                         │  │
│  │   // ... 生成的代码                            │  │
│  │ });                                           │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│                              [保存] [保存并执行]      │
└─────────────────────────────────────────────────────┘
```

**开发工作量**：3-5天

#### 3. 工作流编辑器（可选）

**两种模式**：

**模式A：代码编辑器（推荐，简单）**
- 使用 Monaco Editor
- 语法高亮
- 自动补全
- 错误提示

**开发工作量**：2-3天

**模式B：可视化编辑器（复杂，不推荐初期）**
- 使用 React Flow
- 拖拽节点
- 连接线
- 需要双向转换（可视化 ↔ 代码）

**开发工作量**：10-15天

**建议**：初期只做代码编辑器，可视化编辑器作为未来增强功能

#### 4. 执行历史和日志查看（必须）

**功能需求**：
- 查看工作流执行历史
- 查看每次执行的详细日志
- 查看每个步骤的输入输出
- 错误追踪和调试

**UI 设计**：
```
┌─────────────────────────────────────────────────────┐
│  数据采集工作流 - 执行历史                            │
├─────────────────────────────────────────────────────┤
│                                                       │
│  📊 执行记录                                          │
│  ┌───────────────────────────────────────────────┐  │
│  │ ✅ 2026-03-18 10:30  成功  耗时: 45s          │  │
│  │    ├─ analyze-task      ✅ 5s                 │  │
│  │    ├─ open-page         ✅ 10s                │  │
│  │    ├─ capture-screenshot ✅ 2s                │  │
│  │    ├─ extract-data      ✅ 25s                │  │
│  │    └─ send-notification ✅ 3s                 │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ ❌ 2026-03-18 09:15  失败  耗时: 12s          │  │
│  │    ├─ analyze-task      ✅ 5s                 │  │
│  │    └─ open-page         ❌ 超时                │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

**开发工作量**：3-5天

**注意**：OpenWorkflow 的内置 Dashboard 已经提供了基础的执行历史查看功能，我们可以：
- 选项A：直接使用 OpenWorkflow Dashboard（0天开发）
- 选项B：集成到 Lumos UI 中（3-5天开发）

**建议**：初期使用 OpenWorkflow Dashboard，后期再集成到 Lumos UI

---

## 总结

### 三个问题的答案

| 问题 | 答案 | 说明 |
|------|------|------|
| **1. LLM 能否定义生成和管理工作流？** | ✅ **完全可行** | OpenWorkflow 使用 TypeScript 代码定义工作流，LLM 可以生成。需要开发：Prompt 设计、动态执行、存储管理（4-7天） |
| **2. 工作流能否支持代码执行、浏览器、通知？** | ✅ **完全支持** | OpenWorkflow 提供完全扩展性，可以在 step.run() 中调用任何 Node.js 代码。需要开发：步骤封装、错误处理（4-7天） |
| **3. 还需要哪些自定义开发？是否有 UI？** | ⚠️ **需要自定义 UI** | OpenWorkflow 提供内置 Dashboard，但需要开发：工作流管理界面、LLM 生成界面、代码编辑器（10-15天） |

### 开发工作量估算

#### 核心功能（必须）

| 模块 | 工作量 | 优先级 |
|------|--------|--------|
| LLM Prompt 设计 | 1-2天 | P0 |
| 动态代码执行 | 2-3天 | P0 |
| 工作流存储 | 1-2天 | P0 |
| Agent 步骤封装 | 1-2天 | P0 |
| Browser 步骤封装 | 1-2天 | P0 |
| Notification 步骤封装 | 1天 | P0 |
| 错误处理 | 1-2天 | P0 |
| 工作流管理界面 | 5-7天 | P0 |
| LLM 生成界面 | 3-5天 | P0 |

**核心功能总计**：17-26天

#### 增强功能（可选）

| 模块 | 工作量 | 优先级 |
|------|--------|--------|
| 代码编辑器（Monaco） | 2-3天 | P1 |
| 执行历史集成 | 3-5天 | P1 |
| 可视化编辑器 | 10-15天 | P2 |
| 工作流模板库 | 2-3天 | P2 |

**增强功能总计**：17-26天

### 分阶段实施计划

#### Phase 1：核心功能（3-4周）

**目标**：实现基本的工作流创建和执行

1. **Week 1**：基础设施
   - OpenWorkflow 集成
   - 步骤封装（Agent/Browser/Notification）
   - 工作流存储

2. **Week 2**：LLM 生成
   - Prompt 设计
   - 动态代码执行
   - 错误处理

3. **Week 3-4**：UI 开发
   - 工作流管理界面
   - LLM 生成界面
   - 基础测试

**交付物**：
- ✅ 可以通过 LLM 生成工作流
- ✅ 可以执行包含 Agent/Browser/Notification 的工作流
- ✅ 基础的管理界面

#### Phase 2：增强功能（2-3周）

**目标**：提升用户体验和功能完整性

1. **Week 5**：编辑器
   - Monaco 代码编辑器集成
   - 语法高亮和自动补全
   - 错误提示

2. **Week 6**：执行历史
   - 集成 OpenWorkflow Dashboard
   - 或开发自定义执行历史界面
   - 日志查看和调试

3. **Week 7**（可选）：高级功能
   - 工作流模板库
   - 定时执行
   - 条件分支优化

**交付物**：
- ✅ 完整的代码编辑体验
- ✅ 执行历史和调试能力
- ✅ 生产可用的工作流系统

---

## 最终建议

### ✅ OpenWorkflow 完全满足需求

**结论**：OpenWorkflow 可以满足 Lumos 的所有工作流需求

1. **LLM 生成工作流**：✅ 完全可行
   - TypeScript 代码定义，LLM 可以生成
   - 需要开发 Prompt 和动态执行（4-7天）

2. **多种能力支持**：✅ 完全支持
   - Agent、Browser、Notification 都可以封装为步骤
   - 需要开发步骤封装（4-7天）

3. **UI 界面**：⚠️ 需要自定义开发
   - OpenWorkflow 提供基础 Dashboard
   - 需要开发管理界面和 LLM 生成界面（10-15天）

### 总开发时间

- **最小可用版本（MVP）**：3-4周
- **完整功能版本**：5-7周

### 风险评估

**低风险**：
- ✅ OpenWorkflow 技术成熟（1.2k stars）
- ✅ TypeScript 原生，与 Lumos 技术栈一致
- ✅ 支持 SQLite，复用现有基础设施
- ✅ 扩展性强，可以封装任何 Node.js 代码

**中等风险**：
- ⚠️ 需要自定义开发较多 UI（10-15天）
- ⚠️ LLM 生成代码的质量需要验证
- ⚠️ 动态代码执行的安全性需要考虑

**缓解措施**：
1. 先做 POC（1周）验证核心功能
2. 分阶段实施，逐步交付
3. 代码沙箱隔离，限制权限
4. LLM 生成代码需要用户审核

### 下一步行动

1. [ ] **POC 验证**（1周）
   - 安装 OpenWorkflow
   - 实现一个简单的 Agent → Browser → Notification 工作流
   - 测试 SQLite 集成
   - 验证性能和资源占用

2. [ ] **如果 POC 成功**
   - 启动 Phase 1 开发（3-4周）
   - 实现核心功能

3. [ ] **如果 POC 失败**
   - 评估 Flowcraft 作为备选
   - 或重新考虑 Temporal

---

## 参考资料

- [OpenWorkflow 官网](https://openworkflow.dev)
- [OpenWorkflow GitHub](https://github.com/openworkflowdev/openworkflow)
- [OpenWorkflow 文档](https://openworkflow.dev/docs)

