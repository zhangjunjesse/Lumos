# Etsy eRank 选品雷达 — 内置应用落地设计

> 本文把 `docs/etsy-erank-ai-selection-sop.md`(操作员 SOP,方法真源)落成一个 Lumos 内置应用的工程/产品规格。
> 方法怎么判、阈值多少,以 SOP 为准;本文只回答「在 Lumos 里这套东西长什么样、数据怎么存、闸门怎么落、执行器怎么换」。
>
> 关联:
> - `docs/etsy-erank-ai-selection-sop.md` —— 方法真源(六步、阈值、配额、失败态)
> - `docs/etsy-selection-sop-analysis.md` —— 对**现有电商模块**的批判;本应用**不改电商模块**,但其数据模型诉求(研究事务/原始样本/可复盘)被本设计吸收
> - 本应用与 `ecommerce` / `wechat` / `douyin` 内置应用平级,互不干扰

---

## 0. 目的与范围

- **做什么**:把「eRank + AI 选 Etsy 品」这套人工 SOP,变成一个能反复跑、可复盘、不烧配额、不让 AI 编数字的纪律性流水线。
- **不做什么**(出 SOP §0.1):供应链确认、最终定价、详情页文案定稿、上新排期。这些是后续动作,不在本应用闭环内。
- **产物目标**:机会表(A/B/C)+ 人工验证结论 + 待补产品 brief。不是关键词清单,也不替代竞品/评论/利润/供应链验证。

## 1. 形态与落点(已定)

| 项 | 决定 |
|---|---|
| 形态 | **新的独立硬编码内置应用**,与 ecommerce/wechat/douyin 平级 |
| UI | `src/components/apps/builtin/etsy-erank/` |
| 业务逻辑 | `src/lib/etsy-erank/`(API 只做参数解析与响应,逻辑全部下沉 lib) |
| API | `src/app/api/apps/builtin/etsy-erank/`(薄层) |
| 注册 | `src/lib/init-builtin-resources.ts` / `src/lib/builtin-apps-visibility.ts` |
| 复用 | `src/lib/browser-provider/`(AdsPower 整套,**不改它**) |
| 数据 | `lumos.db` 主库,新增本应用专属表,**不新建 db** |

**口径边界**:本应用是硬编码内置应用,**不是** AppBuilder 用户侧内置级应用包。因此 `native-app-spec.json` / `pages/*.json` / 内置级应用包强门禁**不适用**,不搭那套脚手架。

## 2. 五条底线(落成结构,不靠提示词)

| # | 底线 | 结构化落法 |
|---|---|---|
| 1 | 绝不让 AI 凭空扩词后批量烧配额 | 配额台账是一等实体;③ 收敛输出硬卡 ≤120;② 采种子零配额;④ 验真扣账,预估超额**直接拒跑** |
| 2 | 绝不编造 eRank 没给的数字 | ⑤ 打分只读 `keyword_metrics` 真实行;任一字段缺失→该行自动降级或标「证据不足」,不补数 |
| 3 | ⑥ 人工验证不可被 AI 跳过 | A/B 级只生成「待人工验证卡」;AI 不能写 `passed`;只有人填 `manual_validation_notes` 才闭合 |
| 4 | eRank 只走已登录 AdsPower、后台、不抢 UI | AdsPower 执行器经 browser-provider,`background:true`,不开右侧面板/不切用户 tab/不调 stop/不改 BrowserManager |
| 5 | 失败不伪装完成 | 每步失败态带 `failure_reason` + 重试动作,映射 SOP §6.2 七种失败 |

底线是验收红线。开发自测、demo 验收都对照这五条。

## 3. 数据契约

一轮研究 = 一条 `radar_run`,挂 5 类产物 + 1 本配额台账。两个执行器写**同一套表**。

### 3.1 radar_run(雷达轮次)
| 字段 | 说明 |
|---|---|
| id | 轮次 ID |
| label | 如 `OPP-雷达-2026-05`(对齐 SOP §3.7 月度节奏 + 清单上限 50 滚动策略) |
| entry_mode | `with_capability`(有能力/方向,跑 ① 圈猎场) / `blank_slate`(完全没想法,跳过 ①,② 抄市场顶部全类目)。**新开轮次时由用户选**,中途不可改(改了证据链就不一致) |
| capabilities | `with_capability` 模式填的能力清单(JSON,如 `["vinyl 贴纸","POD 印花","激光木牌"]`);`blank_slate` 为 null |
| huntground | ① 圈猎场产物:3–5 个类目方向(JSON)。`blank_slate` 为 null |
| status | 见 §4 步骤状态机的轮级聚合态 |
| step_states | 6 步各自状态(JSON,见 §4) |
| executor_profile | 本轮 ②④ 选用的执行器(paste / adspower) |
| started_at / finished_at | 时间 |
| summary | 本轮摘要 |

### 3.2 seed_terms(采种子)

| 字段 | 说明 |
|---|---|
| run_id / source_tool | 所属轮次 / 来源(Trend Buzz/Monthly Trends/Category Report/Top Sellers) |
| keyword / category / market | 抄到的关键词 / 类目(`blank_slate` 模式可为「全类目」)/ 市场(默认 USA) |
| rank | 该源里的位次(1, 2, 3...);用于回看顺序 |
| change | Trend Buzz 专属:`↑ 223` / `↓ 1` / `-`(SOP §1.2 趋势判读核心列) |
| avg_searches / avg_ctr / competition | Trend Buzz 已有的统计(可空,`Unknown` 不补) |
| trend_note | Monthly Trends 专属:`Apr 2026 / 114,920` (顶月 + 顶月搜) |
| headers / raw_cells | 原始表头 + 整行原始 cells(防字段漂移,出问题能回溯) |
| imported_at | 抄词时间戳 |

> **来源(脚本)**:`scripts/erank-seed-collect.mjs` 经 AdsPower CDP 接管 eRank 抓取;
> - 多 `<table>` 选 tbody 行数最多那个(eRank 用 sticky header pattern 同时渲染 3 张 table)
> - 真实鼠标滚轮事件触发懒加载,直到行数稳定
> - 按表头列名映射,不按位置硬读(SOP §6.2 字段漂移防护)

### 3.3 keyword_metrics(验真,eRank 真实导出)
`run_id`、`keyword`、`searches`、`clicks`、`ctr`、`competition`、`kd`、`trend`、`google`、`imported_at`、`source`(paste/adspower)
> 按列名映射写入,**不按位置硬读**(SOP §6.2 字段漂移防护)。

### 3.4 opportunity_candidates(收敛→打分)
`run_id`、`opportunity_keyword`、`product_guess`、`grade`(A/B/C)、`seasonality`、`reason`(为什么是缺口,一句中文)、`next_step`、`evidence`(引用的 keyword_metrics 行,证据链)、`evidence_sufficient`(布尔,缺数据时 false)

### 3.5 manual_validation_notes(人工验证卡)
`candidate_id`、`competitor_ids`、`price_band`、`review_notes`、`image_style`、`risk_notes`、六项检查结论(竞品集中度/价格带/图片差异化/评论痛点/交付风险/利润空间,见 SOP §3.5)、`verdict`(pass/reject/insufficient)、`verified_by`、`verified_at`

### 3.6 product_brief(立项)
`candidate_id`、`target`、`use_case`、`value_prop`、`cost`、`profit`、`grade`、`action`

### 3.7 quota_ledger(配额台账,一等实体)
`run_id`、`step`、`debited`(本次扣词数)、`balance_after`、`period`(如 `2026-05`)、`at`
> 月配额 200(SOP §5.2)。台账按 `period` 汇总;④ 跑前预估 > 余额则拒绝并给「下次配额重置再跑」的失败态。

## 4. 六步状态机

轮次是状态机。每步状态:`pending` / `running` / `blocked` / `done` / `failed` / `skipped`(仅 ① 在 `blank_slate` 模式下使用)。两个闸门用 `blocked` 表达,**不依赖工作流引擎的 approval 步骤**(该步骤类型当前缺失,本应用自有状态模型持有闸门)。

