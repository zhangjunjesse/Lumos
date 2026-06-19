import Database from 'better-sqlite3';

/**
 * 网状协作运行时（mesh）的表。
 * - mesh_blackboard：共享状态 + 留痕（按 run_id,key,version 保留历史）
 * - mesh_message：事件
 * - mesh_message_delivery：per-subscriber 投递状态（一条事件给每个订阅者一条记录）
 */
export function migrateMeshTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mesh_blackboard (
      run_id TEXT NOT NULL,
      key TEXT NOT NULL,
      version INTEGER NOT NULL,
      value_json TEXT NOT NULL DEFAULT '{}',
      written_by TEXT NOT NULL DEFAULT '',
      written_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, key, version)
    );

    CREATE TABLE IF NOT EXISTS mesh_message (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      from_participant TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mesh_message_delivery (
      message_id TEXT NOT NULL REFERENCES mesh_message(id) ON DELETE CASCADE,
      subscriber_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','done','failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT DEFAULT NULL,
      PRIMARY KEY (message_id, subscriber_id)
    );

    CREATE TABLE IF NOT EXISTS mesh_order_ticket (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy','sell')),
      qty INTEGER NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','filled','rejected')),
      reject_reason TEXT NOT NULL DEFAULT '',
      risk_snapshot_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'paper' CHECK(mode IN ('paper','live')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      filled_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS mesh_paper_account (
      run_id TEXT PRIMARY KEY,
      cash REAL NOT NULL DEFAULT 0,
      positions_json TEXT NOT NULL DEFAULT '{}',
      realized_pnl REAL NOT NULL DEFAULT 0,
      fees_paid REAL NOT NULL DEFAULT 0,
      order_count INTEGER NOT NULL DEFAULT 0,
      notional_traded REAL NOT NULL DEFAULT 0,
      halted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mesh_team_config (
      id TEXT PRIMARY KEY,
      blacklist_json TEXT NOT NULL DEFAULT '[]',
      focus TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','observe_only')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mesh_command (
      id TEXT PRIMARY KEY,
      raw_message TEXT NOT NULL DEFAULT '',
      command_json TEXT NOT NULL DEFAULT '{}',
      relaxes_risk INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mesh_run (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','stopped')),
      rounds INTEGER NOT NULL DEFAULT 0,
      interval_ms INTEGER NOT NULL DEFAULT 0,
      last_run_id TEXT DEFAULT NULL,
      last_error TEXT DEFAULT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mesh_blackboard_run_key ON mesh_blackboard(run_id, key, version DESC);
    CREATE INDEX IF NOT EXISTS idx_mesh_ticket_run ON mesh_order_ticket(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_mesh_message_run ON mesh_message(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mesh_delivery_sub ON mesh_message_delivery(subscriber_id, status);
    CREATE TABLE IF NOT EXISTS mesh_risk_rules (
      id TEXT PRIMARY KEY,
      max_order_notional REAL NOT NULL DEFAULT 50000,
      max_symbol_qty INTEGER NOT NULL DEFAULT 10000,
      max_total_notional REAL NOT NULL DEFAULT 200000,
      blacklist_json TEXT NOT NULL DEFAULT '[]',
      no_chase_limit_up INTEGER NOT NULL DEFAULT 1,
      max_daily_loss_abs REAL NOT NULL DEFAULT 20000,
      max_order_count INTEGER NOT NULL DEFAULT 20,
      max_daily_notional REAL NOT NULL DEFAULT 300000,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mesh_agent (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      mcp_json TEXT NOT NULL DEFAULT '[]',
      tool_json TEXT NOT NULL DEFAULT '[]',
      topics_json TEXT NOT NULL DEFAULT '[]',
      interval_sec INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mesh_run_status ON mesh_run(status, account_id);
  `);
}
