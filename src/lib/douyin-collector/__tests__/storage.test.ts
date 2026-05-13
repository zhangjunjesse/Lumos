import Database from 'better-sqlite3';

import {
  COLLECTION_JOBS,
  COLLECTION_KEYWORDS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import {
  cascadeDeleteVideoChildren,
  countLibraryBacklog,
  countLibraryStatus,
  countQueue,
  findRelatedVideos,
  findTranscriptSnippets,
  findVideoIdsByTranscriptContent,
  getLastPublishedAt,
  matchesBacklog,
  statsByCreator,
  statsByKeyword,
  summarizeRecentActivity,
  topTags,
} from '../storage';

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

describe('countLibraryStatus', () => {
  it('returns zero counts for empty store', () => {
    const store = buildStore();
    const r = countLibraryStatus(store);
    expect(r).toEqual({ videos: 0, unprocessed: 0, drafts: 0, published: 0, discarded: 0 });
  });

  it('counts each status bucket distinctly', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, { aweme_id: 'a1', library_status: 'draft' });
    store.create(COLLECTION_VIDEOS, { aweme_id: 'a2', library_status: 'draft' });
    store.create(COLLECTION_VIDEOS, { aweme_id: 'a3', library_status: 'published' });
    store.create(COLLECTION_VIDEOS, { aweme_id: 'a4', library_status: 'unprocessed' });
    store.create(COLLECTION_VIDEOS, { aweme_id: 'a5', library_status: 'discarded' });
    expect(countLibraryStatus(store)).toEqual({
      videos: 5,
      unprocessed: 1,
      drafts: 2,
      published: 1,
      discarded: 1,
    });
  });
});

describe('countQueue', () => {
  it('reports zero queue and null lastRunFailure on empty store', () => {
    const store = buildStore();
    const r = countQueue(store);
    expect(r.runningJobs).toBe(0);
    expect(r.pendingJobs).toBe(0);
    expect(r.lastRunFailure).toBeNull();
    expect(r.lastRunAt).toBeNull();
  });

  it('surfaces a run_history failure when it is more recent than the last collect_job failure', () => {
    const store = buildStore();
    store.create(COLLECTION_JOBS, {
      kind: 'creator',
      target_ref: 'c1',
      status: 'failed',
      failure_reason: 'job-old-error',
      updated_at: '2025-01-01T00:00:00Z',
    });
    store.create('run_history', {
      title: 'AI 摘要',
      status: 'failed',
      failure_reason: 'llm-rate-limited',
      updated_at: '2025-01-05T00:00:00Z',
    });
    const r = countQueue(store);
    expect(r.lastRunFailure).toBe('llm-rate-limited');
  });

  it('falls back to collect_jobs failure when only it has failures', () => {
    const store = buildStore();
    store.create(COLLECTION_JOBS, {
      kind: 'creator',
      target_ref: 'c1',
      status: 'failed',
      failure_reason: 'cookie-expired',
      updated_at: '2025-01-01T00:00:00Z',
    });
    expect(countQueue(store).lastRunFailure).toBe('cookie-expired');
  });

  it('keeps lastPatrolAt anchored to collect_jobs only, ignoring run_history', () => {
    // Round 149: a manual transcribe (run_history) MUST NOT reset the
    // patrol-stale timer that lives on collect_jobs. Otherwise a broken
    // patrol cadence goes unflagged just because someone hand-ran a
    // transcribe.
    const store = buildStore();
    store.create(COLLECTION_JOBS, {
      kind: 'creator',
      target_ref: 'c1',
      status: 'success',
      updated_at: '2025-01-01T00:00:00Z',
    });
    store.create('run_history', {
      title: '手动转写',
      status: 'success',
      updated_at: '2025-01-08T00:00:00Z', // a week later
    });
    const r = countQueue(store);
    expect(r.lastRunAt).toBe('2025-01-08T00:00:00Z'); // latest event
    expect(r.lastPatrolAt).toBe('2025-01-01T00:00:00Z'); // patrol-only
  });

  it('clears lastRunFailure when a successful run is newer than the latest failure', () => {
    // Round 147: pre-fix, any historical failure stuck on Hero forever.
    // Post-fix: only the chronologically-latest run's status matters.
    const store = buildStore();
    store.create(COLLECTION_JOBS, {
      kind: 'creator',
      target_ref: 'c1',
      status: 'failed',
      failure_reason: 'hashtag-401',
      updated_at: '2025-01-01T00:00:00Z',
    });
    store.create(COLLECTION_JOBS, {
      kind: 'creator',
      target_ref: 'c1',
      status: 'success',
      updated_at: '2025-01-02T00:00:00Z',
    });
    expect(countQueue(store).lastRunFailure).toBeNull();
  });

  it('clears lastRunFailure when a successful run_history entry is newer than the latest failure', () => {
    const store = buildStore();
    store.create('run_history', {
      title: 'AI 摘要',
      status: 'failed',
      failure_reason: 'llm-rate-limited',
      updated_at: '2025-01-01T00:00:00Z',
    });
    store.create('run_history', {
      title: 'AI 摘要',
      status: 'success',
      updated_at: '2025-01-02T00:00:00Z',
    });
    expect(countQueue(store).lastRunFailure).toBeNull();
  });

  it('counts running and queued jobs and surfaces the most recent failure reason', () => {
    const store = buildStore();
    store.create(COLLECTION_JOBS, {
      kind: 'creator',
      target_ref: 'c1',
      status: 'queued',
      updated_at: '2025-01-01T00:00:00Z',
    });
    store.create(COLLECTION_JOBS, {
      kind: 'creator',
      target_ref: 'c2',
      status: 'running',
      updated_at: '2025-01-01T00:01:00Z',
    });
    store.create(COLLECTION_JOBS, {
      kind: 'keyword',
      target_ref: 'k1',
      status: 'failed',
      failure_reason: 'cookie expired',
      updated_at: '2025-01-02T00:00:00Z',
    });
    store.create(COLLECTION_JOBS, {
      kind: 'keyword',
      target_ref: 'k2',
      status: 'failed',
      failure_reason: 'rate limited',
      updated_at: '2025-01-03T00:00:00Z',
    });
    const r = countQueue(store);
    expect(r.runningJobs).toBe(1);
    expect(r.pendingJobs).toBe(1);
    expect(r.lastRunFailure).toBe('rate limited');
    expect(r.lastRunAt).toBe('2025-01-03T00:00:00Z');
  });
});

