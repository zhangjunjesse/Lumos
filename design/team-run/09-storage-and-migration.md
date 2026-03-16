# Team Runtime 存储与迁移方案

**版本**: 1.0  
**日期**: 2026-03-14  
**状态**: 可直接支撑 Phase 1 开发

---

## 1. 文档目标

本文档定义：

1. 新的真相源如何落到 SQLite
2. 现有 `tasks.description` 中的 Team Plan 记录如何迁移
3. 当前 `team_runs / team_run_stages` 如何增量扩展，而不是推倒重来

本文档的原则是：

```text
增量迁移
先兼容旧数据
再停止旧写入
最后移除旧逻辑
```

---

## 2. 真相源落库策略

## 2.1 业务真相源

业务真相源落在 `tasks` 表扩展列中。

### `tasks` 的职责

- 用户级任务
- Team Plan
- 审批状态
- 当前关联 run
- 最终结果摘要

`tasks` 不再保存运行中的 phase 列表和伪运行状态。

## 2.2 运行真相源

运行真相源落在以下表中：

- `team_runs`
- `team_run_stages`
- `team_run_stage_attempts`
- `team_run_agent_instances`
- `team_run_memories`
- `team_run_artifacts`
- `team_run_events`

---

## 3. 目标表结构

## 3.1 扩展 `tasks`

现有 `tasks` 表保留，新增列：

```sql
ALTER TABLE tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'manual'
  CHECK(task_kind IN ('manual', 'team_plan'));

ALTER TABLE tasks ADD COLUMN team_plan_json TEXT;
ALTER TABLE tasks ADD COLUMN team_approval_status TEXT
  CHECK(team_approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE tasks ADD COLUMN current_run_id TEXT;
ALTER TABLE tasks ADD COLUMN final_result_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN source_message_id TEXT;
ALTER TABLE tasks ADD COLUMN approved_at TEXT;
ALTER TABLE tasks ADD COLUMN rejected_at TEXT;
ALTER TABLE tasks ADD COLUMN last_action_at TEXT;
```

新增索引：

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_task_kind ON tasks(task_kind);
CREATE INDEX IF NOT EXISTS idx_tasks_current_run_id ON tasks(current_run_id);
CREATE INDEX IF NOT EXISTS idx_tasks_team_approval_status ON tasks(team_approval_status);
```

### 字段说明

- `task_kind`
  区分普通任务和团队任务
- `team_plan_json`
  存储 `MainAgentTeamPlanV1`
- `team_approval_status`
  审批态
- `current_run_id`
  当前激活的 Team Run 引用
- `final_result_summary`
  最终面向用户的摘要

### `description` 的新语义

迁移完成后：

- `manual` task 继续使用 `description`
- `team_plan` task 的 canonical plan 不再存 `description`
- `description` 仅允许作为兼容旧数据和临时说明字段存在

---

## 3.2 扩展 `team_runs`

在现有 `team_runs` 基础上增量扩展：

```sql
ALTER TABLE team_runs ADD COLUMN task_id TEXT;
ALTER TABLE team_runs ADD COLUMN session_id TEXT;
ALTER TABLE team_runs ADD COLUMN planner_version TEXT NOT NULL DEFAULT 'compiled-run-plan/v1';
ALTER TABLE team_runs ADD COLUMN planning_input_json TEXT NOT NULL DEFAULT '';
ALTER TABLE team_runs ADD COLUMN compiled_plan_json TEXT NOT NULL DEFAULT '';
ALTER TABLE team_runs ADD COLUMN workspace_root TEXT NOT NULL DEFAULT '';
ALTER TABLE team_runs ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE team_runs ADD COLUMN final_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE team_runs ADD COLUMN pause_requested_at INTEGER;
ALTER TABLE team_runs ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE team_runs ADD COLUMN published_at TEXT;
ALTER TABLE team_runs ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 0;
```

新增索引：

```sql
CREATE INDEX IF NOT EXISTS idx_team_runs_task_id ON team_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_team_runs_session_id ON team_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_team_runs_status ON team_runs(status);
```

### 兼容策略

现有 `plan_id` 字段保留一段时间，用于兼容旧 API；新逻辑统一以 `task_id` 为主引用。

### 状态枚举策略

为避免 SQLite `CHECK` 约束重建，MVP 阶段 `team_runs.status` 的持久化枚举继续保持最小集合：

```text
pending | ready | running | paused | done | failed | cancelled
```

以下状态不直接持久化到 `team_runs.status`，而是由 projection 派生：

```text
cancelling  = cancel_requested_at != null 且 status 仍未终止
summarizing = status = running 且所有 stage 已完成且 final_summary 尚未落库
```

---

## 3.3 扩展 `team_run_stages`

在现有 `team_run_stages` 上增量增加运行时必需字段：

```sql
ALTER TABLE team_run_stages ADD COLUMN plan_task_id TEXT NOT NULL DEFAULT '';
ALTER TABLE team_run_stages ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE team_run_stages ADD COLUMN owner_agent_type TEXT NOT NULL DEFAULT '';
ALTER TABLE team_run_stages ADD COLUMN input_contract_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE team_run_stages ADD COLUMN output_contract_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE team_run_stages ADD COLUMN latest_result_ref TEXT;
ALTER TABLE team_run_stages ADD COLUMN last_error TEXT;
ALTER TABLE team_run_stages ADD COLUMN agent_definition_id TEXT;
ALTER TABLE team_run_stages ADD COLUMN workspace_dir TEXT;
ALTER TABLE team_run_stages ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE team_run_stages ADD COLUMN last_attempt_id TEXT;
```

新增索引：

```sql
CREATE INDEX IF NOT EXISTS idx_team_run_stages_run_status
  ON team_run_stages(run_id, status);

