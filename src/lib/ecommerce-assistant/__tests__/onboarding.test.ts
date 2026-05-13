import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { computeOnboarding } from '../onboarding';
import type {
  DiscoverCandidateRecord,
  ImageJobRecord,
  ListingDraftRecord,
  ProductInputRecord,
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

describe('computeOnboarding', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });
  afterEach(() => db.close());

  it('reports all steps undone on empty store + missing providers', () => {
    const out = computeOnboarding(store, { hasImageProvider: false, hasAnalysisProvider: false });
    expect(out.totalCount).toBe(6);
    expect(out.doneCount).toBe(0);
    expect(out.complete).toBe(false);
    expect(out.nextStep?.id).toBe('configure-provider');
  });

  it('marks configure-provider done when both providers present', () => {
    const out = computeOnboarding(store, { hasImageProvider: true, hasAnalysisProvider: true });
    expect(out.doneCount).toBe(1);
    expect(out.steps[0].done).toBe(true);
    expect(out.nextStep?.id).toBe('first-research');
  });

  it('progresses through happy path as data accumulates', () => {
    // start: providers configured + first research done
    store.create<DiscoverCandidateRecord>('discover_candidates', {
      research_id: 'r', keyword: 'k', market: 'US', product_name: 'A', category: 'c', status: 'ready',
    });
    let out = computeOnboarding(store, { hasImageProvider: true, hasAnalysisProvider: true });
    expect(out.doneCount).toBe(2);
    expect(out.nextStep?.id).toBe('first-product');

    // add product
    store.create<ProductInputRecord>('product_inputs', {
      title: 'P', main_image_path: '/tmp/x.png', status: 'ready',
    });
    out = computeOnboarding(store, { hasImageProvider: true, hasAnalysisProvider: true });
    expect(out.doneCount).toBe(3);
    expect(out.nextStep?.id).toBe('first-image-job');

    // add a completed job
    store.create<ImageJobRecord>('image_jobs', {
      input_id: 'P', status: 'completed', stage: 'qc', progress: 100,
    });
    out = computeOnboarding(store, { hasImageProvider: true, hasAnalysisProvider: true });
    expect(out.doneCount).toBe(4);
    expect(out.nextStep?.id).toBe('first-listing');

    // add a draft
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: 'P', platform: 'amazon-us', language: 'en', status: 'ready', title: 't',
    });
    out = computeOnboarding(store, { hasImageProvider: true, hasAnalysisProvider: true });
    expect(out.doneCount).toBe(5);
    expect(out.nextStep?.id).toBe('first-live');

    // mark a listing live
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: 'P', platform: 'tiktok-shop-us', language: 'en', status: 'live', title: 't2',
    });
    out = computeOnboarding(store, { hasImageProvider: true, hasAnalysisProvider: true });
    expect(out.doneCount).toBe(6);
    expect(out.complete).toBe(true);
    expect(out.nextStep).toBeNull();
  });

  it('does not regress when in-progress jobs exist (only completed counts)', () => {
    store.create<ImageJobRecord>('image_jobs', {
      input_id: 'P', status: 'cutting', stage: 'cutting', progress: 30,
    });
    const out = computeOnboarding(store, { hasImageProvider: true, hasAnalysisProvider: true });
    expect(out.steps.find((s) => s.id === 'first-image-job')?.done).toBe(false);
  });
});
