import { getDb } from './connection';
import { getAllProviders } from './providers';
import { parseProviderModelCatalog } from '@/lib/model-metadata';

// ==========================================
// Token Usage Statistics
// ==========================================

export type TokenUsageGranularity = 'minute' | 'hour' | 'day';

export interface TokenUsageQuery {
  /** 从现在往前回溯多少小时 */
  windowHours: number;
  granularity: TokenUsageGranularity;
}

export interface TokenUsageSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  /** Anthropic 官方 SDK 直接返回的 USD 成本总和 */
  total_cost_usd: number;
  /**
   * 折算美元成本:自定义 Provider(额度制)按 provider.model_catalog 价格估算,
   * 官方 Provider 直接用 SDK 报告的 cost_usd。
   * 500,000 额度 = ¥1,CNY→USD 固定折算 7.2(粗略)。
   */
  estimated_cost_usd: number;
  total_sessions: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

export interface TokenUsageBucket {
  /** 桶起始时间字符串(已换成本地时区)。粒度决定格式:
   *  - minute: `YYYY-MM-DD HH:mm:00`
   *  - hour:   `YYYY-MM-DD HH:00:00`
   *  - day:    `YYYY-MM-DD`
   */
  bucket: string;
  provider_id: string;
  provider_name: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  /** SDK 直接上报的 USD 成本总和。 */
  cost_usd: number;
  /** 折算美元成本(见 TokenUsageSummary.estimated_cost_usd)。 */
  estimated_cost_usd: number;
}

export interface TokenUsageStats {
  summary: TokenUsageSummary;
  buckets: TokenUsageBucket[];
}

const BUCKET_EXPR: Record<TokenUsageGranularity, string> = {
  minute: "strftime('%Y-%m-%d %H:%M:00', m.created_at, 'localtime')",
  hour: "strftime('%Y-%m-%d %H:00:00', m.created_at, 'localtime')",
  day: "DATE(m.created_at, 'localtime')",
};

// 500,000 额度单位 = ¥1,CNY→USD 粗略固定为 7.2(只用于展示估算,不做结算)
const QUOTA_PER_CNY = 500_000;
const CNY_PER_USD = 7.2;

function quotaToUsd(quota: number): number {
  if (!(quota > 0)) return 0;
  return quota / QUOTA_PER_CNY / CNY_PER_USD;
}

export function getTokenUsageStats(query: TokenUsageQuery): TokenUsageStats {
  const db = getDb();
  const windowHours = Math.max(1, Math.round(query.windowHours));
  const bucketExpr = BUCKET_EXPR[query.granularity];

  const summaryRow = db.prepare(`
    SELECT
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) AS total_input_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS total_output_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS total_cost_usd,
      COUNT(DISTINCT m.session_id) AS total_sessions,
      COALESCE(SUM(json_extract(m.token_usage, '$.cache_read_input_tokens')), 0) AS cache_read_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cache_creation_input_tokens')), 0) AS cache_creation_tokens
    FROM messages m
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
      AND m.created_at >= datetime('now', '-' || ? || ' hours')
  `).get(windowHours) as {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };

  const rawRows = db.prepare(`
    SELECT
      ${bucketExpr} AS bucket,
      COALESCE(s.provider_id, '') AS provider_id,
      COALESCE(s.provider_name, '') AS provider_name,
      COALESCE(NULLIF(s.resolved_model, ''), NULLIF(s.model, ''), '') AS model_name,
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) AS input_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS output_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS cost_usd
    FROM messages m
    LEFT JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
      AND m.created_at >= datetime('now', '-' || ? || ' hours')
    GROUP BY bucket, provider_id, provider_name, model_name
    ORDER BY bucket ASC
  `).all(windowHours) as Array<{
    bucket: string;
    provider_id: string;
    provider_name: string;
    model_name: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }>;

  // provider.id + model.value → 额度价(每 1M tokens 的 quota 单位)
  const priceMap = new Map<string, { input: number; output: number }>();
  for (const provider of getAllProviders()) {
    const catalog = parseProviderModelCatalog(provider.model_catalog);
    for (const option of catalog) {
      const input = option.input_price_per_mtok ?? 0;
      const output = option.output_price_per_mtok ?? 0;
      if (input > 0 || output > 0) {
        priceMap.set(`${provider.id}::${option.value}`, { input, output });
      }
    }
  }

  const buckets: TokenUsageBucket[] = rawRows.map((row) => {
    let estimated = row.cost_usd;
    if (!(estimated > 0) && row.provider_id && row.model_name) {
      const price = priceMap.get(`${row.provider_id}::${row.model_name}`);
      if (price) {
        const quotaIn = (row.input_tokens * price.input) / 1_000_000;
        const quotaOut = (row.output_tokens * price.output) / 1_000_000;
        estimated = quotaToUsd(quotaIn + quotaOut);
      }
    }
    return {
      bucket: row.bucket,
      provider_id: row.provider_id,
      provider_name: row.provider_name || '未知服务商',
      model_name: row.model_name || 'unknown',
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cost_usd: row.cost_usd,
      estimated_cost_usd: estimated,
    };
  });

  const estimatedTotal = buckets.reduce((acc, b) => acc + b.estimated_cost_usd, 0);

  return {
    summary: {
      total_input_tokens: summaryRow.total_input_tokens,
      total_output_tokens: summaryRow.total_output_tokens,
      total_cost_usd: summaryRow.total_cost_usd,
      estimated_cost_usd: estimatedTotal,
      total_sessions: summaryRow.total_sessions,
      cache_read_tokens: summaryRow.cache_read_tokens,
      cache_creation_tokens: summaryRow.cache_creation_tokens,
    },
    buckets,
  };
}
