// Etsy eRank 选品雷达 — demo 类型(对齐 docs/etsy-erank-app-design.md §3 数据契约)。
// demo 阶段仅用于渲染,无后端;字段名与契约一致,确认后接真数据零改名。

export type StepId = 'huntground' | 'seed' | 'converge' | 'verify' | 'score' | 'analyze' | 'manual';

/** 步骤状态机:待跑 / 运行 / 卡住(闸门) / 完成 / 失败 / 跳过(仅 ① 在 blank_slate) */
export type StepState = 'pending' | 'running' | 'blocked' | 'done' | 'failed' | 'skipped';

/** ②④ 可插拔执行器 */
export type Executor = 'paste' | 'adspower';

/** 轮次起点:有能力/方向 vs 完全没想法。决定 ① 是否跑、② 来源范围 */
export type EntryMode = 'with_capability' | 'blank_slate';

export type RunStatus = 'running' | 'completed' | 'failed';

export interface SeedTerm {
  sourceTool: 'Trend Buzz' | 'Monthly Trends' | 'Category Report' | 'Top Sellers';
  keyword: string;
  category: string;
  // 真实抓到的列(按列名映射,SOP §6.2 字段漂移防护;可选,缺数据留空不补)
  rank?: string;
  change?: string; // Trend Buzz: '↑ 223' / '↓ 1' / '-'
  avgSearches?: string; // '57,760' / 'Unknown' / '<20'
  avgCtr?: string; // '136%' / 'Unknown'
  competition?: string; // '143,307'
  trendNote?: string; // Monthly Trends: 'Apr 2026 / 114,920'(顶月 + 顶月搜)
}

/** eRank 真实导出行;按列名映射,不按位置 */
export interface KeywordMetric {
  keyword: string;
  searches: string; // 保留原样(可能是 "<20")
  clicks: string;
  ctr: string; // 可能 "Unknown"
  competition: number;
  kd: number; // 0–100
  trend: string;
  source: Executor;
}

/** ③ 收敛 - 聚类产物(对齐 docs/etsy-erank-app-design.md §6.1.4 JSON schema) */
export interface ClusterRationale {
  evidence_competition: string;
  evidence_intent: string;
  evidence_capability_match: string;
}

/** niche_type registry id(见 docs/etsy-erank-app-design.md §6.1.3)
 *  MVP 阶段填充了 6 个完整 type;其余走 'other' 待补 */
export type NicheTypeId =
  | 'wedding_engagement'
  | 'jewelry'
  | 'apparel_design'
  | 'digital_download'
  | 'home_decor'
  | 'home_organization'
  | 'stationery_paper'
  | 'awareness_cause'
  | 'pet_products'
  | 'baby_kids'
  | 'beauty_personal_care'
  | 'pop_culture_fandom'
  | 'botanical_plant_art'
  | 'seasonal_holiday'
  | 'fashion_aesthetic'
  | 'collector_subculture'
  | 'spiritual_wellness'
  | 'personalized_gifts'
  | 'outdoor_adventure'
  | 'crafts_supplies'
  | 'vehicle_accessories'
  | 'memorial_funeral'
  | 'kitchen_dining'
  | 'kids_party'
  | 'office_workspace'
  | 'other';

export interface Cluster {
  name: string;
  niche_type_id: NicheTypeId;
  core: string;
  core_evidence_from_input: string[];
  broad_subordinates: string[];
  variants: string[];
  rationale: ClusterRationale;
  seasonality: string; // 'evergreen' | 'unknown' | 'seasonal:Month'
  priority: 1 | 2 | 3;
}

export type RejectReason =
  | 'duplicate'
  | 'red_ocean'
  | 'dead_no_search'
  | 'dead_no_click'
  | 'too_broad_single_word';

export interface CodeRejected {
  keyword: string;
  source: 'Trend Buzz' | 'Monthly Trends';
  reason: RejectReason;
  stats?: { competition?: number };
}

export type Grade = 'A' | 'B' | 'C' | 'drop';

/** ③ C 路 listing 卡片(标题/主图/价格/店铺/详情链接)
 *  抓 Etsy listing 标题做 ngram 时顺手抓的,主图本地化到 public/etsy-images/ */
export interface ListingPreview {
  listing_id: string;
  title: string;
  img: string; // public 路径 /etsy-images/<id>.jpg
  price: string;
  shop: string;
  href: string;
}

/** ⑤ LLM 输出 - candidate 级 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export interface ScoredCandidate {
  keyword: string;
  productGuess: string;
  rationale: string;
  confidence: ConfidenceLevel;
  nextStep: string;
}

/** ⑤ LLM 输出 - niche 级(code 后置算 stats) */
export interface NicheStats {
  a_count: number;
  b_count: number;
  c_count: number;
  top_a_searches: number;
  top_a_keyword: string;
  risks_count: number;
}

export interface ScoredNiche {
  seed: string;
  niche_summary: string;
  niche_risks: string[];
  candidates: ScoredCandidate[];
  stats: NicheStats;
}

