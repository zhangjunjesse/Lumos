# 电商应用 · EHunt 选品支持 + 评论情报开发指导

> 交付给 Claude 执行的需求与技术指导。先读本文件，再读引用到的现有文件，按"实现依赖顺序"一次性做完，不做分阶段降级 hack。

## 1. 背景与目标

用户在电商应用「选品 → 采集」流程里希望：

1. **采集阶段接入 EHunt**：当浏览器上下文是装了 EHunt 扩展的 AdsPower profile 时，每个商品附带 EHunt 注入的销量/收藏等数据。没装则如实显示"未接入"，不 mock。
2. **每个商品采集原始评论**：用下文逆向出的 Etsy 原生接口抓全量评论（**此能力不依赖 EHunt**，只要浏览器上下文登录了 Etsy）。
3. **分析评论达到 EHunt 同等效果**：用 Lumos 自有 LLM 把原始评论分析成「客户画像 / 好评归因 / 差评归因 / 消费预期 / 购买动机」，对齐 EHunt 的 AI Review Analysis 产出。
4. **分析默认不触发**：评论分析是较贵操作，**默认关闭，由用户在 UI 手动触发**。采集（指标 + 原始评论）可随选品流程进行。

关键判断：EHunt 面板的"原始数据层"本质是把 Etsy 自己的 JSON 接口翻页抓下来；它的"AI 叙述层"在扩展后台 service worker 生成（页面级抓不到、每日 20 次配额、UI 易变）。因此**复用绑定 Etsy 源头契约 + Lumos 自有 LLM，EHunt 仅作为销量指标的可选增强，不作为评论分析的依赖**。

## 2. 范围

**In**：选品采集时的 EHunt 指标增强；逐商品原始评论抓取与存储；手动触发的评论分析；相关设置与 UI 状态（已接入 / 未接入 / 需登录 / 失败原因）。

**Out**：不依赖、不调用 EHunt 任何后端/扩展 API；不读取扩展 `chrome.storage`；不改任何全局浏览器基础设施（BrowserManager / UA / partition）；本特性全程只读，无写操作。

## 3. 关键技术发现（采集方法真源，已实测验证）

### 3.1 EHunt 注入指标层（列表页 + 详情页 DOM）

EHunt 不用普通 class/iframe，把指标以文本注入 Etsy 商品卡与详情页面板（`EHunt - Etsy Rank Tool`）。已验证可用 `element.innerText` 抽取，字段：

| 字段 | 含义 | 样例 |
|---|---|---|
| `sales` | 总销量(近期) | `708(42)` |
| `favorites` | 收藏 | `4.0K` |
| `storeWeeklySales` | 店铺周销 | `75` |
| `listed` | 上架日期 | `11/22/25` |
| 详情页另有 | Total Views / Review Ratio / Tags 搜索量 / Store Sales / BestSeller / Stocks | — |

扩展 ID（用于探测是否安装）：`pmpgnefoilpinnblccjddomajohmbpko`。注意：AdsPower 的 CDP `/json` 会过滤扩展 target，**不要依赖能 attach 扩展上下文**；只做"页面上是否出现 EHunt 注入痕迹"的探测。

### 3.2 Etsy 原生评论接口（评论采集真源，不依赖 EHunt）

EHunt AI 面板做的事 = 把下面这个 Etsy 自己的接口按页翻完（实测 101 条评论 = 13 页）：

- **Endpoint**：`POST https://www.etsy.com/api/v3/ajax/bespoke/member/neu/specs/deep_dive_reviews`
- **Body**（仅改 `page`，1 → `jsData.totalPages`）：

```json
{"log_performance_metrics":true,"specs":{"deep_dive_reviews":["Etsy\\Modules\\ListingPage\\Reviews\\DeepDive\\AsyncApiSpec",
{"listing_id":4409539445,"shop_id":35957464,"scope":"listingReviews","page":1,"sort_option":"Relevancy",
"rating_filter":null,"tag_filters":[],"should_lazy_load_images":false,"should_show_variations":true}]}}
```

- **响应 `jsData`（已验证键）**：`totalReviews`、`averageRating`、`ratingCounts {1..5,All}`、`tagFilters[]`（**Etsy 自带的标签情感+频次**，如 `Quality:38 / Shipping & Packaging:15 / Seller service:12 / Description accuracy:12 / Appearance:9 / Value:4 / Ease of use:3 / Comfort:1`）、`media.photos[]`、`totalPages`、`currentPage`、`reviews[]`。
- **`reviews[]` 元素结构（已验证嵌套，字段路径需 build 期 map）**：`{ transactionId, reviewInfo, buyerInfo, reviewContent, sellerResponse, translationContext }`。评分/日期/正文在 `reviewInfo` / `reviewContent` 内，构建时按实际响应取字段，不要照搬本文猜测。

