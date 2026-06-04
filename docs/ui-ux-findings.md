# Lumos UI / UX 优化清单

> `/loop` 持续扫描产出。每轮在末尾追加。优先级:P0=违反既定偏好/明显体验缺陷,P1=一致性/可用性,P2=打磨。
> 既定偏好基线:不要 `bg-gradient`/from-via-to/glow 阴影,用纯色 + ring/border;文案克制,不写问候语/营销/emoji 修辞。

## 进度
- [x] 第 1 轮:渐变/glow/动画 + emoji 文案(P0)
- [x] 第 2 轮:98 处原生 confirm/alert 绕过设计系统(P0)+ a11y
- [x] 第 3 轮:~17 个手搓模态绕过 Dialog 原语 + 列表行纯 div(P1)
- [x] 第 4 轮:加载态/空态/表单校验三处缺统一约定(P1)
- [x] 第 5 轮:暗色硬编码(登录/支付必经路径)+ 0 虚拟化(P1/P2)
- [x] 第 6 轮:i18n 字典全但用法覆盖低(英文模式中英混杂)(P1)
- [x] 第 7 轮:ErrorBoundary 质量好但粒度粗+缺路由级兜底;窄面板溢出(P2)
- [x] 第 8 轮:纯图标按钮无 aria-label/tooltip(P1)+ 冗长文案(P2)
- [x] 第 9 轮:8 处焦点不可见(含聊天输入框)+ 操作反馈稀疏不一致(P1/P2)
- [x] 第 10 轮:hover-only 操作键盘够不到(15 文件)+ 日期格式 76 处各搓各的(P1/P2)
- [x] 第 11 轮:227 禁用按钮仅 3 个说明原因 + transition-all 47 处(P1/P2)
- [x] 第 12 轮:所有浮层挤 z-50 易层叠打架(toast 被 modal 盖)+ 货币格式三种混用(P2)
- [x] 第 13 轮:外链/生成图缺 onError 兜底(坏图裂)(P2);滚动保持/图片CLS 实为正面
- [x] 第 14 轮:输入框几乎无 maxLength(8/166)+ 对话框聚焦/Enter 提交不一致(P1/P2)
- [x] 第 15 轮:84/167 truncate 无 title(全文看不到)(P2);placeholder 质量实为正面
- [x] 第 16 轮:59 文件有快捷键但可发现性≈0(kbd=0)(P2);剪贴板反馈实为正面
- [x] 第 17 轮:主按钮泛滥(多屏 6~19 个全 primary)层级塌(P2);数字输入实为正面
- [x] 第 18 轮:超小字号泛滥(≤9px 90处)+ 原始技术错误直抛用户(287处)(P2)
- [x] 第 19 轮:图标库 lucide+hugeicons 双跑(315文件)+ 相对时间 24/30 不自动刷新(P2)
- [x] 第 20 轮:断网检测=0(掉网无提示)(P2)+ UI 文案标点半/全角混用(P3)
- [x] 第 21 轮:sticky 表头/操作栏缺(滚动丢上下文)(P2);圆角基本成体系(P3)
- [x] 第 22 轮:多选 78 处无共享 hook/多数无全选(P2);Tab 顺序干净(正面)
- [x] 第 23 轮:分离式 settings 行 Switch 未关联 label(P2)+ 必填标记少(16/60)(P2)
- [x] 第 24 轮:useAutoSave 好 hook 仅 1 处用/其余编辑器无保存保护(P2);数字千分位(P3)
- [x] 第 25 轮:无全局通用 toast 系统(只 memory 专用)——反馈主线的根(P1)+ 上传拖拽稀疏(P3)
- [x] 第 26 轮:间距/嵌套对话框/内联style 三处均干净(正面)→ 债在约定层非像素层
- [x] 第 27 轮:操作几乎全悲观更新(改完转圈refetch)(P2);设置导航OK无搜索(P3)
- [x] 第 28 轮:muted-foreground 再叠透明度→小字对比度<AA(P2);onboarding 有(正面)
- [x] 第 29 轮:prefers-reduced-motion 零尊重(0/323)(P2);颜色状态点都带文字(正面)
- [x] 第 30 轮:原生select与Radix混用/长列表不可搜(P2)+右键菜单近乎缺失(P3)
- [x] 第 31 轮:Badge/99+ 封顶 OK(正面);拖拽排序无键盘替代(P3)
- [x] 第 32 轮:焦点恢复 Radix 已处理(指回第3轮);横滚渐隐提示缺(P3)
- [x] 第 33 轮:25文件有loading无error分支(P2)+长任务取消不全(生成中停不了)(P2)
- [x] 第 34 轮:智能日期/图标尺寸非问题(正面);删除危险色不一致(P3)
- [x] 第 35 轮:ImageLightbox 无Esc无关闭按钮=键盘陷阱(P2,坐实第3轮)+翻页方式混用(P3)
- [x] 第 36 轮:select-none/Tooltip 正面;窗口标题不更新+路径结尾截断(P3)
- [x] 第 37 轮:基座 DialogContent 无 max-h→高内容顶出屏/按钮够不到(P2,一处修复)+数字越界(P3)
- [x] 第 38 轮:表单弹框点外部即关丢输入/无脏态拦截(P2);按钮顺序基本一致(正面)
- [x] 第 39 轮:autoComplete/break-words/外链rel 三处均干净(正面)
- [x] 第 40 轮:搜索框 30 个仅 4 防抖/服务端搜索每键查(P2);骨架同第4轮

---

## 第 1 轮 — 渐变 / glow / emoji 文案

### P0-1 `mind/master-profile-card.tsx` 是偏好的反面教材(单文件踩满)
`src/components/mind/master-profile-card.tsx:13-14,18`
- `bg-gradient-to-br from-[#FFFBEB] to-white` 卡片渐变
- `shadow-[0_0_20px_rgba(255,215,0,0.4)]` + hover `0_0_30px...0.6` 金色 glow
- `animate-pulse` 金色覆盖层(`animationDuration:3s`)持续呼吸,干扰阅读
- 硬编码 hex(`#FDE68A/#FFD700/#FFA500/#D97706`),脱离主题 token,暗色模式必然割裂
- `hover:-translate-y-1.5` 卡片整体上浮
- 文案 emoji:`💡 多和我聊聊，我会更懂你`
- **建议**:`border border-amber-500/30 bg-card`,皇冠图标块用纯 `bg-amber-500/10 text-amber-600`,删 glow/pulse/translate,emoji 去掉。

### P0-2 渐变散落在 11 个组件,需统一清理
具体行:
- `app/builder/DemoReviewBanner.tsx:18` 顶栏 `from-amber-500/.. to-transparent`
- `app/builder/RequirementsPanel.tsx:85` 容器底色渐变;`:222-223` primary 光晕 `blur-xl` + ring
- `app/builder/requirements/status-meta.tsx:25,34,46,56,70` 五处分隔线渐变(可换 `border-t` 或纯色细线)
- `app/builder/requirements/StoryCard.tsx:165,171` 卡片状态底色渐变
- `chat/ProLoginPrompt.tsx:51` 图标块 `from-violet-500 to-indigo-500`
- `chat/MessageItem.tsx:559` 折叠遮罩 `from-secondary to-transparent`(这种"渐隐遮罩"算合理用途,可保留,但应确认与纯色背景衔接)
- `chat/CodeBlock.tsx:233-234` 代码块底部渐隐(同上,功能性遮罩,低优先)
- `workflow/WorkflowDslGraph.tsx:140` + `workflow/visual-editor/workflow-canvas.tsx:334` 画布 `from-violet-500/5 via-background to-sky-500/5`
- `app/library-demo/page.tsx:298,373,2583` demo 页多处(2583 是 sky→blue 大按钮 + `hover:shadow-sky-300/40` glow)
- **判断**:图标/状态色块和卡片底色的装饰性渐变 → 换纯色;聊天/代码块的"渐隐遮罩"是功能性的 → 保留但核对衔接色。

### P1-3 文案里的 emoji 修辞 / 问候
- `workspace/empty-state.tsx:38` `icon="✨"`
- `workflow/AgentPresetEditor.tsx:223,267,290,296` 多处 `✨ 生成 / ✨ AI 生成 / ✨ 用 AI 自动生成`(✨ 重复 4 次)
- `memory/memory-onboarding.tsx:35` `欢迎使用 Lumos 记忆系统`(问候式标题)
- `feishu/auth/callback/route.ts:101` `欢迎，${name}`
- **建议**:✨ 全删,按钮用「生成」「AI 生成」即可;onboarding 标题改陈述句(如「记忆系统」)。
- 注:`mind/*.md`、`etsy-erank/mock-data.ts` 里的 emoji/营销词是设计稿/mock 数据,不算线上文案,跳过。

---

## 第 2 轮 — 原生 confirm/alert 系统性绕过设计系统

### P0-4 全仓 98 处原生 `window.confirm/alert`,而设计系统早有对话框组件
现状:`src/components/ui/` 已有 `alert-dialog.tsx`、`toast.tsx`,`src/components/bridge/ConfirmDialog.tsx` 还是一个**完全通用**的封装(props: `title/description/confirmText/cancelText/variant=destructive/showWarningIcon/onConfirm`)。但:
- **98 处**直接用原生 `confirm()/alert()`(阻塞、样式与应用割裂、Electron 下行为不一致、暗色模式无视、无法本地化样式)。
- `toast()` 全仓只调了 **8 次**——反馈基本没用起来。
- 破坏性删除走原生 confirm 的重点位:`workflow/ScheduleList.tsx:276,331`、`workflow/WorkflowCard.tsx:64`、`workflow/AgentPresetList.tsx:226,275`、`workflow/step-editors/step-editor-shared.tsx:124`、`ecommerce/ResearchTab.tsx:176,200,514,767`、`ecommerce/DiscoverTab.tsx:930,1480`、`ecommerce/StudioTab.tsx:184,204`、`workspace/workspace-picker.tsx:206`、`knowledge/kb-doc-list.tsx:37`、`knowledge/library-import-panel.tsx:289`。
  - **这条直接违反 CLAUDE.md**:高风险/破坏性动作要走应用内确认,不能用阻塞式原生弹窗。
