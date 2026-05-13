import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { buildPipeline } from '../pipeline';
import type {
  DiscoverCandidateRecord,
  ImageJobRecord,
  ImageOutputRecord,
  ListingDraftRecord,
  ProductBriefRecord,
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

describe('buildPipeline', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when no inputs exist', () => {
    expect(buildPipeline(store)).toEqual([]);
  });

  it('marks an input with no main image as needs-main-image', () => {
    const created = store.create<ProductInputRecord>('product_inputs', {
      title: 'Bare Input',
      main_image_path: '',
      status: 'ready',
    });
    const entries = buildPipeline(store);
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe('needs-main-image');
    expect(entries[0].nextStep).toContain('真实样品主图');
    expect(entries[0].source).toBe('manual');
    expect(entries[0].inputId).toBe((created as { id: string }).id);
  });

  it('detects discover-promoted source via candidate.promoted_input_id', () => {
    const input = store.create<ProductInputRecord>('product_inputs', {
      title: 'From Discover',
      main_image_path: '/tmp/concept.png',
      status: 'ready',
    });
    store.create<DiscoverCandidateRecord>('discover_candidates', {
      research_id: 'r1',
      keyword: 'k',
      market: 'US',
      product_name: 'From Discover',
      category: 'cat',
      status: 'promoted',
      promoted_input_id: (input as { id: string }).id,
      concept_image_path: '/tmp/concept.png',
    });
    const entries = buildPipeline(store);
    expect(entries[0].source).toBe('discover-promoted');
    expect(entries[0].conceptImagePath).toBe('/tmp/concept.png');
    expect(entries[0].stage).toBe('needs-main-image');
    expect(entries[0].hasMainImage).toBe(false);
  });

  it('detects generating stage when a job is running', () => {
    const input = store.create<ProductInputRecord>('product_inputs', {
      title: 'Has running job',
      main_image_path: '/tmp/main.png',
      status: 'ready',
    });
    store.create<ImageJobRecord>('image_jobs', {
      input_id: (input as { id: string }).id,
      status: 'cutting',
      stage: 'cutting',
      progress: 30,
    });
    const entries = buildPipeline(store);
    expect(entries[0].stage).toBe('generating');
    expect(entries[0].jobs.running).toBe(1);
  });

  it('detects has-final-image when winner output exists', () => {
    const input = store.create<ProductInputRecord>('product_inputs', {
      title: 'Has final',
      main_image_path: '/tmp/m.png',
      status: 'ready',
    });
    const inputId = (input as { id: string }).id;
    const job = store.create<ImageJobRecord>('image_jobs', {
      input_id: inputId,
      status: 'completed',
      stage: 'qc',
      progress: 100,
    });
    store.create<ImageOutputRecord>('image_outputs', {
      job_id: (job as { id: string }).id,
      input_id: inputId,
      kind: 'final',
      image_path: '/tmp/final.png',
      is_winner: true,
    });
    const entries = buildPipeline(store);
    expect(entries[0].stage).toBe('has-final-image');
    expect(entries[0].finalImagePath).toBe('/tmp/final.png');
    expect(entries[0].nextStep).toContain('上架');
  });

  it('aggregates listings by platform and detects warnings', () => {
    const input = store.create<ProductInputRecord>('product_inputs', {
      title: 'Has listings',
      main_image_path: '/tmp/m.png',
      status: 'ready',
    });
    const inputId = (input as { id: string }).id;
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: inputId,
      platform: 'amazon-us',
      language: 'en',
      title: 't',
      status: 'ready',
    });
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: inputId,
      platform: 'tiktok-shop-us',
      language: 'en',
      title: 't',
      status: 'ready',
      warnings: JSON.stringify(['Avoid medical claims.']),
    });
    const entries = buildPipeline(store);
    expect(entries[0].listings.total).toBe(2);
    expect(entries[0].listings.ready).toBe(2);
    expect(entries[0].listings.byPlatform).toEqual({
      'amazon-us': 1,
      'tiktok-shop-us': 1,
    });
    expect(entries[0].listings.hasWarnings).toBe(true);
    expect(entries[0].stage).toBe('has-warnings');
  });

  it('reports live-ready when listing exists, has final, no warnings', () => {
    const input = store.create<ProductInputRecord>('product_inputs', {
      title: 'Live',
      main_image_path: '/tmp/m.png',
      status: 'ready',
    });
    const inputId = (input as { id: string }).id;
    const job = store.create<ImageJobRecord>('image_jobs', {
      input_id: inputId,
      status: 'completed',
      stage: 'qc',
      progress: 100,
    });
    store.create<ImageOutputRecord>('image_outputs', {
      job_id: (job as { id: string }).id,
      input_id: inputId,
      kind: 'final',
      image_path: '/tmp/final.png',
      is_winner: true,
    });
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: inputId,
      platform: 'amazon-us',
      language: 'en',
      title: 't',
      status: 'ready',
    });
    const entries = buildPipeline(store);
    expect(entries[0].stage).toBe('live-ready');
  });

  it('honors the limit option', () => {
    for (let i = 0; i < 5; i++) {
      store.create<ProductInputRecord>('product_inputs', {
        title: `p${i}`,
        main_image_path: '/tmp/x.png',
        status: 'ready',
      });
    }
    expect(buildPipeline(store, { limit: 3 })).toHaveLength(3);
  });

  it('attaches brief metadata when present', () => {
    const input = store.create<ProductInputRecord>('product_inputs', {
      title: 'With brief',
      main_image_path: '/tmp/m.png',
      status: 'ready',
    });
    store.create<ProductBriefRecord>('product_briefs', {
      input_id: (input as { id: string }).id,
      product_type: 'travel-mug',
      confidence: 8,
    });
    const entries = buildPipeline(store);
    expect(entries[0].brief).toEqual({
      hasBrief: true,
      productType: 'travel-mug',
      confidence: 8,
    });
  });
});
