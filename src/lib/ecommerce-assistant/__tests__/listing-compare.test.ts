import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import { compareListings, ListingCompareError } from '../listing-compare';
import { createListingDraft } from '../storage';

const APP_ID = 'ecommerce-assistant';

const fakeStructured = jest.fn<unknown, unknown[]>();
jest.mock('../llm-client', () => ({
  generateStructured: (...args: unknown[]) => fakeStructured(...args),
  EcommerceLlmUnavailableError: class extends Error {},
}));

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

describe('compareListings', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
    fakeStructured.mockReset();
  });
  afterEach(() => db.close());

  function seed(platform: string, lang: string, title: string) {
    return createListingDraft(store, {
      input_id: 'i1',
      platform: platform as never,
      language: lang,
      title,
      bullets: JSON.stringify(['b1', 'b2', 'b3']),
      description: 'd',
      search_keywords: JSON.stringify(['k1', 'k2']),
      warnings: JSON.stringify([]),
      status: 'ready',
    });
  }

  it('rejects fewer than 2 drafts', async () => {
    const a = seed('amazon-us', 'en', 'A');
    await expect(compareListings(store, [a.id])).rejects.toBeInstanceOf(ListingCompareError);
  });

  it('rejects more than 5 drafts', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(seed('amazon-us', 'en', `D${i}`).id);
    await expect(compareListings(store, ids)).rejects.toBeInstanceOf(ListingCompareError);
  });

  it('rejects unknown ids', async () => {
    const a = seed('amazon-us', 'en', 'A');
    await expect(compareListings(store, [a.id, 'nope'])).rejects.toBeInstanceOf(
      ListingCompareError,
    );
  });

  it('rejects when any draft is in drafting/failed status', async () => {
    const a = seed('amazon-us', 'en', 'A');
    const b = createListingDraft(store, {
      input_id: 'i1', platform: 'tiktok-shop-us', language: 'en',
      title: 'B', status: 'drafting',
    });
    await expect(compareListings(store, [a.id, b.id])).rejects.toBeInstanceOf(
      ListingCompareError,
    );
  });

  it('returns LLM evaluation with verdict per draft', async () => {
    const a = seed('amazon-us', 'en', 'A draft');
    const b = seed('tiktok-shop-us', 'en', 'B draft');
    fakeStructured.mockResolvedValueOnce({
      evaluations: [
        {
          id: a.id, score_seo: 80, score_conversion: 70, score_compliance: 90, score_total: 78,
          verdict: 'recommended',
          strengths: ['title leads with main keyword'],
          weaknesses: [],
        },
        {
          id: b.id, score_seo: 60, score_conversion: 75, score_compliance: 85, score_total: 70,
          verdict: 'second-pick',
          strengths: ['hook strong'],
          weaknesses: ['title too long for TT'],
        },
      ],
      recommended_id: a.id,
      recommendation_summary: 'A is more SEO-aligned for Amazon; B is better for TT but cap miss.',
      cross_cutting_issues: ['Both drafts miss "leak-proof" keyword.'],
    });

    const out = await compareListings(store, [a.id, b.id]);
    expect(out.recommendedId).toBe(a.id);
    expect(out.evaluations).toHaveLength(2);
    expect(out.evaluations[0].verdict).toBe('recommended');
    expect(out.crossCuttingIssues).toHaveLength(1);
  });

  it('throws when LLM recommends an id outside the input set (defensive)', async () => {
    const a = seed('amazon-us', 'en', 'A');
    const b = seed('tiktok-shop-us', 'en', 'B');
    fakeStructured.mockResolvedValueOnce({
      evaluations: [
        { id: a.id, score_seo: 50, score_conversion: 50, score_compliance: 50, score_total: 50,
          verdict: 'recommended', strengths: [], weaknesses: [] },
      ],
      recommended_id: 'hallucinated_id',
      recommendation_summary: 'x',
      cross_cutting_issues: [],
    });
    await expect(compareListings(store, [a.id, b.id])).rejects.toBeInstanceOf(
      ListingCompareError,
    );
  });
});
