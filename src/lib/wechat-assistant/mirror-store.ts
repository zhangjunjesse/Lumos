/**
 * Typed read / write helpers for the WeChat sync mirror.
 *
 * All callers go through these primitives so prepared statements get
 * cached, transactions are explicit, and the SQL stays in one place.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type Database from 'better-sqlite3';

import { getMirrorDb, MIRROR_DB_PATH } from './mirror-db';
import { SYNC_STATE_KEYS } from './mirror-schema';
import { businessDayBounds } from './topic-time';
import type { SnapshotMessage, SnapshotSession } from './overview-compute';
import {
  displayWechatName,
  safeSanitizedWechatText,
} from './wechat-text';

export interface MirrorSession {
  wxid: string;
  display: string;
  isGroup: boolean;
  lastTs: number; // unix seconds
  messageCount: number;
  unreadCount: number;
  summary: string;
}

export interface MirrorMessage {
  wxid: string;
  ts: number; // unix seconds
  sender: 'me' | 'them';
  senderWxid?: string | null;
  senderDisplay?: string | null;
  msgType: number;
  content: string;
  attachment?: WeChatMirrorAttachment | null;
}

export interface WeChatMirrorAttachment {
  kind: 'file';
  title: string;
  size?: number;
  sizeLabel?: string;
  ext?: string;
  localPath?: string;
  exists?: boolean;
}

export type MessageSearchScope = 'all' | 'personal' | 'group';
export type MessageSenderFilter = 'all' | 'me' | 'them';
export type MessageExportFormat = 'csv' | 'markdown';

export interface MessageSearchResult {
  wxid: string;
  display: string;
  isGroup: boolean;
  ts: number; // unix seconds
  sender: 'me' | 'them';
  senderDisplay: string | null;
  msgType: number;
  content: string;
}

export interface MessageSearchOptions {
  query?: string;
  scope?: MessageSearchScope;
  sender?: MessageSenderFilter;
  sinceTs?: number | null;
  fromTs?: number | null;
  toTs?: number | null;
  limit?: number;
  offset?: number;
}

export interface ChatReadCandidate {
  wxid: string;
  display: string;
  isGroup: boolean;
  lastTs: number;
  messageCount: number;
  unreadCount: number;
  summary: string;
}

export interface ChatReadMessage {
  ts: number;
  sender: 'me' | 'them';
  senderDisplay: string | null;
  msgType: number;
  content: string;
  attachment: WeChatMirrorAttachment | null;
}

export interface ChatReadResult {
  status: 'ok' | 'not_found' | 'ambiguous';
  query: string;
  chat: ChatReadCandidate | null;
  candidates: ChatReadCandidate[];
  messages: ChatReadMessage[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface ChatReadOptions {
  chat: string;
  scope?: MessageSearchScope;
  sinceTs?: number | null;
  beforeTs?: number | null;
  limit?: number;
  offset?: number;
}

export interface MessageContextResult {
  wxid: string;
  display: string;
  isGroup: boolean;
  targetTs: number;
  messages: Array<{
    ts: number;
    sender: 'me' | 'them';
    senderDisplay: string | null;
    content: string;
  }>;
}

/* ─── Sessions ──────────────────────────────────────────────────── */

export function upsertSessions(rows: MirrorSession[]): number {
  if (rows.length === 0) return 0;
  const conn = getMirrorDb();
  const now = Date.now();
  const stmt = conn.prepare(`
    INSERT INTO sessions (wxid, display, is_group, last_ts, message_count, unread_count, summary, updated_at)
    VALUES (@wxid, @display, @isGroup, @lastTs, @messageCount, @unreadCount, @summary, @updatedAt)
    ON CONFLICT(wxid) DO UPDATE SET
      display       = excluded.display,
      is_group      = excluded.is_group,
      last_ts       = MAX(sessions.last_ts, excluded.last_ts),
      message_count = MAX(sessions.message_count, excluded.message_count),
      unread_count  = excluded.unread_count,
      summary       = excluded.summary,
      updated_at    = excluded.updated_at
  `);
  return conn.transaction((items: MirrorSession[]) => {
    for (const r of items) {
      stmt.run({
        wxid: r.wxid,
        display: r.display,
        isGroup: r.isGroup ? 1 : 0,
        lastTs: r.lastTs,
        messageCount: r.messageCount,
        unreadCount: r.unreadCount,
        summary: r.summary,
        updatedAt: now,
      });
    }
    return items.length;
  })(rows);
}

/* ─── Messages ──────────────────────────────────────────────────── */

export function fingerprintFor(sender: string, content: string, senderWxid?: string | null): string {
  return createHash('sha1')
    .update(sender)
    .update('\x00')
    .update(senderWxid ?? '')
    .update('\x00')
    .update(content)
    .digest('hex')
    .slice(0, 16);
}

function serializeAttachment(attachment: WeChatMirrorAttachment | null | undefined): string | null {
  if (!attachment || attachment.kind !== 'file') return null;
  return JSON.stringify({
    kind: 'file',
    title: attachment.title,
    size: attachment.size ?? undefined,
    sizeLabel: attachment.sizeLabel ?? undefined,
    ext: attachment.ext ?? undefined,
    localPath: attachment.localPath ?? undefined,
    exists: attachment.exists ?? undefined,
  });
}

function parseAttachment(json: string | null | undefined): WeChatMirrorAttachment | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    if (value.kind !== 'file') return null;
    const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '微信文件';
    return {
      kind: 'file',
      title,
      size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : undefined,
      sizeLabel: typeof value.sizeLabel === 'string' ? value.sizeLabel : undefined,
      ext: typeof value.ext === 'string' ? value.ext : undefined,
      localPath: typeof value.localPath === 'string' ? value.localPath : undefined,
      exists: typeof value.exists === 'boolean' ? value.exists : undefined,
    };
  } catch {
    return null;
  }
}

