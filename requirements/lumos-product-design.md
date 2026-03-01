# Lumos 产品设计结论文档

> 版本：v1.2 | 日期：2026-02-28 | 状态：待评审
> v1.2 变更：新增多源输入、工作空间模型、知识库深度整理、模板定位调整
> v1.1 变更：融合对话能力，导航从纯文档中心调整为文档+对话共存

## 一、产品概述

### 1.1 产品定位

Lumos 是一个 **AI 驱动的智能工作台**，文档和对话是同一工作流的两种形态，知识库为底座。

### 1.2 核心理念

- **工作台 = 文档 + 对话**：文档是结构化产出，对话是探索性思考，两者平级共存
- **对话是文档的上游**：用户工作流是连续光谱——随意聊天→深度对话→结构化思考→文档，对话可一键转文档
- **多源输入，统一沉淀**：文档、网页、图片、录音等多种输入形态，经处理管线统一转化为可索引的知识条目
- **工作空间 = 本地目录**：用户可打开本地文件夹作为工作空间，Lumos直接索引原文件，无需上传副本
- **知识库 = 沉淀 + 整理**：导入自动建索引（沉淀），AI自动摘要/关联发现/健康度检测（整理）
- **导入即沉淀**：用户导入文档 = 前端可编辑 + 后端自动建索引，零决策成本
- **三层AI承载**：全局AI入口（轻量问答）+ 工作台对话（深度思考）+ 文档内AI面板（编辑辅助）

### 1.3 技术栈

- 框架：Next.js 16 + React 19 + Tailwind + shadcn/ui
- 编辑器：Tiptap (ProseMirror)
- 数据库：better-sqlite3
- AI：Claude API + Claude Agent SDK
- 检索：向量检索(bge-small-zh-v1.5) + BM25(jieba分词) + RRF融合
- 文档解析：mammoth(Word) + xlsx(Excel) + pdf-parse(PDF)

---

## 二、信息架构与导航

### 2.1 左侧导航栏

| 序号 | 名称 | 图标(lucide) | 说明 |
|------|------|-------------|------|
| 1 | Logo | Lumos图标 | 点击回首页 |
| 2 | AI助手 | `Sparkles` | 全局轻量对话入口（Cmd+K也可唤起） |
| 3 | 工作台 | `LayoutDashboard` | 默认选中，文档+对话混合展示 |
| 4 | 最近 | `Clock` | 最近的文档和对话（混合时间线） |
| — | 分割线 | — | — |
| 5 | 收藏 | `Star` | 收藏的文档和对话 |
| — | 工作空间区域 | — | — |
| 6 | 📂 工作空间 | `FolderOpen` | 本地目录列表，点击切换活跃工作空间 |
| — | + 打开文件夹 | `FolderPlus` | 选择本地目录创建新工作空间 |
| — | 分割线 | — | — |
| 7 | 回收站 | `Trash2` | 已删除内容，30天自动清理 |
| 8 | 知识库 | `Brain` | 知识状态管理（含素材管理） |
| — | 底部区域 | — | — |
| 9 | 设置 | `Settings` | 用户设置（含扩展管理） |

> v1.2 变更：模板从独立导航项降级为"新建"菜单子选项+首页快捷按钮（详见3.7节）。工作空间区域新增。

### 2.2 导航状态

