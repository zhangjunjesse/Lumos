# Team Runtime 控制语义合同

**版本**: 1.0  
**日期**: 2026-03-14  
**状态**: 可直接支撑 Phase 2 / Phase 5 开发

---

## 1. 文档目标

本文档定义运行时控制动作的精确语义，解决以下阻塞点：

1. `approve/start` 的幂等性
2. `pause/cancel/resume` 在 Claude SDK 不支持强中断时如何定义
3. `retry` 和 `blocked` 如何流转
4. `summary publish` 何时发生，失败怎么处理

本文档优先保证“可实现”和“语义一致”，而不是追求最强控制能力。

---

## 2. 基本原则

1. 控制动作必须幂等
2. 控制动作必须先落库，再调度
3. 对无法强中断的运行阶段，采用“drain 语义”
4. 公开状态和内部控制标记要分开

---

## 3. 术语

## 3.1 公开运行状态

公开给 UI 的 `runStatus`：

```text
pending | ready | running | paused | cancelling | cancelled | summarizing | done | failed
```

## 3.2 内部控制标记

```text
pause_requested_at
cancel_requested_at
published_at
```

公开状态描述“现在是什么”，内部控制标记描述“系统请求做什么”。

---

## 4. approve / start 语义

## 4.1 `approveTaskPlan(taskId)`

语义：

1. 将 `tasks.team_approval_status` 置为 `approved`
2. 如果 `current_run_id` 为空，则创建一个新的 Team Run
3. 如果 `current_run_id` 已存在且 run 未终止，则返回现有 run
4. 该操作必须幂等

### 幂等规则

```text
同一个 task 重复 approve:
- 不重复创建多个 active run
- 返回同一个 active runId
```

### 失败回滚规则

如果在创建 run 前失败，只保留审批状态，不产生半初始化 runtime 记录。

如果 run 已创建但 stage 未落库失败，整个创建事务回滚。

## 4.2 `startRun(runId)`

语义：

1. 仅允许在 `ready` 或 `paused` 状态进入调度
2. 启动后由 Orchestrator 接管
3. `startRun` 本身不直接执行 stage，只负责把 run 放入可调度态

---

## 5. pause 语义

## 5.1 MVP 定义

由于当前 Claude SDK `query()` 无可靠强暂停能力，MVP 的 pause 使用“drain pause”。

### `pauseRun(runId)` 的效果

1. 写入 `pause_requested_at`
2. Orchestrator 立即停止分配新的 ready stages
3. 已经 `assigned` 或 `running` 的 attempts 允许自然结束
4. 当所有 in-flight attempts 结束后，run 进入 `paused`

### 公开状态变化

```text
running --(pause requested)--> running
running --(all inflight drained)--> paused
```

原因：

- 不引入未定义的“half-paused”状态
- 避免 UI 误以为阶段被立即中断

### UI 呈现建议

如果 `pause_requested_at != null` 且 `runStatus == running`，UI 可显示 “Pausing” 文案，但后端公开状态仍保持 `running`，直到真正进入 `paused`。

---

## 6. cancel 语义

## 6.1 MVP 定义

由于当前执行器缺少强 kill 能力，cancel 使用“drain cancel”。

### `cancelRun(runId)` 的效果

1. 公开状态立即进入 `cancelling`
2. 写入 `cancel_requested_at`
3. Orchestrator 停止分配新的 ready stages
4. 对已 in-flight attempts 发出 best-effort cancel 信号
5. 若无法中断，则等待其自然返回
6. 返回后结果不再解锁下游阶段
7. 所有未完成 stage 最终进入 `cancelled`
8. run 最终进入 `cancelled`

### 结果保留规则

已 in-flight 的 attempt 在 cancel 请求后完成时：

- 原始输出可作为 artifact 保留
- 但该输出不能用于继续推进 DAG
- stage 最终状态应以 `cancelled` 为准

---

## 7. resume 语义

## 7.1 `resumeRun(runId)`

仅允许从 `paused` 进入恢复。

效果：

1. 清空 `pause_requested_at`
2. 重新计算 ready stages
3. 已 `done` 的阶段保持不变
4. 已 `failed` 的阶段不自动重试
5. `blocked` 阶段只有在阻塞条件清除后才可重新进入 `ready`
6. run 重新进入 `running`

### 不允许

- `cancelled` 的 run 不允许 resume
- `failed` 的 run 不直接 resume，应先 retry 对应 stage 或重新创建 run

---

## 8. retry 语义

## 8.1 `retryStage(stageId)`