| 步 | 执行者 | 配额 | 闸门 | 失败态(SOP §6.2) |
|---|---|---|---|---|
| ① 圈猎场 | LLM 执行器 | 0 | — | `blank_slate` 模式整步 `skipped`(SOP §3.3 ①「真无约束就跳过,全类目」) |
| ② 采种子 | 可插拔(paste/adspower) | 0 | — | 来源分两种:`with_capability` 按 `huntground` 类目下钻;`blank_slate` 抄 Trend Buzz + Monthly Trends 顶部(全类目);Trend Buzz 默认 Yesterday(eRank 默认窗口),要 7d/30d 需人工切 dropdown(脚本走 PrimeReact dropdown 切换 TODO);未登录→重开 profile;字段漂移→按列名映射不按位置 |
| ③ AI 收敛 | LLM 执行器 | 0 | — | 输出 >120 → 截断并告警 |
| ④ Bulk 验真 | 可插拔(paste/adspower) | **烧 ≤120** | **配额闸**:超额→`blocked` | 配额不足/字段漂移/未登录 |
| ⑤ AI 打分 | LLM 执行器 | 0 | — | 表为空/全证据不足→不出 A/B/C |
| ⑥ 人工验证 | 人 | 0 | **人工闸**:A/B 级未填验证卡→`blocked` | 样本不足→标「证据不足」不立项 |

轮级聚合态:`not_configured`(未配 AdsPower profile 且选自动执行器) / `ready` / `running` / `blocked` / `failed` / `completed`。

## 5. 可插拔执行器架构(已定)

②④ 两个机械步抽象成 `StepExecutor`:同一输入/输出契约,下游 ③⑤⑥ 不感知执行方式。策略模式,一次到位,不分阶段。

```
interface StepExecutor {
  collectSeeds(run): SeedTerm[]          // ② 用
  bulkVerify(keywords): KeywordMetric[]  // ④ 用
}
```

| 执行器 | ②/④ 行为 | 适用 |
|---|---|---|
| `PasteExecutor` | 渲染粘贴/CSV 导入面;人在已登录 eRank 自己操作,数据回灌 | 默认、最稳;贴合配额底线与「不伪造」;即 SOP §3.4 接口形态 |
| `AdsPowerExecutor` | 经 browser-provider CDP 后台驱动 eRank 抄词/导出 | 机械步自动化;脆弱(反自动化/字段漂移/指纹浏览器生命周期),受底线 4 约束 |
| `LlmExecutor` | ①③⑤ 的 AI 步(非本岔路口,固定) | — |

- 执行器**按轮次选**(`radar_run.executor_profile`),人可中途接管:自动跑挂了→该步转 `failed` 带重试→人切 `PasteExecutor` 续跑,数据契约不变。
- `AdsPowerExecutor` 不自己管浏览器生命周期:复用 browser-provider;断 CDP 不关窗;**不调 AdsPower stop**(SOP §5.1)。

## 6. AI 步骤(提示词固化 SOP §3.4 / §3.2)

| 步 | 提示词来源 | 硬规则 |
|---|---|---|
| ① 圈猎场 | SOP §3.4 ① | **仅 `with_capability` 模式启用**(`blank_slate` 不跑 ①);只列方向,不编搜索数据 |
| ③ 收敛 | SOP §3.4 ③ | 聚类/去重/删大词根/每簇补 3–5 长尾;**总数 ≤120**;输出可直贴 CSV;不给搜索量 |
| ⑤ 打分 | SOP §3.4 ⑤ + §3.2 判定规则 | 硬门槛淘汰 + A/B/C 分级 + 趋势加权;**只用表里数字** |

§3.2 判定规则(应用内固化为打分函数,非提示词软约束):

- **硬门槛(任一即丢)**:月搜<100 / CTR=Unknown 或点击≈0 / 竞争>100,000 / KD=100
- **A 级**:月搜≥150 ∧ 竞争<5,000 ∧ KD<30 ∧ CTR≥80%
- **B 级**:竞争<50,000 ∧ KD<50 ∧ 月搜≥100 ∧ CTR≥80%
- **C 级**:需求强但竞争/KD 拉满 → 仅标题副词
- **趋势**:升/多月稳=加权;单峰=标季节月份;跌=降一级

提示词可在应用设置页查看(透明,不可见即不可信)。

### 6.1 ③ 收敛步骤完整契约(分层架构)

把 ②  抓回的 100+ 杂词,产出 ≤120 个可直接 ④ 验证的长尾清单。
**架构原则**:确定性规则交给 code(快、稳、可审计);AI 只做语义/创意(聚类、选 core、补长尾)。

```
② 种子词清单(100+)
  ↓
┌─────────────────────────────────┐
│ 第 1 层:code 预过滤              │ 毫秒级,不烧 token,产出 rejected 列表
└─────────────────────────────────┘
  ↓ candidates(典型 30-60)
┌─────────────────────────────────┐
│ 第 2 层:code 给候选打 score      │ 给每个候选一个 core_potential_score
└─────────────────────────────────┘
  ↓ candidates 按 score 降序
┌─────────────────────────────────┐
│ 第 3 层:AI(JSON Schema strict) │ 聚类 / 选 core / 从维度词库挑修饰
└─────────────────────────────────┘
  ↓ raw output
┌─────────────────────────────────┐
│ 第 4 层:code 校验 + 自动修剪      │ 兜底 AI 不稳定输出,严重违规重跑
└─────────────────────────────────┘
  ↓
≤120 词清单 + rationale + rejected
```

#### 6.1.1 第 1 层 — code 预过滤

```ts
type RejectReason =
  | 'duplicate'
  | 'red_ocean'
  | 'dead_no_search'
  | 'dead_no_click'
  | 'too_broad_single_word';

function preFilter(seeds: Seed[]): { candidates: Seed[]; rejected: { keyword: string; reason: RejectReason; stats?: object }[] } {
  const seen = new Set<string>();
  const candidates: Seed[] = [];
  const rejected = [];
  for (const s of seeds) {
    const norm = s.keyword.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
    if (seen.has(norm)) { rejected.push({ keyword: s.keyword, reason: 'duplicate' }); continue; }
    seen.add(norm);
    if (typeof s.competition === 'number' && s.competition > 100_000) {
      rejected.push({ keyword: s.keyword, reason: 'red_ocean', stats: { competition: s.competition } }); continue;
    }
    if (s.month_searches === 'Unknown' || s.month_searches === '<20') {
      rejected.push({ keyword: s.keyword, reason: 'dead_no_search' }); continue;
    }
    if (s.ctr === 'Unknown') {
      rejected.push({ keyword: s.keyword, reason: 'dead_no_click' }); continue;
    }
    const wc = s.keyword.trim().split(/\s+/).length;
    if (wc === 1 && typeof s.competition === 'number' && s.competition > 1_000_000) {
      rejected.push({ keyword: s.keyword, reason: 'too_broad_single_word', stats: { competition: s.competition } }); continue;
    }
    candidates.push(s);
  }
  return { candidates, rejected };
}
```

#### 6.1.2 第 2 层 — core 潜力打分

```ts
function scoreCorePotential(s: Seed): number {
  const wc = s.keyword.trim().split(/\s+/).length;
  let score = 0;
  if (wc >= 2) score += 50;
  if (wc === 1) score -= 30;
  if (typeof s.competition === 'number') {
    if (s.competition < 1_000) score += 30;
    else if (s.competition < 10_000) score += 15;
    else if (s.competition < 50_000) score += 5;
  }
  if (s.rank && s.rank <= 20) score += 5;
  return score;
}
```

candidates 喂 AI 之前,按 score 降序排序,把最值得关注的词放前面(对抗 LLM 的 lost-in-the-middle)。

#### 6.1.3 niche_type registry(替代 modifier_library 抽象)

**根本认知**:"材质/场合/风格/人群"4 维度只对婚礼标牌成立。每个 niche 的真实维度都不同(首饰用"材质/款式/人群",数字下载用"形态/用途/风格",公益徽章用"议题/材质")。强求**统一维度库** ≠ 灵活的 niche-specific 修饰。

