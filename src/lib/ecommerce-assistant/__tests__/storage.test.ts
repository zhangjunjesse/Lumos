import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import {
  appendOutput,
  createJobRecord,
  ensureBuiltinStylePresets,
  getInput,
  listJobs,
  patchJob,
  readReferenceImagePaths,
  upsertBrief,
} from '../storage';
import type {
  ImageOutputRecord,
  ProductBriefRecord,
  ProductInputRecord,
  StylePresetRecord,
} from '../types';

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

describe('ecommerce-assistant storage helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('readReferenceImagePaths handles missing/invalid input', () => {
    expect(readReferenceImagePaths({} as ProductInputRecord)).toEqual([]);
    expect(
      readReferenceImagePaths({ reference_image_paths: 'not-json' } as ProductInputRecord),
    ).toEqual([]);
    expect(
      readReferenceImagePaths({
        reference_image_paths: JSON.stringify(['/tmp/a.png', '/tmp/b.png']),
      } as ProductInputRecord),
    ).toEqual(['/tmp/a.png', '/tmp/b.png']);
  });

  it('ensureBuiltinStylePresets seeds three directional presets idempotently', () => {
    const store = createAppDataStore(db, APP_ID);
    ensureBuiltinStylePresets(store);
    let presets = store.query<StylePresetRecord>('style_presets', { limit: 10 });
    expect(presets).toHaveLength(3);
    const directions = presets.map((p) => p.direction).sort();
    expect(directions).toEqual(['campaign', 'catalog', 'lifestyle']);
    // Calling a second time should not duplicate.
    ensureBuiltinStylePresets(store);
    presets = store.query<StylePresetRecord>('style_presets', { limit: 10 });
    expect(presets).toHaveLength(3);
    for (const preset of presets) {
      expect(preset.is_builtin).toBeTruthy();
      expect(preset.enabled).toBeTruthy();
      const rules = JSON.parse(preset.negative_rules ?? '[]');
      expect(Array.isArray(rules)).toBe(true);
    }
  });

  it('createJobRecord stores defaults and updates persist', () => {
    const store = createAppDataStore(db, APP_ID);
    const inputRow = store.create<ProductInputRecord>('product_inputs', {

      title: '木桌',
      main_image_path: '/tmp/input.png',
      status: 'ready',
    });
    const job = createJobRecord(store, { input_id: inputRow.id });
    expect(job.status).toBe('queued');
    expect(job.progress).toBe(0);
    expect(job.cutout_attempts).toBe(0);
    patchJob(store, job.id, { status: 'cutting', stage: 'do-cutout', progress: 25 });
    const reread = listJobs(store).find((j) => j.id === job.id)!;
    expect(reread.status).toBe('cutting');
    expect(reread.stage).toBe('do-cutout');
    expect(reread.progress).toBe(25);
  });

  it('appendOutput records image_outputs with kind', () => {
    const store = createAppDataStore(db, APP_ID);
    const inputRow = store.create<ProductInputRecord>('product_inputs', {

      title: '木桌',
      main_image_path: '/tmp/input.png',
      status: 'ready',
    });
    const job = createJobRecord(store, { input_id: inputRow.id });
    appendOutput(store, {
      job_id: job.id,
      input_id: inputRow.id,
      kind: 'cutout',
      image_path: '/tmp/cutout.png',
      qc_pass: true,
    });
    const outputs = store.query<ImageOutputRecord>('image_outputs', { limit: 10 });
    expect(outputs).toHaveLength(1);
    expect(outputs[0].kind).toBe('cutout');
    expect(outputs[0].qc_pass).toBeTruthy();
  });

  it('upsertBrief creates and updates the same row for the same input_id', () => {
    const store = createAppDataStore(db, APP_ID);
    const inputRow = store.create<ProductInputRecord>('product_inputs', {

      title: '木桌',
      main_image_path: '/tmp/input.png',
      status: 'ready',
    });
    upsertBrief(store, {
      input_id: inputRow.id,
      brief: { productType: 'wooden coffee table' },
      raw: '{"productType":"wooden coffee table"}',
      confidence: 8,
    });
    upsertBrief(store, {
      input_id: inputRow.id,
      brief: { productType: 'oak coffee table' },
      raw: '{"productType":"oak coffee table"}',
      confidence: 9,
    });
    const briefs = store.query<ProductBriefRecord>('product_briefs', { limit: 10 });
    expect(briefs).toHaveLength(1);
    expect(briefs[0].product_type).toBe('oak coffee table');
    expect(briefs[0].confidence).toBe(9);
  });

  it('getInput returns the row by id', () => {
    const store = createAppDataStore(db, APP_ID);
    const inputRow = store.create<ProductInputRecord>('product_inputs', {

      title: '木桌',
      main_image_path: '/tmp/input.png',
      status: 'ready',
    });
    const fetched = getInput(store, inputRow.id);
    expect(fetched?.title).toBe('木桌');
  });
});
