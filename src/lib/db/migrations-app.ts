import Database from 'better-sqlite3';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function indexExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name),
  );
}

export function migrateAppTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lumos_app_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      previous_version TEXT,
      manifest_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('builtin','local','market','ai-generated','workflow-promoted')),
      source_meta_json TEXT,
      install_path TEXT NOT NULL,
      previous_install_path TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      last_used_at INTEGER,
      size_bytes INTEGER,
      synced_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS lumos_app_configs (
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_encrypted TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, key),
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_permissions (
      app_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted INTEGER NOT NULL,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, permission),
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_data (
      app_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, collection, id),
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_runs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      page_id TEXT,
      workflow_id TEXT,
      workflow_run_id TEXT,
      triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual','schedule','event')),
      input_json TEXT,
      output_json TEXT,
      metrics_json TEXT,
      status TEXT NOT NULL CHECK (status IN ('running','success','failed','cancelled')),
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      error_message TEXT,
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_triggers (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('schedule','event')),
      config_json TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (app_id) REFERENCES lumos_app_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_builder_sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('gathering','generating','installed','iterating','failed')),
      needs_summary_json TEXT,
      app_id TEXT,
      template_id TEXT,
      llm_model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lumos_app_builder_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
      content_json TEXT NOT NULL,
      tool_name TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES lumos_app_builder_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lumos_app_builder_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','committed','rolled_back')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES lumos_app_builder_sessions(id) ON DELETE CASCADE
    );
  `);

  if (!indexExists(db, 'idx_lumos_app_data_collection')) {
    db.exec(`
      CREATE INDEX idx_lumos_app_data_collection
        ON lumos_app_data(app_id, collection, updated_at DESC)
    `);
  }
  if (!indexExists(db, 'idx_lumos_app_runs_app')) {
    db.exec(`
      CREATE INDEX idx_lumos_app_runs_app
        ON lumos_app_runs(app_id, started_at DESC)
    `);
  }
  if (!indexExists(db, 'idx_lumos_app_builder_msgs')) {
    db.exec(`
      CREATE INDEX idx_lumos_app_builder_msgs
        ON lumos_app_builder_messages(session_id, created_at)
    `);
  }
  if (!indexExists(db, 'idx_lumos_app_builder_artifacts')) {
    db.exec(`
      CREATE INDEX idx_lumos_app_builder_artifacts
        ON lumos_app_builder_artifacts(session_id, file_path, version DESC)
    `);
  }

  // Suppress unused warning when only index creation runs.
  void tableExists;
}
