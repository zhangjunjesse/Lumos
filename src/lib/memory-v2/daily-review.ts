import { getDb } from '@/lib/db/connection';
import { parseMessageContent, type MessageContentBlock } from '@/types';
import {
  callKnowledgeObjectModel,
  getKnowledgeDefaultModel,
  isKnowledgeEnhancementUnavailableError,
} from '@/lib/knowledge/llm';
import { sessionDigestSchema, type SessionDigest } from './daily-review-schema';
import { getDigestPrompt } from './digest-prompt';
import { dayRangeUtcSql, localDayKey, resolveTimezone } from './day-window';
import {
  upsertDailyReview,
  type DailyReviewRecord,
  type DailyReviewTrigger,
  type DailyReviewWriteSession,
} from './daily-review-store';

// 每日复盘 = 当天全部会话的列表，每条会话各自压成一条小结（map，没有跨会话分析）。
// 不走增量游标、不按 200/500 截断；为成本有界做每会话消息上限 + 当天会话数上限，
// 触顶时如实标 truncated；无模型/失败时仍把会话列出来（可点开看原对话），绝不编造小结。

const MAX_MESSAGES_PER_SESSION = 40;
const MAX_SESSIONS_PER_RUN = 60;
const MAX_MESSAGE_CHARS = 1000;

interface MessageRow {
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  session_title: string;
  session_mode: string;
}

// 复盘只看真实用户会话：定时/手动/一次性工作流跑出来的会话(标题前缀)、
// 工作流调试会话(mode=workflow)都是自动化噪声，排除。
const AUTOMATION_TITLE_RE = /^\[(定时|手动|一次性)\]/;
function isAutomationSession(title: string, mode: string): boolean {
  return AUTOMATION_TITLE_RE.test(title.trim()) || mode === 'workflow';
}

interface SessionBundle {
  sessionId: string;
  title: string;
  transcript: string;
  messageCount: number;
}

function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function cleanMessageText(content: string): string {
  const withoutFiles = content.replace(/^<!--files:[\s\S]*?-->/, '').trim();
  let blocks: MessageContentBlock[];
  try {
    blocks = parseMessageContent(withoutFiles);
  } catch {
    return clip(withoutFiles, MAX_MESSAGE_CHARS);
  }
  const text = blocks
    .map((block) => (block.type === 'text' ? block.text : block.type === 'code' ? block.code : ''))
    .filter(Boolean)
    .join('\n');
  return clip(text, MAX_MESSAGE_CHARS);
}

function listDayMessages(startSql: string, endSql: string): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT m.session_id, m.role, m.content, m.created_at,
              COALESCE(s.title, '') AS session_title,
              COALESCE(s.mode, '') AS session_mode
         FROM messages m
         LEFT JOIN chat_sessions s ON s.id = m.session_id
        WHERE m.created_at >= ? AND m.created_at < ?
          AND m.role IN ('user', 'assistant')
        ORDER BY m.session_id ASC, m.rowid ASC`,
    )
    .all(startSql, endSql) as MessageRow[];
}

// 当天会话超上限时，保留消息量最大的前 N 个，并把 truncated 置真（不静默丢）。
function bundleSessions(rows: MessageRow[]): { bundles: SessionBundle[]; total: number; truncated: boolean } {
  const order: string[] = [];
  const grouped = new Map<string, MessageRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.session_id)) {
      grouped.set(row.session_id, []);
      order.push(row.session_id);
    }
    grouped.get(row.session_id)!.push(row);
  }
  const all = order
    .map((sessionId) => {
      const list = grouped.get(sessionId)!;
      const title = list[0].session_title;
      if (isAutomationSession(title, list[0].session_mode)) return null;
      const transcript = list
        .slice(-MAX_MESSAGES_PER_SESSION)
        .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${cleanMessageText(m.content)}`)
        .filter((line) => line.length > 3)
        .join('\n');
      return { sessionId, title, transcript, weight: list.length };
    })
    .filter((bundle): bundle is { sessionId: string; title: string; transcript: string; weight: number } =>
      bundle !== null && bundle.transcript.length > 0);
  const total = all.length;
  const truncated = total > MAX_SESSIONS_PER_RUN;
  const bundles = truncated
    ? [...all].sort((a, b) => b.weight - a.weight).slice(0, MAX_SESSIONS_PER_RUN)
    : all;
  return {
    bundles: bundles.map(({ sessionId, title, transcript, weight }) => ({
      sessionId, title, transcript, messageCount: weight,
    })),
    total,
    truncated,
  };
}

