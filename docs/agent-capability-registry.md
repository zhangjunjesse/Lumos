# Agent 能力注册中心（Connector Registry）

## 为什么要有这个东西

主对话 agent 会出现「我没有微信工具」并误抓闲鱼 `goofish_get_inbox` 的事故。根因不是某个 bug，而是**能力广告（agent 对外宣称会什么）被做成了随状态漂移的非确定函数**：

- 聊天模式映射权限：`code→acceptEdits`、`plan→plan`、`ask→default`（`chat/route.ts`）。
- 总闸 `shouldExposeWeChatAssistantMcp = permissionMode !== 'default' && !browserAutomationIntent`。
- 于是 **Ask 模式下微信能力整体蒸发**：`wechat-export` 被无条件 skip、`lumos-wechat-assistant` 不注入、微信 hint 不加、连「列出已加载 MCP」的发现提示也被 `permissionMode!=='default'` 吞掉；而闲鱼 `goofish-search` 是 DB `is_enabled=1` 常驻、不受权限影响 → 永远在。agent 找不到微信、看到语义最近的 `goofish_get_inbox` → 误用。

证据表明这是系统性技术债：`goofish-search` / `x-platform` / `douyin-collector` 三处各自手写注释重新发明同一条「always-on，否则 AI 假装工具不存在 / 瞎编」规则——部落知识散落在 `||` 链和十几处 `permissionMode!=='default'` 条件里，没有单一强制契约，微信漏抄了补丁，下个连接器还会漏。

## 不变量（注册中心强制保证）

> **agent 对外宣称的能力集，必须只由「装了哪些连接器 + 硬结构事实」决定，不能由聊天模式 / resume / 安装授权进度决定。未就绪的连接器仍保留工具并返回结构化 not-ready，让 AI 说真话，而不是抓最像的工具替代。**

拆成三条可验证规则：

1. **R1 工具可见性与就绪态解耦**：连接器是否对本会话暴露（`appliesTo`）只能读硬结构事实（浏览器自动化意图、legacy-image、专属会话类型）。**严禁读取 readiness（登录/授权/密钥/venv）**。就绪态只改 `buildHint` 的*文案 payload*，永不改工具*存在性*。
2. **R2 权限模式不做 per-connector 闸**：权限模式（default/ask vs acceptEdits/plan）只在注册中心**一处**统一策略——可降级写/exec 类工具子集，但**读/消息类连接器与其 hint、以及 MCP 发现提示永不因 `default` 被删**。
3. **R3 命名空间一致**：微信只有一个 `wechat` 连接器，拥有 `lumos-wechat-assistant` in-process server，并显式把 `wechat-export` 原始 MCP 作为内部后端、永不单独对模型广告。

## 契约（`src/lib/agent-capabilities/types.ts`）

```ts
export type PermissionMode = 'default' | 'plan' | 'acceptEdits';

/** 注册中心唯一输入。等价于 chat route 当前散读的那组事实。 */
export interface ConnectorContext {
  session: SessionPromptCarrier;
  sessionId: string;
  userId?: string;
  permissionMode: PermissionMode;
  // —— 硬结构事实（R1 允许 appliesTo 读取的全集）——
  browserAutomationIntent: boolean;
  visibleBrowserIntent: boolean;
  legacyImageAgentPrompt: boolean;
  isPrimaryMainAgentSession: boolean;        // isMainAgentSession(session)
  isDedicatedWeChatAssistantSession: boolean; // isWeChatAssistantChatSession(session)
  isWorkflowChatSession: boolean;
  isEcommerceAssistantChatSession: boolean;
  knowledgeEnabledForRequest: boolean;
  selectedKnowledgeTagIds: string[];
  knowledgeOverrides?: KnowledgeOverrides;
}

export type ConnectorReadiness =
  | { state: 'ready' }
  | { state: 'needs_setup'; reason: string; actionHint: string }
  | { state: 'needs_auth'; reason: string; actionHint: string }
  | { state: 'unavailable'; reason: string };

export interface ConnectorResolution {
  /** 本连接器拥有的 DB stdio MCP 名（注册中心据此决定 keep/skip，而非 route 散写）。 */
  ownedDbMcpNames?: string[];
  /** 这些 DB MCP 即使未登录也应默认启用（取代 init-builtin-resources 的 || 链）。 */
  defaultEnabledDbMcpNames?: string[];
  /** in-process server 工厂（注册中心负责注入）。 */
  inProcess?: () => InProcessMcpServer | null;
}

export interface ConnectorDefinition {
  /** 稳定命名空间：'wechat' | 'goofish' | 'douyin' | 'x' | 'feishu' | … */
  id: string;
  label: string;
  /**
   * 本会话是否暴露该连接器。默认 true。
   * R1：实现体只能读 ctx 的硬结构事实，禁止任何 readiness 探测。
   */
  appliesTo?(ctx: ConnectorContext): boolean;
  /** 探测后端就绪态。只影响 hint 文案，永不影响工具存在性。 */
  probeReadiness?(ctx: ConnectorContext): ConnectorReadiness;
  /** 工具贡献。 */
  resolve(ctx: ConnectorContext): ConnectorResolution;
  /** 系统提示。收 readiness 以便说「已连接」vs「去 能力→微信 授权」。 */
  buildHint?(ctx: ConnectorContext, readiness: ConnectorReadiness): string | null;
}
```

