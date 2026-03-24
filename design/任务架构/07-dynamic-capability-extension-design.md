# Dynamic Capability Extension 设计文档

## 0. 编号结论

本方案建议**单独成文为 `07`**，不并入现有 `03 ~ 06` 任一文档。

原因：

- 它不是单纯的调度问题，不应只放在 `03`
- 它不是单纯的 DSL/编译问题，不应只放在 `04`
- 它不是单纯的执行问题，不应只放在 `05`
- 它也不是单纯的 Agent 角色管理问题，不应只放在 `06`

它本质上是一个**跨层能力扩展机制**，覆盖：

- 主 Agent / Task Management 的需求入口
- Scheduling Layer 的能力发现与工作流规划
- Workflow MCP 的能力引用校验
- Workflow Engine 的运行时装配
- SubAgent Layer 的能力调用边界

因此最合理的方式是：

- `01 ~ 06` 保持原有主链职责不变
- 新增 `07-dynamic-capability-extension-design.md`
- 把“动态新增系统能力”作为一个横切架构能力单独定义

---

## 1. 问题背景

当前架构的主链是：

- Main Agent 识别复杂任务
- Task Management 创建任务
- Scheduling Layer 生成受限 Workflow DSL
- Workflow MCP 校验并编译
- Workflow Engine 执行编译产物
- SubAgent / Browser / Notification 完成实际工作

这条链路在固定能力集合下是成立的，但有一个明显上限：

- 工作流只能组合**系统已经内建的能力**
- 当用户想要一个系统当前还不会的新能力时，只能：
  - 靠更多固定模板兜
  - 或靠 agent 临时绕行处理

这会导致两个问题：

1. **模板扩张问题**
   - 模板越来越多
   - 场景覆盖越来越碎
   - 维护成本迅速上升

2. **系统能力增长问题**
   - 用户真正想要的不是“再来一个模板”
   - 而是“系统以后就会这个能力”
   - 例如：
     - Markdown 生成 Word
     - Markdown 生成 PDF
     - 发布到飞书文档
     - 调用某内部接口完成结构化导出

因此需要一套新的机制，让用户可以通过 LLM **动态新增系统能力**，并且让这些新能力后续能被工作流正式使用。

---

## 2. 设计目标

### 2.1 核心目标

构建一套**动态能力扩展机制**，满足：

- 用户可在系统界面通过自然语言提出“新增能力”需求
- LLM 可先通过对话补齐需求，再生成新的能力候选
- 系统可对能力草稿进行校验、测试、发布、回滚
- 已发布能力能被 Scheduling Layer 发现
- 已发布能力能被工作流正式调用
- 运行时仍保持可控、安全、可验收

### 2.3 产品交互约束

用户最新确认的产品约束如下：

- `新增能力` 页尽量沿用现有聊天式 UI，不额外引入复杂配置页
- 用户不需要显式理解“草稿”这一产品概念
- AI 需要先通过多轮对话把需求问清楚，而不是一次性盲生成
- AI 生成结果要直接落成“可发布能力”，而不是要求用户先进入单独草稿编辑流
- 用户保留最终发布动作；也就是说，AI 负责确认和生成，用户负责“发布使其正式可用”

因此，`草稿` 在本设计里最多是**内部实现态**，不应成为 Phase 1 面向用户的主要交互模型。

### 2.2 非目标

本方案**不**做以下事情：

- 不允许 LLM 直接修改主系统核心代码并立即上线
- 不允许工作流直接执行任意 LLM 临时生成的 TypeScript
- 不允许绕过注册/校验机制直接把“新能力”注入执行层
- Phase 1 不扩 Workflow DSL 的基础 step type 集合

---

## 3. 核心设计判断

### 3.1 新能力不是“新流程”

要区分两个概念：

- **流程定义**：已有能力的组合方式
- **系统能力**：系统本身新学会的一种事

例如：

- “搜索 -> 截图 -> 汇总”是流程
- “把 Markdown 转成 Word”是能力

本方案讨论的是后者。

### 3.2 新能力不直接等于新 Step Type

Phase 1 推荐保持：

- Workflow DSL v1 仍只保留 `agent / browser / notification`

新能力先不表现为新的 workflow step type，而是：

- 以**已注册能力**的形式进入能力库
- 在工作流里由某个 `agent` 步骤调用

