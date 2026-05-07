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

    -- lumos_app_data deliberately has NO foreign key to lumos_app_apps.
    -- Uninstall defaults to keeping user data (per requirements §3 and main
    -- design §8.6) so a re-install of the same app id reconnects to the
    -- prior dataset. To purge data, the installer's keepData=false branch
    -- issues an explicit DELETE FROM lumos_app_data WHERE app_id = ?.
    CREATE TABLE IF NOT EXISTS lumos_app_data (
      app_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, collection, id)
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
      status TEXT NOT NULL CHECK (status IN ('gathering','generating','demo_review','final_build','installed','iterating','failed')),
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

    CREATE TABLE IF NOT EXISTS lumos_app_builder_stories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      story_text TEXT NOT NULL,
      actor TEXT,
      goal TEXT,
      benefit TEXT,
      status TEXT NOT NULL CHECK (status IN (
        'draft',
        'pending_confirmation',
        'confirmed',
        'in_progress',
        'implemented',
        'accepted',
        'deferred'
      )),
      priority INTEGER NOT NULL DEFAULT 2,
      acceptance_criteria_json TEXT,
      related_pages_json TEXT,
      related_collections_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
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
  if (!indexExists(db, 'idx_lumos_app_builder_stories')) {
    db.exec(`
      CREATE INDEX idx_lumos_app_builder_stories
        ON lumos_app_builder_stories(session_id, sort_order, created_at)
    `);
  }

  migrateBuilderSessionStatusCheck(db);

  // Suppress unused warning when only index creation runs.
  void tableExists;
}

function migrateBuilderSessionStatusCheck(db: Database.Database): void {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='lumos_app_builder_sessions'",
    )
    .get() as { sql?: string } | undefined;
  if (!row?.sql) return;
  if (row.sql.includes("'demo_review'") && row.sql.includes("'final_build'")) return;

  db.pragma('foreign_keys = OFF');
  try {
    const txn = db.transaction(() => {
      db.exec(`
        CREATE TABLE lumos_app_builder_sessions_new (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('gathering','generating','demo_review','final_build','installed','iterating','failed')),
          needs_summary_json TEXT,
          app_id TEXT,
          template_id TEXT,
          llm_model TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO lumos_app_builder_sessions_new
          (id, status, needs_summary_json, app_id, template_id, llm_model, created_at, updated_at)
        SELECT id, status, needs_summary_json, app_id, template_id, llm_model, created_at, updated_at
        FROM lumos_app_builder_sessions;
      `);
      db.exec(`DROP TABLE lumos_app_builder_sessions;`);
      db.exec(
        `ALTER TABLE lumos_app_builder_sessions_new RENAME TO lumos_app_builder_sessions;`,
      );
    });
    txn();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
