# 05 文档工作流执行机制核对报告

> 状态说明（2026-03-19）
> 本文是针对旧版 `05-workflow-engine-design.md` 草稿的历史核对报告，保留用于记录当时的问题。
> 当前 `05-workflow-engine-design.md` 已按 OpenWorkflow 源码重新收口，因此本文中的 `engine.run(...)`、`workflow.run(request.inputs)`、`runHandle.on('progress')` 等示例不再代表最新设计。

## 1. 核对范围

**对比对象**：
- 实际实现：`src/lib/workflow/test-integration.ts`
- 设计文档：`05-workflow-engine-design.md`

**核对重点**：
1. Worker 的使用
2. workflow.run() 的调用方式
3. runHandle.result() 的使用
4. 执行流程的完整性

---

## 2. 实际执行流程

### 2.1 实际代码（test-integration.ts）

```typescript
// 1. 获取 OpenWorkflow 实例
const ow = await getWorkflowEngine();

// 2. 定义工作流
const workflow = ow.defineWorkflow(
  { name: 'simple-workflow-test' },
  async ({ step }) => {
    const result = await step.run({ name: 'task' }, () => agentStep(...));
    return result;
  }
);

// 3. 创建并启动 Worker
const worker = ow.newWorker({ concurrency: 1 });
await worker.start();

// 4. 运行工作流，获取 runHandle
const runHandle = await workflow.run({});

// 5. 等待结果
const result = await runHandle.result();

// 6. 停止 Worker
await worker.stop();
```

---

## 3. 文档描述的执行流程

### 3.1 文档中的代码（05 文档 3.1 节）

```typescript
const engine = getWorkflowEngine();
const result = await engine.run(workflow, inputs);
```

---

## 4. 问题分析

### 问题 1：缺少 Worker 管理 ⚠️

**文档描述**：
```typescript
const engine = getWorkflowEngine();
const result = await engine.run(workflow, inputs);
```

**实际需要**：
```typescript
const ow = await getWorkflowEngine();
const worker = ow.newWorker({ concurrency: 1 });
await worker.start();

const runHandle = await workflow.run({});
const result = await runHandle.result();

await worker.stop();
```

**差异**：
- 文档未提及 Worker 的创建和管理
- 文档未提及 runHandle 的使用
- 文档简化了执行流程，但不符合实际 API

### 问题 2：执行方式不一致 ⚠️

**文档**：`engine.run(workflow, inputs)`
**实际**：`workflow.run(inputs)` 返回 `runHandle`

OpenWorkflow 的实际 API 是：
- `workflow.run(inputs)` - 启动工作流，返回 runHandle
- `runHandle.result()` - 等待执行结果

### 问题 3：缺少生命周期管理 ⚠️

文档未说明：
- Worker 何时创建
- Worker 何时启动/停止
- 多个工作流如何共享 Worker
- Worker 的并发控制

---

## 5. 修正建议

### 5.1 更新 3.1 节"工作流执行"

**修正前**：
```typescript
const engine = getWorkflowEngine();
const result = await engine.run(workflow, inputs);
```

**修正后**：
```typescript
// 1. 获取 OpenWorkflow 实例
const ow = await getWorkflowEngine();

// 2. 创建并启动 Worker
const worker = ow.newWorker({ concurrency: 1 });
await worker.start();

// 3. 运行工作流
const runHandle = await workflow.run(inputs);

// 4. 等待结果
const result = await runHandle.result();

// 5. 停止 Worker（可选，长期运行的服务可以保持 Worker）
await worker.stop();
```

### 5.2 补充 Worker 管理说明

在 3.1 节后增加：

```markdown
### 3.1.1 Worker 管理

**Worker 职责**：
- 执行工作流步骤
- 管理并发数
- 处理任务队列

**生命周期**：
```typescript
// 应用启动时创建全局 Worker
const globalWorker = ow.newWorker({ concurrency: 5 });
await globalWorker.start();

// 执行多个工作流（共享 Worker）
const handle1 = await workflow1.run({});
const handle2 = await workflow2.run({});

// 应用关闭时停止 Worker
await globalWorker.stop();
```

**并发控制**：
- `concurrency: 1` - 顺序执行
- `concurrency: N` - 最多 N 个步骤并行
```

---

## 6. 回调机制核对

### 6.1 文档中的回调（4.3 节）

```typescript
engine.on('progress', (progress) => {
  callbacks.onProgress({...});
});
```

### 6.2 实际 API

OpenWorkflow 的 runHandle 提供：
```typescript
const runHandle = await workflow.run({});

// 监听进度（如果 OpenWorkflow 支持）
runHandle.on('progress', (event) => {
  // 上报进度
});

// 等待结果
const result = await runHandle.result();
```

**问题**：需要确认 OpenWorkflow 是否支持进度事件

---

## 7. 总结

### 7.1 发现的问题

| 问题 | 影响 | 优先级 |
|------|------|--------|
| 缺少 Worker 管理 | 高（代码无法运行） | P0 |
| 执行方式不一致 | 高（API 调用错误） | P0 |
| 缺少生命周期管理 | 中（不清楚如何管理） | P1 |
| 回调机制待确认 | 中（进度上报可能不可用） | P1 |

### 7.2 修正建议

1. **立即修正**（P0）：
   - 更新 3.1 节的执行代码
   - 补充 Worker 管理说明

2. **后续完善**（P1）：
   - 补充 Worker 生命周期管理
   - 确认并更新回调机制

### 7.3 修正后的完整流程

```typescript
// src/lib/workflow/api.ts
export async function submitWorkflow(
  request: SubmitWorkflowRequest,
  callbacks: WorkflowCallbacks
): Promise<SubmitWorkflowResponse> {
  try {
    // 1. 加载工作流
    const workflow = await loadWorkflow(request.workflowCode);

    // 2. 获取 OpenWorkflow 实例
    const ow = await getWorkflowEngine();

    // 3. 获取或创建全局 Worker
    const worker = await getOrCreateWorker(ow);

    // 4. 生成工作流 ID
    const workflowId = generateId();

    // 5. 运行工作流
    const runHandle = await workflow.run(request.inputs);

    // 6. 监听进度（如果支持）
    runHandle.on?.('progress', (event) => {
      callbacks.onProgress({
        workflowId,
        taskId: request.taskId,
        progress: event.percentage,
        currentStep: event.currentStep,
        completedSteps: event.completedSteps
      });
    });

    // 7. 异步等待结果
    runHandle.result()
      .then(result => {
        callbacks.onCompleted({
          workflowId,
          taskId: request.taskId,
          result,
          duration: result.duration
        });
      })
      .catch(error => {
        callbacks.onFailed({
          workflowId,
          taskId: request.taskId,
          error: {
            code: error.code || 'WORKFLOW_ERROR',
            message: error.message,
            step: error.step
          }
        });
      });

    return { workflowId, status: 'accepted' };
  } catch (error) {
    return { workflowId: '', status: 'rejected' };
  }
}
```
