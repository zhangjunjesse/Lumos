# 网文套路雷达 (novel-trope-radar) · 模块目标

> **本文件是该模块的最高目标 (GOAL)**。
> 任何后续修改、PR、或 AI 辅助开发，必须先回到本文件确认是否偏离目标。
> 如目标本身需调整，先改本文件并经用户确认，再改代码。

---

## 一、最终成品 (Definition of Done)

每周一上午 09:00（cron 可配），Lumos 自动产出一份《网文套路周报》并将原始素材入库，
供用户在写小说时通过对话 RAG 召回**结构化趋势 + 具体原文写法**。

### 验收清单

- [ ] `/workflow` 列表中可见名为「网文套路雷达」的内置 preset
- [ ] 用户一键启用后，按配置 cron 自动跑（默认周一 09:00）
- [ ] 一轮成功运行覆盖核心 4 平台（番茄/起点/晋江/七猫）各 Top 50
- [ ] 输出物：1 份 Markdown 周报 + 1 份结构化 JSON 快照 + 全量试读章原文入库
- [ ] 3 个 KB collection 都能被 `/chat` RAG 召回
- [ ] 用户可以问"本月新冒头的开篇 hook 模式 + 给我看 3 个具体写法"，能同时拿到结论和原文片段
- [ ] 一轮全跑成功率 ≥ 80%（单平台/单本失败软隔离，不阻塞整体）
- [ ] 任何阶段不违反第三章合规硬规则

---

## 二、非目标 (Non-Goals)

- ❌ 不下载、不存储、不输出**付费章节**
- ❌ 不绕过任何反爬（账号农场、滑块、字体逆向、协议伪造均不做）
- ❌ 不做实时榜单监控（仅周维度）
- ❌ 不做对外内容站、不做小说检索引擎
- ❌ 不向云端同步原文 corpus（本地学习用，不出本机）

---

## 三、合规硬规则 (永不破坏)

1. **章节正文**：只抓平台明确标记为「免费试读 / 试读章节 / 免费」的章节
2. **章节目录**：只取标题与 url，不主动进入付费章节
3. **付费章节**：禁止访问，禁止 OCR / 截屏 / 代理 / 任何替代手段获取
4. **书评 / 章评**：UGC 公开内容可抓，需脱敏（不存用户名/头像/uid，仅文本和点赞数）
5. **原文 corpus 入库**：
   - 仅免费试读章节
   - 入库时强制带 source attribution（平台、bookId、URL、作者、抓取时间戳）
   - collection 标记 `personal_study_corpus = true`
   - **禁止任何对外分享 / 云同步 / 公开导出**接口触达此 collection
6. **浏览器自动化**：必须 `background: true`；不打扰用户当前 tab；新弹窗继承 background
7. **频控**：单平台每轮 ≤ 50 本；同平台单本间隔 ≥ 2 秒；跨平台并行 ≤ 4
8. **爬取边界**：尊重 robots.txt；遇到登录墙 → 跳过该书，不养账号
9. **去重**：相同 source_key（platform+bookId）已入库则跳过抓取，仅刷新榜单元数据

---

## 四、架构总览

### 文件目录

```
src/lib/workflow/presets/novel-trope-radar/
├── workflow.dsl.ts              # V3 DSL 构造器 (返回 WorkflowDSLV3 JSON)
├── types.ts                     # TropeRecord / WeeklyReport / AdapterContract
├── adapters/
│   ├── base.ts                  # Adapter 接口 + 公共浏览器 helper (强制 background)
│   ├── fanqie.ts
│   ├── qidian.ts
│   ├── jjwxc.ts
│   ├── qimao.ts
│   ├── faloo.ts
│   ├── zongheng.ts
│   ├── _17k.ts
│   ├── ciweimao.ts              # 可选
│   ├── sfacg.ts                 # 可选
│   └── hongxiu.ts               # 可选
├── trope-extractor.ts           # LLM prompt + JSON schema (输出结构化字段)
├── trend-differ.ts              # 周间 diff 逻辑
├── report-template.ts           # Markdown 周报渲染
├── kb-persister.ts              # 写入 3 个 KB collection
├── compliance-guard.ts          # 合规校验 (引用第三章规则)
└── platform-registry.ts         # adapter 注册表 (启用平台开关)

src/lib/capability/novel-trope/
├── platform-researcher.ts       # 抓取 agent 能力
├── trope-extractor.ts           # 套路提取 agent 能力
├── trend-analyzer.ts            # diff + 报告 agent 能力
└── kb-persister.ts              # 入库 agent 能力

src/app/api/workflow/presets/novel-trope-radar/
└── install/route.ts             # 一键安装 (写入 scheduled_workflows)
```

### Agent 清单（4 个）

