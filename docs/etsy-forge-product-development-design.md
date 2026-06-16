# Etsy 选品采集 ·「产品开发」tab 设计

> 状态:设计已确认(2026-06-15)。三处关键决策由用户拍板:独立新 tab / 全量 Etsy 属性 / 带 AI 文案草稿(草稿优先)。
> 本文是该 tab 的实现契约 + 字段真源。代码里的字段目录从本文落地,改字段先改这里。

---

## 1. 背景与缺口

现有 etsy-forge 链路是「**选品 → 出图**」:关键词爬同行 → 勾选爬详情图 → 抠印花 → 生成素材 → 二创原创印花 → 合成带印花产品图。

链路终点是一堆**产品图**。现有「我的产品」tab(`ProductTab.tsx`)是个 MidJourney 式**出图板**——只管刷图、打分、挑变体,**不含任何 Etsy 上架字段**(标题/描述/标签/材料/价格/变体/类目…)。

缺口:把「一组出好的图 + 一个产品概念」装配成「**一条信息齐全、能直接粘到 Etsy 手动上架的 listing**」。这就是「产品开发」tab。

## 2. 设计目标与红线

目标:让用户在一个地方,把在研产品的 **Etsy 全量可上架属性**维护齐全,导出/复制方便,最终自己手动上架。

红线(必须在代码与 UI 同时体现):

- **R1 不用同行图**:listing 图只能来自用户自有生成图(mockups / 自有 assets)。采集来的同行详情图(`etsy_forge_images`)在选图器里**置灰禁选**,旁注「同行图仅供选品参考,不可作自己 listing(DMCA)」。
- **R2 草稿优先**:AI 生成的任何字段都是草稿,写进 `*_draft` 暂存,用户「采用」才落到正式字段。绝不自动提交、绝不照搬同行原文。
- **R3 不自动上架**:本 tab 不调用任何 Etsy 写接口、不自动发布。终点是「导出/复制 + 标记已上架(记链接)」,上架动作由用户手动完成。
- **R4 完整度如实**:完整度/「待上架」门禁按真实必填项计算,缺什么显示什么,不伪造通过。

## 3. 信息架构

新增独立 tab「**产品开发**」,排在「我的产品」之后。自带一套「在研产品」记录(`etsy_forge_listings`),与出图板解耦。

### 3.1 列表页(table)

顶部:`＋ 新建空白产品` / `从出图导入`(选一个「我的产品」出图组 → 预填图与来源)。筛选:按状态。

| 列 | 说明 |
|---|---|
| 主图 | listing 主图缩略(未设则取首图) |
| 产品名 / 标题 | title 为空时显示内部名 |
| 状态 | 草稿 / 开发中 / 待上架 / 已上架 / 归档 |
| 完整度 | 必填项进度条(见 §7) |
| 图 | 已配图位数 / 10 |
| 变体 | 变体组合数 |
| 价格 | 基础价 |
| 更新时间 | updated_at |
| 操作 | 进入详情 / 删除 |

### 3.2 详情页(子 tab)

进入某产品后,顶栏:返回 / 产品名(可改)/ 状态切换 / 完整度。下面 7 个子 tab:

1. **概览** — 主图、状态、完整度清单(缺哪些必填一眼可见)、来源、备注。
2. **文案** — title / description / tags / materials + `AI 生成草稿`。
3. **图片** — 10 图位按角色 + 1 视频位;从出图组/图库挑图入位、排序、设主图。
4. **价格与变体** — 基础价/库存/SKU + 变体矩阵(尺码×颜色)+ 个性化。
5. **类目与属性** — 类目/分区/Who-What-When/类型/生产方/类目属性。
6. **物流** — 加工时间/原产国/重量尺寸/退换政策。
7. **导出** — 完整度门禁、逐字段复制、导出 JSON·CSV、标记已上架(填链接)。

## 4. 状态机

