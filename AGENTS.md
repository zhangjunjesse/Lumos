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
- 以“独立模块优先、聊天与工作流复用其服务”的原则补齐 `08 DeepSearch`，利用内置浏览器共享登录态为反爬站点提供可验收的深度研究能力。
- 支付模块先收敛到“余额充值”主链：用户充值后增加 Lumos 余额 / new-api token 额度，不做月卡、订阅或会员套餐主线。
- `lumos-web` 生产后台已切到 HTTPS：`http://lumos.miki.zj.cn` 会 301 到 `https://lumos.miki.zj.cn`，证书使用 Let's Encrypt + 现有 Nginx 自动续期方案。
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
  - 成果：按 `01 / 02 / 03` 设计文档要求，主 Agent 复杂请求已补上正式下发闭环：命中复杂任务时会直接创建 Task Management 任务并返回交接确认，不再在主对话里自己执行整项任务；同时 `createTask` 生成的任务会正式回写来源用户消息与助手确认消息。
  - 成果：按用户最新要求，主 Agent 页已去掉临时任务面板，任务标签也已从全局左侧导航撤下，改为出现在聊天界面右侧的轻量任务标签；用户可直接点击标签跳到标准 `Workflow` 任务详情查看报告，不看详情时仍由主 Agent 在对话里汇报结果。
  - 成果：图片模块已新增 `Nano banana2（ToAPIs）` 的第一阶段接入；当前正式预设会把 ToAPIs 的“上传参考图 -> 创建异步任务 -> 轮询状态 -> 下载结果”接进统一图片生成主链，不再误复用 Google 官方 Gemini 原生协议；同时已开始支持文生图、图生图/多参考图、极端宽高比与 `resolution` 元数据透传，便于先承接与万相相近的一批电商出图/改图场景；图片参数 UI 也已从旧确认卡片扩到真实聊天入口与图片服务商编辑弹窗，当前会按图片模块正在使用的服务商动态展示可用比例、分辨率、生成张数上限、参考图上限与专有高级参数入口，优先适配 `Nano banana2（ToAPIs）` 的极端宽高比和高参考图上限；同时图片服务商现已支持在设置里保存默认比例/分辨率/张数，并在真正的生成运行时自动生效；Pro 图片生成工具已移除旧的“每会话最多 10 张”运行时限制与结果字段，改为按张计费口径，聊天侧不再应根据历史 `generation_count / generation_limit` 推导剩余额度。
  - 成果：支付模块已按用户最新要求收敛为“充值余额”第一阶段主链；当前桌面端充值弹窗不再展示月卡/套餐购买，用户可输入金额，当前仅展示支付宝支付，创建订单后直接在弹窗展示二维码，并会自动检测到账后显示“支付成功 / 余额已到账”；订单创建由桌面端转发到 `lumos-web`，后台按易支付签名规则生成支付链接，并在异步/同步回调中校验签名、支付状态和金额后给对应 new-api token 增加额度，同时记录订单到账状态以减少重复回调导致的重复入账风险。
  - 成果：已新增 `07-dynamic-capability-extension-design.md`，把“用户通过 LLM 动态新增系统能力，并让工作流后续可正式使用”定义为独立横切架构，不再硬塞进 `03 ~ 06` 任一单层文档。
  - 成果：已为 `07` 补上正式产品入口；左侧侧边栏现已新增“节点开发”菜单，并有独立 `/workflow/nodes` 页面用于展示当前正式节点边界、07 的能力建设方向与剩余缺口。
  - 成果：已按用户最新确认收敛 `07` 的产品形态：`新增能力` 继续以聊天页为主入口，尽量不扩 UI；AI 需先和用户对话确认需求，再直接生成两类待发布能力（`代码节点` / `Prompt 节点`）；“草稿”只保留为内部实现概念，不作为 Phase 1 主要产品心智。
  - 成果：`07` 已补上第一段正式主链：当前可在“新增能力”聊天页完成 `对话确认 -> 生成待发布能力 -> 发布`，能力管理列表和详情页也已切到“待发布 / 已发布”正式语义；其中 `Prompt 节点` 已进一步接入调度层发现，用户在任务里明确写出能力 ID 或名称时，会被规划进工作流 agent 步骤中使用。
  - 成果：`07` 已继续补上代码节点的第一条正式调用桥：当任务里明确提到某个已发布 `代码节点`，并同时提供结构化 JSON 参数时，调度层会生成真实 `capability` 步骤执行该节点；正式 `Workflow` 详情页也已开始把这类步骤显示为“系统能力节点”，并展示能力 ID 等运行态信息。
  - 成果：已开始兼容历史遗留能力文件；`~/.lumos/capabilities` 下已有的旧 `ts/md` 能力现已能进入当前能力发现范围，不再只停留在“文件存在但主链不可见”的状态。
  - 成果：主 Agent 的一个高频导出场景已补上第一条自动接能力的链路；当任务要求“整理报告/正文并导出 PDF”且存在可识别的格式转换代码节点时，调度层会在正文生成后自动追加能力步骤执行导出，不再一律回退为“PDF 导出需求已记录”占位话术。
  - 成果：`新增能力` 聊天助手已补上真实能力清单提示；后续只有在当前真实可发现能力列表里存在时，才应对用户说“已经有这个能力”。
  - 待完成：聊天侧任务标签目前已满足“轻入口 + 点开看正式详情”，但更细的展示策略和交互规则仍可能继续调整，还不是最终完整产品形态。
  - 待完成：把内部完成度和 UI 可见能力进一步对齐，减少“内部已通但 UI 不可验”的区域。
  - 待完成：补齐 `06` 的正式执行代理 UI，并与现有团队设置页分层，避免和旧 team-run 角色预设混淆。
  - 待完成：把 `03` 调度信息与 `06` 运行态角色信息继续收进正式详情页，而不只留在测试页或配置页。
  - 待完成：`07` 仍未完整打通；虽然对话式确认、能力生成、发布入口，以及 `Prompt 节点` / `代码节点` 的显式任务引用主链都已具备第一段可验收实现，且报告导出到 PDF 已补上一条自动接能力的主链，但更通用的自动发现、自然语言参数提取、审批、回滚和更完整的运行时治理都还没有完成。
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