| Agent | role | 职责 |
|---|---|---|
| `novel-platform-researcher` | researcher | 调度 adapter 抓榜单 + 单本元数据 + 免费章节 + 书评 |
| `novel-trope-extractor` | worker | LLM 把素材 → TropeRecord JSON |
| `novel-trend-analyzer` | worker | 读上周快照 → diff → 渲染 Markdown 周报 |
| `novel-kb-persister` | integration | 原文/快照/周报 分别写入对应 collection |

### 数据模型

```ts
// src/lib/workflow/presets/novel-trope-radar/types.ts

type PlatformKey =
  | 'fanqie' | 'qidian' | 'jjwxc' | 'qimao'
  | 'faloo' | 'zongheng' | '17k'
  | 'ciweimao' | 'sfacg' | 'hongxiu';

interface BookMeta {
  bookKey: string;          // hash(platform + bookId), 全局去重 key
  platform: PlatformKey;
  bookId: string;
  rank: number;
  url: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  intro: string;            // 简介,公开元数据
}

interface FreeChapter {
  bookKey: string;
  chapterIndex: number;     // 第几章 (从 1)
  chapterTitle: string;
  url: string;
  content: string;          // 原文 (仅免费试读章)
  fetchedAt: string;        // ISO timestamp
}

interface PublicReview {
  bookKey: string;
  text: string;             // 评论文本
  likes: number;
  // 不存 username / uid / avatar
}

interface TropeRecord {
  bookKey: string;
  platform: PlatformKey;
  weekId: string;           // ISO week, e.g. "2026-W18"
  rank: number;

  // 来自平台公开元数据
  title: string;
  author: string;
  category: string;
  tags: string[];

  // LLM 提炼的结构化字段
  genre: string;
  goldenFinger: string;     // 'system' | 'rebirth' | ... | string (扩展)
  openingHookType: string;  // 抽象类型,非原句
  protagonistArchetype: string;
  pacing: 'per-chapter' | 'every-3' | 'every-10' | 'slow-burn';
  antagonistType: string;
  emotionalAxis?: string;
  tropeTags: string[];

  // 读者反馈聚合 (非原评论)
  readerPainPoints: string[];
  readerHighPoints: string[];

  // 引用回 corpus, 给 RAG 拼上下文用
  freeChapterRefs: string[]; // [chapter1Url, chapter2Url, chapter3Url]
}

interface WeeklyReport {
  weekId: string;
  generatedAt: string;
  platforms: PlatformKey[];
  risingTropes: Array<{ tag: string; thisWeek: number; lastWeek: number }>;
  decliningTropes: Array<{ tag: string; thisWeek: number; lastWeek: number }>;
  newCombinations: Array<{ a: string; b: string; examples: string[] }>;
  crossPlatformSpread: Array<{ tag: string; from: PlatformKey; to: PlatformKey[] }>;
  hookPatternArchive: Array<{ pattern: string; count: number; exampleBookKeys: string[] }>;
  markdown: string;
}
```

### 知识库 collections（3 个）

| Collection name | source_type | 内容粒度 | 用途 |
|---|---|---|---|
| `novel-trope-corpus` | `manual` | 一篇试读章 = 一个 kb_item | 写作时 RAG 召回原文写法 |
| `novel-trope-snapshot` | `manual` | 一周快照 = 一个 kb_item (JSON) | 周间 diff,内部用 |
| `novel-trope-report` | `manual` | 一份周报 = 一个 kb_item (Markdown) | RAG 召回趋势分析 |

写入走 `src/lib/knowledge/importer.ts` 的 `processImport()`，自动 chunk + BM25 + embed + auto-tag。

### Workflow DSL (V3) 阶段

```
[cron: runParams.cron]
  │
  1. fetch_rankings        agent  parallel × runParams.platforms.length
  │     input: { platforms, topN }
  │     output: BookMeta[]
  │
  2. dedup_and_filter      agent  (剔除已入 corpus 的 bookKey)
  │     output: BookMeta[] (新书或排名异动的)
  │
  3. deep_crawl            for-each book (concurrent=3, max=runParams.topN)
  │     input: { freeChapterLimit }
  │     ├─ fetch_book_detail   抓试读章 + 书评
  │     └─ persist_corpus      原文立即入 corpus collection (失败即停)
  │
  4. extract_tropes        for-each TropeRecord (concurrent=5, LLM)
  │     output: TropeRecord[]
  │
  5. trend_diff            agent (读 snapshot collection 上周记录, diff)
  │     output: trend_data
  │
  6. generate_report       agent (markdown 周报)
  │
  7. persist_report        agent (写 snapshot + report 两个 collection + 通知)
```

---

## 五、存储布局总图

