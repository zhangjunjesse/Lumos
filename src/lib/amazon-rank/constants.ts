import type { RankSettings } from './types';

export { BUILTIN_AMAZON_RANK_APP_ID as AMAZON_RANK_APP_ID } from '@/lib/app/amazon-rank-app-id';

export const RUNS_COLLECTION = 'amazon_rank_runs';
export const RESULTS_COLLECTION = 'amazon_rank_results';

export const MONITOR_AUTOMATION_ID = 'amazon-rank-daily-monitor';
export const MONITOR_NATIVE_ACTION = 'amazon-rank:run-monitor';

/** 自然搜索取前 N 名 */
export const TOP_N = 20;
/** 单次运行关键词数硬上限（防风控，设置页可在此范围内调低） */
export const HARD_MAX_KEYWORDS = 200;

/** ASIN：10 位字母数字 */
export const ASIN_RE = /^[A-Z0-9]{10}$/;

/** 运行中的 run 超过这个时长没有任何行更新，判定为进程中断的僵尸运行 */
export const STALE_RUN_CUTOFF_MS = 15 * 60_000;

/** 连续多个关键词执行层失败即中止整个运行（多半是浏览器断了） */
export const CONSECUTIVE_FAILURE_LIMIT = 3;

export const DEFAULT_RANK_SETTINGS: RankSettings = {
  site: 'www.amazon.com',
  zipCode: '10001',
  browserContextId: 'embedded:default',
  incognito: true,
  delayMinMs: 3_000,
  delayMaxMs: 6_000,
  maxKeywords: 50,
  aiSystemPrompt:
    '本应用是确定性浏览器自动化，不调用大模型。查询逻辑：按设置的站点与配送邮编搜索每个关键词，' +
    '提取自然搜索前 20 名 ASIN（排除广告位），与监控 ASIN 比对得出排名。',
  riskNote:
    '只做只读查询，不登录、不下单、不改任何亚马逊数据。频率受每词间隔与单次词数上限约束；' +
    '如遇验证码会立即中止并如实报告，不重试硬闯。',
};

export const KEYWORD_STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  running: '查询中',
  ok: '完成',
  no_results: '无搜索结果',
  blocked: '疑似风控',
  parse_failed: '页面解析失败',
  failed: '执行失败',
  cancelled: '已取消',
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};