## 解析器（`src/lib/agent-capabilities/registry.ts`）

```ts
export interface CapabilityPlan {
  dbMcpSkipNames: Set<string>;                 // 传给 resolveEnabledMcpServers({ skipNames })
  inProcessServers: Record<string, InProcessMcpServer>;
  systemHintAppend: string;                    // 直接拼到 finalSystemPrompt
}

export function buildCapabilityPlan(ctx: ConnectorContext): CapabilityPlan;
export function defaultEnabledDbMcpNames(): string[];  // init-builtin-resources 调用
```

`buildCapabilityPlan` 算法（唯一裁决处）：

1. 取全部连接器，过 `appliesTo(ctx)`（默认 true）。注意 `browserAutomationIntent` 是全局硬事实：浏览器意图下只有 browser 连接器 `appliesTo` 为真（等价旧 `onlyBrowserMcpServers`）。
2. 对未通过的连接器：把它 `ownedDbMcpNames` 全部加入 `dbMcpSkipNames`（等价旧散写 `skippedMcpNames`）。
3. 对通过的连接器：
   - `probeReadiness` → readiness（默认 `{state:'ready'}`）。
   - `resolve(ctx)`：`inProcess()` 注入 `inProcessServers`；`ownedDbMcpNames` 保留（不 skip）。
   - `buildHint(ctx, readiness)` → 非空则并入 `systemHintAppend`。
4. **R2 权限策略集中在此**：`permissionMode==='default'` 时仅对声明了写/exec 工具的连接器走 `resolve` 的只读子集（连接器自己用 `ctx.permissionMode` 决定 readOnly，如微信 `readOnly = !isDedicatedWeChatAssistantSession` 仍保留），但**不删任何读/消息连接器、不抑制任何 hint、不抑制发现提示**。删除 `chat/route.ts` 里所有 `permissionMode!=='default'` 形态的能力闸。
5. 末尾恒附**发现提示**：列出本 plan 实际加载的全部 server（DB+in-process），不再受权限模式影响（修掉旧 `:983` 的吞提示 bug）。

## 零回归迁移基线（每个连接器 = 旧(可见性, 工具来源, hint)）

| 连接器 | 旧可见性条件 | 旧工具来源 | 旧 hint 条件 | 迁移后 |
|---|---|---|---|---|
| wechat | export: `!browserAutomationIntent` 时**always skip**；assistant: `permissionMode!=='default' && !browserAutomationIntent` | `wechat-export`(DB,被skip) + `lumos-wechat-assistant`(in-process) | 同 assistant 条件，dedicated→WECHAT_ASSISTANT，否则 READONLY | `appliesTo=!browserAutomationIntent`；`ownedDbMcpNames=['wechat-export']` 恒 skip(内部后端)；in-process 恒注入，`readOnly=!dedicated`；hint 恒附(R2)，readiness 接 `/api/wechat-export` 探针只改文案 |
| goofish | 恒在 | `goofish-search`(DB, init `||` always-on) | 仅泛化发现提示且 `permissionMode!=='default'` | `defaultEnabledDbMcpNames=['goofish-search']`；`ownedDbMcpNames=['goofish-search']`；发现提示恒附(R2) |
| douyin | 恒在 | `douyin-collector`(DB, init `||`) | 同上 | `defaultEnabledDbMcpNames=['douyin-collector']` |
| x | 恒在 | `x-platform`(DB, init `||`) | 同上 | `defaultEnabledDbMcpNames=['x-platform']` |
| feishu | 恒在 | `feishu`(DB) | `permissionMode!=='default' && servers.feishu` | `ownedDbMcpNames=['feishu']`；hint 恒附(R2) |
| deepsearch | skip if `browserAutomationIntent` | `deepsearch`(DB) | `permissionMode!=='default' && servers.deepsearch` | `appliesTo=!browserAutomationIntent`；hint 恒附 |
| im-tools | 恒在 | `im-tools`(DB) | `permissionMode!=='default' && servers['im-tools']` | hint 恒附(R2) |
| chrome-devtools | 浏览器意图下唯一存活 | `chrome-devtools`(DB) | `permissionMode!=='default'` + context/automation/visible 变体 | `appliesTo` 恒真；hint(含 context/automation/visible 分支)恒附 |
| knowledge | `knowledgeEnabledForRequest && !browserAutomationIntent` | `createChatKnowledgeMcpServer`(in-process) | 同条件→CHAT_KNOWLEDGE | 原样迁 |
| butler | `isPrimaryMainAgentSession && !browserAutomationIntent` | `createLumosButlerMcpServer`(in-process) | 同条件→LUMOS_BUTLER | 原样迁 |
| lumos | `permissionMode!=='default' && !browserAutomationIntent && !legacyImage` | `createLumosMcpServer`(in-process) | 无 | 写/exec 类：R2 下 default 模式给只读子集而非整体消失（行为升级，不算回归——旧行为是 bug） |
| workflow | `isWorkflowChatSession && !browserAutomationIntent` | `createWorkflowMcpServer` | 无 | 原样迁 |
| ecommerce | `isEcommerceAssistantChatSession && !browserAutomationIntent` | `createEcommerceAssistantMcpServer` | 无 | 原样迁 |

