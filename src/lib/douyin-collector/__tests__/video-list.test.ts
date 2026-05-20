import Database from 'better-sqlite3';

import { DOUYIN_COLLECTOR_APP_ID, COLLECTION_VIDEOS } from '../constants';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

let _db: Database.Database | null = null;

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return { ...actual, getDouyinCollectorStore: () => storeForTests() };
});

import { listCollectedVideos } from '../video-list';

function storeForTests() {
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
  const store = storeForTests();
  store.create(COLLECTION_VIDEOS, {
    aweme_id: '7001', title: '电商SOP拆解', creator_nickname: '墨涵',
    transcript_status: 'success', library_status: 'published',
    duration_seconds: 180, tags: JSON.stringify(['电商', 'SOP']),
    summary: '把流程拆成20道工序', updated_at: '2026-05-16T10:00:00Z',
  });
  store.create(COLLECTION_VIDEOS, {
    aweme_id: '7002', title: '美食测评', creator_nickname: '吃货',
    transcript_status: 'failed', library_status: 'unprocessed',
    duration_seconds: 60, tags: JSON.stringify(['美食']),
    summary: null, updated_at: '2026-05-16T09:00:00Z',
  });
  store.create(COLLECTION_VIDEOS, {
    title: '无 aweme 的视频', creator_nickname: '某人',
    transcript_status: 'success', library_status: 'published',
    updated_at: '2026-05-16T08:00:00Z',
  });
});

describe('listCollectedVideos', () => {
  it('returns compact projection sorted by updated_at desc with synthesized url', () => {
    const r = listCollectedVideos();
    expect(r.total).toBe(3);
    expect(r.returned).toBe(3);
    expect(r.items[0].title).toBe('电商SOP拆解');
    expect(r.items[0].url).toBe('https://www.douyin.com/video/7001');
    expect(r.items[0].tags).toEqual(['电商', 'SOP']);
    // 无 aweme_id → url 为 null（不臆造链接）
    const noAweme = r.items.find((v) => v.title === '无 aweme 的视频')!;
    expect(noAweme.url).toBeNull();
    expect(noAweme.aweme_id).toBeNull();
  });

  it('fuzzy query matches title / creator / summary / tags', () => {
    expect(listCollectedVideos({ query: '墨涵' }).total).toBe(1);
    expect(listCollectedVideos({ query: '工序' }).total).toBe(1); // summary
    expect(listCollectedVideos({ query: 'sop' }).total).toBe(1); // tag, 不区分大小写
    expect(listCollectedVideos({ query: '不存在xyz' }).total).toBe(0);
  });

  it('exact filters: library_status / transcript_status', () => {
    expect(listCollectedVideos({ libraryStatus: 'published' }).total).toBe(2);
    expect(listCollectedVideos({ transcriptStatus: 'failed' }).total).toBe(1);
    expect(
      listCollectedVideos({ libraryStatus: 'published', transcriptStatus: 'success' }).total,
    ).toBe(2);
  });

  it('paginates with total reflecting pre-pagination count; limit capped at 500', () => {
    const p = listCollectedVideos({ limit: 2, offset: 0 });
    expect(p.total).toBe(3);
    expect(p.returned).toBe(2);
    expect(p.items).toHaveLength(2);
    const p2 = listCollectedVideos({ limit: 2, offset: 2 });
    expect(p2.returned).toBe(1);
    expect(listCollectedVideos({ limit: 99999 }).limit).toBe(500);
    expect(listCollectedVideos({ limit: 0 }).limit).toBe(1);
  });
});
