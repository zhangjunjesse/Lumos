import { z } from 'zod';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { generateStructured, EcommerceLlmUnavailableError } from './llm-client';
import { getCandidate, type DiscoverCandidateRow } from './storage';

export class DiscoverCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoverCompareError';
  }
}

const recommendationSchema = z.object({
  recommended_id: z.string().min(1),
  recommendation_summary: z
    .string()
    .min(1)
    .describe('one paragraph: which candidate you recommend and the deciding reason'),
  pairwise_notes: z
    .array(
      z.object({
        id: z.string().min(1),
        verdict: z.enum(['recommended', 'second-pick', 'avoid', 'situational']),
        reason: z.string().min(1),
      }),
    )
    .min(1)
    .describe('one entry per input candidate; verdict + 1-2 sentence reason'),
  next_actions: z
    .array(z.string())
    .max(5)
    .default([])
    .describe('actionable verification steps the user should take before committing'),
});

export interface CompareInput {
  weight: {
    demand: number;
    competition: number;
    profit: number;
    compliance: number;
    logistics: number;
  };
}

export interface CompareOutcome {
  recommendedId: string;
  summary: string;
  notes: Array<{ id: string; verdict: string; reason: string }>;
  nextActions: string[];
  weighted: Array<{ id: string; weightedScore: number }>;
}

export const DEFAULT_WEIGHT: CompareInput['weight'] = {
  demand: 0.3,
  competition: 0.25,
  profit: 0.25,
  compliance: 0.1,
  logistics: 0.1,
};

export async function compareCandidates(
  store: AppDataStore,
  candidateIds: string[],
  input?: Partial<CompareInput>,
  abortSignal?: AbortSignal,
): Promise<CompareOutcome> {
  if (candidateIds.length < 2) {
    throw new DiscoverCompareError('对比至少需要 2 个候选。');
  }
  if (candidateIds.length > 6) {
    throw new DiscoverCompareError('单次对比最多 6 个候选。');
  }
  const candidates = candidateIds
    .map((id) => getCandidate(store, id))
    .filter((c): c is DiscoverCandidateRow => c != null);
  if (candidates.length !== candidateIds.length) {
    throw new DiscoverCompareError('存在无效的候选 id，部分未找到。');
  }

  const weight = { ...DEFAULT_WEIGHT, ...(input?.weight ?? {}) };
  const weightSum =
    weight.demand + weight.competition + weight.profit + weight.compliance + weight.logistics;
  if (weightSum <= 0) {
    throw new DiscoverCompareError('权重总和必须大于 0。');
  }

  // Local deterministic weighted score so the user can see math even if LLM
  // disagrees. The LLM uses these scores plus qualitative context.
  const weighted = candidates.map((c) => ({
    id: c.id,
    weightedScore: computeWeighted(c, weight),
  }));

  try {
    const data = await generateStructured({
      schema: recommendationSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(candidates, weight, weighted),
      abortSignal,
      maxTokens: 4096,
    });
    if (!candidateIds.includes(data.recommended_id)) {
      throw new DiscoverCompareError(
        `LLM 推荐了不存在的候选 id：${data.recommended_id}`,
      );
    }
    return {
      recommendedId: data.recommended_id,
      summary: data.recommendation_summary,
      notes: data.pairwise_notes.filter((n) => candidateIds.includes(n.id)),
      nextActions: data.next_actions,
      weighted,
    };
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) throw err;
    if (err instanceof DiscoverCompareError) throw err;
    throw new DiscoverCompareError(err instanceof Error ? err.message : String(err));
  }
}

function computeWeighted(c: DiscoverCandidateRow, w: CompareInput['weight']): number {
  const v =
    (c.score_demand ?? 50) * w.demand +
    (c.score_competition ?? 50) * w.competition +
    (c.score_profit ?? 50) * w.profit +
    (c.score_compliance ?? 80) * w.compliance +
    (c.score_logistics ?? 70) * w.logistics;
  const sum = w.demand + w.competition + w.profit + w.compliance + w.logistics;
  return Math.round(v / sum);
}

function buildPrompt(
  candidates: DiscoverCandidateRow[],
  w: CompareInput['weight'],
  weighted: Array<{ id: string; weightedScore: number }>,
): string {
  const weightedById = new Map(weighted.map((x) => [x.id, x.weightedScore]));
  const cards = candidates.map((c, idx) => {
    const points = safeParseList<string>(c.selling_points);
    const risks = safeParseList<string>(c.risks);
    return [
      `Candidate #${idx + 1} (id=${c.id}):`,
      `  product_name: ${c.product_name}`,
      `  category: ${c.category}`,
      c.estimated_price_usd ? `  est. price: $${c.estimated_price_usd}` : '',
      `  scores: demand=${c.score_demand} competition=${c.score_competition} profit=${c.score_profit} compliance=${c.score_compliance} logistics=${c.score_logistics}`,
      `  weighted (per user weights): ${weightedById.get(c.id)}`,
      c.summary ? `  summary: ${c.summary}` : '',
      c.differentiation ? `  differentiation: ${c.differentiation}` : '',
      points.length ? `  selling points: ${points.join(' / ')}` : '',
      risks.length ? `  risks: ${risks.join(' / ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    'Compare the candidates below and recommend the single best pick for this user.',
    '',
    `User weight preference (sum-normalized): demand=${w.demand}, competition=${w.competition}, profit=${w.profit}, compliance=${w.compliance}, logistics=${w.logistics}`,
    'Higher competition score = LESS competition (blue ocean). Higher logistics = easier to ship.',
    '',
    ...cards,
    '',
    'Output strict JSON. recommended_id MUST be one of the listed candidate ids verbatim.',
    'pairwise_notes MUST include EVERY candidate id (one entry each).',
    'next_actions: 2-5 concrete verification steps (e.g. "open the Amazon search URL and inspect top-3 review counts").',
    'Be honest: if no candidate is great, say so in the summary and pick the least-bad with a "situational" verdict for others.',
  ].join('\n');
}

function safeParseList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = `You are a senior cross-border e-commerce sourcing analyst helping a seller pick between several pre-scored product candidates.
Output strict JSON matching the schema.
Decision rule: combine the user's weighted score with qualitative factors (differentiation strength, risk concentration, novelty vs proven demand).
Be conservative: when candidates are similarly good, prefer the lower-risk pick and say so.
Never invent new candidates. Never invent platform-specific data you weren't given.`;
