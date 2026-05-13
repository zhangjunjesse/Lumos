import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { listFollowups, seedFollowupsForListing } from '../listing-followup';
import type { ListingDraftRecord, ListingFollowupRecord } from '../types';

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

describe('seedFollowupsForListing', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;
  const goLive = new Date('2026-05-10T00:00:00Z');

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });
  afterEach(() => db.close());

  function fakeDraft(over: Partial<ListingDraftRecord> = {}): ListingDraftRecord & { id: string } {
    return {
      id: 'draft-1',
      input_id: 'input-1',
      platform: 'amazon-us',
      language: 'en',
      status: 'live',
      ...over,
    } as ListingDraftRecord & { id: string };
  }

  it('seeds the standard 7 templates for amazon (incl. ad-budget + bsr)', () => {
    seedFollowupsForListing(store, fakeDraft(), goLive);
    const items = listFollowups(store, { draft_id: 'draft-1' });
    expect(items.length).toBeGreaterThanOrEqual(6); // ≥ 6 universal + 1 amazon-only
    const ids = items.map((i) => i.template_id).sort();
    expect(ids).toContain('check-first-order');
    expect(ids).toContain('set-ad-budget'); // amazon-eligible
    expect(ids).toContain('check-bsr-week'); // amazon-eligible
    expect(ids).toContain('review-week-summary');
  });

  it('skips ad-budget for etsy (template platform restriction)', () => {
    seedFollowupsForListing(store, fakeDraft({ platform: 'etsy' }), goLive);
    const items = listFollowups(store, { draft_id: 'draft-1' });
    const ids = items.map((i) => i.template_id);
    expect(ids).not.toContain('set-ad-budget');
    // universal templates should still seed
    expect(ids).toContain('check-first-order');
  });

  it('computes due_at = goLive + offsetDays', () => {
    seedFollowupsForListing(store, fakeDraft(), goLive);
    const items = listFollowups(store, { draft_id: 'draft-1' });
    const d1 = items.find((i) => i.template_id === 'check-first-order');
    expect(d1?.due_at).toBe('2026-05-11T00:00:00.000Z'); // +1 day
    const d7 = items.find((i) => i.template_id === 'review-week-summary');
    expect(d7?.due_at).toBe('2026-05-17T00:00:00.000Z'); // +7 days
  });

  it('is idempotent — re-seeding does not duplicate', () => {
    seedFollowupsForListing(store, fakeDraft(), goLive);
    const before = listFollowups(store, { draft_id: 'draft-1' }).length;
    const result = seedFollowupsForListing(store, fakeDraft(), goLive);
    const after = listFollowups(store, { draft_id: 'draft-1' }).length;
    expect(result.created).toBe(0);
    expect(after).toBe(before);
  });

  it('seeds with status=pending and ordered by due_at ascending', () => {
    seedFollowupsForListing(store, fakeDraft(), goLive);
    const items = listFollowups(store, { draft_id: 'draft-1' });
    expect(items.every((i) => i.status === 'pending')).toBe(true);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].due_at >= items[i - 1].due_at).toBe(true);
    }
  });

  it('listFollowups can filter by status', () => {
    seedFollowupsForListing(store, fakeDraft(), goLive);
    const items = listFollowups(store, { draft_id: 'draft-1' });
    store.update<ListingFollowupRecord>('listing_followups', items[0].id, { status: 'done' });
    const pending = listFollowups(store, { draft_id: 'draft-1', status: 'pending' });
    expect(pending.length).toBe(items.length - 1);
  });
});
