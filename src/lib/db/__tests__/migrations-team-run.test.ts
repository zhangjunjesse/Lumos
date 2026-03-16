import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

describe('team run db migrations', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-team-run-migration-test-'));
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

  it('upgrades legacy team_runs rows before rebuilding the status constraint table', () => {
    const dbPath = path.join(tmpDir, 'lumos.db');
    const seedDb = new Database(dbPath);

    seedDb.exec(`
      CREATE TABLE team_runs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'ready', 'running', 'paused', 'cancelled', 'done', 'failed')),
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      );
    `);

    seedDb.prepare(`
      INSERT INTO team_runs (id, plan_id, status, created_at, started_at, completed_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run-legacy-001',
      'plan-legacy-001',
      'running',
      1741996800000,
      1741996810000,
      null,
      null,
    );

    seedDb.close();

    const { getDb } = require('../../db') as typeof import('../../db');
    const migrated = getDb();
    const columns = migrated.prepare('PRAGMA table_info(team_runs)').all() as Array<{ name: string }>;
    const columnNames = columns.map((column) => column.name);
    const row = migrated.prepare(`
      SELECT id, plan_id, task_id, session_id, planner_version, summary, final_summary, status
      FROM team_runs
      WHERE id = ?
    `).get('run-legacy-001') as Record<string, unknown>;

    expect(columnNames).toEqual(expect.arrayContaining([
      'task_id',
      'session_id',
      'planner_version',
      'planning_input_json',
      'compiled_plan_json',
      'workspace_root',
      'summary',
      'final_summary',
      'pause_requested_at',
      'cancel_requested_at',
      'published_at',
      'projection_version',
    ]));
    expect(row).toMatchObject({
      id: 'run-legacy-001',
      plan_id: 'plan-legacy-001',
      task_id: null,
      session_id: null,
      status: 'running',
      planner_version: 'compiled-run-plan/v1',
      summary: '',
      final_summary: '',
    });
  });

  it('drops a stale team_runs__new table when the original team_runs table still exists', () => {
    const dbPath = path.join(tmpDir, 'lumos.db');
    const seedDb = new Database(dbPath);

    seedDb.exec(`
      CREATE TABLE team_runs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'ready', 'running', 'paused', 'cancelled', 'done', 'failed')),
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      );

      CREATE TABLE team_runs__new (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        planner_version TEXT NOT NULL DEFAULT 'compiled-run-plan/v1',
        planning_input_json TEXT NOT NULL DEFAULT '',
        compiled_plan_json TEXT NOT NULL DEFAULT '',
        workspace_root TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        final_summary TEXT NOT NULL DEFAULT '',
        pause_requested_at INTEGER,
        cancel_requested_at INTEGER,
        published_at TEXT,
        projection_version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      );
    `);

    seedDb.prepare(`
      INSERT INTO team_runs (id, plan_id, status, created_at)
      VALUES (?, ?, ?, ?)
    `).run('run-stale-temp-001', 'plan-stale-temp-001', 'pending', 1741996800000);

    seedDb.close();

    const { getDb } = require('../../db') as typeof import('../../db');
    const migrated = getDb();
    const tempStillExists = migrated.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'team_runs__new'"
    ).get();
    const row = migrated.prepare('SELECT id, plan_id FROM team_runs WHERE id = ?').get('run-stale-temp-001');

    expect(tempStillExists).toBeUndefined();
    expect(row).toMatchObject({
      id: 'run-stale-temp-001',
      plan_id: 'plan-stale-temp-001',
    });
  });

  it('recovers from an interrupted rename when only team_runs__new remains', () => {
    const dbPath = path.join(tmpDir, 'lumos.db');
    const seedDb = new Database(dbPath);

    seedDb.exec(`
      CREATE TABLE team_runs__new (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'ready', 'running', 'paused', 'cancelling', 'cancelled', 'summarizing', 'done', 'failed')),
        planner_version TEXT NOT NULL DEFAULT 'compiled-run-plan/v1',
        planning_input_json TEXT NOT NULL DEFAULT '',
        compiled_plan_json TEXT NOT NULL DEFAULT '',
        workspace_root TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        final_summary TEXT NOT NULL DEFAULT '',
        pause_requested_at INTEGER,
        cancel_requested_at INTEGER,
        published_at TEXT,
        projection_version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      );
    `);

    seedDb.prepare(`
      INSERT INTO team_runs__new (id, plan_id, task_id, session_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'run-recover-001',
      'plan-recover-001',
      'task-recover-001',
      'session-recover-001',
      'running',
      1741996800000,
    );

    seedDb.close();

    const { getDb } = require('../../db') as typeof import('../../db');
    const migrated = getDb();
    const tempStillExists = migrated.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'team_runs__new'"
    ).get();
    const row = migrated.prepare(`
      SELECT id, plan_id, task_id, session_id, status
      FROM team_runs
      WHERE id = ?
    `).get('run-recover-001') as Record<string, unknown>;

    expect(tempStillExists).toBeUndefined();
    expect(row).toMatchObject({
      id: 'run-recover-001',
      plan_id: 'plan-recover-001',
      task_id: 'task-recover-001',
      session_id: 'session-recover-001',
      status: 'running',
    });
  });
});