用于人工重试失败阶段。

前置条件：

- stage 当前状态为 `failed`
- `retryCount < maxRetriesPerTask`
- run 未处于 `cancelled` 或 `done`

效果：

1. `retryCount + 1`
2. 新建一条 `team_run_stage_attempts`
3. 发出 `stage.retry_requested` 事件
4. stage 状态重新回到 `ready`
5. 等待 Orchestrator 正常调度

### 下游阶段规则

下游 `blocked` 阶段在上游 retry 成功前保持 `blocked`。  
上游重试成功后，由 Orchestrator 重新计算下游是否进入 `ready`。

---

## 9. blocked 语义

## 9.1 `blocked` 不等于 `failed`

`blocked` 只表示当前不能继续，并不代表本阶段已经执行失败。

## 9.2 进入 `blocked` 的场景

1. 上游阶段 `failed`
2. 上游阶段 `cancelled`
3. 关键输入 contract 不满足
4. 需要人工补充信息

## 9.3 离开 `blocked` 的条件

1. 上游依赖通过 retry 成功
2. 人工补充缺失输入
3. 未来由 Planner 重规划

### MVP 约束

MVP 阶段不实现自动 re-plan。  
因此 `blocked` 的恢复只支持：

- 上游 retry 成功
- 人工 override

---

## 10. run 完成与失败收敛

## 10.1 完成条件

满足以下条件时 run 进入 `summarizing`：

1. 所有 stage 终态均为 `done`
2. 没有 in-flight attempts

随后：

```text
summarizing -> done
```

## 10.2 失败条件

满足以下条件时 run 进入 `failed`：

1. 至少一个 stage 为 `failed`
2. 没有可继续调度的 ready stage
3. 没有 in-flight attempts
4. run 未请求 cancel

## 10.3 取消优先级

如果同时满足“存在 failed stage”和“cancel requested”，最终状态以 `cancelled` 为准，不以 `failed` 为准。

---

## 11. summary 生成与发布语义

## 11.1 summary 生成

run 进入 `summarizing` 后：

1. 生成 `FinalSummaryPayloadV1`
2. 调用 summarizer
3. 写回 `team_runs.final_summary`
4. 写回 `tasks.final_result_summary`

### 生成失败

如果 summarizer 失败：

- run 可进入 `failed`
- 已完成的 stage 结果不得丢失
- 允许人工补充 final summary

## 11.2 publish 语义

`publish` 和 `summary generate` 不是同一动作。

### 系统必须保证

1. `final_summary` 先持久化
2. 再尝试回写 Main Agent 聊天

### 如果聊天回写失败

- `tasks.final_result_summary` 仍然有效
- `team_runs.published_at` 保持为空
- 允许用户手动重试 publish

### `publishSummary(runId)` 的幂等性

如果 `published_at` 已存在，重复 publish 不应再次发送重复消息，除非显式传入 `force=1`。

---

## 12. 推荐控制 API

本文档不强绑路由实现，但建议控制接口统一为 command 风格：

```text
POST /api/tasks/:taskId/approve
POST /api/team-runs/:runId/pause
POST /api/team-runs/:runId/resume
POST /api/team-runs/:runId/cancel
POST /api/team-runs/:runId/stages/:stageId/retry
POST /api/team-runs/:runId/publish-summary
```

所有控制接口都必须：

1. 幂等
2. 先写事件，再返回
3. 返回新的 run projection 或最少返回 `runId + runStatus`

---

## 13. 事件要求

以下控制动作必须发事件：

- `task.approved`
- `run.started`
- `run.pause_requested`
- `run.paused`
- `run.cancel_requested`
- `run.cancelled`
- `stage.retry_requested`
- `summary.generated`
- `summary.published`

---

## 14. 与当前代码的落地建议

### `pause`

当前实现不能仅仅更新 DB 状态后就算完成，必须至少：

- 让 Orchestrator 停止调度新 stage
- 允许 in-flight drain

### `cancel`

当前实现不能只改 `team_runs.status = cancelled`，必须阻止 DAG 继续推进。

### `resume`

当前实现不能只把状态改回 `running`，必须重新计算 ready stages。

---

## 15. 验收标准

满足以下条件，说明控制语义足够支撑开发：

1. `approve/start` 幂等
2. `pause/cancel` 在无强中断能力时仍有一致语义
3. `resume/retry/blocked` 的状态转换是明确的
4. `summary` 的持久化与发布语义已经分离
5. UI 可以稳定解释每个控制动作的真实含义