- **展开态**：宽度 220px，图标+文字
- **折叠态**：宽度 56px，仅图标，hover显示tooltip
- **折叠触发**：底部按钮 `ChevronsLeft`/`ChevronsRight`，或 `Cmd+\`
- **选中态**：左侧3px蓝色竖条 + `bg-accent` + 文字加粗
- **折叠动画**：width 220→56px，ease-out 200ms
- **偏好持久化**：localStorage

### 2.3 响应式策略

| 断点 | 导航 | 内容区 |
|------|------|--------|
| ≥1280px | 展开态220px | 正常布局 |
| 768-1279px | 折叠态56px | 卡片列数减少 |
| <768px | 隐藏，汉堡菜单 | 单列 |

---

## 三、工作台首页

### 3.1 页面结构

```
┌──────────────────────────────────────────────────┐
│  左侧导航栏(56-220px) │       内容区              │
│                        │  ┌──────────────────────┐│
│  [Logo]                │  │ 顶部栏：搜索+用户头像 ││
│  ✨ AI助手             │  ├──────────────────────┤│
│  ● 工作台              │  │ AI 入口卡片           ││
│  ● 最近                │  ├──────────────────────┤│
│  ─────                 │  │ 内容列表区            ││
│  ● 收藏                │  │ (文档+对话混合展示)   ││
│  ● 模板                │  ├──────────────────────┤│
│  ─────                 │  │ 知识状态栏(底部36px)  ││
│  ● 回收站              │  └──────────────────────┘│
│  ● 知识库              │                           │
│  ─────                 │                           │
│  ● 设置                │                           │
└──────────────────────────────────────────────────┘
```

### 3.2 顶部栏

```
┌──────────────────────────────────────────────┐
│  面包屑(工作台)    [🔍 搜索...]     [头像 ▾] │
└──────────────────────────────────────────────┘
```

- **全局搜索**：点击搜索框或 `Cmd+K` 弹出 Command Palette 风格模态框
- **搜索范围**：文档标题 + 文档内容 + 知识库内容
- **搜索结果分组**：文档（标题匹配优先）、知识库内容（语义搜索）、操作（"新建文档"等快捷操作）
- **用户头像菜单**：账户设置、主题切换（亮/暗/跟随系统）、退出登录

### 3.3 AI 入口卡片

```
┌─────────────────────────────────────────────┐
│  ✨ 你想创建什么？                            │
│  ┌─────────────────────────────────────┐    │
│  │  💬 描述你想写的内容，AI帮你起草...    │    │
│  │                              [开始] │    │
│  └─────────────────────────────────────┘    │
│  快捷：📝 空白文档  📋 会议纪要  📊 周报     │
│        📖 读书笔记  📑 技术方案  ➕ 更多     │
└─────────────────────────────────────────────┘
```

- **输入框交互**：用户输入描述 → 点击"开始"或Enter → 自动创建文档 → 跳转编辑器 → AI面板展开并生成
- **placeholder轮播**：3s间隔fade切换（"帮我写一份项目方案..." → "总结这篇文章的要点..." → "起草一封邮件..."）
- **快捷模板**：点击后直接创建对应模板文档并跳转
- **拖拽支持**：支持拖拽文件到输入框触发导入+AI分析

### 3.4 内容列表区（文档+对话混合展示）

**视图模式**（右上角切换按钮，偏好存localStorage）：

**卡片视图（默认）**：自适应网格，min 240px/卡片
- 文档卡片：来源图标📄、标题、内容预览(2行)、更新时间、标签、知识库状态badge
- 对话卡片：对话图标💬、标题(AI自动生成)、最后一条消息预览、更新时间、消息数badge
- Hover：显示收藏/删除按钮
- 右键菜单：重命名、收藏、导出、删除；对话额外有"转为文档"

**列表视图**：每行一个内容项
- 列：复选框 + 类型图标(📄/💬) + 标题 + 类型标签 + 来源/消息数 + 更新时间
- 支持列头排序

**筛选标签栏**（横向pill按钮，可多选）：
- 按类型：全部 / 文档 / 对话
- 按来源（文档）：在线创建 / 本地上传 / 飞书导入
- 按知识库：已索引 / 未索引
- 筛选条件通过URL query参数持久化

### 3.5 空状态（新用户首次进入）

```
┌─────────────────────────────────────────────┐
│           [Lumos 插画/动画]                  │
│        欢迎使用 Lumos 文档助手               │
│     AI 驱动的智能文档工作台                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ ✨ AI写作 │  │ 📥 导入  │  │ 📝 空白  │    │
│  │ 描述想法  │  │ 已有文档  │  │ 从零开始  │    │
│  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────┘
```

- 三个入口卡片引导用户选择起步方式
- 完成第一个操作后空状态消失，显示正常文档列表
- 不做强制引导tour，保持轻量

### 3.6 知识状态栏（首页底部）

```
┌──────────────────────────────────────────────────────┐
│ 🧠 知识库就绪 · 12篇文档已索引 · AI问答可用   [管理] │
└──────────────────────────────────────────────────────┘
```

- 固定在内容区底部，高度36px，`bg-muted` + `text-muted-foreground`
- 状态点颜色：🟢就绪 / 🟡索引中 / ⚪空
- 点击"管理"打开知识库管理抽屉（详见第七章）

### 3.7 创建入口

文档列表页顶部「新建」按钮，下拉菜单：
- **新建文档** — 空白文档，跳转编辑器
- **新建对话** — 创建AI对话，跳转对话页
- **从文件导入** — 本地文件上传
- **从飞书导入** — 飞书文档导入

---

## 三A、AI助手（全局轻量对话）

### 3A.1 定位

AI助手是非文档场景的主入口，承载资料查询、快速问答、代码问答、日常闲聊等轻量交互。特点：快速、不打断当前工作流、默认不持久化。

### 3A.2 触发方式

- 左侧导航栏顶部「AI助手」图标
- 全局快捷键 `Cmd+K`
- 任何页面均可唤起

### 3A.3 交互形式

弹出 Command Palette 风格的模态面板（居中，宽度640px，最大高度70vh）：

```
┌─────────────────────────────────────────┐
│  ✨ 问我任何问题...                      │
├─────────────────────────────────────────┤
│  最近对话                                │
│  💬 React 19新特性讨论        10分钟前   │
│  💬 SQL优化方案               昨天       │
│                                         │
│  快捷操作                                │
│  📝 新建文档  💬 新建对话  📥 导入文件   │
└─────────────────────────────────────────┘
```

**输入后的行为**：
- 用户输入问题 → Enter → 面板展开为对话模式，AI流式回复
- 对话默认不持久化（关闭面板后消失）
- 用户可点击「📌 保存对话」将当前对话钉住，变为工作台中的持久对话
- 对话中AI回复包含有价值内容时，显示「📄 转为文档」按钮

### 3A.4 与文档AI面板的区别

| 维度 | AI助手 | 文档AI面板 |
|------|--------|-----------|
| 入口 | 全局Cmd+K | 编辑器内Cmd+L |
| 上下文 | 无特定文档，可引用知识库 | 绑定当前文档 |
| 持久化 | 默认不保存，可钉住 | 跟随文档保存 |
| 场景 | 资料查询、思路整理、快速问答 | 文档编辑、润色、续写 |
| 结果 | 可转为文档 | 直接写入文档 |

---

## 三B、工作台对话（深度思考载体）

### 3B.1 定位

工作台对话承载思路整理、学习笔记、内容创作、方案分析等需要持久化的深度对话。与文档平级，是工作台中的一等公民。

### 3B.2 创建方式

- 工作台「新建」→「新建对话」
- AI助手中「📌 保存对话」钉住后自动升级
- AI入口卡片输入描述后自动创建

### 3B.3 对话页面布局

```
┌────────────────────────────────────────────────┐
│  ← 返回  对话标题(可编辑)  [标签]  [⋯ 更多]    │
├────────────────────────────────────────────────┤
│                                                │
│  上下文指示条：知识库(12篇) + 引用文档(可选)    │
│                                                │
│  [用户消息]                                     │
│  [AI回复 + 引用来源]                            │
│  [用户消息]                                     │
│  [AI回复]                                       │
│                                                │
│  ────────────────────────────────────────────  │
│  [快捷操作: 总结 | 转为文档 | 继续深入]         │
│  [💬 输入框...]                       [发送]   │
└────────────────────────────────────────────────┘
```

### 3B.4 核心交互

- **自动持久化**：对话创建后自动保存，出现在工作台列表中
- **标题自动生成**：AI根据首轮对话自动生成标题，用户可修改
- **知识库检索**：对话中AI自动检索知识库，回复带引用标注
- **引用文档**：用户可手动添加已有文档作为对话上下文
- **转为文档**：点击「📄 转为文档」→ AI自动将对话内容整理为结构化文档 → 跳转编辑器

### 3B.5 「转为文档」流程

1. 用户点击「转为文档」
2. AI分析对话内容，提取关键信息，生成结构化Markdown
3. 自动创建新文档，内容为AI整理后的结果
4. 跳转到编辑器页面，用户可继续编辑
5. 原对话保留，文档详情中显示「来源：对话 [链接]」

---

## 四、编辑器页面

### 4.1 页面结构

```
┌────────────────────────────────────────────────────────┐
│  顶部栏：← 返回  文档标题(可编辑)  [标签]  [⋯ 更多]    │
├────────────────────────────────────────────────────────┤
│                        │                               │
│   编辑器区域 (65%)      │    AI 面板 (35%)              │
│  ┌──────────────────┐  │  ┌───────────────────────┐   │
│  │ 工具栏            │  │  │ 上下文指示条           │   │
│  ├──────────────────┤  │  │ 对话消息流             │   │
│  │  Tiptap 编辑区   │  │  │ 快捷操作按钮行         │   │
│  ├──────────────────┤  │  │ 输入框 + 发送按钮      │   │
│  │ 底部状态栏        │  │  └───────────────────────┘   │
│  └──────────────────┘  │                               │
└────────────────────────────────────────────────────────┘
```

### 4.2 顶部栏

- **返回按钮**：`ArrowLeft` 图标，点击回工作台首页
- **文档标题**：行内编辑，点击即可修改，blur自动保存，placeholder "无标题文档"
- **标签**：`Badge` 组件，点击 `+` 添加（Popover输入框）
- **知识库开关**：顶栏右侧 `[AI知识库: ON ●]` 绿色已纳入 / `[AI知识库: OFF ○]` 灰色未纳入
- **更多菜单 `⋯`**：文档信息、导出、版本历史、移动到、删除

### 4.3 编辑器工具栏

```
┌──────────────────────────────────────────────────┐
│ [段落▾] │ B I S ~ │ 🔗 📷 │ ≡ •- ☑ │ "" — │ ⋯ │
└──────────────────────────────────────────────────┘
  组1:块类型  组2:文本  组3:插入 组4:列表  组5:引用 组6:更多
