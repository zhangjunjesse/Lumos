import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import {
  compareCandidates,
  DiscoverCompareError,
  DEFAULT_WEIGHT,
} from '../discover-compare';
import { createCandidate } from '../storage';

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

describe('compareCandidates', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
    fakeStructured.mockReset();
  });
  afterEach(() => db.close());

  function seed(id_seed: string, scores: { d: number; c: number; p: number }) {
    return createCandidate(store, {
      research_id: 'r1',
      keyword: id_seed,
      market: 'US',
      product_name: id_seed,
      category: 'cat',
      score_demand: scores.d,
      score_competition: scores.c,
      score_profit: scores.p,
      score_compliance: 80,
      score_logistics: 70,
      status: 'ready',
    });
  }

  it('rejects fewer than 2 candidates', async () => {
    const c = seed('A', { d: 80, c: 60, p: 70 });
    await expect(compareCandidates(store, [c.id])).rejects.toBeInstanceOf(
      DiscoverCompareError,
    );
  });

  it('rejects more than 6 candidates', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(seed(`P${i}`, { d: 50, c: 50, p: 50 }).id);
    await expect(compareCandidates(store, ids)).rejects.toBeInstanceOf(
      DiscoverCompareError,
    );
  });

  it('rejects unknown candidate ids', async () => {
    const a = seed('A', { d: 80, c: 60, p: 70 });
    await expect(compareCandidates(store, [a.id, 'nope'])).rejects.toBeInstanceOf(
      DiscoverCompareError,
    );
  });

  it('returns LLM recommendation with weighted scores per candidate', async () => {
    const a = seed('A', { d: 90, c: 50, p: 70 });
    const b = seed('B', { d: 60, c: 80, p: 80 });
    fakeStructured.mockResolvedValueOnce({
      recommended_id: b.id,
      recommendation_summary: 'B has stronger blue-ocean and margin posture for this user.',
      pairwise_notes: [
        { id: a.id, verdict: 'second-pick', reason: 'higher demand but more saturated.' },
        { id: b.id, verdict: 'recommended', reason: 'better margin/competition combo.' },
      ],
      next_actions: [
        'Verify B\'s top-3 Amazon competitors review counts',
        'Check 1688 MOQ for B',
      ],
    });

    const out = await compareCandidates(store, [a.id, b.id]);
    expect(out.recommendedId).toBe(b.id);
    expect(out.notes).toHaveLength(2);
    expect(out.nextActions).toHaveLength(2);
    // weighted score should be deterministic and non-negative
    const wA = out.weighted.find((x) => x.id === a.id);
    const wB = out.weighted.find((x) => x.id === b.id);
    expect(wA).toBeDefined();
    expect(wB).toBeDefined();
    expect(wA!.weightedScore).toBeGreaterThan(0);
    expect(wB!.weightedScore).toBeGreaterThan(0);
  });

  it('throws when LLM recommends an id outside the input set (defensive)', async () => {
    const a = seed('A', { d: 80, c: 60, p: 70 });
    const b = seed('B', { d: 60, c: 80, p: 80 });
    fakeStructured.mockResolvedValueOnce({
      recommended_id: 'hallucinated_id',
      recommendation_summary: 'x',
      pairwise_notes: [{ id: a.id, verdict: 'recommended', reason: 'x' }],
      next_actions: [],
    });
    await expect(compareCandidates(store, [a.id, b.id])).rejects.toBeInstanceOf(
      DiscoverCompareError,
    );
  });

  it('respects custom weights for the deterministic weightedScore', async () => {
    const a = seed('A', { d: 100, c: 0, p: 50 });
    const b = seed('B', { d: 0, c: 100, p: 50 });
    fakeStructured.mockResolvedValueOnce({
      recommended_id: a.id,
      recommendation_summary: 's',
      pairwise_notes: [
        { id: a.id, verdict: 'recommended', reason: 's' },
        { id: b.id, verdict: 'second-pick', reason: 's' },
      ],
      next_actions: [],
    });
    // weight all on demand → A should dominate
    const out = await compareCandidates(store, [a.id, b.id], {
      weight: { ...DEFAULT_WEIGHT, demand: 1, competition: 0, profit: 0, compliance: 0, logistics: 0 },
    });
    const wA = out.weighted.find((x) => x.id === a.id)!.weightedScore;
    const wB = out.weighted.find((x) => x.id === b.id)!.weightedScore;
    expect(wA).toBeGreaterThan(wB);
  });
});