describe('statsByCreator', () => {
  it('returns an empty map when no videos exist', () => {
    const r = statsByCreator(buildStore());
    expect(r.size).toBe(0);
  });

  it('counts collected / transcribed / published per creator_ref, ignoring videos with no creator_ref', () => {
    const store = buildStore();
    // Creator A: 2 collected, 1 transcribed, 1 published
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      creator_ref: 'sec-A',
      transcript_status: 'success',
      library_status: 'published',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      creator_ref: 'sec-A',
      transcript_status: 'pending',
      library_status: 'unprocessed',
    });
    // Creator B: 1 collected
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'b1',
      creator_ref: 'sec-B',
    });
    // Orphan video — should not count
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'c1',
      creator_ref: null,
    });

    const r = statsByCreator(store);
    expect(r.size).toBe(2);
    expect(r.get('sec-A')).toEqual({
      creatorRef: 'sec-A',
      collected: 2,
      transcribed: 1,
      published: 1,
    });
    expect(r.get('sec-B')).toEqual({
      creatorRef: 'sec-B',
      collected: 1,
      transcribed: 0,
      published: 0,
    });
  });
});

describe('statsByKeyword', () => {
  it('returns an empty map when no keywords exist', () => {
    const r = statsByKeyword(buildStore());
    expect(r.size).toBe(0);
  });

  it('counts videos whose tags contain the keyword query (case-insensitive, dedup per video)', () => {
    const store = buildStore();
    store.create(COLLECTION_KEYWORDS, {
      query: 'Claude API',
      cadence: 'manual',
      enabled: true,
    });
    store.create(COLLECTION_KEYWORDS, {
      query: 'AI 工具',
      cadence: 'manual',
      enabled: true,
    });
    // Video 1: tagged with both keywords (lowercase variant)
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      tags: JSON.stringify(['claude api', 'AI 工具']),
      transcript_status: 'success',
      library_status: 'published',
    });
    // Video 2: only "AI 工具"
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      tags: JSON.stringify(['ai 工具']),
      transcript_status: 'pending',
    });
    // Video 3: tag duplicated — must only count once toward the keyword
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a3',
      tags: JSON.stringify(['Claude API', 'CLAUDE API']),
      transcript_status: 'success',
      library_status: 'draft',
    });

    const r = statsByKeyword(store);
    expect(r.size).toBe(2);
    expect(r.get('claude api')).toEqual({
      query: 'Claude API',
      collected: 2,
      transcribed: 2,
      published: 1,
    });
    expect(r.get('ai 工具')).toEqual({
      query: 'AI 工具',
      collected: 2,
      transcribed: 1,
      published: 1,
    });
  });

  it('ignores untagged videos and tags that do not match any keyword', () => {
    const store = buildStore();
    store.create(COLLECTION_KEYWORDS, {
      query: 'AI',
      cadence: 'manual',
      enabled: true,
    });
    store.create(COLLECTION_VIDEOS, { aweme_id: 'a1', tags: JSON.stringify(['random']) });
    store.create(COLLECTION_VIDEOS, { aweme_id: 'a2' });
    const r = statsByKeyword(store);
    expect(r.get('ai')).toEqual({ query: 'AI', collected: 0, transcribed: 0, published: 0 });
  });
});

