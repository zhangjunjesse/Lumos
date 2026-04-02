# 001-RFC: Provider 服务商系统重构

| 字段 | 值 |
|------|---|
| 序号 | 001 |
| 类型 | RFC（Request for Comments） |
| 主题 | Provider 服务商系统重构 |
| 状态 | active（不可删除） |
| 版本 | v1.7 |
| 更新时间 | 2026-03-24 21:13 |
| 作者 | Codex GPT-5 |
| 变更记录 | v1.0 初稿; v1.1 解决待确认问题; v1.2 深化抽象; v1.3 收口产品边界，修正能力定义与状态模型; v1.4 增加 Claude 双认证方式与本地 auth 范围决策; v1.5 明确“用户选择具体配置”语义，并收口 `provider_type + auth_mode` 架构边界; v1.6 采纳架构 review，保留内部 `anthropic`、拆分 Runtime Bootstrap、补齐删除级联和迁移策略; v1.7 补齐 `api_protocol` 迁移、显式点名 `chat_sessions.provider_id`、明确 Bootstrap 调用关系、收口实施范围 |

---

## 一、本版结论

这版先把 7 件事定死，后续实现都按这 7 条执行：

1. Lumos 主聊天和工作流，统一走 Lumos 内置的 Claude 沙箱运行环境，不走普通的“直接请求一个聊天接口”模式。
2. 用户可以配置多个服务商，但主聊天里只能选择具备 `agent-chat` 能力的服务商；`agent-chat` 不限品牌，任何通过 Agent SDK 兼容测试的配置都可标记。
3. `gemini-image` 不属于聊天服务商，不进入聊天选择器，只作为 `image-gen` 补充能力使用。
4. 不新增 `is_default` 字段。“当前正在使用哪个服务商”必须由配置项决定，不能再由 provider 行上的布尔字段决定。
5. 如果系统确实需要区分“Lumos 内置”和“用户自己添加”，使用 `provider_origin` 表达来源，不再使用容易误解的 `is_builtin` / `is_default` 命名。
6. 当用户选择的是面向用户显示为 Claude 的配置时，该配置必须支持两种认证方式：`api_key` 和 `local_auth`；内部 `provider_type` 保持为 `anthropic`。
7. `local_auth` 的默认方向是 Lumos 沙箱内登录态；是否额外支持读取宿主机全局 Claude 登录态，作为后续兼容决策单独讨论。

---

## 二、为什么要改

当前系统的主要问题不是“服务商不够多”，而是概念混在一起了，导致 UI、状态、运行时都容易出错。

### 2.1 现在混在一起的 4 个概念

1. Claude 运行环境
2. 服务商配置
3. 当前生效的服务商
4. 补充能力服务商

这 4 个概念现在在代码和文档里交叉出现，用户会看到很多看似相近、实际含义完全不同的词，例如：

- 内置
- 默认
- 当前使用
- 激活
- 聊天服务商
- 图片服务商

如果不先把这些概念拆开，后面继续叠功能，只会不断出现下面这类问题：

- 设置里切换了服务商，但聊天界面还是旧的
- 某个服务商能做摘要，却被错误地显示在主聊天列表里
- `gemini-image` 这种补充能力被误当成聊天服务商
- 文档写“主聊天只允许 A”，UI 又实现成“主聊天显示 A 和 B”

### 2.2 这次重构真正要解决什么

本次不是单纯增加几个新服务商，而是要完成 3 个产品层面的统一：

1. 统一“主聊天”和“补充能力”的边界
2. 统一“当前生效服务商”的真相源
3. 统一“服务商配置”和“Claude 运行环境”的展示方式

---

## 三、概念定义

### 3.1 Claude 运行环境

Claude 运行环境指的是 Lumos 自带的 Claude 执行环境，它有以下特征：

- 由 Lumos 内置和维护
- 运行在 Lumos 沙箱里
- 与用户本机已安装的 Claude 完全隔离
- 负责主聊天、工作流、工具调用、持续会话

“走 Agent SDK”的产品含义可以直接理解为：

