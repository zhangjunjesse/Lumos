import Database from 'better-sqlite3';

export function migrateSyncTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lumos_session_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_chat_id TEXT NOT NULL DEFAULT '',
      bind_token TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bindings_session ON session_bindings(lumos_session_id);
    CREATE INDEX IF NOT EXISTS idx_bindings_platform_chat ON session_bindings(platform, platform_chat_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_token ON session_bindings(bind_token) WHERE bind_token IS NOT NULL;

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

    CREATE TABLE IF NOT EXISTS platform_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      platform_username TEXT,
      lumos_user_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(platform, platform_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_platform_users_platform ON platform_users(platform, platform_user_id);

    CREATE TABLE IF NOT EXISTS bridge_events (
      id TEXT PRIMARY KEY,
      binding_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      direction TEXT NOT NULL,
      transport_kind TEXT NOT NULL,
      channel_id TEXT NOT NULL DEFAULT '',
      platform_account_id TEXT NOT NULL DEFAULT 'default',
      platform_message_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (binding_id) REFERENCES session_bindings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_events_binding_created
      ON bridge_events(binding_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bridge_events_status_updated
      ON bridge_events(status, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_events_platform_message
      ON bridge_events(platform, direction, channel_id, platform_message_id)
      WHERE platform_message_id != '';

    CREATE TABLE IF NOT EXISTS bridge_connections (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT 'default',
      transport_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      last_connected_at INTEGER,
      last_disconnected_at INTEGER,
      last_event_at INTEGER,
      last_error_at INTEGER,
      last_error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (platform, account_id, transport_kind)
    );
  `);

  const bindingColumns = db.prepare('PRAGMA table_info(session_bindings)').all() as Array<{ name: string }>;
  const bindingColumnNames = new Set(bindingColumns.map((column) => column.name));

  if (!bindingColumnNames.has('platform_chat_name')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN platform_chat_name TEXT NOT NULL DEFAULT ''");
  }

  if (!bindingColumnNames.has('share_link')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN share_link TEXT NOT NULL DEFAULT ''");
  }
}