```
draft(草稿) ──编辑──▶ developing(开发中) ──必填齐+用户确认──▶ ready(待上架)
   ▲                                                              │
   └──────────────────── 退回编辑 ◀───────────────────────────────┘
ready ──标记已上架(填 Etsy 链接)──▶ listed(已上架)
任意 ──▶ archived(归档)   archived ──▶ developing(恢复)
```

- `draft`→`developing`:用户开始填即转(或手动)。
- →`ready`:必须通过完整度门禁(§7)且用户显式点「标记待上架」。门禁不过则按钮禁用并列出缺项(R4)。
- →`listed`:用户手动在 Etsy 上架后,回来填 listing URL/ID,标记已上架。

## 5. 数据模型

新增 1 张表 `etsy_forge_listings`。嵌套结构(图/变体/属性/物流)用 JSON 字段,均为 listing 私有、不独立查询。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| user_id | string | 隔离(恒 'local') |
| internal_name | string | 内部名(列表/未填标题时显示) |
| status | enum | draft/developing/ready/listed/archived |
| source_kind | enum | blank / from_group(从出图组导入)/ from_collected(从采集商品) |
| source_product_id | string | 来源出图组/采集商品 id(复用关键词、评论情报) |
| title | string | 标题 ≤140 |
| description | text | 描述 |
| tags | json[] | 标签 ≤13,每个 ≤20 字符 |
| materials | json[] | 材料 ≤13 |
| photos | json | 图位数组(见 §6.2) |
| video_src | string | 视频(本地 path/url) |
| price | number | 基础价 |
| currency | string | 币种(默认 USD) |
| quantity | number | 库存 |
| sku | string | 主 SKU |
| variations | json | 变体定义 + 组合(见 §6.3) |
| personalization | json | {enabled, instructions, charLimit, optional} |
| taxonomy_path | json[] | 类目路径(["Clothing","Unisex Adult Clothing","Tops & Tees"]) |
| section | string | 店铺分区名 |
| listing_details | json | {whoMade, whatIs, whenMade}(Etsy 必填三问) |
| listing_type | enum | physical / digital |
| renewal | enum | automatic / manual |
| production_partner | string | 生产合作方(POD 供应商) |
| attributes | json | 类目属性键值(见 §6.4) |
| shipping | json | {processingTime, countryOfOrigin, weight, dimensions, returnsAccepted, returnWindowDays, profileName} |
| copy_draft | json | AI 文案草稿暂存 {title, description, tags, materials, generatedAt}(R2) |
| etsy_listing_url | string | 已上架后回填 |
| etsy_listing_id | string | 已上架后回填 |
| note | text | 备注 |
| created_at | datetime | |
| updated_at | datetime | auto now |

索引:user_id / status / source_product_id / updated_at。

## 6. Etsy 全量属性目录

### 6.1 文案(子 tab 2)
- **title**:≤140 字符,字数实时计数,超限红字。
- **description**:多行;模板提示(材质/尺码/工艺/养护/发货)。
- **tags**:≤13,单个 ≤20 字符,chip 输入,重复/超长拦截。
- **materials**:≤13,chip 输入。

### 6.2 图片(子 tab 3)—— 选素材批量出商品图 + 逐张精修(本轮重点)

用户进来通常只有「一个印花 + 一张基础产品图」,但上架要 6-8 张图。交互**不是逐格手填**,而是 **选图库素材 → AI 批量合成商品图 → 逐张精修**(结果图库模型,已拆掉固定角色格子)。

**生成方法对齐权威 SOP**:`/Users/zhangjun/私藏/etsy/prompt_research/playbook/etsy_product_mockup_sop.md`(见 memory `reference-etsy-mockup-sop`)。四铁律:① 印花=唯一真图参考;② 模特/场景/姿势绝不喂像素,只"读图→文字方向"让 AI 生成全新人/景(合规);③ 印花随褶皱变形+受光(防贴纸感);④ 多色每张换人换景不克隆。

