# Lumos 本地多 Agent 并行开发工作流

本文档为当前仓库 `/Users/zhangjun/私藏/lumos` 提供一套最小可落地的本地并行开发方案。目标是让主会话负责需求澄清，子会话负责执行，review 会话负责验收，并且避免多个 AI 会话互相覆盖修改。

这里有一个关键前提：

- 不是所有并行槽位一开始都进入“写代码”阶段。
- 对于需求还不清楚的模块，先进入“并行需求澄清”阶段。
- 只有冻结后的模块，才进入“并行开发”阶段。

## 1. 当前仓库判断

- 当前仓库是 `Next.js + Electron` 项目。
- 仓库根目录包含 `package.json` 和 `package-lock.json`。
- 当前仓库的直接父目录没有发现 `package.json`，只有其他兄弟项目各自有自己的 `package.json`。

结论：

- 现在不需要因为“父目录串层”立刻迁仓库。
- 但 `git worktree` 仍然应该放在仓库外部的兄弟目录，不能放进仓库子目录里。
- 如果后续你想长期做多 agent 并行开发，建议把主仓库和 worktree 放到一个专用父目录下，这样最稳。

## 2. 目录与仓库建议

### 默认推荐

保留当前主仓库位置：

```text
/Users/zhangjun/私藏/lumos
```

在同级创建独立 worktree 根目录：

```text
/Users/zhangjun/私藏/lumos-worktrees/
  101-chat-toolbar/
  102-settings-cleanup/
  103-review-knowledge-search/
```

这样做的价值：

- 每个 worktree 都是独立工作目录，不共享未提交文件。
- `node_modules`、`.next`、测试产物只会落在各自 worktree 内，不会和主仓库互相污染。
- worktree 不在仓库子目录里，可以避免工具把它误当成普通子项目。
- 即使未来某个任务需要单独安装依赖，也不会直接影响其他任务目录。

### 更稳的长期结构

如果你准备长期使用并行开发，建议迁到一个更干净的专用目录，例如：

```text
/Users/zhangjun/workspaces/lumos/
  main/
  worktrees/
    101-chat-toolbar/
    102-settings-cleanup/
```

推荐迁移时机：

- 你确定会长期维护 2 个以上并行 worktree。
- 你开始频繁遇到路径、缓存、脚本、终端 tab 混乱问题。
- 你希望把这个仓库和其他试验项目彻底隔离。

不建议现在就迁移的原因：

- 当前父目录并不脏。
- 你的核心诉求是先把并行开发工作流跑起来，而不是先做目录重构。

## 3. Worktree 方案

### 3.1 基本规则

- 一个任务对应一个分支。
- 一个分支只绑定一个 worktree。
- 一个 AI 会话只能在自己的 worktree 内改代码。
- 主仓库只用于需求讨论、汇总、挑选任务，不直接承担并行开发。

如果需求还没有冻结，建议不要直接进入 `task/*` 分支，而是先进入 `spec/*` 分支。

推荐把分支分成两类：

```text
spec/<module-name>
task/<任务号>-<短描述>
```

含义如下：

- `spec/*`：只做需求澄清、代码阅读、方案比较、原型验证，不进入正式开发。
- `task/*`：需求已经冻结，允许正式实现和交付。

### 3.2 分支命名规范

推荐：

```text
task/<任务号>-<短描述>
```

示例：

```text
task/101-chat-toolbar
task/102-settings-cleanup
task/103-review-import-flow
```

这样做的好处：

- 一眼就能看出任务对应关系。
- 不把 agent 身份编码进分支名，避免人员或模型变化导致命名混乱。
- review 会话也可以直接检出同任务分支进行验收。

### 3.3 哪些改动不能并行

以下类型默认不要并行开发：

- `package-lock.json`
- `package.json`
- 数据库 migration 文件
- Electron 主进程启动入口和全局 IPC 协议定义
- 全局样式基座，例如 [`src/app/globals.css`](/Users/zhangjun/私藏/lumos/src/app/globals.css)
- 全局配置文件，例如 [`next.config.ts`](/Users/zhangjun/私藏/lumos/next.config.ts)、[`electron-builder.yml`](/Users/zhangjun/私藏/lumos/electron-builder.yml)、[`tsconfig.json`](/Users/zhangjun/私藏/lumos/tsconfig.json)