- `alert()` 当报错用(应改 toast/内联)**10 处**:`apps/list/use-app-install.ts:58,78`(安装失败)、`ecommerce/DiscoverTab.tsx:948,1488` 等。
- `alert()` 当"占位提示":`layout/sidebar-nav-item.tsx:33` `alert("功能即将上线，敬请期待")` —— 用 alert 做"敬请期待"体验很差。
- `declarative/widgets/action/ActionButton.tsx:45` 用了 `window.confirm`,但同模块自己定义了 `bridge.confirm()` 抽象 —— **自家有抽象却没用**。

### P0-4 根因 + 建议(architect 视角)
通用 `ConfirmDialog` 存在,但**没有命令式 `useConfirm()` hook**——开发者要逐处管理 `open` state、写 JSX,成本高,于是顺手 `window.confirm()`(一行)。这是 98 处绕过的真正原因。
- **建议**:加一个 promise 式 `const confirm = useConfirm()` → `if (!(await confirm({title, description, variant:'destructive'}))) return;`,签名贴近原生 confirm,迁移摩擦最低;配套 `useToast` 收口 10 处报错 alert。这样 98 处能机械式替换,且天然满足 CLAUDE.md 的应用内确认。
- 不要逐个手搓 dialog state(会再次因为麻烦而被绕过)——一次给对等价的 imperative API 才是长期解。

### P1-5 可访问性
- **好**:`<img>` 全仓没有缺 alt 的(应该是统一走了组件/next-image)。
- 19 处 `<div onClick=...>` 可点击 div,未核实是否带 `role="button"` + `onKeyDown`/`tabIndex`,键盘用户可能点不到。下一轮逐个核(重点交互区:列表项、卡片)。

---

## 第 3 轮 — 手搓模态绕过 Dialog 原语 + 交互元素键盘可达性

### P1-6 ~17 个手搓模态没用 Radix `Dialog`/`Sheet`,Esc/滚动锁/焦点各行其是
模式:`<div className="fixed inset-0 z-50 ... bg-black/50" onClick={onClose}>` + 内层 `onClick={e=>e.stopPropagation()}`,自己拼背景层。涉及:
- etsy-forge:`ImageLightbox / CutoutModal / ReviewModal / MaterialPicker / ProductPickerModal / RemixMoreModal / ProductMockupModal`
- etsy-erank:`ListingLightbox / NewRunDialog / SettingsSheet`
- goofish:`FulfillmentDetailDialog / GoofishLoginBrowserModal / ProductAddListingDialog / ProductListingComposeDialog / XianyuItemRefreshDialog`
- 其他:`pinterest-radar/NewRunDialog`、`ai-assistant/assistant-modal`

**实测它们能力参差(同一仓库内体验不一致)**:
| 模态 | Esc 关闭 | 滚动锁 | 焦点管理 |
|---|---|---|---|
| CutoutModal / ProductMockupModal / ReviewModal | 有 | 有 | 无 |
| ImageLightbox | 有 | 无 | 无 |
| ProductPickerModal / MaterialPicker / RemixMoreModal | 无 | 有 | 无 |

- 后果:键盘用户进了模态出不来(无焦点陷阱/无焦点恢复)、背景能滚动、`role=dialog`/`aria-modal` 缺失、Esc 行为时有时无。
- **建议**:统一迁到 `components/ui/dialog.tsx`(Radix)或 `sheet.tsx`——Esc、焦点陷阱、焦点恢复、滚动锁、`aria-modal`、点击背景关闭全部免费且一致。背景层 `onClick={onClose}` 的"无键盘"问题迁移后自动消失。
- 这条和第 2 轮"缺 imperative API 导致绕过"同源:有原语,但**没人用,因为手搓背景层更直观**。需要在团队约定 + 评审里收口。

### P1-7 列表行 / 卡片用纯 `<div onClick>` 当按钮,键盘点不到
- `app/documents/page.tsx:100` `DocRow`:`<div cursor-pointer hover:bg-accent onClick={onClick}>` 是打开文档的主入口,但不是 button、无 `tabIndex`/`role`/`onKeyDown` → Tab 走不到、Enter/Space 触发不了。
- 同类待逐查:`workflow/AgentPresetList.tsx:83` 等。
- **建议**:可点击整行优先用 `<button>` 或加 `role="button" tabIndex={0} onKeyDown=(Enter/Space)`;有嵌套交互(如行尾菜单)时用 `<button>` 包主体、停止冒泡处理子操作。

---

## 第 4 轮 — 加载态 / 空态 / 表单校验:横切关注点缺统一约定

承接第 2、3 轮的主线:**有原语没约定 → 各模块各搓各的、体验不一致**。本轮三处实锤:

### P1-8 加载态三种写法混用,Skeleton 原语几乎闲置
- `Loader2/animate-spin` 出现在 **158 个文件**;纯文字「加载中/正在加载」**62 个**;`Skeleton` 只有 **12 个**。
- `components/ui/skeleton.tsx`、`spinner.tsx` 都在,但 skeleton(布局稳定、感知更快、无内容跳动)基本没人用。
- 纯文字「加载中」是最低质方案,且常导致内容 pop-in 把布局顶动。可优先升级为 skeleton 的样本:`settings/BuiltinAppsSection / SpeechProviderSection`、`knowledge/library-import-panel / TagsManageSheet`、`workflow/ApprovalDrawer / WorkflowKnowledgePanel / debug-output-panel`、`ecommerce/OverviewTab / ProductDetailDialog / LibraryTab`。
- **建议**:定 1 个约定——列表/卡片类首屏用 `<Skeleton>` 占位,行内动作用 `spinner.tsx`,禁止裸「加载中」文字。

### P1-9 空状态:4 个各自为政的 EmptyState + 108 处临时「暂无」文案
- 已有 **4 个互不相干**的空态组件:`workspace/empty-state.tsx`、`mind/memory-empty-state.tsx`、`douyin-collector/.../LibraryEmptyState.tsx`、`etsy-erank/.../EmptyStepState.tsx`——各搓各的,样式/留白/图标都不一致。
- 另有 **108 个文件**散写「暂无/还没有/没有数据」纯文本,无插画/无引导动作(好的空态应含:一句说明 + 主 CTA)。
- **建议**:抽 `components/ui/empty-state.tsx`(icon + title + description + 可选 action 插槽),4 个 fork 和 108 处文本统一收口。

### P2-10 全仓 0 个 `react-hook-form`/`zod`,表单校验全手搓
- `react-hook-form / useForm / zodResolver / formState.errors` 用量 = **0**。所有表单都是 `useState` + 手写校验。
- 后果:校验时机(blur/submit)、错误文案位置、必填标记、提交禁用条件各页不一,`text-destructive/text-red-` 散落 238 文件但无统一错误展示契约。
- **建议**(权衡):简单表单不必强上 RHF,但应至少抽一个 `useField`/`<FormError>` 约定统一"错误如何显示";复杂表单(Provider 配置、工作流步骤编辑、应用设置)建议上 RHF + zod,校验和类型一处定义。

### 主线小结(给决策用)
第 2~4 轮指向同一根因:**Lumos 设计系统的"原子组件"齐全,但缺"横切模式"的统一封装与约定**——confirm、modal、loading、empty、form-validation 全靠各 feature 自觉,于是分叉。**最高杠杆的不是逐个改文案/样式,而是补这 5 个横切约定(imperative confirm/toast、Dialog 迁移、Skeleton 约定、共享 EmptyState、Form 错误契约),然后机械式收口。**

---

## 第 5 轮 — 暗色模式硬编码 + 长列表虚拟化

### P1-11 关键路径(登录/注册/支付)整套浅色硬编码,暗色模式割裂
- `chat/LoginForm.tsx:6` 输入框基类:`bg-white/70 border-neutral-200 text-neutral-800 placeholder:text-neutral-300 focus:border-violet-300 focus:ring-violet-100`——**全浅色字面量、无 `dark:` 兜底**,暗色环境下白底输入框 + 浅灰边突兀。`:144` 同款。`RegisterForm.tsx` 大概率一致。
- `payment/RechargeDialog.tsx:274` `bg-white` 内卡片——**支付路径**暗色下白块。
- 双重问题:① 不响应暗色;② 用 `violet/neutral` 字面色而非主题 token(`bg-background/bg-card/border-border/ring-ring/text-foreground`),既偏离品牌主色又无法跟随主题。
- **建议**:auth/payment 表单换主题 token:输入框 `bg-background border-input text-foreground focus-visible:ring-ring`,卡片 `bg-card`。这是用户第一/付费触点,优先级高于内部页。
- 误报澄清:`ui/toast.tsx:85` 的 `bg-white` 是关闭按钮 `hover:bg-white/20` 半透明覆盖,暗色安全,**不用动**。

### P1-12 其余硬编码颜色面(16 文件 bg-white / 16 文件 gray / 7 文件 hex)
- 重点核查清单(线上路径优先):`memory/*`(memory-toast / smart-memory-preview / memory-highlight / memory-stats / memory-grid)、`bridge/ShareLinkDialog`、`extensions/ExtensionPackManager`、`ecommerce/DiscoverTab`。逐个确认是否有 `dark:` 兜底,无则换 token。

### P2-13 全仓 0 虚拟化,长列表裸 `.map` 渲染全部 DOM
- `react-window/react-virtual/virtuoso` 用量 = **0**。
- 数据会变长的列表都是裸 `.map`:`chat/MessageList.tsx`(长会话上千条消息)、`knowledge/kb-doc-list.tsx`(知识库文档)、会话列表、微信联系人/消息、电商候选/报告列表。
- 后果:大数据量时首屏慢、滚动卡顿、内存涨;聊天尤其明显(每条消息含 markdown 渲染)。
- **建议**(按数据规模权衡,非一刀切):先给"天然可能上千条"的 `MessageList` 和知识库列表上 `@tanstack/react-virtual`;固定高度行的列表收益最大。短列表(设置项、tab)不必上。

