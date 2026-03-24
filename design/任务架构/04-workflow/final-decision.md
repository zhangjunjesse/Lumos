# 工作流代码生成方案最终决策

## 问题背景

**核心矛盾**：
- LLM 直接生成 OpenWorkflow TypeScript 代码 → 语法错误风险
- MCP 用模板生成代码 → 无法应对灵活需求

**目标**：找到平衡可靠性和灵活性的方案

---

## 三个方案对比

### 方案一：LLM 直接生成代码

**来源**：feasibility-analyst 分析

**核心机制**：
- Scheduling Agent (LLM) 直接生成 OpenWorkflow TypeScript 代码
- 通过 System Prompt + Few-shot 提高准确率
- TypeScript 编译器验证语法

**优势**：
- ✅ 最灵活，表达能力最强
- ✅ 无需额外转换层
- ✅ 性能最优（直接执行）
- ✅ 已有成功案例（OpenAI、n8n）

**劣势**：
- ❌ 10% 失败率（即使优化后）
- ❌ 需要验证和重试机制
- ❌ 调试困难（LLM 生成的代码可读性差）

**适用场景**：复杂、高度定制化的工作流

**实现复杂度**：⭐⭐（简单）

---

### 方案二：YAML DSL

**来源**：alternative-researcher 调研

**核心机制**：
- LLM 生成 YAML 配置
- 转换器将 YAML 转换为 OpenWorkflow 代码
- 引擎执行生成的代码

**优势**：
- ✅ LLM 生成 YAML 成功率极高（95%+）
- ✅ 用户可直接编辑 YAML
- ✅ 声明式配置易于理解和调试
- ✅ 版本控制友好
- ✅ 行业趋势（GitHub Actions、n8n）

**劣势**：
- ❌ 需要设计 DSL 语法
- ❌ 需要实现转换器
- ❌ 表达能力受限（复杂逻辑难以描述）
- ❌ 调试时需要在 YAML 和代码间切换

**适用场景**：标准化、可复用的工作流

**实现复杂度**：⭐⭐⭐（中等）

---

### 方案三：渐进式生成（推荐）

**来源**：hybrid-designer 设计

**核心机制**：
1. 用模板生成骨架代码（保证语法正确）
2. LLM 填充具体逻辑（保证灵活性）
3. 组装成完整的 OpenWorkflow 代码

**示例**：

LLM 输入：
```json
{
  "workflow_type": "sequential",
  "steps": [
    {
      "type": "agent",
      "name": "search",
      "prompt": "搜索 AI 在医疗领域的应用"
    },
    {
      "type": "agent",
      "name": "analyze",
      "prompt": "分析搜索结果并生成报告"
    },
    {
      "type": "notification",
      "name": "notify",
      "message": "报告已生成"
    }
  ]
}
```

生成代码：
```typescript
// 骨架模板（保证语法）
export const workflow = ow.defineWorkflow(
  { name: 'research-workflow' },
  async ({ step }) => {
    // LLM 填充的步骤
    const searchResult = await step.run(
      { name: 'search' },
      () => agentStep({ prompt: '搜索 AI 在医疗领域的应用' })
    );

    const analyzeResult = await step.run(
      { name: 'analyze' },
      () => agentStep({ prompt: '分析搜索结果并生成报告' })
    );

    await step.run(
      { name: 'notify' },
      () => notificationStep({ message: '报告已生成' })
    );

    return { searchResult, analyzeResult };
  }
);
```

**优势**：
- ✅ 语法 100% 正确（模板保证）
- ✅ 内容灵活（LLM 填充）
- ✅ 实现成本适中（2-3周）
- ✅ 有降级策略（纯模板 → 手动）
- ✅ 易于调试（代码结构清晰）

**劣势**：
- ❌ 需要设计模板库
- ❌ 模板覆盖不全时仍需 LLM 生成代码

**适用场景**：大部分场景（80%+ 的工作流）

