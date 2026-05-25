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
 * Etsy eRank 选品雷达 — 一轮 RadarRun 沿着 6 步状态机推进,每步产物落表。
 *
 * 表结构原则:
 *  - 每张数据表都带 run_id,删 run 时 ON DELETE CASCADE 清干净
 *  - JSON 字段用 TEXT 存,避免每步加列时改 schema
 *  - 跑批进度独立存 radar_run_steps(状态机 + 计数 + 错误消息)
 *  - radar_run_logs 滚动日志,前端可流式拉取
 *  - 不引外键到 chat_sessions / lumos_app_apps(etsy-erank 是工程内置应用)
 */
export function migrateEtsyErankTables(db: Database.Database): void {
  db.exec(`
    -- 一轮选品流程
    CREATE TABLE IF NOT EXISTS radar_runs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed','archived')),
      entry_mode TEXT NOT NULL CHECK (entry_mode IN ('with_capability','blank_slate')),
      executor TEXT NOT NULL CHECK (executor IN ('paste','adspower')) DEFAULT 'adspower',
      capabilities_json TEXT NOT NULL DEFAULT '[]',   -- ① 用户填的方向清单
      market TEXT NOT NULL DEFAULT 'US',
      platform TEXT NOT NULL DEFAULT 'etsy',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      failure_reason TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      seed_count INTEGER NOT NULL DEFAULT 0,
      converge_count INTEGER NOT NULL DEFAULT 0,
      grade_a INTEGER NOT NULL DEFAULT 0,
      grade_b INTEGER NOT NULL DEFAULT 0,
      grade_c INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_radar_runs_started ON radar_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_radar_runs_status ON radar_runs(status);

    -- 步骤状态机 + 进度 (huntground/seed/converge/verify/score/analyze/manual)
    CREATE TABLE IF NOT EXISTS radar_run_steps (
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
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    -- 跑步滚动日志(每条带 step + ts + level + msg)
    CREATE TABLE IF NOT EXISTS radar_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info','warn','error')) DEFAULT 'info',
      message TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_radar_run_logs_run_ts ON radar_run_logs(run_id, ts DESC);

    -- ② 市场热词 (eRank Trend Buzz + Monthly Trends)
    CREATE TABLE IF NOT EXISTS radar_seeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      source_tool TEXT NOT NULL,                       -- 'Trend Buzz' / 'Monthly Trends' / ...
      timeframe TEXT NOT NULL DEFAULT '',              -- 'yesterday' / 'last-30-days' / '2026-04'
      rank INTEGER,
      keyword TEXT NOT NULL,
      change_str TEXT NOT NULL DEFAULT '',             -- '↑ 223' / '↓ 1' / '-'
      avg_searches TEXT NOT NULL DEFAULT '',
      avg_ctr TEXT NOT NULL DEFAULT '',
      competition TEXT NOT NULL DEFAULT '',
      trend_note TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      collected_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_radar_seeds_run ON radar_seeds(run_id);
    CREATE INDEX IF NOT EXISTS idx_radar_seeds_run_keyword ON radar_seeds(run_id, keyword);

    -- ③ 收敛候选(preFilter + scoreCorePotential 后留下的)
    CREATE TABLE IF NOT EXISTS radar_converge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      reject_reason TEXT NOT NULL DEFAULT '',           -- 空 = 入选;否则=淘汰理由
      stats_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_radar_converge_run ON radar_converge(run_id);
    CREATE INDEX IF NOT EXISTS idx_radar_converge_run_keyword ON radar_converge(run_id, keyword);

    -- ③ 扩词(B/C 路产物)
    CREATE TABLE IF NOT EXISTS radar_expanded (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seed TEXT NOT NULL,                              -- 父 seed
      keyword TEXT NOT NULL,                           -- 扩出来的长尾词
      sources_json TEXT NOT NULL DEFAULT '[]',         -- ['B_autocomplete','C_listing_ngram']
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_radar_expanded_run ON radar_expanded(run_id);
    CREATE INDEX IF NOT EXISTS idx_radar_expanded_run_keyword ON radar_expanded(run_id, keyword);

    -- ③ C 路 listing 卡片(顺手抓的,⑤ niche 头部缩略图用)
    CREATE TABLE IF NOT EXISTS radar_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seed TEXT NOT NULL,                              -- 抓时用的 search 词
      listing_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      img_url TEXT NOT NULL DEFAULT '',                -- Etsy CDN 原始 URL(下载到 public/etsy-images/<id>.jpg)
      price TEXT NOT NULL DEFAULT '',
      shop_text TEXT NOT NULL DEFAULT '',
      href TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_radar_listings_run_seed ON radar_listings(run_id, seed);
    CREATE INDEX IF NOT EXISTS idx_radar_listings_listing ON radar_listings(listing_id);

    -- ④ Bulk 验真(eRank Bulk Tool CSV 导出 7 列)
    CREATE TABLE IF NOT EXISTS radar_bulk (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seed TEXT NOT NULL,
      keyword TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      searches TEXT NOT NULL DEFAULT '',
      clicks TEXT NOT NULL DEFAULT '',
      ctr TEXT NOT NULL DEFAULT '',
      competition TEXT NOT NULL DEFAULT '',
      kd TEXT NOT NULL DEFAULT '',
      google TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL CHECK (grade IN ('A','B','C','drop')) DEFAULT 'drop',
      batch_id TEXT NOT NULL DEFAULT '',
      verified_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    -- 唯一(run_id, keyword) — 续跑时按 keyword 去重
    CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_bulk_run_keyword ON radar_bulk(run_id, keyword);
    CREATE INDEX IF NOT EXISTS idx_radar_bulk_run_grade ON radar_bulk(run_id, grade);

    -- ⑤ LLM 解读(niche 级 + candidate 级)
    CREATE TABLE IF NOT EXISTS radar_scored_niches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seed TEXT NOT NULL,
      niche_summary TEXT NOT NULL DEFAULT '',
      niche_risks_json TEXT NOT NULL DEFAULT '[]',
      candidates_json TEXT NOT NULL DEFAULT '[]',
      stats_json TEXT NOT NULL DEFAULT '{}',
      input_hash TEXT NOT NULL DEFAULT '',
      scored_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_scored_run_seed ON radar_scored_niches(run_id, seed);

    -- ⑥ EHunt 商业分析(A 级关键词级,每词一行 + listings JSON)
    CREATE TABLE IF NOT EXISTS radar_ehunt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      analysis_json TEXT NOT NULL DEFAULT '{}',         -- 聚合统计 + LLM insight
      listings_json TEXT NOT NULL DEFAULT '[]',         -- top 24 listing × 8 字段
      ehunt_coverage INTEGER NOT NULL DEFAULT 0,
      analyzed_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_ehunt_run_keyword ON radar_ehunt(run_id, keyword);

    -- ⑦ 人工验证(原 ⑥ 挪过来)
    CREATE TABLE IF NOT EXISTS radar_validations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,                       -- 关联 ⑤ candidate
      keyword TEXT NOT NULL,
      checks_json TEXT NOT NULL DEFAULT '[]',           -- 6 项 check
      competitor_ref TEXT NOT NULL DEFAULT '',
      price_band TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      verdict TEXT,                                     -- 'pass' / 'reject' / 'insufficient' / null
      saved_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_validations_run_kw ON radar_validations(run_id, keyword);

    -- ⑦ AI 深度报告(每 A 级 keyword 一份 markdown 报告)
    CREATE TABLE IF NOT EXISTS radar_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      report_md TEXT NOT NULL DEFAULT '',     -- LLM 输出的 markdown
      input_hash TEXT NOT NULL DEFAULT '',    -- 输入数据 hash,变化才重跑
      provider_name TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      generated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES radar_runs(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_reports_run_kw ON radar_reports(run_id, keyword);
  `);

  // config_json:整轮参数(② timeframe / ② limit / ④ maxBatches / 自动级联到哪步)
  // 用 ALTER TABLE 后置加列,兼容已建好的旧库
  safeAddColumn(db, "ALTER TABLE radar_runs ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'");
}
