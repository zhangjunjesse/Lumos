import Database from 'better-sqlite3';

import {
  COLLECTION_CREATORS,
  COLLECTION_JOBS,
  COLLECTION_KEYWORDS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import {
  patrolEnabledCreators,
  patrolEnabledKeywords,
  shouldRunByCadence,
} from '../patrol';

let _db: Database.Database | null = null;

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getDouyinCollectorStore: () => buildStore(),
    // Override list* helpers so they don't capture the original
    // getDouyinCollectorStore via closure — pass our test store instead.
    listCreators: () => actual.listCreators(buildStore()),
    listKeywords: () => actual.listKeywords(buildStore()),
    listJobs: () => actual.listJobs(buildStore()),
  };
});

// Round 87: patrol now pre-probes the cookie. Stub it out for the
// existing patrol assertions — the cookie-probe module has its own
// dedicated test file.
jest.mock('../cookie-probe', () => ({
  runScheduledCookieProbe: jest.fn().mockResolvedValue('skipped'),
}));

jest.mock('../settings', () => ({
  getDouyinCollectorSettings: () => ({
    cookie: '',
    cookieCheckedAt: null,
    cookieLastOkAt: null,
    transcribePrefer: 'allow-asr',
    longVideoSplitMinutes: 10,
    transcribeConcurrency: 3,
    libraryCollectionId: null,
    autoPublish: false,
    autoSummarize: false,
    autoTranscribe: false,
    aiSummaryPrompt: '',
    aiChaptersPrompt: '',
    aiTagsPrompt: '',
    riskNote: '',
  }),
  markCookieOk: jest.fn(),
}));

function buildStore(): AppDataStore {
  if (!_db) throw new Error('test db not initialised');
  return createAppDataStore(_db, DOUYIN_COLLECTOR_APP_ID);
}

beforeEach(() => {
  _db = new Database(':memory:');
  _db.exec(`
    CREATE TABLE lumos_app_data (
      app_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, collection, id)
    );
  `);
});

describe('patrolEnabledCreators', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('skips when there are no enabled creators', async () => {
    const r = await patrolEnabledCreators();
    expect(r.ok).toBe(true);
    expect(r.processed).toBe(0);
    expect(r.message).toMatch(/没有启用|跳过/);
  });

  it('only includes enabled creators (skips disabled)', async () => {
    const store = buildStore();
    store.create(COLLECTION_CREATORS, {
      nickname: 'enabled',
      sec_uid: 'MS4xxx-enabled',
      cadence: 'daily',
      enabled: true,
    });
    store.create(COLLECTION_CREATORS, {
      nickname: 'paused',
      sec_uid: 'MS4xxx-paused',
      cadence: 'daily',
      enabled: false,
    });
    // Force the scrape fetch to fail so we don't need real network.
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;

    const r = await patrolEnabledCreators();
    expect(r.processed).toBe(1);
    expect(r.failed).toBe(1);
    // Verify only one job was created (for the enabled creator).
    const jobs = store.query<{ status?: string; target_ref?: string }>(COLLECTION_JOBS);
    expect(jobs).toHaveLength(1);
  });

  it('aggregates multiple successes when scrapes succeed', async () => {
    const store = buildStore();
    store.create(COLLECTION_CREATORS, {
      nickname: 'A',
      sec_uid: 'MS4xxx-A',
      cadence: 'daily',
      enabled: true,
    });
    store.create(COLLECTION_CREATORS, {
      nickname: 'B',
      sec_uid: 'MS4xxx-B',
      cadence: 'daily',
      enabled: true,
    });

    function renderHtml(awemeId: string) {
      const data = { videoList: [{ aweme_id: awemeId, desc: 't', author: {}, video: {} }] };
      return `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(
        JSON.stringify(data),
      )}</script>`;
    }
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(renderHtml('aw-A'), { status: 200 }))
      .mockResolvedValueOnce(new Response(renderHtml('aw-B'), { status: 200 })) as unknown as typeof globalThis.fetch;

    const r = await patrolEnabledCreators();
    expect(r.processed).toBe(2);
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(0);
    // Each creator contributed a distinct video.
    const videos = store.query<{ aweme_id?: string }>(COLLECTION_VIDEOS);
    expect(videos.map((v) => v.aweme_id).sort()).toEqual(['aw-A', 'aw-B']);
  });
});

