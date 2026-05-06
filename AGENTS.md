# AGENTS.md

Repository-level collaboration rules for coding agents working in this project.

## Communication Rules

- Do not say a design document is "completed" unless its core promised capabilities are actually implemented.
- Always distinguish these four states when reporting progress:
  - `文档完整度`: `未开始` / `部分完成` / `基本完成` / `完整完成`
  - `主链状态`: `未打通` / `已打通`
  - `UI 可验收范围`: what the user can actually verify from the product UI today
  - `剩余缺口`: the major unimplemented capability gaps
- If the main path works but the document is not fully implemented, say `部分完成` or `基本完成`, never just say `完成`.
- If the user is a UI-only tester, communicate in terms of pages, buttons, visible states, results, and user actions. Do not default to internal code names, test names, workflow ids, file paths, or implementation jargon unless the user explicitly asks for them.
- When the user asks "是否完成", answer with the strict standard by default, not the POC standard.
- If there is uncertainty, verify first or explicitly say what is confirmed versus inferred.

## Anti-Confusion Checklist

Before replying with any status summary, check:

1. Am I confusing `主链打通` with `文档完整实现`?
2. Am I confusing `内部已验证` with `用户可通过 UI 验收`?
3. Am I using implementation identifiers where the user asked for product-facing language?
4. If I say `完成`, would a strict reviewer reasonably agree?

If any answer is "no", revise the response before sending it.

## Default Status Template

When the user asks for the status of a design doc or module, prefer this shape:

- `文档完整度`:
- `主链状态`:
- `UI 可验收范围`:
- `剩余缺口`:

## Current Standing Rule From User

- This user prefers strict completion language.
- This user can only perform UI testing unless they say otherwise.
- Avoid mixing architecture progress, implementation progress, and UI acceptance progress in one vague "done" statement.

## Goal Tracking Rules

- `AGENTS.md` is the source of truth for project-level goal tracking in this repo.
- Keep these three sections up to date whenever scope, milestones, or completion status materially change:
  - `大目标`
  - `阶段性目标和成果`
  - `当前状态进度`
- Do not wait until the end of a large phase. If the agent changes the practical definition of "next", lands a milestone, or finds a blocking gap, update `AGENTS.md` in the same workstream.
- Status updates in chat should stay consistent with the latest `AGENTS.md`.
- Use strict status language in `当前状态进度`; do not mark a goal complete if only the main path or POC path is working.

## Task Lifecycle Safety Rules

These rules exist because a prior bug let Workflow tasks disappear from the UI while the underlying OpenWorkflow run kept executing. Do not repeat that mistake.

- Product verbs must be implemented by product semantics, not by table names:
  - `停止 / 取消执行`: must interrupt the active runtime, stop agent/subagent work where possible, and write terminal state back to every visible execution record.
  - `关闭 / 暂停任务`: must stop future triggers and also cancel currently running executions, unless the UI explicitly says "仅停止后续触发".
  - `删除任务`: must first cancel all running executions for that task, verify they are terminal or no longer cancellable, and only then remove the visible task/schedule records.
- For Workflow tasks, lifecycle code must account for all relevant state layers:
  - `scheduled_workflows`: task definition and future trigger state.
  - `schedule_run_history` and `schedule_run_steps`: user-visible execution records.
  - `workflow_task_mapping` and `workflow_executions`: Lumos projection from task/session to workflow run.
  - `~/.lumos/workflows.db` / OpenWorkflow `workflow_runs` and `step_attempts`: actual engine state.
  - in-memory runtime controllers such as Scheduling `activeExecutions` and workflow subagent abort controllers.
- Do not implement lifecycle behavior ad hoc inside UI components or thin route handlers. Route handlers should call a lifecycle/control service, e.g. `src/lib/workflow/schedule-run-control.ts` for scheduled Workflow runs, or create an equivalent service before adding new lifecycle actions.
- If an execution history row is missing but a workflow projection or OpenWorkflow run is still `running`, code must include a conservative cleanup path that can still find and cancel the orphaned execution.
- Lifecycle acceptance must check more than the UI:
  - User action is visible in UI as `已取消` / `失败` / terminal state.
  - There are no `schedule_run_history.status = 'running'` rows for the target task.
  - Matching `workflow_executions` rows are terminal.
  - Matching OpenWorkflow `workflow_runs` are not `pending / running / sleeping`.
  - One-time tasks do not auto-trigger again after cancellation.
- Never report "已删除", "已关闭", or "已停止" for a task unless the runtime side is confirmed or the remaining uncertainty is explicitly stated.

## Electron Startup And Cache Safety Rules

These rules exist because a prior version-upgrade path tried to delete Chromium Service Worker storage while another Electron process still held the LevelDB lock, causing repeated startup errors like `Failed to delete the database: Database IO error`.

- Electron must have a single-instance guard before startup work that touches `app.getPath('userData')`, browser sessions, browser bridge runtime files, or SQLite databases.
- Do not clear `serviceworkers`, `cachestorage`, cookies, local storage, or other browser/login storage during normal startup or version upgrade unless the user explicitly chooses a destructive reset action.
- Version-upgrade maintenance may clear HTTP cache with `session.defaultSession.clearCache()`, but it must not block app startup if cache cleanup fails.
- Always write the current app version after a best-effort upgrade-maintenance attempt; otherwise the app can get stuck retrying the same failed cleanup on every launch.
- Treat `~/.lumos` as shared runtime state. Before adding startup cleanup, ask what other process/session might currently own the file or database being touched.
- When startup logs mention Chromium storage/database deletion, verify whether an old Electron process is still running and holding `Service Worker/Database/LOCK` before changing unrelated code.

## 大目标

- 按“完整实现”标准落地 `03 / 04 / 05 / 06` 任务架构文档，而不只是打通最小闭环。
- 让用户能基于产品界面和明确的阶段结论判断哪些能力已经可验收，哪些还只是内部链路可用。
- 在不破坏 `01 ~ 06` 主链边界的前提下，为后续系统能力增长补齐 `07 动态能力扩展` 的独立架构定义。
- `07 动态能力扩展 / 能力生成器` 的产品目标按“小白用户可完成能力开发、安装、更新、使用”收口：优先让用户用自然语言表达需求，由 Lumos 自主生成可安装方案、处理同名更新、路径迁移、基础自检和清晰失败提示；需要凭据、危险权限或外部账号授权时再打扰用户。
- 主 Agent 需要逐步收敛为 Lumos 的“管家”入口：优先具备全局只读状态查看、历史搜索、任意会话摘要、明显问题诊断和小白可理解的下一步引导；删除、覆盖、支付、发 IM、敏感导出、批量操作、审批 / 回滚 / 治理等高风险能力必须后置，并在专门权限与确认链路完成前不进入自动执行范围。
- 以“独立模块优先、聊天与工作流复用其服务”的原则补齐 `08 DeepSearch`，利用内置浏览器共享登录态为反爬站点提供可验收的深度研究能力。
- 建立本地浏览器 Provider / Browser Context 架构，让 Lumos 后续可在不复制账号资产的前提下接管用户已有的指纹浏览器 profile，并保证 chat、Workflow、Agent 浏览器工具不会串号。
- 支付模块先收敛到“余额充值”主链：用户充值后增加 Lumos 余额 / new-api token 额度，不做月卡、订阅或会员套餐主线。
- `lumos-web` 生产后台已切到 HTTPS：`http://lumos.miki.zj.cn` 会 301 到 `https://lumos.miki.zj.cn`，证书使用 Let's Encrypt + 现有 Nginx 自动续期方案。
- 微信 Clawbot / IM 语音交互需要按“语音可识别”和“语音回复模式”两层收口：用户任何时候发语音都应进入 AI 对话处理；用户显式切到语音模式后，AI 回复应优先以可播放音频返回，并在语音生成或发送失败时回退文本，不能静默丢消息。
- 知识库本地索引必须按跨平台标准收口：macOS 本地开发可索引不等于 Windows exe 可索引；打包版必须在 macOS / Windows 安装包里都能完成“导入内容 -> 向量化 -> 搜索命中”验收。
- 微信导出 / 本地微信读取也必须按跨平台标准收口：macOS 可读取不等于 Windows exe 可读取；Windows 需要在正式 UI 中完成“检测 Windows 微信 -> 提取密钥 -> 启用 -> 查看会话列表 -> 查看消息详情”的安装包级验收。
- 桌面端更新包体积需要逐步从“每次下载完整安装包”收敛到“主程序包 + 外置稳定运行资源缓存”；Node runtime / Python runtime / Git Bash / 本地模型这类稳定大资源应优先支持按资源清单独立校验、下载和复用，完整安装包只保留为兜底路径。
- 保持架构边界不扩张：
  - DSL v1 不支持 subworkflow
  - Phase 1 只支持 `agent / browser / notification`
  - 不执行任意 LLM 生成的 TypeScript
  - Scheduling Layer 产出 DSL
  - Workflow MCP 校验并编译
  - Workflow Engine 只执行编译产物
  - `08 DeepSearch` 先作为独立模块 / service，不直接耦合进 Workflow 主链

## 阶段性目标和成果

- 阶段 1：最小闭环
  - 成果：`generate_workflow -> compile -> engine load -> register -> run` 已打通。
  - 成果：单步 `agent`、真实 `browser + notification`、取消主链都已具备可运行实现和自动化验证。
- 阶段 2：严格验收收口
  - 成果：已建立按“文档完整度 / 主链状态 / UI 可验收范围 / 剩余缺口”汇报的规则。
  - 成果：真实 browser smoke、取消 smoke、loader 回归测试已稳定。
  - 成果：调度层已从“固定单步模板”升级为“规划器先决策，再分流到 simple / workflow 执行”。
  - 成果：`StageWorker -> workflow subagent runtime -> Workflow Engine / simple execution` 的真实取消信号已打通，不再只是本地状态取消。
  - 成果：任务记录与测试页已能展示真实调度决策，包括执行方式、预计耗时、判断依据与计划步骤。
  - 成果：调度层已补齐模型分析的超时、重试、回退诊断；测试页可直接创建和取消调度测试任务。
  - 成果：主 Agent 对话下发的任务已补实现类、网页搜索类、搜索后汇总报告类与导出诉求识别，不再一律退回通用两步流。
  - 成果：simple execution 与 workflow agent step 已补运行时超时透传，减少“任务已创建但长期挂起不收口”的问题。
  - 成果：workflow 浏览器运行时已补四处关键收口：`ctx.browser.waitFor()` 现在会把请求体里的 `timeoutMs` 同步透传到 browser bridge HTTP 传输超时，不再被客户端固定 30 秒误杀；同时当脚本把 `waitFor` 写成 `10000 / 15000ms` 这类高脆弱值时，运行时也会自动抬到更安全的下限，减少登录页和慢页面反复秒超时；`/v1/pages/navigate`、新建页、快照、截图等桥接请求也已补接口级更长默认传输超时，不再一律沿用 30 秒；另外同一段 `ctx.browser` 执行里由 `navigate/selectPage/newPage/currentPage` 获得的 `pageId` 也会持续传递到后续 `snapshot/click/fill/waitFor/evaluate/screenshot`，减少同站点多标签页场景下误落到错误页面；同时 `chrome-devtools` MCP 现在在多标签页场景下会强制要求显式 `pageId`，并在 `list_pages` 返回里增加活动页与相似页签警告，降低纯 Agent 浏览器路径误选 tab 的概率。
  - 成果：workflow `code-only` 浏览器步骤现已补上失败留痕；当脚本返回 `success:false` 或直接抛错时，运行时会自动保存当前页面快照、失败截图与代码调试日志到步骤输出目录，并把这些路径挂回结果元数据；正式 `Workflow` 详情页也已补上“打开失败截图 / 页面快照 / 调试日志”入口，减少“节点失败但现场已经丢失”的黑盒排障成本。
  - 成果：workflow `code-only` 浏览器下载步骤现已补上下载产物收口；当步骤在执行过程中触发浏览器真实下载时，运行时会把本次新下载文件自动复制到当前步骤 `output` 目录，使正式“执行记录 > 结果文件”tab 能稳定收录，而不再只依赖脚本摘要里口头回传的绝对路径。
  - 成果：Scheduling planner 已切到与主 Agent 一致的 Claude SDK 规划路径；同时 workflow / simple execution 也已补上任务会话的 `provider / model / workingDirectory` 透传，减少“主对话能用但工作流规划或执行走到别的 provider / 目录”的断链问题；最新还已把 planner 默认超时从 30 秒放宽到 90 秒，并把 Claude SDK 超时误报的 `aborted by user` 文案归一为明确的规划超时诊断；另外当 Claude SDK 没有填充 `structured_output`、但返回了纯 JSON 文本或单个 JSON code fence 时，规划器也已改为先做严格 JSON 解析再进入 schema 校验，减少这类网关兼容场景下的误失败；同时规划响应 schema 现已容忍 `detectedUrl: null` / `detectedUrls: []` 这类空位输出，并在入库前归一化为“未提供”，避免研究类任务因可选 URL 字段的空值格式直接失败；此外，planner 输出的 `workflowDsl` 现已改成按 step type 的严格结构化 schema，browser step 只允许当前引擎真实支持的 `navigate/click/fill/screenshot` 输入字段，且 DSL 校验失败原因会显式回灌到下一次 LLM 重试，减少模型连续三次复用同一类非法节点形状；现在还进一步补上了 planner 语义校验：长篇 plain-text 报告综合步骤的超时下限、`researcher` 只读角色不得被要求落文件、以及 `md-converter` 这类导出能力优先消费上游 `output.summary` 而不是假设 temp 文件存在；另外 Claude SDK 与 AI SDK 两条 LLM 调用链现在也已统一走 provider-aware 的模型解析，不再让聊天、planner、workflow agent 各自散落一套模型别名/目录匹配逻辑，且正式调度诊断已开始同时记录请求模型与实际解析模型。
  - 成果：workflow 编译/执行链路已补默认 step timeout 与外层收口缓冲；当 DSL 未显式声明 `policy.timeoutMs` 时，编译产物现在会为 `agent / notification / capability / wait` 生成默认超时，并把这些 timeout 写进 manifest；workflow outer timeout 也已改为按 step timeout 求和后再加额外缓冲，减少“步骤产物已经写完，但整体任务卡在外层超时边界被判失败”的问题。
  - 成果：workflow 运行时已补齐 `notification / capability / wait` 的真实 runtime binding，编译产物也会显式解构这些 handler，不再出现“DSL 校验允许节点类型，但执行期缺少运行时绑定”的断链。
  - 成果：workflow `code-only` 浏览器执行链路现已默认走后台模式；任务运行时的 `ctx.browser` 会把 `background: true` 透传到 browser bridge，减少代码节点执行时反复切前台浏览器标签页对用户操作的打扰，同时保留手动调试入口的前台行为。
  - 待完成：补齐使 `03 / 04 / 05 / 06` 能按“完整实现”标准过验收的缺口。