> Lumos 不是单次发一个聊天请求，而是通过内置的 Claude 智能体运行链路，持续管理会话、工具调用和上下文。

因此，主聊天对服务商的要求，会高于普通文本生成。

### 3.2 服务商配置

服务商配置指的是一条可以被 Lumos 选择使用的接口配置记录，包含：

- 名称
- base URL
- 认证方式
- 支持的模型列表
- 支持的能力
- 协议类型

它解决的是“请求发到哪里、怎么认证、能用哪些模型”的问题。

服务商配置不等于 Claude 运行环境。

聊天里，用户选择的也是“具体配置项”，不是抽象品牌名。

例如用户真正看到和选择的应当是：

- `Claude - API Key`
- `Claude - 本地登录`
- `OpenRouter - 生产`
- `MiniMax - 备用`

运行时按这条配置自身的字段执行，不让用户再额外理解底层判断逻辑。

为兼容现有实现，本版约定：

- 内部 `provider_type` 继续保留 `anthropic`
- 面向用户的显示名统一使用 `Claude`
- 文档提到“Claude 配置”时，默认指 `provider_type = anthropic` 且在 UI 中显示为 Claude 的配置

### 3.3 补充能力

补充能力是指不承担主聊天职责、但可被系统单独调用的能力，例如：

- 图片生成
- 摘要和轻量文本生成
- 向量嵌入

这类能力可以有自己的服务商配置，但不应该自动出现在主聊天服务商列表里。

### 3.4 用户能不能选择不同服务商

可以，但要分场景：

1. 主聊天里，用户只能在“可用于主聊天”的服务商中选择。
2. 图片生成等补充能力，有自己的独立服务商配置，不和主聊天混在一起。
3. 同一个服务商能否同时出现在多个场景里，取决于它声明了哪些能力。

### 3.5 Claude 配置的认证方式

当一条配置内部 `provider_type = anthropic`，且在 UI 中作为 Claude 配置展示时，需要额外区分“怎么认证”。

本版统一定义两种认证方式：

| 认证方式 | 含义 | 适用场景 |
|----------|------|---------|
| `api_key` | 用户手动填写 API Key，可选填写 base URL | Claude API、企业中转、兼容网关 |
| `local_auth` | 使用 Claude 本地登录态，不要求用户手填 API Key | 已登录 Claude 账号的 Lumos 用户 |

这两种方式都属于“Claude 配置”，但它们不是一回事：

- `api_key` 解决的是“显式凭证”
- `local_auth` 解决的是“已登录状态复用”

后续所有 UI、运行时、测试逻辑，都必须先识别 `auth_mode`，再决定怎么启动。

### 3.6 合法组合

系统允许的配置组合如下：

| `provider_type` | `auth_mode` | 是否允许 |
|-----------------|-------------|----------|
| `anthropic` | `api_key` | 是 |
| `anthropic` | `local_auth` | 是 |
| 非 `anthropic` | `api_key` | 是 |
| 非 `anthropic` | `local_auth` | 否 |

也就是说，`local_auth` 不是“所有服务商都能选的第二种登录方式”，而是 Claude 配置专属的认证模式。

---

## 四、能力模型

为避免继续使用难理解的 `chat` / `chat-lite` 命名，本版改为更直接的能力名称。

### 4.1 能力定义

| 能力 | 面向用户的含义 | 允许出现在主聊天选择器 | 说明 |
|------|----------------|------------------------|------|
| `agent-chat` | 可用于 Lumos 主聊天和工作流 | 是 | 必须满足 Agent SDK 的完整要求 |
| `text-gen` | 可用于摘要、分析、轻量文本生成 | 否 | 只要求普通文本生成可用 |
| `image-gen` | 可用于图片生成 | 否 | 单独配置和调用 |
| `embedding` | 可用于向量嵌入 | 否 | 知识库等模块使用 |

### 4.2 兼容规则

1. `agent-chat` 服务商，可以同时服务 `text-gen` 需求。
2. `text-gen` 服务商，不能反向进入主聊天。
3. `image-gen` 服务商，永远不进入聊天服务商列表。

