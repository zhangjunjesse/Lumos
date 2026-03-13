# 需求澄清卡

## 基本信息

- 模块名：Main Agent / Agent Team 联合架构
- 当前状态：`clarifying`
- 对应 `spec` 分支：`spec/main-agent-team-architecture`
- 对应 `spec` worktree：`/Users/zhangjun/私藏/lumos-worktrees/spec-main-agent-team-architecture`

## 你现在已知的事

- 当前问题是什么：`Lumos 主 AI Agent` 和 `Agent Team` 之间存在强耦合，不能独立冻结需求。
- 谁会受到影响：主聊天入口、任务规划、角色协作、子 Agent 委派、结果回填。
- 当前代码大致在哪些目录：`src/app/chat`、`src/components/chat`、`src/lib`、`src/app/mind`、`src/app/extensions`。

## 这次要先讨论清楚什么

- [ ] Main Agent 和 Agent Team 的职责边界
- [ ] 哪些能力属于主 Agent，哪些能力属于 Team
- [ ] Team 是主 Agent 的一种模式，还是独立模块
- [ ] 两者之间的输入输出协议和确认点

## 未决问题

- 主 Agent 是否始终是唯一用户入口？
- Team 是否只负责“规划和委派”，还是也承担执行编排？
- Team 结果是回填到主会话，还是有独立 team 视图？
- 哪些确认由主 Agent 负责，哪些确认由 Team 负责？

## 暂定方案

- 方案 A：主 Agent 是唯一入口，Agent Team 是其下的协作模式。
- 方案 B：主 Agent 和 Agent Team 都是一级入口，但共享同一底层 runtime。
- 倾向方案：先把主 Agent 作为唯一入口，Agent Team 作为可切换的协作能力。

## 当前限制

- 是否允许改正式代码：不允许
- 是否允许写原型：按需，且只限小范围验证
- 是否允许改全局配置：不允许

## 冻结条件

- [ ] 主 Agent 的职责明确
- [ ] Agent Team 的职责明确
- [ ] 两者的边界明确
- [ ] 共享能力与复用层明确
- [ ] 验收标准明确

## 输出给开发会话的内容

- 一段主 Agent 与 Agent Team 的关系定义
- 主入口设计
- Team 激活方式
- 委派/确认/回填规则
- 还剩哪些风险
