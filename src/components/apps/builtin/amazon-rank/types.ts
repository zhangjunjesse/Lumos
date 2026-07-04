export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
export type KeywordStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'no_results'
  | 'blocked'
  | 'parse_failed'
  | 'failed'
  | 'cancelled';

export interface RunDto {
  id: string;
  source: 'manual' | 'monitor';
  status: RunStatus;
  site: string;
  zip_code: string;
  zip_confirmed: boolean;
  keywords_total: number;
  keywords_done: number;
  asins: string[];
  matches_total: number;
  failure_reason?: string;
  started_at: string;
  ended_at?: string;
}

export interface ResultDto {
  id: string;
  run_id: string;
  seq: number;
  keyword: string;
  status: KeywordStatus;
  top_asins: string[];
  matches: { asin: string; rank: number }[];
  organic_count: number;
  snapshot_path?: string;
  error_message?: string;
}

export interface SettingsDto {
  site: string;
  zipCode: string;
  browserContextId: string;
  incognito: boolean;
  delayMinMs: number;
  delayMaxMs: number;
  maxKeywords: number;
  aiSystemPrompt: string;
  riskNote: string;
}

export interface WatchlistDto {
  keywords: string[];
  asins: string[];
}

export interface ParsedDto {
  items: string[];
  warnings: string[];
}

export interface AutomationDto {
  id: string;
  title?: string;
  enabled?: boolean;
  schedule?: string;
  native_action?: string;
  description?: string;
  last_status?: string;
  last_run_summary?: string;
  schedule_status?: string;
  schedule_error?: string;
  next_run_at?: string | null;
}

export interface StatusDto {
  app: { id: string; version: string | null; status: string };
  bridge: { connected: boolean; error: string | null };
  activeRunId: string | null;
  lastRun: { id: string; status: RunStatus; keywordsTotal: number; matchesTotal: number; startedAt: string } | null;
  watchlist: { keywords: number; asins: number };
  monitor: { enabled: boolean; scheduleStatus: string } | null;
  ready: boolean;
  phase: string;
}

export const KEYWORD_STATUS_TEXT: Record<KeywordStatus, string> = {
  pending: '排队中',
  running: '查询中',
  ok: '完成',
  no_results: '无搜索结果',
  blocked: '疑似风控',
  parse_failed: '页面解析失败',
  failed: '执行失败',
  cancelled: '已取消',
};

export const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  running: '运行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};
