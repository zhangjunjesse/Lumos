import Database from 'better-sqlite3';

/**
 * Goofish (闲鱼) local archive — sessions + messages cached locally so AI
 * can search without round-tripping mtop/WS for every query, and the panel
 * can render instantly instead of waiting 15-30s for a fresh pull.
 *
 * Strategy: a recurring sync task calls our chats_fat.py + history_fat.py
 * sidecars, then upserts here. Reads (panel rendering, AI search) hit
 * SQLite directly.
 *
 * FTS5 virtual table on the message text gives sub-millisecond keyword
 * search. The `account_unb` column is a forward-looking multi-account hook —
 * today we always run as a single user, but storing it now means switching
 * accounts later doesn't require a migration.
 */
export function migrateGoofishTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS goofish_sessions (
      cid TEXT PRIMARY KEY,
      account_unb TEXT NOT NULL DEFAULT '',
      session_type INTEGER NOT NULL DEFAULT 0,
      peer_user_id TEXT NOT NULL DEFAULT '',
      peer_nick TEXT NOT NULL DEFAULT '',
      peer_avatar TEXT NOT NULL DEFAULT '',
      unread INTEGER NOT NULL DEFAULT 0,
      last_msg TEXT NOT NULL DEFAULT '',
      ts INTEGER NOT NULL DEFAULT 0,
      item_id TEXT NOT NULL DEFAULT '',
      item_title TEXT NOT NULL DEFAULT '',
      item_main_pic TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      synced_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_goofish_sessions_ts ON goofish_sessions(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_goofish_sessions_peer ON goofish_sessions(peer_user_id);
    CREATE INDEX IF NOT EXISTS idx_goofish_sessions_account ON goofish_sessions(account_unb);

    CREATE TABLE IF NOT EXISTS goofish_messages (
      message_id TEXT NOT NULL,
      cid TEXT NOT NULL,
      account_unb TEXT NOT NULL DEFAULT '',
      from_user_id TEXT NOT NULL DEFAULT '',
      from_user_name TEXT NOT NULL DEFAULT '',
      to_user_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      read_status INTEGER NOT NULL DEFAULT 0,
      content_kind TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL DEFAULT '',
      synced_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      PRIMARY KEY (cid, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_goofish_msgs_cid_ts ON goofish_messages(cid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_goofish_msgs_text ON goofish_messages(content_text);

    CREATE TABLE IF NOT EXISTS goofish_sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  // FTS5 over messages — created separately so failures (e.g., FTS5 not built
  // into sqlite) don't take down the whole boot.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS goofish_msgs_fts USING fts5(
        content_text,
        peer_nick UNINDEXED,
        cid UNINDEXED,
        message_id UNINDEXED,
        tokenize = 'unicode61'
      );
    `);
  } catch (err) {
    // Older SQLite without FTS5 — search will fall back to LIKE.
    console.warn('[goofish] FTS5 unavailable, search will use LIKE:', (err as Error).message);
  }
}