export function insertMessages(rows: MirrorMessage[]): number {
  if (rows.length === 0) return 0;
  const conn = getMirrorDb();
  const stmt = conn.prepare(`
    INSERT OR IGNORE INTO messages
      (wxid, ts, fingerprint, sender, sender_wxid, sender_display, msg_type, content, attachment_json)
    VALUES
      (@wxid, @ts, @fingerprint, @sender, @senderWxid, @senderDisplay, @msgType, @content, @attachmentJson)
  `);
  return conn.transaction((items: MirrorMessage[]) => {
    let inserted = 0;
    for (const r of items) {
      const result = stmt.run({
        wxid: r.wxid,
        ts: r.ts,
        fingerprint: fingerprintFor(r.sender, r.content, r.senderWxid),
        sender: r.sender,
        senderWxid: r.senderWxid ?? null,
        senderDisplay: r.senderDisplay ?? null,
        msgType: r.msgType,
        content: r.content,
        attachmentJson: serializeAttachment(r.attachment),
      });
      inserted += result.changes;
    }
    return inserted;
  })(rows);
}

/* ─── Sync state ────────────────────────────────────────────────── */

function getStateRaw(conn: Database.Database, key: string): string | null {
  const row = conn
    .prepare<[string], { value: string }>(`SELECT value FROM sync_state WHERE key = ?`)
    .get(key);
  return row?.value ?? null;
}

