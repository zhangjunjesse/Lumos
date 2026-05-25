// Pinterest Trends 选品雷达 — 后端持久化的核心类型
//
// 流程 5 步:
//   ① huntground  — 选猎场:country + preset(growing/monthly/yearly)+ 可选 category
//   ② collect     — 抓 trends.pinterest.com 当前 trending 词列表(系统索引词)
//   ③ metrics     — 批量调 /metrics/?terms=...&days=90 拿 90 天数据 + WoW/MoM/YoY
//   ④ analyze     — LLM 对每个词做选品视角解读(关联品类 / 创意方向 / 风险)
//   ⑤ report      — PDF 多关键词综合报告输出

export type StepId = 'huntground' | 'collect' | 'metrics' | 'analyze' | 'etsy_listings' | 'report';

/** 自动级联跑到哪步(含)。
 *   none      = 创建后什么都不跑,等手动
 *   collect   = 只跑 ②
 *   metrics   = ② → ③
 *   analyze   = ② → ③ → ④(④ 烧 LLM tokens)
 *   report    = ② → ③ → ④ → ⑤(全自动,生成 PDF)
 */
export type CascadeTarget = 'none' | 'collect' | 'metrics' | 'analyze' | 'etsy_listings' | 'report';

/** Pinterest Trends 四种 preset,对应 trends.pinterest.com UI 的 4 个 tab */
export type TrendsPreset = 'growing' | 'seasonal' | 'monthly' | 'yearly';

export interface RunConfig {
  /** 国家 ISO 码 — Pinterest Trends 当前主要支持 US,默认 US */
  country: string;                       // 'US'
  /** 三种 preset:growing(本周猛涨)/ monthly(本月)/ yearly(本年) */
  preset: TrendsPreset;
  /** 可选品类筛选(Pinterest UI 上的 category 下拉值,空 = 全类目) */
  category: string;
  /** ② 抓多少 trending 词上限(Pinterest /top_trends_filtered/ API 硬上限 100) */
  collectLimit: number;                  // 20-100
  /** ③ metrics 时间窗口天数(默认 90,Pinterest 最大支持 90) */
  metricsDays: number;                   // 7-90
  /** 自动级联到哪步(含) */
  cascadeTo: CascadeTarget;
  /** Lumos browser context id(形如 'adspower:k1ck97si');留空 = env 默认 */
  browserContextId?: string;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  country: 'US',
  preset: 'growing',
  category: '',
  collectLimit: 20,
  metricsDays: 90,
  cascadeTo: 'report',            // 默认全跑到 PDF,用户一键到底
};

export type StepState = 'pending' | 'running' | 'blocked' | 'done' | 'failed' | 'skipped';
export type RunStatus = 'running' | 'completed' | 'failed' | 'archived';

export interface PinterestRunRow {
  id: string;
  label: string;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  failureReason: string;
  summary: string;
  trendingCount: number;
  metricsCount: number;
  analyzedCount: number;
  config: RunConfig;
}

export interface PinterestStepRow {
  runId: string;
  stepId: StepId;
  state: StepState;
  progressDone: number;
  progressTotal: number;
  startedAt: number | null;
  finishedAt: number | null;
  errorMessage: string;
  meta: Record<string, unknown>;
}

/** ② 一个 trending 词条 — /top_trends_filtered/ API 返回的一项 */
export interface TrendingRow {
  id: number;
  runId: string;
  rank: number | null;                  // 列表中的序号(1-based)
  term: string;                         // 关键词原文
  preset: TrendsPreset;
  normalizedCount: number | null;       // Pinterest 归一化搜索量(0-100)
  seasonalityScore: number | null;      // 季节性得分 0-1
  wowChange: number | null;             // 直接从 /top_trends_filtered/ 拿,不依赖 ③
  momChange: number | null;
  yoyChange: number | null;
  capturedAt: number;
}

/** ③ 单个 keyword 的 90 天 metrics(完整 JSON 落表) */
export interface MetricsRow {
  id: number;
  runId: string;
  term: string;
  wowChange: number | null;
  momChange: number | null;
  yoyChange: number | null;
  /** 周度归一化 count 序列,JSON: [{date, normalizedCount}, ...] */
  countsJson: string;
  hasPrediction: number;                // 0/1
  fetchedAt: number;
}

/** ④ AI 解读结果 */
export interface AnalysisRow {
  id: number;
  runId: string;
  term: string;
  niche: string;                        // 归属 niche
  category: string;                     // LLM 判定品类
  audience: string;                     // 目标人群
  creativeAngles: string;               // 创意方向 JSON 数组
  risks: string;                        // 风险点 JSON 数组
  score: number;                        // 综合机会分 0-100
  rationale: string;                    // 解读理由
  modelUsed: string;
  analyzedAt: number;
}

/** ⑤ PDF 报告产物 */
export interface ReportRow {
  id: number;
  runId: string;
  filePath: string;                     // 绝对路径,~/.lumos/reports/...
  termCount: number;
  sizeBytes: number;
  generatedAt: number;
}

export interface CreateRunInput {
  label: string;
  config?: Partial<RunConfig>;
}