这是本方案最关键的落点。

### 3.3 LLM 负责确认需求并生成候选能力，系统负责“发布能力”

LLM 可以帮系统**长出候选能力**，但不能直接把候选能力变成正式能力。

正式能力必须经过：

- 结构校验
- 权限校验
- 沙箱测试
- 发布确认
- 版本管理

产品上表现为：

- 用户在聊天中描述需求
- AI 追问缺失条件，直到能力边界清晰
- AI 生成一个待发布能力
- 用户点击发布后，该能力进入正式可用状态

也就是说，系统内部可以保留临时草稿/中间态，但对用户来说不应出现一整套“草稿中心”心智负担。

---

## 4. 总体架构

```text
用户（能力管理界面）
  ↓ 自然语言提出新增能力需求
Capability Authoring Agent（LLM）
  ↓ 生成能力草稿
Capability Draft Store
  ↓ 校验 / 测试 / 审核
Capability Registry
  ↓ 对外提供可发现能力清单
Scheduling Layer
  ↓ 规划时选择能力
Workflow MCP
  ↓ 校验工作流中的能力引用
Workflow Engine
  ↓ 运行时装配能力调用入口
Agent Step
  ↓ 调用已发布能力
Capability Runtime Sandbox
  ↓ 返回结果 / 文件 / 错误
任务结果回写
```

---

## 5. 新增模块

## 5.1 Capability Management UI

新增一个正式页面，用于管理系统能力。

主要功能：

- 查看能力列表
- 查看能力状态
- 用自然语言新增能力
- 在聊天中补齐需求
- 预览 AI 生成的能力摘要
- 发布 / 停用 / 回滚

Phase 1 的产品要求：

- 尽量复用现有 `新增能力` 聊天页面
- 不额外拆出“草稿编辑器”作为主入口
- AI 在聊天中完成“需求澄清 -> 生成能力”的主流程
- 用户只需要在生成后做最终确认和发布
- 能力分两类：
  - `代码节点`：用于文件转换、解析、清洗、结构化处理等确定性执行
  - `Prompt 节点`：用于总结、分类、改写、分析等需要 LLM 的 agent 能力

### 5.1.1 Phase 1 最小改 UI 实施方案

页面尽量沿用现有结构，只调整行为语义：

#### `能力管理` 列表页

保留当前列表页结构，但列表语义调整为：

- 展示“系统里当前已有的能力”
- 每条能力至少展示：
  - 名称
  - 描述
  - 类型：`代码节点` / `Prompt 节点`
  - 状态：`待发布` / `已发布` / `已停用`
  - 风险等级
- 右上角继续保留 `新增能力`

Phase 1 不要求：

- 复杂筛选器
- 多页签草稿中心
- 独立的批量编辑后台

#### `新增能力` 页

继续复用当前聊天页，不做大改版。

页面行为改为：

1. 用户输入“我想新增一个什么能力”
2. AI 连续追问直到补齐最小必要信息
3. AI 输出一份结构化“待发布能力摘要”
4. 聊天区底部或结果卡上出现 `发布能力` 按钮
5. 用户点击后完成发布

用户在这个页面不需要：

- 看见原始 TypeScript 源码全文
- 自己复制粘贴保存文件
- 跳去另一页编辑草稿 JSON

#### 能力详情页

详情页继续保留，但语义改为“能力详情 / 发布详情”而不是“草稿详情”。

Phase 1 最少展示：

- 名称、描述、类型、状态、风险等级
- 输入说明
- 输出说明
- 使用方式
- 最近一次生成摘要
- 发布状态

如果是 `代码节点`，可额外显示：

- 产物类型
- 权限范围
- 超时设置

如果是 `Prompt 节点`，可额外显示：

- 适用任务类型
- agent 调用方式
- prompt 合同摘要

### 5.1.2 聊天页中的最小交互规则

AI 在聊天中必须按以下顺序工作：

1. 先判断能力类型
2. 再补最关键缺口
3. 缺口补齐后，明确复述“我将生成什么能力”
4. 再进入生成
5. 生成后只呈现摘要和发布入口，不把用户拖进实现细节

对 `代码节点`，AI 至少要问清：

- 输入是什么
- 输出是什么
- 是否产出文件
- 是否需要读写工作区
- 是否需要命令执行 / 外部网络

对 `Prompt 节点`，AI 至少要问清：

