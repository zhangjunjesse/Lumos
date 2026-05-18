/**
 * 类目&关键词调研 —— 类型契约（完整版，无降级产品态）。
 *
 * 范围（用户确认）：选类目范围 → 关键词分析报告。Step4-5 用户在「选品」做。
 *
 * 关键词表现（搜索量/竞争度/趋势）来自 EHunt 逐 tag hover（见
 * keyword-ehunt-hover）。EHunt 真未就绪时该类目 `ok:false` 带可操作 reason，
 * **不伪造、不退化成词频冒充**（用户明确要求不降级）。标题 n-gram 仅作
 * `supplementalTitleCandidates` 旁证，与已打分关键词分开陈列。
 */
import type { Competition, Trend } from './keyword-ehunt-hover';

export type { Competition, Trend } from './keyword-ehunt-hover';

export type KeywordResearchStatus =
  | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type KeywordResearchStage =
  | 'queued' | 'collecting' | 'hovering' | 'analyzing' | 'composing'
  | 'done' | 'error' | 'cancelled';

export type Quadrant =
  | 'blue_ocean'   // 高搜索 + 低竞争
  | 'must_have'    // 高搜索 + 高竞争
  | 'long_tail'    // 低搜索 + 低竞争
  | 'red_ocean';   // 低搜索 + 高竞争

export interface ScoredKeyword {
  keyword: string;
  searchVolume: number;
  competition: Competition;
  trend: Trend;
  quadrant: Quadrant;
  /** 命中该 tag 的 listing 数（卖家使用广度）。 */
  listingCount: number;
}

export interface HealthScore {
  total: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D';
  blueOceanScore: number;       // 0-30
  concentrationScore: number;   // 0-30
  trendScore: number;           // 0-20
  longTailScore: number;        // 0-20
}

export interface CategoryKeywordResult {
  categoryId: string;
  categoryName: string;
  categoryPath: string[];
  query: string;
  /** EHunt 在本类目采集中是否就绪检测到。 */
  ehuntDetected: boolean;
  /** 采集到（hover 成功解析）的关键词数；listing 采样数。 */
  listingCount: number;
  /** 是否产出可用分析（=EHunt 检测到且有已解析关键词）。 */
  ok: boolean;
  reason?: string;
  scoredKeywords: ScoredKeyword[];
  quadrantDist: Record<Quadrant, number>;
  health: HealthScore | null;
  redLight: boolean;
  redLightReasons: string[];
  recommendation: string;
  /** 标题 n-gram 候选（无搜索量，仅旁证，单独陈列不混入打分池）。 */
  supplementalTitleCandidates: { keyword: string; listingCount: number }[];
}

export interface KeywordResearchReport {
  schema: 'ecommerce-keyword-research/v2';
  generatedAt: string;
  dataBasis: string;
  categories: CategoryKeywordResult[];
  /** 跨所选类目去重后的蓝海词池（高搜索+低竞争）。 */
  pooledBlueOcean: ScoredKeyword[];
  /** EHunt 覆盖：检测到的类目 / 总类目。 */
  ehuntCoverage: { detected: number; total: number };
  notes: string[];
}

/** 存储记录（不含 id；id 由 AppRow 包装）。Row 别名在 storage.ts 定义。 */
export interface KeywordResearchRecord extends Record<string, unknown> {
  status: KeywordResearchStatus;
  stage: KeywordResearchStage;
  progress: number;
  category_ids: string; // JSON string[]
  category_label: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  summary: string;
  ehunt_detected: number; // 检测到 EHunt 的类目数
  keyword_count: number;
  listing_count: number;
  report_json: string | null; // KeywordResearchReport
  report_markdown: string | null;
  created_at: string;
}

// Re-export the hover types so consumers import from one place.
export type { TagPerformance, ListingHoverResult } from './keyword-ehunt-hover';
export type CompetitionT = Competition;
export type TrendT = Trend;
