import Database from 'better-sqlite3';

import {
  cancelPendingJobsForTarget,
  createJob,
  findActiveDuplicateJob,
  markJobStatus,
  runJob,
} from '../jobs';
import { DOUYIN_COLLECTOR_APP_ID } from '../constants';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

let _db: Database.Database | null = null;
// jest.mock callbacks are hoisted to file top, so the variables they capture
// must use `var` to be hoisted too. ESLint's no-var rule doesn't understand
// this jest-specific pattern; suppressing for these 3 lines only.
// eslint-disable-next-line no-var
var _dedupeCollect = true;
// eslint-disable-next-line no-var
var mockFetchCreatorAwemesViaBrowser = jest.fn();
// eslint-disable-next-line no-var
var mockFetchVideoMetadataResilient = jest.fn();

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getDouyinCollectorStore: () => storeForTests(),
  };
});

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
    dedupeCollect: _dedupeCollect,
    aiSummaryPrompt: '',
    aiChaptersPrompt: '',
    aiTagsPrompt: '',
    riskNote: '',
    browserContextId: '',
  }),
}));

jest.mock('../creator-browser-scrape', () => {
  const actual = jest.requireActual('../creator-browser-scrape');
  return {
    ...actual,
    fetchCreatorAwemesViaBrowser: (...args: unknown[]) => mockFetchCreatorAwemesViaBrowser(...args),
  };
});

jest.mock('../video-metadata-resilient', () => ({
  fetchVideoMetadataResilient: (...args: unknown[]) => mockFetchVideoMetadataResilient(...args),
}));

// Auto-pipeline calls into transcribe / settings — both pull in DB &
// network. Stub them so jobs tests stay focused on the bookkeeping.
jest.mock('../auto-pipeline', () => ({
  maybeRunAutoPipeline: jest.fn().mockResolvedValue(undefined),
}));

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
  const { maybeRunAutoPipeline } = jest.requireMock('../auto-pipeline') as {
    maybeRunAutoPipeline: jest.Mock;
  };
  maybeRunAutoPipeline.mockReset();
  maybeRunAutoPipeline.mockResolvedValue(undefined);
  _dedupeCollect = true;
  mockFetchCreatorAwemesViaBrowser.mockReset();
  mockFetchCreatorAwemesViaBrowser.mockResolvedValue({ ok: false, reason: '测试环境短路。' });
  mockFetchVideoMetadataResilient.mockReset();
});

describe('createJob', () => {
  it('inserts a queued job with discovered/transcribed counts at zero', () => {
    const job = createJob({ kind: 'creator', targetRef: 'creator-1' });
    expect(job.status).toBe('queued');
    expect(job.kind).toBe('creator');
    expect(job.target_ref).toBe('creator-1');
    expect(job.discovered_count).toBe(0);
    expect(job.transcribed_count).toBe(0);
  });
});

describe('markJobStatus', () => {
  it('transitions queued → running and stamps started_at', () => {
    const job = createJob({ kind: 'creator', targetRef: 'creator-1' });
    const updated = markJobStatus(job.id, { status: 'running' });
    expect(updated?.status).toBe('running');
    expect(updated?.started_at).toBeTruthy();
    expect(updated?.ended_at).toBeFalsy();
  });

  it('on failure stores reason and stamps ended_at', () => {
    const job = createJob({ kind: 'keyword', targetRef: 'kw-1' });
    const updated = markJobStatus(job.id, {
      status: 'failed',
      failureReason: 'cookie expired',
    });
    expect(updated?.status).toBe('failed');
    expect(updated?.failure_reason).toBe('cookie expired');
    expect(updated?.ended_at).toBeTruthy();
  });

  it('returns null for missing job id', () => {
    expect(markJobStatus('does-not-exist', { status: 'cancelled' })).toBeNull();
  });
});

