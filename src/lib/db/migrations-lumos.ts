import Database from 'better-sqlite3';
import crypto from 'crypto';

export function migrateLumosTables(db: Database.Database): void {
  // Knowledge base tables
  db.exec(`
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
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
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
  ];
  for (const [col, def] of kbItemNewCols) {
    if (!kbItemColNames.includes(col)) {
      db.exec(`ALTER TABLE kb_items ADD COLUMN ${col} ${def}`);
    }
  }

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
      db.prepare(
        'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, 'Default', 'anthropic', baseUrlRow?.value || '', tokenRow?.value || '', 1, 0, '{}', 'Migrated from settings', now, now);
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

  // Create unique index on is_builtin (only one provider can have is_builtin=1)
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_api_providers_builtin ON api_providers(is_builtin) WHERE is_builtin = 1");

  // Auto-create or mark "Built-in" provider from the embedded default API key
  const builtinProvider = db.prepare('SELECT id FROM api_providers WHERE is_builtin = 1').get() as { id: string } | undefined;

  if (!builtinProvider) {
    // Check if a provider named "Built-in" exists (from old migration)
    const namedBuiltin = db.prepare('SELECT id FROM api_providers WHERE name = ?').get('Built-in') as { id: string } | undefined;

    if (namedBuiltin) {
      // Mark existing "Built-in" provider as builtin
      db.prepare('UPDATE api_providers SET is_builtin = 1 WHERE id = ?').run(namedBuiltin.id);
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
        db.prepare(
          'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(id, 'Built-in', 'anthropic', defaultBaseUrl, defaultKey, 1, 0, '{}', 'Auto-created from embedded key', 1, 0, now, now);
      }
    }
  }
}
