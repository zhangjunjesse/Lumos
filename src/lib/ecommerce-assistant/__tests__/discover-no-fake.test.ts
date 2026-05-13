/**
 * Locks in the policy: when ALL configured platforms fail to return live
 * samples, runDiscoverResearch MUST throw DiscoverNoLiveDataError instead of
 * falling back to model-only candidate fabrication.
 *
 * Background: pre-22 the system would silently let the LLM invent product
 * names / prices / specs from training knowledge — those candidates looked
 * plausible but didn't exist on the marketplace, misleading the user.
 */

import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import {
  runDiscoverResearch,
  DiscoverNoLiveDataError,
  DiscoverResearchError,
} from '../discover';
import type { DiscoverCandidateRecord } from '../types';

const APP_ID = 'ecommerce-assistant';

// fake the LLM so we don't need a real provider
const fakeStructured = jest.fn<unknown, unknown[]>();
jest.mock('../llm-client', () => ({
  generateStructured: (...args: unknown[]) => fakeStructured(...args),
  EcommerceLlmUnavailableError: class extends Error {},
}));

// fake generateImages so promote-time concept generation never hits a provider
jest.mock('@/lib/image', () => ({
  generateImages: jest.fn(),
}));

// stub fetchSearchSamples so we control the live-fetch outcome per test
const fakeFetchSamples = jest.fn();
jest.mock('../web-research', () => {
  const actual = jest.requireActual('../web-research');
  return {
    ...actual,
    fetchSearchSamples: (...args: unknown[]) => fakeFetchSamples(...args),
  };
});

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

