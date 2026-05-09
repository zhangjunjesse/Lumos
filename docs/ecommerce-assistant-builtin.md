# 电商商品助手内置应用

> 一键基于 SOP 流程生成电商商品图、识别商品资料、批量出图、风格预设和场景方向调整的内置应用。
> 入口：`/apps/ecommerce-assistant`，应用 ID `ecommerce-assistant`。
> 版本 0.1.0；和闲鱼助手、微信助手并列在「应用」首页内置区。

## 1. 设计目标

1. 解决电商商家做商品图、商品资料的核心痛点：上传 1 张主图加最多 4 张参考图，应用按 [SOP](./ecommerce-gemini-image-sop.md) 自动跑完 12 步流程，输出商品 brief 和 1 张可用的终版商品图（或白底兜底）。
2. 体验对齐微信助手 / 闲鱼助手：应用内 Tab 化（工坊 / 任务 / 资料库 / 预设）、状态可见、失败原因可见、写操作要确认、未接入能力显式 `not_connected`，不假装完成。
3. 高成功率：场景生成最多 3 轮、终版精修最多 2 轮、抠图最多重试 2 次；任意一层失败按 SOP 回路规则回退；全部失败时降级到白底抠图终版。
4. 易调整：内置 catalog / lifestyle / campaign 三个方向预设，用户可自定义新预设；提示词、画面比例、并发上限走应用 `app_settings`。

## 2. 应用结构

```
src/
├── app/api/apps/builtin/ecommerce/
│   ├── status/route.ts              # 应用状态、provider 检查、最近任务
│   ├── inputs/route.ts              # GET 列表 / POST 上传图
│   ├── inputs/[id]/route.ts         # GET / PATCH / DELETE 单条输入
│   ├── jobs/route.ts                # GET 列表 / POST 启动任务
│   ├── jobs/[id]/route.ts           # GET 任务详情 + 阶段产物
│   ├── jobs/[id]/cancel/route.ts    # 取消任务
│   ├── jobs/[id]/retry/route.ts     # 复用同输入新建任务
│   ├── presets/route.ts             # GET / POST 风格预设
│   ├── presets/[id]/route.ts        # PATCH / DELETE 单条预设
│   └── events/route.ts              # SSE 进度事件流
├── app/apps/ecommerce-assistant/page.tsx       # 入口页面
├── components/apps/builtin/ecommerce/
│   ├── EcommerceAssistantApp.tsx    # 主入口（4 个 Tab）
│   ├── EcommerceHero.tsx            # 顶部状态栏
│   ├── SetupSection.tsx             # 未就绪时的 setup checklist
│   ├── StudioTab.tsx                # 工坊（上传 + 列表 + 启动任务）
│   ├── JobsTab.tsx                  # 任务（状态、阶段、产物、取消、重跑）
│   ├── LibraryTab.tsx               # 资料库（终版图 / 兜底图相册）
│   ├── PresetsTab.tsx               # 风格预设管理
│   ├── use-ecommerce-app-data.ts    # 数据 hook（status + inputs + jobs + presets）
│   └── types.ts                     # 前端类型
├── lib/ecommerce-assistant/
│   ├── constants.ts                 # 应用 ID / 版本 / SOP 重试上限
│   ├── types.ts                     # 后端类型（含 ProductBrief / ScoreReport / FinalQc）
│   ├── prompts.ts                   # 全部 SOP 提示词模板
│   ├── llm-client.ts                # 包装 generateObjectFromProvider，提供 brief / 评分 / QC 调用
│   ├── upload.ts                    # 图片上传持久化（~/.lumos/.lumos-uploads/ecommerce-assistant/）
│   ├── storage.ts                   # AppDataStore 包装（input / job / output / brief / preset）
│   ├── sop-engine.ts                # 12 步 SOP 编排器
│   └── job-runner.ts                # in-memory 任务注册中心 + abort + retry
└── lib/app/builder/template-ecommerce-assistant.ts   # 应用包蓝图（app.json/spec/pages）
```

`src/lib/init-builtin-resources.ts` 在应用启动时调用 `ensureEcommerceAssistantInstalled()`，负责把蓝图安装到 `lumos_app_apps` 并播种内置预设。蓝图通过 `validateNativeAppDirectory` 和 AppBuilder 的 `validate_app` 双重门禁。

## 3. SOP 流程

代码：`src/lib/ecommerce-assistant/sop-engine.ts`。

```
queued
  ↓ preprocessing      校验 input + reference paths
  ↓ identifying         vision-aware Claude 识别商品 brief（写入 product_briefs）
  ↓ cutting             Gemini-style 抠图（最多 2 次） + Claude QC（structure/material/edge/completeness/bg）
  ↓ planning            基于 brief 生成 catalog / lifestyle / campaign 三方向 JSON
  ↓ generating          顺序生成 3 张第一轮场景图（写入 image_outputs）
  ↓ scoring             Claude 多图评分（productFidelity 等 7 维），选 winner 或重跑
  ↓ refining            基于 winner 终版精修（最多 2 次）
  ↓ qc                  Claude 严格质检（11 维），fail → final_refine 回路 / scene_generation 回路
  ↓ completed | failed | cancelled
fallback：场景重跑 3 次仍未通过 → 用抠图主图生成白底终版
```

回路控制集中在 `SOP_LIMITS`：抠图 2、场景 3、精修 2。任意阶段失败把 `image_jobs.failure_stage / failure_reason` 写入数据库，UI 一律可见。`StageReporter` 同步把进度推送给 SSE 订阅者。

## 4. 数据模型