引入 **niche_type** 抽象:**所有 niche-specific 的判据(维度/模板/阈值/红海黑名单/期望词数)挂在 type 上**,AI 给每个 niche 分配一个 type,后续按 type 取参数。

##### 6.1.3.1 NicheType 接口

```ts
interface NicheType {
  id: string;                              // 'jewelry'
  name_zh: string;                         // '首饰'
  
  dimensions: Record<string, string[]>;    // 该 type 的真实修饰维度
                                           // key 名 niche-specific(material/style/occasion/audience/
                                           // theme/purpose/setting/function/scene/product_form/...)
                                           // 不强求统一 4 维度
  
  templates: string[];                     // Etsy 真实长尾构造模板
                                           // 如 ['<style> <product> for <audience>',
                                           //     'personalized <product> with <custom_element>']
  
  examples: string[];                      // 该 type 下真实买家会搜的长尾词例子(3-5 个)
                                           // 教 AI(few-shot,比抽象模板更稳)
  
  thresholds: {                            // niche 准入阈值(按 type 调,不一刀切)
    ctr_min: number;                       // 公益徽章 70%,装饰品 50%
    competition_max: number;
    month_searches_min: number;
  };
  
  variants_count: { min: number; max: number };  // 期望产物词数(每 type 不同)
  
  niche_red_ocean_blacklist: string[];     // 该 type 内不许出现的红海词
                                           // 如 seasonal_holiday 黑名单含 christmas/halloween/valentine
                                           // 但 awareness_pin 不需要这些黑名单
}
```

##### 6.1.3.2 完整 registry(25 个 type)

```ts
const NICHE_TYPE_REGISTRY_IDS = [
  'wedding_engagement',        // 婚礼/订婚物品(标牌/装饰/邀请)
  'jewelry',                   // 首饰
  'apparel_design',            // 服装印花/T恤设计
  'digital_download',          // PNG/SVG/Printable
  'home_decor',                // 家居装饰(壁画/挂毯/摆件)
  'home_organization',         // 家居收纳(浴室/厨房/桌面)
  'stationery_paper',          // 文具(贺卡/笔记本/计划本)
  'awareness_cause',           // 公益议题徽章/T恤
  'pet_products',              // 宠物
  'baby_kids',                 // 婴幼儿
  'beauty_personal_care',      // 美妆/护肤/香薰
  'pop_culture_fandom',        // IP/动漫/影视(注意 IP 风险)
  'botanical_plant_art',       // 植物花卉印刷品
  'seasonal_holiday',          // 节日(各节日红海度不同)
  'fashion_aesthetic',         // 美学风格(y2k/cottagecore/dark academia)
  'collector_subculture',      // 兴趣/收藏(游戏/动漫/运动)
  'spiritual_wellness',        // 灵性/瑜伽/水晶
  'personalized_gifts',        // 定制礼物(对象人群驱动)
  'outdoor_adventure',         // 户外/旅行/露营
  'crafts_supplies',           // 手工原料
  'vehicle_accessories',       // 车饰
  'memorial_funeral',          // 纪念礼/葬礼用品
  'kitchen_dining',            // 厨房/餐具
  'kids_party',                // 儿童派对
  'office_workspace',          // 办公/桌面/工作区
];
```

##### 6.1.3.3 MVP 6 个 type 完整定义(冷启动样板)

剩余 19 个按相同 schema 填充。冷启动数据来源见 6.1.3.4。

```ts
const NICHE_TYPE_REGISTRY: Record<string, NicheType> = {
  wedding_engagement: {
    id: 'wedding_engagement',
    name_zh: '婚礼/订婚物品',
    dimensions: {
      material: ['acrylic', 'wood', 'fabric', 'lace', 'mirror', 'metal'],
      occasion: ['welcome', 'ceremony', 'reception', 'bridal shower', 'engagement party', 'rehearsal'],
      style: ['rustic', 'boho', 'vintage', 'modern', 'minimalist', 'elegant', 'romantic'],
      audience: ['bride', 'couple', 'for her', 'for him'],
    },
    templates: [
      '<style> <product>',
      '<material> <product>',
      '<product> <occasion>',
      'personalized <product>',
    ],
    examples: [
      'lace wedding sign welcome',
      'fabric wedding sign rustic',
      'acrylic wedding sign personalized',
      'modern wedding welcome sign',
    ],
    thresholds: { ctr_min: 60, competition_max: 50_000, month_searches_min: 100 },
    variants_count: { min: 8, max: 15 },
    niche_red_ocean_blacklist: ['wedding decor', 'wedding gift', 'wedding'],
  },

  jewelry: {
    id: 'jewelry',
    name_zh: '首饰',
    dimensions: {
      material: ['silver', 'gold', 'rose gold', 'pearl', 'beaded', 'stainless steel', 'chain'],
      style: ['matching', 'promise', 'adjustable', 'minimalist', 'vintage', 'dainty', 'statement'],
      audience: ['for her', 'for him', 'for couples', 'for mom', 'mother daughter'],
      setting: ['set', 'pair', 'stackable'],
    },
    templates: [
      '<style> <product> <audience>',
      '<material> <product>',
      '<product> set',
      'personalized <product> with <custom>',
    ],
    examples: [
      'matching couple rings set',
      'silver promise rings for couples',
      'dainty gold necklace for her',
      'personalized birthstone necklace',
    ],
    thresholds: { ctr_min: 70, competition_max: 80_000, month_searches_min: 150 },
    variants_count: { min: 8, max: 12 },
    niche_red_ocean_blacklist: ['jewelry', 'necklace', 'earrings', 'rings'],
  },

  digital_download: {
    id: 'digital_download',
    name_zh: '数字下载',
    dimensions: {
      product_form: ['png', 'svg', 'pdf', 'printable', 'digital download', 'cut file'],
      style: ['minimalist', 'vintage', 'modern', 'cute', 'boho', 'watercolor', 'cartoon', 'retro'],
      purpose: ['for tshirt', 'for sublimation', 'for cricut', 'for sticker', 'for vinyl'],
      theme: ['birthday', 'baby shower', 'graduation', 'easter', 'thanksgiving'],
    },
    templates: [
      '<theme> <product_form>',
      '<theme> <product_form> <purpose>',
      '<style> <theme> <product_form>',
    ],
    examples: [
      'graduation png for sublimation',
      'cute easter png cut file',
      'vintage thanksgiving svg for cricut',
      'baby shower printable minimalist',
    ],
    thresholds: { ctr_min: 50, competition_max: 100_000, month_searches_min: 100 },
    variants_count: { min: 8, max: 15 },
    niche_red_ocean_blacklist: ['christmas png', 'halloween png', 'valentine png', 'png', 'svg'],
  },

  awareness_cause: {
    id: 'awareness_cause',
    name_zh: '公益议题徽章/T恤',
    dimensions: {
      theme: ['autism', 'breast cancer', 'mental health', 'animal welfare', 'environment', 'semicolon', 'lgbtq', 'pride', 'suicide prevention'],
      product_form: ['pin', 'enamel pin', 'sticker', 'shirt', 'tote bag', 'keychain'],
      style: ['minimalist', 'rainbow', 'subtle'],
    },
    templates: [
      '<theme> awareness <product_form>',
      '<theme> <product_form>',
      '<theme> support <product_form>',
    ],
    examples: [
      'autism awareness enamel pin',
      'breast cancer awareness shirt',
      'mental health support sticker',
      'lgbtq pride pin minimalist',
    ],
    thresholds: { ctr_min: 70, competition_max: 30_000, month_searches_min: 200 },
    variants_count: { min: 7, max: 10 },
    niche_red_ocean_blacklist: [],
  },

  home_organization: {
    id: 'home_organization',
    name_zh: '家居收纳',
    dimensions: {
      function: ['electric', 'wall mounted', 'magnetic', 'over the door', 'stackable', 'rotating'],
      material: ['ceramic', 'wood', 'bamboo', 'acrylic', 'metal', 'rattan'],
      scene: ['bathroom', 'kitchen', 'bedroom', 'desk', 'closet', 'entryway'],
      style: ['minimalist', 'boho', 'modern', 'farmhouse', 'industrial'],
    },
    templates: [
      '<function> <product>',
      '<material> <product> <scene>',
      '<style> <product> <scene>',
    ],
    examples: [
      'wall mounted toothbrush holder',
      'ceramic toothbrush holder minimalist',
      'magnetic key holder entryway',
      'bamboo bathroom organizer',
    ],
    thresholds: { ctr_min: 70, competition_max: 50_000, month_searches_min: 300 },
    variants_count: { min: 6, max: 10 },
    niche_red_ocean_blacklist: ['home decor', 'organizer'],
  },

  seasonal_holiday: {
    id: 'seasonal_holiday',
    name_zh: '节日季节性',
    dimensions: {
      sub_holiday: [
        // 主流红海节日不准当 variant,见 niche_red_ocean_blacklist
        // 这里只放可切的小众节日
        'juneteenth', 'st patricks day', 'cinco de mayo', 'fathers day',
        'grandparents day', 'teachers day', 'earth day', 'memorial day',
        'labor day', 'veterans day', 'mothers day',
      ],
      product_form: ['shirt', 'mug', 'sign', 'tote', 'card', 'sticker', 'png'],
      audience: ['for mom', 'for dad', 'for grandma', 'for teacher', 'for friend'],
    },
    templates: [
      '<sub_holiday> <product_form>',
      '<sub_holiday> gift <audience>',
      '<sub_holiday> <product_form> <audience>',
    ],
    examples: [
      'mothers day gift for grandma',
      'fathers day shirt personalized',
      'teachers day mug',
      'juneteenth shirt',
    ],
    thresholds: { ctr_min: 60, competition_max: 100_000, month_searches_min: 500 },
    variants_count: { min: 7, max: 12 },
    niche_red_ocean_blacklist: ['christmas', 'halloween', 'valentine', 'thanksgiving', 'easter'],
  },
};
```