### 4.3 对 `gemini-image` 的明确决议

`gemini-image` 的产品定位是：

- 类型：补充能力服务商
- 能力：仅 `image-gen`
- 展示位置：图片生成配置区
- 禁止行为：出现在聊天模型选择器、主聊天服务商列表、工作流主执行模型列表

迁移时应将其能力写为：

```json
["image-gen"]
```

而不是任何带聊天含义的组合。

---

## 五、核心产品决策

### 5.1 主聊天与工作流的执行边界

Lumos 主聊天和工作流都基于内置 Claude 运行环境执行。

这意味着：

- 主聊天不是“任意模型都能接”
- 只有满足 Agent SDK 运行要求的配置，才允许成为主聊天服务商
- 如果某个服务商只能完成普通文本生成，它可以作为补充能力使用，但不能进入主聊天

需要强调：

- `agent-chat` 是能力，不是品牌
- MiniMax、Kimi、Anthropic 或其他品牌，只要通过兼容测试，都可以进入主聊天列表

### 5.2 聊天场景里，用户到底能选什么

聊天输入框中的 Provider + Model 选择器，只显示具备 `agent-chat` 能力的已配置服务商配置。

不会显示：

- `text-gen` only 服务商
- `image-gen` 服务商
- 仅用于知识库、摘要、图片生成的服务商

这样用户看到的就是“真正能用于当前聊天的配置列表”，而不是“系统里全部的 API 配置”。

用户选中某条配置后，运行时只看这条配置本身：

- 如果是 `anthropic + local_auth`，就走本地登录态
- 如果是 `anthropic + api_key`，就走 API Key
- 如果是其他服务商，就按它自己的 `auth_mode` 规则走

### 5.3 切换聊天服务商时的会话规则

主聊天的会话上下文和服务商绑定。

原因是：

- Agent 运行过程依赖会话文件和运行时环境
- 切换服务商本质上等于切换 endpoint、认证和模型族
- 旧上下文不能保证无损延续

因此决议如下：

1. 已有会话的服务商由 `session.provider_id` 决定。
2. 用户在聊天中切换服务商时，必须开启新会话。
3. 旧会话继续保留，并继续绑定旧服务商。
4. 不做自动 fallback，也不偷偷替换成别的服务商。

### 5.4 当前生效服务商的唯一真相源

这部分必须彻底收口。

#### 全局默认

全局默认服务商由：

```text
settings.default_provider_id
```

决定。

#### 模块默认

模块级覆盖由：

```text
settings.provider_override:{module}
```

决定。

这里的 `{module}` 统一按模块名命名，不按能力名命名。

本版建议固定为：

- `chat`
- `knowledge`
- `workflow`
- `image`

#### 会话内选择

聊天会话内使用哪个服务商，由：

```text
session.provider_id
```

决定。

#### 明确禁止

以下字段不再承担“当前生效服务商”的业务语义：

- `is_builtin`
- `is_active`
- 新增 `is_default`

如果兼容阶段暂时保留这些字段，也只能作为迁移或排序辅助，不能再作为读取链路的依据。

#### 删除规则

删除 provider 时，必须做引用检查：

1. 如果该 provider 被 `settings.default_provider_id` 引用，禁止直接删除，要求用户先切换默认服务商。
2. 如果该 provider 被任一 `settings.provider_override:{module}` 引用，禁止直接删除，要求用户先调整对应模块配置。
3. 如果历史会话的 `session.provider_id` 指向该 provider，可以允许删除，但恢复该会话时 Resolver 必须返回明确错误，提示“原服务商已删除，请重新选择配置开启新会话”。

### 5.5 是否还需要“系统内置”这个概念

需要，但它表达的不是“当前默认”，而是“来源”。

Lumos 的内置 Claude 运行环境和内置推荐配置，确实有特殊生命周期，例如：

- 首次安装自动生成
- 升级时可能补充官方模型列表或推荐 URL
- 可以提供“恢复内置配置”的操作

因此本版保留“系统来源”这个概念，但不再用布尔默认字段表达。

对于 `provider_origin = system` 的配置，升级策略如下：