- 这个能力要解决什么任务
- 输入上下文是什么
- 期望输出结构是什么
- 失败时如何降级
- 这个能力由 agent 何时调用

建议状态：

- `draft`
- `validation_failed`
- `testing`
- `test_failed`
- `awaiting_approval`
- `ready_to_publish`
- `published`
- `disabled`
- `archived`

## 5.2 Capability Authoring Agent

专门负责把用户的能力诉求转换成结构化能力候选。

输入示例：

- “新增一个把 Markdown 生成 Word 的能力”

职责不是直接闷头生成，而是先确认：

- 这属于 `代码节点` 还是 `Prompt 节点`
- 输入是什么
- 输出是什么
- 是否需要文件产物
- 是否需要 LLM
- 运行风险和权限边界是什么

输出不是聊天文本本身，而是一个**待发布能力**，包含：

- 能力标识
- 输入输出定义
- 所需权限
- 运行时要求
- 适配器配置草稿
- 测试样例
- 用户说明

## 5.3 Capability Draft Store

存储 LLM 生成但尚未发布的能力中间态。

作用：

- 支持系统在生成、校验、测试、发布之间传递结构化数据
- 与正式能力隔离
- 保留内部审计和失败恢复所需的中间记录

注意：

- 它是内部实现模块，不要求在 Phase 1 作为独立 UI 暴露给用户
- 对用户来说，主要心智应是“聊天生成一个待发布能力”，而不是“先存草稿再进入草稿详情页编辑”

## 5.4 Capability Registry

正式能力注册中心，用于提供**当前可发现能力视图**。

它不负责保存所有历史版本，而是只保存：

- 当前 scope 下可见的能力
- 每个能力当前默认可用的激活版本
- 用于规划和校验的摘要信息

它是整个系统判断“当前有哪些能力可被新工作流发现和引用”的入口。

## 5.5 Capability Version Store

不可变能力版本仓库。

它保存的是每一次正式发布后生成的**冻结版本记录**，包括：

- capabilityId
- version
- digest
- 发布时的 schema 快照
- 发布时的权限和运行策略快照
- 发布时的实现快照
- 发布人和发布时间

它的职责是：

- 支持历史版本回放
- 支持回滚
- 支持老任务重跑
- 支持审计“某次任务到底用了哪个版本”

因此需要明确区分：

- Capability Registry：给“新规划”和“新校验”看当前能用什么
- Capability Version Store：给“执行、回放、审计、回滚”看某个冻结版本到底是什么

## 5.6 Capability Runtime Sandbox

已发布能力的执行环境。

职责：

- 执行能力实现
- 限制权限
- 控制文件读写范围
- 控制命令执行范围
- 返回结构化结果

重要原则：

- 不把新能力直接混进主系统核心逻辑
- 新能力通过沙箱边界执行

## 5.7 Capability Artifact Delivery

新增能力如果产出文件，不能只返回一个裸 `filePath`。

还需要一条正式交付链：

- 运行时把文件注册为任务产物
- 系统生成稳定的 `artifactId`
- 任务详情页和聊天结果都引用 `artifactId`
- UI 通过产物记录提供下载 / 打开入口

这样才能避免：

- 路径存在但后续找不到
- 文件生成了但 UI 无法下载
- 回放任务时无法确认到底交付了哪个文件

---

## 6. 能力包模型

建议正式能力对象结构如下：

```typescript
interface CapabilityPackage {
  id: string;                     // 例如 doc.export_markdown_to_word
  name: string;                   // Markdown 转 Word
  description: string;
  version: string;
  digest?: string;                // 发布后冻结的实现摘要，用于审计和回放
  status:
    | 'draft'
    | 'validation_failed'
    | 'testing'
    | 'test_failed'
    | 'awaiting_approval'
    | 'ready_to_publish'
    | 'published'
    | 'disabled'
    | 'archived';

  category: 'document' | 'integration' | 'browser-helper' | 'data';
  riskLevel: 'low' | 'medium' | 'high';

  scope: {
    visibility: 'global' | 'workspace' | 'team';
    workspaceId?: string;
    teamId?: string;
  };

  inputSchema: JsonSchema;
  outputSchema: JsonSchema;

  permissions: {
    workspaceRead?: boolean;
    workspaceWrite?: boolean;
    shellExec?: boolean;
    network?: boolean;
  };

  runtimePolicy: {
    timeoutMs: number;
    maximumAttempts: number;
  };

  approvalPolicy: {
    requireHumanApproval: boolean;
    approverRoles: string[];
  };

  implementation:
    | {
        kind: 'builtin-adapter';
        adapterId: string;        // 例如 document.markdown_to_docx
        config: Record<string, unknown>;
      }
    | {
        kind: 'reviewed-package';
        packageId: string;
        packageVersion: string;
        entry: string;
      };

  tests: Array<{
    name: string;
    input: Record<string, unknown>;
    expectedAssertions: string[];
  }>;

  docs: {
    summary: string;
    usageExamples: string[];
  };
}
```