##### 6.1.3.4 冷启动 + 反馈循环

**冷启动**(MVP 上线时怎么填):
1. **Etsy 头部 listing 词频统计**:每个 niche_type 对应类目抓 Top 100 listing,ngram 统计高频 2-4 词组合 → 自动产出 dimensions / examples
2. **LLM 辅助补 templates**:输入"这是 X 类目,根据这些 examples 抽出 3-5 个长尾词构造模板"
3. **人工 review**:运营 / 选品师过一遍 dimensions 词库,删错的(如 jewelry 库里不该有 fabric)、补漏的(如 awareness_cause 漏了 hiv 议题)
4. **MVP 先填 6 个**:wedding_engagement / jewelry / digital_download / awareness_cause / home_organization / seasonal_holiday 上线足够覆盖 80% 选品场景,剩 19 个按需补

**反馈循环**(产品长期壁垒):
每次 ④ Bulk 验真后,把 variants 实际表现回流到 type:
- A/B 级通过的 variant → 加权进 `type.examples`
- D 级(淘汰)的 variant 形态 → 进 `type.niche_red_ocean_blacklist`(如果属于同 type 的红海)
- 跑 50 轮后,registry 沉淀出**经 ④ 验证的 Etsy 长尾词知识库** —— 这是产品长期护城河

文件位置:`src/lib/etsy-erank/niche-types/<type-id>.ts`(一 type 一文件,便于按 type 独立迭代)。

#### 6.1.4 第 3 层 — AI System Prompt

```
角色:Etsy 选品分析师助手。
任务:把已预筛 + 已打分的候选词,聚类 + 补长尾,产出 ≤120 词清单。

# 输入(经 code 处理后)

- candidates:每条含 keyword/source/month_searches/ctr/competition/change/core_potential_score
  candidates 已经按 score 降序排好,前面的更值得关注
- user_direction:类目方向数组(可为 [])
- modifier_library:可用修饰词库(material/occasion/style/audience 四维度)

# 工作流

1. 聚类:语义相近的合 niche。**目标 8-12 个 niche**。
   - 同一物理产品类型 + 不同应用场景 = 不同 niche(婚礼标牌 vs 订婚标牌)
   - 同类型 + 不同材质/风格 = 同 niche 内 variant
   - niche 准入(按 niche_type 自己的 thresholds 判,不一刀切):
     - 候选 ≥ 2 → 直接成 niche
     - 候选 = 1 且 该候选的数据满足该 niche_type.thresholds(ctr_min / competition_max / month_searches_min)→ **允许成 niche**
     - 不满足 → 放 outliers
   - **不同 type 阈值不同**:awareness_cause 要 CTR≥70%;digital_download 允许 CTR≥50%;
     home_organization 要 month_searches≥300。具体见 NICHE_TYPE_REGISTRY 6.1.3

2. 选 core:候选 ≥ 2 时挑 core_potential_score 最高的;候选 = 1 时即该候选当 core
   - core 必须是 candidates[].keyword 的原文,逐字符匹配

3. 识别 broad_subordinates:同 niche 内,若某词是另一 core 的修饰前缀(即另一 core = 该词 + 1 个修饰),
   放到 broad_subordinates,不当 core

4. **给每个 niche 分配 niche_type_id**(从 25 个 type 里选):
   - 看 core 的产品形态和语义,从 NICHE_TYPE_REGISTRY 选最匹配的 type
   - 例:`lace wedding sign` → `wedding_engagement`;`autism pin` → `awareness_cause`;
        `frutiger aero` → `digital_download`(因为 core 是美学风格,Etsy 上主要出现在 PNG/印花商品);
        `mothers day gift` → `seasonal_holiday` 或 `personalized_gifts`(看哪个 type 的模板更贴);
        `toothbrush holder` → `home_organization`
   - 找不到合适 type → 标 'other'(下轮 review 补 type)

5. 补长尾(按 type 模板和词库构造,**不再 mode A/B 二选一**):
   - 从 `type.dimensions` 取词,按 `type.templates` 的组合形式生成 variants
   - 期望产物数量 = `type.variants_count.min ~ max`
   - 每条 variant 必须满足 type.templates 中至少一种模式
   - **variants 不得字面包含 type.niche_red_ocean_blacklist 中的任何词**
     (例:digital_download niche 不许生成 `christmas png`、`halloween png`)
   - variants 字面不得等于 candidates 里任何词
   - 借鉴 `type.examples` 的风格,让 variants 像真实 Etsy 买家会搜的串

6. 季节性:**仅在 keyword 含明确时点词(christmas/halloween/valentine/4th of july/mothers day 等)
   时标 seasonal:<月份>**;否则 evergreen;不确定标 unknown

7. **长期信号校验**(交叉验证 Trend Buzz 上涨词的真实性):
   - 对每个 niche 的 core,查 candidates 里 Monthly Trends 来源的词有没有同主题/同物理类型
   - 有 → 长期稳定,priority 升 1 档(最高到 1),rationale.evidence_intent 标"长期顶部 + 短期上涨"
   - 没有 → 早信号未验证,priority 保守 2-3,rationale.evidence_intent 标"早信号待 ④ 验证"

8. priority(综合):
   - user_direction 非空 + 能对接 = 1;边缘对接 = 2;无关 = 3
   - user_direction = [] → 由长期信号校验主导

9. 总量目标 60-120(实际由各 niche 的 type.variants_count 累加得到,宁少不滥)

# rationale(50-80 字,3 个 evidence 字段必填)

- evidence_competition:引用 candidates 里字面匹配的竞争数字
- evidence_intent:引用 CTR / 月搜
- evidence_capability_match:若 user_direction 非空,说明对接关系;否则 "无方向约束"

# 禁止

- 不发明候选池里没出现过的新方向
- 不输出 month_searches/ctr/competition/kd 等数字字段
  rationale 里引用数字时必须字面匹配 candidates(允许变单位但不丢精度;12852273→1285w 可,60809→6w 不可)
- 不在 JSON 外附任何自然语言,不用 markdown code fence
```

#### 6.1.5 Few-shot example(嵌入 prompt)

