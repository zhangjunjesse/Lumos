import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { identifyProductBrief, EcommerceLlmUnavailableError } from './llm-client';
import { BRIEF_IDENTIFY_PROMPT, SYSTEM_PROMPT } from './prompts';
import {
  getInput,
  readReferenceImagePaths,
  upsertBrief,
  type ProductBriefRow,
} from './storage';

export class BriefIdentifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefIdentifyError';
  }
}

/**
 * Identify the product brief from the input's actual photos.
 *
 * This produces a high-confidence brief (typically 7-9) that REPLACES any
 * previously-synthesized brief from a discover candidate (which sat at
 * confidence 4). Call this:
 *   - after the user uploads a real product photo (replaces concept image)
 *   - on user-triggered "re-identify brief" action
 *   - inside the SOP engine before image generation (existing path)
 *
 * Throws BriefIdentifyError on LLM / IO failures so callers can decide
 * whether to surface the failure or swallow it (the synthesized brief from
 * promote-time is still good enough for listing-drafter to fall back to).
 */
export async function identifyBriefForInput(
  store: AppDataStore,
  inputId: string,
  abortSignal?: AbortSignal,
): Promise<ProductBriefRow> {
  const input = getInput(store, inputId);
  if (!input) {
    throw new BriefIdentifyError(`商品输入不存在：${inputId}`);
  }
  if (!input.main_image_path || !input.main_image_path.trim()) {
    throw new BriefIdentifyError('商品输入缺少主图路径，无法识别 brief。');
  }
  const refs = readReferenceImagePaths(input);
  const imagePaths = [input.main_image_path, ...refs].filter(Boolean);
  try {
    const brief = await identifyProductBrief({
      prompt: `${SYSTEM_PROMPT}\n\n${BRIEF_IDENTIFY_PROMPT}`,
      imagePaths,
      abortSignal,
    });
    return upsertBrief(store, {
      input_id: inputId,
      brief: brief as unknown as Record<string, unknown>,
      raw: JSON.stringify({
        source: 'identified-from-photo',
        identified_at: new Date().toISOString(),
        ...brief,
      }),
      confidence: brief.confidence ?? 7,
    });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) throw err;
    throw new BriefIdentifyError(err instanceof Error ? err.message : String(err));
  }
}
