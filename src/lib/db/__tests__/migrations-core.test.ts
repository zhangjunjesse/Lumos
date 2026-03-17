import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

describe('core db migrations', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-db-migration-test-'));
    delete process.env.LUMOS_DATA_DIR;
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
    jest.resetModules();
  });

  afterEach(() => {
    const { closeDb } = require('../../db') as typeof import('../../db');
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_GUI_DATA_DIR;
    jest.resetModules();
  });

  it('upgrades legacy tasks tables before creating team task indexes', () => {
    const dbPath = path.join(tmpDir, 'lumos.db');
    const seedDb = new Database(dbPath);

    seedDb.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        working_directory TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
    `);

    seedDb.close();

    const { getDb } = require('../../db') as typeof import('../../db');
    const migrated = getDb();
    const columns = migrated.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
    const columnNames = columns.map((column) => column.name);
    const indexes = migrated.prepare("PRAGMA index_list('tasks')").all() as Array<{ name: string }>;
    const indexNames = indexes.map((index) => index.name);

    expect(columnNames).toEqual(expect.arrayContaining([
      'task_kind',
      'team_plan_json',
      'team_approval_status',
      'current_run_id',
      'final_result_summary',
      'source_message_id',
      'approved_at',
      'rejected_at',
      'last_action_at',
    ]));
    expect(indexNames).toEqual(expect.arrayContaining([
      'idx_tasks_session_id',
      'idx_tasks_task_kind',
      'idx_tasks_current_run_id',
      'idx_tasks_team_approval_status',
    ]));
  });
});
