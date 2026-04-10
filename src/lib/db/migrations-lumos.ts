import Database from 'better-sqlite3';
import crypto from 'crypto';
import { resolveProviderPersistenceFields } from '../provider-config';
import { seedBuiltinProviders, seedBuiltinSkills, seedBuiltinMcpServers } from './seed-builtin';

export function migrateLumosTables(db: Database.Database): void {
  // Knowledge base tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS deepsearch_sites (
      id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      cookie_value TEXT NOT NULL DEFAULT '',
      cookie_status TEXT NOT NULL DEFAULT 'missing'
        CHECK(cookie_status IN ('missing','valid','expired','unknown')),
      cookie_expires_at TEXT DEFAULT NULL,
      last_validated_at TEXT DEFAULT NULL,
      validation_message TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deepsearch_runs (
      id TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      site_keys_json TEXT NOT NULL DEFAULT '[]',
      eligible_site_keys_json TEXT NOT NULL DEFAULT '[]',
      blocked_site_keys_json TEXT NOT NULL DEFAULT '[]',
      page_mode TEXT NOT NULL
        CHECK(page_mode IN ('takeover_active_page','managed_page')),
      strictness TEXT NOT NULL
        CHECK(strictness IN ('strict','best_effort')),
      status TEXT NOT NULL
        CHECK(status IN ('pending','running','waiting_login','paused','completed','partial','failed','cancelled')),
      status_message TEXT NOT NULL DEFAULT '',
      result_summary TEXT NOT NULL DEFAULT '',
      detail_markdown TEXT NOT NULL DEFAULT '',
      created_from TEXT NOT NULL DEFAULT 'extensions'
        CHECK(created_from IN ('extensions','chat','workflow','api')),
      requested_by_session_id TEXT DEFAULT NULL,
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deepsearch_run_pages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES deepsearch_runs(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL,
      site_key TEXT DEFAULT NULL,
      binding_type TEXT NOT NULL
        CHECK(binding_type IN ('taken_over_active_page','managed_page')),
      role TEXT NOT NULL DEFAULT 'seed'
        CHECK(role IN ('seed','search','detail','login')),
      initial_url TEXT DEFAULT NULL,
      last_known_url TEXT DEFAULT NULL,
      page_title TEXT DEFAULT NULL,
      attached_at TEXT NOT NULL DEFAULT (datetime('now')),
      released_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS deepsearch_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES deepsearch_runs(id) ON DELETE CASCADE,
      run_page_id TEXT DEFAULT NULL REFERENCES deepsearch_run_pages(id) ON DELETE SET NULL,
      site_key TEXT DEFAULT NULL,
      url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content_state TEXT NOT NULL DEFAULT 'partial'
        CHECK(content_state IN ('list_only','partial','full','failed')),
      snippet TEXT NOT NULL DEFAULT '',
      evidence_count INTEGER NOT NULL DEFAULT 0,
      failure_stage TEXT DEFAULT NULL
        CHECK(failure_stage IS NULL OR failure_stage IN ('login','navigation','extraction','normalization')),
      login_related INTEGER NOT NULL DEFAULT 0,
      content_artifact_id TEXT DEFAULT NULL,
      screenshot_artifact_id TEXT DEFAULT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deepsearch_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES deepsearch_runs(id) ON DELETE CASCADE,
      record_id TEXT DEFAULT NULL REFERENCES deepsearch_records(id) ON DELETE SET NULL,
      kind TEXT NOT NULL
        CHECK(kind IN ('content','screenshot','structured_json','evidence_snippet','html_snapshot')),
      title TEXT NOT NULL DEFAULT '',
      storage_path TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deepsearch_site_states (
      site_key TEXT PRIMARY KEY REFERENCES deepsearch_sites(site_key) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      login_state TEXT NOT NULL DEFAULT 'missing'
        CHECK(login_state IN ('missing','connected','suspected_expired','expired','error')),
      last_checked_at TEXT DEFAULT NULL,
      last_login_at TEXT DEFAULT NULL,
      blocking_reason TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_deepsearch_sites_status ON deepsearch_sites(cookie_status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_runs_status ON deepsearch_runs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_runs_created ON deepsearch_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_run_pages_run ON deepsearch_run_pages(run_id, attached_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_run_pages_page ON deepsearch_run_pages(page_id, attached_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_records_run ON deepsearch_records(run_id, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_records_page ON deepsearch_records(run_page_id, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_artifacts_run ON deepsearch_artifacts(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_artifacts_record ON deepsearch_artifacts(record_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deepsearch_site_states_login ON deepsearch_site_states(login_state, updated_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      code TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'llm',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_task_mapping (
      workflow_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      execution_id TEXT,
      PRIMARY KEY (workflow_id, task_id)
    );

    CREATE TABLE IF NOT EXISTS workflow_executions (
      workflow_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL DEFAULT '',
      workflow_version TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      progress INTEGER NOT NULL DEFAULT 0,
      current_step TEXT,
      completed_steps_json TEXT NOT NULL DEFAULT '[]',
      running_steps_json TEXT NOT NULL DEFAULT '[]',
      skipped_steps_json TEXT NOT NULL DEFAULT '[]',
      step_ids_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT,
      error_json TEXT,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_defs_name_version ON workflow_definitions(name, version);
    CREATE INDEX IF NOT EXISTS idx_workflow_task_mapping_task ON workflow_task_mapping(task_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_exec_task ON workflow_executions(task_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_exec_status ON workflow_executions(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS kb_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kb_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES kb_collections(id),
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      source_key TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      doc_date TEXT DEFAULT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      reference_count INTEGER NOT NULL DEFAULT 0,
      last_referenced_at TEXT DEFAULT NULL,
      health_status TEXT NOT NULL DEFAULT 'healthy',
      health_reason TEXT NOT NULL DEFAULT '',
      health_checked_at TEXT DEFAULT NULL,
      summary_embedding BLOB DEFAULT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      processing_status TEXT NOT NULL DEFAULT 'pending',
      processing_detail TEXT NOT NULL DEFAULT '{"parse":"pending","chunk":"pending","bm25":"pending","embedding":"pending","summary":"pending","mode":"full"}',
      processing_error TEXT NOT NULL DEFAULT '',
      processing_updated_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES kb_items(id),
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      embedding BLOB,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS kb_bm25_index (
      term TEXT NOT NULL,
      chunk_id TEXT NOT NULL REFERENCES kb_chunks(id),
      tf REAL NOT NULL,
      PRIMARY KEY (term, chunk_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kb_items_collection ON kb_items(collection_id);
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_item ON kb_chunks(item_id);
    CREATE INDEX IF NOT EXISTS idx_kb_bm25_term ON kb_bm25_index(term);
  `);

  db.exec(`
    INSERT OR IGNORE INTO deepsearch_sites (id, site_key, display_name, base_url)
    VALUES
      ('deepsearch-site-zhihu', 'zhihu', 'Zhihu', 'https://www.zhihu.com'),
      ('deepsearch-site-xiaohongshu', 'xiaohongshu', 'Xiaohongshu', 'https://www.xiaohongshu.com'),
      ('deepsearch-site-juejin', 'juejin', 'Juejin', 'https://juejin.cn'),
      ('deepsearch-site-wechat', 'wechat', 'WeChat Articles', 'https://mp.weixin.qq.com'),
      ('deepsearch-site-x', 'x', 'X / Twitter', 'https://x.com');
  `);

  // Add source_key to kb_items if missing
  const kbItemColsExt = db.prepare("PRAGMA table_info(kb_items)").all() as { name: string }[];
  const kbItemColNamesExt = kbItemColsExt.map(c => c.name);
  if (!kbItemColNamesExt.includes('source_key')) {
    db.exec("ALTER TABLE kb_items ADD COLUMN source_key TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_kb_items_source_key ON kb_items(collection_id, source_key)");

  // Knowledge ingest queue tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_ingest_jobs (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES kb_collections(id),
      source_dir TEXT NOT NULL,
      recursive INTEGER NOT NULL DEFAULT 1,
      max_files INTEGER NOT NULL DEFAULT 200,
      max_file_size INTEGER NOT NULL DEFAULT 20971520,
      force_reprocess INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','completed','failed','cancelled')),
      total_files INTEGER NOT NULL DEFAULT 0,
      processed_files INTEGER NOT NULL DEFAULT 0,
      success_files INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0,
      skipped_files INTEGER NOT NULL DEFAULT 0,
      duplicate_files INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kb_ingest_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES kb_ingest_jobs(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL DEFAULT 0,
      file_path TEXT NOT NULL,
      source_key TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','completed','failed','skipped','duplicate')),
      attempts INTEGER NOT NULL DEFAULT 0,
      item_id TEXT DEFAULT NULL REFERENCES kb_items(id) ON DELETE SET NULL,
      mode TEXT NOT NULL DEFAULT 'full'
        CHECK(mode IN ('full','reference')),
      parse_error TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_jobs_status ON kb_ingest_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_jobs_collection ON kb_ingest_jobs(collection_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_job_items_job ON kb_ingest_job_items(job_id, idx);
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_job_items_status ON kb_ingest_job_items(status, updated_at);
  `);
  const ingestJobCols = db.prepare("PRAGMA table_info(kb_ingest_jobs)").all() as { name: string }[];
  const ingestJobColNames = ingestJobCols.map(c => c.name);
  if (!ingestJobColNames.includes('force_reprocess')) {
    db.exec("ALTER TABLE kb_ingest_jobs ADD COLUMN force_reprocess INTEGER NOT NULL DEFAULT 0");
  }

  // Documents table (for built-in editor) — extended for Lumos v1.2
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT 'markdown',
      source_type TEXT NOT NULL DEFAULT 'create',
      source_path TEXT NOT NULL DEFAULT '',
      source_meta TEXT NOT NULL DEFAULT '{}',
      kb_enabled INTEGER NOT NULL DEFAULT 1,
      kb_item_id TEXT DEFAULT NULL,
      kb_status TEXT NOT NULL DEFAULT 'pending',
      kb_error TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready',
      parse_error TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate documents table: add Lumos v1.2 columns if missing
  const docCols = db.prepare("PRAGMA table_info(documents)").all() as { name: string }[];
  const docColNames = docCols.map(c => c.name);
  const docNewCols: [string, string][] = [
    ['source_type', "TEXT NOT NULL DEFAULT 'create'"],
    ['source_path', "TEXT NOT NULL DEFAULT ''"],
    ['source_meta', "TEXT NOT NULL DEFAULT '{}'"],
    ['kb_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['kb_item_id', "TEXT DEFAULT NULL"],
    ['kb_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['kb_error', "TEXT NOT NULL DEFAULT ''"],
    ['status', "TEXT NOT NULL DEFAULT 'ready'"],
    ['parse_error', "TEXT NOT NULL DEFAULT ''"],
    ['tags', "TEXT NOT NULL DEFAULT '[]'"],
    ['word_count', "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [col, def] of docNewCols) {
    if (!docColNames.includes(col)) {
      db.exec(`ALTER TABLE documents ADD COLUMN ${col} ${def}`);
    }
  }

  // Lumos conversations table (8.1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      message_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      source_doc_id TEXT DEFAULT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      workspace_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
  `);

  // Lumos conversation_messages table (8.2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      "references" TEXT NOT NULL DEFAULT '[]',
      cited_doc_ids TEXT NOT NULL DEFAULT '[]',
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conv_msgs_conv ON conversation_messages(conversation_id);
  `);

  // Lumos workspaces table (8.4)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      include_patterns TEXT NOT NULL DEFAULT '["**/*.md","**/*.txt","**/*.docx","**/*.pdf","**/*.xlsx"]',
      exclude_patterns TEXT NOT NULL DEFAULT '["node_modules/**",".*/**","dist/**"]',
      status TEXT NOT NULL DEFAULT 'pending',
      file_count INTEGER NOT NULL DEFAULT 0,
      indexed_count INTEGER NOT NULL DEFAULT 0,
      last_scanned_at TEXT DEFAULT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Lumos workspace_files table (8.5)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      relative_path TEXT NOT NULL,
      file_hash TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      kb_status TEXT NOT NULL DEFAULT 'pending',
      kb_item_id TEXT DEFAULT NULL,
      file_modified_at TEXT DEFAULT NULL,
      last_indexed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_id, relative_path)
    );
    CREATE INDEX IF NOT EXISTS idx_ws_files_workspace ON workspace_files(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_ws_files_status ON workspace_files(kb_status);
  `);

  // Lumos kb_tags + kb_item_tags tables (8.6)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'custom',
      color TEXT NOT NULL DEFAULT '#6B7280',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kb_item_tags (
      item_id TEXT NOT NULL REFERENCES kb_items(id),
      tag_id TEXT NOT NULL REFERENCES kb_tags(id),
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (item_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kb_item_tags_tag ON kb_item_tags(tag_id);
  `);

  // Lumos kb_summaries table (8.7)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_summaries (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      model TEXT NOT NULL DEFAULT 'haiku',
      token_cost INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scope, scope_id)
    );
  `);

  // Lumos kb_relations table (8.8)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_relations (
      id TEXT PRIMARY KEY,
      source_item_id TEXT NOT NULL REFERENCES kb_items(id),
      target_item_id TEXT NOT NULL REFERENCES kb_items(id),
      relation_type TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0.0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_item_id, target_item_id, relation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_kb_relations_source ON kb_relations(source_item_id);
    CREATE INDEX IF NOT EXISTS idx_kb_relations_target ON kb_relations(target_item_id);
  `);

  // Lumos templates table (8.9)
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'builtin',
      content_skeleton TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      opening_message TEXT NOT NULL DEFAULT '',
      ai_config TEXT NOT NULL DEFAULT '{}',
      icon TEXT NOT NULL DEFAULT '📄',
      description TEXT NOT NULL DEFAULT '',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type);
    CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
  `);

  // Lumos kb_items extension columns (8.10)
  const kbItemCols = db.prepare("PRAGMA table_info(kb_items)").all() as { name: string }[];
  const kbItemColNames = kbItemCols.map(c => c.name);
  const kbItemNewCols: [string, string][] = [
    ['summary', "TEXT NOT NULL DEFAULT ''"],
    ['key_points', "TEXT NOT NULL DEFAULT '[]'"],
    ['doc_date', "TEXT DEFAULT NULL"],
    ['content_hash', "TEXT NOT NULL DEFAULT ''"],
    ['reference_count', "INTEGER NOT NULL DEFAULT 0"],
    ['last_referenced_at', "TEXT DEFAULT NULL"],
    ['health_status', "TEXT NOT NULL DEFAULT 'healthy'"],
    ['health_reason', "TEXT NOT NULL DEFAULT ''"],
    ['health_checked_at', "TEXT DEFAULT NULL"],
    ['summary_embedding', "BLOB DEFAULT NULL"],
    ['chunk_count', "INTEGER NOT NULL DEFAULT 0"],
    ['processing_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['processing_detail', "TEXT NOT NULL DEFAULT '{\"parse\":\"pending\",\"chunk\":\"pending\",\"bm25\":\"pending\",\"embedding\":\"pending\",\"summary\":\"pending\",\"mode\":\"full\"}'"],
    ['processing_error', "TEXT NOT NULL DEFAULT ''"],
    ['processing_updated_at', "TEXT DEFAULT NULL"],
  ];
  for (const [col, def] of kbItemNewCols) {
    if (!kbItemColNames.includes(col)) {
      db.exec(`ALTER TABLE kb_items ADD COLUMN ${col} ${def}`);
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_kb_items_processing_status ON kb_items(processing_status)");

  // Lumos conversations extension columns (8.11)
  const convCols = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[];
  const convColNames = convCols.map(c => c.name);
  if (!convColNames.includes('workspace_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN workspace_id TEXT DEFAULT NULL");
  }

  // Migrate existing settings to a default provider if api_providers is empty
  const providerCount = db.prepare('SELECT COUNT(*) as count FROM api_providers').get() as { count: number };
  if (providerCount.count === 0) {
    const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_auth_token'").get() as { value: string } | undefined;
    const baseUrlRow = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_base_url'").get() as { value: string } | undefined;
    if (tokenRow || baseUrlRow) {
      const id = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString().replace('T', ' ').split('.')[0];
      const fields = resolveProviderPersistenceFields({
        providerType: 'anthropic',
        capabilities: ['agent-chat'],
        providerOrigin: 'custom',
        authMode: 'api_key',
      });
      db.prepare(
        'INSERT INTO api_providers (id, name, provider_type, api_protocol, capabilities, provider_origin, auth_mode, base_url, api_key, is_active, sort_order, extra_env, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        'Default',
        fields.providerType,
        fields.apiProtocol,
        fields.capabilities,
        fields.providerOrigin,
        fields.authMode,
        baseUrlRow?.value || '',
        tokenRow?.value || '',
        1,
        0,
        '{}',
        'Migrated from settings',
        now,
        now,
      );
    }
  }

  // Add is_builtin and user_modified columns to api_providers if missing
  const providerCols = db.prepare("PRAGMA table_info(api_providers)").all() as { name: string }[];
  const providerColNames = providerCols.map(c => c.name);

  if (!providerColNames.includes('is_builtin')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0");
  }
  if (!providerColNames.includes('user_modified')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN user_modified INTEGER NOT NULL DEFAULT 0");
  }
  if (!providerColNames.includes('model_catalog')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN model_catalog TEXT NOT NULL DEFAULT '[]'");
  }
  if (!providerColNames.includes('model_catalog_source')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN model_catalog_source TEXT NOT NULL DEFAULT 'default'");
  }
  if (!providerColNames.includes('model_catalog_updated_at')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN model_catalog_updated_at TEXT DEFAULT NULL");
  }
  if (!providerColNames.includes('api_protocol')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN api_protocol TEXT NOT NULL DEFAULT 'anthropic-messages'");
  }
  const capabilitiesColumnAdded = !providerColNames.includes('capabilities');
  if (capabilitiesColumnAdded) {
    db.exec("ALTER TABLE api_providers ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[\"text-gen\"]'");
  }
  if (!providerColNames.includes('provider_origin')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN provider_origin TEXT NOT NULL DEFAULT 'custom'");
  }
  if (!providerColNames.includes('auth_mode')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'api_key'");
  }
  db.exec(`
    UPDATE api_providers
    SET model_catalog_source = CASE
      WHEN TRIM(COALESCE(model_catalog, '')) = '' OR model_catalog = '[]' THEN 'default'
      WHEN model_catalog_source NOT IN ('default', 'manual', 'detected') THEN 'manual'
      ELSE model_catalog_source
    END
  `);
  db.exec(`
    UPDATE api_providers
    SET api_protocol = CASE
      WHEN provider_type IN ('openrouter', 'gemini-image') THEN 'openai-compatible'
      ELSE 'anthropic-messages'
    END
    WHERE TRIM(COALESCE(api_protocol, '')) = ''
      OR api_protocol NOT IN ('anthropic-messages', 'openai-compatible')
  `);
  db.exec(`
    UPDATE api_providers
    SET capabilities = CASE
      WHEN provider_type = 'gemini-image' THEN '["image-gen"]'
      WHEN is_builtin = 1 OR is_active = 1 THEN '["agent-chat"]'
      ELSE '["text-gen"]'
    END
    ${capabilitiesColumnAdded
      ? ''
      : `WHERE TRIM(COALESCE(capabilities, '')) = ''
      OR capabilities = '[]'`
    }
  `);
  db.exec(`
    UPDATE api_providers
    SET provider_origin = CASE
      WHEN is_builtin = 1 THEN 'system'
      ELSE 'custom'
    END
    WHERE TRIM(COALESCE(provider_origin, '')) = ''
      OR provider_origin NOT IN ('system', 'preset', 'custom')
  `);
  db.exec(`
    UPDATE api_providers
    SET auth_mode = CASE
      WHEN provider_type = 'anthropic' AND auth_mode = 'local_auth' THEN 'local_auth'
      ELSE 'api_key'
    END
    WHERE TRIM(COALESCE(auth_mode, '')) = ''
      OR auth_mode NOT IN ('api_key', 'local_auth')
      OR (auth_mode = 'local_auth' AND provider_type != 'anthropic')
  `);

  // Create unique index on is_builtin (only one provider can have is_builtin=1)
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_api_providers_builtin ON api_providers(is_builtin) WHERE is_builtin = 1");

  // Skills table (metadata, content stored in files)
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('builtin', 'user')),
      description TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, scope)
    );
    CREATE INDEX IF NOT EXISTS idx_skills_scope ON skills(scope);
    CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(is_enabled);
  `);

  // MCP Servers table (metadata for MCP server configurations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // MCP Servers table extension: add new columns if missing
  const mcpCols = db.prepare("PRAGMA table_info(mcp_servers)").all() as { name: string }[];
  const mcpColNames = mcpCols.map(c => c.name);

  const mcpNewCols: [string, string][] = [
    ['scope', "TEXT NOT NULL DEFAULT 'user'"],
    ['source', "TEXT NOT NULL DEFAULT 'manual'"],
    ['content_hash', "TEXT NOT NULL DEFAULT ''"],
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['type', "TEXT NOT NULL DEFAULT 'stdio'"],
    ['url', "TEXT NOT NULL DEFAULT ''"],
    ['headers', "TEXT NOT NULL DEFAULT '{}'"],
  ];

  for (const [col, def] of mcpNewCols) {
    if (!mcpColNames.includes(col)) {
      db.exec(`ALTER TABLE mcp_servers ADD COLUMN ${col} ${def}`);
    }
  }

  // Add unique constraint on (name, scope) for mcp_servers
  // SQLite doesn't support adding constraints to existing tables, so we check if it exists
  const mcpIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mcp_servers'").all() as { name: string }[];
  const hasUniqueIndex = mcpIndexes.some(idx => idx.name.includes('name') && idx.name.includes('scope'));

  if (!hasUniqueIndex) {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_name_scope ON mcp_servers(name, scope)");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_mcp_servers_scope ON mcp_servers(scope)");

  // Create settings table for storing app-level configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Persistent memory table (used by Lumos memory runtime)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT '',
      project_path TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'project', 'session')),
      category TEXT NOT NULL DEFAULT 'other',
      content TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'user_explicit',
      confidence REAL NOT NULL DEFAULT 1.0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT DEFAULT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_memories_scope_project ON memories(scope, project_path);
    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived, is_pinned);
  `);

  // Memory intelligence events (trigger/decision observability)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_intelligence_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT '',
      trigger TEXT NOT NULL DEFAULT 'manual',
      outcome TEXT NOT NULL DEFAULT 'skipped',
      reason TEXT NOT NULL DEFAULT '',
      candidate_count INTEGER NOT NULL DEFAULT 0,
      saved_count INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      should_model TEXT NOT NULL DEFAULT '',
      extract_model TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mem_int_events_created ON memory_intelligence_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mem_int_events_session ON memory_intelligence_events(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mem_int_events_trigger ON memory_intelligence_events(trigger, created_at DESC);
  `);

  // Auto-create or mark "Built-in" provider from the embedded default API key
  const builtinProvider = db.prepare('SELECT id FROM api_providers WHERE is_builtin = 1').get() as { id: string } | undefined;

  if (!builtinProvider) {
    // Check if a provider named "Built-in" exists (from old migration)
    const namedBuiltin = db.prepare('SELECT id FROM api_providers WHERE name = ?').get('Built-in') as { id: string } | undefined;

    if (namedBuiltin) {
      // Mark existing "Built-in" provider as builtin
      db.prepare('UPDATE api_providers SET is_builtin = 1 WHERE id = ?').run(namedBuiltin.id);
      db.prepare("UPDATE api_providers SET provider_origin = 'system' WHERE id = ?").run(namedBuiltin.id);
      db.prepare("UPDATE api_providers SET capabilities = '[\"agent-chat\"]' WHERE id = ?").run(namedBuiltin.id);
    } else {
      // Create new builtin provider if default key is available
      const defaultKey = process.env.LUMOS_DEFAULT_API_KEY || process.env.CODEPILOT_DEFAULT_API_KEY;
      if (defaultKey) {
        if (process.env.CODEPILOT_DEFAULT_API_KEY && !process.env.LUMOS_DEFAULT_API_KEY) {
          console.warn('[migrations] CODEPILOT_DEFAULT_API_KEY is deprecated. Please use LUMOS_DEFAULT_API_KEY instead.');
        }
        const id = crypto.randomBytes(16).toString('hex');
        const now = new Date().toISOString().replace('T', ' ').split('.')[0];
        const defaultBaseUrl = process.env.CODEPILOT_DEFAULT_BASE_URL || '';
        const fields = resolveProviderPersistenceFields({
          providerType: 'anthropic',
          capabilities: ['agent-chat'],
          providerOrigin: 'system',
          authMode: 'api_key',
          isBuiltin: 1,
        });
        db.prepare(
          'INSERT INTO api_providers (id, name, provider_type, api_protocol, capabilities, provider_origin, auth_mode, base_url, api_key, is_active, sort_order, extra_env, model_catalog, model_catalog_source, model_catalog_updated_at, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          id,
          'Built-in',
          fields.providerType,
          fields.apiProtocol,
          fields.capabilities,
          fields.providerOrigin,
          fields.authMode,
          defaultBaseUrl,
          defaultKey,
          1,
          0,
          '{}',
          '[]',
          'default',
          null,
          'Auto-created from embedded key',
          1,
          0,
          now,
          now,
        );
      }
    }
  }

  // Browser tables (Phase 0: 内置浏览器功能)
  db.exec(`
    -- 浏览器标签页表
    CREATE TABLE IF NOT EXISTS browser_tabs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Tab',
      favicon TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      last_access INTEGER NOT NULL,
      saved_state TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    -- 浏览器历史记录表
    CREATE TABLE IF NOT EXISTS browser_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      visited_at INTEGER NOT NULL,
      FOREIGN KEY (tab_id) REFERENCES browser_tabs(id) ON DELETE CASCADE
    );

    -- Cookie 加密存储表
    CREATE TABLE IF NOT EXISTS browser_cookies (
      domain TEXT NOT NULL,
      name TEXT NOT NULL,
      value_encrypted BLOB NOT NULL,
      expires INTEGER,
      path TEXT NOT NULL DEFAULT '/',
      secure INTEGER NOT NULL DEFAULT 0,
      http_only INTEGER NOT NULL DEFAULT 0,
      same_site TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (domain, name)
    );

    -- MCP Cookie 权限表
    CREATE TABLE IF NOT EXISTS mcp_cookie_permissions (
      mcp_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      granted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      granted_by TEXT NOT NULL DEFAULT 'user',
      PRIMARY KEY (mcp_name, domain)
    );

    -- Cookie 监听配置表
    CREATE TABLE IF NOT EXISTS cookie_watch_list (
      domain TEXT NOT NULL,
      cookie_name TEXT NOT NULL,
      mcp_name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (domain, cookie_name, mcp_name)
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_browser_history_tab_id ON browser_history(tab_id);
    CREATE INDEX IF NOT EXISTS idx_browser_history_visited_at ON browser_history(visited_at);
    CREATE INDEX IF NOT EXISTS idx_browser_history_url ON browser_history(url);
    CREATE INDEX IF NOT EXISTS idx_browser_tabs_last_access ON browser_tabs(last_access);
    CREATE INDEX IF NOT EXISTS idx_browser_cookies_domain ON browser_cookies(domain);
    CREATE INDEX IF NOT EXISTS idx_mcp_cookie_permissions_mcp ON mcp_cookie_permissions(mcp_name);
    CREATE INDEX IF NOT EXISTS idx_cookie_watch_list_mcp ON cookie_watch_list(mcp_name);
  `);

  // Message-memory associations (for memory visibility in chat)
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_memories (
      message_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK(relation_type IN ('created', 'used')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, memory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_mem_message ON message_memories(message_id);
    CREATE INDEX IF NOT EXISTS idx_msg_mem_memory ON message_memories(memory_id);
  `);

  // Memory usage log (for memory detail page timeline)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_usage_log (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      used_at TEXT NOT NULL DEFAULT (datetime('now')),
      context TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mem_usage_memory ON memory_usage_log(memory_id);
    CREATE INDEX IF NOT EXISTS idx_mem_usage_session ON memory_usage_log(session_id);
  `);

  // Capability tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_drafts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      input_schema TEXT NOT NULL DEFAULT '{}',
      output_schema TEXT NOT NULL DEFAULT '{}',
      permissions TEXT NOT NULL DEFAULT '{}',
      implementation TEXT NOT NULL DEFAULT '{}',
      validation_errors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS capability_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      version TEXT NOT NULL,
      digest TEXT,
      status TEXT NOT NULL,
      category TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '{}',
      input_schema TEXT NOT NULL DEFAULT '{}',
      output_schema TEXT NOT NULL DEFAULT '{}',
      permissions TEXT NOT NULL DEFAULT '{}',
      runtime_policy TEXT NOT NULL DEFAULT '{}',
      approval_policy TEXT NOT NULL DEFAULT '{}',
      implementation TEXT NOT NULL DEFAULT '{}',
      tests TEXT NOT NULL DEFAULT '[]',
      docs TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_capability_drafts_created ON capability_drafts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_capability_packages_status ON capability_packages(status);
    CREATE INDEX IF NOT EXISTS idx_capability_packages_category ON capability_packages(category);
  `);

  // Add min_fetch_count to deepsearch_sites if missing
  const dsColsCheck = db.prepare("PRAGMA table_info(deepsearch_sites)").all() as { name: string }[];
  if (!dsColsCheck.some(c => c.name === 'min_fetch_count')) {
    db.exec("ALTER TABLE deepsearch_sites ADD COLUMN min_fetch_count INTEGER NOT NULL DEFAULT 3");
  }

  // Add archived_at to deepsearch_runs (knowledge library auto-archive)
  const dsRunColsCheck = db.prepare("PRAGMA table_info(deepsearch_runs)").all() as { name: string }[];
  if (!dsRunColsCheck.some(c => c.name === 'archived_at')) {
    db.exec("ALTER TABLE deepsearch_runs ADD COLUMN archived_at TEXT DEFAULT NULL");
  }

  // Standalone workflows table (independent of scheduled_workflows)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      dsl_version TEXT NOT NULL DEFAULT 'v2',
      workflow_dsl TEXT NOT NULL DEFAULT '{}',
      is_template INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_updated ON workflows(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflows_template ON workflows(is_template);
  `);

  // Scheduled workflows table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workflow_dsl TEXT NOT NULL DEFAULT '{}',
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      working_directory TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_on_complete INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT DEFAULT NULL,
      next_run_at TEXT DEFAULT NULL,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_run_status TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_enabled ON scheduled_workflows(enabled);
    CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_next_run ON scheduled_workflows(next_run_at);
  `);

  // Schedule run history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_run_history (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_srh_schedule ON schedule_run_history(schedule_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS schedule_run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      preset_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','success','error','skipped')),
      error TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER DEFAULT NULL,
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_srs_run ON schedule_run_steps(run_id, started_at);
  `);

  // Add workflow_id column to scheduled_workflows (links to standalone workflows table)
  const swCols = db.prepare("PRAGMA table_info(scheduled_workflows)").all() as { name: string }[];
  if (!swCols.some(c => c.name === 'workflow_id')) {
    db.exec("ALTER TABLE scheduled_workflows ADD COLUMN workflow_id TEXT DEFAULT NULL");
  }
  // Add run_mode column: 'scheduled' (default) or 'once'
  if (!swCols.some(c => c.name === 'run_mode')) {
    db.exec("ALTER TABLE scheduled_workflows ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'scheduled'");
  }
  // Add run_params column: default parameter values for workflow execution
  if (!swCols.some(c => c.name === 'run_params')) {
    db.exec("ALTER TABLE scheduled_workflows ADD COLUMN run_params TEXT NOT NULL DEFAULT '{}'");
  }
  // Add schedule_time (HH:mm) and schedule_day_of_week (0=Sun..6=Sat) for daily/weekly scheduling
  if (!swCols.some(c => c.name === 'schedule_time')) {
    db.exec("ALTER TABLE scheduled_workflows ADD COLUMN schedule_time TEXT DEFAULT NULL");
  }
  if (!swCols.some(c => c.name === 'schedule_day_of_week')) {
    db.exec("ALTER TABLE scheduled_workflows ADD COLUMN schedule_day_of_week INTEGER DEFAULT NULL");
  }

  // Remove legacy browser MCP (replaced by chrome-devtools, registered via init-builtin-resources)
  db.prepare("DELETE FROM mcp_servers WHERE name = 'browser' AND scope = 'builtin'").run();

  // Team departments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add department_id to templates (agent presets)
  const templateCols = db.prepare("PRAGMA table_info(templates)").all() as { name: string }[];
  if (!templateCols.some(c => c.name === 'department_id')) {
    db.exec("ALTER TABLE templates ADD COLUMN department_id TEXT DEFAULT NULL");
  }

  // Add group_name to workflows table
  const workflowCols = db.prepare("PRAGMA table_info(workflows)").all() as { name: string }[];
  if (!workflowCols.some(c => c.name === 'group_name')) {
    db.exec("ALTER TABLE workflows ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
  }

  // ── Lumos 自建用户系统 ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS lumos_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      membership TEXT NOT NULL DEFAULT 'free'
        CHECK(membership IN ('free','monthly','yearly')),
      membership_expires_at TEXT DEFAULT NULL,
      newapi_token_key TEXT NOT NULL DEFAULT '',
      newapi_token_id INTEGER DEFAULT NULL,
      image_quota_monthly INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'user'
        CHECK(role IN ('admin','user')),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','disabled','deleted')),
      web_session_token TEXT NOT NULL DEFAULT '',
      last_login_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lumos_users_email ON lumos_users(email);

    CREATE TABLE IF NOT EXISTS lumos_user_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES lumos_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lumos_sessions_user ON lumos_user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_lumos_sessions_expires ON lumos_user_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS lumos_email_verifications (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'register'
        CHECK(purpose IN ('register','reset_password')),
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_verify_email ON lumos_email_verifications(email, purpose);

    CREATE TABLE IF NOT EXISTS lumos_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES lumos_users(id),
      plan_id TEXT NOT NULL DEFAULT '',
      plan_name TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      quota_amount INTEGER NOT NULL DEFAULT 0,
      pay_type TEXT NOT NULL DEFAULT 'alipay'
        CHECK(pay_type IN ('alipay','wxpay')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','paid','failed','expired','refunded')),
      trade_no TEXT NOT NULL DEFAULT '',
      paid_at TEXT DEFAULT NULL,
      notify_raw TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lumos_orders_user ON lumos_orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lumos_orders_status ON lumos_orders(status);

    CREATE TABLE IF NOT EXISTS lumos_image_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES lumos_users(id),
      model TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_image_usage_user_month ON lumos_image_usage(user_id, created_at);
  `);

  // Add role column to lumos_users (for existing databases)
  const userCols = db.prepare("PRAGMA table_info(lumos_users)").all() as { name: string }[];
  if (userCols.length > 0 && !userCols.some(c => c.name === 'role')) {
    db.exec("ALTER TABLE lumos_users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  // Add web_session_token column for calling lumos-web APIs (quota, orders, etc.)
  if (userCols.length > 0 && !userCols.some(c => c.name === 'web_session_token')) {
    db.exec("ALTER TABLE lumos_users ADD COLUMN web_session_token TEXT NOT NULL DEFAULT ''");
  }

  // Seed built-in data on first run
  seedBuiltinProviders(db);
  seedBuiltinSkills(db);
  seedBuiltinMcpServers(db);
}
