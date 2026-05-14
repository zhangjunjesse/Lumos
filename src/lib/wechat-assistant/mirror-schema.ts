/**
 * Schema for the WeChat sync mirror — a sidecar SQLite at
 * `~/.lumos/wechat-mirror.db`. Holds a plaintext copy of WeChat sessions
 * + messages so the overview tab can answer in milliseconds instead of
 * spawning sqlcipher per request.
 *
 * The mirror is *cache-like*: it can be wiped at any time, and the next
 * sync rebuilds it from the encrypted source. We therefore stay schemaless
 * relative to lumos.db migrations — bumping `SCHEMA_VERSION` tears the
 * tables and re-creates them from scratch. No data is lost (it lives in
 * the WeChat source DBs).
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  wxid           TEXT PRIMARY KEY,
  display        TEXT NOT NULL DEFAULT '',
  is_group       INTEGER NOT NULL DEFAULT 0,
  last_ts        INTEGER NOT NULL DEFAULT 0,
  message_count  INTEGER NOT NULL DEFAULT 0,
  unread_count   INTEGER NOT NULL DEFAULT 0,
  summary        TEXT NOT NULL DEFAULT '',
  updated_at     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  wxid         TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  fingerprint  TEXT NOT NULL,
  sender       TEXT NOT NULL,        -- 'me' | 'them'
  sender_wxid  TEXT,
  sender_display TEXT,
  msg_type     INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL DEFAULT '',
  attachment_json TEXT,
  PRIMARY KEY (wxid, ts, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_messages_wxid_ts ON messages(wxid, ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);

CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Cached AI topic-extraction results, one row per scope (personal | group).
CREATE TABLE IF NOT EXISTS topic_summaries (
  scope          TEXT PRIMARY KEY,         -- 'personal' | 'group'
  generated_at   INTEGER NOT NULL DEFAULT 0,
  window_days    INTEGER NOT NULL DEFAULT 0,
  message_count  INTEGER NOT NULL DEFAULT 0,
  chat_count     INTEGER NOT NULL DEFAULT 0,
  topics_json    TEXT NOT NULL DEFAULT '[]',
  state          TEXT NOT NULL DEFAULT 'idle',  -- idle | running | done | failed
  error          TEXT
);

-- Daily topic archive. Business days use the user's product rule:
-- 04:00 local time is the day boundary.
CREATE TABLE IF NOT EXISTS topic_daily_summaries (
  scope          TEXT NOT NULL,            -- 'personal' | 'group'
  business_date  TEXT NOT NULL,            -- YYYY-MM-DD, day starts at 04:00
  generated_at   INTEGER NOT NULL DEFAULT 0,
  window_start_ts INTEGER NOT NULL DEFAULT 0,
  window_end_ts   INTEGER NOT NULL DEFAULT 0,
  message_count  INTEGER NOT NULL DEFAULT 0,
  chat_count     INTEGER NOT NULL DEFAULT 0,
  state          TEXT NOT NULL DEFAULT 'idle',  -- idle | running | done | failed | skipped
  error          TEXT,
  PRIMARY KEY(scope, business_date)
);

CREATE TABLE IF NOT EXISTS topic_daily_sources (
  scope          TEXT NOT NULL,
  business_date  TEXT NOT NULL,
  wxid           TEXT NOT NULL,
  display        TEXT NOT NULL DEFAULT '',
  is_group       INTEGER NOT NULL DEFAULT 0,
  message_count  INTEGER NOT NULL DEFAULT 0,
  topics_json    TEXT NOT NULL DEFAULT '[]',
  updated_at     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(scope, business_date, wxid)
);

CREATE INDEX IF NOT EXISTS idx_topic_daily_sources_scope_date
  ON topic_daily_sources(scope, business_date);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** sync_state keys. Centralized so callers can't typo. */
export const SYNC_STATE_KEYS = {
  /** unix seconds — newest message ts we have already imported */
  cursor: 'cursor',
  /** unix ms — wall clock when last sync completed successfully */
  lastFinishedAt: 'last_finished_at',
  /** error message from the last failed sync (cleared on success) */
  lastError: 'last_error',
  /** running count of messages stored across all syncs */
  totalMessages: 'total_messages',
  /** ISO timestamp when first sync started — used to detect "first time" UX */
  firstStartedAt: 'first_started_at',
} as const;