## 当前状态进度

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
  - 当前进展：正式工作流页已开始展示真实执行输出和实际执行步骤，不再只展示 DSL 规划视角；同时已补 OpenWorkflow sqlite backend 的 Next 外部包配置以降低开发环境兼容风险；workflow agent step 现已默认收紧为文本结果交付，避免因声明不存在的 artifact 而导致执行伪失败；文本型 stage 还具备结构化输出失败后的纯文本兜底，降低真实执行时因 JSON schema 收敛失败造成的主链中断；任务完成后写回主 Agent 对话的结果消息也已改为稳定直写，可保留浏览器截图的真实绝对路径并在聊天区直接预览；并行浏览器分支现已为每个分支创建独立页面并把 pageId 显式传递到后续截图步骤，减少复杂工作流中的串页风险；workflow agent step 现已支持受控 context 依赖输入，汇总代理可以读取并行分支结果做真实汇总；当汇总代理与最终通知正文相同，任务完成系统通知也已收敛为简短提示，避免在对话里第三次重复整份长报告；正式页现在还能展示 workflow 投影返回的真实运行态，包括运行中/跳过步骤、失败原因和关键步骤结果；浏览器步骤还已支持截图直出预览和产物打开入口；混合复杂工作流执行主链已完成一轮真实 UI 验收；最新 simple execution 与 workflow agent step 已补运行时超时透传，同时浏览器搜索步骤还能把页面摘录传给后续汇总代理使用；此外，编译产物与执行提交层也已补上任务级 runtime 元数据注入，workflow step 现在可稳定拿到来源 task/session 的 `taskId / sessionId / requestedModel / workingDirectory`；browser bridge 代码模式运行时还已补上 `waitFor` 传输超时透传、短等待自动抬底与同实例 `pageId` 粘连，减少登录页/收藏页这类慢页面场景下被 `10000 / 15000 / 30000ms` 的客户端等待或多标签页错页共同放大失败概率；同时 `/v1/pages/navigate`、新建页、快照、截图这些桥接请求也已补接口级更长默认传输超时；workflow `code-only` 浏览器步骤现在还会在失败时自动保存页面快照、失败截图与调试日志，并把这些调试产物通过正式 `Workflow` 详情页暴露出来，减少浏览器代码节点的黑盒排障；最新这条 `code-only` 浏览器链路也已默认改成后台执行，运行中的页面操作不再主动切前台浏览器标签页，只在手动调试入口保留前台行为；workflow outer timeout 也已改为按 manifest step timeout 求和并追加缓冲，`notification / capability / wait` step 的真实 runtime binding 也已补齐；另外 `chrome-devtools` MCP 在多标签页场景下已改为要求显式 `pageId`，且 `list_pages` 结果会附带活动页和相似页签警告，纯 Agent 浏览器路径的串页风险也开始收口；最新正式任务关闭 / 删除 / 执行记录停止已能向底层 workflow cancel 收口，并会同步执行历史和投影状态为已取消，避免删除 UI 记录后底层执行继续残留
  - 当前缺口：浏览器与通知能力仍有工程化收尾项，尚未按“完整实现”关闭；工作流引擎在真实 UI 开发环境中的重新验证仍需继续完成