async function mapDigest(bundle: SessionBundle, model: string): Promise<SessionDigest> {
  return callKnowledgeObjectModel({
    model,
    system: getDigestPrompt().prompt,
    prompt: `会话标题：${bundle.title || '(无标题)'}\n\n对话：\n${bundle.transcript}`,
    schema: sessionDigestSchema,
    maxTokens: 1536,
    timeoutMs: 60000,
  });
}

function classifyError(error: unknown): { status: 'unavailable' | 'error'; reason: string } {
  if (isKnowledgeEnhancementUnavailableError(error)) {
    return { status: 'unavailable', reason: 'llm_unavailable' };
  }
  return { status: 'error', reason: error instanceof Error ? error.message : String(error) };
}

interface SessionMsgRow {
  role: 'user' | 'assistant';
  content: string;
  session_title: string;
}

function readSession(sessionId: string): { title: string; transcript: string; messageCount: number } {
  const rows = getDb()
    .prepare(
      `SELECT m.role, m.content, COALESCE(s.title, '') AS session_title
         FROM messages m
         LEFT JOIN chat_sessions s ON s.id = m.session_id
        WHERE m.session_id = ? AND m.role IN ('user', 'assistant')
        ORDER BY m.rowid ASC`,
    )
    .all(sessionId) as SessionMsgRow[];
  const transcript = rows
    .slice(-MAX_MESSAGES_PER_SESSION)
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${cleanMessageText(m.content)}`)
    .filter((line) => line.length > 3)
    .join('\n');
  return { title: rows[0]?.session_title || '', transcript, messageCount: rows.length };
}

// 「理解总结」按钮用：现在就读这一个会话、生成它的总结。无模型/失败不编造。
export async function generateSessionDigest(sessionId: string): Promise<{
  status: 'ok' | 'empty' | 'unavailable' | 'error';
  digest: SessionDigest | null;
  reason?: string;
}> {
  const { title, transcript, messageCount } = readSession(sessionId);
  if (!transcript) return { status: 'empty', digest: null };
  try {
    const model = getKnowledgeDefaultModel();
    const digest = await mapDigest({ sessionId, title, transcript, messageCount }, model);
    return { status: 'ok', digest };
  } catch (error) {
    const { status, reason } = classifyError(error);
    return { status, digest: null, reason };
  }
}

export async function runDailyReview(params: {
  trigger: DailyReviewTrigger;
  day?: string;
  timezone?: string | null;
}): Promise<DailyReviewRecord> {
  const timezone = resolveTimezone(params.timezone);
  const reviewDay = params.day?.trim() || localDayKey(new Date(), timezone);
  const startedAt = new Date().toISOString().replace('T', ' ').split('.')[0];
  const { startSql, endSql } = dayRangeUtcSql(reviewDay, timezone);
  const { bundles, total, truncated } = bundleSessions(listDayMessages(startSql, endSql));

  const base = {
    reviewDay,
    triggerType: params.trigger,
    sessionCount: total,
    truncated,
    startedAt,
  };
  const digests = new Map<string, SessionDigest>();
  const sourceSessions = (): DailyReviewWriteSession[] =>
    bundles.map((b) => ({
      id: b.sessionId,
      title: b.title,
      messageCount: b.messageCount,
      digest: digests.get(b.sessionId) ?? null,
    }));

  if (bundles.length === 0) {
    return upsertDailyReview({ ...base, status: 'empty', model: '', sourceSessions: [] });
  }

  const model = getKnowledgeDefaultModel();
  try {
    for (const bundle of bundles) {
      digests.set(bundle.sessionId, await mapDigest(bundle, model));
    }
    return upsertDailyReview({ ...base, status: 'ok', model, sourceSessions: sourceSessions() });
  } catch (error) {
    const { status, reason } = classifyError(error);
    // 小结失败也要把会话列出来——用户仍可点开看原对话。
    return upsertDailyReview({ ...base, status, model, error: reason, sourceSessions: sourceSessions() });
  }
}
