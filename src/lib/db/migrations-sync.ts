import Database from 'better-sqlite3';

export function migrateSyncTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lumos_session_id TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      platform_chat_id TEXT NOT NULL UNIQUE,
      bind_token TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bindings_session ON session_bindings(lumos_session_id);
    CREATE INDEX IF NOT EXISTS idx_bindings_platform_chat ON session_bindings(platform, platform_chat_id);

    CREATE TABLE IF NOT EXISTS message_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id INTEGER NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      source_platform TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      synced_at INTEGER NOT NULL,
      FOREIGN KEY (binding_id) REFERENCES session_bindings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sync_log_message ON message_sync_log(message_id);
    CREATE INDEX IF NOT EXISTS idx_sync_log_binding ON message_sync_log(binding_id);
  `);
}
