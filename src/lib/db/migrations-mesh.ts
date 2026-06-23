import Database from 'better-sqlite3';

/**
 * 网状协作运行时（mesh）的表。
 * - mesh_blackboard：共享状态 + 留痕（按 run_id,key,version 保留历史）
 * - mesh_message：事件 / mesh_message_delivery：per-subscriber 投递
 * - mesh_agent / mesh_team_config / mesh_risk_rules：按 workshop_id 隔离（多工作室），复合主键 (workshop_id, id)
 */

/** agent/config/risk 的列定义（含 workshop_id + 复合主键），CREATE 与旧库重建共用，避免 schema 写两遍。 */
const AGENT_SCHEMA = `
  id TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  mcp_json TEXT NOT NULL DEFAULT '[]',
  tool_json TEXT NOT NULL DEFAULT '[]',
  topics_json TEXT NOT NULL DEFAULT '[]',
  interval_sec INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  work_mode TEXT NOT NULL DEFAULT 'event_driven',
  provider_id TEXT NOT NULL DEFAULT '',
  workshop_id TEXT NOT NULL DEFAULT 'mesh_team_default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workshop_id, id)`
const AGENT_COLS = 'id, role, system_prompt, model, mcp_json, tool_json, topics_json, interval_sec, enabled, sort_order, work_mode, provider_id, updated_at'

const TEAM_CONFIG_SCHEMA = `
  id TEXT NOT NULL DEFAULT 'default',
  blacklist_json TEXT NOT NULL DEFAULT '[]',
  focus TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','observe_only')),
  trade_mode TEXT NOT NULL DEFAULT 'paper' CHECK(trade_mode IN ('paper','live')),
  watchlist_json TEXT NOT NULL DEFAULT '[]',
  workshop_id TEXT NOT NULL DEFAULT 'mesh_team_default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workshop_id, id)`
const TEAM_CONFIG_COLS = 'id, blacklist_json, focus, mode, trade_mode, watchlist_json, updated_at'

const RISK_SCHEMA = `
  id TEXT NOT NULL DEFAULT 'default',
  max_order_notional REAL NOT NULL DEFAULT 50000,
  max_symbol_qty INTEGER NOT NULL DEFAULT 10000,
  max_total_notional REAL NOT NULL DEFAULT 200000,
  blacklist_json TEXT NOT NULL DEFAULT '[]',
  no_chase_limit_up INTEGER NOT NULL DEFAULT 1,
  max_daily_loss_abs REAL NOT NULL DEFAULT 20000,
  max_order_count INTEGER NOT NULL DEFAULT 20,
  max_daily_notional REAL NOT NULL DEFAULT 300000,
  workshop_id TEXT NOT NULL DEFAULT 'mesh_team_default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workshop_id, id)`