非连接器的系统片段（`MAIN_AGENT_PRIMARY_SESSION_HINT`、`IMAGE_GEN_IN_PROCESS_HINT`）不归注册中心，留在 route。

resume + MCP 签名链路（`claude-client.ts:746-774`）**不动**：注册中心只改「装配什么」，签名仍按最终 server 集计算，工具集稳定后签名自然稳定。

## init-builtin-resources 改造

`init-builtin-resources.ts` 的 `config.name === 'workflow' || …` 硬链替换为循环外只算一次的默认启用集：
```ts
const DEFAULT_ENABLED_MCP = new Set<string>([
  /* 核心编排基础设施 */ 'workflow','deepsearch','office-docs',
  'speech-to-text','chrome-devtools','image-reader','im-tools',
  ...DEFAULT_ENABLED_DB_MCP_NAMES,            // auth-gated 连接器
]);
const isEnabled = DEFAULT_ENABLED_MCP.has(config.name);
```

**关键层级约束**：`init-builtin-resources` 是启动关键路径，**不得** `import @/lib/agent-capabilities`（那会传递性把微信助手 / 知识引擎 / 全部工具工厂在模块加载期拉进启动路径——冷启动变重 + 循环依赖风险，正是"lumos 总不稳定"的温床）。故 `defaultEnabledDbMcpNames` 抽出**零重依赖**的 `src/lib/agent-capabilities/default-enabled.ts`（仅一个常量数组，不 import 任何连接器/工厂）。`registry.defaultEnabledDbMcpNames()` 仍由连接器图派生供运行时/测试用；`registry.test.ts` 的奇偶校验把两者焊死——加了连接器忘了同步常量即测试红。新连接器声明 `defaultEnabledDbMcpNames` + 同步该常量 → 不可能再「忘记打 always-on 补丁」，注册即契约。

## 广告通道有三条，必须全部对齐（R4）

事故复盘发现 agent 的能力认知来自**三个独立通道**，每条都各自硬编码能力白名单、微信三处全漏——"修一层另一层复发"的完整真因：

1. **MCP 通道**：本文件的注册中心（in-process server + buildHint/buildDbHint + 发现提示）。
2. **SDK Skills 通道**：`public/skills/*.md` → `seedBuiltinSkills` → db.skills（`importSkills` 对每个文件 `is_enabled:true`，**无白名单闸**）→ `syncSkillsToPlugin()` → `~/.lumos/skills-plugin/` → claude-client 作为 SDK plugin 加载 → **SDK 把 skill 清单注入系统提示**。agent 常锚定这份清单（"根据系统提示里的可用 Skills…"）。旧状态：有 `douyin-collector.md`、`feishu-operations.md` **独缺 wechat** → 即便 MCP 通道已恒挂微信工具，锚 Skills 清单的 agent 仍说"没有微信 Skill"并误抓 `goofish_get_inbox`。
3. **Ask 模式工具许可通道**：纯问答模式 `permissionMode='default'`，系统提示注入一句"You may use only …/Do not use any tools."。旧 `buildAskModeToolAllowance`（chat/route.ts）只给 knowledge / 主agent 开口子，**漏微信**。结果：即便 MCP 通道恒挂微信工具+hint（R2），Ask 提示词命令模型"只准回文本/只准用知识与管家工具"，模型守规矩拒调微信工具、回答"没有微信能力"。这是同一非对称白名单 bug 的第三处。

**强制规则（R4 三通道对齐）**：任何对 agent 暴露工具面的连接器，三通道都要有项：
- MCP 侧注册连接器；
- Skills 侧提供 `public/skills/<name>.md`（金标准 `douyin-collector.md`）；
- Ask 侧在连接器定义实现 `askModeReadAllowance`（仅当其只读工具在 Ask 安全时返回措辞）。