- 阶段 3：UI 验收对齐
  - 成果：已确认用户当前只能做 UI 测试，后续汇报必须产品化表达。
  - 成果：已确认 `06 执行代理层` 不能只停留在运行时实现，必须补正式 UI 才能按“完整实现”标准验收。
  - 成果：`06` 已新增正式工作流角色配置 UI，并已接到真实调度/执行配置源，不再只是测试页或硬编码。
  - 成果：已新增正式 `Workflow` 页面入口，把任务创建、调度判断、执行计划和角色快照收进产品界面，不再只依赖 `/task-management-test`。
  - 成果：`Workflow` 正式页已补上真实最终输出展示，并能区分“原始规划步骤”和“实际执行步骤”；当任务回退为 simple execution 时，不再把旧工作流步骤错误展示为当前执行状态。
  - 成果：正式 `Workflow` 编辑页已补一轮保存收口；现在删除最后一个节点后仍可按“空白草稿”正常保存，且删除节点时会同步清理残留的依赖/控制流引用，减少“界面上节点已删、点击保存后仍一直显示未保存”的假失败。
  - 成果：正式 `Workflow` 编辑主路径已开始收敛到原生 `v3 nodes/edges`；当前详情编辑页与新建构建器页的页级真源、JSON 文本与保存载荷都已统一使用正式 `v3` DSL，旧 `steps / dependsOn` 视图模型仅保留在图形/可视化子组件边界，通过适配器进出，不再继续作为页面级保存真源。
  - 成果：正式 `Workflow` 列表页已补上批量导入 / 导出第一版；用户现在可以多选工作流后导出，也可以导出全部工作流；导入接口同时兼容旧单工作流包 `lumos-workflow/v1` 和新批量包 `lumos-workflow-bundle/v1`，页面导入也支持一次选择多个旧单包文件并合并成批量导入请求；批量导入时会复用同一批 preset ID 映射，减少同一批包内共享代理预设被重复创建。
  - 成果：已修正调度层对中文否定语义的一个显性误判，`不需要通知` 不再被当成通知需求。
  - 成果：已补 OpenWorkflow / backend-sqlite 的 Next 服务端外部包配置，收口当前开发环境下的一个工作流引擎兼容风险。
  - 成果：已收紧 workflow agent step 的输出合同，默认只交付结构化文本结果，不再允许虚报未落盘的 artifact 文件，减少多步代理工作流的伪失败。
  - 成果：已为文本型 stage 补上结构化输出失败兜底；当 Claude Code 连续无法收敛到 JSON schema 时，运行时会退到纯文本交付模式并安全包装为 stage 结果，避免主链卡死在格式层。
  - 成果：已修正 Workflow DSL 编译产物中的 step output 引用语义；`steps.someStep.output.summary` 现在会正确读取上一步 `output.summary`，不再把下游步骤喂成空输入。
  - 成果：正式 `Workflow AI 助手 / Builder` 已补上“稳定工作流”收口；当前生成与修改 DSL 时会强制追加稳定性规则、对 `shared/*_output.md` 猜路径 / `context` 直挂 `steps.x.output.summary` / 代码节点绝对路径 / 非结构化字段下游直读等高风险模式做正式校验，并在返回 DSL 前自动带着校验问题自修一轮，减少 AI 写出“能解析但运行脆弱”的工作流。
  - 成果：主 Agent 对话里的任务完成通知已改为直接写入真实执行结果；浏览器截图/文件路径不再经过模型改写，聊天区可直接识别并预览。
  - 成果：正式 `Workflow` 页面已新增只读工作流流程图，能按层展示步骤依赖、并行分支与当前状态，复杂流程不再只能靠文字列表理解。
  - 成果：已修正复杂并行浏览器工作流的两处主链问题：中文标点分隔的多 URL 现在能被稳定识别为独立分支；并行浏览器分支也已补上独立 pageId 绑定，不再共用活动页。
  - 成果：已新增“前置分析 → 并行浏览器分支 → 汇总代理 → 最终通知”的混合复杂工作流规划路径，并接入正式 `Workflow` 页面快捷入口。
  - 成果：混合复杂工作流已完成一轮真实 UI 验收，当前主链可以稳定跑通“前置分析 → 三路并行浏览器 → 三路截图 → 汇总代理 → 最终通知”。
  - 成果：已收敛任务完成系统通知的重复正文；当汇总代理结果与最终通知正文相同，系统完成通知不再第三次原样重复整份报告，改为保留完成状态与附件信息。
  - 成果：正式 `Workflow` 页面已补上运行态详情面板；现在可直接看到真实运行状态、当前动作、运行中步骤、已跳过步骤、开始/结束时间，以及失败或取消原因。
  - 成果：正式 `Workflow` 页的步骤卡已从“只有计划”升级为“计划 + 实际状态 + 关键结果/失败原因 + 关键运行信息”，浏览器/通知/代理步骤都能在同页验收。
  - 成果：`06` 已新增独立的正式 `Workflow Roles` 页面，并把执行角色/规划角色分组展示；正式 `Workflow` 页面也已直接跳转到该入口，不再要求用户先进入团队设置再找对应标签。
  - 成果：当前正式 `Next build` 已恢复通过；`/workflow/agents` 已进入最终路由清单，正式角色页不再停留在“代码已写但整包构建未过”的状态。
  - 成果：正式 `Workflow` 详情页已把“规划角色、当前运行角色、任务内角色分配”收进同页展示；现在能直接从任务详情看到调度代理、执行角色、系统 browser/notification 能力和各自边界，不必再切到测试页或配置页自行对照。
  - 成果：正式 `Workflow` 详情页已继续补进代理会话、任务/规划/执行记忆槽、隔离工作目录、输出目录、请求模型、耗时与 Token/API 调用等运行态资源信息，`06` 的独立会话与资源边界已开始能在产品界面直接验收。
  - 成果：正式 `Workflow` 详情页的 `03 调度判断` 已升级为调度诊断视图，当前可直接验收调度受理状态、初始判定与实际执行差异、浏览器/通知/多步/并行触发条件、规划产物校验结果、原始规划步骤，以及模型分析/执行前回退记录。
  - 成果：正式 `Workflow Roles` 页已新增“运行中代理会话”面板，并接入真实活跃代理会话数据；现在除静态角色配置外，也能在正式 UI 直接看到当前活跃会话、生命周期状态、隔离目录、记忆槽、能力边界，并可发起单代理中断。
  - 成果：正式 `Workflow` 详情页里的浏览器步骤现已支持截图直接预览，并提供截图文件 / 详细结果的正式打开入口；`05` 的浏览器产物验收不再只依赖绝对路径文本。
  - 成果：正式“执行记录 > 结果文件”tab 已继续补上浏览器下载文件的正式验收体验；现在除步骤 output 目录下的文本/图片外，浏览器真实下载得到的 `.xlsx/.pdf/.docx` 等文件也会随步骤产物进入该 tab，并以“打开本地文件 / 下载原文件”的方式展示，不再误用文本预览或因未复制进 output 而完全不可见。
  - 成果：正式 `Workflow` 详情页现已继续补齐 agent / code 节点的执行留痕；当前工作流步骤运行时会把步骤结果摘要同步写入 `schedule_run_steps`、旧 run 详情也会回退解析会话消息补摘要，且 agent / code 节点都会额外把 summary 落到本步骤 `output` 目录并写入 `_lumos_step_input.json` 输入快照，使“步骤详情 / 完整输入上下文 / 结果文件”不再只对浏览器节点完整、也不再出现“节点跑完但没有可见输出物”的黑盒状态。
  - 成果：正式 `Workflow` 任务的关闭 / 删除 / 执行记录停止已补真实执行收口；现在关闭任务会取消同任务下正在运行的 workflow，删除任务前也会先取消底层执行，执行记录页新增“停止执行”，一次性任务取消后会自动暂停，且当历史 run 记录已被删但 workflow projection 仍残留 running 时也会按任务名兜底取消，减少“UI 看似删除但底层还在跑”的断链。
  - 成果：正式 `Workflow` 执行记录页已补第一版节点级重跑；失败记录可点击“从失败节点重跑”，用户也可在工作流结构图选中具体执行节点后点击“从此节点重跑”。重跑会新建一条执行记录，不改写旧记录，并复用原执行中目标节点上游已经完成的步骤输出，目标节点和其下游会重新执行；自动失败节点定位按每个节点的最新终态判断，避免被同一节点早期重试失败误导。
  - 成果：按 `01 / 02 / 03` 设计文档要求，主 Agent 复杂请求已补上正式下发闭环：命中复杂任务时会直接创建 Task Management 任务并返回交接确认，不再在主对话里自己执行整项任务；同时 `createTask` 生成的任务会正式回写来源用户消息与助手确认消息。
  - 成果：按用户最新要求，主 Agent 页已去掉临时任务面板，任务标签也已从全局左侧导航撤下，改为出现在聊天界面右侧的轻量任务标签；用户可直接点击标签跳到标准 `Workflow` 任务详情查看报告，不看详情时仍由主 Agent 在对话里汇报结果。
  - 成果：按用户最新确认，主 Agent 已开始接入 Lumos“管家”第一阶段只读能力；当前主 Agent 会话会获得内置 `lumos-butler` 工具，可读取全局状态摘要、搜索历史会话 / 消息 / 任务 / Workflow / DeepSearch / 能力记录，并查看任意会话的最近消息和关联任务；同时已新增 `/main-agent/butler` 只读总览页，可查看更完整的诊断、运行资源、最近会话 / Workflow / DeepSearch、能力和浏览器概览，并可在同页搜索历史会话、消息、任务、Workflow、DeepSearch 和能力记录；按最新界面收口，主 Agent 聊天页顶部“Lumos 管家状态”条已移除，聊天页不再默认展示管家状态面板。最新又把主 Agent 的只读 Workflow 查询补到任务 / 计划任务 / 执行记录 / 单次执行步骤 / 运行中 Agent 会话，主 Agent 不应再回答“工作流没有查询接口”。该阶段只做诊断和引导，不包含删除、覆盖、支付、发 IM、敏感导出、批量操作、审批 / 回滚 / 治理等高风险动作。
  - 成果：图片模块已新增 `Nano banana2（ToAPIs）` 的第一阶段接入；当前正式预设会把 ToAPIs 的“上传参考图 -> 创建异步任务 -> 轮询状态 -> 下载结果”接进统一图片生成主链，不再误复用 Google 官方 Gemini 原生协议；同时已开始支持文生图、图生图/多参考图、极端宽高比与 `resolution` 元数据透传，便于先承接与万相相近的一批电商出图/改图场景；图片参数 UI 也已从旧确认卡片扩到真实聊天入口与图片服务商编辑弹窗，当前会按图片模块正在使用的服务商动态展示可用比例、分辨率、生成张数上限、参考图上限与专有高级参数入口，优先适配 `Nano banana2（ToAPIs）` 的极端宽高比和高参考图上限；同时图片服务商现已支持在设置里保存默认比例/分辨率/张数，并在真正的生成运行时自动生效；Pro 图片生成工具已移除旧的“每会话最多 10 张”运行时限制与结果字段，改为按张计费口径，聊天侧不再应根据历史 `generation_count / generation_limit` 推导剩余额度；最新还已修正 OpenAI-compatible 图片服务商的参考图编辑 multipart 字段，避免 `gpt-image-*` 网关忽略 `image[]` 后报 `image is required for edits`，并把图片生成业务失败改为 `success:false` JSON 返回，减少并行工具调用时被 SDK 放大成 `Sibling tool call errored`。
  - 成果：图片生成的 Lumos 云配额扣费请求已补 Node 侧代理支持；当桌面端/工作流进程设置了 `HTTPS_PROXY / HTTP_PROXY` 时，配额接口会显式走代理并遵守 `NO_PROXY`，减少“浏览器或 curl 可访问云端，但工作流生图在扣费前因 `fetch failed / ECONNRESET / ENOTFOUND` 失败”的断链。
  - 成果：已定位 `745879e0` 这类电商场景图工作流在 `generate-scenes` 节点反复失败的直接原因：失败发生在场景图生成师的 Claude 兼容模型首轮请求阶段，trace 中没有 `generate_image` 工具调用，说明还没进入真实图片服务商；该节点会把抠图和多张参考图作为上游图片二进制一起注入模型上下文，兼容网关长时间处理后返回 `bad_response_status_code 500`。当前运行时已对 `generate-scenes` / 场景图生成师这类“场景图生成”节点跳过原始多图二进制注入，只保留上游文件路径供 `generate_image.reference_image_paths` 使用；同时步骤 trace / metadata 会记录实际解析模型，workflow-agent 预设的 `model` 字段也会进入执行层。该修正已通过新增单测和相关 ESLint，但仍需用户在正式 `Workflow` 执行记录里从失败节点重跑完成 UI 验收，才能说这条场景图工作流已恢复。
  - 成果：支付模块已按用户最新要求收敛为“充值余额”第一阶段主链；当前桌面端充值弹窗不再展示月卡/套餐购买，用户可输入金额，当前仅展示支付宝支付，创建订单后直接在弹窗展示二维码，并会自动检测到账后显示“支付成功 / 余额已到账”；订单创建由桌面端转发到 `lumos-web`，后台按易支付签名规则生成支付链接，并在异步/同步回调中校验签名、支付状态和金额后给对应 new-api token 增加额度，同时记录订单到账状态以减少重复回调导致的重复入账风险。
  - 成果：Lumos Cloud DeepSeek 计费差异已完成三轮生产排查和收口；第一轮确认 new-api `CacheRatio` 缺少 `deepseek-v4-flash / deepseek-v4-pro` 别名并修正历史缓存折扣；第二轮确认工作流任务里的 Claude Code Task/subagent 仍会向 DeepSeek 渠道发出 `claude-haiku-4-5*` 辅助调用，导致按 Claude Haiku 倍率放大扣费，生产已补 DeepSeek 兜底别名并修正受影响历史日志、小时统计、token 余额、用户余额/used quota 和渠道 used quota，两轮累计返还 `172,383,838` quota（¥344.7677）；第三轮按后台“聊天服务商加价”重新核对 `lumos_chat_providers.model_catalog.markup_percent -> new-api ModelRatio/CompletionRatio/CacheRatio`，确认 `deepseek-v4-flash` 原价 ¥1/¥2 每百万 token + 40% 加价已正确同步为 `ModelRatio=0.7 / CompletionRatio=2`，`deepseek-v4-pro` 原价 ¥12/¥24 + 20% 加价已同步为 `ModelRatio=7.2 / CompletionRatio=2`，生产 `CacheRatio` 按 DeepSeek 2026-04-26 后的当前官方 cache hit 价格比例保持为 `deepseek-v4-flash=0.02`、`deepseek-v4-pro=0.0083333333`、DeepSeek 兜底 `claude-haiku-4-5* = 0.02`，使缓存命中也按上游当前成本比例叠加后台加价计费；排查期间短暂误设为旧 launch 价比例的 58 条请求已补回 `19,116` quota（¥0.038232）。客户端侧也已补 Claude Agent SDK 内部模型防护，非真实 Claude resolved model 会把 `ANTHROPIC_SMALL_FAST_MODEL / ANTHROPIC_DEFAULT_HAIKU_MODEL / ANTHROPIC_DEFAULT_SONNET_MODEL / ANTHROPIC_DEFAULT_OPUS_MODEL / CLAUDE_CODE_SUBAGENT_MODEL` 全部固定到当前 resolved model，减少工作流 agent / subagent 继续产生 `claude-haiku-*` 账单行；仍需补正式自动化计费回归，防止未来后台保存服务商时遗漏 CacheRatio 审计。
  - 成果：微信 Clawbot / IM 语音交互已补第一轮主链代码：微信入站 `voice_item.text` 会继续作为用户语音转写进入 AI；当微信没有返回 ASR 文本时，Electron monitor 会下载语音媒体，先尝试显式配置的 OpenAI-compatible ASR（`IM_VOICE_ASR_BASE_URL / IM_VOICE_ASR_API_KEY / IM_VOICE_ASR_MODEL`），再尝试本机 Whisper；如果仍没有转写，Next 服务端分发层会在命令识别和 AI 派发前继续尝试 Lumos 默认 OpenAI-compatible 服务商 ASR，成功后只把转写文本和非音频附件交给对话引擎，避免把原始音频当普通文件喂给模型；全部失败时仍以“语音附件占位”进入对话而不是静默丢弃。微信命令新增 `/voice on|off|status` 与 `/语音 开启`，并支持“开启语音模式 / 切回文本模式”这类被语音转写后的自然短句直接切换，按当前 peer 保存语音回复模式；语音模式下 AI 回复会优先调用本机 TTS 生成音频附件并通过 Clawbot 发送，如回复同时包含图片/文件，会先单独发送这些附件，再单独发送语音，TTS 或语音发送失败时自动回退文本且避免重复发送已成功发出的附件。当前实现选择“音频文件附件”作为出站语音载体，因为 iLink bot 方向原生 VOICE 消息在现有通道会静默丢弃；相关微信命令、入站语音、ASR 兜底、语音模式出站、TTS 失败回退、默认服务商 ASR 回归和附件回退单测已通过，`typecheck / lint / Electron build / Next build` 也已通过；仍需真实 Clawbot / 微信实机验收，不能按实机完整完成汇报。
  - 成果：微信导出 / 本地微信读取已修正两处重装后读取断点；此前读取链路硬性要求存在 `message_0.db`，但当前用户本机微信修复后实际保留的是 `message_1.db ~ message_5.db`，导致 Lumos 报 `FileNotFoundError: 未找到 WeChat 数据目录`。当前已改为识别任意 `message_[0-9].db`；随后又定位到“会话列表可见但详情无消息”的原因是详情读取仍只用 `key.txt` 单密钥过滤消息分片，而当前可读的 `message_1.db` 需要按自身 salt 从 `wechat_keys.json` 取密钥。现已把消息库查询、表探测和发件人识别改为按库取密钥，并用本机 `list_sessions` 与 `read_chat` 只读查询确认会话列表和详情消息都能返回；最新又确认“左侧会话列表显示最新消息，但详情旧/空”的直接原因是左侧读取 `session.db` 摘要库，右侧读取 `message_*.db` 正文库，而当前本机 5 个正式消息分片中只有 `message_1.db` 可解密，`message_2.db ~ message_5.db` 缺少已保存密钥映射。现已在 `read_chat` 和独立 `diagnostics` 返回里补上消息库覆盖诊断，并在微信页面新增“修复消息读取不完整”入口：用户可在 Lumos 里检测消息库可读数量，点击“开始修复”触发 macOS 管理员授权、临时重签名并重开微信，随后 UI 会自动等待并进入“重新提取消息库密钥”；若微信已经是临时签名状态，按钮会明确显示“重新提取消息库密钥”，不再让用户误以为输入密码就是全部修复完成；提取脚本也已改为增量合并已有密钥，避免重提取时覆盖现有可读分片。另外已修正 `codesign -dv` 签名探测只读 stdout 的问题，避免微信已经是 `adhoc` 仍被状态接口误判为 `unknown`，并避免提取接口误报“微信仍是官方签名”。该修正只解决 Lumos 的分片识别、密钥选择、可见诊断和产品内修复入口，不代表微信原始数据库损坏、丢失聊天记录或缺少新分片密钥已经被 Lumos 修复。
  - 成果：微信导出 / 本地微信读取已开始新增 Windows 支持链路；当前代码已把 `服务-微信` 从 macOS 单平台状态机改为 macOS / Windows 分流，Windows UI 不再返回“仅支持 macOS”，并新增 Windows 微信环境检测、`WeChat Files/<wxid>/MSG` 数据目录识别、Windows WeChat.exe 进程密钥提取脚本、`MicroMsg.db / MSG*.db` 本地解密缓存、会话列表 / 联系人搜索 / 消息详情查询、Windows MCP 入口和跨平台 MCP dispatcher。最新又补了几个阻断 Windows 新机安装包验收的关键点：Windows 打包链路会下载并打入 `python-runtime/win32/x64`，CI 会检查 Windows 包内是否存在 Python runtime、Git Bash runtime、wechat-export dispatcher 和 Windows 读取脚本；本地已重新跑通 `npm run electron:pack:pro:win`，生成 `release/Lumos-Setup-0.25.34.exe`，并通过包内 Git Bash、Windows wechat-export 资源和 embedding model 校验；Windows 状态机已把“读取已提取的本地数据库”和“重新提取密钥时需要 WeChat.exe 运行”分开，不再因为微信关闭就阻止启用/读取；密钥状态已按 macOS / Windows 分平台判断，避免旧 `key.txt` 让 Windows 假就绪；Windows 提取脚本也改为尝试 4/8 字节指针、降低对齐假设、增量合并账号密钥，并对 UI/日志里的原始 key 做脱敏。本轮继续补 Windows 手动路径主链：微信程序会优先从运行中进程、注册表和常见安装目录自动发现；聊天数据目录不再只认 `WeChat Files/<wxid>/MSG`，也会识别 `WeChat Files`、`xwechat_files`、账号目录、`MSG`、`Msg/Multi`、`db_storage/message` 以及用户从微信文件管理里选到的账号子目录；状态探测和 Windows 提取脚本共用同一套向上查找规则，避免“页面保存成功但后台仍找不到账号目录”。该成果仍需 Windows 真机和安装包级 UI 验收，不能标为 Windows 主链已打通。
  - 成果：知识库向量化的长期跨平台问题已正式记录并定位；Windows exe 报错 `embedding model initialization failed: Cannot read properties of undefined (reading 'create')` 时，诊断已显示模型文件实际存在于用户 runtime cache 和安装目录，因此不应继续按“模型文件缺失”方向排查。当前判断为 Electron/Next packaged server 中 portable `transformers.web.js` 在 Node 进程里误选 `onnxruntime-node` 空后端，导致 `InferenceSession.create` 为空；修复方向是让打包版索引统一走本地 `onnxruntime-web` WASM 后端，并显式绑定打包内 `ort-wasm-simd-threaded` 文件路径。
  - 待完成：知识库索引仍需完成新安装包级验收；必须分别在 macOS 和 Windows exe 上验证“导入内容 -> 向量化成功 -> 搜索命中”，在此之前不能把跨平台索引问题标为完整完成。
  - 成果：桌面端更新包体积治理已开始第一阶段前置改造；运行时已新增统一资源解析层，Node runtime / Python runtime / Git Bash / 本地 embedding 模型 / MCP runtime path 可优先从 `LUMOS_EXTERNAL_RESOURCES_DIR` 或 `~/.lumos/runtime-resources` 查找，再回退到安装包资源和开发态 `resources/`；同时已新增发布侧 runtime resources manifest 生成脚本，可先产出 Node/Python/Git-Bash/models 的文件清单、大小与 sha512，为后续独立资源下载、校验和缓存复用做准备。
  - 成果：Windows 打包链路里 `Git Bash` 运行时下载后进入 `next build` 时，曾因构建期 glob/trace 误扫 GitHub Actions 的真实用户目录 `C:\Users\runneradmin\Application Data` 而触发 `EPERM scandir`。当前已把 Next 构建入口收敛到项目脚本，并在 Windows 构建时使用隔离的临时 `HOME / USERPROFILE / APPDATA / LOCALAPPDATA`，避免构建期依赖扫描受保护的 Windows profile junction；同时 Windows 打包链路已补 Python runtime 下载、Git Bash runtime 校验与 Windows wechat-export 打包产物校验，避免新 Windows 机器缺少内置 Python / Git Bash 导致“本地读取组件”实际不可运行；本地已通过 `npm run typecheck`、Python 脚本编译、隔离 `Next build`、`npm run electron:pack:pro:win`，并确认 `release/win-unpacked` 内 Git Bash、Windows wechat-export 资源和 embedding model 都存在；仍需重新跑 GitHub Actions Windows 打包确认 CI 环境也通过。
  - 待完成：主安装包尚未真正瘦身；还需要补正式资源下载/校验/恢复 UI、资源包发布与 CDN/更新接口接入、首次安装缺资源兜底、跨平台打包验收，然后才能从 `electron-builder` 主包里移除稳定大资源。
  - 成果：已新增 `07-dynamic-capability-extension-design.md`，把“用户通过 LLM 动态新增系统能力，并让工作流后续可正式使用”定义为独立横切架构，不再硬塞进 `03 ~ 06` 任一单层文档。
  - 成果：已为 `07` 补上正式产品入口；左侧侧边栏现已新增“节点开发”菜单，并有独立 `/workflow/nodes` 页面用于展示当前正式节点边界、07 的能力建设方向与剩余缺口。
  - 成果：已按用户最新确认收敛 `07` 的产品形态：`新增能力` 继续以聊天页为主入口，尽量不扩 UI；AI 需先和用户对话确认需求，再直接生成两类待发布能力（`代码节点` / `Prompt 节点`）；“草稿”只保留为内部实现概念，不作为 Phase 1 主要产品心智。
  - 成果：`07` 已补上第一段正式主链：当前可在“新增能力”聊天页完成 `对话确认 -> 生成待发布能力 -> 发布`，能力管理列表和详情页也已切到“待发布 / 已发布”正式语义；其中 `Prompt 节点` 已进一步接入调度层发现，用户在任务里明确写出能力 ID 或名称时，会被规划进工作流 agent 步骤中使用。
  - 成果：`07` 已继续补上代码节点的第一条正式调用桥：当任务里明确提到某个已发布 `代码节点`，并同时提供结构化 JSON 参数时，调度层会生成真实 `capability` 步骤执行该节点；正式 `Workflow` 详情页也已开始把这类步骤显示为“系统能力节点”，并展示能力 ID 等运行态信息。
  - 成果：已开始兼容历史遗留能力文件；`~/.lumos/capabilities` 下已有的旧 `ts/md` 能力现已能进入当前能力发现范围，不再只停留在“文件存在但主链不可见”的状态。
  - 成果：主 Agent 的一个高频导出场景已补上第一条自动接能力的链路；当任务要求“整理报告/正文并导出 PDF”且存在可识别的格式转换代码节点时，调度层会在正文生成后自动追加能力步骤执行导出，不再一律回退为“PDF 导出需求已记录”占位话术。
  - 成果：`新增能力` 聊天助手已补上真实能力清单提示；后续只有在当前真实可发现能力列表里存在时，才应对用户说“已经有这个能力”。
  - 成果：`能力生成器` 的 Skill / MCP 安装链路已补第一轮体验收口；现在同名 Skill / MCP 会自动走更新而不是只显示 `exists`，分享包导入默认按覆盖更新处理，导出 / 导入 / 生成安装方案会把 Lumos 数据目录、用户目录、Python runtime 和 runtime resources 尽量写成可迁移占位符，生成的 Python MCP 模板和内置 JS MCP 入口也会按 `inputSchema` 对字符串化的 number / integer / boolean / array / object 参数做基础类型兜底；对于生成器安装的 stdio MCP，安装后还会执行 `initialize -> tools/list` 的启动自检，并在 UI 里用“已安装 / 已更新 / 自检失败”等用户可理解状态展示。
  - 成果：正式 `能力 > MCP 服务器` 管理页已补第一版手动健康检查体验；用户现在可以对单个 MCP 点“检测服务器”，也可以点“检测全部”，页面会展示“未检测 / 检测中 / 可用 / 失败”等状态和失败原因；手动新增、更新或同名覆盖 MCP 后也会自动跑一次基础启动检测。同时保存表单会自动拆分误填在 command 输入框里的整条 `npx -y ...` 命令，减少小白用户因 command / args 分不清导致的启动失败。最新还已把 MCP 健康检查结果持久化到本地库，刷新页面后仍能看到上次检测状态、失败原因、检测时间和工具数量；能力生成器安装后的 stdio MCP 自检也会同步写回该状态；MCP 配置也已新增“按需启动 / 长连接声明”运行方式意图和 `auto / Node / Python / Bun / 自定义` 运行时声明，并同步进入管理页表单、列表徽标、导入导出包、内置 MCP 配置和能力生成器计划格式。远程 HTTP / SSE MCP 检测已从基础连通升级为第一版协议级检测：HTTP 会执行 `initialize -> notifications/initialized -> tools/list`，旧 SSE 会先识别 `endpoint` 事件再执行同样的初始化和工具列表检查，`401 / 403 / 404` 不再被误标为可用。
  - 待完成：聊天侧任务标签目前已满足“轻入口 + 点开看正式详情”，但更细的展示策略和交互规则仍可能继续调整，还不是最终完整产品形态。
  - 待完成：把内部完成度和 UI 可见能力进一步对齐，减少“内部已通但 UI 不可验”的区域。
  - 待完成：补齐 `06` 的正式执行代理 UI，并与现有团队设置页分层，避免和旧 team-run 角色预设混淆。
  - 待完成：把 `03` 调度信息与 `06` 运行态角色信息继续收进正式详情页，而不只留在测试页或配置页。
  - 待完成：`07` 仍未完整打通；虽然对话式确认、能力生成、发布入口、`Prompt 节点` / `代码节点` 的显式任务引用、报告导出到 PDF 的自动接能力主链，以及能力生成器的同名覆盖更新、路径变量化、安装后基础自检、参数类型兜底、MCP 管理页手动健康检查、健康状态持久化、运行方式/运行时声明和第一版远程 MCP 协议检测都已具备第一段可验收实现，但更通用的自动发现、自然语言参数提取、审批、回滚、`keep_alive` MCP 后台守护 / 崩溃自动重启、Bun 运行时托管或自动安装、受保护远程 MCP 的登录授权引导和更完整运行时治理都还没有完成。
