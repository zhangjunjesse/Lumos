import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { buildDashboard } from '../dashboard';
import type {
  DiscoverCandidateRecord,
  ImageJobRecord,
  ImageOutputRecord,
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

describe('buildDashboard', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });
  afterEach(() => db.close());

  it('returns zero counts on empty store', () => {
    const snap = buildDashboard(store);
    expect(snap.counts.candidates.total).toBe(0);
    expect(snap.counts.products.total).toBe(0);
    expect(snap.counts.jobs.total).toBe(0);
    expect(snap.counts.listings.total).toBe(0);
    expect(snap.todos).toEqual([]);
    expect(snap.recentActivity).toEqual([]);
    expect(snap.recentFinalImages).toEqual([]);
    expect(snap.liveListings).toEqual([]);
  });

  it('counts candidates / products / jobs / listings by status', () => {
    store.create<DiscoverCandidateRecord>('discover_candidates', {
      research_id: 'r', keyword: 'k', market: 'US', product_name: 'A', category: 'c', status: 'ready',
    });
    store.create<DiscoverCandidateRecord>('discover_candidates', {
      research_id: 'r', keyword: 'k', market: 'US', product_name: 'B', category: 'c', status: 'promoted',
    });
    store.create<DiscoverCandidateRecord>('discover_candidates', {
      research_id: 'r', keyword: 'k', market: 'US', product_name: 'C', category: 'c', status: 'failed',
    });

    const i1 = store.create<ProductInputRecord>('product_inputs', {
      title: 'P1', main_image_path: '', status: 'ready',
    });
    const i2 = store.create<ProductInputRecord>('product_inputs', {
      title: 'P2', main_image_path: '/tmp/x.png', status: 'ready',
    });
    void i2;

    const job = store.create<ImageJobRecord>('image_jobs', {
      input_id: (i1 as { id: string }).id,
      status: 'completed',
      stage: 'qc',
      progress: 100,
    });
    store.create<ImageJobRecord>('image_jobs', {
      input_id: (i1 as { id: string }).id,
      status: 'cutting',
      stage: 'cutting',
      progress: 30,
    });
    store.create<ImageJobRecord>('image_jobs', {
      input_id: (i1 as { id: string }).id,
      status: 'failed',
      stage: 'cutting',
      progress: 30,
      failure_reason: 'TEST: oops',
    });

    store.create<ImageOutputRecord>('image_outputs', {
      job_id: (job as { id: string }).id,
      input_id: (i1 as { id: string }).id,
      kind: 'final',
      image_path: '/tmp/final-1.png',
      is_winner: true,
    });

    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: (i1 as { id: string }).id, platform: 'amazon-us', language: 'en', status: 'ready',
    });
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: (i1 as { id: string }).id, platform: 'tiktok-shop-us', language: 'en', status: 'live',
      live_url: 'https://shop.tiktok.com/foo',
      live_at: '2026-05-09T08:00:00Z',
    });
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: (i1 as { id: string }).id, platform: 'etsy', language: 'en', status: 'rejected',
      rejection_reason: 'TEST: rejected',
    });

    const snap = buildDashboard(store);
    expect(snap.counts.candidates).toEqual({ total: 3, ready: 1, promoted: 1, failed: 1 });
    expect(snap.counts.products.total).toBe(2);
    expect(snap.counts.products.needsMain).toBe(1);
    expect(snap.counts.products.hasFinal).toBe(1);
    expect(snap.counts.jobs).toEqual({ total: 3, running: 1, completed: 1, failed: 1 });
    expect(snap.counts.listings).toEqual({
      total: 3, ready: 1, submitted: 0, live: 1, rejected: 1,
    });
    expect(snap.recentFinalImages).toHaveLength(1);
    expect(snap.liveListings).toHaveLength(1);
    expect(snap.liveListings[0].liveUrl).toBe('https://shop.tiktok.com/foo');
  });

  it('produces priority-sorted todos (high first)', () => {
    const i = store.create<ProductInputRecord>('product_inputs', {
      title: 'P', main_image_path: '', status: 'ready',
    });
    store.create<DiscoverCandidateRecord>('discover_candidates', {
      research_id: 'r', keyword: 'k', market: 'US', product_name: 'A', category: 'c', status: 'ready',
    });
    store.create<ListingDraftRecord>('listing_drafts', {
      input_id: (i as { id: string }).id, platform: 'amazon-us', language: 'en', status: 'rejected',
      rejection_reason: 'TEST',
    });

    const snap = buildDashboard(store);
    expect(snap.todos.length).toBeGreaterThan(0);
    const priorities = snap.todos.map((t) => t.priority);
    // high should appear before medium
    const firstHigh = priorities.indexOf('high');
    const firstMedium = priorities.indexOf('medium');
    if (firstHigh >= 0 && firstMedium >= 0) {
      expect(firstHigh).toBeLessThan(firstMedium);
    }
    expect(snap.todos.find((t) => t.id === 'upload-main-image')).toBeDefined();
    expect(snap.todos.find((t) => t.id === 'fix-rejected')).toBeDefined();
  });

  it('flags stale listings (drafted before final image)', () => {
    const i = store.create<ProductInputRecord>('product_inputs', {
      title: 'P', main_image_path: '/tmp/x.png', status: 'ready',
    });
    const inputId = (i as { id: string }).id;
    // Draft created at T0
    const draft = store.create<ListingDraftRecord>('listing_drafts', {
      input_id: inputId, platform: 'amazon-us', language: 'en', status: 'ready',
    });
    // Manually set its created_at to a known earlier time to ensure deterministic compare
    store.update<ListingDraftRecord>('listing_drafts', (draft as { id: string }).id, {
      created_at: '2026-05-09T08:00:00Z',
    });
    // Job completed AFTER draft created_at
    store.create<ImageJobRecord>('image_jobs', {
      input_id: inputId,
      status: 'completed',
      stage: 'qc',
      progress: 100,
    });
    // updated_at on jobs is auto-set by storage; force a later timestamp
    const jobs = store.query<ImageJobRecord>('image_jobs', { filter: { input_id: inputId }, limit: 5 });
    store.update<ImageJobRecord>('image_jobs', jobs[0].id, {
      updated_at: '2026-05-09T09:00:00Z',
    });

    const snap = buildDashboard(store);
    const stale = snap.todos.find((t) => t.id === 'redraft-listings');
    expect(stale).toBeDefined();
    expect(stale!.count).toBe(1);
  });

  it('limits recent activity to 15', () => {
    for (let i = 0; i < 30; i++) {
      store.create<ProductInputRecord>('product_inputs', {
        title: `P${i}`,
        main_image_path: '',
        status: 'ready',
      });
    }
    const snap = buildDashboard(store);
    expect(snap.recentActivity.length).toBeLessThanOrEqual(15);
  });

  it('surfaces overdue followups as a high-priority todo', () => {
    const i = store.create<ProductInputRecord>('product_inputs', {
      title: 'P', main_image_path: '/tmp/x.png', status: 'ready',
    });
    const inputId = (i as { id: string }).id;
    const draft = store.create('listing_drafts', {
      input_id: inputId, platform: 'amazon-us', language: 'en',
      status: 'live', title: 't',
    });
    const draftId = (draft as { id: string }).id;
    // overdue followup (due 3 days ago)
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    store.create('listing_followups', {
      draft_id: draftId, input_id: inputId,
      template_id: 'check-first-order', title: 'D+1', due_at: past,
      status: 'pending',
    });
    // upcoming followup (due tomorrow) — also counts as "due" by status filter only
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    store.create('listing_followups', {
      draft_id: draftId, input_id: inputId,
      template_id: 'check-search-rank', title: 'D+3', due_at: tomorrow,
      status: 'pending',
    });
    // done followup (must NOT count)
    store.create('listing_followups', {
      draft_id: draftId, input_id: inputId,
      template_id: 'check-first-review', title: 'D+7', due_at: past,
      status: 'done',
    });

    const snap = buildDashboard(store);
    const todo = snap.todos.find((t) => t.id === 'followups-due');
    expect(todo).toBeDefined();
    expect(todo!.priority).toBe('high'); // because there's an overdue
    expect(todo!.text).toContain('已逾期');
    // count should reflect 1 due (past) — upcoming isn't counted
    expect(todo!.count).toBe(1);
  });
});
