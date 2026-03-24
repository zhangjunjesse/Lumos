# 架构一致性审查报告

> 状态说明（2026-03-19）
> 本文记录的是上一版 `03/04/05` 文档的审查结果，用于保留问题发现过程。
> 当前主设计已收口为“受限 `Workflow DSL v1` + `generate_workflow` 编译 + OpenWorkflow 执行编译产物”，其中 `subworkflow` 不属于 `v1`，Phase 1 仅开放 `agent / browser / notification`。

## 1. 审查概述

**审查范围**：
- 03-scheduling-layer-design.md
- 04-workflow-mcp-design.md
- 05-workflow-engine-design.md

**审查重点**：
1. 层级关系清晰度
2. 数据流完整性
3. 接口一致性
4. 实施计划可行性

**审查结论**：✅ 整体架构设计合理，存在 3 个需要修正的问题

---

## 2. 层级关系审查

### 2.1 架构层次

```
Task Management (任务状态管理)
    ↓ acceptTask
Scheduling Layer (任务分析、工作流生成) ← 03 文档
    ↓ generate_workflow (MCP)
Workflow MCP Server (代码生成) ← 04 文档
    ↓ submitWorkflow
Workflow Engine (工作流执行) ← 05 文档
    ↓ agentStep / browserStep
SubAgent / Browser (实际执行)
```

### 2.2 职责边界

| 层级 | 职责 | 不负责 |
|------|------|--------|
| **Scheduling Layer** | 任务分析、策略决策、工作流生成、执行监控 | 任务存储、工作流执行、实际工作 |
| **Workflow MCP Server** | 代码生成、模板管理、语法验证 | 任务分析、代码执行 |
| **Workflow Engine** | 工作流执行、状态管理、步骤编排、错误处理 | 工作流生成、任务管理、实际工作 |

**审查结果**：✅ 职责边界清晰，无重叠或遗漏

---

## 3. 数据流审查

### 3.1 完整数据流

```
用户输入
  ↓
Task Management 创建任务
  ↓
Scheduling Layer.acceptTask(task)
  ↓
LLM 分析任务 → 生成 WorkflowSpec (JSON)
  {
    workflow_type: 'sequential',
    steps: [
      { type: 'agent', name: 'search', params: {...} },
      { type: 'agent', name: 'analyze', params: {...} }
    ]
  }
  ↓
MCP.generate_workflow(spec)
  ↓
返回 TypeScript 代码
  ↓
Workflow Engine.submitWorkflow(code)
  ↓
OpenWorkflow 执行
  ↓
agentStep / browserStep / notificationStep
  ↓
返回结果
  ↓
Workflow Engine.onWorkflowCompleted
  ↓
Scheduling Layer 汇总结果
  ↓
Task Management.updateTaskStatus
  ↓
通知用户
```

**审查结果**：✅ 数据流完整，无断点

### 3.2 数据格式一致性

**问题 1：步骤类型不一致** ⚠️

- **03 文档** (Scheduling Layer)：
  ```typescript
  enum: ['agent', 'browser', 'notification', 'http', 'data']
  ```

- **04 文档** (MCP Server)：
  ```typescript
  enum: ['agent', 'browser', 'notification', 'http', 'data']
  ```

- **05 文档** (Workflow Engine)：
  ```typescript
  // 只提到 agentStep、browserStep、notificationStep
  // 缺少 httpStep、dataStep 的实现
  ```

**修正建议**：
1. 在 05 文档中补充 `httpStep` 和 `dataStep` 的接口定义
2. 或者在 03/04 文档中移除 `http` 和 `data` 类型（如果暂不支持）

---

## 4. 接口一致性审查

### 4.1 Scheduling Layer → MCP Server

**03 文档调用**：
```typescript
const workflowCode = await mcp.call('generate_workflow', {
  name: task.summary,
  workflow_type: workflowSpec.workflow_type,
  steps: workflowSpec.steps
});
```

**04 文档接口**：
```typescript
{
  name: 'generate_workflow',
  inputSchema: {
    properties: {
      name: { type: 'string' },
      workflow_type: { enum: ['sequential', 'parallel', 'conditional'] },
      steps: { type: 'array', ... }
    }
  }
}
```

**审查结果**：✅ 接口一致

### 4.2 Scheduling Layer → Workflow Engine

**03 文档调用**：
```typescript
interface SubmitWorkflowRequest {
  taskId: string;
  workflowCode: string;
  inputs: Record<string, any>;
}
```

**05 文档接口**：
```typescript
interface SubmitWorkflowRequest {
  taskId: string;
  workflowCode: string;
  inputs: Record<string, any>;
}
```

**审查结果**：✅ 接口一致

### 4.3 Workflow Engine → Scheduling Layer (回调)

**03 文档期望**：
```typescript
interface WorkflowProgressEvent {
  workflowId: string;
  progress: number;
  currentNodes: string[];
  completedNodes: string[];
}
```

**05 文档未明确定义回调接口** ⚠️

**问题 2：回调接口缺失**

05 文档中提到"OpenWorkflow 自动管理状态"，但未说明如何回调 Scheduling Layer。

