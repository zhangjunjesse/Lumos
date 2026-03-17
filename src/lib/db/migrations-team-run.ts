import Database from 'better-sqlite3';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function recoverInterruptedTeamRunsMigration(db: Database.Database): void {
  const hasTeamRuns = tableExists(db, 'team_runs');
  const hasTempTeamRuns = tableExists(db, 'team_runs__new');

  if (!hasTempTeamRuns) {
    return;
  }

  if (!hasTeamRuns) {
    db.exec('ALTER TABLE team_runs__new RENAME TO team_runs');
    return;
  }

  db.exec('DROP TABLE team_runs__new');
}

function ensureTeamRunsStatusConstraint(db: Database.Database): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'team_runs'").get() as { sql?: string } | undefined;
  const createSql = row?.sql || '';
  if (!createSql || (createSql.includes('cancelling') && createSql.includes('summarizing'))) {
    return;
  }

  db.exec('PRAGMA foreign_keys = OFF');
  if (tableExists(db, 'team_runs__new')) {
    db.exec('DROP TABLE team_runs__new');
  }
  db.exec(`
    CREATE TABLE team_runs__new (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      task_id TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'ready', 'running', 'paused', 'cancelling', 'cancelled', 'summarizing', 'done', 'failed')),
      planner_version TEXT NOT NULL DEFAULT 'compiled-run-plan/v1',
      planning_input_json TEXT NOT NULL DEFAULT '',
      compiled_plan_json TEXT NOT NULL DEFAULT '',
      workspace_root TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      final_summary TEXT NOT NULL DEFAULT '',
      pause_requested_at INTEGER,
      cancel_requested_at INTEGER,
      published_at TEXT,
      projection_version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT
    );
  `);
  db.exec(`
    INSERT INTO team_runs__new (
      id, plan_id, task_id, session_id, status, planner_version, planning_input_json, compiled_plan_json,
      workspace_root, summary, final_summary, pause_requested_at, cancel_requested_at, published_at,
      projection_version, created_at, started_at, completed_at, error
    )
    SELECT
      id, plan_id, task_id, session_id, status, planner_version, planning_input_json, compiled_plan_json,
      workspace_root, summary, final_summary, pause_requested_at, cancel_requested_at, published_at,
      projection_version, created_at, started_at, completed_at, error
    FROM team_runs;
  `);
  db.exec('DROP TABLE team_runs');
  db.exec('ALTER TABLE team_runs__new RENAME TO team_runs');
  db.exec('PRAGMA foreign_keys = ON');
}

export function migrateTeamRunTables(db: Database.Database): void {
  recoverInterruptedTeamRunsMigration(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      task_id TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'ready', 'running', 'paused', 'cancelling', 'cancelled', 'summarizing', 'done', 'failed')),
      planner_version TEXT NOT NULL DEFAULT 'compiled-run-plan/v1',
      planning_input_json TEXT NOT NULL DEFAULT '',
      compiled_plan_json TEXT NOT NULL DEFAULT '',
      workspace_root TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      final_summary TEXT NOT NULL DEFAULT '',
      pause_requested_at INTEGER,
      cancel_requested_at INTEGER,
      published_at TEXT,
      projection_version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS team_run_stages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role_id TEXT NOT NULL,
      task TEXT NOT NULL,
      plan_task_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      owner_agent_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'running', 'waiting', 'blocked', 'done', 'failed', 'cancelled')),
      dependencies TEXT NOT NULL DEFAULT '[]',
      input_contract_json TEXT NOT NULL DEFAULT '{}',
      output_contract_json TEXT NOT NULL DEFAULT '{}',
      latest_result TEXT,
      latest_result_ref TEXT,
      error TEXT,
      last_error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      agent_definition_id TEXT,
      workspace_dir TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      last_attempt_id TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_run_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('output', 'file', 'log', 'metadata')),
      title TEXT NOT NULL DEFAULT '',
      source_path TEXT,
      content BLOB NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (stage_id) REFERENCES team_run_stages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_run_stage_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      agent_instance_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('created', 'running', 'done', 'failed', 'cancelled')),
      result_summary TEXT NOT NULL DEFAULT '',
      result_artifact_id TEXT,
      error_code TEXT,
      error_message TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (stage_id) REFERENCES team_run_stages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_run_agent_instances (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      agent_definition_id TEXT NOT NULL,
      memory_space_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('allocated', 'running', 'completed', 'failed', 'released')),
      created_at INTEGER NOT NULL,
      released_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (stage_id) REFERENCES team_run_stages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_run_memories (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage_id TEXT,
      owner_type TEXT NOT NULL CHECK(owner_type IN ('task', 'planner', 'agent_instance')),
      owner_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE
    );
  `);

  ensureColumn(db, 'team_runs', 'task_id', 'TEXT');
  ensureColumn(db, 'team_runs', 'session_id', 'TEXT');
  ensureColumn(db, 'team_runs', 'planner_version', "TEXT NOT NULL DEFAULT 'compiled-run-plan/v1'");
  ensureColumn(db, 'team_runs', 'planning_input_json', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_runs', 'compiled_plan_json', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_runs', 'workspace_root', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_runs', 'summary', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_runs', 'final_summary', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_runs', 'pause_requested_at', 'INTEGER');
  ensureColumn(db, 'team_runs', 'cancel_requested_at', 'INTEGER');
  ensureColumn(db, 'team_runs', 'published_at', 'TEXT');
  ensureColumn(db, 'team_runs', 'projection_version', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn(db, 'team_run_stages', 'plan_task_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_run_stages', 'description', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_run_stages', 'owner_agent_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_run_stages', 'input_contract_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'team_run_stages', 'output_contract_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'team_run_stages', 'latest_result_ref', 'TEXT');
  ensureColumn(db, 'team_run_stages', 'last_error', 'TEXT');
  ensureColumn(db, 'team_run_stages', 'agent_definition_id', 'TEXT');
  ensureColumn(db, 'team_run_stages', 'workspace_dir', 'TEXT');
  ensureColumn(db, 'team_run_stages', 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'team_run_stages', 'last_attempt_id', 'TEXT');
  ensureColumn(db, 'team_run_artifacts', 'title', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'team_run_artifacts', 'source_path', 'TEXT');

  ensureTeamRunsStatusConstraint(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_team_runs_task_id ON team_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_team_runs_session_id ON team_runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_team_runs_status ON team_runs(status);
    CREATE INDEX IF NOT EXISTS idx_team_run_stages_run_id ON team_run_stages(run_id);
    CREATE INDEX IF NOT EXISTS idx_team_run_stages_status ON team_run_stages(status);
    CREATE INDEX IF NOT EXISTS idx_team_run_stages_run_status ON team_run_stages(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_team_run_stages_plan_task_id ON team_run_stages(plan_task_id);
    CREATE INDEX IF NOT EXISTS idx_team_run_artifacts_stage_id ON team_run_artifacts(stage_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_attempt_unique ON team_run_stage_attempts(stage_id, attempt_no);
    CREATE INDEX IF NOT EXISTS idx_agent_instances_run_status ON team_run_agent_instances(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_team_run_memories_owner ON team_run_memories(run_id, owner_type, owner_id);
    CREATE INDEX IF NOT EXISTS idx_team_run_events_run_created ON team_run_events(run_id, created_at);
  `);
}
