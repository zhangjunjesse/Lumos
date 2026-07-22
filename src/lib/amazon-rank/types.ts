export type RankRunStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

export type RankRunSource = 'manual' | 'monitor';

/**
 * 查询引擎：
 * - code 确定性代码（当前生效的提取规则），快、免费
 * - ai   大模型读页（页面摘要 → 自然位），慢、费 token，但页面改版也能看懂，
 *        且会顺手验证/修复代码规则
 */
export type RankExecutionMode = 'code' | 'ai';

/**
 * 单个关键词的查询结果状态。错误必须三分类呈现，不许混成一个「失败」：
 * - no_results   亚马逊真的没有搜索结果（页面明确提示）
 * - blocked      疑似触发风控（验证码 / Robot Check），整个运行会随之中止
 * - parse_failed 页面有内容但解析不出自然位（多半是亚马逊改版）
 * - failed       执行层错误（浏览器断开、导航超时等）
 */
export type KeywordStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'no_results'
  | 'blocked'
  | 'parse_failed'
  | 'failed'
  | 'cancelled';

export interface RankMatch {
  asin: string;
  /** 自然搜索位次，1 起 */
  rank: number;
}

export interface RankRunRow extends Record<string, unknown> {
  id: string;
  source: RankRunSource;
  status: RankRunStatus;
  /** 本次运行用的引擎（旧数据无此字段 = code） */
  engine?: RankExecutionMode;
  site: string;
  zip_code: string;
  /** 邮编是否确认设置成功（失败不阻断运行，但要如实展示） */
  zip_confirmed: boolean;
  keywords_total: number;
  keywords_done: number;
  asins: string[];
  matches_total: number;
  failure_reason?: string;
  /** AI 模式修复轨道的结果说明（草稿已生成/候选未通过），给用户看 */
  repair_note?: string;
  output_dir: string;
  started_at: string;
  ended_at?: string;
  updated_at: string;
}

export interface RankResultRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  seq: number;
  keyword: string;
  status: KeywordStatus;
  /** 自然搜索前 N 名 ASIN，按位次排列 */
  top_asins: string[];
  matches: RankMatch[];
  organic_count: number;
  snapshot_path?: string;
  error_message?: string;
  started_at?: string;
  ended_at?: string;
  updated_at: string;
}

export interface RankSettings {
  site: string;
  zipCode: string;
  browserContextId: string;
  incognito: boolean;
  delayMinMs: number;
  delayMaxMs: number;
  maxKeywords: number;
  executionMode: RankExecutionMode;
  /** AI 操作模式的读页提示词（用户可编辑；输出契约由代码固定追加） */
  aiOperatorPrompt: string;
  aiSystemPrompt: string;
  riskNote: string;
}

export interface RankWatchlist {
  keywords: string[];
  asins: string[];
}

export interface ParsedItems {
  items: string[];
  warnings: string[];
}

/** 提取脚本在页面里收集的原始信号，分类逻辑据此判定 KeywordStatus */
export interface PageExtractSignals {
  organicAsins: string[];
  resultNodeCount: number;
  captcha: boolean;
  noResults: boolean;
}
