// Adapter from the dispatcher's `db` interface → lumos_app_data SQLite table.
// One adapter per (db, appId) pair; rows are scoped to that app id.

import type Database from 'better-sqlite3';
import type { DispatcherAdapters } from './dispatcher';

export interface SqliteDbAdapterOptions {
  db: Database.Database;
  appId: string;
}

interface AppRow {
  data_json: string;
}

interface AppRowWithMeta extends AppRow {
  collection: string;
  id: string;
  created_at: number;
  updated_at: number;
}

/** Builds a `db` adapter scoped to an appId, backed by lumos_app_data. */
export function createSqliteDbAdapter(opts: SqliteDbAdapterOptions): DispatcherAdapters['db'] {
  const { db, appId } = opts;

  return {
    async list(collection, opts) {
      const o = (opts ?? {}) as { filter?: Record<string, unknown>; sort?: string; limit?: number; offset?: number };
      const limit = clampInt(o.limit, 50, 1, 1000);
      const offset = clampInt(o.offset, 0, 0, 100_000);

      const rows = db
        .prepare(
          `SELECT collection, id, data_json, created_at, updated_at
           FROM lumos_app_data
           WHERE app_id = ? AND collection = ?
           ORDER BY updated_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(appId, collection, limit + offset, 0) as AppRowWithMeta[];

      let result = rows.map(rowToObject);
      result = applyFilter(result, o.filter);
      result = applySort(result, o.sort);
      return result.slice(offset, offset + limit);
    },

    async get(collection, id) {
      const row = db
        .prepare(
          `SELECT data_json, created_at, updated_at
           FROM lumos_app_data
           WHERE app_id = ? AND collection = ? AND id = ?`,
        )
        .get(appId, collection, id) as (AppRow & { created_at: number; updated_at: number }) | undefined;
      if (!row) return null;
      return { id, ...JSON.parse(row.data_json), created_at: row.created_at, updated_at: row.updated_at };
    },

    async count(collection, filter) {
      if (!filter || Object.keys(filter).length === 0) {
        const row = db
          .prepare(`SELECT COUNT(*) AS c FROM lumos_app_data WHERE app_id = ? AND collection = ?`)
          .get(appId, collection) as { c: number };
        return row.c;
      }
      // Filters in JSON column → load + filter in JS (fine for small datasets).
      const rows = db
        .prepare(`SELECT data_json FROM lumos_app_data WHERE app_id = ? AND collection = ?`)
        .all(appId, collection) as AppRow[];
      return applyFilter(rows.map((r) => JSON.parse(r.data_json) as Record<string, unknown>), filter as Record<string, unknown>).length;
    },

    async create(collection, data) {
      const now = Date.now();
      const d = data as Record<string, unknown>;
      const id = typeof d.id === 'string' && d.id ? d.id : generateId();
      const { id: _drop, ...rest } = d;
      void _drop;
      db
        .prepare(
          `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(appId, collection, id, JSON.stringify(rest), now, now);
      return { id, ...rest, created_at: now, updated_at: now };
    },

    async update(collection, id, patch) {
      const now = Date.now();
      const existing = db
        .prepare(`SELECT data_json, created_at FROM lumos_app_data WHERE app_id = ? AND collection = ? AND id = ?`)
        .get(appId, collection, id) as (AppRow & { created_at: number }) | undefined;
      if (!existing) return null;
      const merged = { ...JSON.parse(existing.data_json), ...(patch as Record<string, unknown>) };
      delete (merged as Record<string, unknown>).id;
      db
        .prepare(
          `UPDATE lumos_app_data SET data_json = ?, updated_at = ?
           WHERE app_id = ? AND collection = ? AND id = ?`,
        )
        .run(JSON.stringify(merged), now, appId, collection, id);
      return { id, ...merged, created_at: existing.created_at, updated_at: now };
    },

    async delete(collection, id) {
      const info = db
        .prepare(`DELETE FROM lumos_app_data WHERE app_id = ? AND collection = ? AND id = ?`)
        .run(appId, collection, id);
      return info.changes > 0;
    },
  };
}

// ---- helpers --------------------------------------------------------------

function rowToObject(row: AppRowWithMeta): Record<string, unknown> {
  return { id: row.id, ...JSON.parse(row.data_json), created_at: row.created_at, updated_at: row.updated_at };
}

function applyFilter(rows: Record<string, unknown>[], filter: unknown): Record<string, unknown>[] {
  if (!filter || typeof filter !== 'object') return rows;
  const f = filter as Record<string, unknown>;
  return rows.filter((row) => {
    for (const [field, condition] of Object.entries(f)) {
      const value = row[field];
      if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
        const c = condition as Record<string, unknown>;
        if ('eq' in c && value !== c.eq) return false;
        if ('neq' in c && value === c.neq) return false;
        if ('gt' in c && !(typeof value === 'number' && value > (c.gt as number))) return false;
        if ('gte' in c && !(typeof value === 'number' && value >= (c.gte as number))) return false;
        if ('lt' in c && !(typeof value === 'number' && value < (c.lt as number))) return false;
        if ('lte' in c && !(typeof value === 'number' && value <= (c.lte as number))) return false;
        if ('contains' in c && !(typeof value === 'string' && value.includes(String(c.contains)))) return false;
        if ('in' in c && Array.isArray(c.in) && !(c.in as unknown[]).includes(value)) return false;
      } else if (value !== condition) {
        return false;
      }
    }
    return true;
  });
}

function applySort(rows: Record<string, unknown>[], sort: string | undefined): Record<string, unknown>[] {
  if (!sort) return rows;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return 0;
    if (av == null) return desc ? 1 : -1;
    if (bv == null) return desc ? -1 : 1;
    if (av < bv) return desc ? 1 : -1;
    return desc ? -1 : 1;
  });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function generateId(): string {
  // crypto.randomUUID in Node 19+ / browsers
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Cheap fallback (good enough for app-scoped ids)
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