- 阶段 4：DeepSearch 独立模块设计
  - 成果：已确认 `08 DeepSearch` 不应先耦合到 Workflow，而应先做独立模块，再由聊天和 Workflow 复用。
  - 成果：已确认产品需要在左侧侧边栏 `扩展` 下新增正式 `DeepSearch` 页，用于登录态配置、历史记录和抓取内容查看。
  - 成果：已新增 `08-deepsearch-requirements-design.md` 与 `08-deepsearch-architecture-design.md`，明确产品需求、模块边界、登录态主链和对外调用形态。
  - 成果：已新增 `08-deepsearch-bb-browser-integration-design.md`，明确 `bb-browser` 更适合作为能力样板而不是直接作为正式运行时接入，并收敛出 Lumos 应吸收的 `site adapter / session fetch / compact snapshot / network capture` 方向；结合源码复核后，方案已进一步具体化为在 Lumos 内增加 `bb-site compatibility runtime`，优先承接经过审查的 Tier 1 / Tier 2 adapter。
  - 成果：已新增 `08-deepsearch-deployment-and-local-usage-design.md`，明确 DeepSearch 的 Phase 1 正式形态应为 Lumos 内置模块；本地使用方式应是“通过本地 Lumos 实例直接使用”，而不是先做成独立安装的外部 tool。
  - 成果：已新增 `08-deepsearch-phase-1-implementation-design.md`，把 `08` 的第一阶段交付范围、实现顺序、站点优先级和严格 UI 验收标准显式写清。
  - 成果：已新增 `08-deepsearch-ui-and-interaction-design.md`，把正式页的布局、按钮、状态、详情区、当前页接管确认、等待登录恢复、暂停/恢复/取消和 `partial` 展示方式进一步落成可实现交互。
  - 成果：已新增 `08-deepsearch-data-and-api-design.md`，把 `run / run page / checkpoint / record / artifact / site state` 数据边界，以及 `DeepSearch Service / tool facade / Workflow capability` 的接口合同进一步写清。
  - 成果：已新增 `08-deepsearch-engineering-implementation-design.md`，把当前仓库里的真实目录落点、`/extensions` 页 tab 接入、browser bridge 复用、DB 迁移文件位置和开发顺序进一步拆成工程可执行方案。
  - 成果：已把两条最新架构决策正式写回 `08` 文档：DeepSearch 可以正式接管用户当前浏览器中的活动页；同时正式支持 `strict / best_effort` 两种执行语义，非严格模式下允许先跑能跑的站点并以 `partial` 收口。
  - 成果：已统一 `08` 文档中的运行状态枚举、恢复语义和 Phase 边界；当前口径收敛为 `pending / running / waiting_login / paused / completed / partial / failed / cancelled`，其中 Workflow 正式复用进入 Phase 2，而不是继续和 Phase 1 混写。
  - 成果：`08` 已开始正式代码实现；当前左侧 `扩展` 页中已新增 `DeepSearch` tab，并已落地站点登录态管理 UI、DeepSearch 本地 SQLite 表、`/api/deepsearch/sites` 与 `/api/deepsearch/runs`、抓取记录历史列表、详情面板，以及 `strict / best_effort`、`takeover_active_page / managed_page` 的正式参数落库与展示。
  - 成果：`08` 已继续补上第一条真实浏览器运行时接线；当前 DeepSearch 已新增共享 browser bridge client、独立 DeepSearch service、`/api/deepsearch/runtime/page-binding` 预览接口，以及“当前活动页可否接管”的正式 UI 预览，不再只靠静态文案假设浏览器状态。
  - 成果：`08` 已把“接管当前活动页”从预览升级为 run 级正式绑定；当前在 `扩展 > DeepSearch` 创建 takeover 任务时，会尝试锁定浏览器当前活动页并落库到 `run page` 记录，详情面板也可直接验收页面标题、URL、pageId、绑定类型和绑定时间。
  - 成果：`08` 已继续把 run 从“只做绑定和草案”推进到“真实执行基础页面快照”；当前创建或恢复可执行任务后，DeepSearch 会通过 browser bridge 真正选中/创建页面，抓取页面 snapshot 与 screenshot，并把摘录和本地截图路径回写到任务详情。
  - 成果：`08` 已补上第一版站点级共享登录探测；当前 DeepSearch 会通过 browser bridge 读取内置浏览器共享 cookie，对预置站点执行 auth cookie 检查，把结果写入站点状态，并在 run 执行前真实决定是否进入 `waiting_login` 或继续执行；正式页站点卡片也已新增“检查登录态”按钮，可直接验收探测结果。
  - 成果：`08` 已补上第一版登录恢复动作；当前站点卡片和 `waiting_login` 详情都可直接打开站点登录页、重新检查登录态，并且 takeover 模式在恢复执行前会尝试重新绑定当前活动页，不再只停留在“提示用户自己处理”的文案层。
  - 成果：`08` 已补上第一版结果主链结构化持久化；当前运行结果会正式落到 `deepsearch_records / deepsearch_artifacts`，并新增 artifact 读取 API 与详情页记录/正文/截图查看，不再只靠 detail markdown 塞摘录和文件路径。
  - 成果：`08` 已补上第一版聊天 tool facade；当前通过 Lumos 内置 `deepsearch` MCP facade，把 `start / get_result / pause / resume / cancel` 统一接到同一 DeepSearch service，聊天侧也会注入当前会话 `sessionId` 并在相关诉求下优先提示模型调用该高层能力；同时 `扩展 > DeepSearch` 已支持 `runId` 深链，聊天结果可以直接落到对应 run 详情验收。
  - 成果：`08` 已补上第一版站点 adapter runtime，并优先接入 `zhihu`；当前对于知乎页面，运行时会优先区分问题详情页、文章详情页和列表页，尝试展开“阅读全文”，抽取问题/回答或文章正文，写回更接近真实页面结构的 `contentState / snippet / structured_json`，同时保留失败时回退到通用正文抓取的兜底。
  - 成果：`08` 已继续把知乎搜索结果页推进到“同一 run 自动跟进详情页”；当前当 seed 页被识别为知乎 `list_page` 时，会自动挑选最多 3 个详情 URL 创建托管页并继续抓取，其中已补上 `zhuanlan.zhihu.com/p/...` 专栏正文地址的正式支持；相关站点路由规则已补单测，最新整包 `Next build` 也再次通过。
  - 成果：`08` 已继续补到正式 UI 可验层；当前 `扩展 > DeepSearch` 的任务详情里，绑定页面与抓取记录已改为按同一页面链路联动展示，用户可以直接看到哪一页是搜索页、哪几页是自动跟进的详情页，以及每个绑定页下面实际产出的正文/截图/结构化快照，不再需要在“绑定页面”和“抓取记录”两块之间手工对照。
  - 成果：`08` 已把 `waiting_login` 的恢复编排从页面脚本下沉到独立 service / API；当前正式页后台自动恢复不再自己串联“逐站点 recheck + 逐任务 resume”，而是统一走服务端 `探测 -> 判定 -> 恢复 -> 回写 runs/sites`；同时抓取历史卡片也已补上每个任务的状态说明，用户不打开详情也能直接看到当前卡点。
  - 成果：`08` 已补上第二条认证源主链；当前除直接复用内置浏览器共享登录态外，用户在站点配置里提供的 cookie 也会被解析并尽力导入到内置浏览器，再进入统一登录探测与恢复流程，不再只是数据库里的备注字段。
  - 成果：`08` 已继续补上第一版“显式页面验证”校验；当前在保存站点 cookie 或手动点击“检查登录态”时，系统除看 cookie 命中外，还会对部分站点打开验证页做一次真实页面级判断，用于识别“cookie 长得像已登录、但页面仍落到登录态”的假阳性；同时这类站点在后台 cookie-only 轮询下也不会立刻被重新放行为 `connected`，直到下一次显式校验通过。
  - 成果：已收口 DeepSearch 登录态链路里的三处关键回归风险：后台 `waiting_login` 恢复轮询不再反复重导用户保存的 cookie 以免覆盖浏览器里更新后的真实登录态；“站点 ready” 现已只认 live probe 的 `connected`，不再把手工 `cookieStatus=valid` 误当成可运行；同时内部 `PAGE_VALIDATION_BLOCKED` 哨兵也已从正式 UI 文案中隐藏，保存站点配置只做轻量 cookie 探测，抢焦点的页面级验证收敛到显式“检查登录态”动作。
  - 成果：`08` 已继续收口一轮正式 UI 与浏览器接线缺陷；当前 `扩展 > DeepSearch` 页面已重排为“站点接入 / 抓取发起 / 历史与详情”的分区结构，不再把站点、任务和结果硬堆在同一长列；同时 browser bridge 现已把真实异常信息回传给 DeepSearch，且“打开登录页”链路里非关键的页面稳定/CDP 检查失败不再直接把整次打开动作打成 `INTERNAL_ERROR`；另外手动 `resume` 与聊天 tool `resume` 也已默认停止重导旧 cookie，避免用户刚完成共享登录后又被过期配置覆盖，而 takeover 模式在当前活动页已切到无关站点时也会主动清空旧绑定，回到“等待可接管页面”而不是带着错误页面继续执行。
  - 成果：`08` 已补上聊天触发 DeepSearch 时的非打扰后台浏览器约束；当前托管页、站点隐藏页、显式页面校验页和由后台自动化页触发的新页 / 弹窗都会继承后台属性，不再通过 `content-browser:open-url-in-tab` 打开右侧浏览器面板，也不会作为用户可见页签持久化；同时聊天流不再在收到 `chrome-devtools` 工具调用时自动展开右侧面板，普通聊天、桥接会话与 StageWorker 加载 browser MCP 时也会默认注入后台模式，减少模型误用原始浏览器工具访问知乎/微信公众号时抢占用户界面的风险；只有用户显式点击“打开登录页”这类登录操作才保留前台打开行为。
  - 成果：`08` 已开始从“浏览器型反爬站点”向“免登录公开资料源”扩展；当前已新增 `中文维基文库` 站点 adapter 原型，并接入默认站点清单、免登录判定与聊天侧站点别名，DeepSearch 现可沿同一 adapter 执行链对中文维基文库执行搜索和机器可读正文提取，为后续图书/古籍型资料源接入建立第一条正式主线。
  - 成果：`08` 已继续补上第二条中文公开全文源主线；当前已新增 `Chinese Text Project` 站点 adapter 原型，并接入默认站点清单、免登录判定与聊天侧站点别名，DeepSearch 现可沿同一 adapter 执行链对 CTP 执行标题检索、`readlink -> gettext` 正文提取与保守 HTML 回退，为古籍/经史子集类资料搜索继续扩面。
  - 成果：`08` 已补上第一条英文公开图书主线；当前已新增 `Project Gutenberg` 站点 adapter 原型，并接入默认站点清单、免登录判定与聊天侧站点别名，DeepSearch 现可沿同一 adapter 执行链对 Gutenberg 执行官方 OPDS 书目搜索和官方 plain-text 全文提取，为英文公共领域图书搜索建立正式接线。
  - 成果：`08` 已补上第一条公开论文主线；当前已新增 `Europe PMC` 站点 adapter 原型，并接入默认站点清单、免登录判定与聊天侧站点别名，DeepSearch 现可沿同一 adapter 执行链对 Europe PMC 执行官方论文搜索、开放全文 XML 提取与摘要兜底，为生命科学论文搜索建立正式接线。
  - 成果：`08` 已继续补上高质量结构化论文全文主线；当前已新增 `PMC BioC` 站点 adapter 原型，并接入默认站点清单、免登录判定与聊天侧站点别名，DeepSearch 现可沿同一 adapter 执行链对 PMC BioC 执行开放获取论文搜索与结构化全文 JSON 提取，为高质量医学/生命科学全文研究继续扩面。
  - 待完成：补齐更强的自动登录完成检测与自动回收、执行期更细粒度页面控制、更强的完整正文抽取，以及 Workflow capability facade 的正式实现。