CREATE INDEX IF NOT EXISTS idx_team_run_stages_plan_task_id
  ON team_run_stages(plan_task_id);
```

### 字段语义迁移

- `name` 继续作为阶段标题
- `task` 继续保留，但新语义对齐为阶段描述
- `role_id` 在 MVP 阶段继续可作为 owner role id；后续再收敛为 `agent_definition_id`
- `latest_result` 继续保留小结果；大结果转 `latest_result_ref`
- `error` 兼容保留；新逻辑写 `last_error`

### 状态枚举策略

MVP 阶段 `team_run_stages.status` 的持久化枚举继续保持现有集合：

```text
pending | ready | running | waiting | blocked | done | failed | cancelled
```

以下概念不单独占用 stage 持久化状态：

- `assigned`
  由 `team_run_stage_attempts.status = created` 表示
- `retrying`
  由 retry 事件和新的 attempt 表示；stage 本身重新回到 `ready`

---

## 3.4 新表 `team_run_stage_attempts`

每次执行 stage 都是一条 attempt，不再把所有执行都折叠进 stage 主表。

```sql
CREATE TABLE IF NOT EXISTS team_run_stage_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  agent_instance_id TEXT,
  status TEXT NOT NULL
    CHECK(status IN ('created', 'running', 'done', 'failed', 'cancelled')),
  result_summary TEXT NOT NULL DEFAULT '',
  result_artifact_id TEXT,
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES team_run_stages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_attempt_unique
  ON team_run_stage_attempts(stage_id, attempt_no);
