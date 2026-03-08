/**
 * Query rewriter — expand user query into multiple search variants via Claude API
 * Ported from demo/local-server/services/knowledge/query-rewriter.js
 */
import { getSetting } from '@/lib/db';
import { callKnowledgeModel } from './llm';

const SYSTEM = [
  '你是知识检索的查询改写器。',
  '目标：输出 2-3 条语义等价或近义的检索短语，补齐同义词、别称、上下位词。',
  '约束：只返回 JSON 数组，不要任何解释。',
].join('\n');
const USER_PROMPT = [
  '请把下面查询改写为 2-3 条不同表达，但语义保持一致。',
  '每条 <= 30 字，去重，保留原问题主语义。',
  '仅输出 JSON 数组，例如 ["...", "..."]。',
  '查询：',
].join('\n');

const CACHE_TTL_MS = 5 * 60 * 1000;
const rewriteCache = new Map<string, { ts: number; value: string[] }>();

async function callClaude(query: string): Promise<string> {
  return callKnowledgeModel({
    model: getSetting('kb_query_rewrite_model') || 'claude-haiku-4-20250514',
    maxTokens: 150,
    timeoutMs: 5000,
    system: SYSTEM,
    prompt: USER_PROMPT + query,
  });
}

function normalizeQueryVariant(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function localFallbackVariants(query: string): string[] {
  const base = normalizeQueryVariant(query);
  if (!base) return [];
  const replacements: Array<[RegExp, string]> = [
    [/报错|错误|异常/gi, '问题'],
    [/为什么|为何/gi, '原因'],
    [/文档|资料|知识库/gi, '文档资料'],
    [/优化|改进|提升/gi, '优化提升'],
  ];
  const variants = new Set<string>();
  variants.add(base);
  for (const [pattern, next] of replacements) {
    if (variants.size >= 3) break;
    if (pattern.test(base)) {
      variants.add(base.replace(pattern, next));
    }
  }
  return Array.from(variants).slice(0, 3);
}

/** Rewrite query into multiple variants (includes original) */
export async function rewriteQuery(query: string): Promise<string[]> {
  const normalizedQuery = normalizeQueryVariant(query);
  if (!normalizedQuery || normalizedQuery.length < 4) return [normalizedQuery || query];

  const enabled = getSetting('kb_query_rewrite_enabled') !== 'false';
  if (!enabled) {
    return [normalizedQuery];
  }

  const cached = rewriteCache.get(normalizedQuery);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const text = await callClaude(normalizedQuery);
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) {
      const fallback = localFallbackVariants(normalizedQuery);
      rewriteCache.set(normalizedQuery, { ts: Date.now(), value: fallback });
      return fallback;
    }

    const parsed = JSON.parse(match[0]);
    const variants = Array.isArray(parsed) ? parsed : [];
    const unique = new Set<string>();
    unique.add(normalizedQuery);
    for (const item of variants) {
      if (typeof item !== 'string') continue;
      const candidate = normalizeQueryVariant(item);
      if (candidate.length < 2 || candidate.length > 30) continue;
      unique.add(candidate);
      if (unique.size >= 4) break;
    }

    const finalVariants = Array.from(unique).slice(0, 4);
    rewriteCache.set(normalizedQuery, { ts: Date.now(), value: finalVariants });
    return finalVariants;
  } catch {
    const fallback = localFallbackVariants(normalizedQuery);
    rewriteCache.set(normalizedQuery, { ts: Date.now(), value: fallback });
    return fallback;
  }
}
