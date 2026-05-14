/**
 * Singleton connection to the WeChat sync mirror SQLite file.
 *
 * Lives at `~/.lumos/wechat-mirror.db` (sidecar — independent of lumos.db).
 * Schema bootstrap is idempotent; bumping `SCHEMA_VERSION` triggers a
 * tear-down so devs don't need to ship migrations for cache-like data.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { dataDir } from '@/lib/db';

import { SCHEMA_DDL, SCHEMA_VERSION } from './mirror-schema';

const MIRROR_PATH = path.join(dataDir, 'wechat-mirror.db');

let db: Database.Database | null = null;

export function getMirrorDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  db = new Database(MIRROR_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 30000');
  db.pragma('foreign_keys = OFF');
  db.pragma('synchronous = NORMAL');

  bootstrap(db);
  return db;
}

export function closeMirrorDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

function bootstrap(conn: Database.Database): void {
  conn.exec(SCHEMA_DDL);
  const row = conn
    .prepare<[], { value: string }>(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get();
  const current = row ? Number(row.value) : 0;
  ensureAdditiveColumns(conn);
  if (current === SCHEMA_VERSION) return;

  if (current > 0 && current !== SCHEMA_VERSION) {
    // Mirror is cache-like — wipe and re-create on schema bumps.
    conn.exec(`
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS sync_state;
      DROP TABLE IF EXISTS topic_summaries;
      DROP TABLE IF EXISTS topic_daily_summaries;
      DROP TABLE IF EXISTS topic_daily_sources;
    `);
    conn.exec(SCHEMA_DDL);
    ensureAdditiveColumns(conn);
  }
  conn
    .prepare(`INSERT OR REPLACE INTO schema_meta(key, value) VALUES('version', ?)`)
    .run(String(SCHEMA_VERSION));
}

function ensureAdditiveColumns(conn: Database.Database): void {
  for (const [table, column, type] of [
    ['messages', 'sender_wxid', 'TEXT'],
    ['messages', 'sender_display', 'TEXT'],
    ['messages', 'attachment_json', 'TEXT'],
  ] as const) {
    if (!columnExists(conn, table, column)) {
      conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}

function columnExists(conn: Database.Database, table: string, column: string): boolean {
  return (conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((row) => row.name === column);
}

export const MIRROR_DB_PATH = MIRROR_PATH;
