# Main Agent / Agent Team MVP Foundation 开发任务卡

## 基本信息

- 任务名：Main Agent / Agent Team MVP Foundation
- 任务号：202
- 对应分支：`task/202-main-agent-team-foundation`
- 对应 worktree：`/Users/zhangjun/私藏/lumos-worktrees/202-main-agent-team-foundation`

## 目标

实现 Lumos 的主入口与 Team Mode 的 MVP 基础架构。Main Agent 仍是唯一直接面向用户的逻辑主入口，Agent Team 作为 Main Agent 下的 session-scoped 协作模式存在，不作为独立一级入口。

本次任务的目标不是一次做完整多 Agent 平台，而是先落下最小可用骨架：Main Agent 发起 Team Mode、结构化 team plan、受控的 Team Run 运行骨架、分层结果回填，以及一个可查看的最小 Team 结果/工作区承载面。

本次不处理无限递归扩编、通用自治型多 Agent 平台、独立长期记忆体系、复杂分布式消息总线、数据库 schema / migration 扩展。

## 允许修改目录

- `src/app/chat`
- `src/app/api/chat`
- `src/app/api/tasks`
- `src/components/chat`
- `src/components/conversations`
- `src/components/layout`
- `src/lib/bridge`
- `src/lib/conversation-registry.ts`
- `src/lib/stores/conversation-store.ts`
- `src/lib/db/tasks.ts`
- `src/lib/job-executor.ts`
- `src/types/index.ts`

## 禁止修改文件

- `package.json`
- `package-lock.json`
- `next.config.ts`
- `tsconfig.json`
- `electron-builder.yml`
- 数据库 migration 文件
- `src/lib/db/schema.ts`

## 验收标准

- [ ] Main Agent 在产品逻辑上仍是唯一主入口，Team Mode 只能从当前主会话进入。
- [ ] Main Agent 能为复杂任务生成结构化 team plan，至少包含任务、角色、依赖、预期产出。
- [ ] 用户需要先确认 team plan，之后才启动 Team Run。
- [ ] Team Run 以受控层级运行，MVP 层级限制为 `Main Agent -> Orchestrator -> Leads -> Workers`，不允许无限递归扩编。
- [ ] Team Run 有明确状态流，至少覆盖 `pending / ready / running / waiting / blocked / done / failed` 这类可见状态语义。
- [ ] Team 内部结果可以先回填到 Team 上下文，再由 Main Agent 汇总回主会话。
- [ ] 产品里有一个最小可查看的 Team 结果/工作区承载面，用户能看到团队计划、阶段结果、当前状态和最终汇总入口。
- [ ] 高风险工具确认继续复用现有权限机制，Team 角色不能绕过主运行时权限边界。
- [ ] 实现中不引入 migration；状态与结构需建立在现有聊天/任务/运行时底座之上。

## 未决问题

- [ ] 无

## 实施备注

- 依赖变更：不允许
- 数据结构变更：允许，但不得通过 migration 或共享 schema 改造落地
- 是否允许新增文件：允许
- 是否允许改动共享组件：允许，但仅限 Team Mode / Team Workspace 接入所需范围

## 建议实施顺序

1. 收口主入口边界：明确 Main Agent 与 Team Mode 的切换点和确认点。
2. 引入结构化 team plan 与 Team Run 运行骨架，先打通最小状态模型。
3. 接入现有聊天运行时与任务对象，建立阶段结果回填路径。
4. 做最小 Team Workspace / 结果面，先能看计划、状态、结果和主会话汇总。
5. 补齐可恢复运行的基础钩子：resume、可见异常状态、基本预算/层级/lock 约束入口。

## 主要风险

- 如果没有 schema 变更空间，Team Run 的状态承载方式必须非常克制，否则容易把现有任务/消息模型用乱。
- Team Mode 一旦直接侵入主聊天链路，容易把单 Agent 主路径做坏。
- 如果先做过重 UI，再回补运行骨架，会导致状态模型返工。
- 如果先做无限灵活的角色体系，会很快失控，难以稳定落在 MVP。
- 并行、lock、resume、watchdog 都需要留接口，但首版不能把它们一次做成完整平台。

## 交付物

- Main Agent / Team Mode MVP 基础架构代码
- Team plan / Team Run / 回填链路的最小可用实现
- 最小验证结果
- 剩余风险与下一阶段建议