- 阶段 5：浏览器 Provider / 指纹浏览器接入
  - 成果：已新增 `docs/browser-provider-design.md`，明确浏览器接入不是第三方 MCP/plugin，而是 Lumos 内置的本地 Browser Context 能力；核心目标是让 chat / Workflow / Agent 浏览器工具绑定到明确浏览器身份，且不复制用户在指纹浏览器里的 cookie、登录态、指纹或代理资产。
  - 成果：已开始落地第一段基础架构：新增 `BrowserProvider / BrowserAutomationSession` 两层抽象，先把现有内置浏览器包装为 `embedded:default` 默认上下文；browser bridge、chrome-devtools MCP、共享 browser runtime client 和 workflow `ctx.browser` 已开始支持 `browserContextId` 透传，旧路径默认仍回到内置浏览器。
  - 成果：已补上第一版 `ExternalCDPProvider` 兜底能力；当本地配置 `LUMOS_EXTERNAL_CDP_ENDPOINT` 或 `LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT` 指向 Chromium DevTools HTTP / browser websocket endpoint 时，bridge 可通过 `external-cdp:default` 上下文对外部 Chromium 执行最小 tab / navigate / snapshot / evaluate / screenshot 自动化。当前仍是环境变量 POC，不是正式设置页接入。
  - 成果：已补上第一版 `AdsPowerProvider` 单 profile POC；当本地配置 `LUMOS_ADSPOWER_USER_ID` 或 `LUMOS_ADSPOWER_PROFILE_ID` 时，会通过 AdsPower Local API 启动对应 profile，并复用返回的 `data.ws.puppeteer` CDP endpoint 暴露为 `adspower:<profileId>` 浏览器上下文。当前仍是环境变量 POC，不是正式设置页接入。
  - 成果：已按设计约束把 DeepSearch 的 browser bridge 调用显式固定到 `embedded:default`，避免环境变量 POC 或后续用户选择第三方 profile 时把 DeepSearch 的公开内容抓取链路误路由到店铺账号浏览器。
  - 成果：已新增本地持久化第一版：`browser_provider_configs` / `browser_profile_aliases` 两张表、`chat_sessions.browser_context_id` 字段，以及由 Next 设置 API 写出的 `~/.lumos/runtime/browser-providers.json`；Electron `BrowserProviderRegistry` 会读取该运行时配置并在签名变化时热加载，避免只停留在环境变量 POC。
  - 成果：已新增正式 `设置 > 浏览器` / `/settings/browsers` 第一版页面；用户可在产品界面看到内置浏览器，添加 / 编辑 / 删除 `AdsPower` 或 `通用 CDP` 接入，填写 Local API / profile_id / CDP endpoint / API Key / 备注，并点击“测试”看到连接状态和发现的 profile / page 摘要；当前添加 / 编辑 AdsPower 时也可先通过 Local API 发现 profile 列表，支持单个绑定到当前配置或批量导入为多条浏览器配置，减少手抄 `user_id` 的出错风险；第三方浏览器列表和发现到的 Profile 列表也已支持按名称 / 别名 / Profile ID / Context / 分组搜索，并可按 Provider / 启用状态 / AI 操作中 / AdsPower 分组筛选；批量导入和单个绑定会把 AdsPower 分组 / 序号写入备注。
  - 成果：已补 AdsPower 多 Profile 分组视图与手动同步第一版；`设置 > 浏览器` 会按 AdsPower 分组展示第三方浏览器卡片，并提供“同步 AdsPower”按钮，从本机 Local API 分页拉取最多 500 个 Profile，先展示新增 / 更新 / 不变 / 跳过的同步预览，用户确认后才会自动创建缺失配置、刷新已存在配置的 profile 名称 / 分组 / 序号，同时保留用户自定义显示名和人工备注。
  - 成果：chat 顶部已新增浏览器上下文选择器；用户可在会话标题旁看到当前使用的浏览器上下文，手动切换到已配置的第三方 context，切换会持久化到当前会话并在后续聊天浏览器工具调用中注入 `x-lumos-browser-context-id`，服务端也会用会话字段兜底。
  - 成果：工作流任务已新增浏览器选择第一版；用户在新建 / 编辑任务时可选择内置浏览器或已配置的 AdsPower / CDP context，任务列表和任务详情会显示本任务使用的浏览器，执行时会把同一个 `browserContextId` 写入工作流 session、`__lumosRuntime`、代码节点 `ctx.browser` 和 StageWorker 的 `chrome_devtools` MCP 环境。
  - 成果：已修正工作流浏览器绑定的几个验收断点：任务创建 / 编辑会在服务端校验所选浏览器是否存在且启用；“立即运行”接口不再接受隐藏 `browserContextId` 覆盖，避免实际执行和任务 UI 不一致；每条执行记录会保存当次实际浏览器快照；任务列表、任务详情、执行历史和执行详情页会显示配置名称（例如 `AdsPower · 浏览器1`），不再只显示 `adspower:<profileId>`。
  - 成果：chat route 已补第一版 profile 名精确匹配；当用户在消息里明确说出已配置的浏览器显示名 / Profile 显示名 / profile_id，例如“浏览器1”，服务端会自动把当前会话切到对应 browser context；显式浏览器操作请求会隔离到 `chrome_devtools` MCP，禁用 `Bash` / `Task` / WebFetch / WebSearch / 常规文件工具，并强制开启新的 Claude SDK 会话，避免模型退回系统默认 Chrome 或复用没有浏览器工具的旧会话。
  - 成果：已修正聊天前端旧请求头覆盖服务端匹配结果的问题；此前用户说“打开浏览器1，访问知乎”时，服务端会话已是 `adspower:k1c1fbjj`，但 MCP env 仍优先使用旧的 `x-lumos-browser-context-id: embedded:default`，导致真实工具结果落到内置浏览器。当前显式 profile 匹配优先，且 MCP env 注入优先使用服务端解析后的 `browserContextId`。
  - 成果：已用当前本机 AdsPower 配置验证 `浏览器1` 的 bridge / MCP 直连链路：`adspower:k1c1fbjj` 可以通过 Lumos browser bridge 和 `chrome_devtools` MCP 列出页面，并成功在该 profile 中打开 `https://www.baidu.com/` 与 `https://www.zhihu.com/`。这证明 provider / bridge / MCP 层在当前机器上可用，但还需要用户从聊天 UI 重新发起一次确认 LLM 主链不再走系统 Chrome 兜底。
  - 成果：已定位聊天 UI 里“chrome-devtools 工具不可用”的两处真实原因：Claude SDK 实际可调用的 MCP 工具名不能使用 `mcp__chrome-devtools__...` 这种连字符形式；同时 `chrome_devtools` MCP 进程曾依赖未安装的 `@modelcontextprotocol/sdk`，导致进程启动即退出。当前已把 SDK 注册名映射为 `chrome_devtools`，把聊天 / 工作流代理生成提示改为 `mcp__chrome_devtools__...`，并把 `chrome_devtools` MCP 改成项目内轻量 stdio JSON-RPC 实现。按用户要求，显式浏览器操作请求也会跳过 DeepSearch MCP，避免浏览器失败后绕路到 DeepSearch。
  - 成果：已修正多浏览器上下文下的站点页缓存串用风险；bridge `/v1/site-pages/*` 的持久页缓存现在按 `browserContextId + domain` 隔离，避免内置浏览器和 AdsPower / CDP 访问同一站点时复用错误 `pageId`。
  - 成果：已补浏览器配置生命周期第一版防护；启用配置时会校验 AdsPower profile_id 或 CDP endpoint，聊天会话切换和工作流执行前会复用同一校验，删除、停用或修改会改变 context 的 profile_id 时也会先检查是否仍有聊天会话或工作流任务引用，避免 UI 仍指向已失效浏览器。
  - 成果：已补 Profile 别名第一版；`设置 > 浏览器` 可维护别名，chat route 自动匹配浏览器时会同时检查显示名、Profile 显示名、profile_id 和别名。
  - 成果：已补 AdsPower context 唯一性防护；同一个 `profile_id` 不允许重复创建成多个 `adspower:<profileId>` 配置，批量导入时会自动跳过已存在的 profile。
  - 成果：已补引用提示第一版；`设置 > 浏览器` 的浏览器卡片会展示当前被聊天会话 / 工作流任务引用的数量，删除、停用或改 profile_id 被阻止时也会返回同一类引用信息。该能力只是引用防护和可见提示，还不是运行态占用锁。
  - 成果：已补运行态占用锁第一版；browser bridge 会对非内置浏览器上下文的写操作按 session / workflow owner 做内存租约，同一 owner 可连续续租，其他 owner 在租约未过期时会先做最长 10 秒短等待，若期间对方释放则自动接续，仍未释放时返回 `BROWSER_CONTEXT_IN_USE`、`waitedMs` 和 `retryAfterMs`，且 `chrome_devtools` MCP 会把 bridge 返回的中文冲突说明一并暴露；`设置 > 浏览器` 也已能读取运行态占用状态并提供“释放占用”按钮，用于用户手动接回或清理卡住的租约，页面会定时刷新占用状态。该能力还没有完整 FIFO 排队、冲突弹窗和任务内接手确认，因此不能算完整占用协调。
  - 成果：已补运行态占用冲突 UI 第一版；聊天页能识别 `BROWSER_CONTEXT_IN_USE` 工具错误并显示“浏览器正在被占用”横幅，提供释放占用、释放并重试、切回内置浏览器；工作流执行详情页也能在占用失败时显示同类提示并提供释放占用 / 返回任务详情入口。该能力仍不是完整排队系统。
  - 待完成：完整 FIFO 等待队列 / 更完整的任务内接手确认、AdsPower 自动周期同步 / 大账号分页实机验收、外部浏览器实机验收、跨平台打包验收仍未完成；当前第三方指纹浏览器接入主链已打通，但还不能按完整实现标准关闭全部缺口。

