/**
 * Connection to the WeChat sync mirror SQLite file.
 *
 * **每个微信账号一个库**:`~/.lumos/wechat-mirror/{wxid}.db`。
 *
 * 以前是全局单文件 `~/.lumos/wechat-mirror.db`,而表里的 wxid 指的是**聊天对象**,
 * 不是"这条数据属于哪个登录账号"。于是换号后新号同步进来的联系人/群/消息和旧号的
 * 混在一张表里,既清不干净也分不开 —— 用户看到的"还是之前那个微信的数据"就是这么来的。
 *
 * 按账号分文件而不是加一列 owner_wxid:store 层有 1400+ 行查询,加列就得每条都记得
 * 带上过滤条件,漏一条就串号;分文件是物理隔离,漏不了,而且"清空某个账号"退化成删文件。
 * 镜像本就是缓存性质(能从微信原库重新同步出来),所以换库不丢真实数据。
 *
 * Schema bootstrap is idempotent; bumping `SCHEMA_VERSION` triggers a
 * tear-down so devs don't need to ship migrations for cache-like data.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { dataDir } from '@/lib/db';
import { getActiveAccountKey, UNBOUND_ACCOUNT_KEY } from '@/lib/wechat-export/active-account';

import { SCHEMA_DDL, SCHEMA_VERSION } from './mirror-schema';

/** 各账号镜像库的存放目录。 */
export const MIRROR_DIR = path.join(dataDir, 'wechat-mirror');
/** 迁移前的全局单文件位置。 */
const LEGACY_MIRROR_PATH = path.join(dataDir, 'wechat-mirror.db');

let db: Database.Database | null = null;
/** 当前打开的是哪个账号的库 —— 账号一变就得换连接。 */
let openedAccount: string | null = null;

export function mirrorDbPathFor(accountKey: string): string {
  return path.join(MIRROR_DIR, `${accountKey}.db`);
}

export function getMirrorDb(): Database.Database {
  const account = getActiveAccountKey();
  // 账号切了就把旧连接换掉,否则会继续往上一个账号的库里写。
  if (db && openedAccount !== account) closeMirrorDb();
  if (db) return db;

  if (!fs.existsSync(MIRROR_DIR)) fs.mkdirSync(MIRROR_DIR, { recursive: true });
  migrateLegacyMirror(account);

  db = new Database(mirrorDbPathFor(account));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 30000');
  db.pragma('foreign_keys = OFF');
  db.pragma('synchronous = NORMAL');

  bootstrap(db);
  openedAccount = account;
  return db;
}

export function closeMirrorDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
  openedAccount = null;
}

/**
 * 删掉某个账号的镜像数据(连同 WAL 边车文件)。用于"清空微信配置"。
 * 删的是当前已打开的库时先关连接,否则 Windows 上文件被占用删不掉。
 */
export function deleteMirrorForAccount(accountKey: string): void {
  if (openedAccount === accountKey) closeMirrorDb();
  const base = mirrorDbPathFor(accountKey);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${base}${suffix}`); } catch { /* 不存在即已达成目标 */ }
  }
}

/** 列出本机存过镜像的账号,给"清空"和排查用。 */
export function listMirrorAccounts(): string[] {
  try {
    return fs.readdirSync(MIRROR_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

/**
 * 把旧的全局单文件收编成"某个账号的库"。
 *
 * 归给谁:优先归给当前绑定账号 —— 升级前这个文件里装的正是当时那个账号的数据。
 * 没有绑定账号(没取过密钥)时归到 default,行为与升级前一致。
 * 目标已存在则不覆盖,只把旧文件挪开,避免重复迁移。
 */
function migrateLegacyMirror(account: string): void {
  if (!fs.existsSync(LEGACY_MIRROR_PATH)) return;
  const target = mirrorDbPathFor(account);
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(LEGACY_MIRROR_PATH, `${LEGACY_MIRROR_PATH}.superseded`);
      return;
    }
    fs.renameSync(LEGACY_MIRROR_PATH, target);
    // WAL 边车一并搬走,否则 SQLite 会拿旧 WAL 去套新路径。
    for (const suffix of ['-wal', '-shm']) {
      try { fs.renameSync(`${LEGACY_MIRROR_PATH}${suffix}`, `${target}${suffix}`); } catch { /* 可能不存在 */ }
    }
  } catch { /* 迁移失败就当没有旧数据,重新同步即可 */ }
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

/** @deprecated 镜像已按账号分库,用 `mirrorDbPathFor(getActiveAccountKey())`。 */
export const MIRROR_DB_PATH = mirrorDbPathFor(UNBOUND_ACCOUNT_KEY);