每次发布后，还要物化一条不可变版本记录：

```typescript
interface CapabilityReleaseRecord {
  capabilityId: string;
  version: string;
  digest: string;
  status: 'published' | 'disabled' | 'archived';

  scopeSnapshot: {
    visibility: 'global' | 'workspace' | 'team';
    workspaceId?: string;
    teamId?: string;
  };

  permissionsSnapshot: {
    workspaceRead?: boolean;
    workspaceWrite?: boolean;
    shellExec?: boolean;
    network?: boolean;
  };

  runtimePolicySnapshot: {
    timeoutMs: number;
    maximumAttempts: number;
  };

  inputSchemaSnapshot: JsonSchema;
  outputSchemaSnapshot: JsonSchema;
  implementationSnapshot: Record<string, unknown>;

  publishedAt: string;
  publishedBy: string;
}
```

说明：

- Phase 1 只允许发布 `builtin-adapter`
- `reviewed-package` 只作为后续扩展预留
- LLM 在 Phase 1 生成的是**能力定义和适配器配置**，不是直接生成可上线执行的源码
- 所有已发布能力都必须带 `version + digest`
- Capability Registry 只暴露当前激活版本指针
- Workflow 运行时必须绑定到 Version Store 中的冻结版本，而不是只按能力 ID 临时查最新版本

---

## 7. 能力生成与发布生命周期

## 7.1 状态流转总表

| 当前状态 | 触发条件 | 下一状态 |
|----------|----------|----------|
| `draft` | 提交校验 | `validation_failed` / `testing` |
| `validation_failed` | 修订后重新提交 | `draft` |
| `testing` | 测试失败 | `test_failed` |
| `testing` | 测试通过且无需人工审批 | `ready_to_publish` |
| `testing` | 测试通过且需要人工审批 | `awaiting_approval` |
| `test_failed` | 修订后重新测试 | `draft` / `testing` |
| `awaiting_approval` | 审批拒绝 | `draft` / `disabled` |
| `awaiting_approval` | 审批通过 | `ready_to_publish` |
| `ready_to_publish` | 正式发布 | `published` |
| `published` | 停用 | `disabled` |
| `published` | 归档 | `archived` |
| `disabled` | 重新启用并切换为激活版本 | `published` |
| `disabled` | 归档 | `archived` |

说明：

- `published` 表示“当前某个 scope 下可被新工作流发现的激活版本”
- 旧版本即使不再激活，也仍保留在 Version Store 中
- 回滚不是把旧记录改写回去，而是把某个历史版本重新设为当前激活版本

## 7.2 对话确认与生成

流程：

1. 用户在能力管理页输入自然语言需求
2. Capability Authoring Agent 追问缺失信息，确认能力边界
3. 系统判断该能力属于 `代码节点` 还是 `Prompt 节点`
4. Capability Authoring Agent 生成待发布能力
5. 中间结果可存入内部 Store，但不要求暴露为独立“草稿页”

## 7.3 校验

校验内容：

- 能力 ID 是否合法
- 输入输出 schema 是否完整
- 权限声明是否超标
- 运行策略是否合理
- 是否引用了系统不存在的能力依赖
- scope 是否合法，是否越权声明为全局能力
- 风险等级是否与权限声明匹配
- implementation 是否来自受控适配器集合
- 发布版本号和实现摘要是否可生成

## 7.4 测试

至少执行两类测试：

- 结构测试：草稿能否被系统解析
- 沙箱测试：能力能否在受限环境中跑通基本用例

## 7.5 审批

不是所有能力都可以“测试通过就自动发布”。

必须增加审批关口：