## 当前状态进度

- `主 Agent / Lumos 管家`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：已确认主 Agent 需要作为 Lumos 的用户侧“管家”，优先获得全局只读查看能力，而不是先做复杂审批、回滚或治理。本轮已新增内置 `lumos-butler` 只读工具，并只注入主 Agent 会话；当前可读取服务商、MCP、Skill、能力包、Workflow、会话、知识库、DeepSearch、IM、浏览器和运行时资源的全局状态摘要，生成面向小白用户的问题诊断；也可搜索历史会话 / 消息 / 任务 / Workflow / DeepSearch / 能力记录，并查看任意会话的最近消息和关联任务。最新只读 Workflow 查询已补到 `list_workflow_tasks / get_workflow_task / list_workflow_runs / get_workflow_run / list_active_workflow_agents`，可以看到任务管理任务、计划任务、执行记录、步骤摘要和当前进程内运行中 Agent，并给出可点击的 Workflow 详情入口；运行中 Agent 的跳转会优先反查真实执行记录或任务详情，避免把底层 engine run id 误当成页面 schedule id。当前保留 `/main-agent/butler` 只读总览页，可查看全局健康摘要、关键数量、问题提示、运行资源、最近记录、浏览器概览和可跳转入口；主 Agent 聊天页顶部“Lumos 管家状态”条已按最新要求移除。工具输出会对服务商密钥等敏感字段做脱敏，主 Agent 系统提示也明确当前阶段不能声称已执行删除、覆盖、支付、发 IM、敏感导出或批量治理动作。
  - UI 可验收范围：用户进入 `主 Agent` 聊天页不再看到顶部“Lumos 管家状态”面板；`/main-agent/butler` 总览页当前可查看问题诊断、运行资源、最近会话、最近 Workflow、DeepSearch、能力、浏览器状态，也可按全部 / 会话 / 消息 / 任务 / Workflow / DeepSearch / 能力搜索历史记录并跳转到对应页面。用户也可以继续在对话里直接问“帮我看看 Lumos 当前哪里有问题”“有哪些工作流任务”“哪个工作流还在跑”“刚才那个任务为什么失败”“哪个 Agent 卡住了”“找一下上次那个 PDF / 任务 / 会话”“某个能力或 MCP 是否可用”“打开某个历史会话的摘要”等，主 Agent 应先调用管家工具，再用页面、按钮、状态和下一步动作解释结果。
  - 当前缺口：还未提供低风险一键修复动作；删除 / 覆盖 / 发 IM / 支付 / 敏感导出 / 批量操作 / 审批 / 回滚 / 治理仍未进入自动执行范围；当前 Workflow 查询仍是只读诊断，不包含聊天侧停止 / 重跑 / 删除等控制动作；全局状态摘要还可以继续补更细的资源校验、运行态占用、计费健康和跨平台打包诊断，因此不能按“完整实现”标准验收。
- `AI 对话 / 默认服务商、默认模型和知识库记忆`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：本轮已把 AI 对话的服务商 / 模型选择收敛为“会话已绑定优先，其次用户上次选择，其次 Lumos 后台默认，其次可见服务商第一项”；云端 system 服务商同步现在只在本地默认缺失或指向已删除服务商时兜底，不再覆盖用户已经在桌面端选择的 system 服务商。AI 对话模型选择也已新增用户默认记忆，用户没选过时才使用 Lumos 后台默认模型或服务商默认模型；当 Pro 用户禁止自定义 AI 服务商时，对话和设置页都会隐藏 custom provider，并在已选 provider 不可见时回到可见 system provider；最新又补掉了一个残留状态问题：锁定自定义服务商后清理不可见 provider 时，会一并清理旧版 `lumos:last-model / codepilot:last-model`，避免刷新后旧模型继续覆盖后台默认模型。当前会话的知识库开关、标签和检索参数已落到 `chat_sessions` 并在发送和切换时保存；首次启动语言默认值已从英文改为中文；`服务 > 知识库` 里的 DeepSearch 自动归档默认值也已改为“自动保存”。
  - UI 可验收范围：用户进入 AI 对话后选择一个 system 服务商和模型，切走再回来或重新进入对话时应继续使用用户选择，而不是过一会儿回到 Lumos 后台默认；新用户未选择过时仍会使用后台默认服务商 / 模型。禁止自定义 AI 服务商的账号进入对话时只应看到 system 服务商，旧 custom 选择会自动让位给 system。用户在某个 AI 对话里打开知识库、选择标签或调整检索参数后，下次进入同一对话应保持原设置。首次没有保存语言偏好的安装应直接显示中文。进入 `服务 > 知识库` 时，DeepSearch 自动归档默认应选中“自动保存”。
  - 当前缺口：相关选择规则单测、ESLint、类型检查和完整 `next build` 已通过。尚未在打包 Electron 里完成一轮人工点击验收；因此只能说这五个 bug / 优化的代码主链已收口，不能扩大为 AI 对话、知识库或 DeepSearch 模块的完整实现。