- `06 执行代理层`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：底层 agent abort 已打通，simple execution 与 workflow cancel 都会向活动中的 agent 执行传播中断信号；正式工作流角色配置 UI 已接入 Scheduling / Workflow SubAgent 的真实配置源，且现在除团队设置页外，已新增独立的 `Workflow Roles` 正式入口，并按“执行角色 / 规划角色”分组，减少与旧团队预设混淆；正式 `Workflow` 页面也已能显示任务计划引用到的角色快照、实际输出、实际执行步骤，以及运行态详情（当前动作、运行中步骤、已跳过步骤、失败或取消原因）；最新又补进了“当前运行角色”“任务内角色分配”以及会话/资源视图，用户现在可直接在正式任务详情看到代理会话、任务/规划/执行记忆槽、隔离工作目录、输出目录、请求模型、耗时与 Token/API 调用；正式 `Workflow Roles` 页面也已新增活跃代理会话面板，可直接查看当前会话生命周期状态并发起单代理中断；另外 workflow subagent 与 StageWorker 已改为优先继承任务 session 的 provider/model/workspace，不再默认回落到全局 active provider 或 `process.cwd()`；最新执行代理链也已补上统一的 provider-aware 模型解析与失败诊断，`requestedModel` 和实际 `resolvedModel` 会随运行时收口，减少 Claude 风格别名与 gateway 实际模型 ID 不一致时的黑盒失败；正式执行记录页现已提供“停止执行”，关闭或删除任务也会先中断运行中的 workflow / agent 链路，并对已丢失 run history 但仍 running 的执行投影做兜底取消
  - 当前缺口：完整代理生命周期与更强的长期资源治理仍未全部落地；虽然正式页面已能验收活跃会话、核心会话隔离、资源边界与单代理中断，但更长期的会话续跑、自动回收、限额治理还未全部产品化可验
