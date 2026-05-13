import Database from 'better-sqlite3';

import {
  COLLECTION_KEYWORDS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import { ingestKeywordVideos } from '../keyword-ingest';

let _db: Database.Database | null = null;

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getDouyinCollectorStore: () => buildStore(),
  };
});

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

function renderHtml(awemeId: string, title = '测试视频') {
  const data = {
    videoInfoRes: {
      item_list: [
        {
          aweme_id: awemeId,
          desc: title,
          duration: 60_000,
          video: { duration: 60_000 },
          author: { nickname: 'A', sec_uid: 'sec' },
        },
      ],
    },
  };
  return `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(
    JSON.stringify(data),
  )}</script>`;
}

describe('ingestKeywordVideos', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects when keyword does not exist', async () => {
    const r = await ingestKeywordVideos('does-not-exist', ['anything']);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/关键词记录/);
  });

  it('returns 0 processed when no valid inputs', async () => {
    const store = buildStore();
    const k = store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'manual',
      enabled: true,
    });
    const r = await ingestKeywordVideos(k.id, ['', '   ']);
    expect(r.processed).toBe(0);
  });

  it('on success: creates videos tagged with the keyword query', async () => {
    const store = buildStore();
    const k = store.create(COLLECTION_KEYWORDS, {
      query: 'Claude API',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'manual',
      enabled: true,
    });
    const A = '7000000000000000001';
    const B = '7000000000000000002';
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(renderHtml(A, 'V1'), { status: 200 }))
      .mockResolvedValueOnce(new Response(renderHtml(B, 'V2'), { status: 200 })) as unknown as typeof globalThis.fetch;

    const r = await ingestKeywordVideos(k.id, [
      `https://www.douyin.com/video/${A}`,
      `https://www.douyin.com/video/${B}`,
    ]);
    expect(r.ok).toBe(true);
    expect(r.processed).toBe(2);
    expect(r.succeeded).toBe(2);

    const videos = store.query<{ aweme_id?: string; tags?: string }>(COLLECTION_VIDEOS);
    expect(videos).toHaveLength(2);
    for (const v of videos) {
      const tags = JSON.parse(v.tags ?? '[]');
      expect(tags).toContain('Claude API');
    }

    const updated = store.get<{ last_checked_at?: string }>(COLLECTION_KEYWORDS, k.id);
    expect(updated?.last_checked_at).toBeTruthy();
  });

  it('merges keyword tag into existing tags without duplicating', async () => {
    const store = buildStore();
    const k = store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'manual',
      enabled: true,
    });
    const A = '7000000000000000001';
    // Pre-existing video with one tag.
    store.create(COLLECTION_VIDEOS, {
      aweme_id: A,
      tags: JSON.stringify(['existing', 'AI']),
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(renderHtml(A), { status: 200 })) as unknown as typeof globalThis.fetch;

    await ingestKeywordVideos(k.id, [`https://www.douyin.com/video/${A}`]);

    const videos = store.query<{ tags?: string }>(COLLECTION_VIDEOS);
    expect(videos).toHaveLength(1); // upserted, not duplicated
    const tags = JSON.parse(videos[0].tags ?? '[]');
    // Both existing tag and AI must remain; AI must not appear twice.
    expect(tags).toContain('existing');
    expect(tags.filter((t: string) => t.toLowerCase() === 'ai')).toHaveLength(1);
  });

  it('clears last_failure_reason on successful ingest (Round 151)', async () => {
    // A keyword whose auto-patrol previously failed carries
    // last_failure_reason. Manual ingest succeeds
    // → the row should not keep showing the stale red reason.
    const store = buildStore();
    const k = store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'manual',
      enabled: true,
      last_failure_reason: '关键词搜索页未出现视频 ID。',
    });
    const A = '7000000000000000001';
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(renderHtml(A), { status: 200 })) as unknown as typeof globalThis.fetch;

    const r = await ingestKeywordVideos(k.id, [`https://www.douyin.com/video/${A}`]);
    expect(r.ok).toBe(true);

    const updated = store.get<{ last_failure_reason?: string | null }>(
      COLLECTION_KEYWORDS,
      k.id,
    );
    expect(updated?.last_failure_reason).toBeNull();
  });

  it('preserves last_failure_reason when ingest produces zero successes', async () => {
    // If the manual ingest doesn't recover anything, leave the prior
    // failure reason as-is; the user should still see *why* patrol
    // failed last time. Only successes supersede the failure label.
    const store = buildStore();
    const k = store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'manual',
      enabled: true,
      last_failure_reason: 'patrol-stub-error',
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;

    await ingestKeywordVideos(k.id, ['https://www.douyin.com/video/7000000000000000099']);

    const updated = store.get<{ last_failure_reason?: string | null }>(
      COLLECTION_KEYWORDS,
      k.id,
    );
    expect(updated?.last_failure_reason).toBe('patrol-stub-error');
  });

  it('aggregates failures honestly when fetch fails', async () => {
    const store = buildStore();
    const k = store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      time_window: 'week',
      dedupe_window_days: 30,
      cadence: 'manual',
      enabled: true,
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;

    const r = await ingestKeywordVideos(k.id, ['https://www.douyin.com/video/7000000000000000099']);
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