- `IM / 微信 Clawbot 语音交互`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`（代码主链和自动化验证已通过，缺真实手机微信 / 打包版验收）
  - 当前进展：微信入站语音现在分层处理：优先使用微信 `voice_item.text` 自带转写；没有转写时下载语音媒体，优先使用显式配置的 OpenAI-compatible ASR，其次尝试本机 Whisper，再尝试默认 OpenAI-compatible 服务商转写；仍无法转写时也会以“语音附件占位”进入 AI 对话，避免用户发语音后 Clawbot 静默无响应。微信命令新增 `/voice on|off|status` 和 `/语音 开启`，同时支持“开启语音模式 / 切回文本模式”这类被语音转写后的自然短句直接切换，按当前微信 peer 持久化语音回复模式。语音模式下，AI 回复会优先走本机 TTS 生成音频附件并由 Clawbot 发回；TTS 或发送失败时会自动回退文本。当前出站采用“音频文件附件”而不是微信原生语音气泡，因为现有 iLink bot 通道对原生 VOICE 出站不稳定，会有静默丢弃风险。
  - UI 可验收范围：用户在微信 Clawbot 对话里发送普通语音，Lumos 应识别后进入当前路由会话并回复；用户发送 `/voice on` 或直接说“开启语音模式”后，后续 AI 回复应优先以可播放音频附件出现；发送 `/voice off` 或说“切回文本模式”后回到文本回复；发送 `/voice status` 可查看当前模式。即使语音生成失败，用户也应收到文本回复而不是无响应。
  - 当前缺口：还没做真实手机微信 / Windows 或 macOS 打包版端到端验收；本机 Whisper CLI、系统 TTS、微信音频附件展示效果、长回复切分体验、多人/群聊 peer 级模式隔离都仍需实机确认；当前不能说“全语音交流”已完整产品化，只能说微信语音识别与语音回复模式的第一版主链已收口。
- `浏览器 Provider / 指纹浏览器接入`
  - 文档完整度：`基本完成`
  - 主链状态：`已打通`
  - 当前进展：已确认需求核心是“浏览器身份 / profile 上下文”而不是单纯增加一个 CDP 调用工具；当前已建立默认内置浏览器上下文和全链路 `browserContextId` 承载位，并补上 `external-cdp:default` Provider、`adspower:<profileId>` Provider、本地 provider 配置表、运行时配置文件同步、Electron registry 热加载、chat 会话级 `browser_context_id` 持久化和请求注入、工作流任务级 `browser_context_id` 持久化、服务端校验、执行记录快照与执行透传、第一版按已配置 profile 名 / 别名精确匹配自动切换、浏览器请求禁用非浏览器工具 / DeepSearch 兜底、强制新 SDK 会话、服务端解析 context 优先于旧 embedded 请求头、`chrome_devtools` SDK 工具名映射和轻量 stdio MCP 实现，以及站点页缓存按 browser context 隔离、配置生命周期引用防护、AdsPower Profile 发现 / 单个绑定 / 批量导入第一版、context 唯一性防护、设置页引用提示第一版、非内置浏览器运行态占用锁和短等待第一版、设置页“释放占用”第一版、聊天 / 工作流执行详情占用冲突提示第一版、设置页多浏览器 / 多 Profile 搜索筛选和 AdsPower 分组筛选第一版，以及 AdsPower 多 Profile 分组展示 / 手动同步预览第一版。当前用户已确认聊天和工作流都可以使用所选浏览器，浏览器 Provider 分支主链可以进入合并收口。
  - UI 可验收范围：用户现在可以在 `设置 > 浏览器` 或 `/settings/browsers` 看到内置浏览器、添加 / 编辑 / 删除 AdsPower 或通用 CDP 接入、维护 Profile 别名、点击“发现 Profile”从 AdsPower Local API 拉取 profile 并单个绑定或批量导入、点击“同步 AdsPower”预览本机 Profile 列表会新增 / 更新 / 不变的配置并确认应用、在浏览器列表和发现 Profile 列表里搜索/筛选（包括 AdsPower 分组筛选）、按 AdsPower 分组查看第三方浏览器卡片、点击“测试”查看连接结果，也能看到某个浏览器是否被聊天会话或工作流任务引用；当第三方浏览器正在被运行态租约占用时，设置页会显示“AI 操作中”，并提供“释放占用”按钮；也可以在聊天会话标题旁看到当前浏览器上下文并手动切换，或在消息里明确说“用 浏览器1 / 别名”触发服务端精确匹配自动切换；工作流新建 / 编辑任务弹窗现在也有“浏览器”下拉，任务列表、任务详情、执行历史和执行详情会显示本任务 / 本次执行实际使用的浏览器名称；如果聊天或工作流浏览器工具遇到占用冲突，系统会短等待并显示可操作提示，用户可释放占用或切回内置浏览器。
  - 当前缺口：完整 FIFO 等待队列 / 更完整任务内接手确认、AdsPower 自动周期同步 / 大账号分页实机验收、External CDP / AdsPower 更系统的实机验收、跨平台打包验证仍未完成，因此不能按“完整实现”标准宣称浏览器 Provider 全部完成。
- `03 调度层`
  - 文档完整度：`基本完成`
  - 主链状态：`已打通`
  - 当前进展：已落地“模型分析优先”的规划器，支持 simple / workflow 决策、受限多步 DSL 生成、受限并行浏览器计划生成，并把调度决策、重试诊断正式落库；现在除测试页外，也已进入正式 `Workflow` 页面；近期已补否定语义修正，减少 `不需要通知` 这类上下文导致的误判；正式页还新增了只读流程图，复杂依赖与并行路径可直接在产品界面查看；同时已修正中文标点场景下的多 URL 提取，三路及以上并行浏览器规划不再误拆成错误地址；现已新增“前置分析 + 并行浏览器 + 汇总结论”的混合复杂工作流启发式规划，并已通过一轮真实 UI 验收；最新已把调度代理角色、规划来源、模型、超时/重试、任务内角色分配，以及调度受理状态、触发条件、规划产物校验、原始规划步骤和回退记录收进正式任务详情页；另外主 Agent 聊天侧也已补上复杂请求到 Task Management 的强制下发与来源回写，并把会话任务标签放进聊天界面侧边，任务可按来源消息稳定回查和跳转详情；针对主 Agent 新建任务，启发式规划现已补实现 / 搜索 / 报告 / 导出诉求拆解，不再默认压成通用两步代理流；同时已补上“会话未显式选模型时优先回退到默认 provider/model 再尝试 LLM 规划”的入口，以及“调研 + 安全问题/方案 + 导出”类任务优先走“搜索取证 -> 汇总 -> 导出”流的启发式规则；按用户最新要求，调度正式主链现已改为“必须先经过 LLM 规划”，不再允许在 LLM 不可用、超时或 workflow 生成/校验/提交失败时静默回退到 heuristic 结果或 simple execution，失败会直接暴露并落库到任务错误与调度诊断中；另外已把 Anthropic 结构化规划切到更兼容网关的 Claude SDK 结构化输出路径，并补上 session 级 `provider / model / workingDirectory` 透传，减少“主对话能规划但 workflow planner 命中别的 provider API”的断链；同时继续保留 provider 状态码/响应体摘录诊断，减少仅显示 `Invalid JSON response` 的黑盒失败；最新对 Claude SDK 的超时异常也已做语义归一，并把默认 planner 超时放宽到 90 秒，减少把真实超时误显示成 `Claude Code process aborted by user`；此外，当 Claude SDK 未返回 `structured_output` 但正文里给出了纯 JSON 或单个 JSON code fence 时，规划器现已会先做严格 JSON 解析并再走 schema 校验，不再把这类结构化结果直接当成失败；而对于研究类任务里常见的 `detectedUrl: null` / `detectedUrls: []` 空值输出，schema 也已会自动归一化为缺省字段，不再把整个规划直接判错；现在 planner 还会把 step 级输入合同直接编码进结构化 schema 与 prompt 示例里，并在 DSL 校验失败后把具体错误回灌给下一轮重试，减少研究类任务连续生成 `browser.query` / `browser.prompt` 这类引擎不支持的节点输入；同时对“60 秒长报告综合”“read-only researcher 被要求写 temp 文件”“md-converter 依赖硬编码 temp 路径”这类语义错误，planner 也会先拒绝并要求 LLM 重新产出更符合当前运行时边界的 workflow；最新还已把 Claude SDK 与 AI SDK 共用的 provider-model 解析收敛到统一入口，正式调度诊断会同时记录请求模型与实际解析模型，减少“聊天能用、调度或工作流代理因模型别名/目录不一致而单独失败”的分叉黑盒。
  - 当前缺口：真实调度智能仍需继续增强；当前仍以受限结构化规划为主，且主产品中的更多上下游页面还未全部显示调度细节；聊天侧任务标签后的更完整产品交互仍可能继续收口；虽然现在已能把“未走模型规划”的原因写进调度诊断，并取消静默回退，但节点级更细的原始规划日志还未全部产品化
- `04 流程编译层`
  - 文档完整度：`基本完成`
  - 主链状态：`已打通`
  - 当前进展：已修正 `steps.<stepId>.output.*` 的编译期引用解析错误，避免多步 agent workflow 中下游步骤读取到空值；同时当 DSL 未显式声明 `policy.timeoutMs` 时，编译产物现在会为 `agent / notification / capability / wait` 生成默认超时并写入 manifest，且编译后的 workflow module 也会显式解构 `notificationStep / capabilityStep / waitStep`，不再只解构 `agentStep`
  - 当前缺口：仍有最终形态与运行时覆盖范围上的收口工作
- `05 流程执行层`
  - 文档完整度：`基本完成`
  - 主链状态：`已打通`
  - 当前进展：正式工作流页已开始展示真实执行输出和实际执行步骤，不再只展示 DSL 规划视角；同时已补 OpenWorkflow sqlite backend 的 Next 外部包配置以降低开发环境兼容风险；workflow agent step 现已默认收紧为文本结果交付，避免因声明不存在的 artifact 而导致执行伪失败；文本型 stage 还具备结构化输出失败后的纯文本兜底，降低真实执行时因 JSON schema 收敛失败造成的主链中断；任务完成后写回主 Agent 对话的结果消息也已改为稳定直写，可保留浏览器截图的真实绝对路径并在聊天区直接预览；并行浏览器分支现已为每个分支创建独立页面并把 pageId 显式传递到后续截图步骤，减少复杂工作流中的串页风险；workflow agent step 现已支持受控 context 依赖输入，汇总代理可以读取并行分支结果做真实汇总；当汇总代理与最终通知正文相同，任务完成系统通知也已收敛为简短提示，避免在对话里第三次重复整份长报告；正式页现在还能展示 workflow 投影返回的真实运行态，包括运行中/跳过步骤、失败原因和关键步骤结果；浏览器步骤还已支持截图直出预览和产物打开入口；混合复杂工作流执行主链已完成一轮真实 UI 验收；最新 simple execution 与 workflow agent step 已补运行时超时透传，同时浏览器搜索步骤还能把页面摘录传给后续汇总代理使用；此外，编译产物与执行提交层也已补上任务级 runtime 元数据注入，workflow step 现在可稳定拿到来源 task/session 的 `taskId / sessionId / requestedModel / workingDirectory`；browser bridge 代码模式运行时还已补上 `waitFor` 传输超时透传、短等待自动抬底与同实例 `pageId` 粘连，减少登录页/收藏页这类慢页面场景下被 `10000 / 15000 / 30000ms` 的客户端等待或多标签页错页共同放大失败概率；同时 `/v1/pages/navigate`、新建页、快照、截图这些桥接请求也已补接口级更长默认传输超时；workflow `code-only` 浏览器步骤现在还会在失败时自动保存页面快照、失败截图与调试日志，并把这些调试产物通过正式 `Workflow` 详情页暴露出来，减少浏览器代码节点的黑盒排障；最新这条 `code-only` 浏览器链路也已默认改成后台执行，运行中的页面操作不再主动切前台浏览器标签页，只在手动调试入口保留前台行为；workflow outer timeout 也已改为按 manifest step timeout 求和并追加缓冲，`notification / capability / wait` step 的真实 runtime binding 也已补齐；另外 `chrome-devtools` MCP 在多标签页场景下已改为要求显式 `pageId`，且 `list_pages` 结果会附带活动页和相似页签警告，纯 Agent 浏览器路径的串页风险也开始收口；最新正式任务关闭 / 删除 / 执行记录停止已能向底层 workflow cancel 收口，并会同步执行历史和投影状态为已取消，避免删除 UI 记录后底层执行继续残留；本轮还补上执行记录节点级重跑第一版，用户可从失败节点或选中节点新建重跑执行记录，并复用原执行里目标节点上游已完成输出；最新又补齐节点重跑新执行记录的可见状态与产物收口：新记录会预先写入复用上游节点的步骤状态摘要，缓存命中的上游节点生命周期回调不会再把这些旧状态覆盖成新的运行耗时，且上游节点 `output/` 产物会复制到新 workflowRun 工作区，产物复制失败只记录警告、不再把已经启动的新执行错标失败；现在还进一步收紧了节点重跑的复用校验：复用缓存只认每个节点最新终态，避免复用旧成功 attempt；创建新执行记录前会检查原记录里上游已成功的可执行节点是否都有可复用输出，缺失时直接提示并不创建新执行记录，避免用户本想只重跑最后节点却实际从头跑。
  - UI 可验收范围：用户进入 `Workflow > 任务详情 > 执行记录`，失败记录顶部会出现“从失败节点重跑”；在“工作流结构”图里点选某个实际执行节点后，顶部会出现“从此节点重跑”。点击后会跳转到新执行记录，旧执行记录保留不变；新记录会从所选节点及其下游继续跑，上游已完成节点会在新记录里保留成功状态/摘要，并且“结果文件”里应能看到复用上游节点原有产物。
  - 当前缺口：浏览器与通知能力仍有工程化收尾项，尚未按“完整实现”关闭；节点级重跑目前是第一版主链，流程控制节点暂不支持直接作为重跑起点，复杂分支的差异预览、重跑前参数修改、复用/重跑节点的 UI 明示和更多真实失败样本验收仍需继续完成；工作流引擎在真实 UI 开发环境中的重新验证仍需继续完成；本轮已通过节点重跑单测、相关 ESLint、类型检查、差异空白检查和完整 `next build`
- `06 执行代理层`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：底层 agent abort 已打通，simple execution 与 workflow cancel 都会向活动中的 agent 执行传播中断信号；正式工作流角色配置 UI 已接入 Scheduling / Workflow SubAgent 的真实配置源，且现在除团队设置页外，已新增独立的 `Workflow Roles` 正式入口，并按“执行角色 / 规划角色”分组，减少与旧团队预设混淆；正式 `Workflow` 页面也已能显示任务计划引用到的角色快照、实际输出、实际执行步骤，以及运行态详情（当前动作、运行中步骤、已跳过步骤、失败或取消原因）；最新又补进了“当前运行角色”“任务内角色分配”以及会话/资源视图，用户现在可直接在正式任务详情看到代理会话、任务/规划/执行记忆槽、隔离工作目录、输出目录、请求模型、耗时与 Token/API 调用；正式 `Workflow Roles` 页面也已新增活跃代理会话面板，可直接查看当前会话生命周期状态并发起单代理中断；另外 workflow subagent 与 StageWorker 已改为优先继承任务 session 的 provider/model/workspace，不再默认回落到全局 active provider 或 `process.cwd()`；最新执行代理链也已补上统一的 provider-aware 模型解析与失败诊断，`requestedModel` 和实际 `resolvedModel` 会随运行时收口，减少 Claude 风格别名与 gateway 实际模型 ID 不一致时的黑盒失败；正式执行记录页现已提供“停止执行”，关闭或删除任务也会先中断运行中的 workflow / agent 链路，并对已丢失 run history 但仍 running 的执行投影做兜底取消
  - 当前缺口：完整代理生命周期与更强的长期资源治理仍未全部落地；虽然正式页面已能验收活跃会话、核心会话隔离、资源边界与单代理中断，但更长期的会话续跑、自动回收、限额治理还未全部产品化可验
- `07 动态能力扩展`
  - 文档完整度：`基本完成`
  - 主链状态：`已打通`
  - 当前进展：已新增独立架构文档，明确“动态新增系统能力”不并入 `03 ~ 06`，而是作为横切能力单独定义；最新已按用户要求把产品目标进一步收敛为“尽量复用现有聊天式新增页，不引入复杂草稿流，AI 先确认需求，再直接生成两类待发布能力：`代码节点` 与 `Prompt 节点`，最后由用户发布”；同时文档已进一步明确 Phase 1 的最小改 UI 实施方案：保留当前能力列表页、聊天式新增页和详情页，只调整行为为“对话确认 -> 生成待发布能力 -> 发布 -> 正式可用”；当前产品侧已实现这条第一段主链：`Prompt 节点` 在任务明确提到能力 ID / 名称时，会进入 workflow agent step 的 `tools`；`代码节点` 在任务明确提到能力 ID / 名称并提供结构化 JSON 参数时，会进入真实 `capability` 步骤执行；历史遗留的本地能力文件也已开始进入当前发现范围；正式 `Workflow` 详情页也已开始展示“系统能力节点”和对应能力 ID；此外，报告/正文导出 PDF 场景现在已能在检测到可用格式转换能力时自动追加能力步骤，不再一律停在“需求已记录”的占位结果；最新又已补上正文类 workflow agent step 的纯文本交付模式、Claude SDK `result.result` 文本读取，以及 `md-converter` 在缺少 `pdflatex` 时回退到本机 `weasyprint` 生成 PDF；“给我一份 Claude 使用技巧报告，并导出 PDF” 这条真实任务现已完成一轮端到端验收并产出实际 PDF 文件；本轮还针对 `能力生成器` 的安装使用体验补了第一轮 P0 收口：同名 Skill / MCP 自动覆盖更新，分享包导入默认覆盖，导出 / 导入 / 生成安装计划会使用 `[DATA_DIR] / [PYTHON_PATH] / [RUNTIME_PATH] / ${USER_HOME}` 等可迁移占位符，MCP 运行时会解析这些占位符，生成 Python MCP 模板与内置 JS MCP 会按 `inputSchema` 对字符串化参数做基础类型兜底，生成器安装 stdio MCP 后会做启动自检并在 UI 显示“已安装 / 已更新 / 自检失败”等可理解状态；正式 `能力 > MCP 服务器` 页也已新增“检测服务器 / 检测全部”手动健康检查入口，手动保存或同名覆盖后会自动执行基础启动检测，并能把失败原因直接显示在 MCP 卡片上；检测结果已持久化，刷新页面后仍保留上次检测状态、检测时间、失败原因和发现的工具数量，生成器安装后的自检结果也会同步进入 MCP 管理页；最新 MCP 配置已支持运行方式和运行时声明，用户能在表单里选择“按需启动 / 长连接声明”和 `auto / Node / Python / Bun / 自定义`，列表页也会直接展示对应徽标，导入导出与能力生成器计划会保留这些声明；远程 HTTP / SSE MCP 检测已升级为第一版协议级检查，会执行初始化与工具列表读取，减少“URL 能访问但不是可用 MCP”的假成功。
  - 当前缺口：`07` 仍未完整打通；当前可验收的是 UI 里的“对话确认 / 生成 / 发布”、两类能力的显式任务引用、报告到 PDF 的一条自动导出主链，以及能力生成器的一键安装/更新、路径迁移占位符、stdio MCP 基础自检、MCP 管理页手动健康检查、健康状态持久化、运行方式/运行时声明和第一版远程 MCP 协议检测。更通用的自动发现、自然语言参数提取、审批、回滚、配额/沙箱治理、`keep_alive` MCP 后台守护与崩溃自动重启、Bun 运行时托管或自动安装、受保护远程 MCP 的登录授权引导、更完整 MCP 状态面板和更完整运行态可视化仍未完成，因此还不能按“完整实现”标准验收
- `08 DeepSearch 独立模块`
  - 文档完整度：`基本完成`
  - 主链状态：`未打通`
  - 当前进展：已确认 DeepSearch 需要先作为独立模块建设，而不是先耦合进 Workflow；产品入口已收敛为左侧侧边栏 `扩展` 内的 `DeepSearch` tab，而不是单独一级路由；文档已明确 Phase 1 必须先补站点登录态检查、登录引导、登录后恢复执行、历史抓取记录、详细内容查看，以及面向聊天 / Workflow 的高层服务复用边界；同时也已明确核心形态应为内置模块 / service，外部独立 MCP 仍不是第一产品落点；另外针对 `bb-browser` 是否应直接接入的问题，也已补完单独评估文档，结论已进一步收敛为“保留 Lumos 内置浏览器为唯一正式运行时，在内部实现 `bb-site compatibility runtime`，只吸收 `site adapter / session fetch / compact snapshot / network capture` 等能力模型，并优先支持经过审查的 Tier 1 / Tier 2 adapter”；最新又已补上“部署与本地使用形态”“Phase 1 实现拆解”“UI 与交互设计”“数据与 API 设计”“工程落地拆解”五份子文档，把“内置在 Lumos、本地通过 Lumos 实例直接使用、先做 run/artifact/UI/登录态主链、后再扩外部 facade、正式页如何交互、service/tool 数据合同如何对齐、当前仓库里具体该改哪些文件”进一步写实；同时已把“正式接管当前活动页”“`strict / best_effort` 分离”“非严格模式以 `partial` 收口”“统一 run 状态和 resume 语义”“Workflow 正式复用进入 Phase 2”这些之前分散的结论写回主文档和补充文档，避免 08 内部继续口径分裂；在代码侧，当前已落地 `扩展 > DeepSearch` 正式页签、站点登录态配置弹窗、DeepSearch 本地 SQLite 表、DeepSearch runs API、抓取历史列表、详情页和暂停/继续/取消的本地状态控制；同时也已补上共享 browser bridge client、DeepSearch service 和“当前活动页接管预览”API/UI；随后又把 takeover run 的“活动页锁定”正式落到 `run page` 持久化模型中，创建任务时会尝试捕获当前活动页并在详情页展示具体绑定信息；之后创建或恢复可执行任务后，还会真正通过内置浏览器执行通用页面接管 / 托管页创建、抓取页面摘录和截图，并把结果写回任务详情；随后又补上共享 cookie 级站点探测与正式 `waiting_login` 收口；再进一步补上了站点级“打开登录页”、`waiting_login` 恢复引导，以及 takeover 模式恢复前的当前活动页重新绑定；随后已把执行结果正式落到 `records / artifacts`，并在详情页提供记录摘要、正文 artifact、截图 artifact 和截图预览；之后继续补上第一版聊天高层 facade，内置 `deepsearch` MCP server 已进入内置 MCP 列表并默认启用，聊天系统提示会在相关诉求下优先调用 `start / get_result / pause / resume / cancel`，tool 结果直接复用 run/artifact 读模型，并提供跳转 `扩展 > DeepSearch` 的 `runId` 深链；最新又补上第一版 `zhihu` 站点 adapter runtime，当前知乎问题页、文章页和列表页会优先走站点级提取逻辑，尝试展开正文并生成更贴近真实页面结构的 `contentState / snippet / structured_json`，同时保留通用抓取兜底；再进一步，当 seed 页被识别为知乎搜索结果页时，同一 run 里还会自动挑选最多 3 个详情页继续抓取，且现在已正式覆盖 `zhuanlan.zhihu.com/p/...` 专栏正文地址，同时托管搜索页角色也已显式收敛为 `search`；相关站点路由单测已通过，最新整包 `Next build` 也再次通过；而在正式 UI 上，任务详情现已按绑定页面链路联动展示关联记录，用户可以直接看出搜索页、自动跟进详情页及其各自产物，同时运行中的任务也会自动轮询刷新；此外，`waiting_login` 的自动恢复编排现已下沉到独立 DeepSearch service / API，前端不再自己串联逐站点 recheck 与逐任务 resume，而是统一走服务端 `探测 -> 判定 -> 恢复 -> 回写`，抓取历史列表也已补上每个任务的状态说明；现在第二条认证源也已打通，用户提供的 cookie 会被解析并尽力导入到内置浏览器，再进入与共享登录态一致的登录探测链；同时页面级验证语义已进一步收敛：保存 cookie 现在只做轻量 cookie 探测，真正会打开验证页的动作只保留在显式“检查登录态”，后台 `waiting_login` 恢复也不再重复重导用户保存的 cookie，从而避免覆盖浏览器里更新后的真实登录态；另外正式 UI 和 tool 的“站点 ready” 现已只认 live probe 的 `connected`，不再把手工 `cookieStatus=valid` 误当成可运行，同时内部 `PAGE_VALIDATION_BLOCKED` 哨兵也不再直接展示给用户；最新又已把正式页重排成“站点接入 / 抓取发起 / 历史与详情”的分区结构，站点卡片、当前站点详情、操作入口和运行结果不再堆成单列长表单；同时 browser bridge 现已向 DeepSearch 回传真实错误信息，而“打开登录页”链路里的非关键页面稳定/CDP 检查失败也不再直接打断整个动作；另外手动与 tool `resume` 都已默认停止重导旧 cookie，takeover 模式在当前活动页切到无关页面时也会主动清空旧绑定并回到“等待可接管页面”；最新还已补上聊天触发 DeepSearch 时的非打扰后台浏览器约束，托管页、站点隐藏页、显式页面校验页和由后台自动化页派生的新页 / 弹窗都会保持后台，聊天流也不再因 `chrome-devtools` 工具调用自动展开右侧面板，普通聊天、桥接会话与 StageWorker 加载 browser MCP 时都会默认使用后台模式，减少模型误用原始浏览器工具时影响用户操作；同时当前还已新增五条“免登录公开资料源” adapter 主线，`中文维基文库`、`Chinese Text Project`、`Project Gutenberg`、`Europe PMC` 和 `PMC BioC` 现在都已进入默认站点清单、免登录站点判定、聊天侧站点别名和 adapter registry，DeepSearch 可沿现有 adapter 执行链对这五类公开文本源执行搜索和机器可读正文提取，为中英文图书/古籍/论文型 DeepSearch 扩展建立可运行原型
  - 当前缺口：自动登录完成检测、执行期更细粒度页面控制、更强的完整正文抽取、Workflow capability facade、更多站点 adapter、`bb-site compatibility runtime`、受控 session fetch、compact snapshot/ref、CDP observer 和 network capture 都还未落地；此外，知乎“搜索结果页 -> 多详情页”虽然现在已补上同 run 自动跟进、搜索页/详情页角色区分、UI 联动展示、运行态自动刷新、规则级单测，以及 `waiting_login` 阶段的自动检测和自动继续，并已新增服务端恢复编排、第一版用户 cookie 导入浏览器与第一版显式页面验证，但真实浏览器下的更多抓取质量调优与更系统的 UI 验收仍需继续完成；而 `中文维基文库` / `Chinese Text Project` / `Project Gutenberg` / `Europe PMC` / `PMC BioC` 这五条新公开资料源目前也都还只是第一版 adapter 原型，尚未补正式 UI 文案、运行结果专项验收和更多同类资料源扩展，因此 DeepSearch 核心主链仍未正式打通；当前可验收的是产品壳层、本地数据层、接管预览、run 级页面绑定、基础页面快照、第一版共享登录探测、第一版登录恢复、第一版 artifact-backed result、第一版聊天 tool 复用、第一版知乎页面提取、第一版知乎搜索结果自动跟进详情页、第一版页面链路可视化、第一版运行态自动刷新、第一版等待登录自动恢复、第一版服务端恢复编排、第一版用户 cookie 导入浏览器、第一版显式页面验证、第一版聊天触发 DeepSearch 不自动打开右侧浏览器面板，以及第一版 `中文维基文库` / `Chinese Text Project` / `Project Gutenberg` / `Europe PMC` / `PMC BioC` adapter 接线，不是完整深度研究能力
- `知识库 / 跨平台索引`
  - 文档完整度：`部分完成`
  - 主链状态：`未打通`
  - 当前进展：长期问题已定位到打包版 embedding runtime 初始化，而不是模型文件缺失。Windows exe 报错 `Cannot read properties of undefined (reading 'create')` 的同时，模型诊断显示 `config.json / tokenizer.json / vocab.txt / onnx/model_quantized.onnx` 已存在于 `C:\Users\Administrator\.lumos\runtime\embedding-models` 和 `C:\Program Files\Lumos\resources...`，因此后续排查要优先看 `@huggingface/transformers` 与 `onnxruntime-web / onnxruntime-node` 的 packaged runtime 选择。当前代码修复方向已改为 portable embedder 在 Electron packaged server 中强制走本地 `onnxruntime-web` WASM，并把 `wasmPaths` 指向安装包内 `ort-wasm-simd-threaded.mjs/wasm`。
  - UI 可验收范围：暂未进入用户可验收；现有 Windows exe 仍可能复现旧错误，必须等新打包版本安装后在知识库页面真实导入文件并看到“向量化完成 / 搜索命中”。
  - 当前缺口：还需要完成正式打包和跨平台安装包验收；最低验收必须覆盖 macOS 与 Windows exe，两端都要验证“导入内容 -> 向量化成功 -> 搜索命中”，并确认失败诊断会同时报告模型文件与 onnxruntime-web WASM 文件状态。
- `桌面端更新 / 资源拆包`
  - 文档完整度：`未开始`
  - 主链状态：`未打通`
  - 当前进展：已确认当前 electron-updater 路径仍主要下载完整安装包，macOS `.dmg` 约 406MB、Windows `.exe` 约 486MB；同时已开始第一阶段前置实现，新增运行时资源解析层，让 Node runtime / Python runtime / Git Bash / 本地模型等资源可优先从外置缓存目录读取，并新增 `runtime-resources:manifest` 脚本生成稳定资源文件清单。当前这只是拆包前置能力，不代表用户更新已经变成差分或小包下载。本轮还修正了 Windows Git Bash 运行时下载后 `next build` 误扫 `C:\Users\runneradmin\Application Data` 的构建期失败：Windows 构建会使用临时隔离用户目录，避免受保护 profile junction 触发 `EPERM scandir`；最新又把自动更新提示体验改为“发现新版本后后台下载，下载完成后才弹出重启安装提示”，设置页可在下载中展示进度，已下载缓存下用户手动检查会直接进入可重启安装状态，后台周期检查不会因缓存命中反复弹窗。本地针对本轮改动的 `lint / typecheck / diff --check` 已通过，完整 `next build` 因当前已有另一个 build 进程占用 `.next/lock` 尚未重跑。
  - UI 可验收范围：安装包仍是完整更新包；可验收的体验范围是“自动检查发现新版本后不立即弹窗，后台下载完成后才提示重启安装”，以及“设置页能看到下载进度 / 已下载可重启安装”。
  - 当前缺口：还需要补资源包上传/托管、客户端资源 manifest 获取、断点/校验/解压、缺资源恢复提示、首次安装兜底、正式包移除稳定大资源、macOS/Windows 安装包和自动更新回归；本轮自动更新提示时机还未做真实打包版更新服务器端到端验收，且完整 `next build` 需要等当前并发 build 释放后重跑；这些完成前不能标为完整实现。
- `Workflow 编辑体验`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：正式 `Workflow` 详情编辑页与新建构建器的页级真源、JSON 文本和保存载荷现已统一使用原生 `v3 nodes/edges`；旧 `steps / dependsOn` 形状当前只保留在图表/可视化子组件边界，并通过适配器做进出转换，不再继续作为页面级保存真源；同时编辑器保真元数据也已移到隐藏存储，不再泄漏到用户可见 JSON 文本里；最新列表页已补上批量导出 / 导入第一版，用户可多选导出或导出全部，导入可识别旧单包、新批量包，以及一次选择多个旧单包文件，并会在同一批导入中共享代理预设映射。
  - 当前缺口：图表、画布、步骤属性编辑等子组件内部仍建立在旧 `steps / dependsOn` 视图模型上，适配层仍然存在；这意味着“双轨模型”已从正式页主状态退到组件边界，但还没有被彻底删除，因此还不能按“完整实现”标准说编辑器已经完全收敛；批量导入 / 导出目前已完成列表页第一版主链，但还未补更细的冲突预览、导入前清单确认、部分失败回滚和更系统的 UI 验收。
- `图片生成模块`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：已新增 `Nano banana2（ToAPIs）` 独立图片服务商类型，并接到统一图片生成主链；当前会按 ToAPIs 协议执行“上传参考图 -> 创建异步任务 -> 轮询状态 -> 下载结果”，避免继续把第三方网关误走 Google 官方 Gemini 原生协议；同时已补上 `gemini-3.1-flash-image-preview` 预设、`resolution` 元数据透传、多参考图上传、极端宽高比 body 映射，以及针对 provider 注册/预设暴露/异步轮询的单测；正式聊天里原先只接到旧确认卡片的服务商参数面板，现在已经补到真实消息输入区，用户输入明显的做图/改图诉求时会自动展开“图片参数”，也可以手动点开修改本次比例、分辨率、张数和高级参数；另外图片服务商编辑弹窗里已新增“默认图片参数”，可直接保存默认比例/分辨率/张数，这些默认值会被真实图片生成运行时自动读取，而不再只是 UI 摆设；最新还已补一份正式 `Gemini / Nano Banana` 电商商品图生成 SOP 文档，明确图片顺序规则、AI 自动生成场景卡、三阶段出图和终版精修流程，便于后续产品化接线与团队复用；Pro 图片生成工具已移除旧的每会话 10 张限制，tool result 现在只回传本次生成张数和 `per_image` 计费模式，不再向模型暴露可被误算为“剩余张数”的会话上限字段；同时 OpenAI-compatible 图片服务商的参考图编辑现已改用重复 `image` multipart 字段，并且生图业务失败不再作为 MCP transport error 触发并行 sibling abort，减少工作流批量生图时的错误噪声
  - 当前进展补充：图片生成的 Lumos 云配额扣费请求已补 Node 侧代理支持；桌面端/工作流进程设置 `HTTPS_PROXY / HTTP_PROXY` 时会显式走代理，并遵守 `NO_PROXY`，减少扣费前 `fetch failed / ECONNRESET / ENOTFOUND` 导致的失败。
  - 当前进展补充：针对 `generate-scenes` 场景图生成节点，已把原本自动注入给 Claude 兼容模型的上游多图二进制改为跳过，只保留文件路径给 `generate_image.reference_image_paths` 使用，减少模型首轮请求在网关侧 500 的风险；同时执行 trace 会显示实际解析模型，便于继续定位 provider/model 问题。
  - UI 可验收范围：用户可在正式聊天入口调整图片参数并生成图片，也可在图片服务商设置里保存默认比例 / 分辨率 / 张数；针对失败的场景图工作流，用户现在应从正式 `Workflow` 执行记录页点击“从失败节点重跑”或选中 `generate-scenes` 后“从此节点重跑”，新执行记录应复用上游抠图/分析/方向结果，只重跑 `generate-scenes` 及其下游。
  - 当前缺口：目前还只是第一阶段接入；更细的局部区域编辑、电商定制参数映射、更多 Nano Banana / ToAPIs 模型预设、结果卡的一键重生成参数编辑、更完整的正式 UI 文案与更系统的人工验收还未完成；`745879e0` 这类场景图工作流还需要真实从失败节点重跑通过，才能说该具体工作流已恢复，因此不能按“完整实现”标准宣称图片模块已全部完成
- `支付 / 余额充值`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：支付主线已明确只做余额充值，不做月卡或订阅；桌面端充值入口已切到金额输入 + 支付宝二维码 + 自动检测到账 + 手动刷新余额，创建订单时会使用当前 Lumos 云账户会话转发到 `lumos-web`；后台已接入易支付/ZPay `submit.php` 参数与 MD5 签名规则，创建 `balance_topup` 订单，并在支付回调里校验签名、`TRADE_SUCCESS`、订单金额后给用户的 new-api token 增加额度，回调会写入支付单号、原始通知和到账状态；最新已把后台默认提交网关切到 `https://zpayz.cn/submit.php`，`lumos-web` 生产站点已用 Let's Encrypt + Nginx 切到 `https://lumos.miki.zj.cn`，HTTP 会自动跳转 HTTPS，生产 `LUMOS_WEB_PUBLIC_URL` 也已切到 HTTPS。
  - UI 可验收范围：用户现在能在侧边栏或设置里的“充值”入口打开“充值余额”弹窗，选择 ¥10 / ¥50 / ¥100 / ¥200 或“其他金额”后输入自定义金额，当前仅展示并使用支付宝支付；Lumos 客户端创建订单后会直接在弹窗中展示支付宝扫码二维码，不再展示“打开支付页”按钮；支付完成且后台已入账后，弹窗会自动切换到“支付成功 / 余额已到账”，手动点击“刷新余额”也能触发同样的到账状态；同时 `lumos-web` 普通用户后台已把旧“套餐管理”入口改为“余额充值”，旧个人版/专业版卡片已从普通用户可见页面移除，公开首页价格区也已收敛为免费注册与余额充值；`账单记录` 页已接入当前用户自己的充值订单列表，可查看订单号、金额、支付方式、支付状态、到账状态和到账时间。
  - 当前缺口：已完成一笔真实支付成功验收，生产 HTTPS 支付回调与到账主链已确认；后台对账、退款、管理员订单检索与异常补单还未做，因此不能按“完整实现”标准验收支付模块。