describe('findRelatedVideos', () => {
  it('returns empty when target has no tags', () => {
    const store = buildStore();
    const target = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      title: 'no tags',
      tags: null,
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      title: 'has tags',
      tags: JSON.stringify(['ai']),
    });
    expect(findRelatedVideos(target.id, 5, store)).toEqual([]);
  });

  it('orders by tag overlap descending', () => {
    const store = buildStore();
    const target = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a',
      title: 'target',
      tags: JSON.stringify(['ai', 'api', 'rust']),
    });
    const high = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'b',
      title: '3 overlap',
      tags: JSON.stringify(['ai', 'api', 'rust']),
    });
    const mid = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'c',
      title: '2 overlap',
      tags: JSON.stringify(['ai', 'api', 'go']),
    });
    const low = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'd',
      title: '1 overlap',
      tags: JSON.stringify(['ai', 'go']),
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'e',
      title: '0 overlap',
      tags: JSON.stringify(['go', 'web']),
    });
    const r = findRelatedVideos(target.id, 5, store);
    expect(r.map((v) => v.id)).toEqual([high.id, mid.id, low.id]);
    expect(r[0].overlap).toBe(3);
    expect(r[1].overlap).toBe(2);
    expect(r[2].overlap).toBe(1);
  });

  it('excludes the target video itself', () => {
    const store = buildStore();
    const target = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a',
      title: 'target',
      tags: JSON.stringify(['ai']),
    });
    expect(findRelatedVideos(target.id, 5, store)).toEqual([]);
  });

  it('excludes discarded videos even if tags overlap', () => {
    const store = buildStore();
    const target = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a',
      title: 'target',
      tags: JSON.stringify(['ai']),
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'b',
      title: 'dropped',
      tags: JSON.stringify(['ai']),
      library_status: 'discarded',
    });
    expect(findRelatedVideos(target.id, 5, store)).toEqual([]);
  });

  it('case-insensitive tag matching', () => {
    const store = buildStore();
    const target = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a',
      tags: JSON.stringify(['AI', 'API']),
    });
    const peer = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'b',
      tags: JSON.stringify(['ai', 'api']),
    });
    const r = findRelatedVideos(target.id, 5, store);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(peer.id);
    expect(r[0].overlap).toBe(2);
  });
});

describe('topTags', () => {
  it('returns empty when no videos exist', () => {
    expect(topTags(5, buildStore())).toEqual([]);
  });

  it('counts each video at most once per case-insensitive tag, sorted by count desc', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      tags: JSON.stringify(['ai', 'api']),
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      tags: JSON.stringify(['AI', 'rust']),
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a3',
      tags: JSON.stringify(['ai', 'API', 'API']), // dup within same video → still 1
    });
    const r = topTags(10, store);
    const map = Object.fromEntries(r.map((i) => [i.tag.toLowerCase(), i.count]));
    expect(map.ai).toBe(3);
    expect(map.api).toBe(2);
    expect(map.rust).toBe(1);
    expect(r[0].tag.toLowerCase()).toBe('ai');
  });

  it('excludes discarded videos', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      tags: JSON.stringify(['ai']),
      library_status: 'unprocessed',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      tags: JSON.stringify(['ai']),
      library_status: 'discarded',
    });
    const r = topTags(5, store);
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(1);
  });

  it('respects the limit', () => {
    const store = buildStore();
    for (let i = 0; i < 10; i++) {
      store.create(COLLECTION_VIDEOS, {
        aweme_id: `a${i}`,
        tags: JSON.stringify([`tag-${i}`]),
      });
    }
    expect(topTags(3, store)).toHaveLength(3);
  });
});

