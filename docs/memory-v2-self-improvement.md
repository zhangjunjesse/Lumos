# Memory v2 Self Improvement

## 目标

自我改进先不做自动自改代码，也不自动安装能力。当前阶段只做一个可验收闭环：

1. 从行动记忆和 Skill/MCP 操作记录里发现能力缺口。
2. 生成可展示、可管理的改进候选。
3. 用户确认后把候选交给能力生成器。
4. 能力生成器产出可安装的 Skill/MCP plan。
5. Apply 按钮先经过安装前预检、版本快照、MCP 自检和失败回滚。
6. 用户应用并验证后，可把候选标记完成，系统回写一条能力记忆。

## 候选来源

候选主要来自三类 Memory v2 记录：

- `capability`：明确记录“缺少能力、需要 MCP/Skill/工具、反复手动处理”的能力账。
- `reflection`：复盘里提到失败、报错、无法调用、重复手工、需要自动化的内容。
- `task`：任务记忆里明确指出能力或工具缺口的内容。

睡眠模式还会读取 `memory_v2_capability_events`：

- Skill/MCP 创建、更新、启停、删除。
- MCP 健康检查结果，包括工具数量和失败原因。
- AI 对话里的 MCP 工具调用结果，包括工具名、成功/失败、耗时和脱敏摘要。
- 第三方 Skill/MCP 参考的隔离研究记录，包括发现来源、隔离导入、安全扫描、可学习模式和二开计划。
- 失败事件会转成 `capability` 记忆并带 `gap / self-improvement` 标签，进入候选生成。
- 第三方参考如果扫描结论为 `blocked / review_required`、风险为 `high`，或已经形成二开计划，也会转成 `gap / self-improvement` 能力记忆。
- 成功事件会转成较低权重的能力可用记录，用于后续分析“用户已经有过什么能力”。
- 睡眠还会做第一版本地自主发现：从已有行动记忆、能力缺口和失败复盘里识别 `github / deepsearch / douyin` 方向的研究候选，写入第三方能力研究事件账；该路径只登记候选，不自动调用外部 DeepSearch、GitHub 或抖音采集任务。

资源类记忆不会直接变成改进候选，尤其不会把密码、token、cookie 等敏感值写入候选。候选只保存问题、证据、建议能力和来源记忆 ID。

## 第三方能力研究边界

Lumos 可以研究第三方 Skill/MCP，但默认路径不是直接安装：

1. 发现候选：来自用户对话、睡眠复盘、DeepSearch/GitHub/抖音等后续研究入口。
2. 隔离导入：下载或复制到能力实验室隔离区，不加入 Skill registry，不启用 MCP，不执行脚本。
3. 安全扫描：检查 `SKILL.md`、manifest、脚本、依赖、网络访问、shell 命令、文件读写、环境变量和凭证使用。
4. 模式提炼：只记录可学习的设计思路，例如渐进披露、触发条件、工作流、检查清单和失败处理。
5. 二开重写：默认生成 Lumos 自己的 Skill/MCP 计划，不复制第三方实现；如确实要安装原版，必须经过扫描、验收和用户确认。

当前代码已经提供第三方能力研究事件账：`third_party_discovered / quarantined / security_scanned / pattern_learned / rewrite_planned`，以及安装治理事件：`install_precheck_staged / install_prechecked / version_snapshot_created / install_applied / install_rolled_back`。第三方研究事件只会进入行动记忆和候选生成，不会自动安装或启用能力。

同时已提供第一版能力实验室隔离入口：

- 库函数：`stageAndScanThirdPartyCapability()` 会把参考文件写入 `<LUMOS_DATA_DIR>/capability-lab/imports/<importId>/`。
- 下载函数：`downloadStageAndScanThirdPartyCapability()` 支持把 allowlist 内的 HTTPS GitHub/raw/codeload/gist/zip 链接下载到隔离区，随后复用同一套静态扫描。
- API：`POST /api/memory-v2/capability-lab` 支持上传文本、文件数组，或在 `download=true` 时按 `sourceUrl` 下载，返回静态扫描结论。
- UI：`行动记忆 > 高级/调试 > 第三方能力隔离扫描` 可粘贴 `SKILL.md / README / manifest / MCP` 片段进行隔离保存和扫描。
- UI 也可启用“从来源链接下载到隔离区”；当前只允许 `github.com / raw.githubusercontent.com / codeload.github.com / gist.githubusercontent.com` 的 HTTPS 链接，且下载后仍不安装、不启用、不执行。
- 当前扫描包含静态规则和安装门禁：明文凭证、私钥/JWT/GitHub token、下载后执行、危险命令、动态执行、网络访问、文件读写、环境变量、依赖安装、包管理生命周期脚本、高风险依赖、危险 `allowed-tools`、基础结构、验收说明、回滚说明和权限边界；不会执行第三方代码。
- 自动研究任务第一版：每日睡眠会基于本地行动记忆和能力失败记录自主登记 `github / deepsearch / douyin` 方向候选，标记为 `discoveryMode=sleep-local`、`externalTaskState=not_started`；`POST /api/memory-v2/capability-lab/research` 仍可登记来自 `github / deepsearch / douyin / manual` 的外部候选，必要时触发 allowlist 下载扫描。当前还不会真正调度 DeepSearch、GitHub API 或抖音采集器去外部主动找新项目。

