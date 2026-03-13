import { getDb } from './connection';

// ==========================================
// Token Usage Statistics
// ==========================================

export function getTokenUsageStats(days: number = 30): {
  summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  daily: Array<{
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;
} {
  const db = getDb();

  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) AS total_input_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS total_output_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS total_cost,
      COUNT(DISTINCT m.session_id) AS total_sessions,
      COALESCE(SUM(json_extract(m.token_usage, '$.cache_read_input_tokens')), 0) AS cache_read_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cache_creation_input_tokens')), 0) AS cache_creation_tokens
    FROM messages m
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
      AND m.created_at >= date('now', '-' || (? - 1) || ' days')
  `).get(days) as {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };

  const daily = db.prepare(`
    SELECT
      DATE(m.created_at) AS date,
      CASE
        WHEN COALESCE(NULLIF(s.provider_name, ''), '') != ''
        THEN s.provider_name
        ELSE COALESCE(NULLIF(s.resolved_model, ''), NULLIF(s.model, ''), 'unknown')
      END AS model,
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) AS input_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS output_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS cost
    FROM messages m
    LEFT JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
      AND m.created_at >= date('now', '-' || (? - 1) || ' days')
    GROUP BY DATE(m.created_at),
      CASE
        WHEN COALESCE(NULLIF(s.provider_name, ''), '') != ''
        THEN s.provider_name
        ELSE COALESCE(NULLIF(s.resolved_model, ''), NULLIF(s.model, ''), 'unknown')
      END
    ORDER BY date ASC
  `).all(days) as Array<{
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;

  return { summary, daily };
}