function setStateRaw(conn: Database.Database, key: string, value: string): void {
  conn
    .prepare(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`)
    .run(key, value);
}

function clearStateRaw(conn: Database.Database, key: string): void {
  conn.prepare(`DELETE FROM sync_state WHERE key = ?`).run(key);
}

export interface MirrorSyncState {
  cursorTs: number;          // unix seconds, 0 = never synced
  lastFinishedAt: number;    // unix ms
  lastError: string | null;
  totalMessages: number;
  firstStartedAt: number;    // unix ms, 0 = no sync ever started
}

export function getSyncState(): MirrorSyncState {
  const conn = getMirrorDb();
  return {
    cursorTs: Number(getStateRaw(conn, SYNC_STATE_KEYS.cursor) ?? '0'),
    lastFinishedAt: Number(getStateRaw(conn, SYNC_STATE_KEYS.lastFinishedAt) ?? '0'),
    lastError: getStateRaw(conn, SYNC_STATE_KEYS.lastError),
    totalMessages: Number(getStateRaw(conn, SYNC_STATE_KEYS.totalMessages) ?? '0'),
    firstStartedAt: Number(getStateRaw(conn, SYNC_STATE_KEYS.firstStartedAt) ?? '0'),
  };
}

/**
 * Wall-clock ms of the last successful mirror sync, or null if the mirror
 * has never synced. Guarded by file existence so a read-only status poll
 * never force-creates the sidecar DB just to report freshness.
 */
export function getLastMirrorSyncAt(): number | null {
  if (!fs.existsSync(MIRROR_DB_PATH)) return null;
  const finished = getSyncState().lastFinishedAt;
  return finished > 0 ? finished : null;
}

export function getLatestMessageTs(): number {
  const row = getMirrorDb()
    .prepare<[], { latest_ts: number | null }>('SELECT MAX(ts) AS latest_ts FROM messages')
    .get();
  const latest = Number(row?.latest_ts ?? 0);
  return Number.isFinite(latest) && latest > 0 ? Math.floor(latest) : 0;
}

/**
 * Per-chat sync watermark: the newest `ts` already mirrored for each wxid.
 *
 * This IS the incremental cursor — derived from the messages table itself,
 * not a duplicated piece of state that can drift. A chat absent here has no
 * mirrored messages, so the next sync re-imports its full history (this is
 * what backfills chats the old global-cursor design silently stranded).
 */
export function getPerChatCursors(): Record<string, number> {
  const rows = getMirrorDb()
    .prepare<[], { wxid: string; max_ts: number | null }>(
      'SELECT wxid, MAX(ts) AS max_ts FROM messages GROUP BY wxid',
    )
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) {
    const ts = Number(r.max_ts ?? 0);
    if (r.wxid && Number.isFinite(ts) && ts > 0) out[r.wxid] = Math.floor(ts);
  }
  return out;
}

export function setCursor(cursorTs: number): void {
  const conn = getMirrorDb();
  setStateRaw(conn, SYNC_STATE_KEYS.cursor, String(cursorTs));
}

export function setLastError(error: string | null): void {
  const conn = getMirrorDb();
  if (error) setStateRaw(conn, SYNC_STATE_KEYS.lastError, error);
  else clearStateRaw(conn, SYNC_STATE_KEYS.lastError);
}

export function markSyncStarted(): void {
  const conn = getMirrorDb();
  if (!getStateRaw(conn, SYNC_STATE_KEYS.firstStartedAt)) {
    setStateRaw(conn, SYNC_STATE_KEYS.firstStartedAt, String(Date.now()));
  }
}

export function markSyncFinished(extraMessages: number): void {
  const conn = getMirrorDb();
  const prevTotal = Number(getStateRaw(conn, SYNC_STATE_KEYS.totalMessages) ?? '0');
  setStateRaw(conn, SYNC_STATE_KEYS.totalMessages, String(prevTotal + extraMessages));
  setStateRaw(conn, SYNC_STATE_KEYS.lastFinishedAt, String(Date.now()));
  clearStateRaw(conn, SYNC_STATE_KEYS.lastError);
}

/* ─── Snapshot read for the overview tab ────────────────────────── */

export interface MirrorSnapshot {
  sessions: SnapshotSession[];
  messages: SnapshotMessage[];
}

interface SessionRow {
  wxid: string;
  display: string;
  is_group: number;
  last_ts: number;
  message_count: number;
  unread_count: number;
  summary: string;
}

interface MessageRow {
  wxid: string;
  ts: number;
  sender: string;
  sender_wxid: string | null;
  sender_display: string | null;
  msg_type: number;
  content: string;
  attachment_json: string | null;
}

/**
 * Fetch the inputs `computeOverview` expects, drawn entirely from the mirror.
 * `windowDays` bounds the messages we hand back; sessions are always returned
 * in full (silentCount needs them to consider chats outside the window).
 */
export function querySnapshot(windowDays: number, nowSec: number): MirrorSnapshot {
  const conn = getMirrorDb();
  const sinceTs = nowSec - Math.max(windowDays, 1) * 86400;

  const sessionRows = conn
    .prepare<[], SessionRow>(`SELECT wxid, display, is_group, last_ts, message_count, unread_count, summary FROM sessions`)
    .all();
  const messageRows = conn
    .prepare<[number], MessageRow>(`
      SELECT wxid, ts, sender, sender_wxid, sender_display, msg_type, content, attachment_json
      FROM messages
      WHERE ts >= ?
      ORDER BY ts DESC
    `)
    .all(sinceTs);

  return {
    sessions: sessionRows.map((r) => ({
      wxid: r.wxid,
      display: r.display,
      is_group: !!r.is_group,
      message_count: r.message_count,
      last_timestamp: r.last_ts,
      unread_count: r.unread_count,
    })),
    messages: messageRows.map((r) => ({
      wxid: r.wxid,
      ts: r.ts,
      sender: r.sender === 'me' ? 'me' : 'them',
      senderWxid: r.sender_wxid,
      senderDisplay: r.sender_display,
      content: r.content,
    })),
  };
}

/** Test / reset hook — clears mirror data without dropping schema. */
export function resetMirror(): void {
  const conn = getMirrorDb();
  conn.exec(`
    DELETE FROM messages;
    DELETE FROM sessions;
    DELETE FROM sync_state;
    DELETE FROM topic_summaries;
    DELETE FROM topic_daily_summaries;
    DELETE FROM topic_daily_sources;
  `);
}

/* ─── Topic summaries ───────────────────────────────────────────── */

export type TopicScope = 'personal' | 'group';
export type TopicState = 'idle' | 'running' | 'done' | 'failed' | 'skipped';

export interface TopicSummary {
  scope: TopicScope;
  generatedAt: number;       // unix ms, 0 if never run
  windowDays: number;
  messageCount: number;
  chatCount: number;
  topics: TopicEntry[];
  state: TopicState;
  error: string | null;
}

export interface TopicEntry {
  title: string;
  summary: string;
  messageCount: number;
  participants: string[];
}

export interface TopicSourceSummary {
  wxid: string;
  display: string;
  isGroup: boolean;
  messageCount: number;
  topics: TopicEntry[];
  days: string[];
}

export interface TopicRangeSummary extends TopicSummary {
  dateFrom: string;
  dateTo: string;
  sources: TopicSourceSummary[];
}

interface TopicRow {
  scope: string;
  generated_at: number;
  window_days: number;
  message_count: number;
  chat_count: number;
  topics_json: string;
  state: string;
  error: string | null;
}

interface TopicDailyRow {
  scope: string;
  business_date: string;
  generated_at: number;
  window_start_ts: number;
  window_end_ts: number;
  message_count: number;
  chat_count: number;
  state: string;
  error: string | null;
}

interface TopicSourceRow {
  scope: string;
  business_date: string;
  wxid: string;
  display: string;
  is_group: number;
  message_count: number;
  topics_json: string;
  updated_at: number;
}

const TOPIC_SCOPES: TopicScope[] = ['personal', 'group'];

function parseTopics(json: string): TopicEntry[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => ({
        title: typeof t.title === 'string' ? safeSanitizedWechatText(t.title, '微信话题').slice(0, 40) : '',
        summary: typeof t.summary === 'string'
          ? safeSanitizedWechatText(t.summary, '相关对话有新的讨论').slice(0, 200)
          : '',
        messageCount: typeof t.messageCount === 'number' ? t.messageCount : 0,
        participants: Array.isArray(t.participants)
          ? t.participants
            .filter((p): p is string => typeof p === 'string')
            .map((p) => safeSanitizedWechatText(p, ''))
            .filter((p) => p.length > 0)
          : [],
      }))
      .filter((t) => t.title.length > 0);
  } catch {
    return [];
  }
}

function displayChatName(rawDisplay: string | null | undefined, wxid: string): string {
  return displayWechatName(rawDisplay, wxid, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
}

function displayGroupMember(rawDisplay: string | null | undefined): string | null {
  if (!rawDisplay) return null;
  return displayWechatName(rawDisplay, null, { contactFallback: '群成员' });
}

function mergeTopicEntries(topics: TopicEntry[]): TopicEntry[] {
  const acc = new Map<string, TopicEntry>();
  for (const topic of topics) {
    const key = normalizeTopicTitle(topic.title);
    if (!key) continue;
    const existing = acc.get(key);
    if (!existing) {
      acc.set(key, {
        ...topic,
        participants: [...new Set(topic.participants)],
      });
      continue;
    }
    existing.messageCount += topic.messageCount;
    existing.participants = [...new Set([...existing.participants, ...topic.participants])];
    if (topic.summary.length > existing.summary.length) existing.summary = topic.summary;
  }
  return Array.from(acc.values()).sort((a, b) => b.messageCount - a.messageCount);
}

function normalizeTopicTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

export function getTopicSummary(scope: TopicScope): TopicSummary {
  const conn = getMirrorDb();
  const row = conn
    .prepare<[string], TopicRow>(`SELECT * FROM topic_summaries WHERE scope = ?`)
    .get(scope);
  if (!row) {
    return {
      scope,
      generatedAt: 0,
      windowDays: 0,
      messageCount: 0,
      chatCount: 0,
      topics: [],
      state: 'idle',
      error: null,
    };
  }
  return {
    scope,
    generatedAt: row.generated_at,
    windowDays: row.window_days,
    messageCount: row.message_count,
    chatCount: row.chat_count,
    topics: parseTopics(row.topics_json),
    state: (row.state as TopicState) ?? 'idle',
    error: row.error,
  };
}

export function getAllTopicSummaries(): Record<TopicScope, TopicSummary> {
  return {
    personal: getTopicSummary('personal'),
    group: getTopicSummary('group'),
  };
}

export function getTopicRangeSummary(
  scope: TopicScope,
  dateFrom: string,
  dateTo: string,
): TopicRangeSummary {
  const conn = getMirrorDb();
  const dailyRows = conn
    .prepare<[string, string, string], TopicDailyRow>(
      `SELECT * FROM topic_daily_summaries
       WHERE scope = ? AND business_date >= ? AND business_date <= ?
       ORDER BY business_date DESC`,
    )
    .all(scope, dateFrom, dateTo);
  const sourceRows = conn
    .prepare<[string, string, string], TopicSourceRow>(
      `SELECT * FROM topic_daily_sources
       WHERE scope = ? AND business_date >= ? AND business_date <= ?
       ORDER BY business_date DESC, message_count DESC`,
    )
    .all(scope, dateFrom, dateTo);

  const sourcesByWxid = new Map<string, TopicSourceSummary>();
  for (const row of sourceRows) {
    const current = sourcesByWxid.get(row.wxid) ?? {
      wxid: row.wxid,
      display: displayChatName(row.display, row.wxid),
      isGroup: !!row.is_group,
      messageCount: 0,
      topics: [],
      days: [],
    };
    current.messageCount += row.message_count;
    current.topics = mergeTopicEntries([...current.topics, ...parseTopics(row.topics_json)]);
    if (!current.days.includes(row.business_date)) current.days.push(row.business_date);
    sourcesByWxid.set(row.wxid, current);
  }

  const sources = Array.from(sourcesByWxid.values())
    .map((source) => ({
      ...source,
      topics: source.topics.sort((a, b) => b.messageCount - a.messageCount),
      days: source.days.sort().reverse(),
    }))
    .sort((a, b) => b.messageCount - a.messageCount);
  const topics = mergeTopicEntries(sources.flatMap((source) => source.topics));
  const latest = dailyRows[0] ?? null;
  const generatedAt = Math.max(0, ...dailyRows.map((row) => row.generated_at));
  const messageCount = dailyRows.reduce((sum, row) => sum + row.message_count, 0);
  const state = dailyRows.some((row) => row.state === 'running')
    ? 'running'
    : dailyRows.some((row) => row.state === 'failed')
      ? 'failed'
      : sources.length > 0
        ? 'done'
        : (latest?.state as TopicState | undefined) ?? 'idle';

  return {
    scope,
    dateFrom,
    dateTo,
    generatedAt,
    windowDays: 0,
    messageCount,
    chatCount: sources.length,
    topics,
    state,
    error: dailyRows.find((row) => row.error)?.error ?? null,
    sources,
  };
}

export function filterTopicRangeSummaryByAllowedWxids(
  summary: TopicRangeSummary,
  allowedWxids: Set<string>,
): TopicRangeSummary {
  const sources = summary.sources.filter((source) => allowedWxids.has(source.wxid));
  const topics = mergeTopicEntries(sources.flatMap((source) => source.topics));
  return {
    ...summary,
    messageCount: sources.reduce((sum, source) => sum + source.messageCount, 0),
    chatCount: sources.length,
    topics,
    sources,
  };
}

export function setTopicState(scope: TopicScope, state: TopicState, error: string | null = null): void {
  const conn = getMirrorDb();
  conn
    .prepare(
      `INSERT INTO topic_summaries (scope, state, error)
       VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET state = excluded.state, error = excluded.error`,
    )
    .run(scope, state, error);
}

export function setTopicDailyState(
  scope: TopicScope,
  businessDate: string,
  state: TopicState,
  error: string | null = null,
): void {
  const { startTs, endTs } = businessDayBounds(businessDate);
  getMirrorDb()
    .prepare(
      `INSERT INTO topic_daily_summaries
         (scope, business_date, generated_at, window_start_ts, window_end_ts, state, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, business_date) DO UPDATE SET
         generated_at = excluded.generated_at,
         window_start_ts = excluded.window_start_ts,
         window_end_ts = excluded.window_end_ts,
         state = excluded.state,
         error = excluded.error`,
    )
    .run(scope, businessDate, Date.now(), startTs, endTs, state, error);
}

export function saveTopicSummary(input: {
  scope: TopicScope;
  windowDays: number;
  messageCount: number;
  chatCount: number;
  topics: TopicEntry[];
}): void {
  const conn = getMirrorDb();
  conn
    .prepare(
      `INSERT INTO topic_summaries
         (scope, generated_at, window_days, message_count, chat_count, topics_json, state, error)
       VALUES (?, ?, ?, ?, ?, ?, 'done', NULL)
       ON CONFLICT(scope) DO UPDATE SET
         generated_at = excluded.generated_at,
         window_days  = excluded.window_days,
         message_count = excluded.message_count,
         chat_count   = excluded.chat_count,
         topics_json  = excluded.topics_json,
         state        = 'done',
         error        = NULL`,
    )
    .run(
      input.scope,
      Date.now(),
      input.windowDays,
      input.messageCount,
      input.chatCount,
      JSON.stringify(input.topics),
    );
}

export function saveTopicDailySummary(input: {
  scope: TopicScope;
  businessDate: string;
  windowStartTs: number;
  windowEndTs: number;
  messageCount: number;
  chatCount: number;
  sources: TopicSourceSummary[];
}): void {
  const conn = getMirrorDb();
  const now = Date.now();
  conn.transaction(() => {
    conn.prepare(
      `INSERT INTO topic_daily_summaries
         (scope, business_date, generated_at, window_start_ts, window_end_ts,
          message_count, chat_count, state, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'done', NULL)
       ON CONFLICT(scope, business_date) DO UPDATE SET
         generated_at = excluded.generated_at,
         window_start_ts = excluded.window_start_ts,
         window_end_ts = excluded.window_end_ts,
         message_count = excluded.message_count,
         chat_count = excluded.chat_count,
         state = 'done',
         error = NULL`,
    ).run(
      input.scope,
      input.businessDate,
      now,
      input.windowStartTs,
      input.windowEndTs,
      input.messageCount,
      input.chatCount,
    );

    conn.prepare(
      `DELETE FROM topic_daily_sources WHERE scope = ? AND business_date = ?`,
    ).run(input.scope, input.businessDate);

    const insertSource = conn.prepare(
      `INSERT INTO topic_daily_sources
         (scope, business_date, wxid, display, is_group, message_count, topics_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const source of input.sources) {
      insertSource.run(
        input.scope,
        input.businessDate,
        source.wxid,
        source.display,
        source.isGroup ? 1 : 0,
        source.messageCount,
        JSON.stringify(source.topics),
        now,
      );
    }
  })();
}

