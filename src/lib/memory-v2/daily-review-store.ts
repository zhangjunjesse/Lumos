import crypto from 'crypto';
import { getDb } from '@/lib/db/connection';
// 写入侧 digest 没有 id（id 仅在读时由 parseDigest 按内容确定性派生，从不落库）。
import type { SessionDigest as WriteDigest } from './daily-review-schema';

export type DailyReviewStatus = 'ok' | 'empty' | 'unavailable' | 'error';
export type DailyReviewTrigger = 'daily' | 'manual' | 'api';

export interface DigestEvent {
  id: string; // 需求唯一编号：hash(sessionId|需求)，确定性，不靠下标也不靠 LLM
  requirement: string; // 需求
  process: string; // 执行过程
  outcome: string; // 结果
  shortcomings: string[]; // 不足
}

export type DigestInsightType = '用户偏好' | '经验' | '能力缺口';

export interface DigestInsight {
  id: string; // 洞察唯一编号：hash(sessionId|type|content)
  type: DigestInsightType;
  content: string;
}

// 确定性编号：内容不变 → 编号不变（重新生成能对应/更新；内容变即视为新条目）。
export function digestId(...parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

export interface DailyReviewSessionDigest {
  events: DigestEvent[];
  insights: DigestInsight[];
}

// 读出来的（digest 带派生 id），UI/关联用这个。
export interface DailyReviewSourceSession {
  id: string;
  title: string;
  messageCount: number;
  digest: DailyReviewSessionDigest | null;
}

// 写进去的（digest 无 id，就是 LLM/schema 形状），upsert 用这个。
export interface DailyReviewWriteSession {
  id: string;
  title: string;
  messageCount: number;
  digest: WriteDigest | null;
}

export interface DailyReviewRecord {
  id: string;
  reviewDay: string;
  status: DailyReviewStatus;
  triggerType: DailyReviewTrigger | string;
  sessionCount: number;
  truncated: boolean;
  model: string;
  sourceSessions: DailyReviewSourceSession[];
  error: string;
  startedAt: string;
  completedAt: string;
}

interface DailyReviewRow {
  id: string;
  review_day: string;
  status: DailyReviewStatus;
  trigger_type: string;
  session_count: number;
  truncated: number;
  model: string;
  source_sessions_json: string;
  error: string;
  started_at: string;
  completed_at: string;
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
}

// 新结构 = { events:[{requirement,process,outcome,shortcomings}] }。
// 向后兼容旧结构：{items:[{type,content}]} 或最早的 {intent,outcome,failures} → 合并成 1 个事件。
// sessionId 必传：编号按会话域算，跨会话不撞。
function parseDigest(d: unknown, sessionId: string): DailyReviewSessionDigest | null {
  if (!d || typeof d !== 'object') return null;
  const obj = d as Record<string, unknown>;

  const insightTypes: DigestInsightType[] = ['用户偏好', '经验', '能力缺口'];
  const insights: DigestInsight[] = Array.isArray(obj.insights)
    ? (obj.insights as Array<Record<string, unknown>>)
        .filter((x) => x && typeof x === 'object')
        .map((x) => {
          const type = String(x.type) as DigestInsightType;
          const content = String(x.content || '').trim();
          return { id: digestId(sessionId, type, content), type, content };
        })
        .filter((x) => insightTypes.includes(x.type) && x.content)
    : [];

  if (Array.isArray(obj.events)) {
    const events = obj.events
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
      .map((e) => {
        const requirement = String(e.requirement || '').trim();
        return {
          id: digestId(sessionId, requirement),
          requirement,
          process: String(e.process || '').trim(),
          outcome: String(e.outcome || '').trim(),
          shortcomings: strList(e.shortcomings),
        };
      })
      .filter((e) => e.requirement || e.process || e.outcome || e.shortcomings.length > 0);
    return { events, insights };
  }

  // 旧格式 → 折叠成单个事件
  let requirement = '';
  let outcome = '';
  const shortcomings: string[] = [];
  if (Array.isArray(obj.items)) {
    for (const it of obj.items as Array<Record<string, unknown>>) {
      const c = String(it?.content || '').trim();
      if (!c) continue;
      if (it?.type === '意图') requirement = requirement || c;
      else if (it?.type === '结果') outcome = outcome || c;
      else shortcomings.push(c);
    }
  } else {
    if (typeof obj.intent === 'string') requirement = obj.intent.trim();
    if (typeof obj.outcome === 'string') outcome = obj.outcome.trim();
    shortcomings.push(...strList(obj.failures));
  }
  if (!requirement && !outcome && shortcomings.length === 0 && insights.length === 0) return null;
  return {
    events: requirement || outcome || shortcomings.length > 0
      ? [{ id: digestId(sessionId, requirement), requirement, process: '', outcome, shortcomings }]
      : [],
    insights,
  };
}

function safeSessions(raw: string): DailyReviewSourceSession[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => ({
        id: String(s.id),
        title: String(s.title || ''),
        messageCount: Number.isFinite(s.messageCount) ? Number(s.messageCount) : 0,
        digest: parseDigest(s.digest, String(s.id)),
      }));
  } catch {
    return [];
  }
}