describe('countLibraryBacklog', () => {
  it('returns all-zero counts on empty store', () => {
    const store = buildStore();
    expect(countLibraryBacklog(store)).toEqual({
      transcribePending: 0,
      transcribeFailed: 0,
      publishReady: 0,
      recent7d: 0,
      starred: 0,
    });
  });

  it('classifies videos into the backlog buckets honestly', () => {
    const store = buildStore();
    const now = new Date('2026-05-10T12:00:00Z');
    const recentISO = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const oldISO = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();

    // 1. 待抓字幕：unprocessed, no transcript, recent
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000001',
      library_status: 'unprocessed',
      transcript_status: 'pending',
      created_at: recentISO,
    });
    // 2. 可入库：transcribed, no app-level summary required, recent
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000002',
      library_status: 'unprocessed',
      transcript_status: 'success',
      summary: '',
      created_at: recentISO,
    });
    // 3. 可入库：transcribed, draft
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000003',
      library_status: 'draft',
      transcript_status: 'success',
      summary: 'a summary',
      created_at: oldISO, // not recent
    });
    // 4. 已入库：should NOT count toward publish-ready
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000004',
      library_status: 'published',
      transcript_status: 'success',
      summary: 'b',
      created_at: oldISO,
    });
    // 5. 丢弃：should NOT count toward transcribe-pending or publish-ready
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000005',
      library_status: 'discarded',
      transcript_status: 'pending',
      created_at: recentISO,
    });

    const r = countLibraryBacklog(store, now);
    expect(r.transcribePending).toBe(1); // only video 1; video 5 is discarded
    expect(r.transcribeFailed).toBe(0);
    expect(r.publishReady).toBe(2); // videos 2 and 3
    expect(r.recent7d).toBe(3); // videos 1, 2, 5 are recent
    expect(r.starred).toBe(0); // none starred
  });

  it('transcribeFailed counts videos with transcript_status=failed (excluding discarded)', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000050',
      transcript_status: 'failed',
      library_status: 'unprocessed',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000051',
      transcript_status: 'failed',
      library_status: 'discarded', // user already discarded — don't double-surface
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000052',
      transcript_status: 'pending', // not failed — counts toward transcribePending only
      library_status: 'unprocessed',
    });
    const r = countLibraryBacklog(store);
    expect(r.transcribeFailed).toBe(1);
    // Round 164: failed videos no longer count under transcribePending.
    // Pre-fix the chips double-counted ("1 待抓字幕" + "1 抓字幕失败"
    // for the same row). Now: pending = "not yet attempted or in-flight".
    expect(r.transcribePending).toBe(1); // only the explicitly-pending row
  });

  it('counts starred videos regardless of other state', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000010',
      starred: true,
      library_status: 'published',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000011',
      starred: true,
      library_status: 'discarded', // 丢弃 + 加星 仍然算（用户主动加星，不要静默吞掉）
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000012',
      starred: false,
    });
    const r = countLibraryBacklog(store);
    expect(r.starred).toBe(2);
  });
});

