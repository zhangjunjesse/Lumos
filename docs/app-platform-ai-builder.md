# Lumos 应用 AI 创建器设计

**状态**：Draft v1
**日期**：2026-04-30
**关联文档**：[`app-platform-design.md`](./app-platform-design.md)（应用平台总体设计）
**范围**：让用户通过自然语言对话，由 LLM 协助生成、安装、迭代 Lumos 应用

---

## 1. 产品定位

### 1.1 核心差异化

主流应用市场（iOS App Store、Chrome Webstore、VSCode Marketplace）都是**开发者写代码、用户消费**的单向生态。

Lumos 应用市场的差异化在于：**用户也能写应用**——不是写代码，是用嘴说。

- "我想要一个能记录客户、自动整理订单、每周给我报告的应用"
- AI 把这句话变成完整可运行的 `.lumos-app` 包

这是 LLM 时代独有的产品形态——**自然语言驱动的应用生成**。

### 1.2 与其他创建路径的关系

应用有三种创建路径（详见主文档第 7 节）：

| 路径 | 谁用 | 什么时候用 | 难度 |
|---|---|---|---|
| **AI 创建器** | 普通用户 | 想做一个之前不存在的新应用 | 极低（说话即可） |
| **工作流提升** | 进阶用户 | 已有一个跑通的 workflow，想分享给别人 | 低（一键转换） |
| **开发者手写** | 开发者 | 长尾、复杂、商业化应用 | 高（需写代码） |

AI 创建器**不是开发者工具的简化版，是一条全新路径**。它的目标用户从来没想过"我能写应用"。

### 1.3 设计原则

1. **对话驱动**：所有交互在对话里完成，不弹复杂表单
2. **渐进具象**：从模糊需求到完整应用，多轮澄清，不一次性逼问
3. **实时可见**：生成什么立刻能看见、能用，不是黑盒输出
4. **可迭代**：用户说"再加个 X"、"把 Y 改成 Z"，AI 增量更新
5. **安全保守**：AI 生成的应用默认低权限，敏感能力必须用户显式确认
6. **失败可控**：AI 出错能自修，修不动就明确告诉用户

---

## 2. 用户体验流程

### 2.1 入口

三个入口，殊途同归：

1. **侧栏 → 应用 → "AI 创建应用"按钮** → 进入创建对话
2. **对话里直接说**："帮我做一个客户管理应用" → AI 识别意图 → 进入创建模式
3. **应用市场 → "找不到？让 AI 给你造一个"** → 创建对话

### 2.2 完整流程示例

```
[用户]
我想做一个简单的客户管理工具，能记客户信息和订单，
最好每周自动给我个总结。

[AI 创建器]
明白。在动手前我想确认几件事：

1. 客户信息要记哪些字段？（默认：姓名、电话、邮箱、状态）
2. 订单需要关联到客户吗？要记金额、日期、状态吗？
3. 每周总结想看什么？比如"新增客户数 + 待跟进列表 + 销售额"
4. 总结要发到哪？仅显示在应用里 / 推飞书 / 发邮件？

[用户]
1. 加个"标签"字段就行
2. 是的，金额日期状态都要
3. 你说的差不多
4. 推飞书

[AI 创建器]
好。我会做一个客户管理应用，结构是：

📁 customer-mgmt/
├── app.json              （飞书 MCP + LLM）
├── routes.json           （4 个菜单：客户/订单/统计/设置）
├── pages/
│   ├── customers.json    （客户列表 + 详情，带标签筛选）
│   ├── orders.json       （订单列表，按客户分组）
│   ├── stats.json        （仪表板：新增数 + 销售额）
│   └── settings.json     （配置飞书）
├── workflows/
│   └── weekly-summary.json （每周一 9:00 推飞书）
└── data-schema.json      （customers + orders 两张表）

需要你确认的权限：
✓ 调飞书 API（open.feishu.cn）
✓ 应用专属数据存储

⚠ 飞书需要你在设置页填 App ID 和 Secret，安装后我会引导。

要我开始生成吗？

[用户] 开始

[AI 创建器]
[流式生成文件，每生成一个文件即在右侧预览面板渲染]

✓ app.json
✓ data-schema.json
✓ routes.json
✓ pages/customers.json   ← [右侧弹出预览，用户能看到客户列表页]
✓ pages/orders.json      ← [预览]
✓ pages/stats.json       ← [预览，带 mock 数据]
✓ pages/settings.json    ← [预览]
✓ workflows/weekly-summary.json
✓ 自检通过：所有 schema 校验通过、workflow 引用一致

应用已生成。要现在安装试试吗？

[用户] 装

[AI 创建器]
✓ 安装成功
👉 去填一下飞书 App ID（点这里跳转）

[用户安装、填配置、试用]

[用户]
客户列表能不能加个搜索框？

[AI 创建器]
可以。我会改 pages/customers.json，给 list 加 search 字段
搜索 name 和 phone。要我直接更新吗？

[用户] 更新

[AI 创建器]
✓ 已更新，重新加载应用即可
```