```
# ✅ 你应该这样

candidates 节选:
- lace wedding sign (core_potential_score: 85, competition: 621)
- fabric wedding sign (score: 65, competition: 3199)
- wedding sign (score: 20, competition: 40670)
- engagement sign (score: 40, competition: 39734)

正确输出:
{
  "clusters": [{
    "name": "婚礼标牌",
    "niche_type_id": "wedding_engagement",
    "core": "lace wedding sign",
    "broad_subordinates": ["wedding sign"],
    "variants": [
      "lace wedding sign welcome",
      "lace wedding sign rustic",
      "lace wedding sign acrylic",
      "lace wedding sign personalized",
      "lace wedding sign minimalist",
      "lace wedding sign bridal shower",
      "modern lace wedding sign",
      "lace wedding sign elegant"
    ],
    ...
  }]
}

# ❌ 你不该这样

❌ core: "wedding sign"          → 单个类目根词,应进 broad_subordinates
❌ variants: ["lace wedding sign rustic boho"]    → 堆了 2 个修饰
❌ variants: ["fabric wedding sign"]              → 这本身是 candidate,零增量
❌ variants: ["lace wedding sign aesthetic"]      → "aesthetic" 不在 modifier_library
❌ rationale: "这是个绝佳的市场机会"               → 营销文案,没数据证据
```

#### 6.1.6 JSON Schema strict mode

调用 LLM API 时通过 `response_format: { type: 'json_schema', schema: ... }` 强约束:

```ts
const schema = {
  type: 'object',
  required: ['clusters', 'outliers', 'total_keywords'],
  additionalProperties: false,
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'niche_type_id', 'core', 'rationale', 'variants', 'priority', 'seasonality', 'broad_subordinates', 'core_evidence_from_input'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          niche_type_id: { type: 'string', enum: NICHE_TYPE_REGISTRY_IDS.concat(['other']) },
          core: { type: 'string' },
          core_evidence_from_input: { type: 'array', items: { type: 'string' } },
          broad_subordinates: { type: 'array', items: { type: 'string' } },
          variants: { type: 'array', minItems: 6, maxItems: 15, items: { type: 'string' } },
          rationale: {
            type: 'object',
            required: ['evidence_competition', 'evidence_intent', 'evidence_capability_match'],
            properties: {
              evidence_competition: { type: 'string' },
              evidence_intent: { type: 'string' },
              evidence_capability_match: { type: 'string' },
            },
          },
          seasonality: { type: 'string', pattern: '^(evergreen|unknown|seasonal:[A-Z][a-z]+)$' },
          priority: { type: 'integer', enum: [1, 2, 3] },
        },
      },
    },
    outliers: { type: 'array', items: { type: 'string' } },
    total_keywords: { type: 'integer', minimum: 1, maximum: 120 },
  },
};
```

#### 6.1.7 第 4 层 — code 校验 + 自动修剪

```ts
function validateAndPrune(out: AiOutput, candidates: Seed[]): AiOutput {
  const candidateKeys = new Set(candidates.map((c) => c.keyword));

  for (const c of out.clusters) {
    // 1. core 必须在 candidates 里原文匹配
    if (!candidateKeys.has(c.core)) {
      throw new ValidationError(`core 不在 candidates: ${c.core}`);
    }

    // 2. variants 不得字面等于任何 candidate
    c.variants = c.variants.filter((v) => !candidateKeys.has(v));

    // 3. 取该 niche 对应的 niche_type
    const type = NICHE_TYPE_REGISTRY[c.niche_type_id];
    if (!type && c.niche_type_id !== 'other') {
      throw new ValidationError(`未知 niche_type_id: ${c.niche_type_id}`);
    }

    if (type) {
      // 4. variants 不得字面包含 type.niche_red_ocean_blacklist 任何词(防红海偷渡)
      c.variants = c.variants.filter((v) => {
        const lower = v.toLowerCase();
        return !type.niche_red_ocean_blacklist.some((bad) => lower.includes(bad.toLowerCase()));
      });

      // 5. variants 词数检查
      if (c.variants.length < type.variants_count.min) {
        throw new ValidationError(
          `${c.core} (${type.id}) variants 不足 ${type.variants_count.min}`,
        );
      }
      c.variants = c.variants.slice(0, type.variants_count.max);

      // 6. variants 修饰词应来自 type.dimensions(警告级,可宽松)
      // 此处只作日志,不 reject —— Etsy 真实长尾不一定 100% 在 dimensions 里
    }
  }

  // 7. total_keywords 自洽
  out.total_keywords = out.clusters.reduce((n, c) => n + 1 + c.variants.length, 0);
  if (out.total_keywords > 120) throw new ValidationError('超 120');
  if (out.total_keywords < 60) {
    // 警告,不 reject(候选池太稀疏时合理)
    console.warn(`总词数 ${out.total_keywords} 低于目标下限 60`);
  }
  return out;
}
```

严重违规(core 不在 candidates / variants 不足 3 / 超 120)→ throw → 自动重跑,把上一次违规作为反例追加进 prompt(self-correcting loop)。
轻度违规(variants 字面重复 / 堆修饰 / 修饰不在库)→ code 直接修剪。

#### 6.1.8 完整产物管线

```
seeds(② 抓的 100+)
  → preFilter(code) → candidates + rejected_by_code
  → scoreCorePotential(code) → candidates 按 score 排序
  → LLM Stage 1 (JSON Schema strict, few-shot example, NICHE_TYPE_REGISTRY 全量喂入)
        - 聚类成 niche
        - 每 niche 分配 niche_type_id
        - 按 type 准入门槛判孤词
        - 按 type 模板/词库补 variants
        - 长期信号校验 + priority
     → raw_output
  → validateAndPrune(code,按 type 校验) → 修剪 / reject 重跑
  → 合并 rejected_by_code 与 out → 最终 ③ 步产物
  → ④ 验真后反馈 → niche_type registry 持续优化(A/B 通过的 variant 形态加权进 type.examples,
                                                 D 级淘汰的进 type.niche_red_ocean_blacklist)
```

UI 展示:
- ③ 步主区:clusters 列表(name / niche_type_id 徽章 / core / variants),展开看 rationale + broad_subordinates
- ③ 步右抽屉:rejected 列表(可审计 — 每条带 reason + stats)
- niche_type registry 管理页(运营):查看/编辑 dimensions / templates / blacklist,看反馈累计的 examples 效果

### 6.2 ⑤ AI 打分步骤完整契约

**实际是"AI 解读 + 风险标注",不是打分**(grade 由 ④ code 按 SOP §3.2 算定,LLM 不碰)。LLM 把 ④ 的英文 keyword + 冰冷 metrics 翻译成"做什么产品 / 为啥是机会 / 有啥坑"。

#### 6.2.1 流程

```
④ 真实 metrics(A/B/C/drop) + ① user_direction
  ↓ code: 过滤 drop,按 seed 聚合,算 input_hash 比对 cache
  ↓ LLM(按 seed 分组并行,只跑增量 niche)
  ↓ code 后置:JSON Schema strict 校验 + niche-level stats 计算
  ↓ state-llm.json cache 写回
  ↓ 输出:50 niche × niche_summary + 134 candidates × productGuess/rationale/risks
```

#### 6.2.2 死守边界(不让 AI 越界做的事)

| ✗ 不做 | 原因 |
|---|---|
| 重算 grade / 创造新 grade 层级 | SOP §3.2 硬规则,code 已算定,LLM 守界 |
| 算 niche_priority 1-5 排序 | 决策权在用户,⑤ 给事实 + 解读,UI 多维度排序由用户挑 |
| rationale 数字字面校验 ±N% | 信任 LLM + ⑥ 验证兜底,code 不做无用功 |
| niche_type registry / pace_type 字段 | 跟 ③ 一样砍 |
| 硬编码 IP / 季节 / 趋势 词表 | LLM 凭训练知识识别,小众词标 confidence=low |
| productGuess 重复 niche 主词 | 信息密度,只写差异化补充 |
| risks 替用户决策("不要做") | 客观陈述 + 给"做的话怎么破局",决策权交回 |
| 臆造 Unknown / `<20` metrics 数字 | 保留原字符串,rationale 标"数据缺失需 ⑥ 严格验证" |