- `07 动态能力扩展`
  - 文档完整度：`基本完成`
  - 主链状态：`已打通`
  - 当前进展：已新增独立架构文档，明确“动态新增系统能力”不并入 `03 ~ 06`，而是作为横切能力单独定义；最新已按用户要求把产品目标进一步收敛为“尽量复用现有聊天式新增页，不引入复杂草稿流，AI 先确认需求，再直接生成两类待发布能力：`代码节点` 与 `Prompt 节点`，最后由用户发布”；同时文档已进一步明确 Phase 1 的最小改 UI 实施方案：保留当前能力列表页、聊天式新增页和详情页，只调整行为为“对话确认 -> 生成待发布能力 -> 发布 -> 正式可用”；当前产品侧已实现这条第一段主链：`Prompt 节点` 在任务明确提到能力 ID / 名称时，会进入 workflow agent step 的 `tools`；`代码节点` 在任务明确提到能力 ID / 名称并提供结构化 JSON 参数时，会进入真实 `capability` 步骤执行；历史遗留的本地能力文件也已开始进入当前发现范围；正式 `Workflow` 详情页也已开始展示“系统能力节点”和对应能力 ID；此外，报告/正文导出 PDF 场景现在已能在检测到可用格式转换能力时自动追加能力步骤，不再一律停在“需求已记录”的占位结果；最新又已补上正文类 workflow agent step 的纯文本交付模式、Claude SDK `result.result` 文本读取，以及 `md-converter` 在缺少 `pdflatex` 时回退到本机 `weasyprint` 生成 PDF；“给我一份 Claude 使用技巧报告，并导出 PDF” 这条真实任务现已完成一轮端到端验收并产出实际 PDF 文件
  - 当前缺口：`07` 仍未完整打通；当前可验收的是 UI 里的“对话确认 / 生成 / 发布”、两类能力的显式任务引用，以及报告到 PDF 的一条自动导出主链，但更通用的自动发现、自然语言参数提取、审批、回滚、配额/沙箱治理和更完整的运行态可视化仍未完成，因此还不能按“完整实现”标准验收
