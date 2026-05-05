/**
 * SQLite read/write helpers for the goofish local archive.
 * Tables defined in src/lib/db/migrations-goofish.ts.
 */

import { getDb } from '@/lib/db/connection';
import type { GoofishChatSession, GoofishMessage } from './messages';

interface SessionRow {
  cid: string;
  account_unb: string;
  session_type: number;
  peer_user_id: string;
  peer_nick: string;
  peer_avatar: string;
  unread: number;
  last_msg: string;
  ts: number;
  item_id: string;
  item_title: string;
  item_main_pic: string;
  source: string;
  synced_at: number;
}

const SESSION_UPSERT_SQL = `
  INSERT INTO goofish_sessions
    (cid, account_unb, session_type, peer_user_id, peer_nick, peer_avatar,
     unread, last_msg, ts, item_id, item_title, item_main_pic, source, synced_at)
  VALUES
    (@cid, @account_unb, @session_type, @peer_user_id, @peer_nick, @peer_avatar,
     @unread, @last_msg, @ts, @item_id, @item_title, @item_main_pic, @source, @synced_at)
  ON CONFLICT(cid) DO UPDATE SET
    account_unb = excluded.account_unb,
    session_type = excluded.session_type,
    peer_user_id = CASE WHEN excluded.peer_user_id != '' THEN excluded.peer_user_id ELSE goofish_sessions.peer_user_id END,
    peer_nick = CASE WHEN excluded.peer_nick != '' THEN excluded.peer_nick ELSE goofish_sessions.peer_nick END,
    peer_avatar = CASE WHEN excluded.peer_avatar != '' THEN excluded.peer_avatar ELSE goofish_sessions.peer_avatar END,
    unread = excluded.unread,
    last_msg = CASE WHEN excluded.last_msg != '' THEN excluded.last_msg ELSE goofish_sessions.last_msg END,
    ts = MAX(excluded.ts, goofish_sessions.ts),
    item_id = CASE WHEN excluded.item_id != '' THEN excluded.item_id ELSE goofish_sessions.item_id END,
    item_title = CASE WHEN excluded.item_title != '' THEN excluded.item_title ELSE goofish_sessions.item_title END,
    item_main_pic = CASE WHEN excluded.item_main_pic != '' THEN excluded.item_main_pic ELSE goofish_sessions.item_main_pic END,
    source = excluded.source,
    synced_at = excluded.synced_at
`;

export function upsertSessions(accountUnb: string, sessions: GoofishChatSession[]): void {
  if (sessions.length === 0) return;
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(SESSION_UPSERT_SQL);
  const txn = db.transaction((rows: GoofishChatSession[]) => {
    for (const s of rows) {
      stmt.run({
        cid: s.session_id,
        account_unb: accountUnb,
        session_type: s.session_type,
        peer_user_id: s.peer_user_id,
        peer_nick: s.peer_nick,
        peer_avatar: s.peer_avatar,
        unread: s.unread,
        last_msg: s.last_msg,
        ts: s.ts,
        item_id: s.item_id,
        item_title: s.item_title,
        item_main_pic: s.item_main_pic,
        source: s.source,
        synced_at: now,
      });
    }
  });
  txn(sessions);
}

const MSG_UPSERT_SQL = `
  INSERT INTO goofish_messages
    (message_id, cid, account_unb, from_user_id, from_user_name, to_user_id,
     created_at, read_status, content_kind, content_text, content_json, synced_at)
  VALUES
    (@message_id, @cid, @account_unb, @from_user_id, @from_user_name, @to_user_id,
     @created_at, @read_status, @content_kind, @content_text, @content_json, @synced_at)
  ON CONFLICT(cid, message_id) DO UPDATE SET
    read_status = excluded.read_status,
    synced_at = excluded.synced_at
`;

const FTS_INSERT_SQL = `
  INSERT INTO goofish_msgs_fts (content_text, peer_nick, cid, message_id)
  VALUES (@content_text, @peer_nick, @cid, @message_id)
`;