describe('findActiveDuplicateJob', () => {
  it('reuses queued and running duplicate jobs for the same target', () => {
    const queued = createJob({ kind: 'keyword', targetRef: 'kw-1' });
    expect(findActiveDuplicateJob({ kind: 'keyword', targetRef: 'kw-1' })?.id).toBe(queued.id);

    markJobStatus(queued.id, { status: 'running' });
    expect(findActiveDuplicateJob({ kind: 'keyword', targetRef: 'kw-1' })?.id).toBe(queued.id);
  });

  it('does not reuse terminal jobs', () => {
    const job = createJob({ kind: 'keyword', targetRef: 'kw-terminal' });
    markJobStatus(job.id, { status: 'success' });

    expect(findActiveDuplicateJob({ kind: 'keyword', targetRef: 'kw-terminal' })).toBeNull();
  });

  it('can be disabled from settings', () => {
    const job = createJob({ kind: 'link', targetRef: '7321234567890123456' });
    _dedupeCollect = false;

    expect(findActiveDuplicateJob({ kind: 'link', targetRef: job.target_ref })).toBeNull();
  });

  it('separates creator recent/full parameters', () => {
    const full = createJob({
      kind: 'creator',
      targetRef: 'creator-1',
      creatorCollectMode: 'full',
      maxVideos: 300,
    });

    expect(findActiveDuplicateJob({
      kind: 'creator',
      targetRef: 'creator-1',
      creatorCollectMode: 'recent',
      maxVideos: 80,
    })).toBeNull();
    expect(findActiveDuplicateJob({
      kind: 'creator',
      targetRef: 'creator-1',
      creatorCollectMode: 'full',
      maxVideos: 300,
    })?.id).toBe(full.id);
  });

  it('does not reuse jobs with different processing semantics', () => {
    const metadataOnly = createJob({
      kind: 'link',
      targetRef: 'metadata-only',
      autoProcess: false,
    });
    const publishJob = createJob({
      kind: 'link',
      targetRef: 'publish-job',
      publishToKnowledge: true,
    });

    expect(findActiveDuplicateJob({ kind: 'link', targetRef: 'metadata-only' })).toBeNull();
    expect(findActiveDuplicateJob({
      kind: 'link',
      targetRef: 'metadata-only',
      autoProcess: false,
    })?.id).toBe(metadataOnly.id);
    expect(findActiveDuplicateJob({ kind: 'link', targetRef: 'publish-job' })).toBeNull();
    expect(findActiveDuplicateJob({
      kind: 'link',
      targetRef: 'publish-job',
      publishToKnowledge: true,
    })?.id).toBe(publishJob.id);
  });
});

describe('cancelPendingJobsForTarget — Round 152', () => {
  it('cancels queued and running jobs for a target, leaves terminal jobs alone', () => {
    const a = createJob({ kind: 'creator', targetRef: 'cr-1' });
    const b = createJob({ kind: 'creator', targetRef: 'cr-1' });
    const c = createJob({ kind: 'creator', targetRef: 'cr-1' });
    markJobStatus(b.id, { status: 'running' });
    markJobStatus(c.id, { status: 'success' }); // terminal — must NOT be touched

    const count = cancelPendingJobsForTarget('creator', 'cr-1', '父订阅已删除');
    expect(count).toBe(2); // queued (a) + running (b)

    const store = storeForTests();
    const after = store.query<{ id: string; status?: string; failure_reason?: string | null }>(
      'collect_jobs',
    );
    const byId = Object.fromEntries(after.map((r) => [r.id, r] as const));
    expect(byId[a.id].status).toBe('cancelled');
    expect(byId[b.id].status).toBe('cancelled');
    expect(byId[c.id].status).toBe('success'); // unchanged
    expect(byId[a.id].failure_reason).toBe('父订阅已删除');
  });

  it('does not touch jobs for a different target', () => {
    const j1 = createJob({ kind: 'creator', targetRef: 'cr-1' });
    const j2 = createJob({ kind: 'creator', targetRef: 'cr-2' });
    cancelPendingJobsForTarget('creator', 'cr-1');

    const store = storeForTests();
    const r1 = store.get<{ status?: string }>('collect_jobs', j1.id);
    const r2 = store.get<{ status?: string }>('collect_jobs', j2.id);
    expect(r1?.status).toBe('cancelled');
    expect(r2?.status).toBe('queued');
  });

  it('does not cross job kinds (keyword vs creator share id space)', () => {
    // Same id used as targetRef for both kinds — kind filter must isolate.
    const c = createJob({ kind: 'creator', targetRef: 'shared-id' });
    const k = createJob({ kind: 'keyword', targetRef: 'shared-id' });
    cancelPendingJobsForTarget('creator', 'shared-id');

    const store = storeForTests();
    expect(store.get<{ status?: string }>('collect_jobs', c.id)?.status).toBe('cancelled');
    expect(store.get<{ status?: string }>('collect_jobs', k.id)?.status).toBe('queued');
  });

  it('returns 0 when no pending jobs exist (idempotent)', () => {
    const j = createJob({ kind: 'creator', targetRef: 'cr-1' });
    markJobStatus(j.id, { status: 'success' });
    expect(cancelPendingJobsForTarget('creator', 'cr-1')).toBe(0);
  });
});