- 只补充新模型和系统元信息
- 不覆盖用户已经修改过的字段
- 是否被用户改过，继续通过 `user_modified` 判断

### 5.6 Claude 配置的双认证规则

当用户选择的是内部 `provider_type = anthropic`、UI 中显示为 Claude 的配置时，表单和运行时都必须支持两种认证模式：

#### 模式一：`api_key`

规则如下：

1. 用户手动填写 API Key。
2. 可选填写 base URL。
3. 运行时按现有 provider 配置注入认证信息。

#### 模式二：`local_auth`

规则如下：

1. 不要求用户填写 API Key。
2. 运行时使用 Claude 登录态。
3. UI 必须展示登录状态，而不是只展示“是否填写了 Key”。
4. 如果登录态失效，必须给出及时且友好的提示。
5. 每次真正启动聊天或工作流前，运行时都必须先做一次认证可用性检查；失败时直接返回结构化的“需要重新登录”错误，不允许静默降级。

### 5.7 `local_auth` 读哪里

这个问题单独说明。

#### 当前建议

优先使用 Lumos 沙箱内的 Claude 登录态。

原因：

1. 你前面已经明确要求 Lumos 必须与本机 Claude 隔离。
2. 现有运行时已经支持 `CLAUDE_CONFIG_DIR` 指向 Lumos 自己的沙箱配置目录。
3. 如果直接读取宿主机全局 `~/.claude`，会破坏隔离边界，也会引入更多“为什么本机状态影响 Lumos”的理解成本。

#### 后续可讨论的兼容方案

后续可以再评估是否支持：

- 读取宿主机全局 Claude 登录态
- 或者从宿主机导入一次登录态到 Lumos 沙箱

但这些都只能作为兼容能力，不能成为默认设计。

---

## 六、数据模型

### 6.1 `api_providers` 表目标字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider_type` | TEXT | 品牌或服务商标识，如 `anthropic`、`openrouter`、`minimax`、`gemini-image` |
| `api_protocol` | TEXT | 协议类型，如 `anthropic-messages`、`openai-compatible` |
| `capabilities` | TEXT | JSON 数组，声明该记录支持的能力 |
| `provider_origin` | TEXT | 来源，取值 `system` / `preset` / `custom` |
| `auth_mode` | TEXT | 认证方式，取值 `api_key` / `local_auth` |

### 6.2 不采用的字段方案

本版明确不采用：

| 字段 | 原因 |
|------|------|
| `is_default` | 容易与“当前生效默认服务商”混淆 |
| `is_builtin` 作为长期核心语义 | 只能表达布尔状态，不能表达来源分类 |

### 6.3 来源字段说明

| `provider_origin` | 含义 | 示例 |
|-------------------|------|------|
| `system` | Lumos 内置并维护的系统配置 | 内置 Claude 官方配置 |
| `preset` | 用户基于官方预设新增的配置 | 用户添加的 MiniMax 模板 |
| `custom` | 用户手动创建的配置 | 用户自行填写的中转服务 |

### 6.4 认证字段说明

| `auth_mode` | 含义 | 说明 |
|-------------|------|------|
| `api_key` | 通过显式 Key 认证 | 默认模式，适用于多数服务商 |
| `local_auth` | 通过 Claude 本地登录态认证 | 仅适用于 `provider_type = anthropic` |

本版建议：

- `local_auth` 仅对 `provider_type = anthropic` 开放
- 其他服务商和自定义兼容端点，不提供 `local_auth`

这是当前版本的约束，不排除后续扩展更多认证方式。

例如未来如需支持：

- AWS IAM
- GCP Service Account
- 企业内部 SSO Token

都可以通过扩展 `auth_mode` 枚举实现。

### 6.5 `chat_sessions` 会话真相源字段

`chat_sessions.provider_id` 是聊天会话的服务商真相源字段。

说明如下：

- 新会话创建时可为空，随后由默认服务商解析结果或用户选择写入
- 已有会话恢复时，优先读取该字段
- 该字段已通过现有 migration 补齐，RFC 在此明确其为长期保留字段，而不是新增临时字段