```

---

## 3.5 新表 `team_run_agent_instances`

```sql
CREATE TABLE IF NOT EXISTS team_run_agent_instances (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  agent_definition_id TEXT NOT NULL,
  memory_space_id TEXT,
  status TEXT NOT NULL
    CHECK(status IN ('allocated', 'running', 'completed', 'failed', 'released')),
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES team_run_stages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_run_status
  ON team_run_agent_instances(run_id, status);
```

---

## 3.6 新表 `team_run_memories`

```sql
CREATE TABLE IF NOT EXISTS team_run_memories (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT,
  owner_type TEXT NOT NULL
    CHECK(owner_type IN ('task', 'planner', 'agent_instance')),
  owner_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_run_memories_owner
  ON team_run_memories(run_id, owner_type, owner_id);
```

---

## 3.7 新表 `team_run_events`

```sql
CREATE TABLE IF NOT EXISTS team_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_run_events_run_created
  ON team_run_events(run_id, created_at);
```

---

## 4. 迁移策略

## 4.1 迁移阶段划分

### Migration A: 扩表但不切流量

目标：

- 只新增列和新表
- 不修改现有读写行为

### Migration B: 回填 team_plan task

目标：

- 解析 `tasks.description`
- 将旧的 `TeamPlanTaskRecord` 回填进新增列

### Migration C: 切换新写入

目标：

- 新的团队任务只写 `task_kind / team_plan_json / approval / current_run_id`
- 不再把 `run` 写回 `description`

### Migration D: 切换新读取

目标：

- UI 和查询层从 runtime 真相源投影读取
- 旧 `description.run` 仅作为 fallback

### Migration E: 删除模拟执行

目标：

- 移除 timer/tick 自动推进
- 移除骨架结果回写

---

## 4.2 旧数据回填规则

对 `parseTeamPlanTaskRecord(description)` 成功的 task：

1. `task_kind = 'team_plan'`
2. `team_plan_json = JSON.stringify(record.plan)`
3. `team_approval_status = record.approvalStatus`
4. `source_message_id = record.sourceMessageId`
5. `approved_at / rejected_at / last_action_at` 回填
6. `final_result_summary` 可优先取旧 `record.run.context.finalSummary`
7. `current_run_id = NULL`

### 为什么 `current_run_id = NULL`

因为旧记录中的 `run` 是伪运行态，不是真实 Team Run，不能回填成真实 run 引用。

---

## 4.3 兼容读取规则

迁移期间读取优先级：

```text
Priority 1:
tasks.task_kind / team_plan_json / team_approval_status / current_run_id

Priority 2:
parseTeamPlanTaskRecord(tasks.description)
```

即：

- 新数据优先走新字段
- 旧数据仍可解析 description
- 一旦任务完成新迁移写入，不再回写伪 run 到 description

---

## 5. 写入规则

## 5.1 批准前

写入：

- `tasks.task_kind = 'team_plan'`
- `tasks.team_plan_json`
- `tasks.team_approval_status = 'pending'`
- `tasks.current_run_id = NULL`

不写：

- `team_runs`
- `team_run_stages`

## 5.2 批准后

写入顺序：

1. `compilePlan()`
2. 创建 `team_runs`
3. 创建 `team_run_stages`
4. 写入 `tasks.current_run_id`
5. 创建 `team_run_events(run.created)`
6. 启动 orchestrator

## 5.3 执行中

执行中的所有状态变更都写 runtime 表：

- `team_runs`
- `team_run_stages`
- `team_run_stage_attempts`
- `team_run_agent_instances`
- `team_run_memories`
- `team_run_artifacts`
- `team_run_events`

`tasks` 只在以下时机更新：

- 审批状态变化
- `current_run_id` 变化
- 最终结果摘要发布

---

## 6. 不采用的方案

## 6.1 不继续把 Team Plan record 整体塞进 `description`

原因：

- 无法建立稳定索引
- 无法可靠做迁移和投影
- 业务态和运行态仍会混在一起

## 6.2 不单独创建 `team_tasks` 表

原因：

- 当前产品已有稳定的 `tasks` 概念
- 直接新增一张并行业务表会放大改造范围
- 扩展 `tasks` 足够支撑 MVP

---

## 7. 与现有代码的映射建议

### `src/lib/db/tasks.ts`

后续改造方向：

- 读取新增 task 列
- 保留旧 description parser 作为兼容 fallback
- 删除自动 tick
- 将 `getMainAgentCatalog()` 改为基于 projection service 聚合

### `src/lib/db/migrations-team-run.ts`

后续改造方向：

- 合并 team runtime 的新增表和新增列迁移
- 对已有列采用 `PRAGMA table_info` 判定后增量迁移

---

## 8. 验收标准

满足以下条件，说明存储和迁移方案可支撑开发：

1. 不需要一次性清空数据库
2. 旧 team plan task 仍然可读
3. 新任务不再依赖 `description.run`
4. `current_run_id` 能稳定关联到真实 runtime
5. 运行态表已经足够承载 stage attempt、memory、event