---

## 第 6 轮 — i18n:字典完整,但用法覆盖低 → 英文模式中英混杂

### P1-14 双语字典已填满,组件却大量绕过 t() 写死中文
- `src/i18n/{en,zh}.ts` 行数几乎一致(**en 1954 / zh 1951**)——说明**已有 key 的翻译是双语齐全的**,字典本身不是瓶颈。
- 但走 `useTranslation/t()` 的只有 **112 个文件**,而含中文的组件文件有 ~498 个(含注释,但 JSX 内联中文占大头)。**结论:大量 UI 文案根本没进字典,英文模式直接显示中文。**
- 更糟的是**半翻译**:不少文件已 import `useTranslation`,却仍有硬编码中文。实例 `chat/ChatView.tsx:1632` `浏览器正在被占用`(应 `t(...)`)。混用样本:`settings/UsageStatsSection / GeneralSection`、`deepsearch/*`、`chat/MessageInput / MessageItem / ChatView`、`layout/ConnectionStatus`。
- 后果:用户切到 English 看到的是**中英混杂界面**——比"全中文不支持英文"更糟,显得半成品。
- **建议**:① 把"已 import t() 却仍硬编码"的文件先收口(改动小、消除混杂感最快);② 给硬编码中文加一条 lint/CI 规则(JSX text/placeholder/title 含 CJK 即告警),防回潮;③ 真不打算支持英文就应隐藏语言切换入口,别露出残缺英文。

### P2-15 异步按钮重复提交(基本健康,少量待查)
- 整体良好:**114 个文件**用了 `disabled={loading/submitting/pending/busy/saving}`,说明"提交时禁用"是普遍习惯。
- 仅 **33 个**含 `onClick={async ...}` 的文件待抽查是否漏了禁用/loading 态(防双击重复提交、防重复发起请求)。优先核:发起付费/扣配额/写操作的按钮。
- 非系统性问题,P2,抽查即可。

---

## 第 7 轮 — 崩溃兜底粒度 + 窄面板溢出

### 正面记录:`ErrorBoundary` 组件做得好
`layout/ErrorBoundary.tsx` 的 fallback 质量高:主题 token、i18n、错误详情可折叠(含 stack)、「重试(reset)」+「重载应用」双按钮。这是前几轮"横切关注点缺约定"主线里**少见的反例**——说明团队会做好共享组件,问题更多在"有了没普及"。

### P2-16 兜底粒度太粗 + 缺 Next.js 路由级 error 文件
- `app-layout.tsx` 只在 2 处用 `ErrorBoundary`(`:199` 包整个 `{children}` 主内容区、`:207` 包一个面板)。主内容区**只有一层**边界 → chat / workflow / knowledge / 浏览器任一深层组件渲染崩溃,**整个主工作区一起白屏**到 fallback,而不是只挂掉那个面板。
- 独立面板(聊天 + 内置浏览器 + 知识库并存)更应**每个主面板各包一层**,隔离崩溃、其余面板照常用。
- 全仓**无 `app/error.tsx` / `app/global-error.tsx`**。App Router 的路由段错误、根 layout 渲染错误不走客户端 ErrorBoundary;缺 `global-error.tsx` 时根布局崩溃会露出 Next.js 默认无样式错误页。
- **建议**:① 给每个主面板/路由区加 `ErrorBoundary`(组件现成,纯部署);② 补 `app/global-error.tsx`(根兜底)和关键路由段 `error.tsx`,复用同一 fallback UI。

### P2-17 固定像素宽度的窄面板溢出风险
- **60 个文件**用 `w-[NNNpx]`/`min-w-[≥100px]` 固定宽度。桌面端分栏可拖窄,固定宽度子项在窄面板里会横向溢出/挤压。
- `whitespace-nowrap` 12 文件——配合固定宽度时更易触发横向滚动条。
- **好的一面**:`truncate`(167)与 `min-w-0`(163)基本成对,说明 flex 截断纪律不错(flex 子项不加 `min-w-0` 时 `truncate` 会失效撑破)——少量不成对的待抽查。
- **建议**:重点核查可拖拽分栏内的固定宽度块(优先 `min-w-0 + flex-1` 或 `max-w` 替代死宽);窄面板加最小宽阈值或允许内容换行。

---

## 第 8 轮 — 纯图标按钮无障碍名 + 文案克制度

### P1-18 35 个 `size="icon"` 按钮,32 个无 `aria-label`/`title`,Tooltip 仅 25 文件用
抽查确认是真缺(非 sr-only/Tooltip 兜底):
- **密码/Key 显隐切换**(高频且语义不直观):`settings/AddProviderDialog.tsx:319`、`settings/providers/ProviderEditorDialog.tsx:217`、`settings/ProviderEditDialog.tsx:331`——Eye/EyeOff 图标按钮,读屏只念"按钮",且应带 `aria-pressed` 表达切换态。
- **导航/动作**:`goofish/GoofishChatDetail.tsx:117`(返回 ArrowLeft)、`:123`(刷新 RefreshCw)、`plugins/PluginCard.tsx:62`——均无名。
- 后果:① 读屏用户完全不知按钮作用;② 鼠标用户无 hover 提示,纯靠猜图标。
- **建议**:所有图标按钮强制 `aria-label`(切换类加 `aria-pressed`);对作用不直观的(显隐 Key、刷新、归档等)再包 `Tooltip` 提升可发现性。可加一条 lint:`size="icon"` 必须有 `aria-label`。

### P2-20 冗长 / 产品观文案塞进 UI(对照"能删就删")
应精简的(陈述性帮助文字过长或像路线图文案):
- `workflow/workflow-node-development-view.tsx:47,85` —— "当前目标不是给每个用户做私有节点，而是把通用执行能力沉淀成可管理、可发布、可复用的标准能力包…" 这类**产品愿景叙述**出现在功能面板里,用户不需要,建议删或压成一句。
- `settings/BuiltinAppsSection.tsx:119`、`settings/ProviderEditDialog.tsx:404`、`settings/BrowserProviderSection.tsx:647` —— 两句以上的设置说明,可压成一句或移到 `?` 悬浮帮助。
- **应保留**(不是冗余,是安全/行为告知):`goofish/DraftsTab.tsx:72` "发送前必须由用户确认"、`SettingsTab.tsx:103` "修改后下一条草稿生效"、`AppAcceptancePanel.tsx:205` 验收口径——这些是必要约束说明,留。
- 判断准则:删"解释产品为什么这么设计"的话;留"用户操作会产生什么后果"的话。

---

## 第 9 轮 — 键盘焦点可见性 + 操作反馈一致性

