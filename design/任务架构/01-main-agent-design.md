# Main Agent 设计文档

## 1. 模块定位

Main Agent 是基于 LLM 的**对话代理**，负责与用户持续交互。

**核心特征**：

- 本质是 LLM 对话，维持自然的对话流
- 大部分问题直接响应
- 只在必要时下发任务到任务系统
- 任务下发后继续对话，不阻塞用户

## 2. 核心职责

Main Agent 的唯一核心职责是**任务决策**：

### 判断是否下发任务

**决策依据**：

- 工作复杂度：是否需要多步骤编排
- 处理时间：是否超出即时响应范围
- 资源需求：是否需要专门的执行环境

**决策结果**：

- 直接响应：在当前对话中完成
- 下发任务：创建任务，交给任务系统处理

### 任务跟踪

- 用户可随时查询任务状态
- 任务完成后，系统触发 Main Agent 生成对话消息通知用户
- 保持任务与对话的关联

**主动通知机制**：

任务完成时，通过 Main Agent 的对话消息通知用户（不是系统弹窗）：

```
任务完成（事件触发）
  ↓
系统调用 Main Agent API（类似用户发消息）
  ↓
传入：
  - 完整对话上下文
  - 触发类型：task_completed
  - 任务ID和结果摘要
  ↓
Main Agent 生成对话消息
  "你的调研任务已完成，要查看详细结果吗？"
  ↓
消息插入到对话流中
  ↓
用户在对话界面看到 Main Agent 的消息
```

**调用方式**：

- 系统监听任务完成事件
- 触发时，调用 Main Agent 对话接口
- 传入特殊标记（task_completed）和任务信息
- Main Agent 识别后生成通知消息

## 3. 决策逻辑

### 判断原则（抽象定义）

Main Agent 通过 prompt 引导自己判断。判断维度：

**复杂度维度**：

- 单步操作 vs 多步骤编排
- 单一工具调用 vs 复杂流程组合
- 确定性任务 vs 需要探索和规划

**时间维度**：

- 即时响应（秒级）vs 长时间处理（分钟级）
- 同步等待 vs 异步执行

**资源维度**：

- 当前对话上下文可完成 vs 需要独立执行环境
- 简单工具调用 vs 需要专门的 Agent 协作

### 决策流程

```
用户输入
  ↓
理解意图
  ↓
评估复杂度/时间/资源 ← prompt 引导
  ↓
├─ 直接响应 → 调用工具/生成回复 → 返回用户
└─ 下发任务 → 调用 skill 创建任务 → 继续对话
```

## 4. 与 Task Management 交互

### 通过 Skill 交互

Main Agent 通过 **skill 工具** 与 Task Management 交互。

**可用 Skills**：

1. **createTask** - 创建任务
  - 输入：用户意图描述（自然语言）
  - 输出：任务ID
  - Task Management 负责解析意图并构造任务对象
2. **listTasks** - 查询任务列表
  - 输入：过滤条件（状态、时间范围）
  - 输出：任务列表（ID、标题、状态、创建时间）
  - 场景：用户问"我有哪些未完成的任务"
3. **getTaskDetail** - 获取任务详情
  - 输入：任务ID
  - 输出：完整任务信息（状态、进度、执行时间、结果、异常）
  - 场景：用户问"任务123的详细情况"
4. **getTaskProgress** - 获取任务进度
  - 输入：任务ID
  - 输出：当前进度、已完成步骤、预计剩余时间
  - 场景：用户问"任务进度怎么样了"
5. **cancelTask** - 取消任务
  - 输入：任务ID
  - 输出：取消结果
  - 场景：用户说"取消这个任务"
6. **getTaskErrors** - 获取任务异常信息
  - 输入：任务ID
  - 输出：异常列表、错误详情
  - 场景：任务失败时，查看错误原因

### 交互流程

```
Main Agent
  ↓ 调用 createTask skill
  ↓ 传递：用户意图 + 会话上下文
Task Management
  ↓ 解析意图
  ↓ 构造任务对象
  ↓ 注册任务
  ↓ 返回任务ID
Main Agent
  ↓ 告知用户任务已创建
  ↓ 继续对话
```

### 数据传递

Main Agent 传递**总结后的任务内容**，而非原始会话上下文。

**传递内容**：
```typescript
{
  taskSummary: string,        // Main Agent 总结的任务描述
  requirements: string[],     // 具体要求列表
  context: {
    sessionId: string,
    relevantMessages: Message[]  // 相关的对话片段（非全部历史）
  }
}
```

