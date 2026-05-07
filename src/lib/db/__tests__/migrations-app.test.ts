import Database from 'better-sqlite3';

import { migrateAppTables } from '../migrations-app';

describe('app platform db migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('creates all app platform tables on a fresh database', () => {
    migrateAppTables(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lumos_app_%' ORDER BY name",
    ).all() as { name: string }[];

    expect(tables.map(t => t.name)).toEqual([
      'lumos_app_apps',
      'lumos_app_builder_artifacts',
      'lumos_app_builder_messages',
      'lumos_app_builder_sessions',
      'lumos_app_builder_stories',
      'lumos_app_configs',
      'lumos_app_data',
      'lumos_app_permissions',
      'lumos_app_runs',
      'lumos_app_triggers',
    ]);
  });

  it('creates expected indexes', () => {
    migrateAppTables(db);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_lumos_app_%' ORDER BY name",
    ).all() as { name: string }[];

    expect(indexes.map(i => i.name)).toEqual([
      'idx_lumos_app_builder_artifacts',
      'idx_lumos_app_builder_msgs',
      'idx_lumos_app_builder_stories',
      'idx_lumos_app_data_collection',
      'idx_lumos_app_runs_app',
    ]);
  });

  it('is idempotent — running twice is a no-op', () => {
    migrateAppTables(db);
    expect(() => migrateAppTables(db)).not.toThrow();
  });

  it('enforces source CHECK constraint on lumos_app_apps', () => {
    migrateAppTables(db);

    const insertBadSource = () => db.prepare(
      `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('test-app', 'Test', '1.0.0', '{}', 'pirate', '/tmp/x', Date.now());

    expect(insertBadSource).toThrow(/CHECK constraint failed/);
  });

  it('cascades app deletion to install-state tables but PRESERVES user data', () => {
    migrateAppTables(db);

    const now = Date.now();
    db.prepare(
      `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('test-app', 'Test', '1.0.0', '{}', 'ai-generated', '/tmp/test-app', now);

    db.prepare(
      `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('test-app', 'customers', 'c1', '{}', now, now);

    db.prepare(
      `INSERT INTO lumos_app_configs (app_id, key, value_encrypted, is_secret, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('test-app', 'token', 'enc', 1, now);

    db.prepare(
      `INSERT INTO lumos_app_permissions (app_id, permission, granted, granted_at)
       VALUES (?, ?, ?, ?)`,
    ).run('test-app', 'mcp:feishu', 1, now);

    db.prepare('DELETE FROM lumos_app_apps WHERE id = ?').run('test-app');

    // Install-state tables cascade with the app row.
    const configRows = db.prepare('SELECT COUNT(*) as c FROM lumos_app_configs').get() as { c: number };
    const permRows = db.prepare('SELECT COUNT(*) as c FROM lumos_app_permissions').get() as { c: number };
    expect(configRows.c).toBe(0);
    expect(permRows.c).toBe(0);

    // User data SURVIVES uninstall — re-installing the same app id reconnects.
    // To purge data, the installer must explicitly DELETE FROM lumos_app_data.
    const dataRows = db.prepare('SELECT COUNT(*) as c FROM lumos_app_data').get() as { c: number };
    expect(dataRows.c).toBe(1);
  });

  it('isolates data by app_id (composite primary key blocks duplicate ids across apps)', () => {
    migrateAppTables(db);

    const now = Date.now();
    db.prepare(
      `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'app-a', 'A', '1.0.0', '{}', 'ai-generated', '/tmp/a', now,
      'app-b', 'B', '1.0.0', '{}', 'ai-generated', '/tmp/b', now,
    );

    // Same row id 'r1' in same collection name, different apps — must be allowed
    db.prepare(
      `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('app-a', 'customers', 'r1', '{"name":"Alice"}', now, now);

    db.prepare(
      `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('app-b', 'customers', 'r1', '{"name":"Bob"}', now, now);

    // Querying by one app must not see the other
    const aRows = db.prepare(
      'SELECT data_json FROM lumos_app_data WHERE app_id = ?',
    ).all('app-a') as { data_json: string }[];
    expect(aRows).toHaveLength(1);
    expect(aRows[0].data_json).toContain('Alice');
  });

  it('rejects unknown trigger types', () => {
    migrateAppTables(db);

    const now = Date.now();
    db.prepare(
      `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('app-a', 'A', '1.0.0', '{}', 'ai-generated', '/tmp/a', now);

    const insertBadTrigger = () => db.prepare(
      `INSERT INTO lumos_app_triggers (id, app_id, type, config_json, workflow_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('t1', 'app-a', 'webhook', '{}', 'wf');

    expect(insertBadTrigger).toThrow(/CHECK constraint failed/);
  });

  it('rejects unknown builder session status', () => {
    migrateAppTables(db);

    const now = Date.now();
    const insertBadStatus = () => db.prepare(
      `INSERT INTO lumos_app_builder_sessions (id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run('s1', 'in_progress', now, now);

    expect(insertBadStatus).toThrow(/CHECK constraint failed/);
  });

  it('cascades builder stories when deleting a builder session', () => {
    migrateAppTables(db);

    const now = Date.now();
    db.prepare(
      `INSERT INTO lumos_app_builder_sessions (id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run('s1', 'gathering', now, now);
    db.prepare(
      `INSERT INTO lumos_app_builder_stories
       (id, session_id, title, story_text, status, priority, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'story1',
      's1',
      '记录客户',
      '作为销售，我希望记录客户信息，这样我能持续跟进。',
      'pending_confirmation',
      1,
      0,
      now,
      now,
    );

    db.prepare('DELETE FROM lumos_app_builder_sessions WHERE id = ?').run('s1');

    const rows = db.prepare(
      'SELECT COUNT(*) AS c FROM lumos_app_builder_stories',
    ).get() as { c: number };
    expect(rows.c).toBe(0);
  });
});