describe('matchesBacklog', () => {
  const now = new Date('2026-05-10T12:00:00Z');
  it('mirrors countLibraryBacklog predicates exactly', () => {
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();

    // transcribePending
    expect(
      matchesBacklog(
        { library_status: 'unprocessed', transcript_status: 'pending', created_at: recent },
        'transcribePending',
        now,
      ),
    ).toBe(true);
    expect(
      matchesBacklog(
        { library_status: 'discarded', transcript_status: 'pending', created_at: recent },
        'transcribePending',
        now,
      ),
    ).toBe(false);

    // publishReady excludes already-published
    expect(
      matchesBacklog(
        { library_status: 'published', transcript_status: 'success', summary: 'x' },
        'publishReady',
        now,
      ),
    ).toBe(false);
    expect(
      matchesBacklog(
        { library_status: 'draft', transcript_status: 'success', summary: 'x' },
        'publishReady',
        now,
      ),
    ).toBe(true);

    // recent7d boundary
    expect(matchesBacklog({ created_at: recent }, 'recent7d', now)).toBe(true);
    expect(matchesBacklog({ created_at: old }, 'recent7d', now)).toBe(false);
    expect(matchesBacklog({}, 'recent7d', now)).toBe(false);

    // starred is the only backlog key driven by an explicit user action, not derived state
    expect(matchesBacklog({ starred: true }, 'starred', now)).toBe(true);
    expect(matchesBacklog({ starred: false }, 'starred', now)).toBe(false);
    expect(matchesBacklog({}, 'starred', now)).toBe(false); // missing == falsy

    // transcribeFailed: only when status=failed AND not discarded
    expect(
      matchesBacklog({ transcript_status: 'failed', library_status: 'unprocessed' }, 'transcribeFailed', now),
    ).toBe(true);
    expect(
      matchesBacklog({ transcript_status: 'failed', library_status: 'discarded' }, 'transcribeFailed', now),
    ).toBe(false);
    expect(
      matchesBacklog({ transcript_status: 'pending', library_status: 'unprocessed' }, 'transcribeFailed', now),
    ).toBe(false);
  });
});

describe('findVideoIdsByTranscriptContent', () => {
  it('returns empty set when query is too short — guards against scanning everything', () => {
    const store = buildStore();
    store.create('transcripts', {
      video_ref: 'v1',
      segments: JSON.stringify([{ text: 'hello' }]),
    });
    expect(findVideoIdsByTranscriptContent('', store).size).toBe(0);
    expect(findVideoIdsByTranscriptContent(' ', store).size).toBe(0);
    expect(findVideoIdsByTranscriptContent('a', store).size).toBe(0);
  });

  it('matches videos whose transcript contains the query (case-insensitive)', () => {
    const store = buildStore();
    store.create('transcripts', {
      video_ref: 'v1',
      segments: JSON.stringify([
        { text: '今天聊聊 Prompt Caching 的工作原理' },
        { text: '大模型的 KV cache 怎么命中' },
      ]),
    });
    store.create('transcripts', {
      video_ref: 'v2',
      segments: JSON.stringify([{ text: '介绍一下闲鱼上的二手交易技巧' }]),
    });
    store.create('transcripts', {
      video_ref: 'v3',
      segments: JSON.stringify([{ text: 'Some KV related discussion in English' }]),
    });

    const r1 = findVideoIdsByTranscriptContent('prompt caching', store);
    expect(r1.has('v1')).toBe(true);
    expect(r1.has('v2')).toBe(false);
    expect(r1.has('v3')).toBe(false);

    // Case-insensitive
    const r2 = findVideoIdsByTranscriptContent('KV', store);
    expect(r2.has('v1')).toBe(true);
    expect(r2.has('v3')).toBe(true);

    // Chinese substring
    const r3 = findVideoIdsByTranscriptContent('闲鱼', store);
    expect(r3.has('v2')).toBe(true);
    expect(r3.size).toBe(1);
  });

  it('skips transcripts without a video_ref', () => {
    const store = buildStore();
    store.create('transcripts', {
      segments: JSON.stringify([{ text: 'orphaned transcript' }]),
    });
    expect(findVideoIdsByTranscriptContent('orphaned', store).size).toBe(0);
  });

  it('returns empty set when no transcripts exist', () => {
    const store = buildStore();
    expect(findVideoIdsByTranscriptContent('anything', store).size).toBe(0);
  });
});