const RISK_COLS = 'id, max_order_notional, max_symbol_qty, max_total_notional, blacklist_json, no_chase_limit_up, max_daily_loss_abs, max_order_count, max_daily_notional, updated_at'

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
      task_id TEXT DEFAULT NULL,
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
      filled_qty INTEGER DEFAULT NULL,
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

    CREATE TABLE IF NOT EXISTS mesh_command (
      id TEXT PRIMARY KEY,
      raw_message TEXT NOT NULL DEFAULT '',
      command_json TEXT NOT NULL DEFAULT '{}',
      relaxes_risk INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','rejected')),
      workshop_id TEXT NOT NULL DEFAULT 'mesh_team_default',
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

    CREATE TABLE IF NOT EXISTS mesh_participant (
      run_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      subscriptions_json TEXT NOT NULL DEFAULT '[]',
      work_mode TEXT NOT NULL DEFAULT 'event_driven'
        CHECK(work_mode IN ('active_loop','event_driven')),
      status TEXT NOT NULL DEFAULT 'idle'
        CHECK(status IN ('idle','running','paused','failed')),
      state_json TEXT NOT NULL DEFAULT '{}',
      backlog_json TEXT NOT NULL DEFAULT '[]',
      next_run_at INTEGER,
      last_run_at INTEGER,
      idle_streak INTEGER NOT NULL DEFAULT 0,
      cycle_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (run_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS mesh_workshop (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','draft')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mesh_blackboard_run_key ON mesh_blackboard(run_id, key, version DESC);
    CREATE INDEX IF NOT EXISTS idx_mesh_ticket_run ON mesh_order_ticket(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_mesh_message_run ON mesh_message(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mesh_delivery_sub ON mesh_message_delivery(subscriber_id, status);
    CREATE INDEX IF NOT EXISTS idx_mesh_run_status ON mesh_run(status, account_id);
    CREATE INDEX IF NOT EXISTS idx_mesh_participant_due ON mesh_participant(run_id, work_mode, next_run_at);
  `);

  // 旧 db 补列（幂等；全新库相应表由 CREATE / ensureWorkshopPkTable 直接建好）。
  // work_mode 要在重建 mesh_agent 之前补好（重建 AGENT_COLS 含 work_mode）。
  try { db.exec('ALTER TABLE mesh_message ADD COLUMN task_id TEXT') } catch { /* 列已存在 */ }
  try { db.exec("ALTER TABLE mesh_agent ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'event_driven'") } catch { /* 列已存在或表待建 */ }
  try { db.exec("ALTER TABLE mesh_agent ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''") } catch { /* 列已存在或表待建 */ }
  try { db.exec("ALTER TABLE mesh_command ADD COLUMN workshop_id TEXT NOT NULL DEFAULT 'mesh_team_default'") } catch { /* 列已存在 */ }
  try { db.exec("ALTER TABLE mesh_team_config ADD COLUMN trade_mode TEXT NOT NULL DEFAULT 'paper'") } catch { /* 列已存在或表待建 */ }
  try { db.exec("ALTER TABLE mesh_team_config ADD COLUMN watchlist_json TEXT NOT NULL DEFAULT '[]'") } catch { /* 列已存在或表待建 */ }
  try { db.exec('ALTER TABLE mesh_order_ticket ADD COLUMN filled_qty INTEGER DEFAULT NULL') } catch { /* 列已存在 */ }

  // agent/team_config/risk：PK 含 workshop_id（多工作室隔离）。新库直接建，旧库（单列 PK=id）重建迁移。
  ensureWorkshopPkTable(db, 'mesh_agent', AGENT_SCHEMA, AGENT_COLS)
  ensureWorkshopPkTable(db, 'mesh_team_config', TEAM_CONFIG_SCHEMA, TEAM_CONFIG_COLS)
  ensureWorkshopPkTable(db, 'mesh_risk_rules', RISK_SCHEMA, RISK_COLS)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mesh_agent_workshop ON mesh_agent(workshop_id, sort_order)`)

  // 种默认工作室（幂等）：id 与 DEFAULT_WORKSHOP_ID/DEFAULT_ACCOUNT_ID 一致，现有账户/数据归它、零迁移。
  db.exec(
    `INSERT OR IGNORE INTO mesh_workshop (id, name, description) VALUES ('mesh_team_default', '默认工作室', '炒股 AI 团队默认工作室')`,
  )

  // W7：复盘 agent 改收盘触发（现有 review 行也改，用户定）。仅改还是主动循环的，幂等、不覆盖用户已自定义的事件驱动配置。
  db.exec(`UPDATE mesh_agent SET work_mode='event_driven', topics_json='["market_close"]' WHERE role='review' AND work_mode='active_loop'`)
}

/**
 * 建/迁移 PK=(workshop_id, id) 的表：新库直接建；旧库（单列 PK=id）重建迁移，
 * 现有行的 workshop_id 走 DEFAULT 'mesh_team_default'（零迁移归默认工作室）。幂等：已复合主键则跳过。
 */
function ensureWorkshopPkTable(db: Database.Database, table: string, schema: string, cols: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${schema})`)
  const pk = db.prepare(`SELECT count(*) AS c FROM pragma_table_info('${table}') WHERE pk > 0`).get() as { c: number }
  if (pk.c >= 2) return // 已是 (workshop_id, id) 复合主键，无需迁移
  db.transaction(() => {
    db.exec(`CREATE TABLE ${table}__tmp (${schema})`)
    db.exec(`INSERT INTO ${table}__tmp (${cols}) SELECT ${cols} FROM ${table}`)
    db.exec(`DROP TABLE ${table}`)
    db.exec(`ALTER TABLE ${table}__tmp RENAME TO ${table}`)
  })()
}
