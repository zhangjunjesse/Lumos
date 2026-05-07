/**
 * Orchestrates AI topic extraction from mirror messages.
 *
 * Flow:
 *   1. Read settings (whitelist, batch size, min messages, provider/model).
 *   2. For each whitelisted chat in the analysis window, fetch messages.
 *   3. Skip chats below minChatMessages.
 *   4. Chunk per-chat messages by maxMessagesPerCall.
 *   5. Call LLM per chunk → topic list per chunk.
 *   6. Merge topics across chunks (lowercase title fuzzy match).
 *   7. Save the merged result to the mirror.
 *
 * The chat-major loop preserves conversational context for the LLM. We
 * only mix multiple chats inside a single call when their combined size
 * is well under the batch budget AND they're the same scope (personal /
 * group). For first iteration we keep one chat per call for clarity —
 * easier to reason about, slightly higher cost, much better accuracy.
 *
 * One in-flight extraction at a time per scope (module-level mutex).
 */

import { generateObjectWithFallback } from '@/lib/text-generator';

import {
  getTopicSummary,
  hasTopicDailySummary,
  queryMessagesForChats,
  queryMessagesForChatsInRange,
  saveTopicSummary,
  saveTopicDailySummary,
  setTopicDailyState,
  setTopicState,
  type ChatMessagesBundle,
  type TopicEntry,
  type TopicSourceSummary,
  type TopicScope,
} from './mirror-store';
import { resolveWeChatTextGenerationTarget } from './provider-options';
import { getWeChatAssistantSettings } from './settings-store';
import {
  businessDayBounds,
  lastCompletedBusinessDate,
  normalizeBusinessDate,
} from './topic-time';
import { runSync } from './sync-engine';
import {
  buildUserPrompt,
  renderSystemPrompt,
  topicResponseSchema,
  type ChatBundleSlice,
  type TopicResponse,
} from './topic-prompt';
import {
  displayWechatName,
  safeSanitizedWechatText,
  sanitizeWechatText,
} from './wechat-text';
import type { AppSettings } from '@/components/apps/builtin/wechat/app-settings';

export type TopicProgressEvent =
  | { type: 'start'; scope: TopicScope; chatCount: number; batchCount: number }
  | { type: 'sync'; scope: TopicScope; status: 'running' | 'done'; message: string }
  | { type: 'batch'; scope: TopicScope; batchIndex: number; batchTotal: number; chat: string }
  | { type: 'batch_done'; scope: TopicScope; batchIndex: number; topicsFound: number }
  | { type: 'done'; scope: TopicScope; topics: TopicEntry[]; messageCount: number; chatCount: number }
  | { type: 'skipped'; scope: TopicScope; reason: TopicSkipReason }
  | { type: 'error'; scope: TopicScope; message: string };

export type TopicSkipReason =
  | 'whitelist_empty'
  | 'no_provider'
  | 'no_model'
  | 'no_messages'
  | 'sync_unavailable'
  | 'in_progress';

export interface RunTopicOptions {
  scope: TopicScope;
  /** YYYY-MM-DD business day; when provided, results are stored in daily archive. */
  businessDate?: string;
  /** Topic extraction should analyze fresh mirror data unless a caller already synced. */
  syncBeforeRun?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: TopicProgressEvent) => void;
}

export interface TopicResult {
  status: 'completed' | 'skipped' | 'failed';
  reason?: TopicSkipReason;
  businessDate?: string;
  topics: TopicEntry[];
  sources?: TopicSourceSummary[];
  messageCount: number;
  chatCount: number;
  error?: string;
}

const inFlight: Map<TopicScope, Promise<TopicResult>> = new Map();

export function isTopicExtractionInFlight(scope: TopicScope): boolean {
  return inFlight.has(scope);
}

export async function runTopicExtraction(opts: RunTopicOptions): Promise<TopicResult> {
  if (inFlight.has(opts.scope)) {
    opts.onEvent?.({ type: 'skipped', scope: opts.scope, reason: 'in_progress' });
    return inFlight.get(opts.scope)!;
  }
  const promise = doRun(opts).finally(() => {
    inFlight.delete(opts.scope);
  });
  inFlight.set(opts.scope, promise);
  return promise;
}