### P1-21 8 处交互元素 `outline-none` 且无任何 focus 样式 → 键盘焦点不可见
(已剔除"有 `focus:ring` 只是非 `-visible`"的误报,如 LoginForm 实际有环)
真正丢焦点指示的:
- `chat/MessageInput.tsx` —— **聊天主输入框**,outline-none 无 focus 环。
- `payment/RechargeDialog.tsx` —— 付费路径。
- `ai-elements/{tool,task,reasoning,sources,chain-of-thought}.tsx` —— AI 消息里的**可展开/可点击披露块**,键盘聚焦时无视觉指示,Tab 用户不知焦点在哪。
- `ui/popover.tsx` —— 内容容器(若焦点在子项可接受,但聚焦容器本身时应有环)。
- **建议**:统一补 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`(只在键盘聚焦显示,鼠标点击不噪)。可在 Button/Input 基类层一次加好。

### P2-22 操作反馈稀疏且不一致 + 无"撤销"兜底(承接第 2 轮 toast 仅 8 次)
- `toast()` 全仓仅 **8 次**调用——成功/失败的轻反馈机制基本闲置。
- 删除反馈**时有时无**:`workflow/WorkflowCard`、`workspace-picker`、`AgentPresetList` 有成功提示;`knowledge/kb-doc-list.tsx` **完全静默删除**(且该处还是英文 `confirm("Remove from knowledge base?")` + 原生弹窗 + 无反馈,三重问题叠加)。
- **3 个文件用 `✅/❌` emoji 当状态反馈**(如 `ScheduleList:349` `✅ 已删除 N 个任务`)——应走 `toast` 的 success/error variant + 图标,而非 emoji 字符串。
- **无"删除后撤销"模式**:`撤销/undo` 仅 7 处且多为编辑器撤销,破坏性删除没有"已删除 · [撤销]"的 toast 兜底,误删不可逆(尤其原生 confirm 点太快)。
- **建议**:① 用 `useToast` 统一所有写/删操作的成功失败反馈(和第 2 轮的收口同一件事);② 破坏性删除优先"乐观删除 + 撤销 toast"替代"二次确认弹窗",既少打断又可逆。

---

## 第 10 轮 — hover-only 操作的键盘可达性 + 日期格式一致性

### P1-23 行内操作"hover 才露出"且无 focus 兜底 → 键盘用户根本够不到
- 19 文件用 `opacity-0 group-hover:opacity-100` 露出行操作(删除/菜单/编辑),其中 **15 个没有 `group-focus-within`/`focus-within:opacity` 兜底**。
- 后果(比"焦点不可见"更严重):Tab 聚焦**不触发 `:hover`**,这些操作对键盘用户**永远不显示 = 完全无法执行**;触屏同理(无 hover)。
- 涉及核心列表:`settings/providers/ProviderRow`、`chat/MessageItem`(消息操作如复制/重试)、`workflow/{WorkflowCard,ScheduleList,AgentPresetList,WorkflowParamManager}`、`workspace-picker`、`browser/BrowserTabBar`(标签关闭?)、`knowledge/TagsManageRow`、`gallery/TagManager`、`favorites/FavoritesPanel`、`ecommerce/DiscoverTab`。
- **建议**:`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`(并确保操作是真正可聚焦的 button)。一次性给行操作模式补 `focus-within`,15 处机械收口。考虑触屏环境的还应提供常驻入口(如行尾"···"菜单)。

### P2-24 日期/时间格式 76 处直接 `toLocale*`,各调各的 + 与 i18n 语言脱节
- `toLocaleDateString/toLocaleString/toLocaleTimeString` 直接调用散在 **76 个文件**;`date-fns/dayjs/Intl.*Format` 仅 5 文件;另有多个自营 `formatTime/formatDate/formatTimestamp`(wechat/douyin/deepsearch/requirements 各一套)。
- 问题:① `toLocaleDateString()` 不传 locale → 跟随**系统**语言,而非应用 i18n 语言(应用切英文、系统中文时日期仍是中文格式,反之亦然);② 各调用点 options 不同 → 同一应用里出现 `2024/4/1`、`2024年4月1日`、带/不带时间等多种格式;③ 相对时间("3 分钟前")各自实现。
- **建议**:抽 `lib/format/datetime.ts`(`formatDate/formatDateTime/formatRelative`),内部按当前 i18n locale 调 `Intl.DateTimeFormat`,76 处和各自营工具统一收口。与第 4/6 轮同属"横切约定缺失"主线。

---

## 第 11 轮 — 禁用态不说明原因 + 动画一致性

### P1-25 227 文件有 `disabled=`,仅 3 个配 Tooltip 解释 → 用户不知为何点不了
- 大量提交/保存/创建按钮 `disabled={!name.trim() || ...}` 禁用,但**不提示缺什么**:`ui/create-folder-dialog:69`、`ui/rename-dialog:83`、`settings/AddProviderDialog:361`(需选预设+填名,但灰按钮不说)、`ProviderEditorDialog:286`、`ProviderEditDialog:431`、`im/ImProviderCard:135`(`!configured` 未配置就禁,不引导去配)。
- 后果:用户看到灰按钮卡住,不知道是"名字没填""没选项""未配置"还是"加载中",只能瞎试。
- **建议**(和第 4 轮 Form 契约同源):优先**不禁用**而是点击后内联报错指出缺项;若保留禁用,给按钮包 Tooltip 说明"还需:填写名称 / 选择预设";`!configured` 类直接换成"去配置"引导按钮而非死禁。
- 注:`creating/updating/sending` 这类异步期间禁用是对的(配 loading 态即可),不在此列。

### P2-26 过渡时长不统一 + 47 处 `transition-all`(性能反模式)
- `duration-*` 分布:200(12)、300(6)、250(2)、150(2)、500(1)、1000(1)——6 种值无 motion token,同类交互快慢不一。
- **`transition-all` 47 文件**:会过渡包括 `width/height/top` 等触发布局的属性,易掉帧;应按需 `transition-colors`/`transition-transform`/`transition-opacity`。
- **建议**:定 2~3 档动画 token(如 fast=150 / base=200 / slow=300)+ 标准缓动;把 `transition-all` 换成具体属性。低优先,属打磨。

---

## 第 12 轮 — 浮层 z-index 层叠管理 + 货币格式

### P2-27 所有浮层原语都用 `z-50`,无层级 scale → 层叠靠 DOM 顺序,已出现魔法数补丁
- 实测 `ui/` 全部浮层同级:`toast / dialog / alert-dialog / popover / dropdown-menu / tooltip / sheet` **一律 z-50**。彼此谁压谁纯看挂载先后。
- 已有证据:`goofish/GoofishLoginBrowserModal.tsx:74` 手搓模态用 `z-[60]` 硬抬以压过 z-50 层——典型"层叠打架后打补丁"。
- z 值分布无规划:z-50(45)、z-10(40)、z-20(11)、z-40(6)、z-[60](1)、z-0(1),无集中常量。
- **关键连锁**:第 2/9 轮建议"用 toast 统一反馈",但 **toast 也是 z-50**——在对话框(z-50)内触发的 toast 会被 modal 盖住、用户看不到成功/失败提示。**所以 z-index 分层是 toast 反馈方案能真正生效的前提。**
- **建议**:定一套层级 token(如 base/dropdown=1000、sticky=1100、overlay/modal=1300、popover=1400、toast=1600、tooltip=1700),toast/tooltip 必须高于 modal;`ui/` 浮层按此设值,禁止再写 `z-[60]` 这类临时数。

### P2-28 货币/金额三种写法混用,符号硬编码不随 locale
- 34 文件硬编码 `¥/￥/$/元`,34 文件用 `Intl.NumberFormat/toFixed`,13 文件用"元"——同一概念三种呈现。
- `payment/RechargeDialog.tsx:205,229` 直接 `¥{value}`:① 符号写死,不随 i18n(英文/USD 场景错);② 无千分位(`¥100000` 不显示为 `¥100,000`)。
- **建议**:抽 `formatCurrency(cents/yuan, locale)` 走 `Intl.NumberFormat(locale,{style:'currency'})`,符号、千分位、小数位一处定;付费页优先(金额展示错觉影响信任)。与第 10 轮 datetime 同属格式化收口。

---

## 第 13 轮 — 图片加载兜底 + 滚动保持(后者是正面)

### 正面记录(两处不用改)
- **聊天加载旧消息不跳位**:`chat/MessageList.tsx:69-88` 有正经的 scroll anchor(记住 `messages[0].id`,prepend 后 `scrollIntoView({block:'start'})` 还原)——"加载更多"体验是对的。
- **图片 CLS 不成问题**:23 个用 `<img>` 的文件里,绝大多数带 `size-*`/容器约束,不会因加载抖动;无需强上 next/image 的尺寸约束。

### P2-29 外链/生成图大量缺 `onError` 兜底 → 坏图裂出浏览器默认碎图标
- 仅 **11/23** 个用 `<img>` 的文件做了 `onError`。缺兜底且图源不可靠的:
  - `goofish/GoofishMessageBubble.tsx:72,83`(`referrerPolicy="no-referrer"` 外链 CDN 图,失败率高,裂在聊天气泡里)
  - `browser/BrowserTabBar.tsx:67`(favicon,外站常 404)
  - `etsy-forge/{LogRowItem,WarehouseView}`(生成图 URL 可能过期)
  - `goofish/{ProductPreviewSection,ProductListingComposeDialog}`、`chat/ImageGenCard`、`gallery/GalleryDetail`(参考图/预览)
- 后果:外链/生成图一旦 404/防盗链,显示浏览器默认碎图标,观感差。
- **建议**:抽一个共享 `<Img onError→占位>`(失败显示占位图标 + alt 文案,可选加载中 skeleton),替换裸 `<img>`。这又能顺带把第 4 轮"加载占位"和坏图兜底一起收口——同属"横切组件缺失"主线。

---

## 第 14 轮 — 对话框聚焦/Enter 提交 + 输入长度约束

### P2-30 对话框不自动聚焦首字段 + 不能 Enter 提交(体验不一致)
- 67 个对话框文件,仅 28 个用 `autoFocus`/`.focus()` → ~60% 打开后焦点不在输入框,用户得先点一下才能打字。
- Enter 提交不一致:小对话框做得好——`ui/create-folder-dialog`、`ui/rename-dialog` 用 `<form onSubmit>` + Enter,**可作为参考范式**;但 `settings/AddProviderDialog`(`form=0`、无 Enter 处理)用 Button onClick 提交,**填完按 Enter 没反应**。`onSubmit` 全仓 33 文件 vs 67 对话框,约一半未走 form。
- **建议**:对话框统一约定——打开 `autoFocus` 第一个输入;输入区包 `<form onSubmit>` 让 Enter 提交、Esc 取消(Radix Dialog 已给 Esc)。拿 create-folder/rename 当模板推平。

### P1-31 166 个含输入的文件里只有 8 个用 `maxLength` → 几乎无长度约束
- 名称/标题/描述等会落库或发 API 的字段普遍无 `maxLength`:用户可粘贴超长文本 → 撞后端限制报错、或静默截断、或撑爆 UI;也无字数计数器提示上限。
- **建议**:① 有后端长度限制的字段(Provider 名、文件夹名、标题、备注)前端加 `maxLength` 与后端一致;② 长文本输入(描述、提示词)加字数计数/软上限提示;③ 在共享 `Input/Textarea` 基类上支持 `maxLength` + 计数,统一收口。
- 注:此条与第 4 轮"无表单校验框架"同根——前端缺少对输入边界的统一约束层。

---

## 第 15 轮 — 截断文本 title 兜底 + placeholder 质量(后者正面)

### 正面记录:placeholder 文案普遍写得好
145 文件用 placeholder,多数带示例/行为说明,质量高,不用改。范例:
- `输入消息，Enter 发送，Shift+Enter 换行`(讲快捷键)
- `输入关键词，如 AI / DeepSeek v4；# 前缀会自动剥掉`(示例 + 行为)
- `输入 X 用户名，例如 openai 或 @openai`(示例)
仅个别偏空泛(`输入金额`、`Enter folder name`),可顺手补示例,但非问题。

### P2-32 84/167 个 `truncate` 没配 `title` → 截断后看不到全文
- 用 `truncate` 的 167 文件里 **84 个全文件无 `title=`**,动态文本被省略号截断后无法 hover 看全文。
- 重灾区是"需要看全才有用"的字段:`settings/BrowserProviderSection` 的 `context_id` / `display_name` / `profile_id`(`:786,799,1017`)、`WorkflowAgentPresetsSection` 的 preset name/expertise(`:43,55`)——ID/名称截断后用户根本认不出是哪条。
- **建议**:凡 `truncate` 包动态内容,统一加 `title={文本}`(或包 Tooltip)。可做一个 `<Truncate title>` 小组件,既保证截断又保证可读全文,机械替换 84 处。
- 与第 7 轮"truncate/min-w-0 成对"是两件事:那条是"能不能正确截断",这条是"截断后看不看得到全文"。

---

## 第 16 轮 — 剪贴板反馈(正面)+ 快捷键可发现性

### 正面记录:复制到剪贴板基本都有反馈
21 个用 `clipboard.writeText` 的文件里 **19 个**有"已复制/Check 图标/setCopied"反馈,做得好。仅 `pinterest-radar/PinterestRadarApp`、`editor/ai-panel` 两处无反馈,顺手补即可。