```

| 分组 | 按钮 | 功能 | 快捷键 |
|------|------|------|--------|
| 块类型 | 下拉菜单 | 正文/H1/H2/H3/代码块/引用块 | — |
| 文本格式 | B / I / S / ~ | 加粗/斜体/删除线/行内代码 | Cmd+B/I/Shift+S/E |
| 插入 | 🔗 / 📷 | 链接/图片(上传或URL) | — |
| 列表 | ≡ / •- / ☑ | 有序/无序/任务列表 | — |
| 块级 | "" / — | 引用块/分割线 | — |
| 更多 | ⋯ | 表格/数学公式/Mermaid图表 | — |

- 固定在编辑器顶部，不随内容滚动
- 按钮状态反映当前光标位置格式
- 窄屏自动折叠到"更多"菜单

### 4.4 Tiptap 编辑区

**支持的Block类型**：Paragraph, Heading(1-3), BulletList, OrderedList, TaskList+TaskItem, CodeBlockLowlight(语法高亮), Blockquote, Image(拖拽上传), Table, HorizontalRule, Link

**行内格式**：加粗、斜体、删除线、行内代码、下划线、高亮

**编辑器样式**：
- 内容区最大宽度 720px，居中（类Notion）
- 行间距 1.6，段间距 0.8em
- 系统默认无衬线字体，代码块等宽字体
- 聚焦块左侧显示 `+` 拖拽手柄（hover时出现）

### 4.5 AI 面板（右侧35%）

**面板头部**：标题"AI助手" + 📌固定按钮 + ✕关闭按钮(等同Cmd+L)

**上下文指示条**：
```
📎 上下文
 • 当前文档 (1,234字)
 • 选中文本 "第三段..."    ← 有选中时显示
 • 知识库 (12篇)          ← 知识库可用时显示
                    [编辑]
```
- 点击"编辑"可手动添加/移除上下文来源
- 选中文本时自动添加，取消选中时自动移除

**对话消息流**：
- 用户消息：右对齐，蓝色背景
- AI消息：左对齐，灰色背景，底部操作按钮 [应用到文档] [复制] [重试]
- "应用到文档"点击后编辑器显示diff预览，顶部浮现 [接受修改] [拒绝] [逐条审查]

**快捷操作按钮行**（输入框上方）：
```
[续写] [润色] [翻译] [总结] [问答]
```
- 横向滚动不换行，点击自动填充指令并发送
- 有选中文本时操作自动针对选中内容

**输入区**：多行输入(最大4行)，Enter发送，Shift+Enter换行，📎附件按钮，发送中可停止生成

### 4.6 Cmd+L 折叠/展开

| 状态 | 编辑器宽度 | AI面板 | 触发 |
|------|-----------|--------|------|
| 展开(默认) | 65% | 35%可见 | Cmd+L / 展开按钮 |
| 折叠 | 100% | 隐藏 | Cmd+L / ✕按钮 |

- 动画：250ms ease-in-out，面板width+opacity过渡
- 折叠后编辑器右下角浮现圆形AI按钮(40px)，hover显示tooltip
- 有未读AI消息时显示红点徽标
- 每次打开文档默认展开，对话历史折叠间保持

### 4.7 编辑器与AI面板联动

| 编辑器事件 | AI面板响应 |
|-----------|------------|
| 选中文本 | 上下文指示条更新，浮动工具栏出现AI操作按钮 |
| 取消选中 | 上下文回退到"当前文档全文" |
| 文档内容变更 | AI面板文档上下文自动更新(debounce 1s) |

| AI面板操作 | 编辑器响应 |
|------------|-----------|
| "应用到文档" | 编辑器显示diff预览，等待确认 |
| "插入到光标处" | 在当前光标位置插入内容 |
| "替换全文" | 替换整个文档(需二次确认) |

### 4.8 自动保存

| 触发条件 | 说明 |
|---------|------|
| 内容变更后2秒无操作 | debounce 2s，主要触发 |
| 失去焦点(blur) | 切换标签页/窗口时立即保存 |
| Cmd+S | 手动保存(兼容习惯) |
| 关闭页面前 | beforeunload事件 |

- 底部状态栏显示：`未保存`(灰) → `保存中...`(灰+spinner) → `已保存`(绿，2秒后变灰)
- 保存失败：状态栏变红"保存失败，点击重试"
- localStorage每30s临时备份，防浏览器崩溃

### 4.9 导出

支持格式：Markdown(.md) / Word(.docx) / PDF(.pdf) / 纯文本(.txt)
入口：顶部栏"更多菜单"→导出，或 `Cmd+Shift+E`
交互：弹出格式选择对话框 → 选择 → 触发浏览器下载，文件名默认为文档标题

---

## 五、AI 写作辅助（四层递进）

### 5.1 层次1 — 行内操作（选中文本触发）

**浮动工具栏**：选中≥2字符后延迟200ms出现，位于选区上方居中(距8px)

| 按钮 | 图标 | 说明 |
|------|------|------|
| 润色 | ✨ | 优化表达，保持原意 |
| 翻译 | 🌐 | 中↔英自动检测，长按可选目标语言(中/英/日/韩/法/德/西) |
| 总结 | 📋 | 压缩为摘要 |
| 扩写 | 📝 | 展开论述，丰富细节 |
| 解释 | 💡 | 用通俗语言解释 |
| 自定义 | ⌨️ | 弹出输入框(300px)，用户输入自定义指令 |

**结果展示 — Inline Diff 模式**：
1. 点击操作 → 选中区域淡蓝色loading脉冲动画
2. AI返回 → 原文红色删除线 + 新文本绿色高亮显示在下方
3. 右侧浮动 ✅接受 / ❌拒绝 按钮
4. 点击编辑器其他位置 = 拒绝，自动恢复原文
5. 支持 `Ctrl+Z` 撤销已接受的替换

**错误处理**：超时(>15s)显示重试提示 / 选中>5000字提示分段处理 / 网络断开提示

### 5.2 层次2 — 斜杠命令

**触发**：空行或段落开头输入 `/`，弹出浮动命令菜单，支持模糊搜索，↑↓选择，Enter确认，Esc关闭

**AI写作类命令**：

| 命令 | 快捷输入 | 说明 |
|------|----------|------|
| `/续写` | `/xuxie` | 基于上文续写下一段 |
| `/大纲` | `/dagang` | 输入主题后生成文档大纲 |
| `/头脑风暴` | `/brain` | 围绕主题发散思考 |
| `/翻译` | `/fanyi` | 翻译上一段(可选目标语言) |
| `/总结全文` | `/summary` | 总结当前文档 |
| `/改写风格` | `/style` | 改变风格(学术/口语/正式/轻松) |

**知识库类命令**：

| 命令 | 说明 |
|------|------|
| `/引用` | 从知识库搜索并引用内容 |
| `/基于知识库写作` | 以知识库内容为素材生成段落 |

**内容生成类**：`/表格` `/代码块` `/公式` `/分割线` `/目录`

**参数输入**：需要额外输入的命令(如`/大纲`)，菜单变为参数输入模式，顶部显示命令名+返回按钮

**结果插入方式**：
- 续写/大纲/头脑风暴：光标位置逐字流式插入(打字机效果)，右下角"⏹停止生成"按钮
- 翻译/改写：替换当前段落，进入diff预览模式
- 格式命令：直接插入模板结构
- 生成完成后显示 ✅接受 / 🔄重新生成 / ❌撤销

### 5.3 层次3 — AI面板对话式写作

**对话驱动编辑器**：

场景1 — "帮我写一段关于XX的介绍"：
1. AI在面板中流式输出
2. 内容块右上角显示 📋复制 / 📌插入到编辑器
3. 插入逻辑：有光标→插入光标处，无光标→追加文档末尾
4. 插入后编辑器该段落淡蓝色高亮(2秒渐隐)

场景2 — "把第三段改得更正式一些"：
1. AI识别"第三段" → 编辑器中第三段自动高亮
2. AI输出修改版本，显示 🔄替换第三段 / 📋复制
3. 点击替换 → 编辑器进入diff预览模式

**上下文感知**：
- 文档<3000字：全文注入AI上下文
- 文档>3000字：光标前后各1500字 + 文档大纲
- 面板顶部显示 "📄 已关联当前文档（2,847字）"

**选中文本感知**：
- 选中文本时，AI面板输入框上方出现引用条："引用选中内容：'前30字...' [× 取消]"
- 发送后引用条消失

**边界情况**：
- 编辑器未打开文档：面板显示"请先打开一个文档"，对话禁用
- 文档切换：对话历史保留，上下文自动切换，面板提示"已切换到：新文档名"
- 并发：同一时间只允许一个AI写作任务，新请求排队

### 5.4 层次4 — 知识库引用写作

**AI回答中的引用标注**：
- 正文中以上标数字标注：`内容文本[1]`
- 数字为蓝色可点击链接（`color: #3182ce; font-size: 0.75em; vertical-align: super`）
- 回复末尾引用来源列表（默认折叠，显示"📎 2条引用来源 [展开]"）

