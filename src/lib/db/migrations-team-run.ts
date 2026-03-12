import Database from 'better-sqlite3'

export function migrateTeamRunTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'running', 'paused', 'done', 'failed', 'cancelled')),
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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'running', 'waiting', 'blocked', 'done', 'failed', 'cancelled')),
      dependencies TEXT NOT NULL DEFAULT '[]',
      latest_result TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
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
      content BLOB NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES team_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (stage_id) REFERENCES team_run_stages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_team_run_stages_run_id ON team_run_stages(run_id);
    CREATE INDEX IF NOT EXISTS idx_team_run_stages_status ON team_run_stages(status);
    CREATE INDEX IF NOT EXISTS idx_team_run_artifacts_stage_id ON team_run_artifacts(stage_id);
  `)
}