### P2-33 59 个文件实现了快捷键,但可发现性≈0(用户根本不知道有)
- 监听快捷键的文件 **59 个**(metaKey/ctrlKey/key===),命令面板原语 `ui/command.tsx`(cmdk)也接了(sidebar/model-selector/assistant-modal)。功能在,但**完全不外露**:
  - `<kbd>` 标签用量 **= 0**。
  - `DropdownMenuShortcut`(菜单项右侧显示快捷键)仅 **1 处**。
  - Tooltip/title 带快捷键提示仅 **1 处**(`douyin/LibraryFilters` "按 ⌘K / Ctrl+K 聚焦搜索;Esc 清空")。
  - 无快捷键速查表;Cmd+K 命令面板**无任何 UI 入口提示**(没有 `⌘K` 角标,用户不会知道它存在)。
- 后果:辛苦实现的 power-user 能力(命令面板、各种快捷键)绝大多数用户永远发现不了。
- **建议**:① 搜索/命令入口显示 `⌘K` 角标;② 有快捷键的菜单项用 `DropdownMenuShortcut` 显示按键;③ 有快捷键的图标按钮在 Tooltip 里带按键(和第 8 轮"图标按钮配 Tooltip"一并做);④ 加一个 `?` 唤起的快捷键速查表。低成本、高感知提升。

---

## 第 17 轮 — 按钮层级 + 数字输入(后者正面)

### 正面记录:数字/金额输入做得对
- `payment/RechargeDialog.tsx:233` 金额框 `inputMode="decimal"` + `onChange` 净化 `[^\d.]`——移动端数字键盘 + 防非法字符,做对了。
- `type="number"` 全仓用了 51 次;桌面端为主,`inputMode` 仅 3 处不算问题。此维度无需动。

### P2-34 默认 primary 按钮泛滥,视觉层级塌陷
- 全仓无 variant 的 `<Button>`(=primary 实心高亮)出现 **487 次**,是占比最高的单一样式(ghost 313 / outline 384 / secondary 49 / destructive 60)。
- 单文件主按钮成簇(几乎每个按钮都 primary):`knowledge/library-import-panel`(19/21)、`ecommerce/DiscoverTab`(13/17)、`ecommerce/ListingsTab`(13/15)、`browser/Browser`(10/16)、`wechat-export/WeChatExportPanel`(9/17)、`douyin/OrganizeTab`(8/8)、`ecommerce/StudioTab`(7/11)、`settings/GeneralSection`(6/8)。
- 后果:一屏多个实心高亮按钮互相抢注意力 → 用户分不清哪个是该点的主操作,**"全部强调=没有强调"**。
- 根因同其他轮:`<Button>` 默认就是 primary,开发不显式降级次要操作 → primary 自然蔓延。
- **建议**:每个视图/卡片/对话框**只留 1 个 primary**(THE 主操作),其余降为 `outline`(次要)/`ghost`(三级)/`secondary`;破坏性用 `destructive`。需配合视觉走查确认同屏并存情况(grep 计数含条件渲染,非全部同时出现)。

---

## 第 18 轮 — 超小字号可读性 + 原始错误直抛用户

### P2-35 大量 sub-11px 字号,极小档(≤9px)过小难读
- 分布:`text-[10px]` **602**、`text-[11px]` **507**、`text-[9px]` **80**、`text-[8px]` **10**;200 个文件用到 ≤10px。
- 信息密集的桌面应用用 10/11px 可理解,但 **8~9px(90 处)对多数用户偏小**,叠加 `text-muted-foreground` 低对比时更吃力;且用 `text-[Npx]` 字面值而非字号 token,排版无统一刻度。
- **建议**:设字号 token(如 `text-xs=12 / text-2xs=11`),把 ≤9px 提到 ≥11px 或仅用于极少数非关键角标;`muted-foreground` + ≤10px 的组合重点复核对比度(WCAG AA 正文 4.5:1)。

### P2-36 287 处把原始 `err.message` 直接展示给用户
- 普遍写法 `setError(err instanceof Error ? err.message : '中文兜底')`——**逻辑反了**:正常 `Error` 走 `err.message`(网络/解析/运行时错常是英文技术串,如 `Failed to fetch`、`Unexpected token < in JSON`、HTTP 栈信息),友好中文兜底反而只在罕见的"抛了非 Error 对象"时才触发。
- 出现在 settings 各 section、BrowserProvider(`:222,368,391…` 一连串)等用户操作反馈处。
- 后果:用户看到英文/技术错误,不知所措,也不知道下一步该干嘛。
- **建议**:① 按已知错误类型/HTTP 码映射到友好可操作的中文文案(如"网络不可用,请检查连接""密钥无效,请重新填写");② 原始 `err.message` 收进可展开"详情"(参考第 7 轮 `ErrorBoundary` 的详情折叠——已有现成范式);③ 默认显示友好文案,raw 只作 details。

---

## 第 19 轮 — 图标库混用 + 相对时间陈旧

### P2-37 两套图标库并行(lucide 241 + hugeicons 74),4 处同屏混用
- `lucide-react` **241 文件**、`@hugeicons` **74 文件**;`GeneralSection / McpServerList / McpManager / workspace-picker` **同文件同时 import 两套** → 同一屏里图标 stroke 粗细/风格不统一,细看割裂。
- 代价:① 视觉一致性破坏;② 两套图标 runtime/打包体积叠加(各自 tree-shake 也比单库大)。
- **建议**:定一套为准(lucide 用量占绝对多数 → 收敛到 lucide,把 74 个 hugeicons 用法替换),或反之;无论哪套,**禁止同屏混用**。属技术债式一致性问题,可渐进收口但要定方向。

### P2-38 相对时间 24/30 不自动刷新 → 显示陈旧误导
- 30 个文件显示"X分钟前/小时前/刚刚",仅 **6 个**带 `setInterval/useInterval` 刷新。其余 24 个**渲染一次就定格**:打开会话列表看到"3分钟前",一小时后不重渲染仍是"3分钟前",用户误判消息新鲜度。
- 会话/消息/任务列表这类"新鲜度即信息"的场景影响最大。
- **建议**:抽 `<RelativeTime ts>` 组件,内部按需 `setInterval`(<1h 每分钟、<1d 每时)刷新,并配 `title` 显示绝对时间(顺带补第 15 轮"截断/悬停看全")。与第 10 轮 datetime 收口一起做——同一个格式化/时间组件库。

---

## 第 20 轮 — 断网处理缺失 + 中文标点一致性

### P2-39 全仓无网络在线检测,掉网时无统一提示(只会狂吐技术错)
- `navigator.onLine` / `online`/`offline` 事件用量 = **0**。
- `layout/ConnectionStatus.tsx` 只轮询 `/api/claude-status`(后端 Claude SDK 健康),**不代表网络在线**——掉 wifi 时它未必反映,且它管的是另一回事。
- 后果:笔记本休眠/断网后,每个请求各自失败 → 满屏第 18 轮那种原始 `Failed to fetch`,没有一个统一"网络已断开,正在重连"的横幅或离线态。
- **建议**:加全局 `online/offline` 监听 + 顶部离线横幅;离线时请求层短路并给"网络不可用"友好提示(与第 18 轮错误友好化、第 7 轮兜底同一套反馈体系)。

### P3-40 UI 文案半角/全角标点混用(打磨级)
- 中文文案里夹半角 `,` `;` `()`:`goofish/GoofishChatDetail:189` `'登录已过期,无法发送'`、`knowledge/{ItemTagsEditor,LibraryBatchBar}` placeholder、`TagsManageSheet:142` `完成,但有 N 个失败,可重试`、`pinterest-radar/NewRunDialog` `US(美国,推荐)`;`etsy-forge/SettingsTab:249` **同一句里半角 `,` 与全角 `（）` 并存**。
- 注:半角逗号大头(63+)在代码注释里,不影响 UI,**这条只针对真·UI 字符串**,故定 P3 打磨。
- **建议**:中文 UI 文案统一全角 `，；（）：`;可加一条 copy lint(JSX 文本/placeholder/title 中 CJK 相邻半角标点告警),和第 6 轮 i18n lint 合并。

---

## 第 21 轮 — sticky 表头/操作栏 + 圆角体系(后者基本 OK)

### P2-41 长滚动区缺 sticky:表头/操作栏滚走,丢上下文
- 12 个用 `<table>/<thead>` 的文件**只有 3 个** thead `sticky` → 长表格往下滚,列头消失,用户分不清哪列是哪列。
- 127 个滚动容器(`overflow-y-auto/scroll`)里**只有 9 个**用到 `sticky` → 带标题/筛选/批量操作栏的长面板,滚下去这些控件就滚出视口,够不到。
- **建议**:① 数据表 `<thead>` 一律 `sticky top-0`(配底色防穿透);② 长列表面板的标题 + 筛选/批量操作栏 `sticky` 吸顶,滚动时保持可达。优先 ecommerce/knowledge/工作流这种长数据列表。

### P3-42 圆角基本成体系,仅少量魔法值(打磨级)
- 分布以 Tailwind 刻度为主:`rounded-md`(504)、`rounded-lg`(462)、`rounded-full`(364)、`rounded-xl`(155)、`rounded-2xl`(79)、`rounded-sm`(18)——**这是好的,有统一刻度**。
- 瑕疵:14 个 off-scale 魔法值 `rounded-[22px]`(8)/`[28px]`(3)/`[24px]`/`[4px]`/`[2px]`,以及 `md`(504)与 `lg`(462)并重、未必按组件类型固定(同类组件圆角可能时 md 时 lg)。
- **建议**:把 14 个魔法值归并到最近的刻度;约定"按组件类型固定圆角"(如卡片=lg、输入/按钮=md、badge=full)。低优先。

---

## 第 22 轮 — 多选/批量一致性 + Tab 顺序(后者正面)