describe('runDiscoverResearch — no-fake-data policy', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
    fakeStructured.mockReset();
    fakeFetchSamples.mockReset();
  });
  afterEach(() => db.close());

  it('throws DiscoverNoLiveDataError when ALL platforms fail to fetch samples', async () => {
    fakeFetchSamples.mockResolvedValue({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=mug',
      samples: [],
      warning: 'HTTP 503',
      fetchedAt: '2026-05-10T08:00:00Z',
    });

    await expect(
      runDiscoverResearch(store, {
        keyword: 'travel mug',
        market: 'US',
        platformFocus: ['amazon-us'],
      }),
    ).rejects.toBeInstanceOf(DiscoverNoLiveDataError);

    // LLM was NEVER called → no model-fabricated candidates
    expect(fakeStructured).not.toHaveBeenCalled();

    // placeholder candidate cleaned up — no stuck "researching" rows
    const stuck = store.query<DiscoverCandidateRecord>('discover_candidates', {
      filter: { status: 'researching' },
      limit: 10,
    });
    expect(stuck).toHaveLength(0);
  });

  it('error message guides the user toward concrete remediation', async () => {
    fakeFetchSamples.mockResolvedValue({
      source: 'amazon-us',
      url: 'https://www.amazon.com/s?k=x',
      samples: [],
      warning: 'HTTP 503',
      fetchedAt: '2026-05-10T08:00:00Z',
    });
    try {
      await runDiscoverResearch(store, {
        keyword: 'x',
        market: 'US',
        platformFocus: ['amazon-us'],
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DiscoverNoLiveDataError);
      const message = (err as Error).message;
      expect(message).toContain('VPN');
      expect(message).toContain('反爬');
      expect(message).toContain('amazon-us: HTTP 503');
      expect((err as DiscoverNoLiveDataError).attempts[0].source).toBe('amazon-us');
    }
  });

  it('proceeds when at least one platform returns usable samples', async () => {
    // Two platforms targeted: one fails, one succeeds → we should proceed.
    fakeFetchSamples
      .mockResolvedValueOnce({
        source: 'amazon-us',
        url: 'https://www.amazon.com/s?k=mug',
        samples: [],
        warning: 'HTTP 503',
        fetchedAt: '2026-05-10T08:00:00Z',
      })
      .mockResolvedValueOnce({
        source: 'etsy',
        url: 'https://www.etsy.com/search?q=mug',
        samples: [
          {
            title: 'Handmade Travel Mug',
            price: '$29',
            rating: '4.8',
            reviews: '512',
            url: 'https://www.etsy.com/listing/123/handmade-travel-mug',
          },
        ],
        details: [
          {
            source: 'etsy',
            rank: 1,
            title: 'Handmade Travel Mug',
            price: '$29',
            rating: '4.8',
            reviews: '512',
            brand: 'Studio Cup',
            availability: 'In stock',
            bulletPoints: ['handmade ceramic', 'ergonomic grip'],
            description: 'A real detail page extraction.',
            imageUrl: 'https://i.etsystatic.com/mug.jpg',
            url: 'https://www.etsy.com/listing/123/handmade-travel-mug',
            fetchedAt: '2026-05-10T08:00:01Z',
            fetchedVia: 'server-fetch',
          },
        ],
        fetchedAt: '2026-05-10T08:00:00Z',
      });

    fakeStructured.mockResolvedValueOnce({
      candidates: [
        {
          product_name: 'Differentiated Handmade Travel Mug',
          category: 'kitchen-drinkware',
          score_demand: 70,
          score_competition: 60,
          score_profit: 65,
          score_compliance: 90,
          score_logistics: 75,
          summary: 'vs Handmade Travel Mug, this candidate adds ergonomic grip',
          selling_points: ['ergonomic grip'],
          risks: ['handmade variability'],
          differentiation: 'address the ergonomic gap in sample #1',
          reference_urls: [
            { platform: 'Etsy', url: 'https://www.etsy.com/search?q=ergonomic+travel+mug' },
            { platform: 'Amazon US', url: 'https://www.amazon.com/s?k=ergonomic+travel+mug' },
          ],
          source_search_urls: [
            { platform: '1688', url: 'https://s.1688.com/selloffer/offer_search.htm?keywords=mug' },
          ],
        },
      ],
    });

    const out = await runDiscoverResearch(store, {
      keyword: 'mug',
      market: 'US',
      platformFocus: ['amazon-us', 'etsy'],
    });

    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].score_total).toBe(68);
    expect(fakeStructured).toHaveBeenCalledTimes(1);
    // sources should record both the success AND the failure for audit
    const sources = JSON.parse(out.candidates[0].sources ?? '[]') as Array<{
      kind: string;
      source: string;
      details?: Array<{ title: string; url: string }>;
      id?: string;
      weights?: Record<string, number>;
    }>;
    const kinds = sources.map((s) => s.kind).sort();
    expect(kinds).toContain('live-fetch');
    expect(kinds).toContain('live-fetch-failed');
    expect(kinds).toContain('selection-strategy');
    expect(sources.find((s) => s.kind === 'live-fetch')?.details?.[0]).toMatchObject({
      title: 'Handmade Travel Mug',
      url: 'https://www.etsy.com/listing/123/handmade-travel-mug',
    });
    expect(sources.find((s) => s.kind === 'selection-strategy')).toMatchObject({
      id: 'blue-ocean',
      weights: expect.objectContaining({ competition: 0.4 }),
    });
  });

  it('passes the requested sample count to marketplace collection without changing candidate count', async () => {
    fakeFetchSamples.mockResolvedValueOnce({
      source: 'etsy',
      url: 'https://www.etsy.com/search?q=mug',
      samples: [
        {
          title: 'Handmade Travel Mug',
          price: '$29',
          url: 'https://www.etsy.com/listing/123/handmade-travel-mug',
        },
      ],
      details: [],
      fetchedAt: '2026-05-10T08:00:00Z',
    });
    fakeStructured.mockResolvedValueOnce({
      candidates: [
        {
          product_name: '便携手工马克杯',
          category: '杯具',
          score_demand: 70,
          score_competition: 60,
          score_profit: 65,
          score_compliance: 90,
          score_logistics: 75,
          summary: '基于 Handmade Travel Mug 做便携场景差异化。',
          selling_points: ['便携场景'],
          risks: ['供应稳定性待验证'],
          differentiation: '竞品问题 -> 手柄普通 -> 我们方案 -> 便携握持 -> 为什么可能卖 -> 礼品场景 -> 先验证',
          reference_urls: [
            { platform: 'Etsy', url: 'https://www.etsy.com/search?q=ergonomic+travel+mug' },
            { platform: 'Amazon US', url: 'https://www.amazon.com/s?k=ergonomic+travel+mug' },
          ],
          source_search_urls: [
            { platform: '1688', url: 'https://s.1688.com/selloffer/offer_search.htm?keywords=mug' },
          ],
        },
      ],
    });

    await runDiscoverResearch(store, {
      keyword: 'mug',
      market: 'US',
      platformFocus: ['etsy'],
      count: 3,
      sampleCount: 18,
    });

    expect(fakeFetchSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'etsy',
        maxSamples: 18,
      }),
    );
    const prompt = String((fakeStructured.mock.calls[0][0] as { prompt?: unknown }).prompt);
    expect(prompt).toContain('Suggest 3 concrete cross-border e-commerce product candidates.');
  });

  it('accepts URL strings in candidate reference fields and stores them as clickable objects', async () => {
    fakeFetchSamples.mockResolvedValueOnce({
      source: 'etsy',
      url: 'https://www.etsy.com/search?q=mug',
      samples: [
        {
          title: 'Handmade Travel Mug',
          price: '$29',
          url: 'https://www.etsy.com/listing/123/handmade-travel-mug',
        },
      ],
      details: [],
      fetchedAt: '2026-05-10T08:00:00Z',
    });
    fakeStructured.mockResolvedValueOnce({
      candidates: [
        {
          product_name: '便携手工马克杯',
          category: '杯具',
          score_demand: 70,
          score_competition: 60,
          score_profit: 65,
          score_compliance: 90,
          score_logistics: 75,
          summary: '基于 Handmade Travel Mug 做便携场景差异化。',
          selling_points: ['便携场景'],
          risks: ['供应稳定性待验证'],
          differentiation: '竞品问题 -> 手柄普通 -> 我们方案 -> 便携握持 -> 为什么可能卖 -> 礼品场景 -> 先验证',
          reference_urls: [
            'https://www.etsy.com/search?q=ergonomic+travel+mug',
            'https://www.amazon.com/s?k=ergonomic+travel+mug',
          ],
          source_search_urls: [
            'https://s.1688.com/selloffer/offer_search.htm?keywords=mug',
          ],
        },
      ],
    });

    const out = await runDiscoverResearch(store, {
      keyword: 'mug',
      market: 'US',
      platformFocus: ['etsy'],
    });

    const refs = JSON.parse(out.candidates[0].reference_urls ?? '[]') as Array<{ platform: string; url: string }>;
    const sourcing = JSON.parse(out.candidates[0].source_search_urls ?? '[]') as Array<{ platform: string; url: string }>;
    expect(refs[0]).toEqual({
      platform: 'Etsy',
      url: 'https://www.etsy.com/search?q=ergonomic+travel+mug',
    });
    expect(refs[1]).toEqual({
      platform: 'Amazon',
      url: 'https://www.amazon.com/s?k=ergonomic+travel+mug',
    });
    expect(sourcing[0]).toEqual({
      platform: '1688',
      url: 'https://s.1688.com/selloffer/offer_search.htm?keywords=mug',
    });
  });

  it('keeps collected sample evidence visible when candidate generation fails', async () => {
    fakeFetchSamples.mockResolvedValueOnce({
      source: 'etsy',
      url: 'https://www.etsy.com/search?q=mug',
      samples: [
        {
          title: 'Handmade Travel Mug',
          price: '$29',
          url: 'https://www.etsy.com/listing/123/handmade-travel-mug',
          imageUrl: 'https://i.etsystatic.com/mug.jpg',
        },
      ],
      details: [
        {
          source: 'etsy',
          rank: 1,
          title: 'Handmade Travel Mug',
          price: '$29',
          url: 'https://www.etsy.com/listing/123/handmade-travel-mug',
          bulletPoints: ['handmade ceramic'],
          fetchedAt: '2026-05-10T08:00:01Z',
          fetchedVia: 'server-fetch',
        },
      ],
      fetchedAt: '2026-05-10T08:00:00Z',
    });
    fakeStructured.mockRejectedValueOnce(new Error('候选结构化输出格式错误'));

    await expect(
      runDiscoverResearch(store, {
        keyword: 'mug',
        market: 'US',
        platformFocus: ['etsy'],
      }),
    ).rejects.toBeInstanceOf(DiscoverResearchError);

    const rows = store.query<DiscoverCandidateRecord>('discover_candidates', {
      filter: { status: 'failed' },
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    const sources = JSON.parse(rows[0].sources ?? '[]') as Array<{
      kind: string;
      samples?: Array<{ title: string; image_url?: string }>;
      details?: Array<{ title: string; bullet_points?: string[] }>;
    }>;
    const liveFetch = sources.find((source) => source.kind === 'live-fetch');
    expect(liveFetch?.samples?.[0]).toMatchObject({
      title: 'Handmade Travel Mug',
      image_url: 'https://i.etsystatic.com/mug.jpg',
    });
    expect(liveFetch?.details?.[0]).toMatchObject({
      title: 'Handmade Travel Mug',
      bullet_points: ['handmade ceramic'],
    });
  });

  it('throws DiscoverNoLiveDataError when no platforms have a fetcher', async () => {
    // shopee is in our discover platform options but NOT in buildPlatformSearchUrl,
    // so the fetcher target list is empty → all-failed by definition.
    await expect(
      runDiscoverResearch(store, {
        keyword: 'x',
        market: 'SG',
        platformFocus: ['shopee'],
      }),
    ).rejects.toBeInstanceOf(DiscoverNoLiveDataError);
    expect(fakeStructured).not.toHaveBeenCalled();
  });

  it('DiscoverNoLiveDataError is also a DiscoverResearchError (catch-all compat)', async () => {
    fakeFetchSamples.mockResolvedValue({
      source: 'amazon-us',
      url: 'https://x',
      samples: [],
      warning: 'x',
      fetchedAt: '2026-05-10T08:00:00Z',
    });
    await expect(
      runDiscoverResearch(store, {
        keyword: 'x',
        market: 'US',
        platformFocus: ['amazon-us'],
      }),
    ).rejects.toBeInstanceOf(DiscoverResearchError);
  });
});