**实现复杂度**：⭐⭐⭐（中等）

---

## 最终决策

### 主方案：渐进式生成

**理由**：
1. **平衡性最优**：兼顾可靠性（模板）和灵活性（LLM）
2. **实现成本可控**：2-3周开发周期
3. **降级策略清晰**：渐进式 → 纯模板 → 手动
4. **符合实际需求**：覆盖 80%+ 场景

### 备选方案：YAML DSL

**触发条件**：
- 渐进式生成无法满足需求
- 用户需要可视化编辑器
- 需要跨平台工作流定义

---

## 实施计划

### Phase 1：核心模板库（Week 1）

**骨架模板**（3种）：
1. 顺序工作流（sequential）
2. 并行工作流（parallel）
3. 条件工作流（conditional）

**步骤模板**（5种）：
1. agentStep - AI Agent 调用
2. browserStep - 浏览器操作
3. notificationStep - 通知
4. httpStep - HTTP 请求
5. dataStep - 数据处理

**组装逻辑**：
- 根据 LLM 输出的 JSON 选择骨架模板
- 根据步骤类型选择步骤模板
- 填充 LLM 生成的参数
- 组装成完整代码

### Phase 2：MCP 集成（Week 2）

**MCP Tools**：
1. `list_workflow_templates` - 列出可用模板
2. `generate_workflow` - 生成工作流代码
3. `validate_workflow` - 验证工作流语法

**Tool Schema**：
```typescript
{
  name: 'generate_workflow',
  description: '生成工作流代码',
  inputSchema: {
    type: 'object',
    properties: {
      workflow_type: {
        type: 'string',
        enum: ['sequential', 'parallel', 'conditional']
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['agent', 'browser', 'notification', 'http', 'data'] },
            name: { type: 'string' },
            // 其他参数根据 type 动态变化
          }
        }
      }
    }
  }
}
```

### Phase 3：Prompt 优化（Week 3）

**System Prompt**：
- 明确说明可用的模板类型
- 提供 3-5 个典型示例
- 强调输出 JSON 格式（不是代码）

**Few-shot 示例**：
- 简单顺序工作流
- 并行工作流
- 条件分支工作流
- 循环工作流
- 错误处理工作流

**验证和测试**：
- 单元测试（每个模板）
- 集成测试（端到端）
- 压力测试（100+ 工作流）

---

## 风险控制

### 风险1：模板覆盖不全

**缓解措施**：
- 初期支持 3 种骨架 + 5 种步骤（覆盖 80% 场景）
- 逐步扩展模板库
- 提供"自定义代码"步骤作为逃生舱

### 风险2：LLM 输出格式错误

**缓解措施**：
- Tool Schema 强约束
- 输出验证（JSON Schema）
- 重试机制（最多 3 次）

### 风险3：生成代码不符合预期

**缓解措施**：
- 预览机制（生成后先展示给用户）
- 人工审核（复杂工作流）
- 反馈循环（记录失败案例，优化模板）

---

## 成功指标

1. **生成成功率**：95%+
2. **语法正确率**：100%（模板保证）
3. **用户满意度**：80%+
4. **平均生成时间**：< 5 秒
5. **模板覆盖率**：80%+ 场景

---

## 后续扩展

### Phase 4：可视化编辑器（未来）
- 拖拽式工作流编辑器
- 实时预览生成的代码
- 调试和测试工具

### Phase 5：工作流市场（未来）
- 用户分享工作流模板
- 社区贡献步骤模板
- 评分和评论系统

---

## 结论

**采用渐进式生成方案**，通过模板骨架保证语法正确性，LLM 填充具体逻辑保证灵活性。

**3周实施计划**：
- Week 1：模板库
- Week 2：MCP 集成
- Week 3：Prompt 优化

**降级策略**：渐进式生成 → 纯模板生成 → 手动编写

这是当前最平衡的方案，既满足可靠性要求，又保证足够的灵活性。
