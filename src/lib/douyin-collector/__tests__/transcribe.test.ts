import Database from 'better-sqlite3';

import { COLLECTION_VIDEOS, DOUYIN_COLLECTOR_APP_ID } from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import { transcribeVideoFromNative } from '../transcribe';

let _db: Database.Database | null = null;
var mockGetDouyinCollectorSettings = jest.fn();

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getDouyinCollectorStore: () => buildStore(),
  };
});

jest.mock('../settings', () => ({
  getDouyinCollectorSettings: (...args: unknown[]) => mockGetDouyinCollectorSettings(...args),
}));

function buildStore(): AppDataStore {
  if (!_db) throw new Error('test db not initialised');
  return createAppDataStore(_db, DOUYIN_COLLECTOR_APP_ID);
}

function defaultSettings() {
  return {
    cookie: '',
    cookieCheckedAt: null,
    transcribePrefer: 'allow-asr' as const,
    longVideoSplitMinutes: 10,
    transcribeConcurrency: 3,
    libraryCollectionId: null,
    autoPublish: false,
    autoSummarize: false,
    aiSummaryPrompt: '',
    aiChaptersPrompt: '',
    aiTagsPrompt: '',
    riskNote: '',
  };
}

beforeEach(() => {
  mockGetDouyinCollectorSettings.mockReset();
  mockGetDouyinCollectorSettings.mockReturnValue(defaultSettings());
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

describe('transcribeVideoFromNative', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('marks video failed when neither native subtitle URL nor play_addr URL exists', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      transcript_status: 'pending',
      native_subtitle_urls: null,
      play_addr_urls: null,
    });
    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/play_addr|ASR/);
    const after = store.get<{ transcript_status?: string; failure_reason?: string }>(
      COLLECTION_VIDEOS,
      video.id,
    );
    expect(after?.transcript_status).toBe('failed');
    expect(after?.failure_reason).toMatch(/play_addr|ASR/);
  });

  it('returns failed when video does not exist', async () => {
    const r = await transcribeVideoFromNative('does-not-exist');
    expect(r.ok).toBe(false);
  });

  it('on successful download: stores transcript record and marks video success', async () => {
    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n第一句\n\n00:00:02.000 --> 00:00:05.000\n第二句\n`;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(vtt, { status: 200 })) as unknown as typeof globalThis.fetch;
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      transcript_status: 'pending',
      native_subtitle_urls: JSON.stringify(['https://example.com/captions.vtt']),
      language: 'zh-CN',
    });
    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sourceFormat).toBe('vtt');
      expect(r.segments).toHaveLength(2);
    }
    const after = store.get<{ transcript_status?: string; subtitle_source?: string; failure_reason?: string | null }>(
      COLLECTION_VIDEOS,
      video.id,
    );
    expect(after?.transcript_status).toBe('success');
    expect(after?.subtitle_source).toBe('native');
    expect(after?.failure_reason).toBeNull();
    const transcripts = store.query<{ video_ref?: string; source?: string }>('transcripts');
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0].video_ref).toBe(video.id);
    expect(transcripts[0].source).toBe('native');
  });

  it('tries all native subtitle URLs and keeps the longest parsed transcript', async () => {
    const shortVtt = `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n短句\n`;
    const longVtt = `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n这是更完整的第一句\n\n00:00:01.000 --> 00:00:03.000\n这是更完整的第二句\n`;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(shortVtt, { status: 200 }))
      .mockResolvedValueOnce(new Response(longVtt, { status: 200 })) as unknown as typeof globalThis.fetch;
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'native-multi',
      transcript_status: 'pending',
      native_subtitle_urls: JSON.stringify([
        'https://example.com/short.vtt',
        'https://example.com/long.vtt',
      ]),
      language: 'zh-CN',
    });

    const r = await transcribeVideoFromNative(video.id);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.segments).toHaveLength(2);
      expect(r.segments.map((s) => s.text).join('\n')).toContain('更完整');
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('clears prior failure_reason at the start of a new attempt (Round 156)', async () => {
    // Card showed red "字幕失败：..." simultaneously with status='running'
    // because we set running but didn't clear the prior reason. Prior
    // failure_reason belongs to the prior attempt; once a new attempt
    // begins, there's no failure to display until this attempt resolves.
    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n第一\n`;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(vtt, { status: 200 })) as unknown as typeof globalThis.fetch;
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'retry-1',
      transcript_status: 'failed',
      failure_reason: 'HTTP 503 from previous attempt',
      native_subtitle_urls: JSON.stringify(['https://example.com/x.vtt']),
    });
    await transcribeVideoFromNative(video.id);
    const after = store.get<{ failure_reason?: string | null }>(COLLECTION_VIDEOS, video.id);
    // After a successful retry, prior failure_reason must be gone
    // (success path also clears it; this asserts the *flow* result).
    expect(after?.failure_reason).toBeNull();
  });

  it('on fetch HTTP failure: marks video failed without writing a transcript', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 500 })) as unknown as typeof globalThis.fetch;
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a3',
      transcript_status: 'pending',
      native_subtitle_urls: JSON.stringify(['https://example.com/captions.vtt']),
    });
    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(false);
    const after = store.get<{ transcript_status?: string }>(COLLECTION_VIDEOS, video.id);
    expect(after?.transcript_status).toBe('failed');
    expect(store.query('transcripts')).toHaveLength(0);
  });

  it('falls back to local ASR when no native subtitle: success path stores asr-local source', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a4',
      transcript_status: 'pending',
      native_subtitle_urls: null,
      play_addr_urls: JSON.stringify(['https://example.com/video.mp4']),
      duration_seconds: 90,
      language: 'zh-CN',
    });

    // First call downloads the video bytes; second call hits /api/speech/transcribe.
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(Buffer.from('FAKE-MP4-BYTES'), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, text: 'ASR 转写出来的文本' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sourceFormat).toBe('plain');

    const after = store.get<{ subtitle_source?: string; transcript_status?: string }>(
      COLLECTION_VIDEOS,
      video.id,
    );
    expect(after?.subtitle_source).toBe('asr-local');
    expect(after?.transcript_status).toBe('success');
    const transcripts = store.query<{ source?: string; word_count?: number }>('transcripts');
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0].source).toBe('asr-local');
  });

  it('local ASR fallback: stores long ASR blobs as approximate timed segments', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'asr-split',
      transcript_status: 'pending',
      native_subtitle_urls: null,
      play_addr_urls: JSON.stringify(['https://example.com/video.mp4']),
      duration_seconds: 120,
      language: 'zh-CN',
    });
    const text =
      '开场介绍。第一部分展开，说明科学技术不是天然造福人类。第二部分继续，说明工具如何被不同的心使用。第三部分转到战争机器和人的选择。' +
      '第四部分讨论人的上升和下坠。第五部分说明每个人都有两种可能性。第六部分继续讲心性被妄念遮蔽。第七部分强调人最后的问题还是出在人自己身上。结尾总结到禅宗修行。';

    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(Buffer.from('FAKE-MP4-BYTES'), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, text, duration_seconds: 121.5 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.segments.length).toBeGreaterThan(1);
      expect(r.segments[0].startSec).toBe(0);
      expect(r.segments[r.segments.length - 1].endSec).toBe(120);
      expect(r.segments.map((segment) => segment.text).join('')).toBe(text);
    }
    const transcripts = store.query<{ segments?: string }>('transcripts');
    const storedSegments = JSON.parse(transcripts[0].segments ?? '[]') as Array<{ text: string }>;
    expect(storedSegments.length).toBeGreaterThan(1);
  });

  it('local ASR fallback: video download failure writes structured reason and no transcript', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a5',
      transcript_status: 'pending',
      native_subtitle_urls: null,
      play_addr_urls: JSON.stringify(['https://example.com/video.mp4']),
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 403 })) as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/HTTP 403|cookie|referer/);
    expect(store.query('transcripts')).toHaveLength(0);
  });

  it('autoSummarize=on summarizes before publishing to the default knowledge collection', async () => {
    const summaryModule = await import('../ai-summary');
    const summarizeSpy = jest
      .spyOn(summaryModule, 'summarizeVideo')
      .mockResolvedValue({
        ok: true,
        summary: { summary: 'fake', chapters: [], tags: [] },
      });
    const publishModule = await import('../publish');
    const publishSpy = jest
      .spyOn(publishModule, 'publishVideoToKnowledge')
      .mockResolvedValue({
        ok: true,
        documentId: 'doc-1',
        collectionId: 'col-knowledge',
      });
    mockGetDouyinCollectorSettings.mockReturnValue({
      ...defaultSettings(),
      autoSummarize: true,
      autoPublish: true,
      libraryCollectionId: 'col-knowledge',
    });

    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n第一句\n`;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(vtt, { status: 200 })) as unknown as typeof globalThis.fetch;
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a-cascade',
      transcript_status: 'pending',
      native_subtitle_urls: JSON.stringify(['https://example.com/x.vtt']),
    });

    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(true);
    expect(summarizeSpy).toHaveBeenCalledWith(video.id);
    expect(publishSpy).toHaveBeenCalledWith(video.id, 'col-knowledge');
    expect(summarizeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      publishSpy.mock.invocationCallOrder[0],
    );
  });

  it('autoSummarize failure does not fail the transcript call', async () => {
    const summaryModule = await import('../ai-summary');
    const summarizeSpy = jest
      .spyOn(summaryModule, 'summarizeVideo')
      .mockRejectedValue(new Error('quota exceeded'));
    mockGetDouyinCollectorSettings.mockReturnValue({
      ...defaultSettings(),
      autoSummarize: true,
    });

    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n第一句\n`;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(vtt, { status: 200 })) as unknown as typeof globalThis.fetch;
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a-cascade-fail',
      transcript_status: 'pending',
      native_subtitle_urls: JSON.stringify(['https://example.com/x.vtt']),
    });

    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(true);
    expect(summarizeSpy).toHaveBeenCalledWith(video.id);
  });

  it('idempotent on already-success videos: returns cached transcript without re-running ASR or creating a new row (Round 10)', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'idem-1',
      transcript_status: 'success',
      subtitle_source: 'asr-local',
      native_subtitle_urls: null,
      play_addr_urls: JSON.stringify(['https://example.com/video.mp4']),
    });
    const cachedSegments = [{ startSec: 0, endSec: 30, text: '已经转写过的内容' }];
    const cached = store.create('transcripts', {
      video_ref: video.id,
      lang: 'zh-CN',
      source: 'asr-local',
      segments: JSON.stringify(cachedSegments),
      word_count: cachedSegments[0].text.length,
      confidence: 0,
      updated_at: new Date().toISOString(),
    });
    // Spy fetch to confirm it never gets called — proves no re-charge.
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transcriptId).toBe(cached.id);
      expect(r.segments[0].text).toBe('已经转写过的内容');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    // Still exactly 1 transcript record — gate prevented duplicate.
    expect(store.query('transcripts')).toHaveLength(1);
  });

  it('force=true bypasses idempotency cache and re-runs ASR (Round 10)', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'idem-2',
      transcript_status: 'success',
      subtitle_source: 'native',
      native_subtitle_urls: JSON.stringify(['https://example.com/x.vtt']),
    });
    store.create('transcripts', {
      video_ref: video.id,
      lang: 'zh-CN',
      source: 'native',
      segments: JSON.stringify([{ startSec: 0, endSec: 5, text: '旧版' }]),
      word_count: 2,
      confidence: 0,
      updated_at: new Date().toISOString(),
    });
    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n新版字幕\n`;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(vtt, { status: 200 })) as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id, { force: true });

    expect(r.ok).toBe(true);
    // force=true creates a fresh transcript row — caller asked for it.
    expect(store.query('transcripts')).toHaveLength(2);
  });

  it('transcribePrefer=native-only: refuses ASR fallback when no native subtitle (Round 11)', async () => {
    mockGetDouyinCollectorSettings.mockReturnValue({
      ...defaultSettings(),
      transcribePrefer: 'native-only',
    });

    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'pref-1',
      transcript_status: 'pending',
      native_subtitle_urls: null,
      play_addr_urls: JSON.stringify(['https://example.com/v.mp4']),
    });
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/只用原生字幕/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('transcribePrefer=force-local-asr: skips native subtitle even when present (Round 11)', async () => {
    mockGetDouyinCollectorSettings.mockReturnValue({
      ...defaultSettings(),
      transcribePrefer: 'force-local-asr',
    });

    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'pref-2',
      transcript_status: 'pending',
      // Native subtitle EXISTS — should be ignored under force-local-asr.
      native_subtitle_urls: JSON.stringify(['https://example.com/native.vtt']),
      play_addr_urls: JSON.stringify(['https://example.com/v.mp4']),
      duration_seconds: 30,
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(Buffer.from('FAKE-MP4'), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, text: '强制 ASR 转写结果', charged_amount: 0.01 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id);

    expect(r.ok).toBe(true);
    const transcripts = store.query<{ source?: string }>('transcripts');
    expect(transcripts).toHaveLength(1);
    // Source must be asr-local; native path was bypassed.
    expect(transcripts[0].source).toBe('asr-local');
  });

  it('local ASR fallback: empty ASR text marks failed without creating transcript', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a6',
      transcript_status: 'pending',
      native_subtitle_urls: null,
      play_addr_urls: JSON.stringify(['https://example.com/video.mp4']),
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(Buffer.from('FAKE-MP4'), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, text: '   ' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as unknown as typeof globalThis.fetch;

    const r = await transcribeVideoFromNative(video.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/空文本|无人声/);
    expect(store.query('transcripts')).toHaveLength(0);
  });
});