### 6.6 状态字段的目标语义

| 场景 | 真相源 |
|------|--------|
| 当前全局默认服务商 | `settings.default_provider_id` |
| 某模块的默认服务商 | `settings.provider_override:{module}` |
| 某聊天会话的服务商 | `session.provider_id` |

这三条规则足够表达业务，不再需要在 provider 记录本身维护“谁当前正在生效”的状态。

需要注意：

- settings key 按模块名命名
- capability 只用于校验“这条配置能不能服务这个模块”
- 不能把两套命名混在一起

### 6.7 迁移规则

| 现有数据 | 目标写法 |
|---------|---------|
| `provider_type = anthropic` | 保持 `anthropic`，`api_protocol = "anthropic-messages"` |
| `provider_type = openrouter` | 保持 `openrouter`，`api_protocol = "openai-compatible"` |
| `provider_type = bedrock` | 保持 `bedrock`，`api_protocol = "anthropic-messages"` |
| `provider_type = vertex` | 保持 `vertex`，`api_protocol = "anthropic-messages"` |
| `provider_type = custom` | 保持 `custom`，默认 `api_protocol = "anthropic-messages"` |
| `provider_type = gemini-image` | 保持 `gemini-image`，`api_protocol = "openai-compatible"`，`capabilities = ["image-gen"]` |
| `is_builtin = 1` | `provider_origin = "system"` |
| 用户从预设新增的配置 | `provider_origin = "preset"` |
| 用户手工新建的配置 | `provider_origin = "custom"` |
| 现有 Anthropic / Claude 配置 | 默认 `auth_mode = "api_key"` |
| 旧 `anthropic_auth_token / anthropic_base_url` | 迁移为一条 `anthropic + api_key` 配置，迁移完成后不再作为长期运行时真相源 |

兼容阶段可以保留 `is_builtin` 和 `is_active`，但新代码不再基于它们做解析。

旧 app-level Anthropic 设置在迁移完成后应进入废弃状态：

- 只用于一次性迁移
- 不再作为运行时 fallback
- UI 不再把它当作独立配置入口

---

## 七、核心模块职责

### 7.1 Registry

Registry 负责维护官方预设模板。

每条预设至少包含：

- 名称
- 默认 URL
- 协议
- 能力
- 默认模型列表
- 说明文案

它解决的是“系统预置了哪些可选模板”，不是“当前正在用哪个”。

对面向用户显示为 Claude 的 `anthropic` 配置，Registry 允许提供两条内置模板：

- `Claude - API Key`
- `Claude - 本地登录`

### 7.2 Resolver

Resolver 负责在不同场景下，解析出最终应该使用哪条服务商配置。

#### 解析原则

1. 先看当前场景是否已经显式绑定
2. 再看模块覆盖
3. 最后看全局默认
4. 全程校验能力是否匹配
5. 不做静默 fallback

Resolver 的职责只到“选出哪条配置”为止。

Resolver 不负责：

- 判断本地登录态是否还有效
- 拼接认证环境变量
- 决定 `provider_type + auth_mode` 是否是合法启动组合

这些属于运行时和测试层职责。

模块级 override 只负责“这个模块优先用哪条配置”，不负责定义 capability 本身。

#### 不同场景的解析顺序

| 场景 | 解析顺序 |
|------|---------|
| 聊天已有会话 | `session.provider_id` |
| 新聊天会话 | `settings.default_provider_id` |
| 知识库/摘要 | `provider_override:knowledge` → `default_provider_id` |
| 图片生成 | `provider_override:image`，未配置则直接报错 |
| 工作流 Agent | `taskOverride` → `workflowOverride` → `provider_override:workflow` → `default_provider_id` |

解析时：

- key 用模块名
- 资格校验用 capability

例如：

- `provider_override:image` 必须指向具备 `image-gen` 能力的配置
- `provider_override:knowledge` 对应的具体 capability 由调用点声明，而不是模块名固定死

典型映射可参考：