**引用卡片**：
```
┌─────────────────────────────────────┐
│ 📄 产品需求文档 v2.3          92%  │
│ 来源：项目文档 / 需求 / PRD        │
│ ─────────────────────────────────── │
│ "用户认证模块需支持多种登录方式，  │
│  包括邮箱、手机号、第三方OAuth..."  │
│ [查看原文]  [插入引用]              │
└─────────────────────────────────────┘
```
- 相关度：>80%绿色，60-80%黄色，<60%灰色
- hover引用数字：200ms延迟弹出tooltip简化卡片
- 点击引用数字：AI面板右侧弹出引用详情侧滑面板

**用户主动引用（@ 引用）**：
- 编辑器中输入 `@` 触发知识库搜索面板（类似斜杠命令菜单）
- 实时搜索(debounce 300ms)，选择后插入只读引用块
- AI面板输入框中 `@` 同样触发，选择后显示为标签 `[@文档名]`

**无引用时**：不显示引用区块；搜索了但相关度都<50%时提示"未找到高度相关内容，以上回答基于AI通用知识"

---

## 六、文档管理与导入流程

### 6.1 创建/导入入口

文档列表页顶部「新建文档」按钮，右侧下拉箭头展开菜单：
- **空白文档** — 默认选项，点击主按钮区域等同于此
- **从文件导入** — 触发本地文件上传
- **从飞书导入** — 触发飞书文档导入

### 6.2 在线新建文档

1. 点击「新建文档」→ POST /api/documents `{ title: 'Untitled', source_type: 'create' }`
2. 后端创建记录：status='ready', kb_enabled=1, kb_status='pending', content=''
3. 返回id → 前端跳转 `/documents/{id}/edit`
4. 编辑器标题区自动聚焦，"Untitled"全选状态，用户可直接输入
5. 不弹标题输入框，标题inline编辑
6. 自动保存：内容变更后debounce 2s → PUT /api/documents/{id}，content变更时kb_status重置为'pending'

### 6.3 本地文件上传

**支持格式**：.docx(mammoth) / .pdf(pdf-parse) / .xlsx(xlsx) / .txt / .md
**限制**：单文件20MB，批量最多10个

**触发方式**：点击「从文件导入」弹出文件选择器 / 拖拽文件到页面（全屏半透明遮罩+虚线框）

**单文件处理流程**：
1. 前端校验格式和大小
2. POST /api/documents/upload (multipart/form-data)
3. 后端创建记录 status='parsing'，返回id
4. 前端列表显示parsing状态
5. 后端异步解析 → 更新content + status='ready' → 触发索引
6. 前端轮询检测status变化

**批量上传**：逐个调用(并发上限3)，顶部进度条"正在导入 3/5 个文档..."，完成后toast

**解析失败处理**：

| 场景 | 提示 | 操作 |
|------|------|------|
| 文件损坏 | 红色"解析失败"badge | 重试/删除 |
| PDF扫描件(无文字) | "未检测到文字内容" | 删除或保留空文档 |
| 加密文档 | "文档已加密，无法解析" | 删除 |

### 6.4 飞书文档导入

**入口**：「从飞书导入」→ 弹出模态框，输入框placeholder"粘贴飞书文档链接"

**授权前置检查**：未授权时显示引导弹窗 → 点击"去授权" → 飞书OAuth → 成功后自动返回

**导入流程**：
1. 前端解析URL提取docToken
2. POST /api/documents/import/feishu `{ url, docToken }`
3. 后端创建记录 status='parsing' → 调用飞书API获取标题和内容 → document-parser解析为Markdown → 处理图片 → status='ready' → 触发索引

**导入模式**：一次性导入，创建可编辑副本（不做实时同步）
- 理由：同步架构复杂、用户编辑后同步会覆盖、飞书API有频率限制
- 文档卡片显示飞书图标+"来自飞书"标签
- 编辑器页面提供「从飞书重新导入」按钮（二次确认后覆盖内容）

**边界情况**：URL格式错误→前端校验 / 无权限→提示授权 / token过期→自动刷新 / 画板(block_type 43)→插入占位文字 / 重复导入→允许创建新副本

### 6.5 文档与知识库的关系

**知识库开关**：默认 kb_enabled=1（导入即沉淀）

开启(OFF→ON)：kb_status='pending' → 触发索引 → 用户看到"索引中..."→"已索引"
关闭(ON→OFF)：删除关联的kb_items+kb_chunks+kb_bm25_index → toast"已从知识库移除"（无需二次确认，可随时重开）

**内容更新时重新索引**：content变更 → 后端对比hash → debounce 5s → 删除旧索引 → 重新分块→embedding→BM25

### 6.6 删除流程

单文档删除：「...」→「删除」→ 二次确认（已索引文档追加提示"将同时移除索引"）→ 级联删除 kb_bm25_index → kb_chunks → kb_items → documents

批量删除：勾选复选框 → 顶部操作栏 [加入知识库] [移出知识库] [删除] → 逐个执行

---

## 七、知识库集成

### 7.1 设计原则

知识库不暴露独立搜索入口，用户通过AI对话间接使用。理由：
- 与"知识库对用户隐形"的产品定位一致
- 减少认知负担，体验更自然

### 7.2 知识状态栏（AI面板内）

位置：AI面板标签栏下方，高度48px，背景 `#f7fafc`

```
📚 知识库：12 篇文档 | 最近更新 2小时前 | ● 已就绪    [管理]
```

