/**
 * Query rewriter — expand user query into multiple search variants via Claude API
 * Ported from demo/local-server/services/knowledge/query-rewriter.js
 */
import { getSetting } from '@/lib/db';

const SYSTEM = '你是一个搜索查询改写工具。只输出JSON数组，不要输出其他内容。';
const USER_PROMPT = '将以下查询改写为2-3个不同角度的搜索关键词组合，每个≤30字，只返回JSON数组。\n查询：';

async function callClaude(query: string): Promise<string> {
  const apiKey = getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('未配置 API Key');

  const baseUrl = getSetting('anthropic_base_url') || 'https://api.anthropic.com';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-20250514',
      max_tokens: 150,
      system: SYSTEM,
      messages: [{ role: 'user', content: USER_PROMPT + query }],
    }),
  });
  clearTimeout(timer);

  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.content?.[0]?.text || '';
}

/** Rewrite query into multiple variants (includes original) */
export async function rewriteQuery(query: string): Promise<string[]> {
  if (!query || query.length < 4) return [query];

  try {
    const text = await callClaude(query);
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [query];
    const variants = JSON.parse(match[0])
      .filter((q: unknown) => typeof q === 'string' && (q as string).length >= 2 && (q as string).length <= 30);
    return variants.length ? [query, ...variants] : [query];
  } catch {
    return [query];
  }
}