const TOPIC_DAILY_SKIP_RETRY_MS = 30 * 60 * 1000;
const TOPIC_DAILY_RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

export function hasTopicDailySummary(
  scope: TopicScope,
  businessDate: string,
  nowMs = Date.now(),
): boolean {
  const row = getMirrorDb()
    .prepare<[string, string], { state: string; generated_at: number }>(
      `SELECT state, generated_at FROM topic_daily_summaries WHERE scope = ? AND business_date = ?`,
    )
    .get(scope, businessDate);
  if (!row) return false;
  if (row.state === 'done') return true;
  if (row.state === 'running') {
    return row.generated_at > 0 && nowMs - row.generated_at < TOPIC_DAILY_RUNNING_STALE_MS;
  }
  if (row.state === 'skipped' || row.state === 'failed') {
    return row.generated_at > 0 && nowMs - row.generated_at < TOPIC_DAILY_SKIP_RETRY_MS;
  }
  return false;
}

/** Used by tests + when settings change drastically and we want to invalidate. */
export function clearTopicSummaries(): void {
  const conn = getMirrorDb();
  conn.exec(`
    DELETE FROM topic_summaries;
    DELETE FROM topic_daily_summaries;
    DELETE FROM topic_daily_sources;
  `);
}

/* ─── Read messages by chat for topic extraction ────────────────── */