状态指示灯：🟢已就绪 / 🟡索引中(3/12) / 🔴索引异常 / ⚪未启用
- 点击文档数 → 展开最近5篇文档列表
- 点击状态灯 → 异常时显示错误tooltip
- 点击[管理] → 打开知识库管理抽屉

### 7.3 知识库管理抽屉

从右侧滑入，宽度480px，覆盖在AI面板之上。

**概览统计**（3个卡片横排）：文档数 / 存储占用 / 文本块数

**操作工具栏**：[+ 导入文档] [🔄 重建全部索引] 🔍搜索文档

**文档列表**（可滚动）：每项显示文件图标+文件名+导入时间+大小+索引状态+操作按钮(hover显示)
- 点击展开详情：前3个chunk摘要预览
- 操作：重建索引 / 删除（二次确认）
- 支持批量选择+批量删除

### 7.4 索引状态提示

**索引中**：状态栏🟡旋转 + 管理面板进度条 + toast"正在为3篇新文档建立索引" + 不阻塞任何操作

**索引完成**：状态栏🟢 + toast"索引更新完成，新增3篇文档已可用"(3秒消失)

**索引失败**：状态栏🔴 + toast"2篇文档索引失败 [查看详情]"(不自动消失) + 管理面板显示失败原因+重试按钮

### 7.5 AI面板"引用"标签页

AI面板顶部标签 "对话 | 大纲 | 引用"，引用页展示本次对话所有引用过的知识库内容：
- 按引用次数降序排列
- 点击文档名展开被引用的所有片段
- 无引用时显示空状态提示

### 7.6 容量限制

- 单文件：50MB
- 总存储：100MB（可配置）
- 文档数上限：100篇（可配置）
- 单文档chunk上限：500

管理面板底部显示容量条：<80%绿色 / 80-95%黄色+提示 / >95%红色+导入禁用

---

## 八、数据模型

### 8.1 conversations 表

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',           -- AI自动生成，用户可修改
  summary TEXT NOT NULL DEFAULT '',         -- 最后一条消息摘要（列表预览用）
  message_count INTEGER NOT NULL DEFAULT 0,
  -- 来源
  source TEXT NOT NULL DEFAULT 'manual',    -- manual | ai_assistant | doc_convert
  source_doc_id TEXT DEFAULT NULL,          -- 从文档转来时关联的文档id
  -- 状态
  is_pinned INTEGER NOT NULL DEFAULT 0,     -- AI助手中钉住的对话
  is_starred INTEGER NOT NULL DEFAULT 0,    -- 收藏
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 8.2 conversation_messages 表

```sql
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,                       -- user | assistant
  content TEXT NOT NULL DEFAULT '',
  -- 引用
  references TEXT NOT NULL DEFAULT '[]',    -- JSON: 引用的知识库chunk ids
  cited_doc_ids TEXT NOT NULL DEFAULT '[]', -- JSON: 引用的文档ids
  -- 元数据
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 8.3 documents 表

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled',
  content TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'markdown',
  -- 来源
  source_type TEXT NOT NULL DEFAULT 'create',  -- create | upload | feishu
  source_path TEXT NOT NULL DEFAULT '',
  source_meta TEXT NOT NULL DEFAULT '{}',       -- JSON元数据
  -- 知识库
  kb_enabled INTEGER NOT NULL DEFAULT 1,
  kb_item_id TEXT DEFAULT NULL,
  kb_status TEXT NOT NULL DEFAULT 'pending',    -- pending|indexing|indexed|failed|disabled
  kb_error TEXT NOT NULL DEFAULT '',
  -- 状态
  status TEXT NOT NULL DEFAULT 'ready',         -- parsing|ready|error
  parse_error TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 8.4 workspaces 表（v1.2新增）

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                        -- 显示名称（默认为目录名）
  path TEXT NOT NULL UNIQUE,                 -- 本地绝对路径
  include_patterns TEXT NOT NULL DEFAULT '["**/*.md","**/*.txt","**/*.docx","**/*.pdf","**/*.xlsx"]',
  exclude_patterns TEXT NOT NULL DEFAULT '["node_modules/**",".*/**","dist/**"]',
  -- 状态
  status TEXT NOT NULL DEFAULT 'pending',    -- pending|scanning|ready|error
  file_count INTEGER NOT NULL DEFAULT 0,
  indexed_count INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT DEFAULT NULL,
  -- 元数据
  is_active INTEGER NOT NULL DEFAULT 0,      -- 当前活跃工作空间（全局唯一1个）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 8.5 workspace_files 表（v1.2新增）

```sql
CREATE TABLE IF NOT EXISTS workspace_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  relative_path TEXT NOT NULL,               -- 相对于workspace.path的路径
  file_hash TEXT NOT NULL DEFAULT '',        -- xxhash内容哈希，增量索引用
  file_size INTEGER NOT NULL DEFAULT 0,
  -- 知识库
  kb_status TEXT NOT NULL DEFAULT 'pending', -- pending|indexing|indexed|failed
  kb_item_id TEXT DEFAULT NULL,              -- 关联的kb_items.id
  -- 时间
  file_modified_at TEXT DEFAULT NULL,        -- 文件系统mtime
  last_indexed_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, relative_path)
);
```

### 8.6 kb_tags 表（v1.2新增）

```sql
CREATE TABLE IF NOT EXISTS kb_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'custom',   -- domain|tech|doctype|project|custom
  color TEXT NOT NULL DEFAULT '#6B7280',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kb_item_tags (
  item_id TEXT NOT NULL REFERENCES kb_items(id),
  tag_id TEXT NOT NULL REFERENCES kb_tags(id),
  confidence REAL NOT NULL DEFAULT 1.0,      -- AI标签置信度(0-1)，手动标签=1.0
  source TEXT NOT NULL DEFAULT 'manual',     -- manual | ai_auto
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, tag_id)
);
```

### 8.7 kb_summaries 表（v1.2新增）

```sql
CREATE TABLE IF NOT EXISTS kb_summaries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,                       -- item | tag | weekly
  scope_id TEXT NOT NULL,                    -- item_id / tag_id / '2026-W09'
  summary TEXT NOT NULL DEFAULT '',
  key_points TEXT NOT NULL DEFAULT '[]',     -- JSON: 关键要点列表
  model TEXT NOT NULL DEFAULT 'haiku',
  token_cost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope, scope_id)
);
```

### 8.8 kb_relations 表（v1.2新增）

```sql
CREATE TABLE IF NOT EXISTS kb_relations (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES kb_items(id),
  target_item_id TEXT NOT NULL REFERENCES kb_items(id),
  relation_type TEXT NOT NULL,               -- topic_similar | time_related | contradiction
  strength REAL NOT NULL DEFAULT 0.0,        -- 0-1，topic_similar=余弦相似度
  metadata TEXT NOT NULL DEFAULT '{}',       -- JSON: 额外信息（如矛盾描述）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_item_id, target_item_id, relation_type)
);
```

### 8.9 templates 表（v1.2新增）

```sql
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                        -- document | conversation
  category TEXT NOT NULL DEFAULT 'builtin',  -- builtin | user
  -- 内容
  content_skeleton TEXT NOT NULL DEFAULT '', -- 文档模板：Markdown骨架
  system_prompt TEXT NOT NULL DEFAULT '',    -- 对话模板：AI系统提示词
  opening_message TEXT NOT NULL DEFAULT '',  -- 对话模板：开场白
  -- AI配置
  ai_config TEXT NOT NULL DEFAULT '{}',      -- JSON: {kb_tags_filter, auto_actions}
  -- 元数据
  icon TEXT NOT NULL DEFAULT '📄',
  description TEXT NOT NULL DEFAULT '',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 8.10 kb_items 扩展字段（v1.2新增）

