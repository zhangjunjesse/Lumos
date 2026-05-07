import type Database from 'better-sqlite3';

/**
 * Single entry point for reading and writing an application's data.
 *
 * **Data isolation contract**: every query is scoped to a single appId — the
 * provided id is interpolated into every WHERE clause, never accepts another
 * app's id, and the underlying table's composite primary key (app_id,
 * collection, id) makes cross-app data physically impossible to address from
 * this API. If you need to read another app's data, you cannot — by design.
 *
 * Other modules MUST go through this factory; do not query lumos_app_data
 * directly from anywhere else.
 */

export type Filter = Record<string, unknown>;

export type QueryOptions = {
  filter?: Filter;
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
};

export type AppRow<T = Record<string, unknown>> = T & { id: string };

export interface AppDataStore {
  query<T = Record<string, unknown>>(collection: string, opts?: QueryOptions): AppRow<T>[];
  get<T = Record<string, unknown>>(collection: string, id: string): AppRow<T> | null;
  create<T extends Record<string, unknown>>(
    collection: string,
    data: T & { id?: string },
  ): AppRow<T>;
  update<T extends Record<string, unknown>>(
    collection: string,
    id: string,
    patch: Partial<T>,
  ): AppRow<T> | null;
  delete(collection: string, id: string): boolean;
  count(collection: string, filter?: Filter): number;
}

const COLLECTION_RE = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_RE = /^[a-z][a-z0-9_]{0,63}$/;

function assertCollectionName(name: string): void {
  if (!COLLECTION_RE.test(name)) {
    throw new Error(
      `Invalid collection name: ${JSON.stringify(name)} (must match /^[a-z][a-z0-9_]{0,63}$/)`,
    );
  }
}

function assertFieldName(name: string): void {
  if (!FIELD_RE.test(name)) {
    throw new Error(
      `Invalid field name: ${JSON.stringify(name)} (must match /^[a-z][a-z0-9_]{0,63}$/)`,
    );
  }
}

function nowMs(): number {
  return Date.now();
}

function genId(): string {
  // 22-char base62-ish id; sufficient entropy for app-scoped collections.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function createAppDataStore(db: Database.Database, appId: string): AppDataStore {
  if (!appId || typeof appId !== 'string') {
    throw new Error('createAppDataStore: appId required');
  }

  function rowToObj<T>(row: { data_json: string; id: string }): AppRow<T> {
    const parsed = JSON.parse(row.data_json) as T & { id?: string };
    return { ...parsed, id: row.id };
  }

  function buildFilterClause(filter: Filter | undefined): {
    sql: string;
    params: unknown[];
  } {
    if (!filter) return { sql: '', params: [] };
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [field, value] of Object.entries(filter)) {
      assertFieldName(field);
      // SQLite JSON path lookup. We constrain to top-level fields by using
      // json_extract on the stored data_json. NOTE: 'id' is the row id column.
      if (field === 'id') {
        clauses.push('id = ?');
        params.push(value);
      } else if (value === null) {
        clauses.push(`json_extract(data_json, '$.${field}') IS NULL`);
      } else {
        clauses.push(`json_extract(data_json, '$.${field}') = ?`);
        params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
    }
    return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
  }

  return {
    query<T = Record<string, unknown>>(
      collection: string,
      opts: QueryOptions = {},
    ): AppRow<T>[] {
      assertCollectionName(collection);
      const { sql: filterSql, params: filterParams } = buildFilterClause(opts.filter);

      let orderClause = ' ORDER BY updated_at DESC';
      if (opts.orderBy) {
        assertFieldName(opts.orderBy.field);
        const dir = opts.orderBy.direction === 'asc' ? 'ASC' : 'DESC';
        orderClause =
          opts.orderBy.field === 'id'
            ? ` ORDER BY id ${dir}`
            : ` ORDER BY json_extract(data_json, '$.${opts.orderBy.field}') ${dir}`;
      }

      let limitClause = '';
      const limitParams: unknown[] = [];
      if (typeof opts.limit === 'number') {
        limitClause = ' LIMIT ?';
        limitParams.push(Math.max(0, Math.floor(opts.limit)));
        if (typeof opts.offset === 'number') {
          limitClause += ' OFFSET ?';
          limitParams.push(Math.max(0, Math.floor(opts.offset)));
        }
      }

      const stmt = db.prepare(
        `SELECT id, data_json FROM lumos_app_data
         WHERE app_id = ? AND collection = ?${filterSql}${orderClause}${limitClause}`,
      );
      const rows = stmt.all(appId, collection, ...filterParams, ...limitParams) as {
        id: string;
        data_json: string;
      }[];
      return rows.map((r) => rowToObj<T>(r));
    },

    get<T = Record<string, unknown>>(collection: string, id: string): AppRow<T> | null {
      assertCollectionName(collection);
      const row = db
        .prepare(
          `SELECT id, data_json FROM lumos_app_data
           WHERE app_id = ? AND collection = ? AND id = ?`,
        )
        .get(appId, collection, id) as { id: string; data_json: string } | undefined;
      return row ? rowToObj<T>(row) : null;
    },

    create<T extends Record<string, unknown>>(
      collection: string,
      data: T & { id?: string },
    ): AppRow<T> {
      assertCollectionName(collection);
      const now = nowMs();
      const { id: providedId, ...rest } = data as { id?: string } & Record<string, unknown>;
      const rowId = providedId ?? genId();
      db.prepare(
        `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(appId, collection, rowId, JSON.stringify(rest), now, now);
      return { ...(rest as T), id: rowId };
    },

    update<T extends Record<string, unknown>>(
      collection: string,
      id: string,
      patch: Partial<T>,
    ): AppRow<T> | null {
      assertCollectionName(collection);
      const row = db
        .prepare(
          `SELECT data_json FROM lumos_app_data
           WHERE app_id = ? AND collection = ? AND id = ?`,
        )
        .get(appId, collection, id) as { data_json: string } | undefined;
      if (!row) return null;
      const current = JSON.parse(row.data_json) as Record<string, unknown>;
      // Strip 'id' from patch — id is identity, not data.
      const { id: _ignored, ...patchRest } = patch as { id?: string } & Record<string, unknown>;
      void _ignored;
      const next = { ...current, ...patchRest };
      const now = nowMs();
      db.prepare(
        `UPDATE lumos_app_data SET data_json = ?, updated_at = ?
         WHERE app_id = ? AND collection = ? AND id = ?`,
      ).run(JSON.stringify(next), now, appId, collection, id);
      return { ...(next as T), id };
    },

    delete(collection: string, id: string): boolean {
      assertCollectionName(collection);
      const info = db
        .prepare(
          `DELETE FROM lumos_app_data
           WHERE app_id = ? AND collection = ? AND id = ?`,
        )
        .run(appId, collection, id);
      return info.changes > 0;
    },

    count(collection: string, filter?: Filter): number {
      assertCollectionName(collection);
      const { sql: filterSql, params: filterParams } = buildFilterClause(filter);
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM lumos_app_data
           WHERE app_id = ? AND collection = ?${filterSql}`,
        )
        .get(appId, collection, ...filterParams) as { c: number };
      return row.c;
    },
  };
}