- **印花作一等字段** `design_src`:顶部显示,可设/换。**SOP 铁律1:它是唯一进 `reference_image_paths` 的真图(Image 1)。**
- **选素材批量出图**(`MaterialStudio`,分 4 个 tab):
  - **基础 tab**:颜色集(Comfort Colors 多选,模特图轮换)/ 输出类型(模特上身/场景氛围/设计特写/平铺主图)/ 模特上身张数(独立,默认 4,SOP §2 要 3-4,每张轮换 颜色×人×姿势×场景 `pick` 取模不克隆)。
  - **风格 tab**:`PHOTO_STYLES` 单选(手机随拍默认 / 专业棚拍 / 复古胶片 / 户外 / 居家 / 极简 Ins / 暗调 / 街头,可扩),fragment 注入模特/场景图 prompt;平铺主图、设计特写保持干净不受风格影响。
  - **方向参考 tab(可选)**:再分 5 个子 tab(一次一个 picker,不滚一大坨):
    - 模特 / 场景 / 姿势 = 图库 AI 素材 → `modelRefs/sceneRefs/poseRefs`,vision 按各自维度读(`MODEL/SCENE/POSE_Q`)。
    - 已采集商品 / 我关注的商品 = 真实商品图(`listProducts` 主图 / `listLibrary` 详情图,按 url 去重)→ `productRefs`,vision **整体读氛围方向**(`PRODUCT_Q`:人+景+姿势+光);选了就**优先**按它出(`resolveBatchGen` 里 `productDescs` 在则 modelPoseScene 直接取它)。
    - **绝不喂像素**(铁律2,采集同行图也只读方向)。留空用内置多样化默认池(`MODEL/POSE/SCENE_ROSTER`)。
  - **额外要求 tab**:自由文本输入,`resolveBatchGen` 用 `withExtra` 把它追加进 模特/场景/特写/平铺 每张 prompt(结构化选项之外的补充,如"模特戴渔夫帽""避免文字")。
  - **生成 = 单图单参考**(只印花):`resolveBatchGen`(纯,出 SOP §3 模板 prompt) → `runPhotoGenJob`(异步,`generateFromRefs([印花], prompt)`)。模板含褶皱变形 realism(铁律3)+ 线色规则(深衣白线/浅衣深线,§4)。
  - 校验:无印花报错(铁律1);没选颜色报错;没选任何输出报错。
  - 颜色矩阵图(把多色拼一张)= 后续(SOP §6 提醒 AI 画色号字不稳,需人工核对)。
- **商品图结果库**(`PhotoGallery`= listing.photos 扁平列表,Etsy 取前 10、`isMain` 标主图):
  - 产出**统一是 Etsy 上架商品图**,不按素材来源(模特/姿势/场景)给输出打标签——它们就是 listing 要用的图,用户看着挑、设主图。
  - **点图放大**(复用 `ImageLightbox`);每张 hover:**精修** / ★设主图 / 删除 / **＋加到创作助手**(`QuickAddChat`,派发 `attach-image-ref-to-chat`)。末尾「挑图」/「上传」(尺码图/包装图)。
- **图 ↔ 创作助手 双向桥**:
  - 推:商品图、**方向参考图(含图库素材 + 采集原图)**都带「＋加到创作助手」(`QuickAddChat`),所有图都能丢进创作助手。
  - 回:创作助手出的图 → ① 「挑图」(`PhotoPicker`)里置顶列出(可手动挑入);② 图库上方横幅「创作助手出了 N 张新图 → 全部加入」(8s 轮询会话生成图,一键回流)。
  - 批量生成的图本就**自动追加**进结果库(`generated`)。
  - 注:创作会话是全局单例(localStorage 缓存),故"回流"是置顶+横幅一键(非按槽位全自动,避免把无关聊天图塞进来)。
