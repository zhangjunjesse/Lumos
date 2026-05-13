import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { recordAuditEvent, listAuditEvents } from '../audit-log';

const APP_ID = 'ecommerce-assistant';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(APP_ID, APP_ID, '0.1.0', '{}', 'builtin', '/tmp/' + APP_ID, Date.now());
  return db;
}

describe('audit-log', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });
  afterEach(() => db.close());

  it('writes event with summary, payload, occurred_at, kind, target_type', () => {
    recordAuditEvent(store, {
      kind: 'candidate-promoted',
      targetId: 'cand-1',
      targetType: 'candidate',
      inputId: 'inp-1',
      summary: 'promoted to studio',
      payload: { product_name: 'Mug' },
    });
    const rows = listAuditEvents(store);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('candidate-promoted');
    expect(rows[0].target_id).toBe('cand-1');
    expect(rows[0].target_type).toBe('candidate');
    expect(rows[0].input_id).toBe('inp-1');
    expect(rows[0].summary).toBe('promoted to studio');
    expect(rows[0].payload).toBe(JSON.stringify({ product_name: 'Mug' }));
    expect(rows[0].occurred_at).toBeTruthy();
  });

  it('filters by input_id', () => {
    recordAuditEvent(store, {
      kind: 'main-image-uploaded',
      targetId: 'inp-1',
      targetType: 'input',
      inputId: 'inp-1',
      summary: 'A',
    });
    recordAuditEvent(store, {
      kind: 'main-image-uploaded',
      targetId: 'inp-2',
      targetType: 'input',
      inputId: 'inp-2',
      summary: 'B',
    });
    const filtered = listAuditEvents(store, { inputId: 'inp-1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].summary).toBe('A');
  });

  it('filters by kind', () => {
    recordAuditEvent(store, { kind: 'brief-edited', targetId: 'i', targetType: 'input', inputId: 'i' });
    recordAuditEvent(store, { kind: 'listing-drafted', targetId: 'd', targetType: 'listing', inputId: 'i' });
    expect(listAuditEvents(store, { kind: 'brief-edited' })).toHaveLength(1);
    expect(listAuditEvents(store, { kind: 'listing-drafted' })).toHaveLength(1);
  });

  it('returns events in newest-first order', async () => {
    recordAuditEvent(store, { kind: 'brief-edited', targetId: 'i', targetType: 'input', inputId: 'i', summary: 'first' });
    // small delay so occurred_at differs
    await new Promise((r) => setTimeout(r, 10));
    recordAuditEvent(store, { kind: 'brief-edited', targetId: 'i', targetType: 'input', inputId: 'i', summary: 'second' });
    const events = listAuditEvents(store);
    expect(events[0].summary).toBe('second');
    expect(events[1].summary).toBe('first');
  });

  it('does not throw if collection write fails (best-effort)', () => {
    // Force a failure by closing the db before write
    db.close();
    expect(() => {
      recordAuditEvent(store, {
        kind: 'brief-edited',
        targetId: 'x',
        targetType: 'input',
      });
    }).not.toThrow();
    // Re-open for afterEach cleanup
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });
});