### 2.3 关键体验点

- **不要逼问 schema**：用日常语言问需求，AI 内部翻译成 schema 字段
- **预览即所得**：每个文件生成完立刻渲染（哪怕用 mock 数据）
- **明示权限**：生成前告诉用户应用要哪些权限，让用户有掌控感
- **改动透明**：增量更新时告诉用户改了什么文件、哪段，可以反悔

---

## 3. 架构

### 3.1 总览

```
┌────────────────────────────────────────────────────┐
│  AI 创建器 UI（对话面板 + 实时预览面板）              │
├────────────────────────────────────────────────────┤
│  AppBuilder Agent                                  │
│  - 角色：应用架构师 + UI 设计师 + 代码生成器          │
│  - 系统能力探测：当前可用 MCP / Agent / 知识库        │
│  - 输出契约：JSON Schema 强约束                     │
├────────────────────────────────────────────────────┤
│  工具集                                             │
│  read_schema / list_capabilities / generate_xxx /  │
│  validate / preview / install / update             │
├────────────────────────────────────────────────────┤
│  复用层（已有）                                      │
│  Claude Agent SDK / Workflow Engine / MCP /        │
│  App Runtime / 应用安装器                           │
└────────────────────────────────────────────────────┘
```

### 3.2 与现有 LLM 配置整合

Lumos 的 settings 已有几个专用 LLM 配置（`src/components/settings/`）：

- `WorkflowBuilderLLMSection` — 用户用对话搭工作流
- `AgentCreationLLMSection` — 创建 Agent
- `CodifyAgentSection` — 把流程转代码
- `SchedulingAgentSection` — 调度 Agent

**新增 `AppBuilderLLMSection`**，形态一致：用户在 settings 选 Provider/模型/温度，AI 创建器走这个配置。

推荐默认：Claude Opus（生成稳定性最高，schema 遵循好）。

---

## 4. AppBuilder Agent 设计

### 4.1 System Prompt 结构

System prompt 由四块组成，**前三块静态、最后一块动态注入**：

#### 4.1.1 角色定义（静态）

```
你是 Lumos 应用构架师。用户用日常语言描述他想要的应用，
你的任务是把它转成可运行的 Lumos 应用包（manifest + 工作流 + UI + 数据 schema）。

工作原则：
1. 先理解，再生成。模糊需求要主动澄清，但每轮最多问 3 个问题。
2. 渐进具象。给用户看大纲，确认后再写细节，不要一上来扔一堆 JSON。
3. 用 Lumos 已有的能力（MCP、agent、组件）。不存在的能力不要编造。
4. 输出严格遵守 JSON Schema。
5. 安全第一。默认低权限，敏感能力必须征得用户同意。
```

#### 4.1.2 输出契约（静态）

