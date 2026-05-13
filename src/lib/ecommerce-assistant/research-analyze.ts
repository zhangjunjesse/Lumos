import { z } from 'zod';

import { EcommerceLlmUnavailableError, generateStructured } from './llm-client';
import type { ResearchAnalysis } from './research-compose';
import type { ResearchSourceResult } from './research-sources';

const analysisSchema = z.object({
  executive_summary: z.string().min(1).max(1200),
  key_findings: z.array(z.string().max(400)).max(8).default([]),
  competitive_landscape: z.string().max(1200).optional(),
  pricing_observations: z.string().max(800).optional(),
  recommended_actions: z.array(z.string().max(300)).max(8).default([]),
});

export interface AnalyzeArgs {
  platform: string;
  query: string;
  instruction: string | null;
  sourceResults: ResearchSourceResult[];
  signal?: AbortSignal;
}

/**
 * Best-effort LLM analysis of collected research data.
 *
 * Returns `null` (not throws) when no LLM provider is available so the runner
 * can degrade to the deterministic template-only report. Real LLM errors
 * (timeouts, schema validation) ARE thrown so the runner can record them as
 * a `failure_stage='analyze'` failure rather than silently downgrade.
 */
export async function analyzeResearch(args: AnalyzeArgs): Promise<ResearchAnalysis | null> {
  const compactSources = args.sourceResults.map((r) => ({
    source: r.source,
    ok: r.ok,
    error: r.error,
    item_count: r.items.length,
    items: r.items.slice(0, 8).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      score: item.score,
      meta: item.meta,
    })),
  }));

  const system = [
    '你是 Lumos 电商助手内置的"调研报告分析师"，目标是基于多数据源的原始抓取结果产出一份决策友好的分析。',
    '严格遵循输出 schema；不要编造数据源没有出现的事实；如果数据稀薄，明确说"样本不足"并给出补救建议。',
  ].join('\n');

  const prompt = [
    `平台: ${args.platform}`,
    `用户指令: ${args.query}`,
    args.instruction ? `附加约束: ${args.instruction}` : '',
    '',
    '【已采集的数据源结果（JSON）】',
    JSON.stringify(compactSources, null, 2),
    '',
    '请输出：',
    '- executive_summary: 2-4 句，概括这次调研的核心结论与下一步动作；',
    '- key_findings: 3-6 条要点（每条 1 句话）；',
    '- competitive_landscape: 简短描述目标平台上同类商品 / 竞争对手的分布与差异化机会；',
    '- pricing_observations: 简短描述价格带、价格异常、典型促销方式；',
    '- recommended_actions: 3-5 条具体的下一步动作（结合电商助手的工坊 / 选品 / 上架等 tab）。',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await generateStructured<ResearchAnalysis>({
      system,
      prompt,
      schema: analysisSchema,
      maxTokens: 2048,
      abortSignal: args.signal,
    });
    return result;
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      // Caller should fall back to template-only report.
      return null;
    }
    throw err;
  }
}