这些文件改动会提高冲突概率，应该用以下方式处理：

- 单独立任务。
- 先冻结需求，再由一个 agent 独占修改。
- 其他任务基于它合并后的结果继续推进。

### 3.4 如何避免互相覆盖

每张任务卡必须写清楚：

- 允许修改目录
- 禁止修改文件
- 验收标准
- 未决问题

只有在以下条件同时满足时，任务才可以分发给 agent：

- 目标已经明确到可执行。
- 改动边界已经明确。
- 未决问题已经清零，或者已经被显式标记为“不阻塞开发”。

### 3.5 需求未冻结时怎么并行

这是更适合你当前情况的模式。

如果你现在有几个“模块方向”，但每个模块都还没讨论清楚，不要勉强写开发任务卡。应该这样拆：

```text
模块池 -> spec worktree -> 需求澄清 -> 冻结 -> task worktree -> 开发
```

也就是说，先并行的是“模块讨论”，不是“代码实现”。

推荐做法：

1. 每个模块先开一个 `spec` worktree。
2. 每个 `spec` worktree 只允许修改对应的需求卡。
3. 如果需要验证想法，只允许做很小的原型或代码阅读记录，不改正式业务代码。
4. 一旦模块需求冻结，再新开 `task` worktree 进入实现。

这样做的好处：

- 每个 AI 会话都能独立讨论一个模块，不互相干扰。
- 讨论过程中即使方向变了，也不会污染正式开发分支。
- 你可以随时终止某个 `spec` 分支，而不影响其他模块。

## 4. 会话与终端组织

### 4.1 不使用 tmux

这是默认推荐方案，最轻量。

建议固定 4 个终端窗口或标签页：

1. `main`
2. `dev-1`
3. `dev-2`
4. `review`

职责如下：

- `main`：停留在主仓库 [`/Users/zhangjun/私藏/lumos`](/Users/zhangjun/私藏/lumos)，只做需求澄清、任务冻结、合并前检查。
- `dev-1`：进入某个 worktree，只处理一个冻结后的任务。
- `dev-2`：进入另一个 worktree，只处理另一个冻结后的任务。
- `review`：进入待验收任务的 worktree，专门看 diff、跑测试、查回归。

最小会话配置：

```text
1 个主会话 + 2 个开发会话 + 1 个 review 会话
```

优点：

- 学习成本最低。
- 不绑定额外工具。
- 每个窗口就是一个任务，心智负担小。

缺点：

- 终端 tab 多起来后容易丢上下文。
- 手动切换目录和命名窗口需要自觉。

### 4.2 使用 tmux

如果你已经习惯 `tmux`，它值得保留作为增强方案。

推荐结构：

- `session`: `lumos-agents`
- `window 1`: `main`
- `window 2`: `dev-1`
- `window 3`: `dev-2`
- `window 4`: `review`

推荐约定：

- 每个 window 只绑定一个目录。
- 不在同一 window 里同时切多个任务目录。
- review window 只做检查，不顺手开发。

优点：

- 会话命名稳定。
- 可以快速恢复现场。
- 适合长期同时跑多个 agent。

缺点：

- 比多 tab 多一层工具管理。
- 如果你平时不用 `tmux`，收益未必大于心智成本。

默认结论：

- 日常先用“多终端窗口”方案。
- 当你开始稳定使用 `2+` 个开发 agent 时，再启用 `tmux` 脚本。

## 5. 任务流转机制

推荐流程：

```text
模块提出 -> 需求澄清 -> 任务冻结 -> worktree 创建 -> 开发 -> review -> 合并
```

如果你当前很多模块都还没定下来，应该把流程理解成两段：

```text
第一段：并行澄清
模块 A -> spec/A
模块 B -> spec/B
模块 C -> spec/C

第二段：并行开发
冻结后的 A -> task/101-a
冻结后的 B -> task/102-b
未冻结的 C 继续停留在 spec/C
```

这才是适合“需求沟通本身也要并行”的组织方式。

### 5.1 需求澄清

此阶段由主会话负责，目标不是写代码，而是缩小不确定性。

必须澄清的内容：