export interface ChatMessagesBundle {
  wxid: string;
  display: string;
  isGroup: boolean;
  /** ASC by ts so chronological order is preserved for the LLM. */
  messages: { ts: number; sender: 'me' | 'them'; senderDisplay: string | null; content: string }[];
}

/**
 * Pull messages from a specific set of chats (whitelist) within the window.
 * Returns one bundle per chat, ASC ordered, only sender-text messages with
 * non-empty content (since topic extraction needs actual conversation text).
 */
export function queryMessagesForChats(
  wxids: string[],
  windowDays: number,
  nowSec: number,
): ChatMessagesBundle[] {
  if (wxids.length === 0) return [];
  const conn = getMirrorDb();
  const sinceTs = nowSec - Math.max(windowDays, 1) * 86400;

  const placeholders = wxids.map(() => '?').join(',');
  const sessionRows = conn
    .prepare<string[], { wxid: string; display: string; is_group: number }>(
      `SELECT wxid, display, is_group FROM sessions WHERE wxid IN (${placeholders})`,
    )
    .all(...wxids);
  const sessionMap = new Map<string, { display: string; isGroup: boolean }>();
  for (const r of sessionRows) {
    sessionMap.set(r.wxid, { display: displayChatName(r.display, r.wxid), isGroup: !!r.is_group });
  }

  const messageRows = conn
    .prepare<[number, ...string[]], { wxid: string; ts: number; sender: string; sender_display: string | null; content: string }>(
      `SELECT wxid, ts, sender, sender_display, content
       FROM messages
       WHERE ts >= ? AND wxid IN (${placeholders})
         AND content != '' AND msg_type = 1
       ORDER BY wxid, ts ASC`,
    )
    .all(sinceTs, ...wxids);

  const grouped = new Map<string, ChatMessagesBundle>();
  for (const r of messageRows) {
    const meta = sessionMap.get(r.wxid) ?? { display: displayChatName(null, r.wxid), isGroup: r.wxid.endsWith('@chatroom') };
    let bundle = grouped.get(r.wxid);
    if (!bundle) {
      bundle = {
        wxid: r.wxid,
        display: meta.display,
        isGroup: meta.isGroup,
        messages: [],
      };
      grouped.set(r.wxid, bundle);
    }
    bundle.messages.push({
      ts: r.ts,
      sender: r.sender === 'me' ? 'me' : 'them',
      senderDisplay: displayGroupMember(r.sender_display),
      content: r.content,
    });
  }
  // Stable order: most active chats first
  return Array.from(grouped.values()).sort((a, b) => b.messages.length - a.messages.length);
}

