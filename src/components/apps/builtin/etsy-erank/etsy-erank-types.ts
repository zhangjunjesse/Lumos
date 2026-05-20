// Etsy eRank 选品雷达 — demo 类型(对齐 docs/etsy-erank-app-design.md §3 数据契约)。
// demo 阶段仅用于渲染,无后端;字段名与契约一致,确认后接真数据零改名。

export type StepId = 'huntground' | 'seed' | 'converge' | 'verify' | 'score' | 'manual';

/** 步骤状态机:待跑 / 运行 / 卡住(闸门) / 完成 / 失败 */
export type StepState = 'pending' | 'running' | 'blocked' | 'done' | 'failed';

/** ②④ 可插拔执行器 */
export type Executor = 'paste' | 'adspower';

export type RunStatus = 'running' | 'completed' | 'failed';

export interface SeedTerm {
  sourceTool: 'Trend Buzz' | 'Monthly Trends' | 'Category Report' | 'Top Sellers';
  keyword: string;
  category: string;
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

export type Grade = 'A' | 'B' | 'C' | 'drop';
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
  startedAt: string;
  finishedAt?: string;
  seedCount: number;
  convergeCount: number;
  summary: string;
  failureReason?: string;
  gradeTally?: { a: number; b: number; c: number; brief: number };
}

export const QUOTA_MONTHLY_CAP = 200;
export const CONVERGE_HARD_CAP = 120;