#### 6.2.3 输入数据形态

```ts
interface ScoreInput {
  user_direction: string[]; // ① 圈猎场用户填的能力清单,blank_slate 时空数组
  market: { country: string; platform: string };
  
  // 按 seed 分组,只送 A/B/C(drop 不送)
  niches: Array<{
    seed: string;
    candidates: Array<{
      keyword: string;
      grade: 'A' | 'B' | 'C';     // ④ code 已算
      sources: string[];           // 'B' / 'C' / 'seed' 任意组合
      metrics: {
        searches: string;          // '463' / 'Unknown' / '< 20'(原样,不臆造)
        clicks: string;
        ctr: string;               // '102%' / 'Unknown'
        competition: string;       // '1,488' / 'Unknown'
        kd: string;                // 0-100
        google: string;            // 站外热度
      };
    }>;
  }>;
}
```

#### 6.2.4 System Prompt(完整)

```
角色:Etsy 选品分析师助手。
上下文:用户已经跑完 ②抓种子 + ③Etsy 真实扩词 + ④Bulk 验真,现在要从产物里挑 2-3 个 niche 上货。
任务:帮用户解读每个 niche 的机会、风险、产品方向 + 给立项建议。

# 你做(且只做)6 件事(niche 级 2 件 + candidate 级 4 件)

## niche 级(每 niche 输出 1 次)

1. niche_summary(100-150 字)
   - 战略总结:这 niche 是什么 + 整体机会 + 主要风险
   - 引用 stats(A 级数 / 顶 A 月搜)作证据

2. niche_risks(数组,字符串)
   - 客观陈述事实 + 风险条件 + 破局建议
   - 例: "monster high 是 Mattel IP,做衍生需先确认授权或仅做 fan art 边缘款"
   - 不写"不要做" / "避免做" 这种祈使句,决策权在用户

## candidate 级(niche 内每条 candidate 各输出 1 次)

3. productGuess(中文,简短)
   - 对应做什么具体产品
   - **不重复 niche_summary 已说的**,只写差异化补充
   - 例: ita bag(niche 主词)→ "主词 / 透明窗口痛包"
        ita bag accessories → "配件:链条/挂饰/扣环"

4. rationale(50-80 字)
   - 同时含机会 + 主要风险(不让用户漏看 risks 数组)
   - 引用 metrics 真实数字(允许变单位但不丢精度)
   - 例: "月搜 29,998 + KD 1 + 竞争 3,977 — 顶级金矿;痛包文化全球扩散,Etsy 供给严重不足"

5. confidence(enum)
   - high:LLM 训练数据里有这词(autism pin / ita bag / frutiger aero)
   - medium:半懂(katana 知道但 Etsy 销售形态不熟)
   - low:完全陌生(vantastiks / oxalis 这种小众词)
   - low 时用户需上网查证,UI 警示色

6. nextStep(中文,简短建议)
   - 例: "立即进 ⑥ 人工验证" / "先查 IP 授权" / "2-4 周内必须上 listing" / "仅做标题副词"

# 语言

- productGuess / rationale / niche_summary / niche_risks / nextStep → **中文**
- keyword / seed → **英文原文保留**(SEO 用,不翻译)

# 输出格式

**直接返回 JSON 对象,不要 markdown code fence,不要 JSON 外的任何文字**

# 用户能力上下文

user_direction = {user_direction}
  - 非空时:LLM 偏向打分能对接的 niche,rationale 提及对接关系
  - 空数组时:纯按数据 + 全局意义判断,不强行对接
```

#### 6.2.5 JSON Schema(分两层)

**Layer A · LLM raw 输出 schema**(strict,API `response_format` 用):

```ts
const llmOutputSchema = {
  type: 'object',
  required: ['niches'],
  additionalProperties: false,
  properties: {
    niches: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['seed', 'niche_summary', 'niche_risks', 'candidates'],
        additionalProperties: false,
        properties: {
          seed: { type: 'string' },
          niche_summary: { type: 'string', minLength: 100, maxLength: 180 },
          niche_risks: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', maxLength: 200 },
          },
          candidates: {
            type: 'array',
            maxItems: 30,
            items: {
              type: 'object',
              required: ['keyword', 'productGuess', 'rationale', 'confidence', 'nextStep'],
              additionalProperties: false,
              properties: {
                keyword: { type: 'string' },
                productGuess: { type: 'string', minLength: 5, maxLength: 80 },
                rationale: { type: 'string', minLength: 50, maxLength: 100 },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                nextStep: { type: 'string', maxLength: 100 },
              },
            },
          },
        },
      },
    },
  },
};
```

**Layer B · 最终产物 schema**(LLM raw + code 后置算的 stats,UI 消费):

```ts
const finalSchema = {
  // 继承 LLM raw 全部字段
  // 每个 niche 多一个 stats 字段(code 后置加,非 LLM 输出)
  niche.stats: {
    a_count: number,        // 该 niche 内 grade=A 的候选数
    b_count: number,
    c_count: number,
    top_a_searches: number, // 顶 A 月搜(整数,从 metrics 解析)
    top_a_keyword: string,  // 顶 A 是哪个词
    median_kd: number,
    risks_count: number,    // = niche_risks.length
  },
};
```

LLM 不能输出 stats(算数易错);stats 由 code 后置基于 ④ metrics + LLM 的 niche_risks 计算。

#### 6.2.6 Cache 机制 + 失败处理

`tmp/erank-score/state-llm.json`:

```json
{
  "niche_outputs": {
    "ita bag": {
      "input_hash": "<sha256>",
      "niche_summary": "...",
      "niche_risks": [...],
      "candidates": [...],
      "stats": {...},
      "ranAt": "2026-05-21T..."
    }
  },
  "failed_niches": {
    "vantastiks": {
      "lastErrorAt": "2026-05-21T...",
      "errorMessage": "JSON schema validation failed",
      "retryCount": 1
    }
  },
  "last_run": "2026-05-21T..."
}
```

**input_hash 算法**(确定性,候选/方向顺序变化不影响):

```ts
import { createHash } from 'node:crypto';

function inputHash(seed: string, candidates: Candidate[], user_direction: string[]): string {
  // candidates 按 keyword 字典序排序后只哈"打分相关"字段
  // sources 不参与 hash(扩词来源变化不影响打分逻辑)
  const sortedCands = candidates
    .map((c) => ({
      keyword: c.keyword,
      grade: c.grade,
      metrics: c.metrics, // searches/clicks/ctr/competition/kd/google
    }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword));
  const payload = JSON.stringify({
    seed,
    candidates: sortedCands,
    user_direction: [...user_direction].sort(),
  });
  return createHash('sha256').update(payload).digest('hex');
}
```

**每次 ⑤ 跑流程**:
1. 对每个 seed 算 input_hash
2. 跟 cache.niche_outputs[seed].input_hash 比对
3. hash 一致 → 复用 LLM 输出,不调 LLM
4. hash 不一致(④ 新跑了几条 / 用户改了 user_direction)→ 只重跑该 niche
5. cache 命中率高时,跑增量,不烧重复 token

**单 batch 失败处理**(不阻塞其他):

```
LLM API 返回错误 / Schema validation 失败:
  → 该 batch 内 niches 写入 state.failed_niches
  → 其他 batch 继续跑
  → 不抛错让整个 ⑤ 失败

下次 ⑤ 触发时:
  → 优先重试 state.failed_niches(retryCount++)
  → retryCount > 3 时弃,UI 提示"该 niche LLM 解读多次失败,可手动重试或跳过"
```

**多 batch 合并**:

```ts
const result = { niches: batches.flatMap(b => b.niches) };
// 同 seed 不应该跨 batch(单 batch 内已经唯一),但若发生:后者覆盖前者(用 Map dedupe)
const dedupe = new Map<string, NicheOutput>();
for (const n of result.niches) dedupe.set(n.seed, n);
result.niches = [...dedupe.values()];
```

