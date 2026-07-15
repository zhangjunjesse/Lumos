# AI 对话团队 — 需求设计方案

> 状态:设计定稿(2026-07-15,三个产品分叉已由用户拍板)
> 关联:`docs/app-platform-design.md`(应用平台)、etsy-forge 出图团队(引擎前身,v0.38.3)

## 1. 背景与目标

现状:侧边栏「工作流→团队」(/workflow/agents)只是一个按部门分组的**成员人设库**(templates 表 type='agent-preset'),没有 SOP、没有协作关系、不能执行——是"假团队"。真正的团队引擎(SOP + 队长派单 + SDK 原生子代理)已在 etsy-forge 出图团队中实现并真机验证(v0.38.3:stdio 出图通道、合批派单、超时部分交差)。

目标:把团队升级为**平台级能力**——
1. 现「团队」菜单改名「成员」:全局成员(Agent 人设)库。
2. 新增「团队」菜单:管理多个团队,每个团队 = SOP + 成员编排 + 模型设置。
3. AI 对话支持团队:开会话时选团队,整个会话由该团队协作完成(**会话级绑定**)。

## 2. 概念模型

```
成员(全局资产,templates 表升级)        团队(新实体)                    团队会话(执行)
┌──────────────────┐          ┌──────────────────────┐      ┌────────────────────┐
│ 名字/头像          │          │ 名称/描述              │      │ 队长 = 主会话        │
│ 职能(一句话,派单依据)│ ←引用─── │ SOP(队长工作手册)       │ ───→ │ 成员 = SDK 子代理    │
│ 人设提示词          │          │ 成员引用[{id,enabled}]  │      │ 协作全在 SOP 里      │
│ 能力权限(工具授权)   │          │ 团队级 provider/model  │      │ 引擎只管组装/护栏/交差│
│ 偏好模型(档位)      │          │ is_default            │      └────────────────────┘
│ 部门(分组)         │          └──────────────────────┘
└──────────────────┘
```

- **成员是库,团队是引用**:一个成员可进多个团队;团队内可单独启停某成员,不改成员本体。
- **SOP 是团队的灵魂**(etsy 已验证的范式):分工、工序、派单顺序、质量标准、失败应对全部写在 SOP 里,由队长执行;引擎不预设任何流程。`{N}` 之类占位符机制沿用。
- **etsy-forge 出图团队不并入**:它是应用私有数据(印花专用人设+出图护栏),与平台团队共用底层运行时,互不迁移。

## 3. 数据设计

### 3.1 成员:templates 表(type='agent-preset')补字段,零迁移

| 新增字段 | 说明 |
|---|---|
| `duty` TEXT | 职能一句话——队长派单的依据(等价 etsy TeamMember.duty) |
| `tool_grants` TEXT(JSON) | 能力授权,见 §5.3;缺省 = 安全集 |

现有 name/system_prompt/preferred_model/provider_id/department_id 原样复用。老数据 duty 为空时,UI 提示补填;运行时为空则用 description 兜底。

### 3.2 团队:新表 `lumos_teams`