**实现红线**：不要把 endpoint 写死成 `member`。正确做法是在已打开的 listing 页面上下文里，**复刻该页面自己发出的同一请求**（同源 `fetch`，`credentials:'include'`，沿用 profile 的登录态与代理出口）。这样登录/未登录、member/public 由浏览器上下文自然决定。

### 3.3 不可依赖项

EHunt 的 pros/cons/画像/动机叙述：扩展后台生成，无页面可见网络调用，每日 20 次配额，黑盒。**不抓、不依赖**。我们用 §5.3 自有 LLM 复刻同等产出。

## 4. 架构与集成点

### 4.1 复用的现有机制（不要另造轮子）

- **浏览器上下文选择**：`src/lib/ecommerce-assistant/discover-settings.ts` → `BrowserFetchSettings.browserContextId`，AdsPower 形如 `adspower:<profile_id>`。凭证在「设置 → 浏览器」，不在应用里。
- **驱动浏览器**：`src/lib/ecommerce-assistant/browser-fetcher.ts` 的模式 —— `resolveBrowserBridgeRuntimeConfig({ browserContextId, lockOwnerId })` + `postToBrowserBridge(config, '/v1/pages/new' | '/v1/pages/evaluate' | '/v1/pages/close', { ..., background: true })`。**所有自动化走 `background: true`**，禁止抢用户前台 tab（沿用现有 `MARKETPLACE_FETCH_BACKGROUND`）。Etsy 接口抓取用 `/v1/pages/evaluate` 在页面内 `fetch` 实现。
- **LLM 分析**：`src/lib/ecommerce-assistant/llm-client.ts` 的 `generateStructured<T>({ system, prompt, schema, maxTokens, abortSignal })`；不可用时返回 `null` 走降级、真实错误抛出 —— 完全对齐 `src/lib/ecommerce-assistant/research-analyze.ts` 现有写法。

### 4.2 新增模块（建议，遵守 ≤300 行/文件、函数 ≤50 行、lib 与 route 分层、kebab-case）

```
src/lib/ecommerce-assistant/ehunt/
├── detector.ts          # 探测：上下文是否 adspower + 页面是否有 EHunt 注入痕迹
├── metrics-extract.ts   # 列表/详情页 EHunt 指标抽取脚本(注入evaluate) + 解析为结构化
├── etsy-reviews.ts      # deep_dive_reviews 同源分页抓取(经 Browser Bridge evaluate)
├── review-analyze.ts    # LLM 复刻 EHunt 评论分析(zod schema + generateStructured)
└── types.ts             # EhuntMetrics / RawReview / ReviewIntel 类型
```

UI 集成：选品列表/卡片（`DiscoverTab.tsx`、`ListingsTab.tsx`）展示 EHunt 指标列；`ProductDetailDialog.tsx` 增加「采集评论」状态与「分析评论」手动按钮；设置面板（`BrowserFetchSettingsCard.tsx` 邻近）显示 EHunt 接入状态。

### 4.3 数据流

```
采集阶段(自动):
  选品采集 → 每商品: [若 adspower+EHunt] metrics-extract → EhuntMetrics
                     etsy-reviews 分页抓取 → RawReview[](入库, 不分析)
手动阶段(用户点「分析评论」):
  RawReview[] → review-analyze(generateStructured) → ReviewIntel(入库, 缓存)
```

## 5. 行为规格

### 5.1 EHunt 指标增强（采集阶段）

- 仅当 `browserContextId` 以 `adspower:` 开头**且** `detector` 在采集页面检测到 EHunt 注入痕迹时，给每个商品附 `EhuntMetrics`。
- 未装 / 非 adspower / 未检测到：商品照常采集，EHunt 字段为 `null`，UI 明确显示 `未接入 EHunt（需 AdsPower + 已安装 EHunt 扩展）`。**禁止用占位/估算冒充**。
- 抽取在 `/v1/pages/evaluate`（background）里跑 `innerText` 解析，复用 browser-fetcher 的页面就绪等待策略，不新开前台 tab。

### 5.2 原始评论采集（采集阶段，独立于 EHunt）

- 输入：listing 页 URL → 解析 `listing_id`、`shop_id`（页面 DOM/`__INITIAL_STATE__` 可得）。
- 在 listing 页上下文 `evaluate` 内同源 `fetch` §3.2 接口，`page` 从 1 循环到 `jsData.totalPages`，聚合 `reviews[]` + `ratingCounts` + `tagFilters`。
- 速率：页间小延时（参考现有 poll 间隔），全程 background，可被 abortSignal 取消。
- 失败态如实暴露：未登录 → 返回结构与字段缺失时标记 `needs_login`；接口结构变化（逆向风险）→ 标记 `etsy_contract_changed` 并附原始响应片段；提供"DOM 兜底"说明位（首版可不实现兜底，但错误态必须可见，不得静默成功）。
- 存储：复用 app data store / `research-storage.ts` 模式，键含 `listingId`；原始评论与分析结果分开存。