| 模块 key | 常见调用点 | capability 校验 |
|---------|-----------|-----------------|
| `chat` | 主聊天、会话续写 | `agent-chat` |
| `knowledge` | 摘要/改写 | `text-gen` |
| `knowledge` | 向量检索/嵌入 | `embedding` |
| `workflow` | Agent 主执行模型 | `agent-chat` |
| `image` | 图片生成 | `image-gen` |

### 7.3 Provider Factory

Provider Factory 负责把“服务商配置”转成“provider 相关调用对象”。

它只处理跟 provider 直接相关的内容，不处理全局运行时细节。

Provider Factory 在进入真正调用前，必须先校验配置组合是否合法。

例如：

- `anthropic + local_auth` 合法
- `anthropic + api_key` 合法
- `openrouter + local_auth` 非法，应直接报配置错误

#### 输出一：轻量模型实例

| 方法 | 产出 | 用途 |
|------|------|------|
| `createLanguageModel(provider, modelId)` | 可直接调用的 LanguageModel | 摘要、轻量文本生成、分析等 |

#### 输出二：Provider 认证产物

| 方法 | 产出 | 用途 |
|------|------|------|
| `buildProviderEnv(provider)` | `{ env, authMode, providerMeta }` | 主聊天、工作流、轻量调用前的 provider 注入 |

这样可以把下面几件事收在同一层：

- 服务商对应的环境变量注入
- `local_auth` 与 `api_key` 的认证分流
- provider 级合法性校验

### 7.4 Runtime Bootstrap

Runtime Bootstrap 负责把 Provider Factory 的结果组装成“可实际启动 Agent 运行时”的对象。

它处理的是不随 provider 变化、但随运行环境变化的内容，例如：

- Claude CLI 路径解析
- `settingSources` 生成
- sandbox 路径准备
- 聊天/工作流启动前的 preflight

建议输出：

| 方法 | 产出 | 用途 |
|------|------|------|
| `buildAgentRuntimeBootstrap(provider, sessionId?)` | `{ activeProvider, env, settingSources, pathToClaudeCodeExecutable }` | 主聊天、工作流的 Agent 运行 |

其中：

- Runtime Bootstrap 内部调用 Provider Factory 获取 provider 相关 env
- CLI 路径、settingSources、preflight 由 Runtime Bootstrap 负责

### 7.5 Tester

Tester 负责做最小代价的连接测试。

原则如下：

- 只验证连接与认证，不做完整模型探测
- 超时短，结果明确
- 按协议决定测试方式
- 失败时返回可展示给用户的错误信息

对于 `local_auth`，Tester 还需要承担“登录态可用性检查”的职责。

但 Tester 只负责手动测试入口。

真正启动聊天和工作流前，Runtime 仍然必须独立做一次 preflight，不能依赖用户是否点过“测试连接”。

---

## 八、UI 方案

### 8.1 设置页的信息架构

设置页建议统一为一个页面，名字沿用当前更易理解的方向，例如：

```text
Claude 与服务商
```

页面分为 3 个区块：

#### A. Lumos 内置 Claude 运行环境

此区块属于远期规划，不在本次 Phase 1-6 的实施范围内。

展示内容：

- 当前内置运行环境版本
- 是否正常可用
- 更新入口
- 修复入口
- 与本机 Claude 隔离的说明

这个区块回答的是“Lumos 自己的 Claude 环境是否正常”。

#### B. 主聊天服务商

展示内容：

- 当前全局默认聊天服务商
- 所有具备 `agent-chat` 能力的已配置服务商配置
- 切换默认服务商
- 编辑、测试连接、删除

这个区块回答的是“主聊天要走哪个服务商”。

#### C. 补充能力服务商

按能力拆开：

- 图片生成
- 轻量文本生成
- 嵌入

这里可以单独配置默认服务商，不和主聊天混排。

### 8.2 聊天界面

聊天输入框附近保留 Provider + Model 二级选择，但只显示 `agent-chat` 服务商。

交互规则：

1. 切换服务商时，弹出“将创建新会话”的确认提示。
2. 切换后自动新建会话，并绑定新的 `provider_id`。
3. 聊天顶部不再额外展示与当前聊天无关的补充能力服务商信息。