```sql
CREATE TABLE lumos_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  sop TEXT DEFAULT '',                -- 队长工作手册
  member_refs TEXT NOT NULL DEFAULT '[]',  -- [{presetId, enabled}]
  provider_id TEXT DEFAULT '',        -- 团队会话服务商;空=全局默认
  model TEXT DEFAULT '',              -- 团队会话模型;空=服务商默认
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.3 会话:`sessions` 表加 `team_id`(可空)

空 = 普通聊天(现有行为完全不变);非空 = 团队会话。团队被删后旧会话保留可读,但不能继续发消息(提示团队已不存在)。

## 4. 菜单与 UI

### 4.1 侧边栏(sidebar.tsx 自动化区块)

```
自动化
├── 工作流   /workflow
├── 任务     /workflow/schedules
├── 成员     /workflow/agents   ← 改 label + 图标,路由/数据不动
└── 团队     /teams             ← 新增
```

### 4.2 团队管理页 /teams

交互直接复刻 etsy TeamsTab(已验证):左列团队列表(新建/选中/默认标);右侧名称/描述、SOP 编辑器(textarea + 占位符说明)、成员编排(从成员库多选 + 每成员启停开关 + 跳转编辑成员本体)、ProviderPickerRow 模型设置。**成员编辑不在团队页做**——团队页只做"选人和启停",人设在成员页维护(单一职责,避免两处编辑打架)。

### 4.3 聊天集成(会话级绑定)

- 新会话入口加**团队选择器**(与模型选择器并排):不选 = 普通聊天;选中 = 团队会话。
- 团队会话视觉标识:会话标题旁团队徽标;输入框占位文案"向团队 XX 布置任务…"。
- 过程可视化:队长的发言、Task 派单块、成员交付以现有消息流渲染(SDK 子代理消息天然在流里);首期不做成员内部过程展开,只保证"看得见谁在干什么"。
- 团队会话隐藏模型选择器(模型由团队设置决定),其余聊天能力(附件、上下文)照常。

## 5. 运行时设计

### 5.1 通用团队运行时 `src/lib/team/`

从 etsy `team-session.ts` 抽取通用内核,etsy 改为薄壳调用:

```
runTeamChatSession({
  team,                 // SOP + 解析后的成员列表
  briefing,             // 本轮用户消息(+会话上下文,见 5.4)
  tools,                // 按成员 tool_grants 生成的每成员工具面
  onEvent,              // dispatch/speak/done… → 聊天消息流
})
```

队长提示词 = 硬护栏(引擎写死) + 团队 SOP + 成员花名册(职能) + 硬纪律(合批派单、每成员≤2次、如实交差) + 用户任务。结构沿用 etsy 已验证版本,去掉出图专用条款。

### 5.2 继承 v0.38.3 的三条平台纪律(血泪教训,不可回退)

1. **控制协议不可依赖**:复杂多子代理会话里 canUseTool/hook/进程内 MCP 必断(Stream closed)。团队会话一律 `permissionMode: bypassPermissions`,**权限控制全部用声明式工具清单**(Options.tools + per-agent tools),绝不用 canUseTool 回调。
2. **进程内 MCP 工具必须 stdio 化**:聊天内置工具凡走 createSdkMcpServer 的(如 generate_image),团队会话里必须换 stdio+HTTP 回调形态(etsy-team-image 是现成样板,泛化为通用 lumos-tools stdio server;护栏/计费在服务端 token 注册表)。
3. **超时不全损**:会话硬超时(30min)+ 队长未正常收尾时按事件流部分交差。

### 5.3 全量工具 + 安全闸门(用户已拍板全量)

团队会话支持与普通聊天等同的全量工具面,但**授权落在成员粒度**(声明式,不走控制协议):

| 能力组 | 工具 | 缺省 |
|---|---|---|
| 读研 | Read/Glob/Grep/WebSearch/WebFetch/知识库检索/后台浏览器 | ✅ 开 |
| 产出 | Write/Edit/出图(stdio 化后)/Office 文档 | ⬜ 关,显式授予 |
| 执行 | Bash/命令类 MCP | ⬜ 关,显式授予,UI 红色警示 |

成员编辑页用能力组开关呈现;团队会话组装时翻成每个 AgentDefinition 的 tools 数组。**bypassPermissions + Bash 的风险由"缺省关 + 显式授予 + 会话内工作目录隔离(sessionWorkspace)"三层兜住**。

### 5.4 多轮会话

团队会话的多轮 = 队长主会话 resume(SDK session resume,agents 定义不变则签名稳定;参考 memory:签名变化会丢 resume,团队编辑后的下一轮起新会话并提示)。每轮用户消息作为新任务进入队长上下文,成员子代理天然无状态(每次派单新起)。

### 5.5 成员模型

SDK AgentDefinition.model 只支持档位(sonnet/opus/haiku/inherit)。成员 preferred_model 映射到档位,映射不了的 = inherit(跟随团队会话模型)。UI 明示这个限制。

## 6. 执行链路(时序)

```
用户在团队会话发消息
→ chat route 识别 team_id → 加载团队+成员 → runTeamChatSession
→ 队长(主会话,团队 provider/model)读 SOP → Task 合批派单成员(子代理)
→ 事件流(派单/成员交付/队长发言)→ 聊天消息流实时渲染
→ 队长汇总交差(结构化或自然语言)→ 落库为 assistant 消息
```

## 7. 范围

**本期做**:成员菜单改名+duty/tool_grants 字段与编辑 UI;/teams 团队 CRUD(表+API+页面);聊天团队选择器+会话级绑定+过程可视化(消息流级);通用 team-runtime 抽取(etsy 改薄壳);进程内内置工具的团队会话 stdio 化(以 generate_image 为首)。

**本期不做**:内置示例团队(用户拍板不要);消息级临时召唤团队;工作流"团队步骤"(架构留口:team-runtime 输入不依赖聊天上下文,工作流未来可直接调);成员市场/分享;etsy 团队迁移。

## 8. 验收底线(L2 真跑)

1. 建 3 人团队(调研/写作/审核)带 SOP,团队会话布置一个任务,队长按 SOP 合批派单、成员各司其职、最终交差,全程聊天里可见。
2. 复杂团队(5+ 成员)不出现 Stream closed;超时/异常时部分交差不全损。
3. 普通聊天(不选团队)行为与现在完全一致,零回归。
4. 未授权"执行"能力的成员调不了 Bash(声明式拦截,不靠运行时回调)。
5. 团队编辑成员/SOP 后,下一轮会话生效;成员被从库里删除时团队页有明确降级提示。