- `08 DeepSearch 独立模块`
  - 文档完整度：`基本完成`
  - 主链状态：`未打通`
  - 当前进展：已确认 DeepSearch 需要先作为独立模块建设，而不是先耦合进 Workflow；产品入口已收敛为左侧侧边栏 `扩展` 内的 `DeepSearch` tab，而不是单独一级路由；文档已明确 Phase 1 必须先补站点登录态检查、登录引导、登录后恢复执行、历史抓取记录、详细内容查看，以及面向聊天 / Workflow 的高层服务复用边界；同时也已明确核心形态应为内置模块 / service，外部独立 MCP 仍不是第一产品落点；另外针对 `bb-browser` 是否应直接接入的问题，也已补完单独评估文档，结论已进一步收敛为“保留 Lumos 内置浏览器为唯一正式运行时，在内部实现 `bb-site compatibility runtime`，只吸收 `site adapter / session fetch / compact snapshot / network capture` 等能力模型，并优先支持经过审查的 Tier 1 / Tier 2 adapter”；最新又已补上“部署与本地使用形态”“Phase 1 实现拆解”“UI 与交互设计”“数据与 API 设计”“工程落地拆解”五份子文档，把“内置在 Lumos、本地通过 Lumos 实例直接使用、先做 run/artifact/UI/登录态主链、后再扩外部 facade、正式页如何交互、service/tool 数据合同如何对齐、当前仓库里具体该改哪些文件”进一步写实；同时已把“正式接管当前活动页”“`strict / best_effort` 分离”“非严格模式以 `partial` 收口”“统一 run 状态和 resume 语义”“Workflow 正式复用进入 Phase 2”这些之前分散的结论写回主文档和补充文档，避免 08 内部继续口径分裂；在代码侧，当前已落地 `扩展 > DeepSearch` 正式页签、站点登录态配置弹窗、DeepSearch 本地 SQLite 表、DeepSearch runs API、抓取历史列表、详情页和暂停/继续/取消的本地状态控制；同时也已补上共享 browser bridge client、DeepSearch service 和“当前活动页接管预览”API/UI；随后又把 takeover run 的“活动页锁定”正式落到 `run page` 持久化模型中，创建任务时会尝试捕获当前活动页并在详情页展示具体绑定信息；之后创建或恢复可执行任务后，还会真正通过内置浏览器执行通用页面接管 / 托管页创建、抓取页面摘录和截图，并把结果写回任务详情；随后又补上共享 cookie 级站点探测与正式 `waiting_login` 收口；再进一步补上了站点级“打开登录页”、`waiting_login` 恢复引导，以及 takeover 模式恢复前的当前活动页重新绑定；随后已把执行结果正式落到 `records / artifacts`，并在详情页提供记录摘要、正文 artifact、截图 artifact 和截图预览；之后继续补上第一版聊天高层 facade，内置 `deepsearch` MCP server 已进入内置 MCP 列表并默认启用，聊天系统提示会在相关诉求下优先调用 `start / get_result / pause / resume / cancel`，tool 结果直接复用 run/artifact 读模型，并提供跳转 `扩展 > DeepSearch` 的 `runId` 深链；最新又补上第一版 `zhihu` 站点 adapter runtime，当前知乎问题页、文章页和列表页会优先走站点级提取逻辑，尝试展开正文并生成更贴近真实页面结构的 `contentState / snippet / structured_json`，同时保留通用抓取兜底；再进一步，当 seed 页被识别为知乎搜索结果页时，同一 run 里还会自动挑选最多 3 个详情页继续抓取，且现在已正式覆盖 `zhuanlan.zhihu.com/p/...` 专栏正文地址，同时托管搜索页角色也已显式收敛为 `search`；相关站点路由单测已通过，最新整包 `Next build` 也再次通过；而在正式 UI 上，任务详情现已按绑定页面链路联动展示关联记录，用户可以直接看出搜索页、自动跟进详情页及其各自产物，同时运行中的任务也会自动轮询刷新；此外，`waiting_login` 的自动恢复编排现已下沉到独立 DeepSearch service / API，前端不再自己串联逐站点 recheck 与逐任务 resume，而是统一走服务端 `探测 -> 判定 -> 恢复 -> 回写`，抓取历史列表也已补上每个任务的状态说明；现在第二条认证源也已打通，用户提供的 cookie 会被解析并尽力导入到内置浏览器，再进入与共享登录态一致的登录探测链；同时页面级验证语义已进一步收敛：保存 cookie 现在只做轻量 cookie 探测，真正会打开验证页的动作只保留在显式“检查登录态”，后台 `waiting_login` 恢复也不再重复重导用户保存的 cookie，从而避免覆盖浏览器里更新后的真实登录态；另外正式 UI 和 tool 的“站点 ready” 现已只认 live probe 的 `connected`，不再把手工 `cookieStatus=valid` 误当成可运行，同时内部 `PAGE_VALIDATION_BLOCKED` 哨兵也不再直接展示给用户；最新又已把正式页重排成“站点接入 / 抓取发起 / 历史与详情”的分区结构，站点卡片、当前站点详情、操作入口和运行结果不再堆成单列长表单；同时 browser bridge 现已向 DeepSearch 回传真实错误信息，而“打开登录页”链路里的非关键页面稳定/CDP 检查失败也不再直接打断整个动作；另外手动与 tool `resume` 都已默认停止重导旧 cookie，takeover 模式在当前活动页切到无关页面时也会主动清空旧绑定并回到“等待可接管页面”；最新还已补上聊天触发 DeepSearch 时的非打扰后台浏览器约束，托管页、站点隐藏页、显式页面校验页和由后台自动化页派生的新页 / 弹窗都会保持后台，聊天流也不再因 `chrome-devtools` 工具调用自动展开右侧面板，普通聊天、桥接会话与 StageWorker 加载 browser MCP 时都会默认使用后台模式，减少模型误用原始浏览器工具时影响用户操作；同时当前还已新增五条“免登录公开资料源” adapter 主线，`中文维基文库`、`Chinese Text Project`、`Project Gutenberg`、`Europe PMC` 和 `PMC BioC` 现在都已进入默认站点清单、免登录站点判定、聊天侧站点别名和 adapter registry，DeepSearch 可沿现有 adapter 执行链对这五类公开文本源执行搜索和机器可读正文提取，为中英文图书/古籍/论文型 DeepSearch 扩展建立可运行原型
  - 当前缺口：自动登录完成检测、执行期更细粒度页面控制、更强的完整正文抽取、Workflow capability facade、更多站点 adapter、`bb-site compatibility runtime`、受控 session fetch、compact snapshot/ref、CDP observer 和 network capture 都还未落地；此外，知乎“搜索结果页 -> 多详情页”虽然现在已补上同 run 自动跟进、搜索页/详情页角色区分、UI 联动展示、运行态自动刷新、规则级单测，以及 `waiting_login` 阶段的自动检测和自动继续，并已新增服务端恢复编排、第一版用户 cookie 导入浏览器与第一版显式页面验证，但真实浏览器下的更多抓取质量调优与更系统的 UI 验收仍需继续完成；而 `中文维基文库` / `Chinese Text Project` / `Project Gutenberg` / `Europe PMC` / `PMC BioC` 这五条新公开资料源目前也都还只是第一版 adapter 原型，尚未补正式 UI 文案、运行结果专项验收和更多同类资料源扩展，因此 DeepSearch 核心主链仍未正式打通；当前可验收的是产品壳层、本地数据层、接管预览、run 级页面绑定、基础页面快照、第一版共享登录探测、第一版登录恢复、第一版 artifact-backed result、第一版聊天 tool 复用、第一版知乎页面提取、第一版知乎搜索结果自动跟进详情页、第一版页面链路可视化、第一版运行态自动刷新、第一版等待登录自动恢复、第一版服务端恢复编排、第一版用户 cookie 导入浏览器、第一版显式页面验证、第一版聊天触发 DeepSearch 不自动打开右侧浏览器面板，以及第一版 `中文维基文库` / `Chinese Text Project` / `Project Gutenberg` / `Europe PMC` / `PMC BioC` adapter 接线，不是完整深度研究能力