#### 6.2.7 code 后置处理

```ts
// 1. JSON Schema strict 校验(API 层 response_format)
// 2. 算 niche-level stats(用户多维度排序用)
function buildNicheStats(input, output) {
  for (const niche of output.niches) {
    const inputNiche = input.niches.find((n) => n.seed === niche.seed);
    niche.stats = {
      a_count: inputNiche.candidates.filter((c) => c.grade === 'A').length,
      b_count: inputNiche.candidates.filter((c) => c.grade === 'B').length,
      c_count: inputNiche.candidates.filter((c) => c.grade === 'C').length,
      top_a_searches: Math.max(
        ...inputNiche.candidates
          .filter((c) => c.grade === 'A')
          .map((c) => parseInt(c.metrics.searches.replace(/,/g, '')) || 0),
      ),
      risks_count: niche.niche_risks.length,
    };
  }
}

// 3. 默认排序(UI 可切其他):a_count 降序 → top_a_searches 降序
output.niches.sort((a, b) => 
  b.stats.a_count - a.stats.a_count ||
  b.stats.top_a_searches - a.stats.top_a_searches
);
```

#### 6.2.8 UI 展示

- ⑤ 主区:niche 列表(seed + niche_summary 折叠 + stats 徽章 + 风险数量 + confidence 警示)
- 多维度排序按钮:`A数 ↓ / 顶A月搜 ↓ / KD最低 ↑ / 风险最少 ↑`
- 多维度筛选:`□ 无 IP 风险 / □ 无季节性 / □ 月搜>1k / □ KD<30`
- niche 展开后看 candidates 列表(productGuess / rationale / risks 内联)
- confidence=low 用警示色 + "需上网查证"提示

#### 6.2.9 入口/调用时机 + 跑前 dry-run

**入口**:不自动触发(烧 $2-3 LLM 费用,不该 auto)。

| 模式 | 触发点 | 范围 |
|---|---|---|
| **全量跑** | 用户在 ⑤ 步点 `跑 AI 解读` 按钮 | 全部有 A/B/C 的 niche(用 cache 命中跳过已跑) |
| **单 niche 解读** | 用户在某 niche 卡片点 `单独跑 LLM` | 只跑该 niche,只烧 ~$0.05 |
| **重试失败** | 用户点 `重试失败 niche` | 跑 state.failed_niches 里的(retryCount<3) |

**跑前 dry-run**(防止用户误触发烧钱):

1. code 算预期 token:
   - 输入 token = candidates_count × ~50 + niche_count × ~30 + system_prompt(~800)
   - 输出 token = niche_count × ~250 + candidates_count × ~80
2. 算成本:`output_token * $75/M + input_token * $15/M`(Claude opus 4.7 价格)
3. UI 弹"知情确认"对话框:
   ```
   ┌ 跑 AI 解读 ─────────────────────┐
   │ 50 个 niche,134 个候选词        │
   │ 预计 ~12k input + ~16k output   │
   │ 估算成本:$1.40                   │
   │ 预计耗时:2-3 分钟                │
   │ [取消]  [开跑]                   │
   └─────────────────────────────────┘
   ```
4. 用户点"开跑"才真调 LLM
5. 命中 cache 的不算成本(已跑过 niche 不重复)

#### 6.2.10 验收口径

| 阶段 | 达标 |
|---|---|
| 输入过滤 | drop 全部过滤掉,只有 A/B/C 进 LLM |
| LLM 输出格式 | 严格 JSON,不带 markdown fence |
| 守界 | LLM 不改 grade,不算 niche_priority,不替用户决策(无"不要做"句式) |
| 数据完整性 | Unknown / `<20` 保留原字符串,不臆造数字 |
| confidence 标注 | 小众/陌生词必须标 low,有 UI 警示 |
| Cache 增量 | 数据未变的 niche 不重新调 LLM |
| 决策权 | UI 提供多维度排序/筛选,⑤ 不强制 priority |

## 7. eRank / AdsPower 接入约束(SOP §5)

- eRank 登录态在 AdsPower 指纹浏览器,非普通 Chrome。`AdsPowerExecutor` 跑前必须确认对应 profile 已启动,否则 ② `failed`:「未登录,重开已登录 profile 再跑」。
- **profile id 不写死仓库**(SOP §5.5):做成应用设置项,默认空;未配置且选了自动执行器→轮级态 `not_configured`,显式提示。
- listing 文案用 eRank 自带 AI Listing Helper,**不在本应用范围**(SOP §5.4)。

## 8. Demo 设计(已确认)

7 屏:`雷达轮次` · `当前轮(心脏)` · `机会表` · `人工验证` · `产品brief` · `配额台账` · `设置`。
心脏屏布局已定:**纵向流水线 stepper**(线性 SOP 天然契合,闸门「卡住」一眼可见)。

### 8.1 雷达轮次列表

```
┌ Etsy eRank 选品雷达 ───────────────────── 配额 2026-05: 137/200 ┐
│ [雷达轮次] 当前轮 机会表 人工验证 产品brief 配额台账 设置        │
├────────────────────────────────────────────────────────────────┤
│  + 新开一轮                                                      │
│  OPP-雷达-2026-05   进行中·④验真(等配额)   种子38 候选112       │
│  起点:有能力/方向 · 执行器:粘贴   05-19 10:22         [打开]    │
│  OPP-雷达-2026-04   已完成   机会 A2 B3 C5   立项 2    [打开]    │
│  起点:完全没想法 · 跳过①                                        │
│  OPP-雷达-2026-03   失败·④字段漂移   [查看] [转粘贴重跑]         │
└────────────────────────────────────────────────────────────────┘
```

点 `+ 新开一轮` 弹出入口选择(决定本轮 `entry_mode`,后续不可改):

```
┌ 新开一轮 ─────────────────────────────────────────────┐
│ 标签 [OPP-雷达-2026-05________________]                │
│ 这轮的起点(决定是否跑 ① 圈猎场):                       │
│ (•) 我有能力/方向                                      │
│     能力清单(逗号分隔,喂给 ① 圈猎场 AI):               │
│     [vinyl 贴纸, POD 印花, 激光木牌__________]         │
│     → ① 圈猎场 AI 据能力映射 3–5 个类目;② 按类目下钻    │
│ ( ) 我完全没想法                                       │
│     → 跳过 ①(step_states.①=skipped);                   │
│       ② 直接抄 Trend Buzz / Monthly Trends 顶部(全类目) │
│ 执行器(影响 ②④,可中途切)  (•)粘贴  ( )AdsPower         │
│                              [取消]  [开始本轮]        │
└────────────────────────────────────────────────────────┘
```

### 8.2 当前轮 — 6 步 stepper(心脏)

**`with_capability` 模式(起点:我有能力/方向):**

