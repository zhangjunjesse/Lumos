import { z } from 'zod';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { generateStructured, EcommerceLlmUnavailableError } from './llm-client';
import { getListingDraft, type ListingDraftRow } from './storage';

export class ListingCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingCompareError';
  }
}

const evaluationSchema = z.object({
  evaluations: z
    .array(
      z.object({
        id: z.string().min(1),
        score_seo: z.number().int().min(0).max(100),
        score_conversion: z.number().int().min(0).max(100),
        score_compliance: z.number().int().min(0).max(100),
        score_total: z.number().int().min(0).max(100),
        verdict: z.enum(['recommended', 'second-pick', 'rewrite', 'situational']),
        strengths: z.array(z.string()).max(5).default([]),
        weaknesses: z.array(z.string()).max(5).default([]),
      }),
    )
    .min(1),
  recommended_id: z.string().min(1),
  recommendation_summary: z.string().min(1),
  cross_cutting_issues: z
    .array(z.string())
    .max(5)
    .default([])
    .describe('Issues that affect ALL drafts (e.g. "all use the same weak hook")'),
});

export interface ListingCompareOutcome {
  recommendedId: string;
  summary: string;
  evaluations: Array<{
    id: string;
    scoreSeo: number;
    scoreConversion: number;
    scoreCompliance: number;
    scoreTotal: number;
    verdict: 'recommended' | 'second-pick' | 'rewrite' | 'situational';
    strengths: string[];
    weaknesses: string[];
  }>;
  crossCuttingIssues: string[];
}

export async function compareListings(
  store: AppDataStore,
  draftIds: string[],
  abortSignal?: AbortSignal,
): Promise<ListingCompareOutcome> {
  if (draftIds.length < 2) {
    throw new ListingCompareError('对比至少需要 2 个草稿。');
  }
  if (draftIds.length > 5) {
    throw new ListingCompareError('单次对比最多 5 个草稿。');
  }
  const drafts = draftIds
    .map((id) => getListingDraft(store, id))
    .filter((d): d is ListingDraftRow => d != null);
  if (drafts.length !== draftIds.length) {
    throw new ListingCompareError('存在无效的草稿 id，部分未找到。');
  }
  for (const d of drafts) {
    if (d.status === 'drafting' || d.status === 'failed') {
      throw new ListingCompareError(
        `草稿 ${d.id.slice(0, 8)} 状态为 ${d.status}，无法对比。`,
      );
    }
    if (!d.title) {
      throw new ListingCompareError(`草稿 ${d.id.slice(0, 8)} 没有标题，无法对比。`);
    }
  }

  try {
    const data = await generateStructured({
      schema: evaluationSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(drafts),
      abortSignal,
      maxTokens: 4096,
    });
    if (!draftIds.includes(data.recommended_id)) {
      throw new ListingCompareError(
        `LLM 推荐了不存在的草稿 id：${data.recommended_id}`,
      );
    }
    return {
      recommendedId: data.recommended_id,
      summary: data.recommendation_summary,
      evaluations: data.evaluations
        .filter((e) => draftIds.includes(e.id))
        .map((e) => ({
          id: e.id,
          scoreSeo: e.score_seo,
          scoreConversion: e.score_conversion,
          scoreCompliance: e.score_compliance,
          scoreTotal: e.score_total,
          verdict: e.verdict,
          strengths: e.strengths,
          weaknesses: e.weaknesses,
        })),
      crossCuttingIssues: data.cross_cutting_issues,
    };
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) throw err;
    if (err instanceof ListingCompareError) throw err;
    throw new ListingCompareError(err instanceof Error ? err.message : String(err));
  }
}

function buildPrompt(drafts: ListingDraftRow[]): string {
  const cards = drafts.map((d) => {
    const bullets = parseList<string>(d.bullets);
    const keywords = parseList<string>(d.search_keywords);
    const warnings = parseList<string>(d.warnings);
    return [
      `Draft (id=${d.id}):`,
      `  platform: ${d.platform}`,
      `  language: ${d.language}`,
      `  title (${(d.title ?? '').length} chars): ${d.title ?? ''}`,
      `  bullets (${bullets.length}):`,
      ...bullets.map((b, i) => `    ${i + 1}. ${b}`),
      d.description ? `  description: ${d.description.slice(0, 600)}` : '',
      `  keywords (${keywords.length}): ${keywords.join(' ')}`,
      warnings.length ? `  warnings: ${warnings.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    'Evaluate the listing drafts below. For each, score 0-100 on:',
    '- score_seo: keyword coverage, semantic relevance for 2026 marketplace ranking algorithms (Amazon A10/COSMO/Rufus, TikTok semantic search, Etsy tags)',
    '- score_conversion: hook strength, benefit-led bullets, scannability, mobile readability',
    '- score_compliance: free of fake certifications, medical claims, competitor brand misuse, platform-specific length compliance',
    '- score_total: weighted overall (SEO 35% + Conversion 45% + Compliance 20%)',
    '',
    'verdict: recommended (best) / second-pick (close) / rewrite (problems) / situational (depends on context)',
    'strengths / weaknesses: 1-3 short phrases each, concrete (not "good copy")',
    'cross_cutting_issues: problems shared by ALL drafts (e.g. "all use the same weak opening hook")',
    'recommended_id MUST be one of the input draft ids verbatim.',
    '',
    ...cards,
  ].join('\n');
}

function parseList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = `You are a senior cross-border e-commerce listing copywriter and conversion strategist.
Compare the candidate listing drafts on three real-world dimensions:
1. SEO/discoverability for the target platform (different per platform — Amazon weighs differently than TikTok)
2. Conversion psychology (hook strength, benefit clarity, mobile scannability)
3. Compliance (fake certifications, medical claims, competitor brand mentions, length cap violations)

Be concrete in strengths/weaknesses. Say "title leads with brand instead of keyword" not "title could be better".
Output strict JSON. recommended_id MUST be one of the input draft ids verbatim.`;