## 安装治理流水线

能力生成器和分享包导入现在都接入同一类安装治理：

- 生成器 Apply：`POST /api/extensions/plan` 会先把 plan 转成可扫描文件，调用 `precheckGeneratedCapabilityInstall()` 做静态预检；预检不通过时返回阻断原因，不写 Skill、不写 MCP、不写脚本、不装 Python 包。
- 分享包导入：`POST /api/extensions/pack` 的 `preview-import / apply-import` 会返回并执行同一套预检；阻断时导入按钮不可继续，服务端也会拒绝写入。
- 版本快照：安装或更新前会保存 user-scope Skill/MCP 的旧版本快照，记录旧 hash、配置摘要和脚本内容位置。
- 失败回滚：任一写入、Python 包安装、MCP 协议自检失败时，会恢复旧 Skill/MCP，删除本次新建 Skill/MCP，尽量恢复或删除本次写入的 MCP 脚本，并尝试卸载本次新增 Python 包。
- 版本治理：每个能力产物以内容 SHA-256 作为版本指纹，安装前预检、快照、写入和回滚都会写入 `memory_v2_capability_events`，供后续睡眠复盘继续分析。

当前这仍是第一版流水线，不是完整治理产品：还没有独立版本历史页面、手动选择历史版本回滚、审批流、权限 diff、长期运行态审计，也没有把所有旧安装入口都合并成唯一入口。

参考模式：

- Anthropic Agent Skills 文档把 Skill 定义为 `SKILL.md` 加可选脚本、资源、参考文件，并通过渐进披露减少上下文占用：https://docs.claude.com/en/docs/agents-and-tools/agent-skills
- Claude 支持从对话中创建 Skill，这适合作为“从历史对话提炼可复用方法”的产品形态参考：https://support.claude.com/en/articles/12599426-how-to-create-a-skill-with-claude-through-conversation
- `basic-memory-skills` 里有 `memory-reflect` 等睡眠期记忆复盘 Skill，可作为“夜间分析历史并改进行动记忆”的思路参考，但只能隔离研究和二开重写：https://github.com/basicmachines-co/basic-memory-skills

## 状态

- `candidate`：系统发现，但用户尚未处理。
- `approved`：用户确认可以做。
- `building`：已经交给能力生成器。
- `built`：用户确认能力已安装或完成。
- `rejected`：用户拒绝。
- `failed`：生成或验证失败。

## 与能力生成器的关系

自我改进不直接写 Skill/MCP。它只负责把“为什么需要这个能力”整理成结构化 prompt，然后创建 Capability Builder 会话。

Capability Builder 继续负责：

- 判断最终应该是 Skill 还是 MCP。
- 生成 `lumos-extension-plan`。
- 通过 Apply 按钮安装 Skill/MCP；Apply 会调用服务端安装治理，而不是在前端直接写 Skill/MCP。
- MCP 安装后走 `initialize -> notifications/initialized -> tools/list` 协议自检；失败会触发回滚。

## 安全边界

- 不自动安装。
- 不自动运行生成的 MCP。
- 第三方 Skill/MCP 默认只允许隔离研究、静态扫描和二开重写，不直接进入可执行能力列表。
- 隔离导入目录不参与 `skills` 同步，也不写入 `mcp_servers`，扫描结果只进入 `memory_v2_capability_events`。
- 扫描结果里的 `policy.installAllowed=false` 时，后续生成器只能二开重写，不能把原参考安装为用户能力。
- 能力生成器产物和分享包导入都必须先过安装前预检；预检失败时服务端拒绝写入。
- 安装或更新前必须创建快照；安装、自检或写入失败时必须尝试回滚并记录事件。
- 不在候选、prompt、Skill、MCP 配置里写死明文凭证。
- 高风险候选会标记 `riskLevel=high`，包括登录态、服务器、token、生产权限、删除/写入等场景。

## 简单 SOP

1. 每日睡眠扫描当天新增用户消息和 Skill/MCP 操作记录。
2. 把稳定偏好、资源、任务进展、能力事件和失败复盘写入行动记忆。
3. 从能力缺口和失败事件生成改进候选，并去重。
4. 第三方参考先记录隔离导入和安全扫描结果；高风险或被阻断的参考只允许二开重写。
5. 睡眠本地自主发现会把历史缺口登记成 DeepSearch/GitHub/抖音方向研究候选，但不会自动消耗外部站点或账号资源。
6. 低风险 Skill/MCP 候选可交给能力生成器生成安装计划；安装计划必须先过静态预检和用户确认。
7. 安装或更新前创建版本快照；写入后执行健康检查 / smoke test；失败则回滚，并把结果写回能力事件账。
8. AI 对话实际调用 MCP 后，记录工具名、成功/失败、耗时和脱敏摘要，不保存完整参数或完整返回正文。
9. 下一次睡眠基于调用和健康结果判断体验是否符合预期，继续生成更小的修正候选。