- `Workflow 编辑体验`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：正式 `Workflow` 详情编辑页与新建构建器的页级真源、JSON 文本和保存载荷现已统一使用原生 `v3 nodes/edges`；旧 `steps / dependsOn` 形状当前只保留在图表/可视化子组件边界，并通过适配器做进出转换，不再继续作为页面级保存真源；同时编辑器保真元数据也已移到隐藏存储，不再泄漏到用户可见 JSON 文本里。
  - 当前缺口：图表、画布、步骤属性编辑等子组件内部仍建立在旧 `steps / dependsOn` 视图模型上，适配层仍然存在；这意味着“双轨模型”已从正式页主状态退到组件边界，但还没有被彻底删除，因此还不能按“完整实现”标准说编辑器已经完全收敛。
- `图片生成模块`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：已新增 `Nano banana2（ToAPIs）` 独立图片服务商类型，并接到统一图片生成主链；当前会按 ToAPIs 协议执行“上传参考图 -> 创建异步任务 -> 轮询状态 -> 下载结果”，避免继续把第三方网关误走 Google 官方 Gemini 原生协议；同时已补上 `gemini-3.1-flash-image-preview` 预设、`resolution` 元数据透传、多参考图上传、极端宽高比 body 映射，以及针对 provider 注册/预设暴露/异步轮询的单测；正式聊天里原先只接到旧确认卡片的服务商参数面板，现在已经补到真实消息输入区，用户输入明显的做图/改图诉求时会自动展开“图片参数”，也可以手动点开修改本次比例、分辨率、张数和高级参数；另外图片服务商编辑弹窗里已新增“默认图片参数”，可直接保存默认比例/分辨率/张数，这些默认值会被真实图片生成运行时自动读取，而不再只是 UI 摆设；最新还已补一份正式 `Gemini / Nano Banana` 电商商品图生成 SOP 文档，明确图片顺序规则、AI 自动生成场景卡、三阶段出图和终版精修流程，便于后续产品化接线与团队复用；Pro 图片生成工具已移除旧的每会话 10 张限制，tool result 现在只回传本次生成张数和 `per_image` 计费模式，不再向模型暴露可被误算为“剩余张数”的会话上限字段
  - 当前缺口：目前还只是第一阶段接入；更细的局部区域编辑、电商定制参数映射、更多 Nano Banana / ToAPIs 模型预设、结果卡的一键重生成参数编辑、更完整的正式 UI 文案与更系统的人工验收还未完成，因此不能按“完整实现”标准宣称图片模块已全部完成
