/**
 * Smoke-test the user-edit semantics expected by the brief PATCH endpoint:
 * - confidence is bumped to 9 on user edit
 * - existing raw_brief metadata is preserved
 * - last_user_edit_at is recorded
 * - source flag is flipped to 'user-edited'
 *
 * The route handler isn't invoked directly (Next.js NextRequest needs a
 * server context). Instead we exercise the same upsert path the handler
 * uses against a real in-memory AppDataStore so the *contract* is locked in.
 */

import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import type { ProductBriefRecord, ProductInputRecord } from '../types';

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

/**
 * Re-implement the route's patch logic locally so the contract is testable.
 * Keep this in sync with route.ts PATCH.
 */
function applyUserBriefEdit(
  store: ReturnType<typeof createAppDataStore>,
  inputId: string,
  body: {
    product_type?: string;
    category_bucket?: string;
    size_class?: 'small' | 'medium' | 'large';
    recommended_aspect_ratio?: string;
    core_selling_points?: string[];
    target_audience?: string[];
    avoid_elements?: string[];
  },
): ProductBriefRecord {
  const existing = store
    .query<ProductBriefRecord>('product_briefs', { filter: { input_id: inputId }, limit: 1 })
    .at(0);
  if (!existing) throw new Error('brief 不存在');
  const patch: Partial<ProductBriefRecord> = {};
  if (body.product_type !== undefined) patch.product_type = body.product_type || null;
  if (body.category_bucket !== undefined) patch.category_bucket = body.category_bucket || null;
  if (body.size_class !== undefined) patch.size_class = body.size_class;
  if (body.recommended_aspect_ratio !== undefined) {
    patch.recommended_aspect_ratio = body.recommended_aspect_ratio || null;
  }
  if (body.core_selling_points !== undefined) {
    patch.core_selling_points = JSON.stringify(body.core_selling_points);
  }
  if (body.target_audience !== undefined) {
    patch.target_audience = JSON.stringify(body.target_audience);
  }
  if (body.avoid_elements !== undefined) {
    patch.avoid_elements = JSON.stringify(body.avoid_elements);
  }
  patch.confidence = 9;

  let rawObj: Record<string, unknown> = {};
  if (existing.raw_brief) {
    try {
      rawObj = JSON.parse(existing.raw_brief);
    } catch {
      rawObj = { previous_raw: existing.raw_brief };
    }
  }
  rawObj.last_user_edit_at = '2026-05-10T08:00:00Z';
  rawObj.source = 'user-edited';
  patch.raw_brief = JSON.stringify(rawObj);

  return store.update<ProductBriefRecord>('product_briefs', existing.id, patch)!;
}

describe('user brief edit contract', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;
  let inputId: string;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
    const input = store.create<ProductInputRecord>('product_inputs', {
      title: 'P', main_image_path: '/tmp/x.png', status: 'ready',
    });
    inputId = (input as { id: string }).id;
    store.create<ProductBriefRecord>('product_briefs', {
      input_id: inputId,
      product_type: 'old',
      category_bucket: 'cat-old',
      size_class: 'medium',
      recommended_aspect_ratio: '1:1',
      core_selling_points: JSON.stringify(['old point']),
      target_audience: JSON.stringify(['old audience']),
      avoid_elements: JSON.stringify(['old avoid']),
      confidence: 4,
      raw_brief: JSON.stringify({ source: 'discover-promoted', differentiation: 'X' }),
    });
  });

  afterEach(() => db.close());

  it('bumps confidence to 9 after user edit', () => {
    const updated = applyUserBriefEdit(store, inputId, { product_type: 'new' });
    expect(updated.confidence).toBe(9);
  });

  it('preserves existing raw_brief metadata, adds audit stamps', () => {
    const updated = applyUserBriefEdit(store, inputId, { product_type: 'new' });
    const raw = JSON.parse(updated.raw_brief ?? '{}') as {
      source: string;
      differentiation?: string;
      last_user_edit_at?: string;
    };
    expect(raw.source).toBe('user-edited');
    expect(raw.differentiation).toBe('X'); // pre-existing key kept
    expect(raw.last_user_edit_at).toBeTruthy();
  });

  it('serializes string-array fields as JSON', () => {
    const updated = applyUserBriefEdit(store, inputId, {
      core_selling_points: ['leak-proof', 'insulated'],
      target_audience: ['commuter'],
      avoid_elements: ['liquid splash'],
    });
    expect(JSON.parse(updated.core_selling_points ?? '[]')).toEqual([
      'leak-proof',
      'insulated',
    ]);
    expect(JSON.parse(updated.target_audience ?? '[]')).toEqual(['commuter']);
    expect(JSON.parse(updated.avoid_elements ?? '[]')).toEqual(['liquid splash']);
  });

  it('clears strings to null when set to empty', () => {
    const updated = applyUserBriefEdit(store, inputId, {
      product_type: '',
      category_bucket: '',
    });
    expect(updated.product_type).toBeNull();
    expect(updated.category_bucket).toBeNull();
  });

  it('survives malformed existing raw_brief by stashing it under previous_raw', () => {
    // Corrupt raw_brief to non-JSON string
    const briefs = store.query<ProductBriefRecord>('product_briefs', { filter: { input_id: inputId }, limit: 1 });
    store.update<ProductBriefRecord>('product_briefs', briefs[0].id, {
      raw_brief: 'this is not json{{{',
    });
    const updated = applyUserBriefEdit(store, inputId, { product_type: 'fixed' });
    const raw = JSON.parse(updated.raw_brief ?? '{}') as {
      previous_raw: string;
      source: string;
    };
    expect(raw.previous_raw).toContain('not json');
    expect(raw.source).toBe('user-edited');
  });
});