describe('runJob — creator path (uses scraper)', () => {
  it('fails with a clear reason when the creator record has no sec_uid', async () => {
    // Create a creator row without sec_uid first.
    const store = storeForTests();
    const creator = store.create('creators', {
      nickname: 'unset-uid',
      cadence: 'manual',
      enabled: true,
      sec_uid: null,
    });
    const job = createJob({ kind: 'creator', targetRef: creator.id });
    const after = await runJob(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toMatch(/sec_uid/);
  });

  it('mirrors the failure into run_history so the declarative page and IM /runs see it', async () => {
    const store = storeForTests();
    const creator = store.create('creators', {
      nickname: 'no uid',
      cadence: 'manual',
      enabled: true,
      sec_uid: null,
    });
    const job = createJob({ kind: 'creator', targetRef: creator.id });
    await runJob(job.id);
    const history = store.query<{ status: string; failure_reason?: string; title?: string }>(
      'run_history',
      { orderBy: { field: 'updated_at', direction: 'desc' } },
    );
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].status).toBe('failed');
    expect(history[0].title).toContain('博主');
  });

  it('returns null for missing job', async () => {
    expect(await runJob('does-not-exist')).toBeNull();
  });

  it('does not mark success when browser candidates all belong to other creators', async () => {
    const store = storeForTests();
    const creator = store.create('creators', {
      nickname: '阿球哥',
      cadence: 'manual',
      enabled: true,
      sec_uid: 'target-sec-uid',
    });
    mockFetchCreatorAwemesViaBrowser.mockResolvedValue({
      ok: true,
      awemeIds: ['7629572668472737514'],
    });
    mockFetchVideoMetadataResilient.mockResolvedValue({
      ok: true,
      metadata: {
        awemeId: '7629572668472737514',
        title: '其他博主的视频',
        cover: null,
        duration: 30,
        nativeSubtitleUrls: [],
        playAddrUrls: [],
        authorSecUid: 'other-sec-uid',
        authorNickname: '其他博主',
      },
    });

    const job = createJob({
      kind: 'creator',
      targetRef: creator.id,
      creatorCollectMode: 'full',
      maxVideos: 300,
    });
    const after = await runJob(job.id);

    expect(after?.status).toBe('failed');
    expect(after?.discovered_count).toBe(0);
    expect(after?.failure_reason).toMatch(/没有采到目标博主作品/);
    expect(after?.failure_reason).toMatch(/非该博主/);
    expect(store.query('videos')).toHaveLength(0);
  });

  it('treats deduped existing creator videos as a successful no-new run', async () => {
    const store = storeForTests();
    const creator = store.create('creators', {
      nickname: '阿球哥',
      cadence: 'manual',
      enabled: true,
      sec_uid: 'target-sec-uid',
    });
    store.create('videos', {
      aweme_id: '7629572668472737514',
      creator_ref: 'target-sec-uid',
      title: '已采集视频',
    });
    mockFetchCreatorAwemesViaBrowser.mockResolvedValue({
      ok: true,
      awemeIds: ['7629572668472737514'],
    });

    const job = createJob({
      kind: 'creator',
      targetRef: creator.id,
      autoProcess: false,
      creatorCollectMode: 'full',
      maxVideos: 300,
    });
    const after = await runJob(job.id);

    expect(after?.status).toBe('success');
    expect(after?.discovered_count).toBe(1);
    expect(after?.failure_reason).toBeFalsy();
    expect(mockFetchVideoMetadataResilient).not.toHaveBeenCalled();
  });

  it('skips existing creator videos that already have a successful transcript (patrol-friendly)', async () => {
    const store = storeForTests();
    const creator = store.create('creators', {
      nickname: '阿球哥',
      cadence: 'manual',
      enabled: true,
      sec_uid: 'target-sec-uid',
    });
    store.create('videos', {
      aweme_id: '7629572668472737514',
      creator_ref: 'target-sec-uid',
      title: '已采集视频',
      transcript_status: 'success',
    });
    mockFetchCreatorAwemesViaBrowser.mockResolvedValue({
      ok: true,
      awemeIds: ['7629572668472737514'],
    });

    const job = createJob({
      kind: 'creator',
      targetRef: creator.id,
      autoProcess: true,
      creatorCollectMode: 'full',
      maxVideos: 300,
    });
    const after = await runJob(job.id);

    // 已转写成功的 existing 视频跳过；既不重抓 metadata，也不重跑 pipeline。
    expect(after?.status).toBe('success');
    expect(mockFetchVideoMetadataResilient).not.toHaveBeenCalled();
    const { maybeRunAutoPipeline } = jest.requireMock('../auto-pipeline') as {
      maybeRunAutoPipeline: jest.Mock;
    };
    expect(maybeRunAutoPipeline).not.toHaveBeenCalled();
  });

  it('re-transcribes existing creator videos whose previous transcript failed (UI 「采集」 default)', async () => {
    const { maybeRunAutoPipeline } = jest.requireMock('../auto-pipeline') as {
      maybeRunAutoPipeline: jest.Mock;
    };
    maybeRunAutoPipeline.mockResolvedValue({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      failures: [],
      skipped: false,
      autoSummarize: false,
      autoPublish: false,
      libraryCollectionId: null,
    });
    const store = storeForTests();
    const creator = store.create('creators', {
      nickname: '阿球哥',
      cadence: 'manual',
      enabled: true,
      sec_uid: 'target-sec-uid',
    });
    // 模拟之前一波风控骨架污染的失败视频：标题是占位、play_addr 空、transcript_status=failed
    store.create('videos', {
      aweme_id: '7629572668472737514',
      creator_ref: 'target-sec-uid',
      title: '在抖音记录美好生活',
      native_subtitle_urls: null,
      play_addr_urls: null,
      transcript_status: 'failed',
      library_status: 'discarded',
      failure_reason: '该视频既没有原生字幕，也没有抓到 play_addr URL',
    });
    mockFetchCreatorAwemesViaBrowser.mockResolvedValue({
      ok: true,
      awemeIds: ['7629572668472737514'],
    });
    mockFetchVideoMetadataResilient.mockResolvedValue({
      ok: true,
      metadata: {
        awemeId: '7629572668472737514',
        title: '真正的标题（重抓后）',
        cover: 'https://example.com/cover.jpg',
        duration: 90,
        nativeSubtitleUrls: ['https://example.com/sub.vtt'],
        playAddrUrls: ['https://example.com/play.mp4'],
        authorSecUid: 'target-sec-uid',
        authorNickname: '阿球哥',
      },
    });

    const job = createJob({
      kind: 'creator',
      targetRef: creator.id,
      autoProcess: true,
      publishToKnowledge: true,
      creatorCollectMode: 'full',
      maxVideos: 300,
    });
    const after = await runJob(job.id);

    // 必须重抓 metadata 覆盖污染版
    expect(mockFetchVideoMetadataResilient).toHaveBeenCalledTimes(1);
    const videos = store.query<{
      title?: string;
      transcript_status?: string;
      library_status?: string;
      native_subtitle_urls?: string | null;
    }>('videos');
    expect(videos[0].title).toBe('真正的标题（重抓后）');
    expect(videos[0].native_subtitle_urls).toContain('sub.vtt');
    // transcript_status / library_status 保留（pipeline 才负责改）
    expect(videos[0].transcript_status).toBe('failed');
    expect(videos[0].library_status).toBe('discarded');

    // pipeline 被调用且接收到该视频 id
    expect(maybeRunAutoPipeline).toHaveBeenCalledTimes(1);
    const calledIds = maybeRunAutoPipeline.mock.calls[0]?.[0] as string[];
    expect(calledIds).toHaveLength(1);

    // job 状态：mock 的 pipeline 写 success → runAutoPipelineForJob 写终态 success
    expect(after?.status).toBe('success');
  });
});

