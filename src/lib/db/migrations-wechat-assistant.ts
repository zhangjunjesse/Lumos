import Database from 'better-sqlite3';

function indexExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name),
  );
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((row) => row.name === column);
}

function tableSql(db: Database.Database, table: string): string {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: string } | undefined;
  return row?.sql ?? '';
}

function migrateTodoStatusConstraint(db: Database.Database): void {
  const sql = tableSql(db, 'wechat_assistant_todos');
  if (sql.includes("'in_progress'")) return;

  db.exec(`
    DROP TABLE IF EXISTS wechat_assistant_todos__new;

    CREATE TABLE wechat_assistant_todos__new (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      text TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('self','other','manual')),
      source_msg_id INTEGER,
      source_text TEXT,
      source_display TEXT,
      source_sender_display TEXT,
      source_wxid TEXT,
      involved_wxids_json TEXT,
      by_when_text TEXT,
      summary TEXT,
      next_step TEXT,
      followup_type TEXT,
      due_at INTEGER,
      remind_at INTEGER,
      confidence TEXT CHECK (confidence IN ('high','medium')),
      status TEXT NOT NULL CHECK (status IN ('suggested','open','in_progress','done','dismissed')),
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      done_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES wechat_assistant_runs(id) ON DELETE SET NULL
    );

    INSERT INTO wechat_assistant_todos__new
      (id, run_id, text, source, source_msg_id, source_text, source_display, source_wxid,
       source_sender_display, involved_wxids_json,
       by_when_text, summary, next_step, followup_type, due_at, remind_at, confidence,
       status, created_at, confirmed_at, done_at)
    SELECT
      id, run_id, text, source, source_msg_id, source_text, source_display, source_wxid,
      NULL,
      COALESCE(
        involved_wxids_json,
        CASE WHEN source_wxid IS NOT NULL AND source_wxid != '' THEN json_array(source_wxid) ELSE NULL END
      ),
      by_when_text, summary, next_step, followup_type, due_at, remind_at, confidence,
      status, created_at, confirmed_at, done_at
    FROM wechat_assistant_todos;

    DROP TABLE wechat_assistant_todos;
    ALTER TABLE wechat_assistant_todos__new RENAME TO wechat_assistant_todos;
  `);
}

/**
 * Tables for the WeChat assistant built-in app's AI analysis pipeline.
 *
 *  - wechat_assistant_runs:    one row per analysis run (event extraction round).
 *  - wechat_assistant_events:  AI-extracted events (urgency + suggested action + evidence).
 *  - wechat_assistant_todos:   suggested + confirmed + completed todos.
 *                              `source = 'self' | 'other' | 'manual'` distinguishes who
 *                              made the promise; manual entries have no run_id.
 */
export function migrateWeChatAssistantTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wechat_assistant_runs (
      id TEXT PRIMARY KEY,
      snapshot_hash TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('running','done','failed')),
      message TEXT,
      events_count INTEGER NOT NULL DEFAULT 0,
      todos_count INTEGER NOT NULL DEFAULT 0,
      tokens_in INTEGER,
      tokens_out INTEGER,
      messages_scanned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wechat_assistant_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      urgency TEXT NOT NULL CHECK (urgency IN ('urgent','important','attention')),
      contact_wxid TEXT NOT NULL,
      contact_display TEXT NOT NULL,
      is_group INTEGER NOT NULL DEFAULT 0,
      evidence_msg_ids_json TEXT NOT NULL,
      evidence_texts_json TEXT NOT NULL,
      suggested_action TEXT NOT NULL,
      last_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES wechat_assistant_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wechat_assistant_todos (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      text TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('self','other','manual')),
      source_msg_id INTEGER,
      source_text TEXT,
      source_display TEXT,
      source_sender_display TEXT,
      source_wxid TEXT,
      involved_wxids_json TEXT,
      by_when_text TEXT,
      summary TEXT,
      next_step TEXT,
      followup_type TEXT,
      due_at INTEGER,
      remind_at INTEGER,
      confidence TEXT CHECK (confidence IN ('high','medium')),
      status TEXT NOT NULL CHECK (status IN ('suggested','open','in_progress','done','dismissed')),
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      done_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES wechat_assistant_runs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS wechat_assistant_reports (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL DEFAULT '',
      automation_name TEXT NOT NULL,
      schedule_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('running','success','error','cancelled')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      summary TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      report_markdown TEXT NOT NULL DEFAULT '',
      report_file_name TEXT,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  for (const [column, type] of [
    ['summary', 'TEXT'],
    ['next_step', 'TEXT'],
    ['followup_type', 'TEXT'],
    ['involved_wxids_json', 'TEXT'],
    ['source_sender_display', 'TEXT'],
  ] as const) {
    if (!columnExists(db, 'wechat_assistant_todos', column)) {
      db.exec(`ALTER TABLE wechat_assistant_todos ADD COLUMN ${column} ${type}`);
    }
  }

  migrateTodoStatusConstraint(db);

  if (!columnExists(db, 'wechat_assistant_reports', 'deleted_at')) {
    db.exec(`ALTER TABLE wechat_assistant_reports ADD COLUMN deleted_at INTEGER`);
  }

  if (!indexExists(db, 'idx_wechat_assistant_runs_finished')) {
    db.exec(
      `CREATE INDEX idx_wechat_assistant_runs_finished
         ON wechat_assistant_runs(finished_at DESC)`,
    );
  }
  if (!indexExists(db, 'idx_wechat_assistant_events_run')) {
    db.exec(
      `CREATE INDEX idx_wechat_assistant_events_run
         ON wechat_assistant_events(run_id, urgency, last_at DESC)`,
    );
  }
  if (!indexExists(db, 'idx_wechat_assistant_todos_status')) {
    db.exec(
      `CREATE INDEX idx_wechat_assistant_todos_status
         ON wechat_assistant_todos(status, due_at, created_at DESC)`,
    );
  }
  if (!indexExists(db, 'idx_wechat_assistant_reports_started')) {
    db.exec(
      `CREATE INDEX idx_wechat_assistant_reports_started
         ON wechat_assistant_reports(started_at DESC, created_at DESC)`,
    );
  }
  if (!indexExists(db, 'idx_wechat_assistant_reports_automation')) {
    db.exec(
      `CREATE INDEX idx_wechat_assistant_reports_automation
         ON wechat_assistant_reports(automation_id, started_at DESC)`,
    );
  }
  if (!indexExists(db, 'idx_wechat_assistant_reports_run')) {
    db.exec(
      `CREATE INDEX idx_wechat_assistant_reports_run
         ON wechat_assistant_reports(run_id)`,
    );
  }
}
