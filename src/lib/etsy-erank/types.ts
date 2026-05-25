// Etsy eRank 选品雷达 — 后端持久化的核心类型
// 跟 src/components/apps/builtin/etsy-erank/etsy-erank-types.ts 保持兼容
// (前端类型重命名了某些字段以贴近 UI;后端类型贴近 DB)

export type StepId = 'huntground' | 'seed' | 'converge' | 'verify' | 'score' | 'analyze' | 'manual';

/** 自动级联跑到哪步 — 创建轮次后,后端会按顺序自动启相邻 step
 *   seed     = 只跑 ②(默认,安全)
 *   converge = ② → ③
 *   verify   = ② → ③ → ④(④ 烧 eRank 配额)
 *   score    = ② → ③ → ④ → ⑤(⑤ 烧 LLM tokens)
 *   analyze  = ② → ③ → ④ → ⑤ → ⑥(全自动,慎用)
 *   none     = 创建后什么都不跑,等用户手动启
 */
export type CascadeTarget = 'none' | 'seed' | 'converge' | 'verify' | 'score' | 'analyze';

export interface RunConfig {
  /** ② Trend Buzz 时间窗口 */
  seedTimeframe: string;          // 'yesterday' / 'last-30-days' / 'YYYY-MM'
  /** ② 每源最多行数 */
  seedLimit: number;              // 10-200
  /** ④ Bulk 单次最多跑多少批(每批 20 词) */
  verifyMaxBatches: number;       // 1-100
  /** 自动级联到哪步(含) */
  cascadeTo: CascadeTarget;
  /** Lumos 浏览器 context id(可选)— 形如 'adspower:k1ck97si'。
   *  留空 = 走 env 默认 profile,跟历史行为一致。
   *  目前 Etsy 抓取只支持 adspower 类型;选其他类型会在启动时报错。 */
  browserContextId?: string;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  seedTimeframe: 'yesterday',
  seedLimit: 100,
  verifyMaxBatches: 30,
  cascadeTo: 'converge',  // 默认 ②→③ 自动跑(都免费),④ 起手动确认
};
export type StepState = 'pending' | 'running' | 'blocked' | 'done' | 'failed' | 'skipped';
export type RunStatus = 'running' | 'completed' | 'failed' | 'archived';
export type EntryMode = 'with_capability' | 'blank_slate';
export type Executor = 'paste' | 'adspower';
export type Grade = 'A' | 'B' | 'C' | 'drop';

export interface RadarRunRow {
  id: string;
  label: string;
  status: RunStatus;
  entryMode: EntryMode;
  executor: Executor;
  capabilities: string[];
  market: string;
  platform: string;
  startedAt: number;
  finishedAt: number | null;
  failureReason: string;
  summary: string;
  seedCount: number;
  convergeCount: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  config: RunConfig;
}

export interface RadarStepRow {
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

export interface SeedRow {
  id: number;
  runId: string;
  sourceTool: string;
  timeframe: string;
  rank: number | null;
  keyword: string;
  changeStr: string;
  avgSearches: string;
  avgCtr: string;
  competition: string;
  trendNote: string;
  category: string;
}

export interface BulkRow {
  id: number;
  runId: string;
  seed: string;
  keyword: string;
  sources: string[];
  searches: string;
  clicks: string;
  ctr: string;
  competition: string;
  kd: string;
  google: string;
  grade: Grade;
  batchId: string;
}

export interface ExpandedRow {
  id: number;
  runId: string;
  seed: string;
  keyword: string;
  sources: string[];
}

export interface ListingRow {
  listingId: string;
  seed: string;
  title: string;
  imgUrl: string;
  price: string;
  shopText: string;
  href: string;
}

export interface ScoredNicheRow {
  id: number;
  runId: string;
  seed: string;
  nicheSummary: string;
  nicheRisks: string[];
  candidates: Array<{
    keyword: string;
    productGuess: string;
    rationale: string;
    confidence: 'high' | 'medium' | 'low';
    nextStep: string;
  }>;
  stats: {
    a_count: number;
    b_count: number;
    c_count: number;
    top_a_searches: number;
    top_a_keyword: string;
    risks_count: number;
  };
  inputHash: string;
  scoredAt: number;
}

export interface EhuntRow {
  id: number;
  runId: string;
  keyword: string;
  analysis: Record<string, unknown>;
  listings: Array<Record<string, unknown>>;
  ehuntCoverage: number;
  analyzedAt: number;
}

export const ALL_STEPS: StepId[] = ['huntground', 'seed', 'converge', 'verify', 'score', 'analyze', 'manual'];

export interface CreateRunInput {
  label: string;
  entryMode: EntryMode;
  capabilities?: string[];
  executor?: Executor;
  market?: string;
  platform?: string;
  config?: Partial<RunConfig>;
}