落地：微信已补 `public/skills/wechat-assistant.md`（明确"不要拿闲鱼/抖音替代微信"）；`buildAskModeToolAllowance` 删除，Ask 许可由注册中心 `buildAskModeAllowance(ctx)` 统一裁决，knowledge/butler/wechat 措辞收进各自连接器（与旧实现逐字一致 + 补微信）。Skills 无启用白名单、`.md` 在即对齐。回归守卫：`__tests__/skills-parity.test.ts`（Skills 通道）、`__tests__/registry.test.ts` 的「R4 第三通道」组（Ask 许可含微信、零回归）。

## R5：in-process 工具集必须是会话稳定属性的纯函数

`claude-client` 的 resume 机制按 MCP「签名」决定是否复用 CLI 会话；
`buildMcpSignatureConfig` 对 in-process server **只用 server 名**算签名
（`{command:'__lumos_in_process_mcp__', args:[name]}`），**抓不到工具集
/配置变体**。

推论（强制规则）：连接器 `inProcess` 产出的 server，其工具集与行为
**只能依赖会话生命周期内不变的事实**（如 isDedicated/会话类型）。
**严禁**依赖每轮可变量（permissionMode、knowledge tagIds、用户选择…）
切换 in-process 工具集——名字不变 → 签名不变 → resume 把旧变体带进
新一轮，变更被静默击穿。模式级限制（如 Ask 不写）必须放在**每轮重建、
resume 安全**的层：系统提示总钳（已实现）或 canUseTool 权限层；不在
连接器 toolset 选择里做 resume 不安全的变体。

微信据此修正：`isWeChatReadOnly` 只依赖 `isDedicatedWeChatAssistantSession`
（会话稳定），不再耦合 permissionMode；Ask 只读由提示总钳兜。

**根治实现（变体指纹注入 resume 签名）**：契约新增
`ConnectorResolution.inProcessVariantKey` 与 `CapabilityPlan.inProcessVariantKeys`；
连接器若行为依赖每轮可变输入，在此返回其稳定序列化。链路：registry
按 serverName 收集 → route 经 `streamClaude({inProcessVariantKeys})` →
`buildMcpSignatureConfig` 把变体并入该 server 的签名
（`args:[name]` → `args:[name, variantKey]`）。效果：变体变则签名变 →
resume 自动起新会话拿到新配置；不变则照常 resume，**无变体的 server
签名与改造前完全一致（零额外开销/零回归）**。
- knowledge 已声明 variantKey = `{tagIds(已排序), overrides}` 稳定序列化
  → 修掉「会话中途改知识库范围/检索参数 resume 仍按旧范围」预存 bug。
- 微信/管家/工作流等行为只依赖会话稳定量 → 不声明 variantKey（正确）。
- 回归守卫：`registry.test.ts`「R5 in-process 变体指纹」组。

## R6：连接器故障隔离（一个坏连接器不得炸掉整张能力计划）

`probe()` 早有 try/catch 降级，但 `buildCapabilityPlan` 里
`def.resolve(ctx)` / `resolution.inProcess()` / `def.buildHint()` **无保护**：
任一 in-process 工厂（createChatKnowledgeMcpServer / createWeChatAssistant…
构造时可能碰 DB/服务）抛错 → 整个 plan 抛 → 整个聊天 500 → 用户
**因一个连接器构造失败而失去全部能力**。这正是"lumos 总不稳定"的一类
（不对称脆弱点：探针有降级、工厂没有）。

强制规则：注册中心所有"遍历连接器并调其回调"的函数
（`buildCapabilityPlan` / `buildDbServerHints` / `buildAskModeAllowance`）
必须**逐连接器 try/catch**——抛错记 warn、跳过该连接器、继续为其余
构建。宁可少一个连接器，也不让整个 agent 因单点失败而瘫。回归守卫：
`registry.test.ts`「R6 故障隔离」组（注入抛错工厂，断言 plan 不抛且
其余连接器仍在）。

## 验收（Task #6 / R4 / R5 / R6）

- 单测：R1 不变量（任一连接器 `appliesTo` 传入 readiness 翻转的 ctx，结果不变）；R2（`permissionMode='default'` 下 wechat/feishu/im/deepsearch hint 与发现提示仍在）；R3（命名空间隔离，无 wechat 时不产出 goofish 工具作为替代——靠恒附发现提示+wechat hint 让模型说真话）。
- 既有测试全绿；`tsc` 通过。
- 手工矩阵：{Ask, Code, Plan} × {fresh, resume} × {主agent, 微信专属, 普通} 下微信读能力集恒定、发现提示恒在。
