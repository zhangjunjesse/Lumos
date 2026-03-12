# 需求澄清卡

## 基本信息

- 模块名：Lumos 主 AI Agent
- 当前状态：`clarifying`
- 对应 `spec` 分支：`spec/lumos-main-agent`
- 对应 `spec` worktree：`/Users/zhangjun/私藏/lumos-worktrees/spec-lumos-main-agent`

## 你现在已知的事

- 当前问题是什么：需要设计和开发 Lumos 的主 AI Agent 能力。
- 谁会受到影响：聊天、任务分发、工具调用、知识调用、整体交互流。
- 当前代码大致在哪些目录：`src/app/chat`、`src/components/chat`、`src/app/api/ai-assistant`、`src/lib`、`electron`。

## 这次要先讨论清楚什么

- [ ] 主 Agent 的职责边界
- [ ] 与 Agent Team、浏览器、知识模块的关系
- [ ] 是否先做 MVP
- [ ] 验收标准是什么

## 未决问题

- 主 Agent 是单代理编排，还是多代理调度入口？
- 它是否需要独立记忆、计划、工具路由能力？
- 它和现有 chat / knowledge / browser 的耦合边界在哪？

## 暂定方案

- 方案 A：先定义主 Agent 的职责与输入输出，只做最小编排层。
- 方案 B：直接联动多个子模块，一次性做完整主控层。
- 倾向方案：先收敛 MVP，再拆分后续增强项。

## 当前限制

- 是否允许改正式代码：不允许
- 是否允许写原型：按需，且只限小范围验证
- 是否允许改全局配置：不允许

## 冻结条件

- [ ] 主 Agent 的目标明确
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