export function queryMessagesForChatsInRange(
  wxids: string[],
  startTs: number,
  endTs: number,
): ChatMessagesBundle[] {
  if (wxids.length === 0) return [];
  const conn = getMirrorDb();
  const placeholders = wxids.map(() => '?').join(',');
  const sessionRows = conn
    .prepare<string[], { wxid: string; display: string; is_group: number }>(
      `SELECT wxid, display, is_group FROM sessions WHERE wxid IN (${placeholders})`,
    )
    .all(...wxids);
  const sessionMap = new Map<string, { display: string; isGroup: boolean }>();
  for (const r of sessionRows) {
    sessionMap.set(r.wxid, { display: displayChatName(r.display, r.wxid), isGroup: !!r.is_group });
  }

  const messageRows = conn
    .prepare<[number, number, ...string[]], { wxid: string; ts: number; sender: string; sender_display: string | null; content: string }>(
      `SELECT wxid, ts, sender, sender_display, content
       FROM messages
       WHERE ts >= ? AND ts < ? AND wxid IN (${placeholders})
         AND content != '' AND msg_type = 1
       ORDER BY wxid, ts ASC`,
    )
    .all(startTs, endTs, ...wxids);

  const grouped = new Map<string, ChatMessagesBundle>();
  for (const r of messageRows) {
    const meta = sessionMap.get(r.wxid) ?? { display: displayChatName(null, r.wxid), isGroup: r.wxid.endsWith('@chatroom') };
    let bundle = grouped.get(r.wxid);
    if (!bundle) {
      bundle = {
        wxid: r.wxid,
        display: meta.display,
        isGroup: meta.isGroup,
        messages: [],
      };
      grouped.set(r.wxid, bundle);
    }
    bundle.messages.push({
      ts: r.ts,
      sender: r.sender === 'me' ? 'me' : 'them',
      senderDisplay: displayGroupMember(r.sender_display),
      content: r.content,
    });
  }
  return Array.from(grouped.values()).sort((a, b) => b.messages.length - a.messages.length);
}

export { TOPIC_SCOPES };

/* ─── User-facing message search ───────────────────────────────── */