- `Lumos Cloud 计费`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - UI 可验收范围：用户可在 Lumos Cloud 账户信息里刷新余额/已使用额度，当前 DeepSeek 普通输入、输出和缓存命中都按生产 new-api 新比例计费；本次受影响账户已返还 `108,275,040` quota（¥216.5501），token 4 余额已从 `364,988,757` 增至 `466,878,222`，token 8 余额已从 `1,414,443` 增至 `7,800,018`。
  - 当前缺口：仍缺正式的后台对账页、按 provider/model 的缓存命中差额报表、可审计的管理员补偿操作记录和自动化计费回归；尤其需要把后台服务商加价、new-api `ModelRatio / CompletionRatio / CacheRatio` 和上游官方价做成自动校验，当前只能说 DeepSeek 当前生产配置和本次历史账已收口，不能说 Cloud 计费体系已经完整完成。
- `微信导出 / 本地微信读取`
  - 文档完整度：`部分完成`
  - 主链状态：macOS `已打通`；Windows `未打通`（代码链路已接入，缺 Windows 真机 / exe 安装包验收）
  - UI 可验收范围：macOS 用户进入 `扩展 / 能力 > 微信` 后，不应再因为本机缺少 `message_0.db` 而看到 `FileNotFoundError: 未找到 WeChat 数据目录`；当前可重新检查并进入微信聊天浏览，看到本机可解密的会话列表，并点击可解密会话查看消息详情。若左侧摘要比详情更新，详情区会显示“消息库可读数量 / 未解密消息库 / 详情可能不完整”的提示，而不是静默显示成“没有消息记录”；微信页面也会显示“修复消息读取不完整”卡片，用户可在 UI 内完成临时放开微信读取保护、重新提取消息库密钥和重新检测。Windows 用户在新代码里应能进入同一微信页面，看到 Windows 微信进程 / 数据目录检测；若自动检测不到微信程序或聊天数据，页面会提示用户右键微信图标打开文件所在位置选择 `WeChat.exe / Weixin.exe`，并提示在微信设置 / 文件管理中查看聊天记录保存位置；手动目录可选择微信设置里的保存目录、`WeChat Files`、`xwechat_files`、账号目录、`MSG`、`db_storage` 或它下面的子目录，保存后应能看到识别到的账号和消息库目录，再重新检查并继续提取密钥。
  - 当前缺口：macOS 侧仍不修复微信原始数据库损坏，也不能恢复微信已丢失的聊天记录；当前本机 `message_2.db ~ message_5.db` 缺少已保存密钥映射，仍需用户在正式 UI 中完成重新提取后确认。Windows 侧的本地安装包资源路径已通过 `release/win-unpacked` 校验，且已补手动路径兜底和新版 `xwechat_files/db_storage` 路径识别，但还需要在 Windows exe 上真实验证手动指定路径后 WeChat.exe 进程读取权限、密钥提取成功率、`pycryptodomex` 依赖安装、旧版 `MicroMsg.db / MSG*.db` 和新版 `db_storage/message_*.db` 的解密缓存、会话列表排序、消息详情完整性和 MCP 工具可用性；这些完成前不能把 Windows 微信读取标为完整完成。
- 总体结论
  - 最小闭环：`已完成`
  - 按完整实现标准的总体验收：`未通过`
  - 最新工程稳定性：Electron 版本升级启动链路已补单实例保护，并把升级维护收敛为只做 best-effort HTTP cache 清理，不再在普通启动/升级时删除 Chromium `serviceworkers` / `cachestorage` 等浏览器运行态数据库；当前已通过 `npm run build`、`npm run typecheck` 和 Electron 主进程构建脚本验证，但真实重启验收仍需先退出旧 Electron 进程后再确认启动日志；最新还已修正 GitHub Actions / Next build 阶段多个 page-data worker 竞争同一个 SQLite 运行库的问题，构建期现在显式启用 `LUMOS_BUILD_PHASE=1` 并为每个 worker 使用隔离临时 DB，避免 `/api/task-management/list` 收集 page data 时因 `SQLITE_BUSY` 中断发布打包。
  - 当前优先级：在继续收 `03 / 04 / 05 / 06` 验收尾项的同时，主 Agent 管家先沿只读诊断 / 历史搜索 / 小白引导继续补齐；`08` DeepSearch 继续按独立模块主线补站点登录态、独立 UI 与可恢复执行；`07` 继续保持与主链并行的独立能力建设路线