完整的 app.json / routes.json / pages/*.json / workflows/*.json / data-schema.json 的 JSON Schema 内联在 prompt 里。

为节省 token，schema 用**精简注释版**：

```yaml
app.json:
  id: string, kebab-case, unique
  name: string
  version: semver
  requires.mcp: array<string>  # 引用的 MCP 服务器 id
  permissions.network.domains: array<string>  # 白名单域名
  ...
```

完整 schema 通过 `read_schema` 工具按需取，避免 prompt 过长。

#### 4.1.3 设计原则（静态）

```
设计模式（脚手架）：

1. 「输入-处理-输出」工具型应用
   - layout: single
   - 一个 form + 一个 button → run workflow → result 区
   - 例：周报助手、合同审查

2. 「列表-详情」业务型应用
   - layout: list-detail
   - data-schema 里定义实体
   - 例：CRM、招聘、知识管理

3. 「仪表板」分析型应用
   - layout: grid + chart 组件
   - 数据来自 db / workflow 输出
   - 例：销售统计、监控报表

4. 「对话」助手型应用
   - 使用 chat 组件
   - 后端是 agent + 知识库
   - 例：客服机器人、法律咨询

判断方式：用户描述里出现"管理 / 跟踪 / 列表" → 模式 2，
"分析 / 统计 / 看板" → 模式 3，"问答 / 对话 / 帮我" → 模式 4，
其他 → 模式 1。
```

#### 4.1.4 当前可用能力（动态注入，每次会话开始时刷新）

```
当前 Lumos 实例可用的能力（你只能用这些，不要编造）：

可用 MCP 服务器：
  - feishu (飞书文档/消息) - 已配置
  - office-docs (Excel/Word/PDF/PPT 处理) - 已启用
  - deepsearch (知乎/微信公众号搜索) - 已启用
  - bilibili (B 站搜索/字幕) - 未启用，需用户先开

可用 Agent 角色：
  - worker (通用工作)
  - researcher (深度研究)
  - coder (代码生成)
  - integration (调用外部 API)

可用 LLM Provider：
  - chat (通用对话，Claude Sonnet)
  - reasoning (复杂推理，Claude Opus)
  - fast (快速响应，Haiku)

可用知识库 collection：
  - "公司产品文档" (50 个文档)
  - "客户案例" (12 个文档)

工具白名单（应用 manifest 可声明的 tools 字段）：
  - bash, python, file, web-fetch
```

这块由 AppBuilder Agent 启动时调 `list_capabilities` 工具拼出来，保持新鲜。

### 4.2 工具集

AppBuilder Agent 的工具（实现在 `src/lib/app/builder/tools/`）：

| 工具 | 用途 | 输入 | 输出 |
|---|---|---|---|
| `read_schema` | 读取某个 schema 完整定义 | `{ schema: 'app' \| 'page' \| ... }` | JSON Schema |
| `list_capabilities` | 列出当前 Lumos 能力 | — | MCP / Agent / 知识库清单 |
| `query_user` | 主动问用户问题 | `{ questions: string[] }` | 用户回答 |
| `generate_manifest` | 生成 app.json | `{ spec }` | 验证后的 JSON |
| `generate_routes` | 生成 routes.json | `{ menu, default }` | 验证后的 JSON |
| `generate_page` | 生成单个 page | `{ pageId, layout, ... }` | 验证后的 JSON |
| `generate_workflow` | 生成 workflow | `{ id, steps, ... }` | 验证后的 JSON |
| `generate_data_schema` | 生成 data-schema.json | `{ collections }` | 验证后的 JSON |
| `validate_app` | 整体校验生成的应用包 | `{ files }` | `{ ok, issues[] }` |
| `preview_page` | 在 UI 右侧渲染某 page | `{ pageId }` | — |
| `install_app` | 安装到 Lumos | `{ files }` | `{ appId, installPath }` |
| `update_app_file` | 增量更新某个文件 | `{ appId, path, content }` | — |
| `get_app_state` | 查询当前应用状态 | `{ appId }` | manifest + 已生成文件 |

每个 `generate_xxx` 工具内部会做 schema 校验，失败时把错误回灌给 LLM 让它重写。

### 4.3 思考链（生成阶段编排）

AppBuilder 不是单次提示生成，是**多阶段流水线**：

```
[阶段 1] 需求理解
  ├─ 用户描述 → AI 总结需求摘要
  ├─ 调 query_user 澄清模糊点（最多 2 轮）
  └─ 输出：需求 spec（结构化）

[阶段 2] 结构设计
  ├─ 选脚手架（4 种模式之一）
  ├─ 列出文件清单 + 简要说明
  ├─ 列出权限清单
  └─ 让用户确认（生成大纲，不是 JSON）

[阶段 3] 文件生成（按依赖顺序）
  ├─ data-schema.json   (其他文件可能引用)
  ├─ workflows/*.json   (页面会调它)
  ├─ pages/*.json       (引用 workflow + data)
  ├─ routes.json        (引用 pages + components)
  └─ app.json           (汇总所有依赖)
  每生成一个文件：调 validate → 调 preview_page

[阶段 4] 整体自检
  ├─ validate_app（所有引用是否一致）
  ├─ 权限闭包（manifest 声明 vs 实际使用）
  └─ 失败 → 回到阶段 3 修复

[阶段 5] 安装试用
  ├─ install_app
  ├─ 引导用户填 config（如有）
  └─ 用户试用

[阶段 6] 增量迭代（持续）
  ├─ 用户反馈（自然语言）
  ├─ 定位改动文件 + 范围
  ├─ update_app_file
  └─ 校验 + 重载
```

每个阶段失败有明确的回退路径——**不要"我尽力了"含糊收场**。

---

## 5. 上下文管理

### 5.1 挑战

- JSON Schema 全部内联会撑爆 prompt
- 多轮对话历史会越来越长
- 已生成的应用文件会越来越多

### 5.2 策略

#### 5.2.1 Schema 按需加载

System prompt 只放 schema 摘要（字段名 + 类型 + 一句话注释）。LLM 生成具体文件时，调 `read_schema` 拉取完整定义。

#### 5.2.2 能力清单缓存

`list_capabilities` 输出在会话开始时拉一次，存在会话上下文里。期间能力变化（用户新装了 MCP）通过 push 事件刷新。

#### 5.2.3 对话摘要

历史超过 N 轮后，AppBuilder 自己生成"已确认需求摘要"，替换掉早期对话原文。

格式：

```yaml
needs_summary:
  应用类型: CRM
  核心场景: 客户管理 + 订单跟踪 + 周报推送
  数据模型:
    customers: [name, phone, email, tags, status]
    orders: [customerId, amount, date, status]
  集成: 飞书（推周报）
  设计模式: list-detail
  已确认权限: [feishu MCP, isolated data]
```

#### 5.2.4 文件引用而非内联

已生成的文件不放在对话历史里，通过 `get_app_state` 工具按需取。增量更新时只把"被改的文件 + 关联文件"传进来。

---

## 6. 需求模板库

### 6.1 思路

新手用户描述需求时往往含糊（"我想要一个 CRM"）。提供模板让 AI 快速锚定方向：

- 输入"CRM" → 拉 CRM 模板（已有客户表 + 订单表 + 跟进流程的脚手架）
- AI 在模板基础上跟用户细化"你的 CRM 需要什么特殊字段"

### 6.2 模板结构

```
templates/
├── crm/
│   ├── description.md          # 模板说明
│   ├── prompt-hints.md         # AI 拿到这个模板时的提示
│   ├── app.template.json       # 待填空模板
│   └── schema.template.json
├── content-generator/
├── document-analyzer/
├── chatbot-with-kb/
├── data-pipeline/
├── monitor-dashboard/
└── ...
```

每个模板内置常见字段、流程、UI 布局。AI 拿到模板后，**基于用户具体场景填空和裁剪**。

### 6.3 模板来源

- **内置**：Lumos 官方维护一套（10-20 个）
- **用户**：用户已生成的应用可"保存为模板"
- **市场**：v3+，第三方贡献模板

### 6.4 类比已有应用

支持"做一个像 X 那样的 Y"模式：

```
[用户] 做一个像周报助手一样的，但是给销售团队用的"日报助手"

[AI] 我会基于"周报助手"模板，调整为：
  - 频率：日报（cron 每天 18:00）
  - 字段：今日访客 / 今日成交 / 明日计划
  - 集成：钉钉（销售团队常用）
  ...
```

---

## 7. 实时预览

### 7.1 UI 布局

创建器 UI 是双面板：

```
┌─────────────────────────────┬─────────────────────────────┐
│ 对话面板                     │ 预览面板                     │
│                             │                             │
│ 用户和 AI 对话              │ - 文件树（生成进度）          │
│                             │ - 当前选中文件预览            │
│                             │   - JSON 文件：高亮 JSON     │
│                             │   - page 文件：实时渲染页面   │
│                             │ - 错误高亮                   │
│                             │ - 改动 diff（迭代时）         │
└─────────────────────────────┴─────────────────────────────┘
```

### 7.2 流式生成

LLM 生成 JSON 是流式的，但 JSON 不能边写边解析。策略：

- LLM 一边写 JSON、UI 一边显示原文
- 写完一个完整文件触发解析
- 解析成功 → 切换到"渲染态"（page 类文件直接渲染该页）
- 解析失败 → 显示原文 + 错误位置

### 7.3 Mock 数据

声明式 page 渲染需要数据。生成阶段没有真实数据，用 mock：

- `data-schema.json` 定义了字段类型 → 渲染器生成假数据填充
- 用户能看到"列表大致长什么样"，不真实但够预览
- 安装后切到真数据

### 7.4 改动 diff（迭代时）

用户说"加个搜索"后，AI 修改 `pages/customers.json`：

```diff
  "list": {
    "type": "table",
    "data": "{{ db.customers }}",
+   "search": { "fields": ["name", "phone"] },
    "columns": [...]
  }
```

预览面板显示彩色 diff，用户能看到精确改了什么。一键回滚。

---

## 8. 增量迭代

### 8.1 用户反馈类型

| 类型 | 例子 | AI 处理 |
|---|---|---|
| 添加功能 | "加个搜索框" | 找到对应 page，加字段 |
| 修改字段 | "把'状态'改成下拉选" | 改 form 组件类型 |
| 替换流程 | "周报改成日报" | 改 trigger cron + workflow |
| 删除 | "把统计页删了" | 删 page + 改 routes |
| 风格调整 | "界面太丑了" | 调 layout / 间距 / icon |
| 修 bug | "点保存没反应" | 看 workflow 输出 + 改连接 |

### 8.2 改动定位算法

接收用户反馈 → AI 找出影响的文件：

1. **关键词匹配**：用户提到"搜索" → 候选 list/table 类 page
2. **路由提示**：用户当前在 `/apps/{id}/customers` → 优先看 customers 页
3. **状态查询**：调 `get_app_state` 看完整结构
4. **影响范围分析**：改动是否需要联动？比如改字段名要同时改 page + workflow 引用

### 8.3 版本快照

每次成功的迭代都保存快照：

```
~/.lumos/apps/{id}/.history/
├── v1.json  (初次生成)
├── v2.json  (加了搜索)
├── v3.json  (改了字段)
└── current.json
```

用户可"回到上一版"。

### 8.4 AI 改不动时的退路

如果 AI 经过 N 次尝试仍生成不出符合 schema 的内容，**必须明确告诉用户**：

```
我尝试了 3 次都没法满足你的需求："{需求}"。
可能的原因：
- 这个功能涉及复杂自定义交互，超出声明式能力
- 需要的 MCP（XXX）当前没有

建议：
- 简化需求 / 或改成 ……
- 或者由开发者写代码组件
```

不要含糊"已尝试，可能有问题"——**明确告诉用户卡在哪、能怎么办**。

---

## 9. 失败处理

### 9.1 失败类型

| 类型 | 检测点 | 处理 |
|---|---|---|
| Schema 校验失败 | `validate_xxx` 工具 | 错误回灌 → AI 重写（最多 3 次） |
| 引用不一致 | `validate_app` | 同上 |
| Workflow 跑不起来 | install 后试跑 | 错误日志回灌 → AI 修 |
| 权限不足 | 安装时 | 提示用户授权 |
| 能力不存在 | 生成阶段 | AI 幻觉了不存在的 MCP，提示并改用替代方案 |
| LLM 自我循环 | 重试次数耗尽 | 降级到"需要开发者介入"，告诉用户原因 |

### 9.2 自修循环

```
generate_page → validate → 失败
    ↓
错误信息 + 原文 + schema 节选 → AI 重写
    ↓
generate_page → validate → 成功 / 仍失败
```

最多 3 轮，仍失败则降级。

### 9.3 用户可见的诚实

哪怕生成成功也可能藏 bug（比如 workflow 步骤连接错了）。在交付时主动说：

```
应用已生成，但有一处我不够确定：
- pages/orders.json 的"按客户筛选"功能，依赖 customers 表的 id 关联
- 我用的是 {{ db.orders.where('customerId', detail.id) }}
- 没有真实数据测过，可能跑起来要调

要现在装上试试吗？
```

---

## 10. 数据存储

### 10.1 创建会话

```sql
CREATE TABLE app_builder_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  status TEXT,                  -- 'gathering' | 'generating' | 'installed' | 'iterating'
  needs_summary TEXT,           -- 阶段 1 输出的需求摘要 JSON
  app_id TEXT,                  -- 已安装的话填
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE app_builder_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,                    -- 'user' | 'assistant' | 'tool'
  content_json TEXT,
  created_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES app_builder_sessions(id)
);

CREATE TABLE app_builder_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  file_path TEXT,               -- 相对应用根的路径
  content TEXT,
  version INTEGER,              -- 第几次迭代
  status TEXT,                  -- 'draft' | 'committed'
  created_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES app_builder_sessions(id)
);
```

### 10.2 历史与回退

每次"安装 / 迭代"是一次 commit，保留所有历史 artifacts。用户能：
- 回滚到任一历史版本
- 对比不同版本
- 基于历史版本重新走一次创建流程

---

## 11. 安全

### 11.1 AI 生成应用的特殊风险

- **过度授权**：AI 不知道场景实际需要多少权限，倾向"全申请"
- **能力幻觉**：AI 编造不存在的 MCP / 工具
- **路径遍历**：AI 生成的 fs path 漏判 `..`
- **跨应用数据**：AI 误用共享数据空间

### 11.2 防护

#### 11.2.1 默认低权限

AI 生成的 manifest 默认：

- `permissions.data: isolated`
- `permissions.network.mode: whitelist`（且必须列出域名，不能空）
- `permissions.filesystem`：只允许写到 `~/Downloads/lumos-app-{id}/` 沙盒

要解锁更多权限，AI 必须明确说"为了 XX 功能，需要 YY 权限"，让用户点同意。

#### 11.2.2 能力闭包检查

`validate_app` 强制：

- manifest 声明的 MCP 都真实存在
- 应用引用的 workflow 步骤的工具都在 manifest tools 白名单内
- 网络请求的 host 都在 whitelist 里
- fs 路径都在声明的目录内

任一项不通过 → 不能安装。

#### 11.2.3 敏感操作显式确认

- 用户态下，AI 不能自动调 `install_app` 或 `update_app_file` —— 必须用户点"安装" / "更新"
- 改动权限时强制重新确认（哪怕只是加一个域名）

#### 11.2.4 不允许自我提权

AI 生成的应用不能在 manifest 写一段"运行时申请额外权限"——所有权限只能在安装时或显式管理时授予。

### 11.3 审计

- 所有 AI 创建的应用打 `source: ai-generated` 标记
- 应用详情页显示"由 AI 在 2026-04-30 创建，基于会话 #abc123"
- 用户可查看完整的创建对话历史

---

## 12. 与现有系统集成

### 12.1 LLM 配置

在 `src/components/settings/` 加 `AppBuilderLLMSection.tsx`，与现有 builder LLM 配置同形态：

- 选 Provider（默认 Claude）
- 选模型（推荐 Opus 用于生成稳定性）
- 温度（默认 0.3，偏稳定）
- 最大 token

### 12.2 工作流复用

AI 生成的 workflow 文件就是现有 Workflow DSL V2 格式，跑在现有 Workflow Engine 上，零额外开发。

### 12.3 Agent 复用

AppBuilder Agent 自身使用 Claude Agent SDK，跟其他 builder agent 共享 SDK 运行时（`src/lib/claude/sdk-runtime.ts`）。

### 12.4 安装器复用

`install_app` 工具底层就是主文档第 8.2 节的安装流程（解压、注册、初始化数据表）。

---

## 13. 推进路线图

| 里程碑 | 范围 | 时长估计 | 输出 |
|---|---|---|---|
| **B0：能力探测** | `list_capabilities` 工具 + System prompt 动态注入 | 1 周 | AppBuilder 知道当前 Lumos 有什么 |
| **B1：生成单文件应用** | 只支持模式 1（输入-处理-输出） | 2-3 周 | 周报助手类应用可对话生成 |
| **B2：完整生成流程** | 阶段 1-5 全跑通，覆盖 4 种设计模式 | 3-4 周 | 任意业务应用可生成 |
| **B3：实时预览** | 双面板 UI、流式渲染、mock 数据 | 2-3 周 | 用户边聊边看 |
| **B4：增量迭代** | 改动定位 + 增量更新 + diff 显示 | 2 周 | 持续迭代体验 |
| **B5：模板库** | 内置 10-20 模板 + "类比已有应用" | 2-3 周 | 冷启动加速 |
| **B6：自检与自修** | validate / 错误回灌 / 重试机制 | 2 周 | 失败收敛 |
| **B7：用户分享与发现** | 用户生成的应用可"保存为模板" / "分享" | 持续 | 生态雏形 |

每个 B 阶段都依赖主文档的对应 M 阶段：

- B0 依赖 M0（schema 定稿）
- B1 依赖 M1（runtime 能跑应用）
- B5 依赖 M3（声明式 UI 完整）

---

## 14. 关键决策点

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 创建器 UI 形态 | 独立页面 / 集成对话 / 浮窗 | **独立页面**（双面板，清晰） |
| 2 | LLM 模型 | Opus / Sonnet / 用户选 | **默认 Opus，可在 settings 调** |
| 3 | 流式还是一次性 | 流式 / 完整 | **流式**（体验好） |
| 4 | Mock 数据策略 | 静态假数据 / AI 生成假数据 | **AI 生成假数据**（更贴近场景） |
| 5 | 自修最多次数 | 3 / 5 / 无限 | **3 次**（避免死循环烧钱） |
| 6 | 模板存放位置 | 内置代码 / 数据库 / 文件 | **`resources/app-templates/`**（与 MCP 同形态） |
| 7 | 用户分享 | 公开链接 / 仅本机 / 团队 | **v1 仅本机，v3+ 开放** |
| 8 | 多用户协作创建 | 支持 / 不支持 | **v1 不支持** |

---

## 15. 开放问题

1. **AI 生成质量不稳定怎么办**：同一个需求两次生成结果不同，能否提供"种子"或"风格参数"？
2. **应用生成的成本上限**：单次生成可能消耗大量 token，是否要 budget 提示？
3. **iOS App Store 审核反例**：AI 生成的应用是否需要类似审核才能进入市场？
4. **多语言生成**：用户用英文描述，能否生成中文应用？反之亦然？
5. **已有应用的"AI 改造"**：用户装了一个开发者写的应用，能否让 AI 在不改源码的情况下做配置层定制？
6. **创建器自身的 dogfooding**：AI 创建器本身能不能用 Lumos 应用模型描述？（meta-app）
7. **失败的应用怎么处理**：用户半路放弃的会话，残留 artifacts 怎么清理？

---

## 16. 总结

**AI 创建器 = Lumos 应用平台的核心差异化**。它不是"开发者工具的简化版"，而是一条让普通用户成为应用创造者的全新路径。

设计要点：

1. **对话驱动 + 渐进具象**：从模糊需求到可运行应用，多阶段流水线
2. **预览即所得**：双面板 UI，用户边聊边看
3. **增量迭代**：自然语言反馈 → 精准定位改动 → diff 透明
4. **能力清单动态注入**：AI 只能用真实存在的 MCP / Agent / 工具，不允许幻觉
5. **安全保守**：默认低权限，敏感能力显式确认，不允许自我提权
6. **失败收敛**：自修 + 降级 + 诚实告知，不"装作成功"

**与开发者写应用并存**：开发者擅长长尾、复杂、商业化场景；AI 创建器服务普通用户的"我想要"长尾需求。两者通过同一套应用规范共存。

下一步：

1. 评审本文档第 14 节的决策点
2. 启动 B0：实现 `list_capabilities` 和动态 prompt 注入
3. 与主文档 M0（Schema 定稿）并行推进