### 正面记录:Tab 焦点顺序没被破坏
- `tabIndex` 仅 8 文件用,**零正数 tabIndex**(无 `tabIndex={1+}` 这种打乱自然 Tab 顺序的反模式),9 个 `tabIndex={0}` 都是"让 div 可聚焦"的正确用法。键盘 Tab 顺序跟随 DOM,无人为错乱。

### P2-43 78 处多选各搓各的,无共享 hook,多数缺"全选"和范围选
- Set 多选(`selectedIds`/`new Set`)散在 **78 个文件**;`useSelection/useMultiSelect` 共享 hook = **0**。
- "全选"仅 **6 个**文件有;`shiftKey` 范围选仅 **9 个**有 → 大量多选列表(`ecommerce/ListingsTab`、`goofish/RemindersTab`、`ecommerce/CategoryKeywordTab`、`workflow/WorkflowKnowledgePanel`…)**只能逐个点选**,批量删/打标体验差。
- 各列表批量操作栏(42 文件)样式/位置/文案也各不相同。
- 又是主线:无共享选择原语 → 78 份实现,选择交互(全选/反选/shift 范围/计数/批量栏)能力参差。
- **建议**:抽 `useSelection`(支持全选/反选/`shiftKey` 范围选/选中计数)+ 统一"已选 N · [批量操作] · [取消]"栏,78 处机械收口;有多选的列表默认提供全选 + 范围选。

---

## 第 23 轮 — Switch/Checkbox 标签关联 + 必填标记

### P2-46 Switch 标签关联两极:label 包裹的对,分离 settings 行的没绑(修正初判)
- 先纠正:`<Switch>` 带 `id=` 的虽为 0,但**不代表全错**——`settings/BrowserProviderSection:1261,1270` 把 Switch **包在 `<label>` 内**(`<label><Switch/>启用这个浏览器上下文</label>`),这是**有效关联**(点文字可切、读屏有名,无需 id),写法正确。
- 真问题在**分离式 settings 行**:`settings/GeneralSection:378` 等"描述在左 `<p>`、开关在右 `<Switch>`、分属不同 flex 子节点"的布局,既没 `<label>` 包裹、又无 `id`+`htmlFor`/`aria-labelledby` → 点描述文字不切换(命中区只剩小滑块)、读屏只念"switch"无名。这种 settings 行布局很常见,涉及面不小。
- **建议**:分离式开关行用 `aria-labelledby` 指向描述,或让整行可点切换(`onClick` 落到行容器 + 阻止重复触发);能相邻的优先 `<label>` 包裹(沿用 BrowserProviderSection 的对的写法)。

### P2-47 必填字段标记缺失(16/60 Label 才有 `*`/必填)
- 60 文件用 `<Label>`,仅 16 个有 `*`/「必填」标记;`required` 属性 29 文件。多数表单**不标哪些必填**。
- 叠加第 4 轮(无校验框架)+ 第 11 轮(禁用按钮不说明)→ 用户既不知道哪些必填、提交按钮又灰着不说原因,只能瞎试。
- **建议**:约定 `<Label required>` 渲染 `*`(`text-destructive`)+ `aria-required`;必填缺失时配合内联校验提示,三者(标记/校验/反馈)一起补。

---

## 第 24 轮 — 保存保护一致性 + 数字千分位

> 本轮两次自我修正(grep 大小写敏感 + 关键词偏差导致初判错),最终结论比初判更准——记录修正过程供参考。

### 正面记录:`useAutoSave` hook 设计得好
`hooks/use-auto-save.ts`:2s 防抖自动保存 + `status` 态 + `saveNow` 立即存 + `markChanged` + **每 30s localStorage 崩溃备份(`backupKey`)**。文档编辑器(`editor/document-editor.tsx`)正确接入——编辑不会丢、崩溃可恢复,范式很好。

### P2-48 这个好 hook 全仓只 1 处用,其余编辑器/长表单无保存保护
- `useAutoSave` 仅 `document-editor.tsx` 1 个文件用;`beforeunload` 离开拦截仅 **2 个路由**(`chat/ChatView`、`workflow/[id]/page`);其余自动保存(4 文件)是各自的 debounce,非共享 hook。
- 后果:工作流编辑器、各 settings 长表单、提示词编辑等**编辑后导航/关闭无 autosave、无崩溃备份、无离开拦截** → 丢改风险 + 保存体验各页不一(36 文件各写各的 saving/saved 态)。
- 又是主线:**好约定(useAutoSave)存在但没推广**。
- **建议**:把 `useAutoSave` 推到所有"会编辑较多内容"的编辑器/长表单;对未接入的关键编辑路由补 `beforeunload` 兜底。

### P3-49 数字千分位不一致
- `toLocaleString()` 19 文件用;但 `{count}`/`{totalLines}`/`{progress.total}`/usage token 数等**大量裸渲染**(`card-sections:44`、`RequirementsPanel:190`、`CodeBlock:260` 等)→ 大数字如 token 用量显示 `1234567` 而非 `1,234,567`,难读。
- **建议**:用量/计数走统一 `formatNumber`(`Intl.NumberFormat` 加千分位),并入第 10/12 轮的格式化收口(datetime/currency/number 一个 `lib/format`)。

---

## 第 25 轮 — 无全局通用 toast 系统(反馈主线的根因)+ 文件上传

### P1-50 全仓没有"全局通用 toast"——这是第 2/9/12 轮"反馈稀疏"的真正根因
- `ui/toast.tsx` 只导出 `<Toast>` / `<ToastContainer>` 两个**展示组件**(`fixed top-4 right-4 z-50`,默认 3000ms),**没有 `useToast` hook、没有全局队列、没有 `<Toaster>` 单例**。想弹 toast 得每处自己 `useState` 管列表 + 手动渲染 `<Toast>`(`bridge/BindingButton:496`、`chat/BrowserContextSelector:173` 就是各搞各的)。
- 全局挂载的 toast 只有 **memory 专用** 的 `MemoryToastProvider`(`app/layout.tsx`),通用业务反馈无处可去。
- **这解释了前面所有"反馈"现象**:第 2 轮"toast 仅 8 次/退化成 alert"、第 9 轮"删除静默/✅emoji 当反馈"、第 12 轮"toast 被 modal 盖"——根因是**压根没有一个能随手 `toast('已保存')` 的全局系统**,大家只能 alert 或不反馈。
- **建议(前置项)**:先建全局 `<Toaster>` + `useToast()`(自研单例队列,或直接上 `sonner`),挂在 `app/layout.tsx`,z-index 高于 modal(配合第 12 轮层级 scale)。**这是第 2/9 轮"统一用 toast 反馈"能落地的前提**——没有它,那些建议都悬空。memory 那套可并入或保留为特例。

### P3-51 文件上传以点选为主,拖拽稀疏且反馈不一
- `type="file"` 9 文件,但 `onDrop` 拖拽上传仅 **3 个**、拖拽高亮反馈(`isDragging/isDragActive`)仅 **5 个** → 多数上传只能点选,没有"拖文件到此"的现代交互;有拖拽的几处视觉反馈也不统一。
- 上传进度 18 文件有提及,但无共享上传组件 → 进度/失败重试样式各异。
- **建议**:抽共享 `<FileDropzone>`(点选 + 拖拽高亮 + 进度 + 失败重试),统一上传体验。低优先。

---

## 第 26 轮 — 间距 / 嵌套对话框 / 内联 style(三处均正面,得出一个定位结论)

深查三处,**都没问题**:
1. **间距成体系**:魔法 px 间距仅 **2 处**(`p-[3px]`、`mt-[9px]`),其余全走 Tailwind scale;`py-0.5`/`gap-1.5`/`px-2.5` 是合法细档不是乱来。
2. **对话框无危险嵌套**:抽查 `ImageProviderSection` 等——create/edit `Dialog` 与 delete `AlertDialog` 是**同级、互斥(一次只开一个)**,不是 DOM 嵌套,焦点陷阱不会打架,这是**正确写法**。
3. **内联 style 不逃逸设计系统**:54 文件用 `style={{}}`,但硬编码颜色仅 1 处(`TagsManageRow` 的用户自选标签色 fallback,属合法动态值)、写死 px 尺寸 **0 处**——内联 style 基本只承载计算宽度/进度/transform 等必须动态的值。

### 定位结论(对决策有用)
**Lumos 的底层 CSS/Tailwind 卫生很好**——间距、圆角(第 21 轮)、内联 style、Tab 顺序(第 22 轮)都干净。**UX 债不在"像素/样式"层,而高度集中在"共享约定/原语"层**:toast(第 25)、confirm(第 2)、modal 迁移(第 3)、empty/loading(第 4)、format(第 10/12/24)、selection(第 22)、focus 兜底(第 9/10)。
→ **不要去做大规模 CSS 走查(收益低),把人力投到补这批共享原语 + 机械收口(收益高)。**

---

## 第 27 轮 — 乐观更新 vs 阻塞等待 + 设置可发现性

### 正面记录:设置组织得当
`settings/SettingsLayout.tsx` 有左侧 `w-52` sidebar 导航(`sidebarItems` + hash 路由 `#section`)管 **21 个 section**,可点可锚定。可发现性靠导航够用。仅"无设置搜索"是 P3 nice-to-have(21 section 配搜索更好,但导航已够)。

### P2-52 操作绝大多数悲观更新 → 切换/重命名/删除都转圈等后端
- "改完 `await` 再 refetch 全量"的悲观模式约 **219 文件**;乐观更新/失败回滚(`optimistic/rollback`)仅 **14 文件**。
- 后果:开关切换、重命名、删除、排序这类高频低风险操作,点完要等请求往返 + 重新拉列表才更新,**手感拖沓**(尤其网络慢时);20 个文件还是"整块被 spinner 顶替"的阻塞式加载(应换 skeleton,接第 4 轮)。
- **建议**:高频低风险操作(toggle/rename/reorder/delete)走乐观更新——立即改本地态,失败再回滚 + 报错;破坏性的配"删除 + 撤销 toast"(接第 9 轮)。
- **依赖**:乐观更新的"失败回滚提示"要靠全局 toast(第 25 轮)——又一个建议落地的前提是先补 toast 系统。