- 这次要改什么，不改什么
- 用户可见结果是什么
- 允许修改哪些目录
- 哪些全局文件禁止碰
- 验收怎么判断完成

推荐状态字段：

- `idea`：只是一个方向，还没开始讨论
- `clarifying`：正在讨论需求
- `frozen`：需求已经冻结，可以交给开发
- `developing`：正在实现
- `review`：正在验收
- `done`：已完成

### 5.2 任务冻结

满足以下条件才算冻结，可以交给 agent：

- 任务名明确
- 目标明确
- 改动边界明确
- 验收标准可检查
- 未决问题为空，或剩余问题不阻塞编码

以下情况不能开工，必须继续讨论：

- “先看看能不能顺手一起改”
- “如果方便就把全局状态一起重构”
- “UI 先随便做一个，后面再说”
- 需要碰全局配置，但没人确认影响范围

如果还是写不出完整任务卡，至少先写“需求澄清卡”。

### 5.3 开发

开发 agent 的输入只看三样：

1. 任务卡
2. 当前 worktree
3. 必要的上下文文件

开发期间不允许擅自扩大范围。如果发现任务卡不够清楚，应该退回主会话补充，而不是自行改成另一个任务。

### 5.4 Review

review 会话检查四件事：

1. 改动是否超出允许目录
2. 是否碰了禁止修改文件
3. 验收标准是否真的满足
4. 是否引入明显回归或冲突风险

## 6. 推荐的协作边界

适合并行的任务：

- 单页面 UI 调整
- 某个局部组件重构
- 某个独立 API 路由改造
- 某个业务目录下的文档或工具脚本补充

不适合并行的任务：

- 安装或升级依赖
- 更新锁文件
- 调整数据库 schema 或 migration
- 批量移动目录结构
- 修改大量共享类型定义

折中方案：

- 把“全局前置任务”先单独做完。
- 再让多个 agent 基于新的主线做局部并行开发。

## 7. 默认推荐方案

对当前 `lumos` 仓库，默认推荐如下：

1. 主仓库保留在当前路径不动。
2. worktree 放到同级目录 `../lumos-worktrees/`。
3. 先区分 `spec/*` 和 `task/*` 两种 worktree。
4. 默认不用 `tmux`，先用 `main + spec/dev 槽位 + review` 多终端组织。
5. 没冻结的模块先写需求澄清卡，冻结后再写开发任务卡。
6. `package-lock.json`、migration、全局配置类改动单独立任务，不并行。

这套方案最轻，且已经能满足“先讨论需求，再冻结，再分发给多个 AI 会话”的核心诉求。

## 8. 配套文件

仓库里配套了以下文件：

- 需求澄清卡模板：[`tasks/discovery/_template.md`](/Users/zhangjun/私藏/lumos/tasks/discovery/_template.md)
- 任务卡模板：[`tasks/_template.md`](/Users/zhangjun/私藏/lumos/tasks/_template.md)
- 协作规则模板：[`tasks/_rules.md`](/Users/zhangjun/私藏/lumos/tasks/_rules.md)
- `spec` worktree 初始化脚本：[`scripts/setup-spec-worktree.sh`](/Users/zhangjun/私藏/lumos/scripts/setup-spec-worktree.sh)
- worktree 初始化脚本：[`scripts/setup-worktrees.sh`](/Users/zhangjun/私藏/lumos/scripts/setup-worktrees.sh)
- 可选 `tmux` 启动脚本：[`scripts/start-agents-tmux.sh`](/Users/zhangjun/私藏/lumos/scripts/start-agents-tmux.sh)

## 9. 建议的日常用法

1. 对还没明确的模块，先复制需求澄清模板，进入 `clarifying` 状态。
2. 运行 `scripts/setup-spec-worktree.sh <模块名>` 给这个模块开独立讨论 worktree。
3. 把需求澄清卡和对应 `spec` worktree 路径交给某个 AI 会话，只允许它做讨论和梳理。
4. 当模块冻结后，再复制任务模板并运行 `scripts/setup-worktrees.sh <任务号> <短描述>` 创建正式开发 worktree。
5. 把正式任务卡和 `task` worktree 路径交给开发会话。
6. 开发完成后，让 review 会话做验收。