### 8.3 Claude 配置表单

当配置的 `provider_type = anthropic` 且 UI 中显示为 Claude 时，编辑表单需要多一个“认证方式”选择：

1. `API Key`
2. `本地登录`

不同模式下表单行为不同：

#### 选择 `API Key`

- 展示 API Key 输入框
- 展示可选 base URL
- 显示测试连接按钮

#### 选择 `本地登录`

- 隐藏 API Key 输入框
- 展示当前登录状态
- 提供登录、重新登录、刷新状态入口
- 明确提示当前登录态属于 Lumos 沙箱还是宿主机来源

### 8.4 图片生成入口

图片生成入口只读取 `image-gen` 服务商配置。

不得出现以下情况：

- 聊天模型列表里出现 `gemini-image`
- 因为聊天默认服务商变化，导致图片服务商被隐式改掉

---

## 九、实施计划

### Phase 1：先收状态模型

1. 明确 `default_provider_id` 为全局默认真相源
2. 聊天统一使用 `session.provider_id`
3. 新逻辑停止依赖 `is_active`
4. 将 `claude-client.ts`、`text-generator.ts` 等消费端中的 `getActiveProvider()` 调用改为读取 `default_provider_id` 或场景化 Resolver

### Phase 2：补齐数据结构

1. 保持内部 `provider_type = anthropic`
2. 增加 `api_protocol`
3. 增加 `capabilities`
4. 增加 `provider_origin`
5. 增加 `auth_mode`
6. 完成旧数据迁移

### Phase 3：拆主聊天与补充能力

1. 聊天只接入 `agent-chat`
2. 图片生成独立读取 `image-gen`
3. 摘要/轻量文本生成读取 `text-gen`

### Phase 4：打通 `api_key` 主链路

1. `anthropic` 配置统一走新的 provider 架构
2. Runtime 按 `auth_mode = api_key` 打通主链路
3. 删除运行时对旧 app-level Anthropic token 的隐式 fallback

### Phase 5：补齐 `local_auth`

1. Claude 配置表单增加 `api_key / local_auth` 切换
2. 增加登录、重新登录、状态检测 UI
3. Runtime 增加 `local_auth` preflight
4. 完成 token 存储、失效提示、沙箱登录态读取

### Phase 6：统一设置页与运行时

1. 设置页统一展示 Claude 运行环境和服务商
2. Provider 切换规则与聊天运行时保持一致
3. 清理历史冗余判断和分叉逻辑

---

## 十、风险与注意事项

### 10.1 Agent 兼容性仍需实测

不是所有标称兼容 Claude 接口的服务商，都能稳定满足 `agent-chat` 要求。

因此：

- `agent-chat` 能力必须保守发放
- 先通过测试，再进入主聊天列表

### 10.2 旧状态字段会造成实现误判

如果迁移后代码仍继续混用：

- `is_active`
- `default_provider_id`
- `session.provider_id`

那么设置页、聊天页、工作流页仍然会出现状态不一致。

因此本次实现必须明确：读取链路只认新的真相源，不认旧布尔字段。

### 10.3 模型列表不是“系统猜的”，而是“跟服务商绑定的”

同一个模型名在不同服务商下，实际能力和底层路由可能不同。

因此：

- 模型列表必须按服务商绑定
- 切换服务商时自动切换到该服务商的默认模型
- UI 要尽量让用户知道“我选的是哪个服务商下的哪个模型”

### 10.4 `local_auth` 失效提示不能缺失

如果用户选择的是 `local_auth`，但登录态失效，系统不能只在底层失败。

必须做到：

- 能检测到登录态是否可用
- 在设置页给出明确状态
- 在聊天或执行前及时提示
- 提供重新登录入口

---

## 十一、最终判断

如果只用一句话概括本版方案：

> Lumos 的主聊天是“内置 Claude 运行环境 + 可切换的聊天服务商配置 + 可选的 Claude 双认证方式”，而图片生成、摘要、嵌入等都属于独立的补充能力，不再混进主聊天服务商体系。
