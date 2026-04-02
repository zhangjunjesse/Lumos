# 工作流系统优化计划

> 编号：09 | 创建日期：2026-03-29 | 状态：规划中

---

## 1. 现状问题

### 1.1 双轮询架构浪费资源

| 轮询点 | 位置 | 频率 | 问题 |
|--------|------|------|------|
| Team Banner | `ChatView.tsx` → `/api/sessions/[id]/team-banner` | 2 秒 | 无任务时仍然轮询 |
| Task Rail | `chat-task-rail.tsx` → `/api/task-management/tasks` | 4 秒 | 两路轮询互不感知 |

每个活跃会话产生 **45 次/分钟** HTTP 请求，大部分返回空或不变数据。

### 1.2 UI 表现力不足

- **chat-task-rail**（88px 侧边栏）：仅显示彩色点 + 15 字截断摘要，信息密度极低
- **workflow-center-view**（88KB）：开发调试面板，暴露 DAG、DSL 验证等内部细节，非面向用户
- **任务状态**以 JSON plan block 嵌入聊天流，用户难以解读

### 1.3 数据路径不统一

两套任务系统并行：
- `task-management`（新，scheduling-based）
- `team-run`（旧，team-plan-based）

投影、查询、状态同步各自独立，维护成本高。

### 1.4 代码量过大

- `planner.ts`：2574 行，承担规划 + DSL 生成 + 验证 + 输出格式化
- `subagent.ts` + `stage-worker.ts`：执行层职责重叠
- `types/index.ts`：残留大量已废弃类型定义

---

## 2. 优化目标

| 目标 | 指标 |
|------|------|
| 消除双轮询 | 用 SSE 替代，空闲时 0 请求 |
| 用户可感知的任务进度 | 内联卡片 + 活动面板 + 状态条 |
| 统一数据路径 | 所有任务状态变更走 TaskEventBus |
| 代码可维护 | 单文件 ≤ 300 行，职责单一 |

---

## 3. 四阶段实施计划

### Phase 1：数据基础（预计 2-3 天）

**目标**：建立统一的事件总线和推送通道，为 UI 层提供实时数据源。

#### 1.1 TaskEventBus

创建 `src/lib/task-event-bus.ts`：

```
EventEmitter 单例
├── emit('task:created', { taskId, sessionId, ... })
├── emit('task:status-changed', { taskId, from, to })
├── emit('stage:progress', { taskId, stageId, progress })
└── emit('task:completed', { taskId, result })
```

**改动点**：
- `src/lib/db/tasks.ts` — 在 `upsertTeamPlanTask`、状态更新函数中触发事件
- `src/lib/team-run/orchestrator.ts` — 阶段完成时触发 `stage:progress`

#### 1.2 SSE 推送端点

创建 `src/app/api/sessions/[id]/events/route.ts`：

```
GET /api/sessions/:id/events
→ Content-Type: text/event-stream
→ 监听 TaskEventBus，过滤 sessionId
→ 推送 task:created / status-changed / stage:progress / completed
→ 30 秒心跳保活
```

#### 1.3 安全层迁移

- 将 `team-banner/route.ts` 的 `ensureSessionTeamRunsExecution()` 迁移到 SSE 连接建立时触发
- 保留 team-banner GET 作为降级路径（SSE 断连时一次性拉取）

#### 1.4 交付物

- [ ] `task-event-bus.ts` 单例
- [ ] SSE 端点 + 心跳
- [ ] 现有写入点触发事件
- [ ] 单元测试：事件发射 & 过滤

---

### Phase 2：UI 替换（预计 3-4 天）

**目标**：用 3 个新组件替代现有的 chat-task-rail 和 workflow-center-view。

#### 2.1 TaskCard — 内联任务卡片

位置：嵌入聊天消息流（替代 JSON plan block）

```
┌─────────────────────────────────────────┐
│ 📋 构建用户认证系统          [进行中 ▶]  │
│                                         │
│ ● 数据库 schema 设计     ✅ 完成        │
│ ● API 端点实现           🔄 执行中      │
│ ● 前端登录页面           ⏳ 等待中      │
│                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━░░░░░░░ 66%      │
│                                         │
│ [查看详情]  [暂停]  [取消]              │
└─────────────────────────────────────────┘
```

**组件文件**：`src/components/chat/TaskCard.tsx`
- 消息渲染器检测 `team_plan` 类型消息 → 渲染 TaskCard
- 状态通过 SSE 实时更新，无需轮询
- 折叠/展开阶段详情
- 操作按钮：暂停、取消、查看详情

#### 2.2 TaskActivityPanel — 活动面板

位置：右侧面板（ContentPanel 区域），替代 workflow-center-view

```
┌─ 任务活动 ──────────────────────────────┐
│                                         │
│ 14:32  ● 阶段 2 完成：API 端点实现      │
│          生成了 3 个文件                 │
│                                         │
│ 14:28  ● 阶段 1 完成：数据库设计        │
│          创建了 users 表 migration       │
│                                         │
│ 14:25  ▶ 任务开始执行                   │
│          3 个阶段，预计 10 分钟          │
│                                         │
│ 14:24  ✓ 用户批准执行计划               │
│                                         │
│ ─── 产出物 ─────────────────────────    │
│ 📄 migration-001.sql                    │
│ 📄 auth-controller.ts                   │
│ 📄 login-page.tsx                       │
└─────────────────────────────────────────┘
```

**组件文件**：`src/components/workflow/TaskActivityPanel.tsx`（≤ 200 行）
- 时间线布局，最新事件在顶部
- 数据来源：SSE 事件流 + 首次加载历史
- 底部展示产出物列表
- 替代 88KB 的 workflow-center-view