- `支付 / 余额充值`
  - 文档完整度：`部分完成`
  - 主链状态：`已打通`
  - 当前进展：支付主线已明确只做余额充值，不做月卡或订阅；桌面端充值入口已切到金额输入 + 支付宝二维码 + 自动检测到账 + 手动刷新余额，创建订单时会使用当前 Lumos 云账户会话转发到 `lumos-web`；后台已接入易支付/ZPay `submit.php` 参数与 MD5 签名规则，创建 `balance_topup` 订单，并在支付回调里校验签名、`TRADE_SUCCESS`、订单金额后给用户的 new-api token 增加额度，回调会写入支付单号、原始通知和到账状态；最新已把后台默认提交网关切到 `https://zpayz.cn/submit.php`，`lumos-web` 生产站点已用 Let's Encrypt + Nginx 切到 `https://lumos.miki.zj.cn`，HTTP 会自动跳转 HTTPS，生产 `LUMOS_WEB_PUBLIC_URL` 也已切到 HTTPS。
  - UI 可验收范围：用户现在能在侧边栏或设置里的“充值”入口打开“充值余额”弹窗，选择 ¥10 / ¥50 / ¥100 / ¥200 或“其他金额”后输入自定义金额，当前仅展示并使用支付宝支付；Lumos 客户端创建订单后会直接在弹窗中展示支付宝扫码二维码，不再展示“打开支付页”按钮；支付完成且后台已入账后，弹窗会自动切换到“支付成功 / 余额已到账”，手动点击“刷新余额”也能触发同样的到账状态；同时 `lumos-web` 普通用户后台已把旧“套餐管理”入口改为“余额充值”，旧个人版/专业版卡片已从普通用户可见页面移除，公开首页价格区也已收敛为免费注册与余额充值；`账单记录` 页已接入当前用户自己的充值订单列表，可查看订单号、金额、支付方式、支付状态、到账状态和到账时间。
  - 当前缺口：已完成一笔真实支付成功验收，生产 HTTPS 支付回调与到账主链已确认；后台对账、退款、管理员订单检索与异常补单还未做，因此不能按“完整实现”标准验收支付模块。
- 总体结论
  - 最小闭环：`已完成`
  - 按完整实现标准的总体验收：`未通过`
  - 最新工程稳定性：Electron 版本升级启动链路已补单实例保护，并把升级维护收敛为只做 best-effort HTTP cache 清理，不再在普通启动/升级时删除 Chromium `serviceworkers` / `cachestorage` 等浏览器运行态数据库；当前已通过 `npm run build`、`npm run typecheck` 和 Electron 主进程构建脚本验证，但真实重启验收仍需先退出旧 Electron 进程后再确认启动日志；最新还已修正 GitHub Actions / Next build 阶段多个 page-data worker 竞争同一个 SQLite 运行库的问题，构建期现在显式启用 `LUMOS_BUILD_PHASE=1` 并为每个 worker 使用隔离临时 DB，避免 `/api/task-management/list` 收集 page data 时因 `SQLITE_BUSY` 中断发布打包。
  - 当前优先级：在继续收 `03 / 04 / 05 / 06` 验收尾项的同时，按 `08` 文档先启动 DeepSearch 独立模块主线，优先补站点登录态、独立 UI 与可恢复执行，再让聊天和 Workflow 复用该服务；`07` 继续保持与主链并行的独立能力建设路线