- **精修**(`resolveRefine`):给一张图 + 一句指令 → `[原图]` + 精修 prompt(img2img)再出一张,作为新图进库、原图保留。
- **异步**:发起 → 起 `etsy_forge_listing_photo_jobs`(running)→ `generateFromRefs` 跑完写回 job。前端轮询:running→结果库占位转圈;success→**追加**进结果库(客户端 patch,photos 始终客户端所有,避免与自动保存抢)+删 job;failed→提示。右下 `PhotoJobsDock` 浮层显示全部 running,不挡手。
- **底线**:只拿用户自有印花 + 自有图库素材合成,不碰同行成品图(R1);失败如实显示;生成图 `sourceType='generated'`,存本 listing,不污染「我的产品」板。

photos JSON:`[{ position, src, sourceType:'mockup'|'asset'|'upload'|'generated', sourceId?, isMain?, role?, label? }]`。

### 6.3 价格与变体(子 tab 4)
- 基础:price / currency / quantity / sku。
- **变体**:`variations = { properties: [{ name:'Size', options:['S','M','L','XL','2XL'] }, { name:'Color', options:[...] }], combos: [{ key, priceDelta?, price?, quantity?, sku?, photoRole? }] }`。
  - 尺码 + 颜色两轴(POD 最常用),也允许自定义属性名。
  - 组合表:每个尺码×颜色一行,可单独定价/库存/SKU/绑定颜色图。
- **个性化** personalization:`{ enabled, optional, instructions, charLimit }`。

### 6.4 类目与属性(子 tab 5)
- **taxonomy_path**:类目路径选择(内置 POD 服饰常用类目树,见 `etsy-taxonomy.ts`;可手填自定义)。
- **section**:店铺分区(自由文本)。
- **listing_details**:
  - whoMade:`i_did` / `someone_else`(含 POD 合作方)/ `collective`
  - whatIs:`finished_product` / `supply`
  - whenMade:`made_to_order` / `2020_2025` / `vintage` … (Etsy 取值集)
- **listing_type**:physical / digital;**renewal**:automatic / manual。
- **production_partner**:POD 供应商名(Printful/Printify/…)。
- **类目属性 attributes**(随类目变,服饰类内置):primary_color / secondary_color / occasion / holiday / garment_style / neckline / sleeve_length / fit / size_scale …。每项下拉或文本。

### 6.5 物流(子 tab 6)
shipping JSON:`{ profileName, processingTime, countryOfOrigin, weight:{value,unit}, dimensions:{l,w,h,unit}, returnsAccepted, returnWindowDays }`。

## 7. 完整度门禁

「待上架(ready)」必填项(缺一即不通过,门禁列出缺项):
title、description、tags(≥1)、main 图、price>0、quantity>0、taxonomy_path、listing_details 三问齐、listing_type。
materials / 变体 / 物流 / 类目属性为推荐项,不阻断但在清单里标「建议补全」。

完整度 % = 已填必填项 / 必填项总数。

## 8. 从一张产品图新建(source_kind=from_group)

入口:列表页「从产品图新建」→ 选图器按产品分组展示出图,用户点**一张**产品图。粒度是「单张产品图」,不是整组。

行为(按用户反馈两轮修正后定稿):
- **只预填两样**:① 选中的那张产品图 → 主图;② 这张图用的印花(mockup.design_ref) → 细节图。
- **不塞别的图**:同一 `source_product_id` 下常有多个不同设计(用户视作不同产品),早期"整组全塞"会把别的产品混进来——只预填用户选中的这一张及其印花,其余图位留空,用户自己挑。
- 携带 `source_product_id` → AI 文案复用该产品已采集的关键词/评论情报(来自采集商品才有;手攒产品无情报,优雅降级)。
- internal_name 取产品标题(source_product_title);其余字段空,状态 draft。

## 9. AI 文案草稿(R2)

入口:文案子 tab「AI 生成草稿」。

