import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../db/migrations-app';
import { createAppDataStore } from '../data-store';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return db;
}

function registerApp(db: Database.Database, appId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(appId, appId, '1.0.0', '{}', 'ai-generated', `/tmp/${appId}`, now);
}

describe('createAppDataStore', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('rejects empty appId', () => {
    expect(() => createAppDataStore(db, '')).toThrow();
  });

  describe('CRUD', () => {
    it('creates with auto-generated id and reads it back', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');

      const created = store.create('customers', { name: 'Alice', status: 'active' });
      expect(created.id).toMatch(/^[A-Za-z0-9]+$/);
      expect(created.name).toBe('Alice');

      const fetched = store.get<{ name: string; status: string }>('customers', created.id);
      expect(fetched?.name).toBe('Alice');
      expect(fetched?.status).toBe('active');
    });

    it('respects user-provided id', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      const created = store.create('customers', { id: 'cust-1', name: 'Bob' });
      expect(created.id).toBe('cust-1');
      expect(store.get('customers', 'cust-1')).toEqual({ id: 'cust-1', name: 'Bob' });
    });

    it('updates merge fields and ignores id in patch', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      const c = store.create('customers', { id: 'cust-1', name: 'Bob', phone: '111' });
      const updated = store.update<{ name: string; phone: string; tier?: string }>(
        'customers',
        'cust-1',
        { phone: '222', tier: 'gold', id: 'should-be-ignored' as never },
      );
      expect(updated?.id).toBe('cust-1');
      expect(updated?.name).toBe('Bob');     // merged
      expect(updated?.phone).toBe('222');    // patched
      expect(updated?.tier).toBe('gold');    // added
      void c;
    });

    it('update returns null for missing row', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      expect(store.update('customers', 'missing', { name: 'X' })).toBeNull();
    });

    it('delete returns true on success and false on missing', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      store.create('customers', { id: 'cust-1', name: 'Bob' });
      expect(store.delete('customers', 'cust-1')).toBe(true);
      expect(store.delete('customers', 'cust-1')).toBe(false);
      expect(store.get('customers', 'cust-1')).toBeNull();
    });
  });

  describe('query', () => {
    it('filters by equality on top-level fields', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      store.create('customers', { id: 'a', name: 'A', status: 'active' });
      store.create('customers', { id: 'b', name: 'B', status: 'inactive' });
      store.create('customers', { id: 'c', name: 'C', status: 'active' });

      const active = store.query('customers', { filter: { status: 'active' } });
      expect(active).toHaveLength(2);
      expect(active.map((r) => r.id).sort()).toEqual(['a', 'c']);
    });

    it('orders by updated_at desc by default', async () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      store.create('customers', { id: 'a', name: 'A' });
      await new Promise((r) => setTimeout(r, 5));
      store.create('customers', { id: 'b', name: 'B' });
      const rows = store.query('customers');
      expect(rows[0].id).toBe('b');
    });

    it('respects limit and offset', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      for (let i = 0; i < 5; i++) {
        store.create('customers', { id: `r${i}`, idx: i });
      }
      const rows = store.query('customers', { limit: 2, offset: 1 });
      expect(rows).toHaveLength(2);
    });

    it('orders by an arbitrary JSON field', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      store.create('customers', { id: 'a', priority: 3 });
      store.create('customers', { id: 'b', priority: 1 });
      store.create('customers', { id: 'c', priority: 2 });
      const rows = store.query<{ priority: number }>('customers', {
        orderBy: { field: 'priority', direction: 'asc' },
      });
      expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    });

    it('rejects malformed collection or field names', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      expect(() => store.query('Bad-Name')).toThrow();
      expect(() =>
        store.query('customers', { filter: { 'evil; DROP TABLE x;': 'x' } as never }),
      ).toThrow();
      expect(() =>
        store.query('customers', { orderBy: { field: 'nope; --' } }),
      ).toThrow();
    });
  });

  describe('count', () => {
    it('counts with and without filter', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      store.create('orders', { id: 'o1', state: 'paid' });
      store.create('orders', { id: 'o2', state: 'paid' });
      store.create('orders', { id: 'o3', state: 'pending' });
      expect(store.count('orders')).toBe(3);
      expect(store.count('orders', { state: 'paid' })).toBe(2);
    });
  });

  describe('isolation', () => {
    it('app A cannot read app B data', () => {
      registerApp(db, 'app-a');
      registerApp(db, 'app-b');
      const a = createAppDataStore(db, 'app-a');
      const b = createAppDataStore(db, 'app-b');

      a.create('customers', { id: 'shared-id', name: 'A_data' });
      b.create('customers', { id: 'shared-id', name: 'B_data' });

      expect(a.get<{ name: string }>('customers', 'shared-id')?.name).toBe('A_data');
      expect(b.get<{ name: string }>('customers', 'shared-id')?.name).toBe('B_data');

      expect(a.query('customers')).toHaveLength(1);
      expect(b.query('customers')).toHaveLength(1);
      expect(a.count('customers')).toBe(1);
    });

    it('app A delete does not affect app B', () => {
      registerApp(db, 'app-a');
      registerApp(db, 'app-b');
      const a = createAppDataStore(db, 'app-a');
      const b = createAppDataStore(db, 'app-b');

      a.create('customers', { id: 'r1', name: 'AAA' });
      b.create('customers', { id: 'r1', name: 'BBB' });

      a.delete('customers', 'r1');

      expect(a.get('customers', 'r1')).toBeNull();
      expect(b.get<{ name: string }>('customers', 'r1')?.name).toBe('BBB');
    });

    it('a malicious filter cannot leak across apps', () => {
      registerApp(db, 'app-a');
      registerApp(db, 'app-b');
      const a = createAppDataStore(db, 'app-a');
      const b = createAppDataStore(db, 'app-b');
      a.create('customers', { id: 'a1', name: 'A' });
      b.create('customers', { id: 'b1', name: 'B' });

      // Even with raw filter values, query is still scoped to appId.
      const results = a.query('customers', { filter: { name: 'B' } });
      expect(results).toHaveLength(0);
    });
  });

  describe('null handling', () => {
    it('matches null filter', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      store.create('customers', { id: 'a', tier: null });
      store.create('customers', { id: 'b', tier: 'gold' });
      const rows = store.query('customers', { filter: { tier: null } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('a');
    });

    it('boolean filter value is normalized to int', () => {
      registerApp(db, 'app-a');
      const store = createAppDataStore(db, 'app-a');
      store.create('customers', { id: 'a', archived: true });
      store.create('customers', { id: 'b', archived: false });
      // booleans are JSON-serialized — json_extract returns 1/0.
      // This test documents that `true` filter must match SQLite's 1.
      const archived = store.query('customers', { filter: { archived: true } });
      expect(archived.map((r) => r.id)).toEqual(['a']);
    });
  });
});
