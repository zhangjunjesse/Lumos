# Lumos 任务执行架构

## 架构分层

```
┌──────────────────────────────────────────────────────┐
│                    用户层                             │
│                 (User Layer)                         │
│  • 对话界面  • 任务查询  • 结果展示                   │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│                  Main Agent                          │
│              (对话入口 & 决策者)                       │
│  • 意图识别  • 任务评估  • 下发决策                   │
│  • 结果呈现  • 上下文维持                             │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│            Task Management Layer                     │
│              (任务状态管理中心)                        │
│  • 任务注册  • 状态跟踪  • 优先级管理                 │
│  • 快速查询  • 任务取消/暂停                          │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│              Scheduling Layer                        │
│            (任务执行管理 - 项目经理)                   │
│  • 任务分析  • 策略决策  • 执行监控                   │
│  • 生命周期管理  • 进度跟踪                           │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│           Workflow MCP Server                        │
│          (工作流生成服务 - 结构化约束)                 │
│  • DSL 校验  • 步骤类型定义  • 代码编译               │
│  • 格式验证  • Tool Schema 约束                       │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│            Workflow Engine Layer                     │
│              (工作流执行引擎)                          │
│  • 工作流定义  • 节点编排  • 状态管理                 │
│  • 并行执行  • 自动重试  • 结果汇总                   │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│               SubAgent Layer                         │
│              (资源层 - 人力资源部)                     │
│  • 角色创建  • 能力匹配  • 资源分配                   │
│  • Agent外派  • 生命周期管理                          │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│                 结果存储层                            │
│               (Storage Layer)                        │
│  • 任务历史  • 执行日志  • 产物存储                   │
│  • 状态持久化  • 查询索引                             │
└──────────────────────────────────────────────────────┘
```

## 横切扩展说明

现有 `01 ~ 06` 解决的是主任务执行链路：

- `01` 主 Agent 入口
- `02` Task Management
- `03` Scheduling Layer
- `04` Workflow MCP
- `05` Workflow Engine
- `06` SubAgent Layer

但“让系统通过 LLM 动态新增新能力，并让这些能力后续能被工作流正式使用”这件事，不属于其中任何单层职责。

它同时横跨：

- 主 Agent / Task Management 的需求入口
- Scheduling Layer 的能力发现与规划
- Workflow MCP 的能力引用校验
- Workflow Engine 的运行时装配
- SubAgent Layer 的能力调用边界

因此这部分单独成文为：

- `07-dynamic-capability-extension-design.md`

这样做的原因是：

- 不打散 `03 ~ 06` 各自原本的边界
- 不把“能力扩展”误写成“只是调度问题”或“只是执行问题”
- 方便后续单独跟踪“能力管理、发布、回滚、权限、沙箱”这条新能力主线

当前建议的 Phase 1 落点是：

- 先不扩 Workflow DSL 基础 step type
- 已发布能力先通过 `agent` 步骤的工具引用接入工作流
- 等能力足够稳定后，再评估是否升级为 DSL v2 的专用 step type

## DeepSearch 独立模块说明

除 `07` 外，当前又新增一条不应硬塞进 `03 ~ 06` 的主线：

- `08-deepsearch-requirements-design.md`
- `08-deepsearch-architecture-design.md`
- `08-deepsearch-bb-browser-integration-design.md`
- `08-deepsearch-deployment-and-local-usage-design.md`
- `08-deepsearch-phase-1-implementation-design.md`
- `08-deepsearch-ui-and-interaction-design.md`
- `08-deepsearch-data-and-api-design.md`
- `08-deepsearch-engineering-implementation-design.md`

这条主线的边界是：

- DeepSearch 必须先作为独立模块完成
- 它复用 Lumos 内置浏览器的共享登录态和真实页面实例
- 它正式支持接管当前活动页，但执行前必须显式绑定 `runId + pageId`
- 它正式区分 `strict / best_effort` 两种执行语义，非严格模式下允许以 `partial` 收口
- 它先服务用户手动使用和独立 UI 验收
- 聊天与 Workflow 后续只复用它的服务层，不直接承载其内部实现

这样做的原因是：

- 不把登录态管理误写成“只是浏览器 step 能力”
- 不把 DeepSearch 误写成“只是 Workflow 编排的一部分”
- 不让对话、手动使用、Workflow 分别维护三套抓取运行态

另外，针对是否结合 `bb-browser`，当前也单独补了一份补充设计文档：

- 不建议把 `bb-browser` 原样作为 Lumos 的正式 DeepSearch 运行时
- 建议吸收其 `site adapter / session fetch / compact snapshot / network reverse engineering` 设计
- 结合源码复核后，当前更具体收敛为在 Lumos 内实现 `bb-site compatibility runtime`
- 正式主链仍然以 Lumos 内置浏览器和共享登录态为基础

另外，围绕“怎么部署、怎么在本地使用、Phase 1 先做什么”这三个实现前必须说清的问题，`08` 也继续补了两份子文档：

- `08-deepsearch-deployment-and-local-usage-design.md`
- `08-deepsearch-phase-1-implementation-design.md`

另外，围绕“正式页到底怎么交互”“service / tool / 数据边界到底怎么对齐”“当前仓库里具体该改哪些文件”这三个实现前很容易继续打架的问题，`08` 现已继续补了三份子文档：

- `08-deepsearch-ui-and-interaction-design.md`
- `08-deepsearch-data-and-api-design.md`
- `08-deepsearch-engineering-implementation-design.md`

它们的作用分别是：

- 把 `08` 的正式交付形态收敛为“Lumos 内置模块，本地通过 Lumos 实例直接使用”
- 把 `08 Phase 1` 的实现范围、顺序和严格验收标准显式写清，避免后续又退回“内部链路跑通就算完成”
- 把正式 `DeepSearch` 页的按钮、状态、详情区和恢复流程具体化
- 把 `run / run page / checkpoint / artifact / service / tool facade` 的合同进一步写清
- 把当前仓库里的真实目录、文件落点、浏览器桥接复用方式和开发顺序进一步拆到工程可执行层