> 以下字段追加到现有 `kb_items` 表：

```sql
ALTER TABLE kb_items ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE kb_items ADD COLUMN key_points TEXT NOT NULL DEFAULT '[]';
ALTER TABLE kb_items ADD COLUMN doc_date TEXT DEFAULT NULL;           -- 文档日期（时间感知检索用）
ALTER TABLE kb_items ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';-- 增量索引用
ALTER TABLE kb_items ADD COLUMN reference_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kb_items ADD COLUMN last_referenced_at TEXT DEFAULT NULL;
ALTER TABLE kb_items ADD COLUMN health_status TEXT NOT NULL DEFAULT 'healthy'; -- healthy|outdated|archived
ALTER TABLE kb_items ADD COLUMN health_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE kb_items ADD COLUMN health_checked_at TEXT DEFAULT NULL;
ALTER TABLE kb_items ADD COLUMN summary_embedding BLOB DEFAULT NULL;  -- 摘要向量（摘要级检索用）
```

### 8.11 conversations 扩展字段（v1.2新增）

> 以下字段追加到现有 `conversations` 表：

```sql
ALTER TABLE conversations ADD COLUMN workspace_id TEXT DEFAULT NULL;  -- 绑定的工作空间
```

### 8.12 状态机

**文档解析状态 (status)**：
- `parsing` → (成功) → `ready` → (编辑保存) → `ready`(updated_at更新)
- `parsing` → (失败) → `error` → (重试) → `parsing`
- 在线新建直接进入 `ready`

**知识库索引状态 (kb_status)**：
- `pending` → `indexing` → `indexed` → (内容更新) → `pending`
- `indexing` → (失败) → `failed` → (重试) → `pending`
- 任意状态 → (关闭开关) → `disabled` → (开启开关) → `pending`

**视觉标识**：

| 状态 | Badge | 颜色 |
|------|-------|------|
| parsing | 旋转圆圈 "解析中..." | 蓝色 |
| ready + indexed | ✅ "已索引" | 绿色 |
| ready + indexing | 旋转圆圈 "索引中..." | 蓝色 |
| ready + pending | 🕐 "待索引" | 灰色 |
| ready + failed | ⚠️ "索引失败" | 橙色 |
| ready + disabled | — "未纳入知识库" | 灰色 |
| error | ❌ "解析失败" | 红色 |

---

## 九、API 端点

### 9.1 文档 CRUD

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/documents` | 文档列表（?q=&source_type=&kb_status=&sort=&page=&limit=） |
| GET | `/api/documents/{id}` | 单个文档详情 |
| POST | `/api/documents` | 在线新建文档 |
| PUT | `/api/documents/{id}` | 更新文档（标题/内容/标签/知识库开关） |
| DELETE | `/api/documents/{id}` | 删除文档（级联删除知识库数据） |

### 9.2 导入

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/documents/upload` | 本地文件上传（multipart/form-data） |
| POST | `/api/documents/import/feishu` | 飞书文档导入（{ url, docToken }） |
| POST | `/api/documents/{id}/reimport` | 飞书文档重新导入（覆盖内容） |

### 9.3 知识库操作

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/documents/{id}/reindex` | 手动重建索引 |
| POST | `/api/documents/batch/kb-enable` | 批量加入知识库（{ ids: [] }） |
| POST | `/api/documents/batch/kb-disable` | 批量移出知识库（{ ids: [] }） |
| POST | `/api/documents/batch/delete` | 批量删除（{ ids: [] }） |

### 9.4 对话

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/conversations` | 对话列表（?q=&source=&sort=&page=&limit=） |
| GET | `/api/conversations/{id}` | 对话详情（含消息列表） |
| POST | `/api/conversations` | 新建对话（{ title?, source? }） |
| PUT | `/api/conversations/{id}` | 更新对话（标题/标签/收藏/钉住） |
| DELETE | `/api/conversations/{id}` | 删除对话（级联删除消息） |
| POST | `/api/conversations/{id}/messages` | 发送消息（AI流式回复via SSE） |
| POST | `/api/conversations/{id}/to-document` | 对话转文档（AI整理后创建文档） |

### 9.5 AI助手（全局轻量对话）

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/ai-assistant/chat` | 临时对话（不持久化，流式SSE） |
| POST | `/api/ai-assistant/pin` | 钉住当前对话（升级为工作台对话） |

### 9.6 已有端点（保留）

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/knowledge/search` | 知识库混合搜索 |
| POST | `/api/knowledge/collections` | 集合 CRUD |
| POST | `/api/knowledge/items` | 条目 CRUD + 导入 |
| GET | `/api/feishu/auth/status` | 飞书授权状态 |
| GET | `/api/feishu/doc` | 飞书文档内容 |

### 9.7 工作空间（v1.2新增）

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/workspaces` | 工作空间列表 |
| POST | `/api/workspaces` | 创建工作空间（{ path, name?, include_patterns? }） |
| PUT | `/api/workspaces/{id}` | 更新工作空间（名称/过滤规则） |
| DELETE | `/api/workspaces/{id}` | 删除工作空间（仅删索引，不删文件） |
| POST | `/api/workspaces/{id}/scan` | 触发扫描（增量） |
| GET | `/api/workspaces/{id}/files` | 文件列表（?kb_status=&sort=&page=&limit=） |
| POST | `/api/workspaces/{id}/activate` | 设为活跃工作空间 |
| GET | `/api/workspaces/{id}/preview` | 预扫描（返回文件数/类型分布，不入库） |

### 9.8 网页剪藏（v1.2新增）

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/clip/url` | URL粘贴抓取（{ url }→ puppeteer抓取→创建知识条目） |
| POST | `/api/clip/html` | 浏览器扩展推送（{ url, title, html, text }） |