/** ③ 扩词来源标签
 *  B = Etsy autocomplete API(买家在 search box 真输的词,免费实时)
 *  C = Etsy listing 标题 ngram(头部 listing 在用的 SEO 词组,真浏览器抓)
 *  A = eRank Keyword Tool Related Searches(暂未实现) */
export type ExpansionSource = 'A' | 'B' | 'C';

export interface ExpandedKeyword {
  keyword: string;
  sources: ExpansionSource[];
}

export interface SeedExpansion {
  seed: string;
  keywords: ExpandedKeyword[];
}

/** ④ Bulk 验真真实产物 - 对应 eRank Bulk Keyword Tool CSV 导出 7 列 */
export interface BulkMetric {
  seed: string; // 从哪个 ② 种子扩出来的(审计 + UI 分组)
  sources: string[]; // 'B' / 'C' / 'seed' 任意组合 — 这词的扩词来源
  keyword: string;
  searches: string; // 'Avg Searches':可能 '463' / 'Unknown' / '< 20'
  clicks: string; // 'Avg Clicks':可能 '473' / 'Unknown' / '< 20'
  ctr: string; // 'Avg CTR':'102%' / 'Unknown' / '< 20%'
  competition: string; // 'Etsy Competition':'1,488' / 'Unknown'
  kd: string; // 'Keyword Difficulty' 0-100
  google: string; // 'Google Searches' 站外热度
  grade: Grade; // 按 SOP §3.2 自动判级
}
export type Verdict = 'pass' | 'reject' | 'insufficient' | null;

export interface OpportunityCandidate {
  id: string;
  keyword: string;
  productGuess: string;
  grade: Grade;
  metric: KeywordMetric; // 证据链:引用真实行
  reason: string; // 为什么是缺口 / 为什么淘汰(一句中文)
  seasonality: string;
  nextStep: string;
  evidenceSufficient: boolean;
}

export interface ValidationCheck {
  key: string;
  label: string;
  focus: string;
  result: 'pass' | 'fail' | null;
}

export interface ManualValidation {
  candidateId: string;
  checks: ValidationCheck[];
  competitorRef: string;
  priceBand: string;
  notes: string;
  verdict: Verdict;
}

export interface ProductBrief {
  candidateId: string;
  keyword: string;
  target: string;
  useCase: string;
  valueProp: string;
  costNote: string;
  profitNote: string;
  grade: Grade;
  action: string;
}

export interface QuotaEntry {
  period: string;
  step: string;
  debited: number;
  balanceAfter: number;
  at: string;
}

export interface RadarRun {
  id: string;
  label: string;
  status: RunStatus;
  executor: Executor;
  entryMode: EntryMode;
  capabilities?: string[]; // 仅 with_capability 模式;blank_slate 无
  startedAt: string;
  finishedAt?: string;
  seedCount: number;
  convergeCount: number;
  summary: string;
  failureReason?: string;
  gradeTally?: { a: number; b: number; c: number; brief: number };
}

/** ⑥ 商业分析 — 单个 listing 字段(EHunt 注入 + Etsy 原生) */
export interface EhuntListing {
  listing_id: string;
  title: string;
  img: string; // /etsy-images/<listing_id>.jpg
  price: string; // 原始字符串,"Sale Price $58.79" / "$275.00"
  shop_name: string; // 已清洗,去掉"Ad from shop xxx"
  shop_rating: number | null;
  shop_review_count: number | null;
  href: string;
  ehunt: {
    sales: number | null; // 累计销量
    sales_window: number | null; // 括号内的窗口数(EHunt 内部值)
    favorites: number | null; // 收藏数
    store_weekly_sales: number | null; // 店铺周销
    listed_date: string | null; // "04/22/26"
  };
}

/** ⑥ 商业分析 — 关键词级聚合(code 后置算 + LLM 一句话解读) */
export interface EhuntAnalysis {
  keyword: string;
  listingCount: number;
  ehuntCoverage: number;
  sales: {
    max: number | null;
    median: number | null;
    p75: number | null;
    total: number;
    top10: number[];
  };
  favorites: {
    max: number;
    median: number | null;
    total: number;
  };
  storeWeeklySales: {
    median: number | null;
    max: number;
  };
  price: {
    min: number;
    max: number;
    median: number | null;
    p25: number | null;
    p75: number | null;
  };
  newStores: {
    within30: number;
    within90: number;
    within30WithSales: number;
    ageDistribution: number[]; // 天数升序
  };
  topShops: Array<{ name: string; listings: number; sales: number; favs: number }>;
  top5SalesPct: number; // 0-1
  topNgrams: Array<{ gram: string; count: number; pct: number }>;
  llmInsight: string;
}

export interface EhuntKeywordData {
  analysis: EhuntAnalysis;
  listings: EhuntListing[];
}

export const QUOTA_MONTHLY_CAP = 200;
export const CONVERGE_HARD_CAP = 120;
