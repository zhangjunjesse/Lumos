# Temporal 集成讨论结论

## 执行摘要

**结论：不建议将 Temporal 集成到 Lumos**

经过架构分析、LLM 工作流设计和 UI 设计的深入讨论，团队得出以下核心结论：

1. **Temporal 对桌面应用过重**：需要 200MB+ 内存，必须独立进程运行
2. **推荐自建轻量级工作流引擎**：更适合 Lumos 的桌面应用场景
3. **保留 Temporal 设计思想**：借鉴其 Activity/Workflow 分离、状态持久化等优秀模式

---

## 1. 架构分析结论

### 1.1 Temporal 的优势
- 成熟的分布式工作流引擎
- 强大的状态管理和容错能力
- 完善的 TypeScript SDK
- MIT 开源协议

### 1.2 不适合 Lumos 的原因

**资源占用过大**
- Temporal Server 需要独立进程（Go 编写）
- 内存占用 200MB+
- 需要持久化存储（PostgreSQL/MySQL/SQLite）
- 桌面应用用户不希望后台常驻多个进程

**架构复杂度高**
- 需要管理 Server 生命周期（启动/停止/重启）
- 需要处理进程间通信
- 需要处理 Server 崩溃恢复
- 增加应用启动时间和复杂度

**过度设计**
- Lumos 的工作流主要是单机任务编排
- 不需要分布式协调能力
- 不需要跨机器的任务调度
- 简单场景用 Temporal 是"杀鸡用牛刀"

---

## 2. 推荐方案：自建轻量级工作流引擎

### 2.1 核心设计

```typescript
// 工作流定义（借鉴 Temporal 的 DSL）
interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowNode {
  id: string;
  type: 'agent' | 'condition' | 'parallel' | 'loop';
  config: Record<string, any>;
}

// 执行引擎
class WorkflowEngine {
  async execute(workflow: WorkflowDefinition, input: any): Promise<any> {
    // 1. 解析工作流 DAG
    // 2. 按拓扑顺序执行节点
    // 3. 处理条件分支和并行
    // 4. 持久化状态到 SQLite
    // 5. 支持暂停/恢复/取消
  }
}
```

### 2.2 关键特性

**轻量级**
- 纯 TypeScript 实现，无需额外进程
- 内存占用 < 10MB
- 状态存储复用 Lumos 现有 SQLite

**足够强大**
- 支持顺序/并行/条件/循环
- 支持暂停/恢复/取消
- 支持错误重试和补偿
- 支持状态持久化

**易于扩展**
- 插件化节点类型（Agent/Browser/Notification）
- 支持自定义节点
- 支持 LLM 动态生成工作流

---

## 3. LLM 工作流生成方案

### 3.1 核心思路

**Prompt 工程**
- 向 LLM 提供工作流 DSL 规范
- 提供常见模板和示例
- LLM 输出 JSON 格式的工作流定义

**模板库**
- 预定义常见场景（数据采集、定时任务、多步推理）
- 用户可基于模板修改
- LLM 可组合模板生成新工作流

**动态执行**
- 无需编译，直接解析 JSON 执行
- 支持运行时修改工作流
- 支持 A/B 测试不同工作流版本

### 3.2 示例

用户输入：
```
"每天早上 9 点，从飞书文档读取待办事项，用 AI 分析优先级，发送通知"
```

LLM 生成：
```json
{
  "id": "daily-todo-workflow",
  "nodes": [
    { "id": "trigger", "type": "cron", "config": { "schedule": "0 9 * * *" } },
    { "id": "fetch", "type": "agent", "config": { "prompt": "读取飞书文档..." } },
    { "id": "analyze", "type": "agent", "config": { "prompt": "分析优先级..." } },
    { "id": "notify", "type": "notification", "config": { "channel": "feishu" } }
  ],
  "edges": [
    { "from": "trigger", "to": "fetch" },
    { "from": "fetch", "to": "analyze" },
    { "from": "analyze", "to": "notify" }
  ]
}
```

