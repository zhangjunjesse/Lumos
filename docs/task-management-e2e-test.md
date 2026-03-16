# Task Management 端到端测试指南

## 测试目标

验证 Main Agent 通过 Skill Layer 和 MCP 服务器创建和管理任务的完整流程。

## 前置准备

### 1. 确认 MCP 服务器配置

检查 `public/mcp-servers/task-management.json` 文件存在且配置正确：

```json
{
  "name": "task-management",
  "description": "Create and manage complex tasks through Task Management system",
  "command": "python3",
  "args": ["resources/mcp-servers/task-management/task_management_mcp.py"],
  "env": {}
}
```

### 2. 启动开发服务器

```bash
npm run dev
```

确认服务器在 http://localhost:3000 启动成功。

## 测试步骤

### Step 1: 打开测试页面

访问 http://localhost:3000/task-management-test

你会看到：
- 测试说明卡片
- 任务列表（初始为空）
- 任务详情面板

### Step 2: 打开 Main Agent 对话

在新标签页打开 http://localhost:3000/chat 或创建新会话。

### Step 3: 触发任务创建

在对话中输入一个复杂任务请求，例如：

```
帮我实现一个完整的用户管理系统，包括：
- 用户注册和登录
- JWT 认证
- 角色权限管理
- 用户信息 CRUD
- 单元测试
```

### Step 4: 观察 Main Agent 行为

Main Agent 应该：
1. 识别这是一个复杂任务
2. 调用 `task-management` MCP 的 `createTask` 工具
3. 返回任务创建成功的消息，包含任务 ID

**预期响应示例**：
```
✅ 任务已创建 (ID: task_xxx)

任务摘要：实现用户管理系统
需求：
- 用户注册和登录
- JWT 认证
- 角色权限管理
- 用户信息 CRUD
- 单元测试

Scheduling Layer 将协调实现。你可以在 /task-management-test 查看进度。
```

### Step 5: 查看任务列表

回到测试页面 http://localhost:3000/task-management-test

点击"刷新任务列表"按钮，应该能看到刚创建的任务。

### Step 6: 查看任务详情

点击任务列表中的任务卡片，右侧面板会显示：
- 任务摘要
- 状态（pending）
- 需求列表
- 创建时间

### Step 7: 测试其他 MCP 工具

回到 Main Agent 对话，测试其他功能：

**查询任务列表**：
```
查询我的任务列表
```

Main Agent 应该调用 `listTasks` 工具并返回任务摘要。

**查询任务详情**：
```
查询任务 task_xxx 的详情
```

Main Agent 应该调用 `getTaskDetail` 工具并返回完整信息。

**取消任务**：
```
取消任务 task_xxx
```

Main Agent 应该调用 `cancelTask` 工具并确认取消成功。

## 验证点

### ✅ 架构层次验证

- [ ] Main Agent 通过 MCP 工具创建任务（不是直接 API 调用）
- [ ] Skill 文档提供决策指导
- [ ] Task Management 接收并存储任务
- [ ] Task Management 调用 Scheduling Layer（mock）

### ✅ 数据流验证

- [ ] 任务创建请求包含正确的字段（taskSummary, requirements, context）
- [ ] 任务 ID 正确生成
- [ ] 任务状态初始为 pending
- [ ] 任务列表正确返回

### ✅ 错误处理验证

测试错误场景：

**无效的任务描述**（包含第一人称）：
```
帮我实现一个系统
```

应该返回错误：`任务描述不应包含第一人称，请使用第三人称描述`

## 调试技巧

### 查看 MCP 服务器日志

MCP 服务器的 console.log 会输出到终端，查看：
```
[TaskManagement] Submitting task to Scheduling Layer (mock): task_xxx
```

### 查看浏览器控制台

打开开发者工具，查看网络请求：
- `/api/task-management/tasks` - 任务列表
- `/api/task-management/tasks/[id]` - 任务详情

### 检查 Mock 数据

任务数据存储在内存中（`src/lib/task-management/mock-data.ts`），重启服务器会清空。

## 已知限制（Mock 实现）

1. **数据不持久化**：重启服务器后任务数据丢失
2. **Scheduling Layer 是 mock**：任务不会真正执行
3. **任务状态不会自动更新**：需要手动调用 API 更新状态
4. **任务完成通知未实现**：通知 API 存在但未集成

## 下一步

完成测试后，可以：
1. 实现真实的 Scheduling Layer
2. 添加数据库持久化
3. 实现任务完成通知机制
4. 添加任务执行进度更新
