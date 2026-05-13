import { createHash } from 'node:crypto';

import type { AppSettings } from '@/components/apps/builtin/wechat/app-settings';
import { DEFAULT_PROMPTS } from '@/components/apps/builtin/wechat/default-prompts';

import type { WeChatSnapshot } from './analysis';
import { extractEventsAndTodos } from './ai-event-extractor';
import {
  createRun,
  getLatestRun,
  insertEvents,
  insertTodoSuggestions,
  listEventsByRun,
  listTodos,
  markRunDone,
  markRunFailed,
} from './db';
import type {
  WeChatAssistantRun,
  WeChatEvent,
  WeChatTodo,
} from './ai-types';
import { resolveWeChatTextGenerationTarget } from './provider-options';
import { getWeChatAssistantSettings } from './settings-store';

export interface RunAIAnalysisResult {
  run: WeChatAssistantRun;
  events: WeChatEvent[];
  /** Suggestions newly produced by this run. UI also shows already-confirmed/done todos separately. */
  newSuggestions: WeChatTodo[];
  /** All todos in the system (UI shows status sections). */
  allTodos: WeChatTodo[];
}

export class WeChatAIAnalysisError extends Error {
  constructor(public code: 'no_provider' | 'no_model' | 'extract_failed', message: string) {
    super(message);
    this.name = 'WeChatAIAnalysisError';
  }
}

export async function runAIAnalysis(
  snapshot: WeChatSnapshot,
  options: { abortSignal?: AbortSignal; settings?: AppSettings } = {},
): Promise<RunAIAnalysisResult> {
  const settings = options.settings ?? getWeChatAssistantSettings();
  const effectiveSnapshot = applySettingsToSnapshot(snapshot, settings);
  const target = resolveWeChatTextGenerationTarget(settings, 'sonnet');
  if (!target.ok) {
    throw new WeChatAIAnalysisError(target.code, target.message);
  }

  const snapshotHash = hashSnapshot(effectiveSnapshot);
  const run = createRun({
    snapshotHash,
    providerId: target.providerId,
    model: target.model,
    messagesScanned: effectiveSnapshot.messages.length,
  });

  try {
    const result = await extractEventsAndTodos({
      snapshot: effectiveSnapshot,
      providerId: target.providerId,
      model: target.model,
      systemPrompt: renderFollowupSystemPrompt(settings),
      cropOptions: { windowDays: settings.ai.windowDays },
      abortSignal: options.abortSignal,
    });
    const events = insertEvents(run.id, result.events);
    const newSuggestions = insertTodoSuggestions(run.id, result.todos);
    markRunDone(run.id, {
      eventsCount: events.length,
      todosCount: newSuggestions.length,
    });
    const allTodos = listTodos();
    return {
      run: { ...run, finishedAt: Date.now(), status: 'done', eventsCount: events.length, todosCount: newSuggestions.length },
      events,
      newSuggestions,
      allTodos,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markRunFailed(run.id, message);
    throw new WeChatAIAnalysisError('extract_failed', message);
  }
}

function applySettingsToSnapshot(snapshot: WeChatSnapshot, settings: AppSettings): WeChatSnapshot {
  const includedRaw = settings.includedPersonIds ?? [];
  const excluded = new Set(settings.excludedPersonIds);
  const hasIncluded = includedRaw.length > 0;
  const included = hasIncluded ? new Set(includedRaw) : null;
  if (!hasIncluded && excluded.size === 0) return snapshot;

  const passes = (wxid: string): boolean => {
    if (included && !included.has(wxid)) return false;
    if (excluded.has(wxid)) return false;
    return true;
  };

  const messages = snapshot.messages.filter((message) => passes(message.wxid));
  const sessions = snapshot.sessions.filter((session) => passes(session.wxid));
  return {
    ...snapshot,
    sessions,
    messages,
    messagesScanned: messages.length,
    selectedReadableMessages: Math.min(snapshot.selectedReadableMessages, messages.length),
  };
}

function renderFollowupSystemPrompt(settings: AppSettings): string {
  const base = settings.ai.prompts.followupExtractor || DEFAULT_PROMPTS.followupExtractor;
  const sensitivity = settings.ai.sensitivity;
  if (sensitivity === 'strict') {
    return `${base}\n\n灵敏度：严格。只输出证据明确、时间或动作清楚的 high confidence 跟进项；模糊寒暄、可能性很低的事项直接忽略。`;
  }
  if (sensitivity === 'loose') {
    return `${base}\n\n灵敏度：宽松。可以保留 medium confidence 的潜在线索，但必须能引用原消息作为证据，不能凭空补全。`;
  }
  return `${base}\n\n灵敏度：适中。优先输出有明确动作或回复需求的事项，少量 medium confidence 可保留。`;
}

export interface LatestAIAnalysisResult {
  run: WeChatAssistantRun | null;
  events: WeChatEvent[];
  todos: WeChatTodo[];
}

export function getLatestAIAnalysis(): LatestAIAnalysisResult {
  const run = getLatestRun();
  const events = run ? listEventsByRun(run.id) : [];
  const todos = listTodos();
  return { run, events, todos };
}

function hashSnapshot(snapshot: WeChatSnapshot): string {
  const fingerprint = snapshot.messages
    .slice(0, 4000)
    .map((m) => `${m.wxid}|${m.ts}|${m.type}`)
    .join(';');
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 24);
}

// re-export so the API route doesn't need to import from too many places
export { listEventsByRun };