describe('findTranscriptSnippets', () => {
  it('returns empty map when query is too short', () => {
    const store = buildStore();
    store.create('transcripts', {
      video_ref: 'v1',
      segments: JSON.stringify([{ text: 'hello world' }]),
    });
    expect(findTranscriptSnippets('a', store).size).toBe(0);
  });

  it('returns the snippet centered on the first hit, with ellipsis on truncated sides', () => {
    const store = buildStore();
    const longLeft = '前缀文字'.repeat(50); // 200 chars of context before
    const hit = '关键内容';
    const longRight = '后缀文字'.repeat(50);
    store.create('transcripts', {
      video_ref: 'v1',
      segments: JSON.stringify([{ text: longLeft + hit + longRight }]),
    });

    const r = findTranscriptSnippets('关键内容', store);
    const s = r.get('v1');
    expect(s).toBeDefined();
    expect(s).toContain('关键内容');
    // Both sides truncated → both ellipses
    expect(s!.startsWith('…')).toBe(true);
    expect(s!.endsWith('…')).toBe(true);
  });

  it('omits leading ellipsis when the hit is near the start, trailing when near the end', () => {
    const store = buildStore();
    store.create('transcripts', {
      video_ref: 'v-start',
      segments: JSON.stringify([{ text: '关键 在最前面 后面有一些其他内容补足长度让搜索结果有意义' }]),
    });
    store.create('transcripts', {
      video_ref: 'v-end',
      segments: JSON.stringify([{ text: '前面有许多铺垫内容然后才出现 关键' }]),
    });
    const r = findTranscriptSnippets('关键', store);
    expect(r.get('v-start')!.startsWith('…')).toBe(false);
    expect(r.get('v-end')!.endsWith('…')).toBe(false);
  });

  it('preserves original casing in the snippet (only matching is case-insensitive)', () => {
    const store = buildStore();
    store.create('transcripts', {
      video_ref: 'v1',
      segments: JSON.stringify([
        { text: 'Today we discuss Prompt Caching at length' },
      ]),
    });
    const r = findTranscriptSnippets('prompt caching', store);
    expect(r.get('v1')).toContain('Prompt Caching'); // original casing
    expect(r.get('v1')).not.toContain('prompt caching');
  });

  it('only stores the FIRST hit per video — does not blow up the map', () => {
    const store = buildStore();
    store.create('transcripts', {
      video_ref: 'v1',
      segments: JSON.stringify([
        { text: '关键 第一次' },
        { text: '关键 第二次' },
      ]),
    });
    const r = findTranscriptSnippets('关键', store);
    expect(r.size).toBe(1);
    expect(r.get('v1')).toContain('第一次');
  });
});

describe('summarizeRecentActivity', () => {
  const now = new Date('2026-05-10T12:00:00Z');
  const insideWindow = new Date(now.getTime() - 6 * 60 * 60_000).toISOString(); // 6h ago
  const outsideWindow = new Date(now.getTime() - 30 * 60 * 60_000).toISOString(); // 30h ago

  it('returns all-zero digest on empty store', () => {
    const r = summarizeRecentActivity(now, 24, buildStore());
    expect(r.newVideos).toBe(0);
    expect(r.uniqueCreators).toBe(0);
    expect(r.publishedInWindow).toBe(0);
    expect(r.starredInWindow).toBe(0);
    expect(r.failedRuns).toBe(0);
    expect(r.newTags).toEqual([]);
    expect(r.windowHours).toBe(24);
  });

  it('counts videos created within the window; ignores older ones', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000001',
      creator_ref: 'sec-A',
      created_at: insideWindow,
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000002',
      creator_ref: 'sec-A',
      created_at: insideWindow,
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000003',
      creator_ref: 'sec-B',
      created_at: outsideWindow, // outside
    });
    const r = summarizeRecentActivity(now, 24, store);
    expect(r.newVideos).toBe(2);
    expect(r.uniqueCreators).toBe(1);
  });

  it('counts publishedInWindow / starredInWindow by updated_at', () => {
    const store = buildStore();
    // published recently
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000010',
      library_status: 'published',
      created_at: outsideWindow,
      updated_at: insideWindow,
    });
    // published but updated long ago — shouldn't count
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000011',
      library_status: 'published',
      updated_at: outsideWindow,
    });
    // starred recently
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000012',
      starred: true,
      updated_at: insideWindow,
    });
    const r = summarizeRecentActivity(now, 24, store);
    expect(r.publishedInWindow).toBe(1);
    expect(r.starredInWindow).toBe(1);
  });

  it('"newTags" only includes tags whose earliest sighting is in the window', () => {
    const store = buildStore();
    // Old video uses tag "ai" — anchors "ai" outside the window
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000020',
      tags: '["ai","prompt"]',
      created_at: outsideWindow,
    });
    // New video reintroduces "ai" (already known) AND adds "rate-limit" (new)
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000021',
      tags: '["ai","rate-limit"]',
      created_at: insideWindow,
    });
    const r = summarizeRecentActivity(now, 24, store);
    // "ai" is NOT new (first seen outside window), only "rate-limit" is
    expect(r.newTags).toEqual(['rate-limit']);
  });

  it('counts failed runs within the window only', () => {
    const store = buildStore();
    store.create('run_history', {
      title: 'fail-old',
      status: 'failed',
      updated_at: outsideWindow,
    });
    store.create('run_history', {
      title: 'fail-recent',
      status: 'failed',
      updated_at: insideWindow,
    });
    store.create('run_history', {
      title: 'success-recent',
      status: 'success',
      updated_at: insideWindow,
    });
    const r = summarizeRecentActivity(now, 24, store);
    expect(r.failedRuns).toBe(1);
  });

  it('respects custom windowHours (7d window catches what 24h misses)', () => {
    const store = buildStore();
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60_000).toISOString();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000030',
      created_at: fourDaysAgo,
    });
    expect(summarizeRecentActivity(now, 24, store).newVideos).toBe(0);
    expect(summarizeRecentActivity(now, 24 * 7, store).newVideos).toBe(1);
  });
});