| 集合 | 用途 |
|------|------|
| `product_inputs` | 商品输入：标题、类目、主图路径、参考图路径（JSON）、备注、状态 |
| `product_briefs` | AI 识别的商品 brief：productType、卖点、推荐机位 / 比例 / 灯光等 |
| `image_jobs` | 任务实体：状态、阶段、进度、抠图路径、终版路径、winner、失败原因、3 段重试次数 |
| `image_outputs` | 阶段产物：cutout / catalog / lifestyle / campaign / final / fallback；含 QC 状态、is_winner |
| `style_presets` | 风格预设：catalog/lifestyle/campaign 三个内置 + 用户自定义 |
| `app_settings` 等通用集合 | 通用应用壳（设置、自动化、运行结果、IM、验收清单等） |

蓝图 `data-schema.json` 由 `template-ecommerce-assistant.ts.buildEcommerceCollections()` 输出；通用集合从 `withNativeShellCollections` 注入。

## 5. 风险与边界

- 写操作必须确认：启动任务、批量启动、重跑都通过 UI 弹窗确认。
- 高风险动作（在 `risk.highRiskActions`）：启动任务消耗图像配额、批量启动、重跑、删除输入或任务。
- 不在范围内（在 `risk.outOfScope`）：自动发布到淘宝/拼多多/京东/亚马逊；自动改价、上下架、修改库存；把生成图片回写到第三方电商后台；绕过用户确认批量调用图像 API；mock 数据冒充已生成结果。
- Provider 缺失：`/api/apps/builtin/ecommerce/status` 单独检查 `agent-chat`（分析）和 `image-gen`（图像）能力；任意一项缺失，UI 顶部 SetupSection 直接显式 `needs-analysis-provider` / `needs-image-provider` 并给出指向 `/settings` 的入口。
- 失败可见：任务进入 `failed` 时 `failure_stage` 落到 cutting / scene-generation / refining / qc / fallback / preprocessing，同时 `failure_reason` 文案准确，UI JobsTab 直接展示。

## 6. 验收清单

应用包 `native-app-spec.json.acceptance` 列出 14 项（详见安装后的「状态」页和「运行结果」页）。手工验收路径：

1. 打开「应用」页 → 看到「电商商品助手」内置卡片，状态点亮。
2. 在「设置 → 服务商」配置一个支持 `text-gen` 的 provider（Anthropic / OpenAI / 国产兼容）作为分析 provider，再配置一个支持 `image-gen` 的 provider（Gemini / 国产兼容 / DashScope）。
3. 进入应用，工坊页点击「新建商品输入」→ 上传商品主图（必填）和最多 4 张参考图 → 保存。
4. 在工坊页或商品输入卡片点击「基于此输入出图」→ 任务页出现 running 任务，阶段 / 进度可见。
5. 任务完成后切到「资料库」→ 看到终版图（带「终版」标记）；任务页查看所有阶段产物。
6. 在「预设」管理 catalog/lifestyle/campaign 三个内置预设并新增自定义预设。
7. 关掉某个 provider，再次启动任务 → 任务进入 `failed`，failure_reason 直观可读。
8. 任务运行中点击「取消」→ 状态变为 cancelled；点击 `failed` 任务的「重新运行」→ 创建新任务复用相同输入。

## 7. 用户能直接做什么

- 单 SKU 出图：上传 → 一键生成 → 选 winner → 下载（点缩略图打开预览，浏览器右键保存）。
- 批量素材：批量上传商品输入并逐条启动任务；自动化页含批量出图、失败复跑模板（默认禁用，开启前需配置图像 provider 配额）。
- 风格固化：把品牌常用的拍摄风格记录到「自定义预设」，下次出图直接复用。
- 商品资料归档：每条任务都会生成 `product_briefs`，含 brief、推荐机位 / 比例 / 灯光，可作为 SKU 物料输入用。

## 8. 后续路线

> 不在 0.1.0 范围内，但下一步应该补：

- 进度 SSE 接入 UI：当前轮询 5s 刷新，后续接入 `/api/apps/builtin/ecommerce/events?job_id=` 的 SSE。
- 任务详情页：显示三方向缩略图、评分卡、QC 结果对比；批量勾选下载。
- 多终版：终版图同时输出多种比例（4:5 / 1:1 / 3:4 / 16:9）。
- 预设引导：用 winner 历史辅助生成新预设（few-shot）。
- IM 出图命令：`/ecommerce status` / `/ecommerce jobs` 走 IM 命令实跑（已声明在 `app_command_runs`，目前页面只展示模板）。
- 真正接入第三方电商：和淘宝 / 拼多多 / 京东 / 亚马逊的开放接口对接，从「记录商品」升级到「上架商品」。

## 9. 严格汇报口径（参照 `docs/native-app-acceptance-checklist.md`）

- 文档完整度：`完整完成` — 蓝图、SOP 引擎、API、UI、安装、初始化、单元测试齐备。
- 主链状态：`已打通` — 用户能从应用列表 → 应用入口 → 工坊上传 → 启动任务 → 看到任务进度 → 看到终版 / 兜底图 → 取消 / 重跑 → 资料库 → 预设管理。
- 验收清单：14 项中除「installation-self-check」由初始化时安装自检自动写入外，其余均需用户人工验收（见上节）。
- **未接入项**：进度 SSE 已写后端但前端尚走轮询；自动化页中的「批量出图」/「失败复跑」运行桥未接入（仅通过 UI 入口可手动触发）；IM 命令在 `app_command_runs` 中是 `draft` 状态，命令实际执行链路未在 0.1.0 接入（需要 IM 桥进一步打通）。这些项必须保留 `not_connected` 视觉态，不允许 mock 冒充。