- `low risk`
  - 只读
  - 不触网
  - 不执行命令
  - 可允许能力所有者确认后发布
- `medium risk`
  - 有 workspace 写入
  - 或会产出文件
  - 需要人工审批
- `high risk`
  - 涉及 `shellExec`
  - 或 `network`
  - 或对外部系统写操作
  - 必须由管理员或指定审批人发布

最低要求：

- 审批人不能是生成该能力草稿的同一自动流程
- 审批记录要落库
- 发布记录要能追溯“谁批准了哪个版本”

## 7.6 发布

通过校验、测试和审批后，能力进入 `published` 状态，并注册到 Capability Registry。

发布结果：

- Scheduling Layer 可以发现它
- Workflow MCP 可以校验它的引用
- Workflow Engine 可以在运行时装配它

发布时还必须生成：

- 冻结的 `version`
- 对应实现的 `digest`
- 可审计的发布记录

发布动作实际上分两步：

1. 生成并写入 Version Store 的不可变版本记录
2. 更新 Capability Registry 中该能力在当前 scope 下的激活版本指针

产品上建议收敛为：

1. AI 在聊天中展示“我将生成的能力是什么”
2. 用户点击发布
3. 系统完成校验、测试、写入版本、注册激活
4. 成功后该能力出现在能力列表里，并可被正式使用

## 7.7 回滚

已发布能力必须支持版本回滚。

原因：

- 能力由 LLM 辅助生成，质量波动不可避免
- 一旦新版本引入问题，必须能立即切回旧版本

回滚动作不是修改历史版本内容，而是：

- 从 Version Store 选择一个旧版本
- 把它重新设置为当前 scope 下的激活版本
- 生成一条新的回滚审计记录

---

## 8. 工作流如何使用新能力

## 8.1 Phase 1 推荐方式：挂在 `agent` 步骤下调用

由于当前架构边界要求：

- Workflow DSL v1 只支持 `agent / browser / notification`

因此 Phase 1 不新增 `word_export`、`pdf_export` 这类新的 step type。

而是采用：

- 工作流仍然只放 `agent` 步骤
- 该 `agent` 步骤被允许调用某个已发布能力

推荐复用现有 `agent.input.tools: string[]` 字段表达能力引用。

但不能只靠 prompt 自由发挥，必须带结构化调用块。

示例：

```typescript
{
  id: 'export_word',
  type: 'agent',
  dependsOn: ['draft_md'],
  input: {
    prompt: 'Use the published capability to convert markdown into a Word document.',
    role: 'integration',
    tools: ['capability.invoke:doc.export_markdown_to_word'],
    capabilityCall: {
      tool: 'capability.invoke:doc.export_markdown_to_word',
      arguments: {
        markdown: {
          $ref: 'steps.draft_md.output.markdown'
        },
        outputName: 'final-report'
      }
    }
  },
  policy: {
    timeoutMs: 180000,
    retry: {
      maximumAttempts: 2
    }
  }
}
```

解释：

- 对 Workflow DSL 来说，这仍是一个 `agent` 步骤
- 对运行时来说，这个 agent 被额外授予了调用 `doc.export_markdown_to_word` 的能力
- `capabilityCall.arguments` 必须按 `inputSchema` 做编译期校验

## 8.2 参数引用规则

`capabilityCall.arguments` 中的值只允许两类：

- 字面量
- 引用表达式

推荐约定：

```typescript
type CapabilityArgumentValue =
  | string
  | number
  | boolean
  | null
  | { $ref: string }
  | CapabilityArgumentValue[]
  | { [key: string]: CapabilityArgumentValue };
```

关键规则：

- 普通字符串就是普通字符串，不自动当作引用表达式
- 只有 `{ $ref: 'steps.someStep.output.xxx' }` 才表示引用上一步结果
- Workflow MCP 先解析 `$ref` 指向的上游 output schema，再做类型兼容检查
- 运行时在真正执行前还要对解析后的实值再做一次 `inputSchema` 校验

这样可以避免：

- 把普通字符串误判成表达式
- 编译期和运行时对参数类型理解不一致
- 上游输出结构变化后，下游能力调用悄悄失真

## 8.3 逻辑引用与版本冻结

规划阶段可以先写逻辑能力名：

```typescript
'capability.invoke:doc.export_markdown_to_word'
```

但编译阶段不能只保留逻辑名。