### 5.3 评论分析（手动触发，默认关闭）

- **默认不跑**。入口：`ProductDetailDialog` 的「分析评论」按钮（无原始评论时禁用并提示先采集）。
- 用 `generateStructured`，输出 zod schema 草案（对齐 EHunt 字段）：

```ts
const reviewIntelSchema = z.object({
  customer_profile: z.object({
    gender_split: z.string().optional(),                 // 如 "male 82% / female 18%"
    who: z.array(z.string()).max(8).default([]),
    when: z.array(z.string()).max(8).default([]),
    where: z.array(z.string()).max(8).default([]),
    what: z.array(z.string()).max(8).default([]),
  }),
  pros: z.array(z.object({ topic: z.string(), reason: z.string() })).max(12).default([]),
  cons: z.array(z.object({ topic: z.string(), reason: z.string() })).max(12).default([]),
  expectations: z.array(z.object({ topic: z.string(), reason: z.string() })).max(12).default([]),
  motivations: z.array(z.object({ topic: z.string(), reason: z.string() })).max(12).default([]),
});
```

- prompt 输入用结构化原始评论 + `ratingCounts` + Etsy `tagFilters`（已是高质量先验，省 token）。system 沿用 research-analyze 口径：严禁编造、样本不足要明说。
- 缓存：键 = `listingId + 原始评论内容 hash`；评论没变不重复调用 LLM。LLM 不可用 → 返回 `null`，UI 显示"未配置可用模型"，不降级成假数据。

## 6. 约束红线（与 CLAUDE.md / 项目记忆对齐）

- 全程 `background:true`，不打开/不切换用户可见 tab，派生页继承后台属性。
- 不改 BrowserManager / UA / partition 等全局浏览器基础设施。
- 不调用、不依赖 EHunt 后端或扩展；不读 `~/.claude/`、不写出 Lumos 数据空间外。
- 任何能力缺失（无 EHunt / 未登录 / 接口变更 / 无 LLM）必须有可见的真实失败原因，禁止 mock 冒充完成。
- Etsy 内部 AJAX 属逆向，可能变更：合规/ToS 风险由用户承担，代码侧需做契约校验与显式错误态。
- 代码规范：单文件 ≤300 行、函数 ≤50 行、API 路由只做参数/响应、业务在 lib、无硬编码配置、无复制粘贴。

## 7. 实现依赖顺序（非分期交付；目标是一次性完整交付）

1. `ehunt/types.ts` + `detector.ts`（探测 adspower 上下文 + EHunt 痕迹）。
2. `etsy-reviews.ts`（评论分页抓取，先打通这条腿，含错误态）。
3. `metrics-extract.ts`（EHunt 指标抽取）。
4. 采集流程接线：选品采集时按 §5.1/§5.2 产出 `EhuntMetrics` + `RawReview[]` 入库。
5. `review-analyze.ts` + 缓存（§5.3）。
6. UI：指标列、采集状态、手动「分析评论」按钮与结果展示（无 gradient，纯色 + ring/border）。
7. 测试：detector / 评论分页聚合 / schema 校验 / 降级路径，放对应 `__tests__/`。

## 8. 验收清单

- [ ] adspower+EHunt 上下文：选品商品带真实 `sales/favorites/storeWeeklySales/listed`；非该上下文显示"未接入 EHunt"且无假数据。
- [ ] 任意已登录 Etsy 浏览器上下文（不需 EHunt）：单商品评论按 `totalPages` 全量抓全，`reviews.length ≈ totalReviews`，含 `ratingCounts`/`tagFilters`。
- [ ] 评论采集全程 background，未打开/切换用户前台 tab；可被取消。
- [ ] 未登录 / 接口结构变化 / 无 LLM：分别显示明确失败原因，无静默成功、无 mock。
- [ ] 「分析评论」默认不触发；手动点击后产出 schema 完整的 `ReviewIntel`（画像/好评/差评/预期/动机），与 EHunt 同类产出可比。
- [ ] 同一商品评论未变化时再次分析命中缓存，不重复调用 LLM。
- [ ] 新增文件均 ≤300 行、函数 ≤50 行、lib/route 分层、kebab-case；无全局浏览器基础设施改动。
- [ ] 关键路径有单测（探测、分页聚合、降级、schema 校验）。

## 9. 验证锚点（已实测，供开发自检）

- 样例 listing：`4409539445`（shop `35957464`），`totalReviews=101`、`totalPages=13`、`averageRating≈4.83`、`ratingCounts {5:87,4:13,3:1,2:1,1:0}`。开发时对这条做端到端自检，抓全应得 ~101 条并能产出与 §5.3 同结构的分析。
