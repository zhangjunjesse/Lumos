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

/**
 * AI 模式候选规则至少在多少个关键词的真实页面上与 AI 结果一致才落草稿。
 * 设 1：草稿永不自动生效（采用前有人工确认闸），UI 会展示验证数量供用户判断；
 * 单关键词快测是最常见用法，门槛设 2 会让修复"跑了个寂寞"。
 */
export const MIN_RULE_AGREEMENT = 1;
/** 单次运行最多让 AI 提几版候选规则（防失控烧 token） */
export const MAX_RULE_PROPOSALS_PER_RUN = 2;

export const DEFAULT_AI_OPERATOR_PROMPT =
  '你是亚马逊搜索结果分析员。给你一份搜索结果页的结构化摘要（按页面顺序的卡片列表），' +
  '任务：识别自然搜索位，按页面顺序给出 ASIN。判定要点：Sponsored/广告标记可能出现在卡片文本、' +
  'class 或 type 里；横幅、推荐轮播、视频位等非自然结果一律排除；同一 ASIN 只计首次出现。';

export const DEFAULT_RANK_SETTINGS: RankSettings = {
  site: 'www.amazon.com',
  zipCode: '10001',
  browserContextId: 'embedded:default',
  incognito: true,
  delayMinMs: 3_000,
  delayMaxMs: 6_000,
  maxKeywords: 50,
  executionMode: 'code',
  aiOperatorPrompt: DEFAULT_AI_OPERATOR_PROMPT,
  aiSystemPrompt:
    '默认用确定性代码查询（不调用大模型）：按设置的站点与配送邮编搜索每个关键词，' +
    '提取自然搜索前 20 名 ASIN（排除广告位），与监控 ASIN 比对得出排名。' +
    '可切换「AI 操作」模式：用配置的模型识别页面，并在代码规则失效时生成修复草稿（需你确认后生效）。',
  riskNote:
    '只做只读查询，不登录、不下单、不改任何亚马逊数据。频率受每词间隔与单次词数上限约束；' +
    '如遇验证码会立即中止并如实报告，不重试硬闯（AI 模式同样不闯验证码）。',
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