---

## 4. 用户界面设计

### 4.1 双模式编辑

**可视化模式**（参考 n8n）
- 拖拽节点构建工作流
- 实时预览执行路径
- 适合非技术用户

**代码模式**（Monaco Editor）
- 直接编辑 JSON 定义
- 语法高亮和自动补全
- 适合高级用户

### 4.2 调试和测试

**单步执行**
- 逐节点执行，查看中间结果
- 支持断点和变量查看

**历史回放**
- 查看历史执行记录
- 分析失败原因
- 支持重新执行

---

## 5. 工作流能力扩展

### 5.1 节点类型

**Agent 节点**
- 调用 claude-agent-sdk
- 支持工具调用（MCP）
- 支持多轮对话

**Browser 节点**
- 调用内置浏览器
- 支持页面操作（点击、输入、截图）
- 支持数据提取

**Notification 节点**
- 飞书消息
- 系统通知
- 邮件（未来）

**Condition 节点**
- 条件分支
- 支持 JavaScript 表达式

**Parallel 节点**
- 并行执行多个分支
- 等待所有分支完成

**Loop 节点**
- 循环执行
- 支持 for/while 语义

### 5.2 集成点

**与 Task Management 集成**
- Scheduling Layer 生成工作流
- Workflow Engine 执行工作流
- SubAgent Layer 执行具体节点

**与现有能力集成**
- 复用 claude-agent-sdk
- 复用浏览器工作区
- 复用飞书集成
- 复用 MCP 插件

---

## 6. 实施路线图

### Phase 1：核心引擎（2 周）
- [ ] 实现 WorkflowEngine 基础类
- [ ] 支持顺序/并行/条件节点
- [ ] SQLite 状态持久化
- [ ] 基础测试用例

### Phase 2：节点类型（2 周）
- [ ] Agent 节点（调用 claude-agent-sdk）
- [ ] Browser 节点（调用浏览器工作区）
- [ ] Notification 节点（飞书/系统通知）
- [ ] Condition/Loop 节点

### Phase 3：LLM 生成（1 周）
- [ ] 设计 Prompt 模板
- [ ] 实现工作流生成 API
- [ ] 构建模板库

### Phase 4：UI 界面（3 周）
- [ ] 可视化编辑器（React Flow）
- [ ] 代码编辑器（Monaco）
- [ ] 调试和测试界面
- [ ] 历史记录查看

### Phase 5：集成和优化（1 周）
- [ ] 与 Scheduling Layer 集成
- [ ] 性能优化
- [ ] 文档和示例

**总计：约 9 周**

---

## 7. 风险和缓解

### 7.1 技术风险

**工作流执行稳定性**
- 风险：自建引擎可能有 bug
- 缓解：充分测试，参考 Temporal 设计模式

**LLM 生成质量**
- 风险：生成的工作流可能不符合预期
- 缓解：提供模板库，支持用户修改

**性能问题**
- 风险：复杂工作流可能卡顿
- 缓解：异步执行，状态持久化

### 7.2 产品风险

**学习曲线**
- 风险：用户不理解工作流概念
- 缓解：提供向导和模板，渐进式引导

**功能过载**
- 风险：功能太多，用户不知道怎么用
- 缓解：默认隐藏高级功能，按需展示

---

## 8. 总结

**核心决策**：不使用 Temporal，自建轻量级工作流引擎

**理由**：
1. Temporal 对桌面应用过重（200MB+ 内存，独立进程）
2. Lumos 不需要分布式能力
3. 自建引擎更灵活，更适合 LLM 集成

**收益**：
1. 轻量级（< 10MB 内存）
2. 深度集成 Lumos 现有能力
3. 支持 LLM 动态生成工作流
4. 用户可视化编辑工作流

**下一步**：
1. 更新 `04-workflow-engine-design.md`，详细设计自建引擎
2. 实施 Phase 1：核心引擎开发
3. 与 Scheduling Layer 集成测试