Workflow MCP 必须把它解析成**冻结绑定**，写入编译产物，例如：

```typescript
{
  tool: 'capability.invoke:doc.export_markdown_to_word',
  capabilityId: 'doc.export_markdown_to_word',
  version: '1.3.2',
  digest: 'sha256:4a8d...'
}
```

这样才能保证：

- 同一工作流重跑时使用的是同一版本
- 能力后续升级或回滚，不会悄悄改变老任务的行为
- 审计时可以追溯“本次任务到底调用了哪个能力版本”

## 8.4 为什么先这样做

优点：

- 不破坏 Phase 1 的 DSL 边界
- 不需要立即扩基础步骤类型体系
- 能快速把新能力接入工作流
- 能保持规划 / 校验 / 运行时的一致性

代价：

- 工作流图上看到的是 `agent`，不是更语义化的 `word_export`
- 可视化可读性稍弱

因此这更适合作为 **Phase 1 / Phase 1.5** 的接法。

## 8.5 后续可升级方向

如果某类能力足够稳定且通用，例如：

- `doc.export_markdown_to_word`
- `doc.export_markdown_to_pdf`
- `integration.publish_feishu_doc`

则后续可把它们升级为真正的专用 step type，进入 DSL v2。

但不建议一开始就这么做。

---

## 9. 调度层如何发现和使用新能力

Scheduling Layer 需要新增“能力发现”能力。

规划时输入上下文应增加：

- 当前用户在当前 scope 下可见的已发布能力列表
- 每个能力的功能摘要
- 输入输出约束
- 权限和运行时限制
- 风险等级

这样调度层在做任务规划时，才能判断：

- 这个任务是否适合调用某个已发布能力
- 是否需要在某个 `agent` 步骤里挂能力调用

例如当用户说：

- “请把最终报告导出成 Word”

如果注册表中存在：

- `doc.export_markdown_to_word`

则调度层可以规划出：

- `analyze`
- `draft_md`
- `export_word`
- `notify`

如果注册表里不存在该能力，则调度层应：

- 不编造该能力
- 不假装支持
- 退回为“正文先交付，导出能力暂不支持”

---

## 10. Workflow MCP 的新增职责

Workflow MCP 不只校验 step type，还需要校验：

- `agent.input.tools` 中引用的能力是否存在
- 引用的能力是否为 `published`
- 当前 workflow 是否有权使用该能力
- `capabilityCall.arguments` 是否满足该能力的 `inputSchema`
- 当前 capability 引用是否已被冻结到具体 `version + digest`
- `$ref` 表达式是否能在上游 output schema 中被合法解析

即：

```typescript
'capability.invoke:doc.export_markdown_to_word'
```

必须在 Capability Registry 中可解析，否则工作流校验失败。

这保证：

- 调度层不能引用一个不存在的能力
- LLM 不能凭空发明一个运行时工具名
- 运行时不会偷偷取“最新版本”替换老版本
- 参数引用不会在运行时才临时发现类型不匹配

---

## 11. Workflow Engine / SubAgent Layer 的新增职责

## 11.1 Workflow Engine

执行时需要把能力引用透传到运行时。

例如：

- 编译产物读取到 `tools: ['capability.invoke:doc.export_markdown_to_word']`
- 编译产物同时读取到冻结后的 `capabilityBindings`
- 运行时先根据 Registry 找到当前激活指针对应的发布记录，编译后则只按 Version Store 中的冻结版本装配执行
- 运行时据此把该能力的指定版本装配进当前 agent step 的可用工具集合

## 11.2 SubAgent Runtime

SubAgent Runtime 需要支持：

- 解析能力工具引用
- 绑定到对应已发布能力的执行入口
- 在沙箱内执行能力
- 返回结构化结果

返回结果示例：

```typescript
{
  success: true,
  output: {
    artifactId: "artifact_123",
    downloadName: "report.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    summary: "Word 文件已生成"
  },
  artifacts: [
    {
      artifactId: "artifact_123",
      kind: "file",
      fileName: "report.docx",
      filePath: "/abs/path/report.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
  ]
}
```

## 11.3 任务产物注册与 UI 交付

当能力产出文件时，Workflow Engine 不能只把 `filePath` 原样返回。

必须继续完成：

1. 把文件登记到任务产物表
2. 生成稳定的 `artifactId`
3. 把 `artifactId` 和元数据写入 step result
4. 回写聊天结果和任务详情页
5. 由 UI 提供下载 / 打开入口

