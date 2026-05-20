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
| huntground | ① 圈猎场产物:3–5 个类目方向(JSON) |
| status | 见 §4 步骤状态机的轮级聚合态 |
| step_states | 6 步各自状态(JSON,见 §4) |
| executor_profile | 本轮 ②④ 选用的执行器(paste / adspower) |
| started_at / finished_at | 时间 |
| summary | 本轮摘要 |

### 3.2 seed_terms(采种子)
`source_tool`(Trend Buzz/Monthly Trends/Category Report/Top Sellers)、`keyword`、`category`、`market`、`note`、`run_id`

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

轮次是状态机。每步状态:`pending` / `running` / `blocked` / `done` / `failed`。两个闸门用 `blocked` 表达,**不依赖工作流引擎的 approval 步骤**(该步骤类型当前缺失,本应用自有状态模型持有闸门)。

| 步 | 执行者 | 配额 | 闸门 | 失败态(SOP §6.2) |
|---|---|---|---|---|
| ① 圈猎场 | LLM 执行器 | 0 | — | — |
| ② 采种子 | 可插拔(paste/adspower) | 0 | — | 未登录→重开 profile |
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
| ① 圈猎场 | SOP §3.4 ① | 只列方向,不编搜索数据 |
| ③ 收敛 | SOP §3.4 ③ | 聚类/去重/删大词根/每簇补 3–5 长尾;**总数 ≤120**;输出可直贴 CSV;不给搜索量 |
| ⑤ 打分 | SOP §3.4 ⑤ + §3.2 判定规则 | 硬门槛淘汰 + A/B/C 分级 + 趋势加权;**只用表里数字** |

§3.2 判定规则(应用内固化为打分函数,非提示词软约束):

- **硬门槛(任一即丢)**:月搜<100 / CTR=Unknown 或点击≈0 / 竞争>100,000 / KD=100
- **A 级**:月搜≥150 ∧ 竞争<5,000 ∧ KD<30 ∧ CTR≥80%
- **B 级**:竞争<50,000 ∧ KD<50 ∧ 月搜≥100 ∧ CTR≥80%
- **C 级**:需求强但竞争/KD 拉满 → 仅标题副词
- **趋势**:升/多月稳=加权;单峰=标季节月份;跌=降一级

提示词可在应用设置页查看(透明,不可见即不可信)。

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
│  执行器:粘贴   05-19 10:22                            [打开]    │
│  OPP-雷达-2026-04   已完成   机会 A2 B3 C5   立项 2    [打开]    │
│  OPP-雷达-2026-03   失败·④字段漂移   [查看] [转粘贴重跑]         │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 当前轮 — 6 步 stepper(心脏)

```
OPP-雷达-2026-05 · 执行器:粘贴 ▾ · 配额 137/200

① 圈猎场    ✓ 3 方向:婚礼牌 / 贴纸 / 木牌            [查看]
│
② 采种子    ✓ 38 种子 (TrendBuzz 12 / Monthly 14..)  [查看]
│
③ AI 收敛   ✓ 112 词  ≤120 ✓                  [查看清单/CSV]
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
⑤ AI 打分   ○ 待跑 · 依赖 ④
│
⑥ 人工验证  ○ A/B 级生成验证卡,需人填(AI 不可代填)
└
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
| 采种子 | 有原始种子,标 source_tool,零配额 |
| 验真 | keyword_metrics 真实数据,按列名映射,扣账正确 |
| 收敛 | ≤120,可直贴,不含编造搜索量 |
| 打分 | 严格按 §3.2,缺数据降级不补数,证据链可点回原始行 |
| 人工验证 | A/B 级有验证卡,AI 不能代填 verdict |
| 失败路径 | 七种失败态都有 reason + 重试动作,不空状态 |

汇报规则:仅完成数据契约/状态机/提示词/UI 壳 = `部分完成`、`主链未打通`;用户能从 UI 跑完一轮(②人工粘贴亦可)并产出可复盘机会表 = `主链已打通`;两个执行器、配额台账、失败路径、AI 质量都可验收 = `完整完成`。

## 10. 明确不做 / 风险边界

- **不做**:供应链确认、定价定稿、listing 文案定稿、上新排期(SOP §0.1)。
- **不改**:现有 ecommerce 模块及其在跑的 /loop;browser-provider/BrowserManager 等公共浏览器基础设施。
- **高风险**:`AdsPowerExecutor` 对 eRank 反自动化/导出字段漂移天生脆弱 → 始终保留 `PasteExecutor` 兜底;自动失败必转人工可接管,不静默重试烧配额。