### 9.9 知识库整理（v1.2新增）

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/knowledge/tags` | 标签列表（?category=） |
| POST | `/api/knowledge/tags` | 创建标签 |
| PUT | `/api/knowledge/tags/{id}` | 更新标签 |
| DELETE | `/api/knowledge/tags/{id}` | 删除标签（解除关联） |
| GET | `/api/knowledge/summaries` | 摘要列表（?scope=item\|tag\|weekly） |
| GET | `/api/knowledge/relations` | 关联列表（?item_id=&type=） |
| GET | `/api/knowledge/health` | 知识健康度概览（统计+建议列表） |
| POST | `/api/knowledge/health/archive` | 批量归档（{ ids: [] }） |

---

## 十、快捷键汇总

| 快捷键 | 操作 | 页面 |
|--------|------|------|
| `Cmd+K` | AI助手（全局轻量对话+搜索） | 全局 |
| `Cmd+N` | 新建（文档/对话） | 全局 |
| `Cmd+\` | 折叠/展开导航栏 | 全局 |
| `Cmd+L` | 折叠/展开AI面板 | 编辑器 |
| `Cmd+S` | 手动保存 | 编辑器 |
| `Cmd+Shift+E` | 导出 | 编辑器 |
| `Cmd+B/I/E` | 加粗/斜体/行内代码 | 编辑器 |
| `Cmd+Shift+S` | 删除线 | 编辑器 |
| `Cmd+Z/Shift+Z` | 撤销/重做 | 编辑器 |
| `/` | 斜杠命令菜单 | 编辑器 |
| `@` | 知识库引用搜索 | 编辑器 |

---

## 十一、shadcn/ui 组件清单

| 组件 | 用途 |
|------|------|
| `Sidebar` | 左侧导航栏 |
| `Command` | 全局搜索 Cmd+K |
| `Card` | 文档卡片、AI入口卡片、统计卡片 |
| `ResizablePanelGroup` | 编辑器+AI面板分栏 |
| `Sheet` / `Drawer` | 知识库管理抽屉 |
| `Dialog` | 导出、确认、飞书导入弹窗 |
| `DropdownMenu` | 排序、筛选、用户菜单、更多操作 |
| `ContextMenu` | 文档右键菜单 |
| `Popover` | 斜杠命令、标签编辑 |
| `Badge` | 标签、状态指示 |
| `Tooltip` | 折叠态导航、工具栏按钮提示 |
| `ScrollArea` | AI面板消息滚动、文档列表滚动 |
| `Tabs` | AI面板标签(对话/大纲/引用)、视图切换 |
| `Checkbox` | 批量选择 |
| `Switch` | 知识库开关 |
| `Progress` | 容量条、索引进度 |

---

## 十二、功能优先级

### P0（必须实现）
- 工作台首页：导航栏 + AI入口卡片 + 内容列表(文档+对话混合，卡片/列表视图)
- 编辑器页面：Tiptap编辑器 + 工具栏 + 自动保存
- AI面板：对话式写作 + 上下文感知 + "应用到文档"
- AI助手：Cmd+K全局轻量对话 + 搜索 + 快捷操作
- 工作台对话：创建/持久化/知识库检索/引用标注
- 对话转文档：AI整理对话内容 → 生成结构化文档
- 行内AI操作：选中文本 → 浮动工具栏 → 润色/翻译/总结 → Inline Diff
- 斜杠命令：`/续写` `/翻译` `/总结全文` + 基础格式命令
- 文档CRUD：新建 + 本地上传 + 飞书导入
- 知识库自动索引：导入即沉淀 + 状态指示
- 知识库AI问答：对话中自动检索+引用标注
- 知识库标签系统：AI自动标签 + 手动标签 + 标签筛选
- 单文档AI摘要：导入时自动生成摘要和关键要点
- 时间感知检索：查询中解析时间表达式，按时间范围过滤
- 摘要级检索：文档摘要embedding + 两级检索（摘要→chunk）
- 网页剪藏（P0输入扩展）：浏览器扩展剪藏 + URL粘贴抓取

### P1（重要但可延后）
- AI面板对话式写作的高级功能（段落定位替换、多轮修改）
- AI助手对话钉住（临时对话 → 持久化工作台对话）
- 对话中手动引用文档作为上下文
- 工作空间模式：打开本地目录 → 扫描 → 索引 → 文件监听
- 工作空间Markdown直接读写实际文件
- 图片/截图输入：OCR + Claude Vision理解 → 索引
- 录音/语音输入：ASR转录 → 结构化 → 索引
- 表格数据输入：Excel/CSV解析 → 摘要 → 索引
- 主题摘要：同标签多文档综合摘要
- 查询意图路由：识别统计/时间线/检索等不同查询类型
- Agentic RAG：检索作为AI tool，支持多轮检索
- 文档间关联发现（embedding相似度）
- 知识库视图（时间线/主题/来源三种视图）
- 知识活跃度衰减（遗忘曲线）
- 知识库管理抽屉（概览统计、文档列表、重建索引）
- 全局搜索（文档+对话+知识库+操作）
- 导出功能（Markdown/Word/PDF）
- 批量操作（多选删除、批量加入/移出知识库）
- `@` 知识库引用
- 对话模板（周报助手、写作教练、翻译助手等预设）

### P2（后续迭代）
- 多工作空间切换 + 对话绑定工作空间
- 文件冲突处理（diff视图）
- 矛盾检测：同主题文档交叉比对
- 过时检测 + 归档建议
- 时间段摘要（本周知识摘要）
- 知识覆盖度分析
- 定期知识报告（本周知识报告）
- 模板库：独立管理界面 + 用户自建模板
- 收藏功能（文档+对话）
- 回收站（30天自动清理）
- 版本历史
- 聊天记录/邮件/视频等输入扩展
- 响应式适配（<768px）

### P3（远期愿景）
- 实体图谱（NER + 关系抽取）
- 关联视图（D3.js力导向图）
- 知识图谱辅助检索
- 社区模板分享
- 工作流自动化（定时触发 → 多步处理 → 输出）

---

## 十三、多源输入（v1.2新增）

### 13.1 统一输入抽象

所有输入经处理管线后统一为 KnowledgeItem：可索引的文本 + 元数据 + 附属文件。知识库只关心 `content`（文本）和 `attachments`（多模态附件）。

### 13.2 支持的输入类型与优先级

| 优先级 | 输入类型 | 处理管线 | 技术方案 |
|--------|----------|----------|----------|
| P0 | 文档(Word/PDF/MD/飞书) | 解析→Markdown→索引 | mammoth/pdf-parse/xlsx（已有） |
| P0 | 网页剪藏 | HTML→正文提取→Markdown→索引 | @mozilla/readability + turndown |
| P1 | 图片/截图 | OCR+Vision理解→文本→索引 | Tesseract.js + Claude Vision |
| P1 | 录音/语音 | ASR转录→说话人分离→结构化→索引 | OpenAI Whisper API(英) / 阿里云ASR(中) |
| P1 | 表格数据 | 解析→表头识别→AI摘要→索引 | xlsx/papaparse（已有） |
| P1 | 代码片段 | 语言检测→AI摘要→索引 | linguist + Claude API |
| P2 | 聊天记录 | 格式解析→按话题分段→AI摘要→索引 | 各平台专用解析器 |
| P2 | 邮件 | 解析邮件头+正文→提取附件→索引 | mailparser |
| P2 | 视频 | 音频提取→ASR+关键帧OCR→合并→索引 | ffmpeg + ASR + Vision |
| P2 | 思维导图 | 解析树形结构→层级Markdown→索引 | XMind ZIP解析 |
| P2 | 书签 | 解析书签文件→后台抓取正文→索引 | Chrome Bookmarks JSON |

### 13.3 统一处理架构

所有输入共享处理队列，每种类型实现独立的 `InputProcessor`：

```
InputQueue → Router(按source_type分发) → Processor(专用处理器)
  → Normalizer(统一输出KnowledgeItem) → Indexer(分块→向量化→BM25)
