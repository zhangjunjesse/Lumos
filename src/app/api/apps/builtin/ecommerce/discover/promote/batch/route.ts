import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import {
  promoteCandidateToInput,
  DiscoverResearchError,
} from '@/lib/ecommerce-assistant/discover';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// each promote may run image:generate (~30s); cap batch at 6 → up to ~3 min
export const maxDuration = 300;

const BATCH_LIMIT = 6;

interface BatchOutcome {
  candidate_id: string;
  ok: boolean;
  input_id?: string;
  concept_image_path?: string | null;
  concept_image_failed?: string | null;
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: { candidate_ids?: unknown };
  try {
    body = (await req.json()) as { candidate_ids?: unknown };
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  const ids = Array.isArray(body.candidate_ids)
    ? (body.candidate_ids as unknown[]).map((x) => String(x).trim()).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'candidate_ids 不能为空。' }, { status: 400 });
  }
  if (ids.length > BATCH_LIMIT) {
    return NextResponse.json(
      { error: `单次最多 ${BATCH_LIMIT} 个候选。` },
      { status: 400 },
    );
  }

  const store = getEcommerceStore();
  ensureBuiltinStylePresets(store);

  const outcomes: BatchOutcome[] = [];
  let llmUnavailable = false;

  for (const candidateId of ids) {
    if (llmUnavailable) {
      outcomes.push({
        candidate_id: candidateId,
        ok: false,
        error: '前一项触发 LLM 不可用（如 API key 失效），剩余跳过。',
      });
      continue;
    }
    try {
      // each promote synchronously generates a concept image; allow 90s ceiling.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      let outcome;
      try {
        outcome = await promoteCandidateToInput(store, candidateId, ctrl.signal);
      } finally {
        clearTimeout(timer);
      }
      outcomes.push({
        candidate_id: candidateId,
        ok: true,
        input_id: outcome.inputId,
        concept_image_path: outcome.conceptImagePath,
        concept_image_failed: outcome.conceptImageFailed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ candidate_id: candidateId, ok: false, error: message });
      if (err instanceof EcommerceLlmUnavailableError) {
        llmUnavailable = true;
      }
      // DiscoverResearchError for "candidate not found" is non-fatal — continue
      // with the remaining candidates so a single missing id doesn't ruin the
      // whole batch.
      void DiscoverResearchError;
    }
  }

  const succeeded = outcomes.filter((o) => o.ok).length;
  return NextResponse.json({
    requested: ids.length,
    succeeded,
    failed: ids.length - succeeded,
    outcomes,
  });
}