function rowToRecord(row: DailyReviewRow): DailyReviewRecord {
  return {
    id: row.id,
    reviewDay: row.review_day,
    status: row.status,
    triggerType: row.trigger_type,
    sessionCount: row.session_count,
    truncated: row.truncated === 1,
    model: row.model,
    sourceSessions: safeSessions(row.source_sessions_json),
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

// 一天一条；重跑同一天覆盖。只存"会话列表 + 每条小结"，不写回 memory_v2_entries / sleep_runs（底线①）。
export function upsertDailyReview(input: {
  reviewDay: string;
  status: DailyReviewStatus;
  triggerType: DailyReviewTrigger;
  sessionCount: number;
  truncated: boolean;
  model: string;
  sourceSessions: DailyReviewWriteSession[];
  error?: string;
  startedAt: string;
}): DailyReviewRecord {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM memory_v2_daily_reviews WHERE review_day = ?')
    .get(input.reviewDay) as { id: string } | undefined;
  const id = existing?.id || crypto.randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO memory_v2_daily_reviews
       (id, review_day, status, trigger_type, session_count, truncated, model,
        source_sessions_json, error, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(review_day) DO UPDATE SET
       status = excluded.status,
       trigger_type = excluded.trigger_type,
       session_count = excluded.session_count,
       truncated = excluded.truncated,
       model = excluded.model,
       source_sessions_json = excluded.source_sessions_json,
       error = excluded.error,
       started_at = excluded.started_at,
       completed_at = excluded.completed_at`,
  ).run(
    id,
    input.reviewDay,
    input.status,
    input.triggerType,
    Math.max(0, Math.floor(input.sessionCount)),
    input.truncated ? 1 : 0,
    input.model || '',
    JSON.stringify(input.sourceSessions || []),
    input.error || '',
    input.startedAt,
    nowSql(),
  );
  return getDailyReview(input.reviewDay)!;
}

export function getDailyReview(reviewDay: string): DailyReviewRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM memory_v2_daily_reviews WHERE review_day = ?')
    .get(reviewDay) as DailyReviewRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function listDailyReviews(limit = 30): DailyReviewRecord[] {
  const safeLimit = Math.max(1, Math.min(limit, 180));
  const rows = getDb()
    .prepare('SELECT * FROM memory_v2_daily_reviews ORDER BY review_day DESC LIMIT ?')
    .all(safeLimit) as DailyReviewRow[];
  return rows.map(rowToRecord);
}

// 钻取详情用：按 sessionId 在最近的复盘里找到这条会话（含总结）。
export function findDailyReviewSession(
  sessionId: string,
): { reviewDay: string; session: DailyReviewSourceSession } | undefined {
  for (const review of listDailyReviews(180)) {
    const session = review.sourceSessions.find((s) => s.id === sessionId);
    if (session) return { reviewDay: review.reviewDay, session };
  }
  return undefined;
}

// 「理解总结」按钮用：把单条会话的总结写回它所在的复盘记录（不影响其它会话）。
export function setDailyReviewSessionDigest(
  sessionId: string,
  digest: WriteDigest,
): DailyReviewSourceSession | undefined {
  const found = findDailyReviewSession(sessionId);
  if (!found) return undefined;
  const review = getDailyReview(found.reviewDay);
  if (!review) return undefined;
  // 落库不带 id（读时 parseDigest 重新派生）；存了也无害，parseDigest 会忽略并按内容重算。
  const next = review.sourceSessions.map((s) => ({
    id: s.id,
    title: s.title,
    messageCount: s.messageCount,
    digest: s.id === sessionId ? digest : s.digest,
  }));
  getDb()
    .prepare('UPDATE memory_v2_daily_reviews SET source_sessions_json = ? WHERE review_day = ?')
    .run(JSON.stringify(next), found.reviewDay);
  return getDailyReview(found.reviewDay)?.sourceSessions.find((s) => s.id === sessionId);
}