**修正建议**：
在 05 文档中补充：
```typescript
// 4.3 回调 Scheduling Layer
interface WorkflowCallbacks {
  onProgress: (event: WorkflowProgressEvent) => void;
  onCompleted: (event: WorkflowCompletedEvent) => void;
  onFailed: (event: WorkflowFailedEvent) => void;
}
```

---

## 5. 实施计划审查

### 5.1 时间估算

| 阶段 | 内容 | 时间 |
|------|------|------|
| **Week 1** | MCP Server 开发（模板 + 代码生成） | 1 周 |
| **Week 2** | Workflow Engine 集成（OpenWorkflow + 步骤封装） | 1 周 |
| **Week 3** | Scheduling Layer 实现（LLM 分析 + MCP 调用） | 1 周 |
| **总计** | | **3 周** |

### 5.2 依赖关系

```
Week 1: MCP Server (独立开发)
  ↓
Week 2: Workflow Engine (依赖 MCP Server 生成的代码格式)
  ↓
Week 3: Scheduling Layer (依赖 MCP Server 和 Workflow Engine)
```

**审查结果**：✅ 依赖关系合理，可以按顺序实施

### 5.3 风险评估

**低风险**：
- ✅ MCP Server：模板技术成熟
- ✅ Workflow Engine：OpenWorkflow 已验证

**中风险**：
- ⚠️ LLM 生成质量：需要 Prompt 优化
- ⚠️ 步骤类型扩展：http/data 步骤需要额外开发

**问题 3：缺少 POC 验证** ⚠️

05 文档提到"Phase 1：POC 验证（1周）"，但总体计划中未包含。

**修正建议**：
在 Week 1 之前增加 POC 阶段（3-5 天）：
- 验证 OpenWorkflow 集成
- 测试模板生成代码的可执行性
- 验证 LLM 生成 JSON 的成功率

**调整后时间**：3-4 周（含 POC）

---

## 6. 发现的问题汇总

### 问题 1：步骤类型不一致 ⚠️

**位置**：03/04 文档定义了 `http` 和 `data` 类型，但 05 文档未实现

**影响**：中等（如果 LLM 生成这两种类型会执行失败）

**修正方案**：
- 方案 A：在 05 文档补充 `httpStep` 和 `dataStep` 实现
- 方案 B：在 03/04 文档中移除这两种类型，Phase 2 再支持

**推荐**：方案 B（先支持核心类型，逐步扩展）

### 问题 2：回调接口缺失 ⚠️

**位置**：05 文档未定义如何回调 Scheduling Layer

**影响**：高（无法上报进度和结果）

**修正方案**：
在 05 文档 4.2 节补充回调接口定义

### 问题 3：缺少 POC 验证 ⚠️

**位置**：实施计划中未包含 POC 阶段

**影响**：中等（可能遇到技术风险）

**修正方案**：
在 Week 1 之前增加 3-5 天 POC 验证

---

## 7. 修正建议

### 7.1 立即修正（阻塞性问题）

1. **补充回调接口**（05 文档）
   ```typescript
   // 在 4.2 节添加
   interface WorkflowCallbacks {
     onProgress: (event: WorkflowProgressEvent) => void;
     onCompleted: (event: WorkflowCompletedEvent) => void;
     onFailed: (event: WorkflowFailedEvent) => void;
   }
   ```

2. **统一步骤类型**（03/04/05 文档）
   - Phase 1 只支持：`agent`, `browser`, `notification`
   - Phase 2 扩展：`http`, `data`

### 7.2 优化建议（非阻塞）

1. **增加 POC 阶段**
   - 时间：3-5 天
   - 内容：验证 OpenWorkflow + 模板生成 + LLM 调用

2. **补充错误处理流程**
   - MCP 生成失败如何处理
   - Workflow 执行失败如何重试
   - 降级策略的具体实现

3. **补充监控指标**
   - 工作流生成成功率
   - 工作流执行成功率
   - 平均执行时间

---

## 8. 最终结论

### 8.1 整体评价

✅ **架构设计合理**：
- 层级清晰，职责明确
- 数据流完整，无断点
- 接口基本一致

⚠️ **存在 3 个问题**：
- 步骤类型不一致（中等影响）
- 回调接口缺失（高影响）
- 缺少 POC 验证（中等影响）

### 8.2 修正后的实施计划

```
POC 阶段（3-5 天）
  - 验证 OpenWorkflow 集成
  - 测试模板生成
  - 验证 LLM 调用
  ↓
Week 1：MCP Server 开发
  - 3 种骨架模板
  - 3 种步骤模板（agent/browser/notification）
  - 代码生成和验证
  ↓
Week 2：Workflow Engine 集成
  - OpenWorkflow 集成
  - 步骤封装（agentStep/browserStep/notificationStep）
  - 回调接口实现 ← 新增
  ↓
Week 3：Scheduling Layer 实现
  - LLM 分析任务
  - MCP 调用
  - 执行监控
  ↓
总计：3-4 周
```

### 8.3 推荐行动

1. **立即修正**：补充 05 文档的回调接口定义
2. **统一规范**：三个文档统一步骤类型为 `agent/browser/notification`
3. **增加 POC**：在 Week 1 前增加 3-5 天验证
4. **开始实施**：修正后即可开始开发

**架构可行性**：✅ 高（修正后）
