import Database from 'better-sqlite3';

import { migrateWeChatAssistantTables } from '../migrations-wechat-assistant';

describe('wechat assistant db migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('creates run / events / todos tables on a fresh database', () => {
    migrateWeChatAssistantTables(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'wechat_assistant_%' ORDER BY name",
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual([
      'wechat_assistant_events',
      'wechat_assistant_reports',
      'wechat_assistant_runs',
      'wechat_assistant_todos',
    ]);
  });

  it('is idempotent', () => {
    migrateWeChatAssistantTables(db);
    expect(() => migrateWeChatAssistantTables(db)).not.toThrow();
  });

  it('adds soft-delete storage for archived reports', () => {
    migrateWeChatAssistantTables(db);

    const columns = db
      .prepare(`PRAGMA table_info(wechat_assistant_reports)`)
      .all() as { name: string }[];

    expect(columns.some((column) => column.name === 'deleted_at')).toBe(true);
  });

  it('enforces urgency / status check constraints', () => {
    migrateWeChatAssistantTables(db);
    db.prepare(
      `INSERT INTO wechat_assistant_runs
        (id, snapshot_hash, started_at, status, messages_scanned)
       VALUES ('r1', 'h', 1, 'running', 0)`,
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO wechat_assistant_events
            (id, run_id, title, urgency, contact_wxid, contact_display, is_group,
             evidence_msg_ids_json, evidence_texts_json, suggested_action, last_at, created_at)
           VALUES ('e1', 'r1', 't', 'bogus', 'w', 'd', 0, '[]', '[]', 'a', 0, 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint/);

    expect(() =>
      db
        .prepare(
          `INSERT INTO wechat_assistant_todos
            (id, text, source, status, created_at)
           VALUES ('t1', 'x', 'manual', 'bogus', 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint/);

    expect(() =>
      db
        .prepare(
          `INSERT INTO wechat_assistant_todos
            (id, text, source, status, created_at)
           VALUES ('t2', 'x', 'manual', 'in_progress', 0)`,
        )
        .run(),
    ).not.toThrow();

    expect(() =>
      db
        .prepare(
          `INSERT INTO wechat_assistant_reports
            (id, automation_name, status, started_at, created_at, updated_at)
           VALUES ('rp1', '每日微信总结', 'bogus', '2026-01-01T00:00:00.000Z', 0, 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint/);
  });

  it('cascades event delete on run delete and nulls todo run_id', () => {
    migrateWeChatAssistantTables(db);
    db.prepare(
      `INSERT INTO wechat_assistant_runs
        (id, snapshot_hash, started_at, status, messages_scanned)
       VALUES ('r1', 'h', 1, 'done', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO wechat_assistant_events
        (id, run_id, title, urgency, contact_wxid, contact_display, is_group,
         evidence_msg_ids_json, evidence_texts_json, suggested_action, last_at, created_at)
       VALUES ('e1', 'r1', 't', 'urgent', 'w', 'd', 0, '[]', '[]', 'a', 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO wechat_assistant_todos
        (id, run_id, text, source, status, created_at)
       VALUES ('t1', 'r1', 'x', 'self', 'suggested', 0)`,
    ).run();

    db.prepare(`DELETE FROM wechat_assistant_runs WHERE id = 'r1'`).run();

    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM wechat_assistant_events`).get(),
    ).toEqual({ c: 0 });
    expect(
      db.prepare(`SELECT run_id FROM wechat_assistant_todos WHERE id = 't1'`).get(),
    ).toEqual({ run_id: null });
  });

  it('migrates existing todo status constraint to allow in-progress followups', () => {
    db.exec(`
      CREATE TABLE wechat_assistant_runs (
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

      CREATE TABLE wechat_assistant_todos (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('self','other','manual')),
        source_msg_id INTEGER,
        source_text TEXT,
        source_display TEXT,
        source_wxid TEXT,
        by_when_text TEXT,
        due_at INTEGER,
        remind_at INTEGER,
        confidence TEXT CHECK (confidence IN ('high','medium')),
        status TEXT NOT NULL CHECK (status IN ('suggested','open','done','dismissed')),
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        done_at INTEGER,
        FOREIGN KEY (run_id) REFERENCES wechat_assistant_runs(id) ON DELETE SET NULL
      );

      INSERT INTO wechat_assistant_todos
        (id, text, source, status, created_at)
      VALUES ('t-old', 'old', 'manual', 'open', 1);
    `);

    migrateWeChatAssistantTables(db);

    expect(
      db.prepare(`SELECT text, status FROM wechat_assistant_todos WHERE id = 't-old'`).get(),
    ).toEqual({ text: 'old', status: 'open' });
    expect(() =>
      db.prepare(
        `INSERT INTO wechat_assistant_todos
          (id, text, source, status, created_at)
         VALUES ('t-new', 'new', 'manual', 'in_progress', 2)`,
      ).run(),
    ).not.toThrow();
  });

  it('adds involved wxids storage and backfills legacy source wxid during status migration', () => {
    db.exec(`
      CREATE TABLE wechat_assistant_runs (
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

      CREATE TABLE wechat_assistant_todos (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('self','other','manual')),
        source_msg_id INTEGER,
        source_text TEXT,
        source_display TEXT,
        source_wxid TEXT,
        by_when_text TEXT,
        due_at INTEGER,
        remind_at INTEGER,
        confidence TEXT CHECK (confidence IN ('high','medium')),
        status TEXT NOT NULL CHECK (status IN ('suggested','open','done','dismissed')),
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        done_at INTEGER,
        FOREIGN KEY (run_id) REFERENCES wechat_assistant_runs(id) ON DELETE SET NULL
      );

      INSERT INTO wechat_assistant_todos
        (id, text, source, source_wxid, status, created_at)
      VALUES ('t-old', 'old', 'manual', 'wxid_alice', 'open', 1);
    `);

    migrateWeChatAssistantTables(db);

    expect(
      db.prepare(`SELECT involved_wxids_json FROM wechat_assistant_todos WHERE id = 't-old'`).get(),
    ).toEqual({ involved_wxids_json: '["wxid_alice"]' });
  });
});