- 输入:本 listing 的主图/前几张自有图(vision)+ source_product_id 对应的已采关键词、评论分析(若有)+ 用户可补一句卖点。
- 输出:`copy_draft = { title, description, tags[], materials[], generatedAt }`,渲染在正式字段旁的「草稿」区。
- 用户对每段可「采用」(覆盖正式字段)或「忽略」。**不自动写正式字段**。
- 提示词约束:基于自有产品图描述卖点,**禁止照搬同行 listing 原文**;tags 走 Etsy SEO 习惯(长尾词、≤20 字符)。
- 复用 etsy-forge 现有 vision-provider / chat provider,走草稿优先;失败如实显示原因,不 mock。

## 10. 导出 / 手动上架(子 tab 7)

- 完整度门禁卡片(缺项列表 + 「标记待上架」按钮)。
- 逐字段「复制」按钮(标题/描述/标签整段/材料)。
- 导出整条 JSON / CSV(字段名对齐 Etsy 表单)。
- 「标记已上架」:填 Etsy listing URL/ID → 状态转 listed。

## 11. 文件结构(遵守 ≤300 行/文件、≤50 行/函数)

```
src/lib/etsy-forge/listing/
  types.ts             # ListingRow + 子结构类型 + 状态/角色枚举
  store.ts             # CRUD + 从出图组导入(seed)
  completeness.ts      # 完整度门禁计算
  etsy-taxonomy.ts     # 类目树 + 类目属性目录(POD 服饰)
  ai-draft.ts          # AI 文案草稿生成(vision+chat,草稿优先)
src/app/api/apps/builtin/etsy-forge/listings/route.ts        # GET/POST/PATCH/DELETE
src/app/api/apps/builtin/etsy-forge/listings/ai-draft/route.ts  # POST 生成草稿
src/components/apps/builtin/etsy-forge/tabs/DevelopTab.tsx   # 列表/table
src/components/apps/builtin/etsy-forge/tabs/develop/
  ListingDetail.tsx          # 详情壳 + 子 tab 切换
  OverviewSection.tsx
  CopySection.tsx
  PhotosSection.tsx
  PriceVariantsSection.tsx
  CategoryAttributesSection.tsx
  ShippingSection.tsx
  ExportSection.tsx
  PhotoPicker.tsx            # 自有图选图器(置灰同行图)
  field-catalog.ts           # §6 取值集(枚举/角色/类目属性)前端共享
```
api-client.ts / api-types.ts 增 listing 端点与类型。types.ts 仅加 `COLLECTIONS.LISTINGS` 一行(不再扩 types.ts,避免它继续超长)。

## 12. 内置级应用包同步(门禁要求)

- `data-schema.json`:加 `etsy_forge_listings` collection(§5 字段)。
- `native-app-spec.json`:userVisibleScope/status 加产品开发条目;`ai.enabled` 维持但补 `promptSettings`/`draftBeforeWrite=true` 已满足;data.entities 加 `etsy_forge_listings`;acceptance 加产品开发验收项;risk.outOfScope 重申 R1/R3。
- `pages/develop.json` + routes.json 菜单加「产品开发」。
- `native-app-spec.json` 变更后需用户在「项目状态」接受当前版本(门禁)。

## 13. 验收清单

- [ ] 列表页能新建空白产品、从出图组导入;table 显示状态/完整度/图数/变体/价格。
- [ ] 详情 7 子 tab 均可编辑并落库,刷新仍在。
- [ ] 图片子 tab:自有图可入位/排序/设主图;同行图置灰禁选(R1)。
- [ ] 变体矩阵:尺码×颜色生成组合表,可单独定价/库存/SKU。
- [ ] 类目与属性、物流字段齐全可存。
- [ ] AI 文案:生成草稿落 `copy_draft`,用户采用才写正式字段;失败显示真实原因(R2)。
- [ ] 完整度门禁:必填缺项时「标记待上架」禁用并列缺项;齐了才可转 ready(R4)。
- [ ] 导出:逐字段复制 + 导出 JSON/CSV;标记已上架填链接转 listed(R3)。
- [ ] data-schema/native-app-spec/pages 同步,内置级校验通过。
```