export async function runDueTopicExtractions(nowMs = Date.now()): Promise<void> {
  const businessDate = lastCompletedBusinessDate(nowMs);
  await Promise.all((['personal', 'group'] as TopicScope[]).map(async (scope) => {
    if (hasTopicDailySummary(scope, businessDate, nowMs) || isTopicExtractionInFlight(scope)) return;
    try {
      await runTopicExtraction({ scope, businessDate });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTopicDailyState(scope, businessDate, 'failed', message);
    }
  }));
}

async function doRun(opts: RunTopicOptions): Promise<TopicResult> {
  const { scope, onEvent = () => undefined, signal } = opts;
  const businessDate = normalizeBusinessDate(opts.businessDate);
  const businessWindow = businessDate ? businessDayBounds(businessDate) : null;
  const settings = getWeChatAssistantSettings();
  const whitelist = whitelistFor(scope, settings);

  if (whitelist.length === 0) {
    setTopicState(scope, 'idle');
    if (businessDate) setTopicDailyState(scope, businessDate, 'skipped', 'whitelist_empty');
    onEvent({ type: 'skipped', scope, reason: 'whitelist_empty' });
    return failSkip('whitelist_empty', businessDate);
  }
  const target = resolveTopicModel(settings);
  if ('error' in target) {
    setTopicState(scope, 'idle');
    if (businessDate) setTopicDailyState(scope, businessDate, 'skipped', target.error);
    onEvent({ type: 'skipped', scope, reason: target.error });
    return failSkip(target.error, businessDate);
  }

  if (opts.syncBeforeRun !== false) {
    onEvent({ type: 'sync', scope, status: 'running', message: '正在同步微信消息…' });
    const sync = await runSync({ signal });
    if (sync.status === 'failed') {
      const message = `微信消息同步失败：${sync.error ?? '未知错误'}`;
      setTopicState(scope, 'failed', message);
      if (businessDate) setTopicDailyState(scope, businessDate, 'failed', message);
      onEvent({ type: 'error', scope, message });
      return {
        status: 'failed',
        businessDate: businessDate ?? undefined,
        topics: [],
        sources: [],
        messageCount: 0,
        chatCount: 0,
        error: message,
      };
    }
    if (sync.status === 'skipped' && sync.reason !== 'in_progress') {
      setTopicState(scope, 'idle');
      if (businessDate) setTopicDailyState(scope, businessDate, 'skipped', 'sync_unavailable');
      onEvent({ type: 'skipped', scope, reason: 'sync_unavailable' });
      return failSkip('sync_unavailable', businessDate);
    }
    onEvent({
      type: 'sync',
      scope,
      status: 'done',
      message: `同步完成 · 新增 ${sync.inserted.toLocaleString('zh-CN')} 条`,
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const allBundles = businessWindow
    ? queryMessagesForChatsInRange(whitelist, businessWindow.startTs, businessWindow.endTs)
    : queryMessagesForChats(whitelist, settings.ai.windowDays, nowSec);
  const bundles = allBundles.filter(
    (b) => b.messages.length >= settings.topicAnalysis.minChatMessages,
  );

  if (bundles.length === 0) {
    setTopicState(scope, 'done');
    if (businessDate) {
      setTopicDailyState(scope, businessDate, 'done');
      saveTopicDailySummary({
        scope,
        businessDate,
        windowStartTs: businessWindow!.startTs,
        windowEndTs: businessWindow!.endTs,
        messageCount: 0,
        chatCount: 0,
        sources: [],
      });
    }
    onEvent({ type: 'skipped', scope, reason: 'no_messages' });
    saveTopicSummary({
      scope,
      windowDays: settings.ai.windowDays,
      messageCount: 0,
      chatCount: 0,
      topics: [],
    });
    return { status: 'completed', businessDate: businessDate ?? undefined, topics: [], sources: [], messageCount: 0, chatCount: 0 };
  }

  const batches = planBatches(bundles, settings.topicAnalysis.maxMessagesPerCall);
  setTopicState(scope, 'running');
  if (businessDate) setTopicDailyState(scope, businessDate, 'running');
  onEvent({
    type: 'start',
    scope,
    chatCount: bundles.length,
    batchCount: batches.length,
  });

  const collected: TopicEntry[] = [];
  const sourceMap = new Map<string, TopicSourceSummary>();
  let processedMessages = 0;

  try {
    for (let i = 0; i < batches.length; i += 1) {
      if (signal?.aborted) throw new Error('aborted');
      const batch = batches[i];
      onEvent({
        type: 'batch',
        scope,
        batchIndex: i,
        batchTotal: batches.length,
        chat: batch.label,
      });
      const topics = await callLLM(batch, scope, settings, target, signal);
      const tagged = topics.map<TopicEntry>((t) => ({
        title: safeSanitizedWechatText(t.title, '微信话题').slice(0, 40),
        summary: safeSanitizedWechatText(t.summary, '相关对话有新的讨论').slice(0, 200),
        messageCount: Math.max(0, Math.round(t.messageCount || 0)),
        participants: sanitizeParticipants(batch.participants),
      }));
      collected.push(...tagged);
      const source = sourceMap.get(batch.wxid) ?? {
        wxid: batch.wxid,
        display: batch.display,
        isGroup: batch.isGroup,
        messageCount: 0,
        topics: [],
        days: businessDate ? [businessDate] : [],
      };
      source.messageCount += batch.messageCount;
      source.topics = mergeTopics([...source.topics, ...tagged]);
      sourceMap.set(batch.wxid, source);
      processedMessages += batch.messageCount;
      onEvent({
        type: 'batch_done',
        scope,
        batchIndex: i,
        topicsFound: tagged.length,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setTopicState(scope, 'failed', message);
    if (businessDate) setTopicDailyState(scope, businessDate, 'failed', message);
    onEvent({ type: 'error', scope, message });
    return {
      status: 'failed',
      businessDate: businessDate ?? undefined,
      topics: collected,
      sources: Array.from(sourceMap.values()),
      messageCount: processedMessages,
      chatCount: bundles.length,
      error: message,
    };
  }

  const merged = mergeTopics(collected);
  const sources = Array.from(sourceMap.values())
    .map((source) => ({
      ...source,
      topics: source.topics.sort((a, b) => b.messageCount - a.messageCount),
    }))
    .sort((a, b) => b.messageCount - a.messageCount);

  saveTopicSummary({
    scope,
    windowDays: settings.ai.windowDays,
    messageCount: processedMessages,
    chatCount: bundles.length,
    topics: merged,
  });
  if (businessDate && businessWindow) {
    saveTopicDailySummary({
      scope,
      businessDate,
      windowStartTs: businessWindow.startTs,
      windowEndTs: businessWindow.endTs,
      messageCount: processedMessages,
      chatCount: bundles.length,
      sources,
    });
  }

  onEvent({
    type: 'done',
    scope,
    topics: merged,
    messageCount: processedMessages,
    chatCount: bundles.length,
  });

  return {
    status: 'completed',
    businessDate: businessDate ?? undefined,
    topics: merged,
    sources,
    messageCount: processedMessages,
    chatCount: bundles.length,
  };
}

function whitelistFor(scope: TopicScope, settings: AppSettings): string[] {
  const set = scope === 'personal'
    ? settings.topicAnalysis.whitelistPersonal
    : settings.topicAnalysis.whitelistGroups;
  // Drop wxids that are also globally excluded — privacy default wins.
  const excluded = new Set(settings.excludedPersonIds);
  return Array.from(new Set(set.filter((wxid) => !excluded.has(wxid))));
}

interface BatchPlan {
  wxid: string;
  display: string;
  isGroup: boolean;
  label: string;
  bundles: ChatBundleSlice[];
  participants: string[];
  messageCount: number;
}

/**
 * Single chat → 1+ batches (split by maxMessagesPerCall).
 * Each batch carries a single chat's messages so the LLM has coherent context.
 */
export function planBatches(
  bundles: ChatMessagesBundle[],
  maxPerCall: number,
): BatchPlan[] {
  const max = Math.max(50, maxPerCall);
  const out: BatchPlan[] = [];
  for (const bundle of bundles) {
    const display = displayWechatName(bundle.display, bundle.wxid, {
      groupFallback: '微信群聊',
      contactFallback: '微信联系人',
    });
    if (bundle.messages.length <= max) {
      out.push({
        wxid: bundle.wxid,
        display,
        isGroup: bundle.isGroup,
        label: display,
        bundles: [{ ...bundle, display }],
        participants: participantsForMessages(bundle, display),
        messageCount: bundle.messages.length,
      });
      continue;
    }
    // Split: oldest → newest in fixed-size chunks
    let cursor = 0;
    let part = 1;
    const totalParts = Math.ceil(bundle.messages.length / max);
    while (cursor < bundle.messages.length) {
      const slice = bundle.messages.slice(cursor, cursor + max);
      out.push({
        wxid: bundle.wxid,
        display,
        isGroup: bundle.isGroup,
        label: `${display} (${part}/${totalParts})`,
        bundles: [{
          wxid: bundle.wxid,
          display,
          isGroup: bundle.isGroup,
            messages: slice,
          }],
        participants: participantsForMessages({ ...bundle, messages: slice }, display),
        messageCount: slice.length,
      });
      cursor += max;
      part += 1;
    }
  }
  return out;
}

function participantsForMessages(bundle: ChatMessagesBundle, display: string): string[] {
  if (!bundle.isGroup) return [display];
  const names = new Set<string>();
  for (const message of bundle.messages) {
    const name = message.sender === 'me'
      ? '我'
      : displayWechatName(message.senderDisplay, null, { contactFallback: '群成员' });
    if (name) names.add(name);
    if (names.size >= 12) break;
  }
  return names.size > 0 ? Array.from(names) : ['群成员'];
}

async function callLLM(
  batch: BatchPlan,
  scope: TopicScope,
  settings: AppSettings,
  target: { providerId: string; model: string },
  signal?: AbortSignal,
): Promise<TopicResponse['topics']> {
  const system = renderSystemPrompt(settings.ai.prompts.topicExtractor, {
    scope,
    windowDays: settings.ai.windowDays,
  });
  const prompt = buildUserPrompt({
    scope,
    bundles: batch.bundles,
    windowDays: settings.ai.windowDays,
  });
  try {
    const result = await generateObjectWithFallback({
      providerId: target.providerId,
      model: target.model,
      system,
      prompt,
      schema: topicResponseSchema,
      maxTokens: 2048,
      temperature: 0.2,
      abortSignal: signal,
    });
    return result.topics;
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) throw err;
    console.warn('[wechat-assistant] Topic AI output failed; using local fallback:', err);
    return fallbackTopicsForBatch(batch, scope);
  }
}

type TopicModelResolution =
  | { providerId: string; model: string }
  | { error: 'no_provider' | 'no_model' };

function resolveTopicModel(settings: AppSettings): TopicModelResolution {
  const target = resolveWeChatTextGenerationTarget(settings, 'sonnet');
  if (!target.ok) return { error: target.code };
  return { providerId: target.providerId, model: target.model };
}

/**
 * Merge topics from multiple batches:
 *   - normalize titles (lowercased, whitespace trimmed)
 *   - same-normalized titles get message_counts summed and participants unioned
 *   - sort by messageCount descending
 */
export function mergeTopics(topics: TopicEntry[]): TopicEntry[] {
  const acc = new Map<string, TopicEntry>();
  for (const rawTopic of topics) {
    const t = sanitizeTopicEntry(rawTopic);
    if (!t) continue;
    const key = normalizeTitle(t.title);
    if (!key) continue;
    const existing = acc.get(key);
    if (!existing) {
      acc.set(key, { ...t, participants: [...new Set(t.participants)] });
      continue;
    }
    existing.messageCount += t.messageCount;
    existing.participants = [...new Set([...existing.participants, ...t.participants])];
    // Keep the longer summary for richer description
    if (t.summary.length > existing.summary.length) existing.summary = t.summary;
  }
  return Array.from(acc.values()).sort((a, b) => b.messageCount - a.messageCount);
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

const TOPIC_FALLBACK_STOPWORDS = new Set([
  '一个', '一下', '一些', '不是', '不能', '不要', '今天', '明天', '昨天', '上午', '下午', '晚上',
  '这个', '那个', '这些', '那些', '我们', '你们', '他们', '她们', '它们', '自己', '大家',
  '可以', '可能', '应该', '需要', '麻烦', '辛苦', '已经', '还是', '没有', '因为', '所以',
  '然后', '如果', '但是', '就是', '觉得', '知道', '看看', '确认', '收到', '好的', '可以的',
  '哈哈', '哈哈哈', '嗯嗯', '微信', '消息', '群聊', '私聊',
]);

interface WordSegment {
  segment: string;
  isWordLike?: boolean;
}

interface WordSegmenter {
  segment(input: string): Iterable<WordSegment>;
}

type SegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
) => WordSegmenter;

function fallbackTopicsForBatch(batch: BatchPlan, scope: TopicScope): TopicResponse['topics'] {
  const tokenScores = new Map<string, { count: number; chats: Set<string> }>();
  for (const bundle of batch.bundles) {
    for (const message of bundle.messages) {
      for (const token of tokenizeFallbackTopicText(message.content)) {
        const current = tokenScores.get(token) ?? { count: 0, chats: new Set<string>() };
        current.count += 1;
        current.chats.add(bundle.display);
        tokenScores.set(token, current);
      }
    }
  }

  const ranked = Array.from(tokenScores.entries())
    .filter(([, stat]) => stat.count >= 2 || batch.messageCount < 8)
    .sort((a, b) => {
      const scoreA = a[1].count * Math.min(a[0].length, 8);
      const scoreB = b[1].count * Math.min(b[0].length, 8);
      return scoreB - scoreA;
    })
    .slice(0, 8);

  if (ranked.length === 0) {
    return [{
      title: scope === 'group' ? '群聊消息讨论' : '私聊消息讨论',
      summary: `AI 返回格式异常，已用本地兜底保留 ${batch.messageCount} 条消息的分析入口；稍后可重新生成获得更准确话题。`,
      messageCount: batch.messageCount,
    }];
  }

  return ranked.slice(0, 5).map(([token, stat]) => ({
    title: token.slice(0, 40),
    summary: `本地兜底识别：近 ${batch.messageCount} 条消息中多次出现「${token}」，涉及 ${stat.chats.size} 个对话；稍后可重新生成获得 AI 归纳。`,
    messageCount: stat.count,
  }));
}

function tokenizeFallbackTopicText(text: string): string[] {
  const cleaned = sanitizeWechatText(text)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[[^\]]{1,12}\]/g, ' ')
    .replace(/[^\p{Script=Han}A-Za-z0-9._+-]+/gu, ' ')
    .trim();
  if (!cleaned) return [];

  const segmenter = getWordSegmenter();
  const rawTokens = segmenter
    ? Array.from<WordSegment>(segmenter.segment(cleaned))
      .filter((part) => part.isWordLike !== false)
      .map((part) => part.segment)
    : cleaned.match(/[\p{Script=Han}]{2,12}|[A-Za-z0-9][A-Za-z0-9._+-]{1,30}/gu) ?? [];

  return rawTokens
    .map(normalizeFallbackToken)
    .filter((token): token is string => Boolean(token));
}

function normalizeFallbackToken(raw: string): string | null {
  const token = raw.trim().replace(/^[._+-]+|[._+-]+$/g, '');
  if (!token) return null;
  if (/^\d+$/.test(token)) return null;
  if (token.length < 2) return null;
  if (TOPIC_FALLBACK_STOPWORDS.has(token)) return null;
  if (/^[哈啊呀哦额嗯]+$/.test(token)) return null;
  return token.slice(0, 40);
}

function getWordSegmenter(): WordSegmenter | null {
  const intlWithSegmenter = Intl as typeof Intl & { Segmenter?: SegmenterCtor };
  if (!intlWithSegmenter.Segmenter) return null;
  return new intlWithSegmenter.Segmenter('zh-CN', { granularity: 'word' });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sanitizeTopicEntry(topic: TopicEntry): TopicEntry | null {
  if (!topic.title.trim()) return null;
  const title = sanitizeWechatText(topic.title) || '微信话题';
  const summary = sanitizeWechatText(topic.summary) || '相关对话有新的讨论';
  return {
    title: title.slice(0, 40),
    summary: summary.slice(0, 200),
    messageCount: Math.max(0, Math.round(topic.messageCount || 0)),
    participants: sanitizeParticipants(topic.participants),
  };
}

function sanitizeParticipants(participants: string[]): string[] {
  const out: string[] = [];
  for (const participant of participants) {
    const cleaned = safeSanitizedWechatText(participant, '');
    if (!cleaned || out.includes(cleaned)) continue;
    out.push(cleaned);
  }
  return out;
}

function failSkip(reason: TopicSkipReason, businessDate?: string | null): TopicResult {
  return {
    status: 'skipped',
    reason,
    businessDate: businessDate ?? undefined,
    topics: [],
    sources: [],
    messageCount: 0,
    chatCount: 0,
  };
}

export { getTopicSummary };