**示例**：
```
用户对话：
- "帮我做一个关于AI发展的深度调研报告"
- "重点关注医疗领域"
- "要包含案例分析"

Main Agent 传递：
{
  taskSummary: "关于AI在医疗领域发展的深度调研报告",
  requirements: [
    "重点关注医疗领域",
    "包含案例分析"
  ],
  context: {
    sessionId: "session_123",
    relevantMessages: [最近3轮相关对话]
  }
}
```

**职责划分**：
- Main Agent：理解意图，总结任务
- Task Management：解析总结，构造任务对象

### 确保总结质量

通过多层机制保障 Main Agent 传递总结内容：

**1. Prompt 明确要求**

在系统 prompt 中说明创建任务的规范：
```markdown
调用 createTask 时，必须总结用户意图：

错误：createTask("帮我做一个关于AI的调研报告") ❌
正确：createTask({
  taskSummary: "关于AI在医疗领域应用的调研报告",
  requirements: ["重点关注医疗领域"]
}) ✓

要求：
- 使用第三人称描述
- 提炼核心任务
- 列出具体要求
```

**2. Skill 接口强制结构化**

createTask 要求结构化参数：
```typescript
createTask({
  taskSummary: string,      // 必填，任务摘要
  requirements: string[],   // 必填，具体要求
  context?: {...}
})
```

不接受单个字符串，格式错误直接报错。

**3. 验证机制**

Task Management 做基本验证：
- 检查是否包含"帮我"、"我想"等第一人称
- 不符合规范则拒绝，返回错误
- Main Agent 收到错误后重新总结

## 5. Prompt 设计

### Prompt 配置文件

Main Agent 的 prompt 通过**配置文件**管理，支持动态调整。

**配置文件位置**：

```
config/main-agent-prompt.yaml
```

**配置结构**：

```yaml
system_prompt:
  role: "你是 Main Agent，一个智能对话代理..."
  principles:
    - "对话优先：大部分问题直接响应"
    - "智能判断：评估复杂度决定是否下发任务"
    - "非阻塞：任务下发后继续对话"

decision_criteria:
  direct_response:
    - "单步操作，即时完成"
    - "简单工具调用"
    - "预计处理时间 < 5秒"

  create_task:
    - "需要多步骤编排"
    - "长时间处理（> 30秒）"
    - "需要专门的执行环境"

available_skills:
  - name: "createTask"
    description: "创建任务"
  - name: "queryTaskStatus"
    description: "查询任务状态"
  - name: "cancelTask"
    description: "取消任务"
```

### 核心 Prompt 内容

```markdown
# 角色定义
你是 Main Agent，负责与用户对话并决定如何处理用户请求。

# 核心原则
1. 对话优先：大部分问题你应该直接响应
2. 智能判断：根据复杂度、时间、资源需求决定是否下发任务
3. 非阻塞：下发任务后继续与用户对话

# 判断标准
直接响应：单步操作、即时完成、简单工具调用
下发任务：多步骤编排、长时间处理、需要专门执行环境

# 可用工具
- createTask(userIntent: string) - 创建任务
- queryTaskStatus(taskId: string) - 查询任务状态
- cancelTask(taskId: string) - 取消任务
```

## 6. 对话示例

### 示例1：直接响应

```
用户：今天天气怎么样？
Main Agent：[调用天气工具] 今天北京晴，15-25°C。
```

### 示例2：下发任务

```
用户：帮我做一个关于AI发展的深度调研报告

Main Agent：好的，这需要深度分析和多源信息整合。
我会创建一个调研任务来处理，预计10-15分钟。

[调用 createTask skill]
createTask("关于AI发展的深度调研报告")

任务已创建（ID: task_123），完成后会通知你。
有其他需要帮助的吗？

用户：任务进度怎么样？

Main Agent：[调用 queryTaskStatus skill]
调研任务进行中，已完成30%，预计还需8分钟。
```

## 7. 设计总结

### 核心要点

1. **Main Agent = LLM 对话代理**
  - 本质是 LLM 对话，不需要额外的接口设计
  - 维持自然的对话流
2. **核心职责 = 任务决策**
  - 判断是否下发任务
  - 通过 prompt 引导决策
3. **交互方式 = Skill**
  - 通过 skill 与 Task Management 交互
  - 只传递意图和上下文，不构造任务对象
4. **Prompt = 配置文件**
  - 通过配置文件管理 prompt
  - 支持动态调整决策标准

### 与其他层的关系

```
Main Agent (LLM 对话代理)
  ↓ 调用 createTask skill
Task Management (任务状态管理)
  ↓ 任务编排
Scheduling Layer (执行管理)
  ↓ 资源分配
SubAgent Layer (实际执行)
```

Main Agent 专注于对话和决策，复杂工作委托给任务系统。