```
OPP-雷达-2026-05 · 起点:有能力/方向 · 执行器:粘贴 ▾ · 配额 137/200

① 圈猎场    ✓ 3 方向:婚礼牌 / 贴纸 / 木牌            [查看]
│
② 采种子    ✓ 196 种子(Trend Buzz 96 / Monthly Trends 100,脚本真抄)
│   ┌ Trend Buzz · 96 词 · 早信号(每日上涨)──────────────────────┐
│   │ # 关键词           Change  月搜    CTR    竞争              │
│   │ 1 pokemon          ↑223    57,760  136%   143,307           │
│   │ 2 jewelry          ↑320    60,809  117%   12,852,273        │
│   │ 4 png              ↓1      24,661  129%   5,548,796         │
│   │ 14 wall art        ↑8      65,870  108%   892,154           │
│   │ 43 mom quotes shirt -      Unknown Unknown 72,404            │
│   └──────────────────────────────────────────────────────────────┘
│   ┌ Monthly Trends · 100 词 · 15 月历史(辨季节/昙花)───────────┐
│   │ # 关键词           15月均搜   本月样式                       │
│   │ 1 shirt            71,867    Apr 2026 / 114,920             │
│   │ 4 mothers day      11,250    Apr 2026 / 62,870              │
│   │ 23 fabric wedding sign  309  Apr 2026 / 12,400              │
│   └──────────────────────────────────────────────────────────────┘
│   按列名映射(SOP §6.2 字段漂移防护);CTR=Unknown 为死词,留给 ③ 去重
│
③ AI 收敛   ✓ 112 词  ≤120 ✓  · 8 簇 × 14 修饰
│   预览前 8 个:lace wedding sign, fabric wedding sign,
│              custom wedding sign, engagement sign, ...
│   [展开完整 112 词清单 ▾](点开后是 3 列可滚动 ol,带序号)
│
④ Bulk 验真 ● 等配额闸
│   1 复制收敛清单(112 词,≤余额 137 ✓)        [复制 112 词]
│   2 去 eRank → Bulk Keyword Tool 跑 → 导出 CSV
│   3 粘贴/拖入导出(按列名映射,不按位置):
│     ┌────────────────────────────────────────────┐
│     │ keyword,searches,clicks,ctr,competition,kd,…│
│     └────────────────────────────────────────────┘
│     [解析并回灌]  已识别 0/112  缺列告警:—
│   ⚠ 解析后才扣配额;字段漂移→失败+可重试,不静默
│
│   ✓ done 后:展示 keyword_metrics 全列表(不准只一行"已回灌"):
│   ┌ keyword_metrics(7 词)──────────────────────────────────────┐
│   │ 关键词                月搜 月点 CTR    竞争     KD 趋势      │
│   │ lace wedding sign     363  221  61%    621      12 5月单峰   │
│   │ fabric wedding sign   309  312  101%   3,199    51 多月稳    │
│   │ custom wedding sign   1029 1286 125%   134,487  100 稳        │
│   │ romantic wedding      <20  0    Unknown 126,900 100 跌        │
│   │ sheer wedding sign    <20  0    Unknown 62      66 平         │
│   └──────────────────────────────────────────────────────────────┘
│   ⑤ AI 打分只读这张表;CTR=Unknown / 点击≈0 / 竞争>10万 / KD=100 任一即淘汰
│
⑤ AI 打分   ○ 待跑 · 依赖 ④
│
⑥ 人工验证  ○ A/B 级生成验证卡,需人填(AI 不可代填)
└
```

**`blank_slate` 模式(起点:我完全没想法)— ①② 差异如下,③④⑤⑥ 同上图:**

```
OPP-雷达-2026-06 · 起点:完全没想法 · 执行器:粘贴 ▾ · 配额 200/200

① 圈猎场    ⊝ 跳过(本轮起点:完全没想法)            [关于此选择]
│
② 采种子    ● 抄市场顶部热词(不限类目)
│   去 eRank → Trend Buzz / Monthly Trends 顶部 → 抄词不动脑
│   [粘贴种子词] 已收 0 词
│
③④⑤⑥ ……(同 with_capability 视图)
```

执行器下拉(只影响 ②④,③⑤⑥ 不变,可中途切):

```
执行器 ▾
 (•) 粘贴 / CSV 导入   最稳,人在 eRank 操作回灌
 ( ) AdsPower 自动     后台驱动 eRank(需配 profile)
```

④ 在 AdsPower 执行器下的两种态:

```
④ Bulk 验真 ● 运行中 · AdsPower(后台)
│ profile k1ck97si「内地」· 已连 CDP · 进度 64/112
│ [查看日志]  [中止并转粘贴接管]
│ 注:后台跑不抢当前界面;断连不关窗;不调 stop
```
```
④ Bulk 验真 ⨂ 未配置 · AdsPower
│ 未设置已登录 eRank 的 profile
│ [去设置配置]   或   [本轮改用粘贴]
```

### 8.3 机会表 + 内联证据链/验证卡

```
档 机会词              月搜 竞争 KD  CTR 趋势   时机
A  lace wedding sign   363  621  12  61% 5月单峰 [展开▾]
 └ 证据链(keyword_metrics 真实行):月搜363 竞争621 KD12 …
   为什么是缺口:有需求、几乎无竞争、极易排
   ▶ 人工验证卡(待人填)
B  fabric wedding sign 309 3199  51 101% 多月稳  [展开▾]
C  custom wedding sign 1029 134k 100 125% 仅标题副词
✗  sheer wedding sign  <20  62   66 Unk  淘汰:低竞争陷阱
```

### 8.4 人工验证页(A/B 级工作台,与机会表内联同源)

```
┌ 人工验证 · OPP-2026-05 · 待验 2 / 已验 0 ──────────────┐
│ ▾ A  fabric wedding sign       验证中                   │
│   竞品集中度 ( )过 ( )否   多家可见,头部未锁死          │
│   价格带     ( )过 ( )否   目标售价有合理中位带          │
│   图片差异化 ( )过 ( )否                                 │
│   评论痛点   ( )过 ( )否                                 │
│   交付风险   ( )过 ( )否                                 │
│   利润空间   ( )过 ( )否   扣费后 ≥30%?                  │
│   竞品ID/链接[__] 价格带[__] 备注[____]                  │
│   verdict: ( )过 ( )否 ( )证据不足      [保存验证卡]     │
│   AI 不可代填;未填 verdict → ⑥ 维持 blocked             │
└────────────────────────────────────────────────────────┘
```

### 8.5 设置页

```
┌ 设置 ──────────────────────────────────────────────────┐
│ AdsPower  profile [k1ck97si ▾]  [测试连接]              │
│           本地 API http://127.0.0.1:50325               │
│           不写死仓库;未配则自动执行器不可用             │
│ 执行器默认 (•)粘贴  ( )AdsPower                          │
│ 配额  月上限[200]  2026-05 已用 137                      │
│ AI 提示词(只读)  ▸①圈猎场 ▸③收敛 ▸⑤打分(硬门槛+ABC)   │
│ 风险边界(只读)  不做:供应链/定价/listing定稿/上新排期   │
└────────────────────────────────────────────────────────┘
```

产物屏 `产品brief`(立项卡)、`配额台账`(扣账流水+月余额)结构平铺,不另画。

## 9. 验收口径(SOP §6.3 映射 + 诚实汇报)

| 阶段 | 达标 |
|---|---|
| 采种子 | 有原始种子,标 source_tool,零配额;`with_capability` 须覆盖 `huntground` 全部类目,`blank_slate` 须含 Trend Buzz / Monthly Trends 顶部样本 |
| 验真 | keyword_metrics 真实数据,按列名映射,扣账正确 |
| 收敛 | ≤120,可直贴,不含编造搜索量 |
| 打分 | 严格按 §3.2,缺数据降级不补数,证据链可点回原始行 |
| 人工验证 | A/B 级有验证卡,AI 不能代填 verdict |
| 失败路径 | 七种失败态都有 reason + 重试动作,不空状态 |
| **数据可见** | **每步采到/产出的真实数据 UI 可见,不准只摘要**:② 必须列种子词表(分源,关键词 + Change + 月搜 + CTR + 竞争);③ 必须能展开看完整 ≤120 词清单(非仅前 8 个 preview);④ done 必须列 keyword_metrics 全列表格(月搜/竞争/KD/CTR/趋势),不准只一行"已回灌 N 词"摘要;⑤ 机会表带证据链(已实现);⑥ 验证卡六项(已实现) |

汇报规则:仅完成数据契约/状态机/提示词/UI 壳 = `部分完成`、`主链未打通`;用户能从 UI 跑完一轮(②人工粘贴亦可)并产出可复盘机会表 = `主链已打通`;两个执行器、配额台账、失败路径、AI 质量都可验收 = `完整完成`。

## 10. 明确不做 / 风险边界

- **不做**:供应链确认、定价定稿、listing 文案定稿、上新排期(SOP §0.1)。
- **不改**:现有 ecommerce 模块及其在跑的 /loop;browser-provider/BrowserManager 等公共浏览器基础设施。
- **高风险**:`AdsPowerExecutor` 对 eRank 反自动化/导出字段漂移天生脆弱 → 始终保留 `PasteExecutor` 兜底;自动失败必转人工可接管,不静默重试烧配额。
