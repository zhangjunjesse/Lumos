import Database from 'better-sqlite3';

let db: Database.Database;

jest.mock('../connection', () => ({
  getDb: () => db,
}));

import {
  createDeepSearchRun,
  upsertDeepSearchSiteState,
} from '../deepsearch';

function createDeepSearchTables(): void {
  db.exec(`
    CREATE TABLE deepsearch_sites (
      id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      cookie_value TEXT NOT NULL DEFAULT '',
      cookie_status TEXT NOT NULL DEFAULT 'missing',
      cookie_expires_at TEXT DEFAULT NULL,
      last_validated_at TEXT DEFAULT NULL,
      validation_message TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      min_fetch_count INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00',
      updated_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00'
    );

    CREATE TABLE deepsearch_site_states (
      site_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      login_state TEXT NOT NULL DEFAULT 'missing',
      last_checked_at TEXT DEFAULT NULL,
      last_login_at TEXT DEFAULT NULL,
      blocking_reason TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00',
      updated_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00'
    );

    CREATE TABLE deepsearch_runs (
      id TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      site_keys_json TEXT NOT NULL DEFAULT '[]',
      eligible_site_keys_json TEXT NOT NULL DEFAULT '[]',
      blocked_site_keys_json TEXT NOT NULL DEFAULT '[]',
      page_mode TEXT NOT NULL,
      strictness TEXT NOT NULL,
      status TEXT NOT NULL,
      status_message TEXT NOT NULL DEFAULT '',
      result_summary TEXT NOT NULL DEFAULT '',
      detail_markdown TEXT NOT NULL DEFAULT '',
      created_from TEXT NOT NULL DEFAULT 'extensions',
      requested_by_session_id TEXT DEFAULT NULL,
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00',
      updated_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00',
      archived_at TEXT DEFAULT NULL
    );

    CREATE TABLE deepsearch_run_pages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      site_key TEXT DEFAULT NULL,
      binding_type TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'seed',
      initial_url TEXT DEFAULT NULL,
      last_known_url TEXT DEFAULT NULL,
      page_title TEXT DEFAULT NULL,
      attached_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00',
      released_at TEXT DEFAULT NULL
    );

    CREATE TABLE deepsearch_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      run_page_id TEXT DEFAULT NULL,
      site_key TEXT DEFAULT NULL,
      url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content_state TEXT NOT NULL DEFAULT 'partial',
      snippet TEXT NOT NULL DEFAULT '',
      evidence_count INTEGER NOT NULL DEFAULT 0,
      failure_stage TEXT DEFAULT NULL,
      login_related INTEGER NOT NULL DEFAULT 0,
      content_artifact_id TEXT DEFAULT NULL,
      screenshot_artifact_id TEXT DEFAULT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00'
    );

    CREATE TABLE deepsearch_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      record_id TEXT DEFAULT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      storage_path TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '2026-05-03 00:00:00'
    );
  `);
}

function insertSite(siteKey: string, displayName: string, baseUrl: string, cookieStatus = 'missing'): void {
  db.prepare(`
    INSERT INTO deepsearch_sites (
      id, site_key, display_name, base_url, cookie_value, cookie_status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', ?, '2026-05-03 00:00:00', '2026-05-03 00:00:00')
  `).run(`site-${siteKey}`, siteKey, displayName, baseUrl, cookieStatus);
}

beforeEach(() => {
  db = new Database(':memory:');
  createDeepSearchTables();
});

afterEach(() => {
  db.close();
});

describe('deepsearch run status decisions', () => {
  test('treats login-free public sources as ready without saved cookies or live state', () => {
    insertSite('project_gutenberg', 'Project Gutenberg', 'https://www.gutenberg.org');

    const run = createDeepSearchRun({
      queryText: 'Hamlet',
      siteKeys: ['project_gutenberg'],
      pageMode: 'managed_page',
      strictness: 'best_effort',
      createdFrom: 'chat',
    });

    expect(run.status).toBe('pending');
    expect(run.eligibleSiteKeys).toEqual(['project_gutenberg']);
    expect(run.blockedSiteKeys).toEqual([]);
  });

  test('requires confirmed live login for login-gated sites even when old cookie status is valid', () => {
    insertSite('zhihu', 'Zhihu', 'https://www.zhihu.com', 'valid');
    upsertDeepSearchSiteState({
      siteKey: 'zhihu',
      displayName: 'Zhihu',
      loginState: 'missing',
      blockingReason: 'No shared login cookie was detected for this site.',
    });

    const run = createDeepSearchRun({
      queryText: '知乎热点',
      siteKeys: ['zhihu'],
      pageMode: 'managed_page',
      strictness: 'best_effort',
      createdFrom: 'chat',
    });

    expect(run.status).toBe('waiting_login');
    expect(run.eligibleSiteKeys).toEqual([]);
    expect(run.blockedSiteKeys).toEqual(['zhihu']);
  });
});