export function searchMessages(options: MessageSearchOptions): MessageSearchResult[] {
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const { where, params } = buildMessageSearchSql(options);
  params.push(limit, offset);

  const rows = getMirrorDb()
    .prepare<Array<string | number>, {
      wxid: string;
      display: string | null;
      is_group: number | null;
      ts: number;
      sender: string;
      sender_display: string | null;
      msg_type: number;
      content: string;
    }>(`
      SELECT
        m.wxid,
        COALESCE(NULLIF(s.display, ''), m.wxid) AS display,
        COALESCE(s.is_group, CASE WHEN m.wxid LIKE '%@chatroom' THEN 1 ELSE 0 END) AS is_group,
        m.ts,
        m.sender,
        m.sender_display,
        m.msg_type,
        m.content
      FROM messages m
      LEFT JOIN sessions s ON s.wxid = m.wxid
      WHERE ${where.join(' AND ')}
      ORDER BY m.ts DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params);

  return rows.map((row) => ({
    wxid: row.wxid,
    display: displayChatName(row.display, row.wxid),
    isGroup: !!row.is_group,
    ts: row.ts,
    sender: row.sender === 'me' ? 'me' : 'them',
    senderDisplay: displayGroupMember(row.sender_display),
    msgType: row.msg_type,
    content: row.content,
  }));
}

export function listMessagesForExport(options: MessageSearchOptions): MessageSearchResult[] {
  const { where, params } = buildMessageSearchSql(options);
  const rows = getMirrorDb()
    .prepare<Array<string | number>, {
      wxid: string;
      display: string | null;
      is_group: number | null;
      ts: number;
      sender: string;
      sender_display: string | null;
      msg_type: number;
      content: string;
    }>(`
      SELECT
        m.wxid,
        COALESCE(NULLIF(s.display, ''), m.wxid) AS display,
        COALESCE(s.is_group, CASE WHEN m.wxid LIKE '%@chatroom' THEN 1 ELSE 0 END) AS is_group,
        m.ts,
        m.sender,
        m.sender_display,
        m.msg_type,
        m.content
      FROM messages m
      LEFT JOIN sessions s ON s.wxid = m.wxid
      WHERE ${where.join(' AND ')}
      ORDER BY m.ts ASC, m.fingerprint ASC
    `)
    .all(...params);

  return rows.map((row) => ({
    wxid: row.wxid,
    display: displayChatName(row.display, row.wxid),
    isGroup: !!row.is_group,
    ts: row.ts,
    sender: row.sender === 'me' ? 'me' : 'them',
    senderDisplay: displayGroupMember(row.sender_display),
    msgType: row.msg_type,
    content: row.content,
  }));
}

export function writeMessagesExportFile(
  options: MessageSearchOptions,
  filePath: string,
  format: MessageExportFormat = 'markdown',
): number {
  const { where, params } = buildMessageSearchSql(options);
  const rows = getMirrorDb()
    .prepare<Array<string | number>, {
      wxid: string;
      display: string | null;
      is_group: number | null;
      ts: number;
      sender: string;
      sender_display: string | null;
      msg_type: number;
      content: string;
    }>(`
      SELECT
        m.wxid,
        COALESCE(NULLIF(s.display, ''), m.wxid) AS display,
        COALESCE(s.is_group, CASE WHEN m.wxid LIKE '%@chatroom' THEN 1 ELSE 0 END) AS is_group,
        m.ts,
        m.sender,
        m.sender_display,
        m.msg_type,
        m.content
      FROM messages m
      LEFT JOIN sessions s ON s.wxid = m.wxid
      WHERE ${where.join(' AND ')}
      ORDER BY m.ts ASC, m.fingerprint ASC
    `)
    .iterate(...params);

  let count = 0;
  let buffer = format === 'csv'
    ? `\uFEFF${['时间', '聊天对象', '聊天类型', '发送者', '消息类型', '内容'].map(csvCell).join(',')}\n`
    : [
        '# 微信我发送消息导出',
        '',
        `导出时间：${new Date().toLocaleString('zh-CN')}`,
        '',
      ].join('\n');
  fs.writeFileSync(filePath, buffer, 'utf8');
  buffer = '';

  for (const row of rows) {
    count += 1;
    const item = {
      display: displayChatName(row.display, row.wxid),
      isGroup: !!row.is_group,
      ts: row.ts,
      sender: (row.sender === 'me' ? 'me' : 'them') as 'me' | 'them',
      senderDisplay: displayGroupMember(row.sender_display),
      msgType: row.msg_type,
      content: row.content,
    };
    buffer += format === 'csv'
      ? exportCsvLine(item)
      : exportMarkdownLine(item);
    if (count % 1000 === 0) {
      fs.appendFileSync(filePath, buffer, 'utf8');
      buffer = '';
    }
  }

  if (format === 'markdown') {
    buffer += `\n---\n导出条数：${count}\n`;
  }
  if (buffer) fs.appendFileSync(filePath, buffer, 'utf8');
  return count;
}

function buildMessageSearchSql(options: MessageSearchOptions): {
  where: string[];
  params: Array<string | number>;
} {
  const query = (options.query ?? '').trim();
  const scope = options.scope ?? 'all';
  const sender = options.sender ?? 'all';
  const where: string[] = ["m.content != ''"];
  const params: Array<string | number> = [];

  if (query) {
    const like = `%${escapeLikePattern(query)}%`;
    where.push(
      "((m.msg_type = 1 AND (m.content LIKE ? ESCAPE '\\' OR COALESCE(NULLIF(s.display, ''), m.wxid) LIKE ? ESCAPE '\\' OR m.wxid LIKE ? ESCAPE '\\')) OR (m.msg_type = 49 AND m.content LIKE '[文件]%' AND m.content LIKE ? ESCAPE '\\'))",
    );
    params.push(like, like, like, like);
  }

  if (sender === 'me' || sender === 'them') {
    where.push('m.sender = ?');
    params.push(sender);
  }

  if (typeof options.sinceTs === 'number' && Number.isFinite(options.sinceTs) && options.sinceTs > 0) {
    where.push('m.ts >= ?');
    params.push(Math.floor(options.sinceTs));
  }
  if (typeof options.fromTs === 'number' && Number.isFinite(options.fromTs) && options.fromTs > 0) {
    where.push('m.ts >= ?');
    params.push(Math.floor(options.fromTs));
  }
  if (typeof options.toTs === 'number' && Number.isFinite(options.toTs) && options.toTs > 0) {
    where.push('m.ts < ?');
    params.push(Math.floor(options.toTs));
  }

  if (scope === 'personal') {
    where.push("COALESCE(s.is_group, CASE WHEN m.wxid LIKE '%@chatroom' THEN 1 ELSE 0 END) = 0");
  } else if (scope === 'group') {
    where.push("COALESCE(s.is_group, CASE WHEN m.wxid LIKE '%@chatroom' THEN 1 ELSE 0 END) = 1");
  }

  return { where, params };
}

function exportCsvLine(item: {
  display: string;
  isGroup: boolean;
  ts: number;
  sender: 'me' | 'them';
  senderDisplay: string | null;
  msgType: number;
  content: string;
}): string {
  return [
    new Date(item.ts * 1000).toLocaleString('zh-CN', { hour12: false }),
    item.display,
    item.isGroup ? '群聊' : '私聊',
    item.sender === 'me' ? '我' : item.senderDisplay || (item.isGroup ? '群成员' : '对方'),
    String(item.msgType),
    item.content,
  ].map(csvCell).join(',') + '\n';
}

function exportMarkdownLine(item: {
  display: string;
  isGroup: boolean;
  ts: number;
  msgType: number;
  content: string;
}): string {
  const time = new Date(item.ts * 1000).toLocaleString('zh-CN', { hour12: false });
  const chat = markdownInline(item.display);
  const content = markdownInline(item.content);
  return `- ${time} | ${item.isGroup ? '群聊' : '私聊'} | ${chat} | ${item.msgType} | ${content}\n`;
}

function csvCell(value: string): string {
  const text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function markdownInline(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' / ')
    .replace(/\|/g, '\\|')
    .trim();
}

export function findChatCandidates(
  query: string,
  scope: MessageSearchScope = 'all',
  limit = 10,
): ChatReadCandidate[] {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const cappedLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const where: string[] = [
    "(display LIKE ? ESCAPE '\\' OR wxid LIKE ? ESCAPE '\\')",
  ];
  const contains = `%${escapeLikePattern(cleanQuery)}%`;
  const prefix = `${escapeLikePattern(cleanQuery)}%`;
  const params: Array<string | number> = [contains, contains];

  if (scope === 'personal') {
    where.push('is_group = 0');
  } else if (scope === 'group') {
    where.push('is_group = 1');
  }

  params.push(cleanQuery, cleanQuery, prefix, cappedLimit);

  const rows = getMirrorDb()
    .prepare<Array<string | number>, {
      wxid: string;
      display: string;
      is_group: number;
      last_ts: number;
      message_count: number;
      unread_count: number;
      summary: string;
    }>(`
      SELECT wxid, display, is_group, last_ts, message_count, unread_count, summary
      FROM sessions
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE
          WHEN display = ? OR wxid = ? THEN 0
          WHEN display LIKE ? ESCAPE '\\' THEN 1
          ELSE 2
        END,
        last_ts DESC
      LIMIT ?
    `)
    .all(...params);

  return rows.map((row) => ({
    wxid: row.wxid,
    display: displayChatName(row.display, row.wxid),
    isGroup: !!row.is_group,
    lastTs: row.last_ts,
    messageCount: row.message_count,
    unreadCount: row.unread_count,
    summary: row.summary,
  }));
}

export function readChatMessages(options: ChatReadOptions): ChatReadResult {
  const query = options.chat.trim();
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const candidates = findChatCandidates(query, options.scope ?? 'all', 10);
  const exactCandidates = candidates.filter((item) => item.wxid === query || item.display === query);
  const selected = exactCandidates.length === 1
    ? exactCandidates[0]
    : candidates.length === 1
      ? candidates[0]
      : null;

  if (!selected) {
    return {
      status: candidates.length > 0 ? 'ambiguous' : 'not_found',
      query,
      chat: null,
      candidates,
      messages: [],
      limit,
      offset,
      hasMore: false,
      nextOffset: null,
    };
  }

  const where = ['wxid = ?'];
  const params: Array<string | number> = [selected.wxid];
  if (typeof options.sinceTs === 'number' && Number.isFinite(options.sinceTs) && options.sinceTs > 0) {
    where.push('ts >= ?');
    params.push(Math.floor(options.sinceTs));
  }
  if (typeof options.beforeTs === 'number' && Number.isFinite(options.beforeTs) && options.beforeTs > 0) {
    where.push('ts < ?');
    params.push(Math.floor(options.beforeTs));
  }
  params.push(limit + 1, offset);

  const rows = getMirrorDb()
    .prepare<Array<string | number>, {
      ts: number;
      fingerprint: string;
      sender: string;
      sender_display: string | null;
      msg_type: number;
      content: string;
      attachment_json: string | null;
    }>(`
      SELECT ts, fingerprint, sender, sender_display, msg_type, content, attachment_json
      FROM messages
      WHERE ${where.join(' AND ')}
      ORDER BY ts DESC, fingerprint DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params);
  const pageRows = rows.slice(0, limit);

  return {
    status: 'ok',
    query,
    chat: selected,
    candidates: [selected],
    messages: pageRows.map((row) => ({
      ts: row.ts,
      sender: row.sender === 'me' ? 'me' : 'them',
      senderDisplay: displayGroupMember(row.sender_display),
      msgType: row.msg_type,
      content: row.content,
      attachment: parseAttachment(row.attachment_json),
    })),
    limit,
    offset,
    hasMore: rows.length > limit,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

export function getMessageContext(
  wxid: string,
  targetTs: number,
  radius = 8,
): MessageContextResult | null {
  const cleanWxid = wxid.trim();
  if (!cleanWxid || !Number.isFinite(targetTs) || targetTs <= 0) return null;

  const limit = Math.max(1, Math.min(30, Math.floor(radius)));
  const conn = getMirrorDb();
  const session = conn
    .prepare<[string], { display: string; is_group: number }>(
      `SELECT display, is_group FROM sessions WHERE wxid = ?`,
    )
    .get(cleanWxid);
  const meta = {
    display: displayChatName(session?.display, cleanWxid),
    isGroup: session ? !!session.is_group : cleanWxid.endsWith('@chatroom'),
  };

  const before = conn
    .prepare<[string, number, number], { ts: number; sender: string; sender_display: string | null; content: string }>(`
      SELECT ts, sender, sender_display, content
      FROM messages
      WHERE wxid = ? AND ts <= ? AND msg_type = 1 AND content != ''
      ORDER BY ts DESC
      LIMIT ?
    `)
    .all(cleanWxid, Math.floor(targetTs), limit);
  const after = conn
    .prepare<[string, number, number], { ts: number; sender: string; sender_display: string | null; content: string }>(`
      SELECT ts, sender, sender_display, content
      FROM messages
      WHERE wxid = ? AND ts > ? AND msg_type = 1 AND content != ''
      ORDER BY ts ASC
      LIMIT ?
    `)
    .all(cleanWxid, Math.floor(targetTs), limit);

  const messages: MessageContextResult['messages'] = [...before.reverse(), ...after].map((row) => ({
    ts: row.ts,
    sender: row.sender === 'me' ? 'me' : 'them',
    senderDisplay: displayGroupMember(row.sender_display),
    content: row.content,
  }));

  return {
    wxid: cleanWxid,
    display: meta.display,
    isGroup: meta.isGroup,
    targetTs: Math.floor(targetTs),
    messages,
  };
}

export function getTopicMessageContext(input: {
  wxid: string;
  title: string;
  summary?: string | null;
  dateFrom: string;
  dateTo: string;
  radius?: number;
}): MessageContextResult | null {
  const wxid = input.wxid.trim();
  if (!wxid) return null;
  const from = businessDayBounds(input.dateFrom);
  const to = businessDayBounds(input.dateTo);
  const startTs = Math.min(from.startTs, to.startTs);
  const endTs = Math.max(from.endTs, to.endTs);
  const terms = topicLookupTerms(`${input.title} ${input.summary ?? ''}`);
  const conn = getMirrorDb();

  let target: { ts: number } | undefined;
  if (terms.length > 0) {
    const likeWhere = terms.map(() => "content LIKE ? ESCAPE '\\'").join(' OR ');
    target = conn
      .prepare<Array<string | number>, { ts: number }>(
        `SELECT ts
         FROM messages
         WHERE wxid = ? AND ts >= ? AND ts < ?
           AND msg_type = 1 AND content != ''
           AND (${likeWhere})
         ORDER BY ts DESC
         LIMIT 1`,
      )
      .get(
        wxid,
        startTs,
        endTs,
        ...terms.map((term) => `%${escapeLikePattern(term)}%`),
      );
  }

  target ??= conn
    .prepare<[string, number, number], { ts: number }>(
      `SELECT ts
       FROM messages
       WHERE wxid = ? AND ts >= ? AND ts < ?
         AND msg_type = 1 AND content != ''
       ORDER BY ts DESC
       LIMIT 1`,
    )
    .get(wxid, startTs, endTs);

  return target ? getMessageContext(wxid, target.ts, input.radius ?? 8) : null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function topicLookupTerms(value: string): string[] {
  const tokens = value
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[\p{Script=Han}]{2,8}|[A-Za-z0-9][A-Za-z0-9._+-]{1,24}/gu) ?? [];
  return [...new Set(tokens.map((token) => token.trim()).filter((token) => token.length >= 2))]
    .slice(0, 6);
}