describe('runJob — keyword path (Round 169: BrowserManager primary)', () => {
  // As of Round 169 keyword scrape goes through the embedded
  // BrowserManager (same path Round 167 unblocked for creators).
  // In jest there's no real bridge, so fetchKeywordAwemesViaBrowser
  // short-circuits with "测试环境短路" — the failure surface still
  // points the user to manual ingest as the proven workaround.
  it('fails with a clear reason when keyword record is missing', async () => {
    const job = createJob({ kind: 'keyword', targetRef: 'keyword-doesnt-exist' });
    const after = await runJob(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toMatch(/不存在/);
  });

  it('falls back to manual-ingest guidance when browser bridge unavailable (multi-word)', async () => {
    const store = storeForTests();
    const k = store.create('keywords', {
      query: 'Claude API 实战', // has spaces
      cadence: 'manual',
      enabled: true,
    });
    const job = createJob({ kind: 'keyword', targetRef: k.id });
    const after = await runJob(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toMatch(/手动 ingest/);
  });

  it('falls back to manual-ingest guidance when browser bridge unavailable (single-word)', async () => {
    const store = storeForTests();
    const k = store.create('keywords', {
      query: 'prompt-caching',
      cadence: 'manual',
      enabled: true,
    });
    const job = createJob({ kind: 'keyword', targetRef: k.id });
    const after = await runJob(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toMatch(/手动 ingest/);
  });

  it('keyword.last_failure_reason gets stamped on the row (Round 151 contract held)', async () => {
    const store = storeForTests();
    const k = store.create('keywords', {
      query: 'caching',
      cadence: 'manual',
      enabled: true,
    });
    const job = createJob({ kind: 'keyword', targetRef: k.id });
    await runJob(job.id);
    const updated = store.get<{ last_failure_reason?: string }>('keywords', k.id);
    expect(updated?.last_failure_reason).toMatch(/手动 ingest/);
  });
});

describe('runJob — link path (uses scraper)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // link path 已切到 fetchVideoMetadataResilient (anonymous fetch + browser fallbacks)
    // 但 link 测试都假设走 fetchVideoMetadata 经 globalThis.fetch mock。
    // 让 resilient 默认透传到真 fetchVideoMetadata, 保持测试契约不变。
    const { fetchVideoMetadata: realFetch } = jest.requireActual('../scraper');
    mockFetchVideoMetadataResilient.mockImplementation((id: string) => realFetch(id));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects unparseable input with a clear reason and does not call fetch', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const job = createJob({ kind: 'link', targetRef: 'not a url' });
    const after = await runJob(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toMatch(/aweme_id/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('on fetch HTTP failure: stores HTTP error reason, no video record created', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response('', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof globalThis.fetch;
    const job = createJob({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7321234567890123456',
    });
    const after = await runJob(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toMatch(/404|风控|删除/);
    const store = storeForTests();
    expect(store.query('videos')).toHaveLength(0);
  });

  it('re-scraping an existing video preserves transcript_status / summary / library_status — does NOT clobber user work', async () => {
    // Seed a video row that's already been transcribed and summarized.
    const store = storeForTests();
    store.create('videos', {
      aweme_id: '7321234567890123456',
      title: 'old title',
      transcript_status: 'success',
      subtitle_source: 'asr-local',
      summary: 'an existing AI summary',
      tags: '["existing","tag"]',
      chapters: '[{"startSec":0,"title":"existing chapter"}]',
      library_status: 'published',
      library_collection_id: 'kb-1',
      notes: 'user-typed notes',
    });

    const renderData = {
      videoInfoRes: {
        item_list: [
          {
            aweme_id: '7321234567890123456',
            desc: 'NEW title from re-scrape',
            duration: 60000,
            video: { cover: { url_list: ['https://p.douyinpic.com/x.jpeg'] }, duration: 60000 },
            author: { nickname: '博主', sec_uid: 'MS4wLjABAAAA' },
          },
        ],
      },
    };
    const html = `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(
      JSON.stringify(renderData),
    )}</script>`;
    globalThis.fetch = jest
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof globalThis.fetch;

    const job = createJob({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7321234567890123456',
    });
    const after = await runJob(job.id);
    expect(after?.status).toBe('success');

    const videos = store.query<{
      title?: string;
      transcript_status?: string;
      subtitle_source?: string;
      summary?: string;
      tags?: string;
      library_status?: string;
      library_collection_id?: string;
      notes?: string;
    }>('videos');
    expect(videos).toHaveLength(1);
    // Metadata refreshed:
    expect(videos[0].title).toBe('NEW title from re-scrape');
    // Downstream state preserved:
    expect(videos[0].transcript_status).toBe('success');
    expect(videos[0].subtitle_source).toBe('asr-local');
    expect(videos[0].summary).toBe('an existing AI summary');
    expect(videos[0].tags).toContain('existing');
    expect(videos[0].library_status).toBe('published');
    expect(videos[0].library_collection_id).toBe('kb-1');
    expect(videos[0].notes).toBe('user-typed notes');
  });

  it('on successful scrape: creates a video record and marks job success', async () => {
    const renderData = {
      videoInfoRes: {
        item_list: [
          {
            aweme_id: '7321234567890123456',
            desc: '测试标题',
            duration: 1800000,
            video: {
              cover: { url_list: ['https://p.douyinpic.com/x.jpeg'] },
              duration: 1800000,
            },
            author: { nickname: '测试博主', sec_uid: 'MS4wLjABAAAA' },
          },
        ],
      },
    };
    const html = `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(
      JSON.stringify(renderData),
    )}</script>`;
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(html, { status: 200 })) as unknown as typeof globalThis.fetch;
    const job = createJob({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7321234567890123456',
    });
    const after = await runJob(job.id);
    expect(after?.status).toBe('success');
    expect(after?.discovered_count).toBe(1);
    const store = storeForTests();
    const videos = store.query<{ aweme_id?: string; title?: string; duration_seconds?: number; duration_bucket?: string }>(
      'videos',
    );
    expect(videos).toHaveLength(1);
    expect(videos[0].aweme_id).toBe('7321234567890123456');
    expect(videos[0].title).toBe('测试标题');
    expect(videos[0].duration_seconds).toBe(1800);
    expect(videos[0].duration_bucket).toBe('long');
  });

  it('triggers auto-pipeline on new videos and explicit knowledge backfill reruns', async () => {
    const { maybeRunAutoPipeline } = jest.requireMock('../auto-pipeline') as {
      maybeRunAutoPipeline: jest.Mock;
    };
    maybeRunAutoPipeline.mockClear();

    // First run: creates a new video → pipeline called with [id].
    const renderData = {
      videoInfoRes: {
        item_list: [
          {
            aweme_id: '7321234567890123456',
            desc: 't',
            duration: 30000,
            video: { cover: { url_list: ['c'] }, duration: 30000 },
            author: { nickname: 'n', sec_uid: 'MS4wLjABAAAA' },
          },
        ],
      },
    };
    const html = `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(
      JSON.stringify(renderData),
    )}</script>`;
    globalThis.fetch = jest
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof globalThis.fetch;

    const job1 = createJob({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7321234567890123456',
    });
    await runJob(job1.id);
    expect(maybeRunAutoPipeline).toHaveBeenCalledTimes(1);
    const firstArg = (maybeRunAutoPipeline.mock.calls[0]?.[0] as string[]) ?? [];
    expect(firstArg).toHaveLength(1);

    // Second run on the same aweme_id → already exists, no explicit publish
    // request → pipeline NOT called. This keeps patrols from reprocessing all
    // old videos every time.
    const job2 = createJob({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7321234567890123456',
    });
    await runJob(job2.id);
    expect(maybeRunAutoPipeline).toHaveBeenCalledTimes(1);

    // Progress-visible AI/MCP jobs promise "publish to knowledge" by default.
    // If the row already exists but the KB item is missing, rerun the pipeline
    // so the publish step can backfill instead of reporting a fake success.
    const job3 = createJob({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7321234567890123456',
      publishToKnowledge: true,
    });
    await runJob(job3.id);
    expect(maybeRunAutoPipeline).toHaveBeenCalledTimes(2);
  });

  it('updates collect job transcribed_count from the post-collect auto-pipeline result', async () => {
    const { maybeRunAutoPipeline } = jest.requireMock('../auto-pipeline') as {
      maybeRunAutoPipeline: jest.Mock;
    };
    maybeRunAutoPipeline.mockResolvedValue({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      failures: [],
      skipped: false,
      autoSummarize: false,
      autoPublish: false,
      libraryCollectionId: null,
    });
    const renderData = {
      videoInfoRes: {
        item_list: [
          {
            aweme_id: '7321234567890123457',
            desc: 't',
            duration: 30000,
            video: { cover: { url_list: ['c'] }, duration: 30000 },
            author: { nickname: 'n', sec_uid: 'MS4wLjABAAAA' },
          },
        ],
      },
    };
    const html = `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(
      JSON.stringify(renderData),
    )}</script>`;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(html, { status: 200 })) as unknown as typeof globalThis.fetch;

    const job = createJob({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7321234567890123457',
    });
    const after = await runJob(job.id);

    expect(after?.status).toBe('success');
    const stored = storeForTests().get<{ transcribed_count?: number }>('collect_jobs', job.id);
    expect(stored?.transcribed_count).toBe(1);
  });
});