```
代码层 (固定一份):
  src/lib/workflow/presets/novel-trope-radar/      ← 工作流定义
  src/lib/capability/novel-trope/                  ← Agent 能力定义

DB 层 (~/.lumos/lumos.db):
  scheduled_workflows                              ← 1 行 = 1 个 schedule 实例
    .workflow_dsl                                  ← DSL JSON (工作流定义副本)
    .working_directory                             ← 执行根目录
    .run_params                                    ← 平台开关等运行时参数
  schedule_run_history                             ← 每次执行的元数据日志
  kb_collections × 3                               ← corpus / snapshot / report
  kb_items                                         ← 跨周累积的内容
  kb_chunks                                        ← chunk + 向量 + BM25

文件层 (跨执行):
  ~/.lumos/workflow-agent-runs/<run-id>/           ← 单次执行的临时工作区
                                                     (中间产物可清理,
                                                      所有持久化产出已入 KB)
```

**关键性质**：
- 工作流定义只在代码 + DB 一行（不会每次执行复制）
- 每次执行用同一个 `workingDirectory`，下面按 `<run-id>` 分子文件夹
- 长期数据全在 KB（跨执行累积、可 RAG）
- 临时数据在 `workflow-agent-runs/<run-id>/`（按 run-id 隔离，可清理）

---

## 六、运行时参数 (RunParams)

所有可调项都通过 `scheduled_workflows.run_params` 字段配置（一行 JSON，
schedule 编辑 UI 可改，install API 接受初始值）。
**不在代码里硬编码**。

```ts
// src/lib/workflow/presets/novel-trope-radar/types.ts

interface NovelTropeRadarRunParams {
  /** 本轮启用的平台列表 */
  platforms: PlatformKey[];
  /** 每平台抓 Top N 本 (1 ≤ N ≤ 100) */
  topN: number;
  /** 每本最多抓多少章免费试读 (1 ≤ N ≤ 10) */
  freeChapterLimit: number;
  /** Cron 表达式 (调度层用) */
  cron: string;
  /** 单本之间最小间隔 ms (默认 2000) */
  perBookDelayMs?: number;
  /** 单本最多抓多少条公开书评 (默认 20) */
  reviewLimit?: number;
}

const DEFAULTS: NovelTropeRadarRunParams = {
  platforms: ['fanqie', 'qidian', 'jjwxc', 'qimao'],  // 默认核心 4 个
  topN: 50,
  freeChapterLimit: 3,
  cron: '0 9 * * 1',                                  // 周一 09:00
  perBookDelayMs: 2000,
  reviewLimit: 20,
};

const BOUNDS = {
  topN: { min: 1, max: 100 },
  freeChapterLimit: { min: 1, max: 10 },
  perBookDelayMs: { min: 1000, max: 30000 },
  reviewLimit: { min: 0, max: 100 },
};
```

`compliance-guard.ts` 在校验 RunParams 时强制 BOUNDS，超界拒绝运行。
所有 adapter 接收 RunParams 子集作为入参，**禁止 adapter 内读取硬编码常量**。

---

## 七、平台覆盖

平台通过 `platform-registry.ts` 注册，运行时由 `runParams.platforms` 数组决定本轮启用哪些。架构无平台数量上限。

10 个 adapter 全部一次性实现，启用与否由参数控制。

| 平台 | 域名 | 类型 | 实施 Batch |
|---|---|---|---|
| 番茄 | fanqienovel.com | 男频/混合,免费 | B1 |
| 起点 | qidian.com | 男频,付费 | B2 |
| 晋江 | jjwxc.net | 女频,综合 | B2 |
| 七猫 | qimao.com | 男频,免费 | B2 |
| 飞卢 | faloo.com | 男频,小白文 | B3 |
| 纵横 | zongheng.com | 男频,老牌 | B3 |
| 17K | 17k.com | 男频/综合 | B3 |
| 刺猬猫 | ciweimao.com | 二次元 | B3 |
| SF 轻小说 | sfacg.com | 轻小说 | B3 |
| 红袖添香 | hongxiu.com | 女频,阅文系 | B3 |

---

## 八、实施批次

> 架构是一次设计完成的，分批仅是落地顺序。批次内不停下确认。

- **Batch 1 — 番茄端到端跑通**：骨架 + types + compliance-guard + RunParams 校验 + adapters/base + adapters/fanqie + 4 个 agent + workflow.dsl + 3 个 KB collection 初始化 + 端到端冒烟
- **Batch 2 — 核心 4 平台齐**：起点 / 晋江 / 七猫 adapter
- **Batch 3 — 扩展 6 平台**：飞卢 / 纵横 / 17K / 刺猬猫 / SF 轻小说 / 红袖添香 adapter
- **Batch 3.5 — 安装入口 + RAG 验证**：install API（接受 RunParams） + workflow 列表入口 + chat RAG 召回测试