describe('getLastPublishedAt', () => {
  it('returns null when no published video exists', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000400',
      library_status: 'unprocessed',
    });
    expect(getLastPublishedAt(store)).toBeNull();
  });

  it('returns the latest updated_at among published videos', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000401',
      library_status: 'published',
      updated_at: '2026-05-01T10:00:00Z',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000402',
      library_status: 'published',
      updated_at: '2026-05-08T10:00:00Z',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000403',
      library_status: 'draft',
      updated_at: '2026-05-09T10:00:00Z', // newer but not published
    });
    expect(getLastPublishedAt(store)).toBe('2026-05-08T10:00:00Z');
  });

  it('ignores discarded / draft / unprocessed videos', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000404',
      library_status: 'discarded',
      updated_at: '2026-05-10T10:00:00Z',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000405',
      library_status: 'draft',
      updated_at: '2026-05-09T10:00:00Z',
    });
    expect(getLastPublishedAt(store)).toBeNull();
  });
});

describe('cascadeDeleteVideoChildren — Round 155', () => {
  it('deletes transcripts and library_links pointing at the video', () => {
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, { aweme_id: 'v1' });
    store.create('transcripts', { video_ref: v.id, segments: '[]' });
    store.create('transcripts', { video_ref: v.id, segments: '[]' }); // both belong to v
    store.create('library_links', { video_ref: v.id, collection_id: 'col-A' });
    store.create('library_links', { video_ref: v.id, collection_id: 'col-B' });

    const r = cascadeDeleteVideoChildren(v.id, store);
    expect(r.transcripts).toBe(2);
    expect(r.libraryLinks).toBe(2);

    expect(store.query('transcripts')).toHaveLength(0);
    expect(store.query('library_links')).toHaveLength(0);
  });

  it('does not touch transcripts / library_links of other videos', () => {
    const store = buildStore();
    const a = store.create(COLLECTION_VIDEOS, { aweme_id: 'va' });
    const b = store.create(COLLECTION_VIDEOS, { aweme_id: 'vb' });
    store.create('transcripts', { video_ref: a.id, segments: '[]' });
    store.create('transcripts', { video_ref: b.id, segments: '[]' });
    store.create('library_links', { video_ref: a.id, collection_id: 'col' });
    store.create('library_links', { video_ref: b.id, collection_id: 'col' });

    cascadeDeleteVideoChildren(a.id, store);

    const tx = store.query<{ video_ref?: string }>('transcripts');
    const ll = store.query<{ video_ref?: string }>('library_links');
    expect(tx).toHaveLength(1);
    expect(tx[0].video_ref).toBe(b.id);
    expect(ll).toHaveLength(1);
    expect(ll[0].video_ref).toBe(b.id);
  });

  it('returns zeros for a video with no dependents (idempotent)', () => {
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, { aweme_id: 'v-orphan' });
    const r = cascadeDeleteVideoChildren(v.id, store);
    expect(r).toEqual({ transcripts: 0, libraryLinks: 0 });
  });
});
