# 需求澄清卡

## 基本信息

- 模块名：Agent Team
- 当前状态：`clarifying`
- 对应 `spec` 分支：`spec/agent-team`
- 对应 `spec` worktree：`/Users/zhangjun/私藏/lumos-worktrees/spec-agent-team`

## 你现在已知的事

- 当前问题是什么：需要设计和开发多 Agent 协同模块。
- 谁会受到影响：任务拆分、角色分工、会话管理、主 Agent 编排。
- 当前代码大致在哪些目录：`src/components`、`src/lib`、`src/app/chat`、`src/app/mind`、`src/app/extensions`。

## 这次要先讨论清楚什么

- [ ] Agent Team 的核心职责
- [ ] 主 Agent 和 Team 的边界
- [ ] Team 是 UI 概念、运行时概念，还是两者都有
- [ ] 最小交付版本是什么

## 未决问题

- Agent Team 是否真的需要独立运行时，还是先做任务组织层即可？
- 子 Agent 的生命周期如何管理？
- 是否需要显式角色卡、能力卡、任务卡？

## 暂定方案

- 方案 A：先做团队配置和任务分配模型。
- 方案 B：直接做可执行的多 Agent runtime。
- 倾向方案：先设计模型和交互，再决定是否落 runtime。

## 当前限制

- 是否允许改正式代码：不允许
- 是否允许写原型：按需，且只限小范围验证
- 是否允许改全局配置：不允许

## 冻结条件

- [ ] Team 的目标明确
- [ ] 非目标明确
- [ ] 允许修改目录明确
- [ ] 禁止修改文件明确
- [ ] 验收标准明确

## 输出给开发会话的内容

- 一段清晰目标描述
- 允许修改目录
- 禁止修改文件
- 验收标准
- 还剩哪些风险