---

## 九、质量门槛

- 单文件 ≤ 300 行（CLAUDE.md 硬性要求）
- 函数 ≤ 50 行
- adapter 之间不复制粘贴，公共逻辑入 `base.ts`
- 关键路径有 TS 类型，禁止 `any`
- 不写"以防万一"的兜底（按 feedback_code_quality）
- 每个 adapter 至少 1 个 mock HTML 解析测试
- compliance-guard 必须有专属测试用例覆盖第三章每条规则 + RunParams BOUNDS 校验
- corpus 入库测试：验证 `personal_study_corpus = true` 标记，验证不出现在公开导出/同步路径
- adapter **不得硬编码** topN / freeChapterLimit 等参数，必须从 RunParams 接收

---

## 十、上线验证 runbook

代码全部为离线测试覆盖（48/48 jest pass）。
要真正跑一次 + 验证 RAG，需要在 dev server 中走以下步骤：

### 1. 启动 Lumos
```bash
./dev.sh
```
启动时 `init-builtin-resources` 会自动创建 3 个 KB collection
（`novel-trope-corpus / -snapshot / -report`）。

### 2. 安装 preset

```bash
# 默认参数(核心 4 平台 / Top 50 / 试读 3 章 / 周一 09:00)
curl -X POST http://localhost:3000/api/workflow/presets/novel-trope-radar/install \
  -H 'Content-Type: application/json' \
  -d '{}'

# 或自定义
curl -X POST http://localhost:3000/api/workflow/presets/novel-trope-radar/install \
  -H 'Content-Type: application/json' \
  -d '{
    "runParams": {
      "platforms": ["fanqie"],
      "topN": 5,
      "freeChapterLimit": 3,
      "cron": "0 9 * * 1"
    }
  }'
```

返回 `{ scheduleId, status: 'created'|'updated', runParams }`。

### 3. 检查状态

```bash
curl http://localhost:3000/api/workflow/presets/novel-trope-radar/status
```

返回 schedule 信息 + 三个 collection 当前 item 数。

### 4. 手动触发一轮（不等 cron）

通过 Lumos UI 的 `/workflow` 页面：找到「网文套路雷达」schedule，点「立即运行」。
（或调用现有 schedule 立即触发 API。）

### 5. 选择器校准

10 个 adapter 的 selectors 是上线前需要根据真实 DOM 校准的占位值。
首次跑会大概率出现「榜单抓不到 item」warning，按 platform 修
`src/lib/workflow/presets/novel-trope-radar/adapters/<key>.ts` 的
`selectors` 字段后重启即可。每个 adapter 是独立的、可以增量校准。

### 6. RAG 召回验证

在 `/chat` 中开启「使用知识库」(选 `novel-trope-report` 或全部 3 个)，
问下面这些问题，应能命中相关 chunk：

- "本月新冒头的开篇 hook 模式是什么？"  → 命中 report
- "番茄飙升榜本周新出现的金手指类型？" → 命中 report
- "给我看 3 个使用'系统流'的开篇原文写法" → 命中 corpus 原文
- "晋江 vs 起点 这周套路差异？" → 命中 report

如召回不准，可能原因：
- 数据未入库（看 status 接口的 itemCount）
- chunk 没建好（看 kb_items.processing_status）
- collection 标签过滤把它筛掉了

### 7. 关闭/卸载

直接在 `/workflow` 页面删除 schedule。原文 corpus 会保留在 KB
（你写作时还会用），如确需清理用 `/library` UI 的 collection 删除。

---

## 十一、上下文恢复指引（给未来的 AI / 自己）

如果上下文丢失，看完本文件即可恢复全貌。优先级：

1. 读「最终成品」+「合规硬规则」（绝不能错的边界）
2. 读「架构总览」+「存储布局总图」（文件清单 + 数据流）
3. 看 git 状态，对比「实施批次」清单判断当前进度
4. 继续未完成的 Batch，**不要重新设计**架构
5. 如发现架构需要变更，先改本文档并向用户确认

### 当前实现状态 (2026-05)

- ✅ Batch 1 番茄端到端 (骨架 + types + compliance + adapter base + 4 capability + workflow.dsl + bootstrap + 离线测试 48/48 pass)
- ✅ Batch 2 核心 4 平台 (起点 / 晋江 / 七猫 adapter 已写,选择器待校准)
- ✅ Batch 3 扩展 6 平台 (飞卢 / 纵横 / 17K / 刺猬猫 / SF 轻小说 / 红袖)
- ✅ Batch 3.5 install API + status API + 验证 runbook
- ⏳ 选择器实战校准 (上线时按 runbook 第 5 步增量调)
- ⏳ RAG 端到端验证 (按 runbook 第 6 步用户侧验证)