---

## 第 28 轮 — muted-foreground 对比度 + 首次引导(后者正面)

### 正面记录:首次使用/未配置引导是有的
`onboarding/welcome/快速开始` 相关 25 文件,"未配置 Provider / 请先配置 / 去设置" 引导 26 文件——首次配置路径有覆盖,不算空白。

### P2-53 muted-foreground 再叠透明度,小字对比度跌破 WCAG AA
- 实测色值:浅底 `--background: oklch(1 0 0)`(纯白)、`--muted-foreground: oklch(0.553...)` —— **满强度就已接近 AA 4.5:1 临界**。
- 但 `text-muted-foreground` 被**大量再叠透明度**:`/40~/70`(`/60`×32、`/50`×19、`/70`×15、`/40`×8…)+ `opacity-30~60`(`opacity-50`×51、`/60`×27、`/40`×22)。`muted-foreground/50` 在白底等效对比 ≈ **~2:1**,远低于 AA。
- 叠加第 18 轮"≤11px 小字"成最差组合,**真实案例**:`chat/MessageItem:378/694/696`(时间戳、token 数、耗时 `text-xs + /50`)、`WorkflowAgentPresetsSection:59`(`text-[10px] + /50`)、`layout/DocPreview:201`。这些是真要看的元信息,不是纯装饰。
- 注:`disabled:opacity-40` 在按钮/控件上是**合规的**(禁用态 WCAG 豁免对比),不在此列。
- **建议**:① 文本不要在 `muted-foreground` 上再叠透明度;② 需要"三级文本"就定一个仍满足 AA 的 token(如 `--text-tertiary`),别用 opacity 压;③ opacity 压暗只用于非文本/装饰。(无法在此渲染算精确比值,建议用对比度工具实测上述样本确认。)

---

## 第 29 轮 — prefers-reduced-motion + 颜色状态(后者正面)

### P2-54 全仓 0 处尊重 `prefers-reduced-motion`,前庭敏感用户无解
- `motion-reduce:` / `prefers-reduced-motion` 用量 = **0**;而持续/循环动画(`animate-pulse/spin/bounce/ping`)**175 文件**、动画/过渡共 **323 文件**。
- 用户在系统里开了"减少动态效果"(前庭功能障碍/晕动症的真实无障碍需求),Lumos **完全无视**——pulse 呼吸、spin 转圈、bounce、第 1 轮那种金色脉冲覆盖层照转。
- **建议(一次性系统级)**:全局 CSS 加
  `@media (prefers-reduced-motion: reduce){*,::before,::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}`
  关键装饰动画再按需用 Tailwind `motion-reduce:` 精修。成本极低、覆盖全。

### 正面记录:状态用色不构成色盲风险
- 抽查所有可疑的纯色状态点(`GeneralSection` 更新点、`LumosCloudSection` 连接点、`ConnectionStatus` 绿/红点)——**一律配有文字标签**(如"已连接 Lumos Cloud 服务"、`common.active`)。色块 badge 也都是"颜色 + 文字"。
- 即不是"仅靠颜色传达状态",红绿色盲用户能从文字区分。这块**做得对,无需动**。

---

## 第 30 轮 — 下拉可搜索性/原生 select 混用 + 右键菜单

### P2-55 原生 `<select>` 与 Radix Select 混用 + 长选项下拉无搜索
- 原生 `<select>` **23 文件** 与 Radix `<Select>` **45 文件** 并存 → 下拉的样式/键盘行为/暗色表现不一致(原生 select 不可定制、无法搜索、菜单样式跟系统走,和应用割裂)。
- 68 个下拉里仅 **14** 个是可搜索 combobox(`Command`/cmdk)。模型选择器(`ai-elements/model-selector`)有搜索✅,但很多**长选项下拉**(服务商、语言、品类、区域如 `pinterest-radar/NewRunDialog` 的 `<option>` 国家列表)只能滚,选项一多很痛。
- **建议**:① 原生 `<select>` 统一替换为 Radix `<Select>`(样式/暗色/键盘一致);② 选项 >~10 的下拉用 Command 加搜索过滤。

### P3-56 右键上下文菜单近乎缺失(桌面应用的预期动作)
- `ContextMenu`/`onContextMenu` 仅 **3 文件**;`src/components/ui/` **无 `context-menu.tsx` 原语**。
- Lumos 是 Electron 桌面应用,用户预期右键消息→复制/删除、右键文件/标签页→动作。现在几乎没有 → 桌面手感缺一块。
- 叠加第 10 轮"行操作只在 hover 露出、键盘够不到":**既无右键、hover 又键盘不可达**,行操作的发现/触达路径都窄。
- **建议**:加 `ui/context-menu`(Radix)原语,给消息、文件、标签页、列表行补右键菜单,镜像现有 hover 操作 —— 同时缓解第 10 轮(多一条触达路径)。低优先但提升桌面专业感。

---

## 第 31 轮 — 徽标(正面)+ 拖拽排序键盘可达性

### 正面记录:Badge 与未读封顶都 OK
- `ui/badge.tsx` 复用 67 文件,共享组件用得好。
- 需要封顶的未读小徽标都做了 `> 99 ? '99+'`(`goofish/chat-list-utils:50`、`wechat-export/WeChatBrowser:293`);未封顶的(`goofish/OverviewTab` `unreadInboxCount`)是 KPI 统计卡,显原始数合理。**这块不用动**。

### P3-57 拖拽排序基本鼠标专属,无键盘替代/手柄稀疏
- 用 dnd/draggable 的文件里多数 `KeyboardSensor=0`:`workflow/visual-editor/{node-palette,parallel-branch-manager,body-manager}`、`layout/RightPanel` 都只鼠标拖;仅 `layout/TabBar` 有点键盘支持。可见拖拽手柄(`GripVertical`)仅 2 处。
- 后果:键盘用户无法重排(工作流节点/分支、面板顺序);无手柄时鼠标用户也不易发现"可拖"。范围窄(主要工作流编辑器),但对依赖键盘的人是硬阻断。
- **建议**:dnd-kit 加 `KeyboardSensor`(它原生支持键盘拖拽)或提供"上移/下移"按钮作键盘替代;加可见 `GripVertical` 手柄提示可拖。

---

## 第 32 轮 — 焦点恢复(指回第 3 轮)+ 横向滚动可发现性

### 焦点恢复:不是新问题
- 手动焦点恢复代码 0 处——**因为不需要**:Radix `Dialog/Popover/Dropdown/Select` 自带"关闭后焦点回到触发元素",用它们的组件都正确。
- 唯一缺焦点恢复的是第 3 轮那 ~17 个**手搓模态**(`fixed inset-0 + onClick=onClose`)。**结论同第 3 轮:迁到 Radix `Dialog` 后,焦点陷阱 + 焦点恢复 + Esc + 滚动锁一并解决**。本轮无新增独立问题。

### P3-58 横向滚动区缺"可滚"视觉提示(macOS overlay 滚动条尤其)
- 27 个 `overflow-x-auto/scroll` 区,仅 **1 个**(`ai-elements/tool.tsx`)有渐隐/阴影边缘。
- 好的一面:`scrollbar-hide` = **0**,没刻意藏滚动条。但 macOS 默认 overlay 滚动条静止时不显示 → 横滚内容(标签栏、chips 行、宽表格)看起来"到头了",用户不知右侧还有。
- **建议**:给关键横滚区加右/左 fade 遮罩(`mask-image` 或叠层渐隐),有溢出时显示——低成本提升"可滚"可发现性。属打磨。

---

## 第 33 轮 — 三态完整性 + 长任务取消

### P2-59 25 个数据组件有 loading 无 error 分支 → 失败卡转圈/空白
- 三态齐全(loading+error+empty)的有 100 文件,但 **25 个有 loading 却无 catch/error 分支**。请求失败时:要么永远转圈、要么空白,**无错误提示、无重试**。
- 确认是真实数据列表:`goofish/ProductListingsSection`、`ecommerce/LibraryTab`、`etsy-erank/ScoredNichesTable`、`workspace/content-list`、`wechat/AutomationListPane`、`douyin/LibraryToolbar` 等。
- 又是主线:**无共享"异步列表态"组件**,各 list 手搓 loading,25 个漏了 error。
- **建议**:抽 `<AsyncBoundary loading/empty/error/onRetry>`(或列表态 hook),统一 loading→骨架、empty→空态(接第 4 轮共享 EmptyState)、error→提示+重试。一处定,25 个收口。

### P2-60 长任务取消不贯穿:确认前能取消,生成中停不了
- 可取消 43 文件 vs 长任务 138 文件。聊天出图在**确认弹框**可取消(`ImageGenConfirmation` cancel=9、`MessageInput`=14、`ChatView`=12 ✅),但**一旦开始生成**(`ImageGenCard`=0、`StreamingMessage`=0、`gallery/GalleryDetail`=0)就停不了。
- 后果:**耗配额的出图/批量一旦启动无法中断**——用户发现选错也只能等它烧完额度;AI 流式"停止生成"只有 ChatView 有。
- **建议**:长任务全生命周期可取消(AbortController + 始终可见的"取消/停止"),尤其扣配额的出图/批量;取消后回滚 UI 态(配合乐观更新/第 27 轮)。

---

## 第 34 轮 — 智能日期/图标写法(非问题)+ 删除危险色一致性

### 两处非问题(澄清,免得误投精力)
- **智能日期广泛在做**:62 文件有"今天/昨天/同年省年",仅 11 处用全量 `toLocaleDateString`——humanize 覆盖好。**唯一引申**:62 处各搓各的,仍应收口到第 10 轮的 `lib/format/datetime`。
- **`size-4` vs `h-4 w-4` 不是 UX 问题**:二者**视觉完全等价**(`size-*` 是 Tailwind 新简写),纯代码风格,0 用户可见影响。仅 4 文件混用,清不清随意,不进 UX 清单。

