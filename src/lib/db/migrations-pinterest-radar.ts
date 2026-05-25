import Database from 'better-sqlite3';

function safeAddColumn(db: Database.Database, sql: string): void {
  try {
    db.exec(sql);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('duplicate column name')) throw err;
  }
}

/**
 * Pinterest Trends 选品雷达 — 一轮 PinterestRun 沿 5 步推进:
 *   ① huntground(选猎场,纯前端配置 → 写 config_json)
 *   ② collect    → pinterest_trending
 *   ③ metrics    → pinterest_metrics
 *   ④ analyze    → pinterest_analysis
 *   ⑤ report     → pinterest_reports
 *
 * 设计原则跟 Etsy 一致:每张表带 run_id + CASCADE,JSON 字段用 TEXT 存。
 */
export function migratePinterestRadarTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pinterest_runs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed','archived')),
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      failure_reason TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      config_json TEXT NOT NULL DEFAULT '{}',
      trending_count INTEGER NOT NULL DEFAULT 0,
      metrics_count INTEGER NOT NULL DEFAULT 0,
      analyzed_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_pinterest_runs_started ON pinterest_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pinterest_runs_status ON pinterest_runs(status);

    -- 步骤状态机
    CREATE TABLE IF NOT EXISTS pinterest_run_steps (
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','running','blocked','done','failed','skipped')),
      progress_done INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      finished_at INTEGER,
      error_message TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (run_id, step_id),
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    -- 滚动日志
    CREATE TABLE IF NOT EXISTS pinterest_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info','warn','error')) DEFAULT 'info',
      message TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pinterest_run_logs_run_ts ON pinterest_run_logs(run_id, ts DESC);

    -- ② Trending 词条(/top_trends_filtered/ API 直接返回的字段)
    CREATE TABLE IF NOT EXISTS pinterest_trending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      rank INTEGER,                                   -- 1-based,1 = 列表榜首
      term TEXT NOT NULL,
      preset TEXT NOT NULL,                           -- 'growing'/'seasonal'/'monthly'/'yearly'
      normalized_count REAL,                          -- Pinterest 归一化搜索量(0-100)
      seasonality_score REAL,                         -- 季节性得分 0-1
      wow_change REAL,                                -- top_trends_filtered 直接给的 WoW %
      mom_change REAL,
      yoy_change REAL,
      captured_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pinterest_trending_run ON pinterest_trending(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pinterest_trending_run_term ON pinterest_trending(run_id, term);

    -- ③ 90 天 metrics(完整 JSON)
    CREATE TABLE IF NOT EXISTS pinterest_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      term TEXT NOT NULL,
      wow_change REAL,
      mom_change REAL,
      yoy_change REAL,
      counts_json TEXT NOT NULL DEFAULT '[]',         -- [{date, normalizedCount}, ...]
      has_prediction INTEGER NOT NULL DEFAULT 0,
      fetched_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pinterest_metrics_run ON pinterest_metrics(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pinterest_metrics_run_term ON pinterest_metrics(run_id, term);

    -- ④ AI 解读
    CREATE TABLE IF NOT EXISTS pinterest_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      term TEXT NOT NULL,
      niche TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT '',
      creative_angles_json TEXT NOT NULL DEFAULT '[]',
      risks_json TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0,
      rationale TEXT NOT NULL DEFAULT '',
      model_used TEXT NOT NULL DEFAULT '',
      analyzed_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pinterest_analysis_run ON pinterest_analysis(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pinterest_analysis_run_term ON pinterest_analysis(run_id, term);

    -- ⑤ Etsy listing(每 trending 词在 etsy.com 搜索后抓 top N)
    CREATE TABLE IF NOT EXISTS pinterest_etsy_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      term TEXT NOT NULL,
      rank INTEGER NOT NULL,                          -- 1-based,1 = 搜索结果第 1 个
      listing_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      img_url TEXT NOT NULL DEFAULT '',               -- Etsy CDN 原图 URL(报告里 <img src> 直接用)
      price TEXT NOT NULL DEFAULT '',
      shop TEXT NOT NULL DEFAULT '',
      href TEXT NOT NULL DEFAULT '',
      fetched_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pinterest_etsy_listings_run ON pinterest_etsy_listings(run_id);
    CREATE INDEX IF NOT EXISTS idx_pinterest_etsy_listings_run_term ON pinterest_etsy_listings(run_id, term);

    -- ⑤ 市场切片 — 每个 term 在 Etsy 的总体市场指标(per term,不是 per listing)
    CREATE TABLE IF NOT EXISTS pinterest_etsy_market (
      run_id TEXT NOT NULL,
      term TEXT NOT NULL,
      total_results INTEGER,                          -- Etsy 搜索结果总数(竞争 proxy);抓不到为 NULL
      total_results_text TEXT NOT NULL DEFAULT '',    -- 原始展示文本,如 "142,000+ results"
      price_min REAL,
      price_median REAL,
      price_max REAL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, term),
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    -- ⑥ PDF 报告(原 ⑤,挪后)
    CREATE TABLE IF NOT EXISTS pinterest_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      term_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      generated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pinterest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pinterest_reports_run ON pinterest_reports(run_id);
  `);

  // 后置 ALTER —— 兼容已经建过旧表的库。新字段对应 /top_trends_filtered/ API 直返。
  safeAddColumn(db, "ALTER TABLE pinterest_trending ADD COLUMN normalized_count REAL");
  safeAddColumn(db, "ALTER TABLE pinterest_trending ADD COLUMN seasonality_score REAL");
  safeAddColumn(db, "ALTER TABLE pinterest_trending ADD COLUMN wow_change REAL");
  safeAddColumn(db, "ALTER TABLE pinterest_trending ADD COLUMN mom_change REAL");
  safeAddColumn(db, "ALTER TABLE pinterest_trending ADD COLUMN yoy_change REAL");

  // V3 — EHunt 注入的 listing 维度数据(免费扩展,装在 AdsPower)
  safeAddColumn(db, "ALTER TABLE pinterest_etsy_listings ADD COLUMN sales INTEGER");
  safeAddColumn(db, "ALTER TABLE pinterest_etsy_listings ADD COLUMN sales_window INTEGER");
  safeAddColumn(db, "ALTER TABLE pinterest_etsy_listings ADD COLUMN favorites INTEGER");
  safeAddColumn(db, "ALTER TABLE pinterest_etsy_listings ADD COLUMN store_weekly_sales INTEGER");
  safeAddColumn(db, "ALTER TABLE pinterest_etsy_listings ADD COLUMN listed_date TEXT NOT NULL DEFAULT ''");
}