#### 2.3 TaskStatusBar — 消息输入上方状态条

位置：`MessageInput` 上方，替代 chat-task-rail

```
┌─────────────────────────────────────────┐
│ 🔄 构建认证系统 · 阶段 2/3 · 66%  [详情]│
└─────────────────────────────────────────┘
```

**组件文件**：`src/components/chat/TaskStatusBar.tsx`（≤ 80 行）
- 单行高度，不占用对话空间
- 点击"详情"打开 TaskActivityPanel
- 无任务时完全隐藏
- 数据来源：SSE

#### 2.4 集成到 ChatView

```diff
- import { ChatTaskRail } from './chat-task-rail';
+ import { TaskStatusBar } from './TaskStatusBar';

  // 消息列表中
- {renderJsonPlanBlock(message)}
+ {message.taskId && <TaskCard taskId={message.taskId} />}

  // 输入框上方
- <ChatTaskRail sessionId={sessionId} />
+ <TaskStatusBar sessionId={sessionId} />

  // 右侧面板
- {activeTab === 'workflow' && <WorkflowCenterView />}
+ {activeTab === 'task-activity' && <TaskActivityPanel taskId={...} />}
```

#### 2.5 交付物

- [ ] `TaskCard.tsx` 组件 + Storybook/测试
- [ ] `TaskActivityPanel.tsx` 组件
- [ ] `TaskStatusBar.tsx` 组件
- [ ] ChatView 集成
- [ ] ContentPanel 新 tab 注册

---

### Phase 3：清理收敛（预计 1-2 天）

**目标**：移除旧路径，统一数据流。

#### 3.1 移除双轮询

```diff
  // ChatView.tsx
- const pollTeamBanner = useCallback(async () => { ... }, []);
- useEffect(() => { const id = setInterval(pollTeamBanner, 2000); ... }, []);

  // chat-task-rail.tsx
- 整个文件删除
```

#### 3.2 移除 workflow-center 导航入口

- `sidebar.tsx`：移除 workflow 图标入口
- `ContentRenderer.tsx`：移除 workflow-center-view 渲染分支
- `TabBar.tsx`：移除 workflow tab 注册

#### 3.3 统一数据路径

- 所有任务状态读取统一走 `TaskEventBus` 或 SSE
- `/api/sessions/[id]/team-banner` 保留为降级端点，标记 `@deprecated`
- 任务创建/更新统一走 `upsertTeamPlanTask` → 触发事件

#### 3.4 交付物

- [ ] 删除 `chat-task-rail.tsx`
- [ ] 删除 `workflow-center-view.tsx`（88KB）
- [ ] 移除 ChatView 中的 banner 轮询代码
- [ ] 移除侧边栏 workflow 入口
- [ ] 回归测试：任务创建 → 执行 → 完成全流程

---

### Phase 4：打磨与健壮性（预计 1-2 天）

#### 4.1 SSE 健壮性

- 断线自动重连（指数退避，最大 30 秒）
- 重连后补发 gap 期间的事件
- 连接数监控（防止僵尸连接）

#### 4.2 代码拆分

`planner.ts`（2574 行）拆分为：

| 文件 | 职责 | 预估行数 |
|------|------|----------|
| `planner-core.ts` | 规划入口 + 编排 | ~200 |
| `planner-dsl.ts` | DSL 生成 + 模板 | ~250 |
| `planner-validation.ts` | 输入/输出验证 | ~150 |
| `planner-output.ts` | 结果格式化 | ~150 |
| `planner-types.ts` | 类型定义 | ~100 |

#### 4.3 执行层简化

- 评估 `subagent.ts` 和 `stage-worker.ts` 的职责边界
- 如果 subagent 仅为 stage-worker 的薄封装，合并为一个模块
- 统一错误处理和重试逻辑

#### 4.4 类型清理

- 清理 `types/index.ts` 中已废弃的类型定义
- 移除 Phase 3 中删除组件对应的类型

#### 4.5 交付物

- [ ] SSE 重连机制
- [ ] planner 拆分完成
- [ ] 执行层简化
- [ ] 类型清理
- [ ] 全量回归测试通过

---

## 4. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| SSE 在 Electron 中的兼容性 | 推送失败 | 保留 team-banner 降级轮询 |
| Phase 2 组件设计偏差 | 返工 | 先出 TaskCard 原型，确认方向后再做其余 |
| planner 拆分引入回归 | 规划失败 | 拆分前补充 planner 核心用例测试 |
| 移除 workflow-center 影响调试 | 开发效率降低 | 在 TaskActivityPanel 中保留关键调试信息（阶段耗时、错误详情） |

---

## 5. 依赖关系

```
Phase 1 (数据基础)
    │
    ├──→ Phase 2 (UI 替换)  ──→ Phase 3 (清理收敛)
    │                                    │
    └────────────────────────────────────→ Phase 4 (打磨)
```

- Phase 2 依赖 Phase 1 的 SSE 端点
- Phase 3 依赖 Phase 2 的新组件就绪
- Phase 4 的代码拆分可与 Phase 2/3 并行

---

## 6. 验收标准

- [ ] 空闲会话产生 0 次轮询请求（SSE 心跳除外）
- [ ] 任务从创建到完成，用户可在聊天界面实时观察进度
- [ ] `workflow-center-view.tsx`（88KB）已删除
- [ ] `chat-task-rail.tsx` 已删除
- [ ] 所有单文件 ≤ 300 行
- [ ] `npm run build` 零错误
- [ ] 任务创建 → 审批 → 执行 → 完成全链路通过