也就是说，真正的完成标准是：

- 能力跑完
- 产物被登记
- 用户在 UI 能拿到文件

正式输出合同应以：

- `artifactId`
- `downloadName`
- `contentType`
- `summary`

为主。

`filePath` 只作为运行时内部元数据或调试信息保留，不应作为产品层的主要交付协议。

---

## 12. `Markdown -> Word` 示例

## 12.1 能力定义

能力 ID：

- `doc.export_markdown_to_word`

输入：

- `markdown: string` 或 `sourcePath: string`
- `outputName?: string`

输出：

- `artifactId: string`
- `downloadName: string`
- `contentType: string`
- `summary: string`

## 12.2 能力调用型工作流

```text
analyze
  ↓
draft_md
  ↓
export_word
  ↓
notify
```

各步骤职责：

- `analyze`：明确文档目标、格式、读者
- `draft_md`：生成 Markdown 正文
- `export_word`：调用 `doc.export_markdown_to_word`
- `notify`：通知用户并附上 Word 产物引用或下载入口

## 12.3 验收标准

成功标准不应是“模型说导出了 Word”，而必须是：

- 真实 `.docx` 文件已存在
- 文件已登记为任务产物
- `artifactId` 可回传
- 文件类型可识别
- UI 可点击查看或下载

## 12.4 两类能力的产品定义

### `代码节点`

适用场景：

- 文件类型转换
- 文本解析
- 数据清洗
- 结构化提取
- 确定性格式加工

生成要求：

- 产出 OpenWorkflow 可执行的节点实现
- 明确输入 schema / 输出 schema
- 明确参数说明
- 明确运行权限和超时策略
- 如果会生成文件，必须走正式产物交付链

### `Prompt 节点`

适用场景：

- 总结
- 分类
- 改写
- 分析
- 根据业务规则生成文本或判断

生成要求：

- 产出可供 agent 节点调用的 prompt 能力定义
- 明确 prompt 契约、输入输出结构和使用说明
- 通过 agent/LLM 执行，不伪装成确定性代码节点
- 发布后可被工作流中的 agent 节点正式引用

---

## 13. 安全边界

动态能力扩展最容易出问题的地方，就是把“新能力”做成“任意代码入口”。

本方案明确禁止：

- 直接将 LLM 输出的代码注入主系统核心进程
- 绕过 Registry 使用未发布能力
- 在无权限声明的情况下直接访问网络、文件、命令执行
- 在 Phase 1 直接发布任意 LLM 生成源码作为可执行能力

必须坚持：

- 新能力有明确权限声明
- 新能力在沙箱里执行
- 新能力有版本和回滚
- 新能力先测试再发布
- 高风险能力必须人工审批
- Phase 1 只允许受控适配器，不允许自由代码上线

---

## 14. 分阶段落地建议

## Phase 1：能力定义与调用先打通

目标：

- 能力管理页
- 对话式能力生成
- Registry
- 已发布能力可被 `agent` 步骤调用
- 版本冻结与产物交付链

边界：

- 不扩 DSL step type
- 只允许通过 `agent.input.tools` 引用能力
- 只允许 `builtin-adapter`
- 不允许任意 LLM 生成源码直接发布
- UI 尽量复用现有聊天式 `新增能力` 页面
- 不把“草稿中心”做成 Phase 1 的核心产品形态

## Phase 2：提升能力校验与测试

目标：

- 自动测试
- 发布审批
- 版本回滚
- 更完善的 UI 展示
- reviewed package 接入评估

## Phase 3：评估是否升级为专用 Step Type

仅对高频、稳定、广泛复用的能力考虑升级，例如：

- `word_export`
- `pdf_export`
- `publish_document`

---

## 15. 结论

本方案的核心判断是：

1. 用户通过 LLM 动态新增系统能力是**可行的**
2. 但新增的是**受控能力包**，不是直接改主系统核心
3. 已发布能力先通过 `agent` 步骤接入工作流，而不是立即扩 DSL step type
4. Registry、校验、测试、沙箱、发布、回滚是必需品，不是可选项

因此，本设计建议新增：

- `07-dynamic-capability-extension-design.md`

作为现有 `01 ~ 06` 主链文档之外的横切扩展架构文档。