export function upsertMessages(
  cid: string,
  accountUnb: string,
  peerNick: string,
  messages: GoofishMessage[],
): void {
  if (messages.length === 0) return;
  const db = getDb();
  const now = Date.now();
  const msgStmt = db.prepare(MSG_UPSERT_SQL);
  const ftsAvailable = hasFts(db);
  const ftsStmt = ftsAvailable ? db.prepare(FTS_INSERT_SQL) : null;
  const txn = db.transaction((rows: GoofishMessage[]) => {
    for (const m of rows) {
      const id = m.messageId || `synth-${cid}-${m.createdAt}-${m.fromUserId}`;
      const text = contentToText(m);
      const isNew = msgStmt.run({
        message_id: id,
        cid,
        account_unb: accountUnb,
        from_user_id: m.fromUserId,
        from_user_name: m.fromUserName,
        to_user_id: m.receiverUserId,
        created_at: m.createdAt,
        read_status: m.readStatus,
        content_kind: m.content.kind,
        content_text: text,
        content_json: JSON.stringify(m.content),
        synced_at: now,
      }).changes > 0;
      // Only re-insert into FTS for new rows; updates don't change content_text.
      if (isNew && ftsStmt && text) {
        ftsStmt.run({ content_text: text, peer_nick: peerNick, cid, message_id: id });
      }
    }
  });
  txn(messages);
}

function contentToText(m: GoofishMessage): string {
  const c = m.content;
  if (c.kind === 'text' || c.kind === 'system') return c.text;
  if (c.kind === 'item') return `[商品] ${c.title}`;
  if (c.kind === 'image') return '[图片]';
  return m.summary;
}

let ftsAvailable: boolean | null = null;
function hasFts(db: ReturnType<typeof getDb>): boolean {
  if (ftsAvailable !== null) return ftsAvailable;
  try { db.prepare('SELECT 1 FROM goofish_msgs_fts LIMIT 0').all(); return (ftsAvailable = true); }
  catch { return (ftsAvailable = false); }
}

export interface DbSession extends Omit<SessionRow, 'synced_at' | 'session_type'> {
  session_type: number;
}

export function findAccountForCid(cid: string): string {
  const row = getDb().prepare('SELECT account_unb FROM goofish_sessions WHERE cid = ?').get(cid) as { account_unb: string } | undefined;
  return row?.account_unb ?? '';
}

export function listSessions(opts: { accountUnb?: string; limit?: number } = {}): DbSession[] {
  const db = getDb();
  const limit = opts.limit ?? 500;
  const sql = opts.accountUnb
    ? 'SELECT * FROM goofish_sessions WHERE account_unb = ? AND session_type IN (0,1) ORDER BY ts DESC LIMIT ?'
    : 'SELECT * FROM goofish_sessions WHERE session_type IN (0,1) ORDER BY ts DESC LIMIT ?';
  const args = opts.accountUnb ? [opts.accountUnb, limit] : [limit];
  return db.prepare(sql).all(...args) as DbSession[];
}

export interface SearchHit {
  cid: string;
  message_id: string;
  peer_nick: string;
  peer_user_id: string;
  item_title: string;
  item_id: string;
  from_user_id: string;
  from_user_name: string;
  created_at: number;
  content_text: string;
}


/**
 * Keyword search across messages. Uses FTS5 if available, falls back to LIKE.
 * Joins back to goofish_sessions to attach peer/item context per hit.
 * Pass `accountUnb` to scope to a single goofish account (important once
 * the local archive contains multiple accounts' data).
 */
