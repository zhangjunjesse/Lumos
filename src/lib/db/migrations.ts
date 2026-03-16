import Database from 'better-sqlite3';

export function migrateCoreTables(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
  const colNames = columns.map(c => c.name);

  if (!colNames.includes('model')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN model TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('requested_model')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN requested_model TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('resolved_model')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN resolved_model TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('system_prompt')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('sdk_session_id')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN sdk_session_id TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('project_name')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN project_name TEXT NOT NULL DEFAULT ''");
    db.exec(`
      UPDATE chat_sessions
      SET project_name = CASE
        WHEN working_directory != '' THEN REPLACE(REPLACE(working_directory, RTRIM(working_directory, REPLACE(working_directory, '/', '')), ''), '/', '')
        ELSE ''
      END
      WHERE project_name = ''
    `);
  }
  if (!colNames.includes('status')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!colNames.includes('mode')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'code'");
  }
  if (!colNames.includes('provider_name')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN provider_name TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('provider_id')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('sdk_cwd')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN sdk_cwd TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE chat_sessions SET sdk_cwd = working_directory WHERE sdk_cwd = '' AND working_directory != ''");
  }
  if (!colNames.includes('runtime_status')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN runtime_status TEXT NOT NULL DEFAULT 'idle'");
  }
  if (!colNames.includes('runtime_updated_at')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN runtime_updated_at TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('runtime_error')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN runtime_error TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('folder')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN folder TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    UPDATE chat_sessions
    SET requested_model = CASE
      WHEN requested_model != '' THEN requested_model
      WHEN LOWER(model) = 'sonnet' OR LOWER(model) LIKE '%sonnet%' THEN 'sonnet'
      WHEN LOWER(model) = 'opus' OR LOWER(model) LIKE '%opus%' THEN 'opus'
      WHEN LOWER(model) = 'haiku' OR LOWER(model) LIKE '%haiku%' THEN 'haiku'
      ELSE model
    END
    WHERE requested_model = ''
      AND model != ''
  `);
  db.exec(`
    UPDATE chat_sessions
    SET resolved_model = CASE
      WHEN resolved_model != '' THEN resolved_model
      WHEN LOWER(model) LIKE 'claude-%' THEN model
      ELSE ''
    END
    WHERE resolved_model = ''
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_runtime_status ON chat_sessions(runtime_status)");

  // Migrate is_active provider to default_provider_id setting
  const defaultProviderSetting = db.prepare("SELECT value FROM settings WHERE key = 'default_provider_id'").get() as { value: string } | undefined;
  if (!defaultProviderSetting) {
    const activeProvider = db.prepare('SELECT id FROM api_providers WHERE is_active = 1 LIMIT 1').get() as { id: string } | undefined;
    if (activeProvider) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(activeProvider.id);
    }
  }

  const msgColumns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const msgColNames = msgColumns.map(c => c.name);

  if (!msgColNames.includes('token_usage')) {
    db.exec("ALTER TABLE messages ADD COLUMN token_usage TEXT");
  }

  // Ensure tasks table exists for databases created before this migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
      description TEXT,
      task_kind TEXT NOT NULL DEFAULT 'manual' CHECK(task_kind IN ('manual', 'team_plan')),
      team_plan_json TEXT,
      team_approval_status TEXT CHECK(team_approval_status IN ('pending', 'approved', 'rejected')),
      current_run_id TEXT,
      final_result_summary TEXT NOT NULL DEFAULT '',
      source_message_id TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      last_action_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
  `);

  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const taskColNames = taskColumns.map((column) => column.name);

  if (!taskColNames.includes('task_kind')) {
    db.exec("ALTER TABLE tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'manual' CHECK(task_kind IN ('manual', 'team_plan'))");
  }
  if (!taskColNames.includes('team_plan_json')) {
    db.exec('ALTER TABLE tasks ADD COLUMN team_plan_json TEXT');
  }
  if (!taskColNames.includes('team_approval_status')) {
    db.exec("ALTER TABLE tasks ADD COLUMN team_approval_status TEXT CHECK(team_approval_status IN ('pending', 'approved', 'rejected'))");
  }
  if (!taskColNames.includes('current_run_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN current_run_id TEXT');
  }
  if (!taskColNames.includes('final_result_summary')) {
    db.exec("ALTER TABLE tasks ADD COLUMN final_result_summary TEXT NOT NULL DEFAULT ''");
  }
  if (!taskColNames.includes('source_message_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN source_message_id TEXT');
  }
  if (!taskColNames.includes('approved_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN approved_at TEXT');
  }
  if (!taskColNames.includes('rejected_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN rejected_at TEXT');
  }
  if (!taskColNames.includes('last_action_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN last_action_at TEXT');
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_task_kind ON tasks(task_kind)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_current_run_id ON tasks(current_run_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_team_approval_status ON tasks(team_approval_status)");

  // Ensure api_providers table exists for databases created before this migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      extra_env TEXT NOT NULL DEFAULT '{}',
      model_catalog TEXT NOT NULL DEFAULT '[]',
      model_catalog_source TEXT NOT NULL DEFAULT 'default',
      model_catalog_updated_at TEXT DEFAULT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Ensure media_generations table exists for databases created before this migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_generations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'image',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      provider TEXT NOT NULL DEFAULT 'gemini',
      model TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '1:1',
      image_size TEXT NOT NULL DEFAULT '1K',
      local_path TEXT NOT NULL DEFAULT '',
      thumbnail_path TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      message_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      favorited INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS media_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_created_at ON media_generations(created_at);
    CREATE INDEX IF NOT EXISTS idx_media_session_id ON media_generations(session_id);
    CREATE INDEX IF NOT EXISTS idx_media_status ON media_generations(status);
  `);

  // Ensure media_jobs tables exist for databases created before this migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','planning','planned','running','paused','completed','cancelled','failed')),
      doc_paths TEXT NOT NULL DEFAULT '[]',
      style_prompt TEXT NOT NULL DEFAULT '',
      batch_config TEXT NOT NULL DEFAULT '{}',
      total_items INTEGER NOT NULL DEFAULT 0,
      completed_items INTEGER NOT NULL DEFAULT 0,
      failed_items INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS media_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL DEFAULT 0,
      prompt TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '1:1',
      image_size TEXT NOT NULL DEFAULT '1K',
      model TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      source_refs TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing','completed','failed','cancelled')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      result_media_generation_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES media_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (result_media_generation_id) REFERENCES media_generations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS media_context_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      sync_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK(sync_mode IN ('manual','auto_batch')),
      synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES media_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_jobs_session_id ON media_jobs(session_id);
    CREATE INDEX IF NOT EXISTS idx_media_jobs_status ON media_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_media_job_items_job_id ON media_job_items(job_id);
    CREATE INDEX IF NOT EXISTS idx_media_job_items_status ON media_job_items(status);
    CREATE INDEX IF NOT EXISTS idx_media_context_events_job_id ON media_context_events(job_id);
  `);

  // Add favorited column to media_generations if missing
  try {
    db.exec("ALTER TABLE media_generations ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists
  }

  // Recover stale jobs: mark 'running' jobs as 'paused' after process restart
  db.exec(`
    UPDATE media_jobs SET status = 'paused', updated_at = datetime('now')
    WHERE status = 'running'
  `);
  db.exec(`
    UPDATE media_job_items SET status = 'pending', updated_at = datetime('now')
    WHERE status = 'processing'
  `);

  // Create session_runtime_locks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_runtime_locks (
      session_id TEXT PRIMARY KEY,
      lock_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at ON session_runtime_locks(expires_at);
  `);

  // Create permission_requests table
  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sdk_session_id TEXT NOT NULL DEFAULT '',
      tool_name TEXT NOT NULL,
      tool_input TEXT NOT NULL,
      decision_reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending','allow','deny','timeout','aborted')),
      updated_permissions TEXT NOT NULL DEFAULT '[]',
      updated_input TEXT,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_permission_session_status ON permission_requests(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_permission_expires_at ON permission_requests(expires_at);
  `);

  // Startup recovery: reset stale runtime states from previous process
  db.exec(`
    UPDATE chat_sessions
    SET runtime_status = 'idle',
        runtime_error = 'Process restarted',
        runtime_updated_at = datetime('now')
    WHERE runtime_status IN ('running', 'waiting_permission')
  `);
  db.exec("DELETE FROM session_runtime_locks");
  db.exec(`
    UPDATE permission_requests
    SET status = 'aborted',
        resolved_at = datetime('now'),
        message = 'Process restarted'
    WHERE status = 'pending'
  `);

}
