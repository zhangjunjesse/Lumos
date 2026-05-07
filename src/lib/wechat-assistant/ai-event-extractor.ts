import { generateObjectWithFallback } from '@/lib/text-generator';

import type { WeChatSnapshot } from './analysis';
import type { WeChatAssistantAIPayload } from './ai-types';
import { AI_SYSTEM_PROMPT, buildAiPromptContext } from './ai-prompt';
import {
  aiResponseSchema,
  enrichEvents,
  enrichTodos,
} from './ai-event-shape';
import {
  cropSnapshotForLlm,
  type CroppedSnapshot,
  type LlmMessage,
} from './ai-snapshot-crop';

export interface ExtractInput {
  snapshot: WeChatSnapshot;
  providerId: string;
  model: string;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  cropOptions?: { windowDays?: number; perConvLimit?: number; globalLimit?: number };
}

export interface ExtractResult extends WeChatAssistantAIPayload {
  cropped: CroppedSnapshot;
}

export async function extractEventsAndTodos(input: ExtractInput): Promise<ExtractResult> {
  const cropped = cropSnapshotForLlm(input.snapshot, input.cropOptions);
  if (cropped.messages.length === 0) {
    return { events: [], todos: [], cropped };
  }

  const promptContext = buildAiPromptContext(cropped.messages);
  const raw = await generateObjectWithFallback({
    providerId: input.providerId,
    model: input.model,
    system: input.systemPrompt || AI_SYSTEM_PROMPT,
    prompt: promptContext.prompt,
    schema: aiResponseSchema,
    maxTokens: 4096,
    temperature: 0.1,
    abortSignal: input.abortSignal,
  });

  const messageByIdx = new Map<number, LlmMessage>();
  for (const m of cropped.messages) messageByIdx.set(m.idx, m);

  return {
    events: enrichEvents(raw.events, messageByIdx, promptContext.sourcesByKey),
    todos: enrichTodos(raw.todos, messageByIdx),
    cropped,
  };
}