### P3-61 删除/破坏操作的危险色不一致
- 90 个含"删除/移除/清空"的动作,仅 **49** 用 `destructive`/红色;约 **41** 用中性 `ghost/outline`。
- 反讽样本:`etsy-forge/DangerZoneSection:21` 的"清空图库?…不可恢复" 用 `variant="outline"`(中性)——**DangerZone 里的不可逆操作却没危险色**。
- 后果:破坏性、不可逆操作长得像普通按钮,用户少了"这步危险"的视觉警示(尤其配合第 2/9 轮"删除常走原生 confirm/无撤销")。
- **建议**:所有破坏性/不可逆动作统一 `variant="destructive"`(图标删除按钮用 `text-destructive`),中性变体只留给非破坏操作。接第 17 轮"按变体表达层级"。

---

## 第 35 轮 — 关闭 X/Esc 一致性 + 翻页方式

### P2-63 手搓模态关闭方式参差,`ImageLightbox` 是键盘陷阱(坐实第 3 轮的具体后果)
- 抽查手搓模态:`CutoutModal`(Esc✓ + 关闭X✓)、`MaterialPicker`/`ProductPickerModal`(有X、无Esc)、**`ImageLightbox`(无 Esc、无可见关闭按钮)**——只能点背景关。
- `ImageLightbox` 最严重:`<div>` 背景不可聚焦,**键盘用户既按不了 Esc、也 Tab 不到关闭** → 进去出不来,**键盘陷阱**。
- 同是模态,关闭方式三套(Esc+X / 仅X / 仅背景),体验不一致。
- **建议**:本质还是第 3 轮——迁到 Radix `Dialog`:`Esc` 关闭 + `<DialogClose>` 标准右上角 X + 焦点陷阱/恢复,一次性消除所有不一致和键盘陷阱。`ImageLightbox` 优先(当前完全无键盘出口)。

### P3-62 翻页模型混用(轻)
- "加载更多"按钮 3 文件、无限滚动 3 文件、分页器 3 文件——同一应用三种翻页范式并存,跨列表切换时心智不一。
- 量小(共 9 文件),不同列表类型也可能合理地用不同模型,**P3 低优先**;若统一,建议长动态流用"加载更多/无限滚动"、有限可定位数据用分页,各场景内保持一致即可。

---

## 第 36 轮 — 文本选择/Tooltip(正面)+ 窗口标题 + 路径截断

### 两处正面
- **`select-none` 用得对**:15 处都用在不该复制的地方——diff 的 `+/-` 槽位、代码块 `$ ` 提示符、状态 badge(复制代码/diff 时不带噪声,学 GitHub/终端)。AI 正文未被 select-none,可正常选中复制。
- **Tooltip 统一**:`app-layout` 挂了单一全局 `TooltipProvider` → 延迟一致;`side` 按需指定(10 right/4 left/2 bottom),其余 Radix 自动翻转。无需动。

### P3-64 窗口标题不随视图更新(桌面应用)
- `document.title` 仅 3 文件涉及,且 `ChatView` 是读取而非设置 → 窗口标题基本恒为 "Lumos"。
- 后果:OS 窗口切换器/任务栏/多窗口下都叫 "Lumos",分不清当前在看哪个文档/会话/模块。
- **建议**:按视图/文档/会话设 `document.title`(如 `文档名 — Lumos`),桌面端窗口辨识度立增。低优先。

### P3-65 长路径/ID 截断方式不一(结尾截断会切掉文件名)
- 已有中间截断的好实现:`truncatePath()`(`ai-elements/tool-actions-group:172`)+ 8 处中截逻辑。
- 但也有对路径用**结尾 `truncate`** 的:`workflow/OutputFilePreviewModal:97` `truncate max-w-[300px]` on `file.filePath`(结尾截断把最重要的文件名切没了;好在有 `title` 可悬停看全)。
- **建议**:路径/ID 统一走 `truncatePath`(中间截断,保留头部盘符 + 尾部文件名),配 `title` 看全文。低优先。

---

## 第 37 轮 — 对话框高度约束(基座缺陷,一处修复)+ 数字越界

### P2-66 基座 `DialogContent` 无 `max-h`/overflow → 高内容把头/底按钮顶出屏外
- `ui/dialog.tsx` 的 `DialogContent` className **无 `max-h`、无 `overflow`**,且垂直居中(`fixed top-[50%] translate-y-[-50%]`)。内容一旦高于视口,**上下同时溢出**——`DialogTitle` 和 footer 的"保存/取消"按钮都被顶到屏幕外,**且无法滚动够到**。
- 67 个用 `DialogContent` 的里仅 **31** 个自己加了 `max-h-* + overflow-y-auto`;其余 ~36 个靠"内容短"侥幸(小确认框无所谓,但表单类如长 Provider 配置就危险)。`AddProviderDialog` 靠内部 `<ScrollArea h-[320px]>` 兜了一部分,属个案打补丁。
- **建议(一处修全部)**:给**基座** `DialogContent` 加 `max-h-[85vh]` + body 区 `overflow-y-auto`(或 `grid-rows-[auto_1fr_auto]` 让中间内容滚、头尾固定)。改基座一处,所有对话框的"顶出屏/按钮够不到"一次性消除。这是少见的"原语自身缺约束",优先级高于逐个 dialog 补。

### P3-67 数字输入靠 min/max 属性,拦不住输入/粘贴越界
- `type="number"` 27 文件,24 个有 `min/max` 属性——但 HTML 的 `min/max` **不阻止键入/粘贴越界值**(只影响 spinner 与提交校验)。是否真拦取决于 onChange 里有没有钳制。
- 107 文件用 `Math.min/max/clamp`,但未必落在这些数字输入的 onChange 上;部分输入可临时存入越界值(多数靠提交校验/禁用按钮兜,如第 12 轮 RechargeDialog 的 `amountValid`)。
- **建议**:关键数值(配额、张数、金额)在 onChange 钳制到 [min,max] 或即时内联提示越界,别只靠属性 + 提交校验。低优先。

---

## 第 38 轮 — 底部按钮顺序(基本 OK)+ 点外部关闭丢输入

### 正面记录:底部按钮顺序基本一致
49 个 `DialogFooter`,抽查为"取消在左、确认/保存在右"的常规顺序(`DialogFooter` 也鼓励此布局)。低关注,不进清单。

### P2-68 表单/编辑类弹框点外部即关,无脏态拦截 → 误触丢输入
- Radix 对话框 **0 个** 用 `onInteractOutside`/`onPointerDownOutside` 阻止外部点击关闭 → 全部沿用 Radix 默认"点外面就关"。
- 手搓模态 **33 个** 点背景 `onClick={onClose}` 即关;其中**带输入的表单弹框**确认有:`settings/WorkflowAgentPresetDialog`、`workflow/ScheduleEditor`、`workflow/visual-editor/properties-panel`、`ecommerce/{ProductDetailDialog,BriefEditDialog,ListingsTab,DiscoverTab}`、`ai-assistant/assistant-modal`。
- 后果:编辑表单时手滑点到弹框外/背景 → **整窗输入瞬间丢失,无"放弃未保存修改?"确认**。与第 24 轮(无 beforeunload/脏态)同属丢改风险。
- **建议**:表单/编辑类弹框**禁用外部点击关闭**(Radix:`onInteractOutside={e=>e.preventDefault()}` 或仅在未脏时允许;手搓:去掉背景 onClose 或脏态时弹确认);只读/展示类弹框可保留点外关闭。配合脏态检测,脏了才拦。

---

## 第 39 轮 — 表单 autoComplete / 长文本折断 / 外链安全(三处均正面)

深查三处,**都没问题**:
1. **登录/注册 autoComplete 标了**:`LoginForm`/`RegisterForm`/`LumosCloudSection` 有 `autoComplete`,密码管理器/浏览器自动填充可用。仅 API-key 类副密码字段没标,但那些反而常该 `autoComplete="off"`,不算缺陷。
2. **长文本折断覆盖好**:`break-words/break-all` 62 文件;URL 列表多用 `line-clamp-2`,不会撑破。
3. **外链 `rel` 安全到位**:`target="_blank"` 39 文件,`rel="noopener/noreferrer"` 基本都有——抽查"看似缺失"的(`sources.tsx`/`ImProviderCard`/`JobsTab`)其实 `rel="noreferrer"` 都在**邻行**(多行 JSX,我同行 grep 的误报)。

### 趋势说明(对决策有用)
第 36/39 等近几轮**越来越多是正面确认**。结合第 26 轮的定位结论:**实质 UX 债已基本被前面的 ~30 条(P0~P2,集中在"共享约定/原语"层)覆盖**;表单卫生、链接安全、长文本、间距等**底层做得扎实**。后续轮次会更多是 P3/正面——继续按指示扫,但高价值项请以清单前部为准。

---

## 第 40 轮 — 搜索框防抖/清除 + 骨架(同第 4 轮)

### P2-70 搜索框 30 个仅 4 个防抖,服务端搜索每键一查
- 搜索输入 30 文件,带防抖(`debounce/useDebounce/useDeferredValue`)仅 **4**。
- 确认**服务端/DB 搜索且无防抖**:`deepsearch/DeepSearchDocsTab`、`knowledge/kb-doc-list` → 每敲一个字符就发查询,浪费请求 + 结果闪烁/卡顿;本地大列表过滤同样每键重算。
- 清除(X)按钮 20/30 有,尚可;**无共享 `SearchInput` 组件**(各处手搓 → 防抖/清除/快捷键不一)。
- **建议**:抽共享 `<SearchInput>`(内置 ~250ms 防抖、清除 X、`/` 或 ⌘K 聚焦、Esc 清空——顺带补第 16 轮快捷键可发现性),30 处收口。又一"缺共享约定"实例。

### 骨架屏:同第 4 轮,不重复
- `Skeleton` 仅 4 文件用(第 4 轮已记 skeleton 闲置)。"形状是否贴合内容"在 skeleton 几乎没用的前提下是伪命题——先解决第 4 轮"加载态约定:列表首屏用 skeleton",再谈贴合。