describe('shouldRunByCadence', () => {
  const now = new Date('2026-01-15T12:00:00Z');

  it('returns true when never checked', () => {
    expect(shouldRunByCadence('daily', null, now)).toBe(true);
    expect(shouldRunByCadence('hourly', undefined, now)).toBe(true);
  });

  it('returns false for manual cadence regardless of timing', () => {
    expect(shouldRunByCadence('manual', null, now)).toBe(false);
    expect(shouldRunByCadence('manual', '2020-01-01T00:00:00Z', now)).toBe(false);
  });

  it('respects daily window: same day = false, prior day = true', () => {
    expect(shouldRunByCadence('daily', '2026-01-15T08:00:00Z', now)).toBe(false);
    expect(shouldRunByCadence('daily', '2026-01-14T11:00:00Z', now)).toBe(true);
  });

  it('respects weekly window: <7d = false, >=7d = true', () => {
    expect(shouldRunByCadence('weekly', '2026-01-12T12:00:00Z', now)).toBe(false);
    expect(shouldRunByCadence('weekly', '2026-01-08T11:00:00Z', now)).toBe(true);
  });
});

describe('patrolEnabledCreators — cadence skipping', () => {
  it('skips creators that are not due (within cadence window)', async () => {
    const store = buildStore();
    // Just-checked creator (within 1 hour, daily cadence) should skip.
    store.create(COLLECTION_CREATORS, {
      nickname: 'recent',
      sec_uid: 'sec-recent',
      cadence: 'daily',
      enabled: true,
      last_checked_at: new Date(Date.now() - 60_000).toISOString(),
    });
    // Old creator (last seen 2 days ago) is due.
    store.create(COLLECTION_CREATORS, {
      nickname: 'due',
      sec_uid: 'sec-due',
      cadence: 'daily',
      enabled: true,
      last_checked_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;

    const r = await patrolEnabledCreators();
    expect(r.processed).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.message).toContain('跳过 1');
  });

  it('short-circuits remaining creators after a fatal failure (e.g. HTTP 401) — saves API budget', async () => {
    const store = buildStore();
    for (let i = 0; i < 5; i++) {
      store.create(COLLECTION_CREATORS, {
        nickname: `c${i}`,
        sec_uid: `MS4xxx-${i}`,
        cadence: 'daily',
        enabled: true,
      });
    }
    // First fetch returns 401 (fatal). With short-circuit, no further
    // fetches happen for the remaining 4 creators.
    const fetchSpy = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 401 })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    const r = await patrolEnabledCreators();
    expect(r.processed).toBe(5);
    expect((fetchSpy as jest.Mock).mock.calls.length).toBe(1);
    expect(r.message).toContain('短路');
    // 4 jobs marked failed via "已跳过" reason
    expect(r.failed).toBe(5);
  });

  it('reports all-skipped when nothing is due', async () => {
    const store = buildStore();
    store.create(COLLECTION_CREATORS, {
      nickname: 'recent',
      sec_uid: 'sec-recent',
      cadence: 'daily',
      enabled: true,
      last_checked_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const r = await patrolEnabledCreators();
    expect(r.processed).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.message).toMatch(/cadence 间隔/);
  });
});

describe('patrolEnabledKeywords', () => {
  it('skips when there are no enabled keywords', async () => {
    const r = await patrolEnabledKeywords();
    expect(r.ok).toBe(true);
    expect(r.processed).toBe(0);
  });

  it('skips keywords whose cadence is `manual` (opt-out of automation)', async () => {
    const store = buildStore();
    store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'manual',
      enabled: true,
    });
    const r = await patrolEnabledKeywords();
    expect(r.processed).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('keyword patrol falls back to manual-ingest guidance when bridge unavailable (single-word)', async () => {
    // Round 169: keyword path goes through BrowserManager (Round 167
    // architecture). In tests there's no bridge, so the function
    // short-circuits with "测试环境短路". Patrol still surfaces the
    // failure with the user-actionable "manual ingest" pointer.
    const store = buildStore();
    store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'daily',
      enabled: true,
    });
    const r = await patrolEnabledKeywords();
    expect(r.processed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.reasons[0]).toMatch(/手动 ingest/);
  });

  it('keyword patrol falls back the same way for multi-word queries (Round 169)', async () => {
    const store = buildStore();
    store.create(COLLECTION_KEYWORDS, {
      query: 'Claude API 实战',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'daily',
      enabled: true,
    });
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const r = await patrolEnabledKeywords();
    expect(r.failed).toBe(1);
    expect(r.reasons[0]).toMatch(/手动 ingest/);
    expect(fetchSpy).not.toHaveBeenCalled(); // browser short-circuited test path
  });
});