export function searchMessages(keyword: string, opts: { accountUnb?: string; limit?: number } = {}): SearchHit[] {
  const db = getDb();
  const q = keyword.trim();
  if (!q) return [];
  const limit = opts.limit ?? 50;
  const accountFilter = opts.accountUnb ? 'AND m.account_unb = ?' : '';
  if (hasFts(db)) {
    const sql = `
      SELECT m.cid, m.message_id, m.from_user_id, m.from_user_name,
             m.created_at, m.content_text,
             s.peer_nick, s.peer_user_id, s.item_title, s.item_id
      FROM goofish_msgs_fts f
      JOIN goofish_messages m ON m.cid = f.cid AND m.message_id = f.message_id
      LEFT JOIN goofish_sessions s ON s.cid = m.cid
      WHERE f.content_text MATCH ? ${accountFilter}
      ORDER BY m.created_at DESC LIMIT ?
    `;
    const args = opts.accountUnb ? [escapeFts(q), opts.accountUnb, limit] : [escapeFts(q), limit];
    return db.prepare(sql).all(...args) as SearchHit[];
  }
  const sql = `
    SELECT m.cid, m.message_id, m.from_user_id, m.from_user_name,
           m.created_at, m.content_text,
           s.peer_nick, s.peer_user_id, s.item_title, s.item_id
    FROM goofish_messages m
    LEFT JOIN goofish_sessions s ON s.cid = m.cid
    WHERE m.content_text LIKE ? ${accountFilter}
    ORDER BY m.created_at DESC LIMIT ?
  `;
  const args = opts.accountUnb ? [`%${q}%`, opts.accountUnb, limit] : [`%${q}%`, limit];
  return db.prepare(sql).all(...args) as SearchHit[];
}

function escapeFts(s: string): string {
  // Wrap in quotes so FTS treats it as a phrase; escape inner quotes.
  return `"${s.replace(/"/g, '""')}"`;
}

export function getSyncState(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM goofish_sync_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setSyncState(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO goofish_sync_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

/**
 * Cross-source backfill — fill empty/placeholder peer_nick + peer_avatar from
 * any session OR message we already have for the same peer_user_id.
 */
export function backfillPeerDetails(): { nick: number; avatar: number } {
  const db = getDb();
  // COALESCE picks the first non-NULL: a sibling session's real nick, else
  // a real chat message from this peer (skip system pushes — their
  // from_user_name is the push title, not a nick).
  const nickRes = db.prepare(`
    UPDATE goofish_sessions AS target SET peer_nick = COALESCE(
      (SELECT peer_nick FROM goofish_sessions src
        WHERE src.peer_user_id = target.peer_user_id
          AND src.peer_nick != '' AND src.peer_nick NOT LIKE '用户 %'
        ORDER BY src.ts DESC LIMIT 1),
      (SELECT from_user_name FROM goofish_messages msg
        WHERE msg.from_user_id = target.peer_user_id
          AND msg.from_user_name != ''
          AND msg.content_kind NOT IN ('system', 'unknown')
        ORDER BY msg.created_at DESC LIMIT 1),
      target.peer_nick
    )
    WHERE peer_user_id != '' AND (peer_nick = '' OR peer_nick LIKE '用户 %')
  `).run();
  const avatarRes = db.prepare(`
    UPDATE goofish_sessions AS target
    SET peer_avatar = (
      SELECT peer_avatar FROM goofish_sessions src
      WHERE src.peer_user_id = target.peer_user_id
        AND src.peer_avatar != ''
      ORDER BY src.ts DESC LIMIT 1
    )
    WHERE peer_user_id != '' AND peer_avatar = ''
      AND EXISTS (
        SELECT 1 FROM goofish_sessions src
        WHERE src.peer_user_id = target.peer_user_id
          AND src.peer_avatar != ''
      )
  `).run();
  return { nick: nickRes.changes, avatar: avatarRes.changes };
}

const DEFAULT_SYNC_INTERVAL_MS = 60_000;
const MIN_SYNC_INTERVAL_MS = 30_000;
const MAX_SYNC_INTERVAL_MS = 60 * 60_000;

export function getSyncIntervalMs(): number {
  const v = Number(getSyncState('sync_interval_ms'));
  if (!v || Number.isNaN(v)) return DEFAULT_SYNC_INTERVAL_MS;
  return Math.max(MIN_SYNC_INTERVAL_MS, Math.min(MAX_SYNC_INTERVAL_MS, v));
}

export function setSyncIntervalMs(ms: number): number {
  const clamped = Math.max(MIN_SYNC_INTERVAL_MS, Math.min(MAX_SYNC_INTERVAL_MS, Math.round(ms)));
  setSyncState('sync_interval_ms', String(clamped));
  return clamped;
}