```

新增输入类型只需实现一个 Processor，不改动索引和检索逻辑。

### 13.4 网页剪藏交互（P0）

两种入口：
- **浏览器扩展**：Chrome中点击"保存到Lumos" → 扩展端 readability+turndown 提取正文 → 发送到Lumos
- **URL粘贴**：Lumos中粘贴URL → 后端 puppeteer 抓取 → 提取正文 → 创建知识条目

保留原始URL作为 source_uri，用户可随时跳转回原文。

---

## 十四、工作空间模型（v1.2新增）

### 14.1 设计原则

- **文件是真相之源**：工作空间中的文件就是文件本身，Lumos不创建副本，只创建索引
- **混合模式**：上传模式（P0）+ 工作空间模式（P1）并存，通过 ContentService 统一层融合
- **渐进式体验**：新用户从上传开始，高级用户可打开工作空间

### 14.2 工作模式对比

| 模式 | 存储 | 编辑 | 适合场景 | 阶段 |
|------|------|------|----------|------|
| 上传模式 | SQLite中的content | Tiptap编辑器 | 零散文件、飞书/网页导入 | P0 |
| 工作空间模式 | 原文件(fs) | Markdown直接读写，Word/PDF只读 | 已有文档体系 | P1 |

### 14.3 创建工作空间交互

用户点击「打开文件夹」→ 系统文件选择器 → Lumos显示预扫描结果（文件数、类型分布、排除规则）→ 用户确认 → 后台扫描和索引。工作空间出现在左侧导航栏工作空间区域。

### 14.4 与Claude Code CLI会话的关系

| AI层 | 工作目录 | 理由 |
|------|----------|------|
| AI助手（Cmd+K） | Lumos数据目录 | 轻量问答不需要特定目录 |
| 工作台对话 | 活跃工作空间目录（如有） | 深度对话可能需要读写工作空间文件 |
| 文档AI面板 | 文档所在目录 | 编辑辅助需要感知文档上下文 |

### 14.5 文件变更感知

- 使用 chokidar 监听文件变更（跨平台最成熟）
- 增量索引：xxhash对比content hash + debounce 5秒
- 单工作空间文件上限：2000个文档文件
- 外部编辑冲突：顶部提示条 [查看差异] [使用外部版本] [保留当前版本]

---

## 十五、知识库深度整理（v1.2新增）

### 15.1 设计理念

类比人脑：白天接收信息（导入）→ 睡眠时整合记忆（整理）→ 醒来后形成新认知（洞察）。知识库不只是"存进去+搜出来"，还需要AI自动整理和深加工。

核心原则：**AI做脏活，用户做决策**。

### 15.2 组织结构：扁平标签 + 智能视图

不引入树形目录（与"导入即沉淀"轻量理念矛盾），采用：
- **标签系统**：AI自动标签(导入时生成) + 用户手动标签，标签分类(domain/tech/doctype/project/custom)
- **四种视图**：时间线视图(默认) / 主题视图(按标签聚合) / 来源视图(按source_type分组) / 关联视图(P2,D3.js图谱)

### 15.3 三层整理架构

**第一层：自动摘要**
- 单文档摘要：导入完成后异步生成（Haiku，~$0.03/100篇）
- 主题摘要：标签下文档≥3篇时生成综合摘要
- 时间段摘要：每周自动生成"本周知识摘要"

**第二层：关联发现**
- 主题关联：文档摘要embedding余弦相似度>0.7自动建立关联（本地计算，零API成本）
- 时间关联：同标签、7天内的文档自动关联（纯规则驱动）
- 矛盾检测(P2)：同标签文档交叉比对，AI分析一致性
- 简化实体图谱(P3)：从摘要提取核心实体(人名/项目/技术)，建立文档间桥梁

**第三层：知识健康度**
- 遗忘曲线：`活跃度 = reference_count * e^(-days/90)`，长期不引用的知识降权
- 过时检测：规则(年份过旧/含"草案"关键词) + AI确认
- 归档建议：health_status=outdated超30天 或 活跃度<0.1且创建超6个月
- 覆盖度分析：基于标签分布分析主题覆盖情况和知识空白

### 15.4 整理边界（三级分类）

| 级别 | 操作 | AI角色 | 示例 |
|------|------|--------|------|
| 全自动（用户无感） | 元数据生成 | 自主执行 | 摘要、标签、相似度、引用计数、活跃度 |
| AI建议+用户确认 | 影响组织/检索 | 建议+等待 | 矛盾检测、归档建议、过时标记、标签合并 |
| 用户主导 | 个人偏好 | 仅辅助 | 手动标签、删除、知识库开关、分类体系 |

渐进式展示：文档数>10开始展示标签视图，>30展示关联和报告。设置中提供"整理强度"：积极/适度(默认)/最小化。

### 15.5 本周知识报告（P2）

每周自动生成，内容包含：新增文档统计、活跃主题、发现的关联、潜在矛盾、过时/归档建议、知识健康度概览。用户可在知识库管理中查看，建议操作可一键执行。

### 15.6 RAG增强方向

| 增强 | 解决场景 | 方案 | 优先级 |
|------|---------|------|--------|
| 时间感知检索 | 跨文档关联/模糊回忆 | doc_date字段+查询时间解析 | P0 |
| 摘要级检索 | 跨文档/模糊回忆 | 摘要embedding+两级检索 | P0 |
| 查询意图路由 | 统计/时间线查询 | query-rewriter识别类型分发 | P1 |
| Agentic RAG | 多跳推理 | 检索作为AI tool，多轮检索 | P1 |
| 文档关联图谱 | 跨文档关联 | 预计算关联+检索扩展 | P2 |

成本预估：100篇文档规模，所有整理机制月成本约$0.08（Haiku）。

---

## 十六、模板模块定位（v1.2新增）

### 16.1 AI时代模板的本质

模板 = 预设结构 + 预设AI行为(system prompt) + 预设上下文绑定 + 预设数据拉取规则。分为文档模板和对话模板两种实例化方式。

### 16.2 导航定位：降级为"新建"子选项

MVP阶段模板不作为独立导航项，入口融入现有流程：
- 工作台首页AI入口卡片的快捷按钮（📋会议纪要 📊周报 📑技术方案）即文档模板入口
- "新建"菜单中增加"从模板创建"选项
- AI助手支持自然语言触发对话模板（"帮我写周报" → 自动应用周报助手模板）

### 16.3 MVP预置模板（6个）

| 模板名 | 类型 | 价值 |
|--------|------|------|
| 技术方案 | 文档 | 高频 + 展示知识库检索能力 |
| 会议纪要 | 文档 | 通用 + 结构清晰 |
| 需求文档 | 文档 | 专业场景 + AI扩写价值高 |
| 周报助手 | 对话 | 杀手级场景：对话→文档流的最佳展示 |
| 写作教练 | 对话 | 展示对话模板差异化 |
| 翻译助手 | 对话 | 通用需求 + 术语表定制 |

### 16.4 演进路径

- P0：首页快捷按钮 + 新建菜单中3-5个预置文档模板骨架
- P1：对话模板预设(system prompt + 开场白) + AI增强(知识库上下文绑定)
- P2：独立模板库导航项 + 用户自建模板("另存为模板") + 模板管理
- P3：自适应模板(AI从用户行为中提取写作模式，自动生成个性化模板)
