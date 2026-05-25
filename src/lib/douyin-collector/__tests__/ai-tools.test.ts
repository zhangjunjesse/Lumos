import Database from 'better-sqlite3';

import {
  COLLECTION_KEYWORDS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import {
  batchCollectForAi,
  collectKeywordForAi,
  processVideoForAi,
} from '../ai-tools';

let _db: Database.Database | null = null;
// jest.mock callbacks are hoisted to file top, so these mock factories need
// var hoisting too — let/const wouldn't be visible to the hoisted mock factory.
/* eslint-disable no-var */
var mockGetDouyinCollectorSettings = jest.fn();
var mockCreateJob = jest.fn();
var mockFindActiveDuplicateJob = jest.fn();
var mockRunJob = jest.fn();
var mockTranscribeVideoFromNative = jest.fn();
var mockSummarizeVideo = jest.fn();
var mockPublishVideoToKnowledge = jest.fn();
/* eslint-enable no-var */

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getDouyinCollectorStore: () => buildStore(),
    listCreators: () => buildStore().query('creators', {
      orderBy: { field: 'updated_at', direction: 'desc' },
    }),
    listKeywords: () => buildStore().query('keywords', {
      orderBy: { field: 'updated_at', direction: 'desc' },
    }),
  };
});

jest.mock('../settings', () => ({
  getDouyinCollectorSettings: (...args: unknown[]) => mockGetDouyinCollectorSettings(...args),
}));

jest.mock('../jobs', () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  findActiveDuplicateJob: (...args: unknown[]) => mockFindActiveDuplicateJob(...args),
  runJob: (...args: unknown[]) => mockRunJob(...args),
}));

jest.mock('../transcribe', () => ({
  transcribeVideoFromNative: (...args: unknown[]) => mockTranscribeVideoFromNative(...args),
}));

jest.mock('../ai-summary', () => ({
  summarizeVideo: (...args: unknown[]) => mockSummarizeVideo(...args),
}));

jest.mock('../publish', () => ({
  publishVideoToKnowledge: (...args: unknown[]) => mockPublishVideoToKnowledge(...args),
}));

function buildStore(): AppDataStore {
  if (!_db) throw new Error('test db not initialised');
  return createAppDataStore(_db, DOUYIN_COLLECTOR_APP_ID);
}

function defaultSettings() {
  return {
    cookie: '',
    cookieCheckedAt: null,
    cookieLastOkAt: null,
    transcribePrefer: 'allow-asr' as const,
    longVideoSplitMinutes: 10,
    transcribeConcurrency: 3,
    libraryCollectionId: 'col-knowledge',
    autoPublish: true,
    autoSummarize: true,
    autoTranscribe: true,
    aiSummaryPrompt: '',
    aiChaptersPrompt: '',
    aiTagsPrompt: '',
    riskNote: '',
  };
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
  mockGetDouyinCollectorSettings.mockReset();
  mockGetDouyinCollectorSettings.mockReturnValue(defaultSettings());
  mockCreateJob.mockReset();
  mockFindActiveDuplicateJob.mockReset();
  mockFindActiveDuplicateJob.mockReturnValue(null);
  mockRunJob.mockReset();
  mockTranscribeVideoFromNative.mockReset();
  mockSummarizeVideo.mockReset();
  mockPublishVideoToKnowledge.mockReset();
});

describe('douyin AI tools service facade', () => {
  it('processes an existing video through transcript, summary, and default knowledge publish', async () => {
    const store = buildStore();
    const video = store.create(COLLECTION_VIDEOS, {
      aweme_id: '7345678901234567890',
      title: '测试视频',
      transcript_status: 'pending',
      library_status: 'draft',
      updated_at: new Date().toISOString(),
    });
    mockTranscribeVideoFromNative.mockResolvedValue({
      ok: true,
      segments: [{ startSec: 0, endSec: 3, text: 'hello' }],
      sourceFormat: 'plain',
      transcriptId: 'transcript-1',
    });
    mockSummarizeVideo.mockResolvedValue({
      ok: true,
      summary: { summary: '摘要', chapters: [], tags: ['测试'] },
    });
    mockPublishVideoToKnowledge.mockResolvedValue({
      ok: true,
      documentId: 'doc-1',
      collectionId: 'col-knowledge',
    });

    const result = await processVideoForAi({ awemeId: '7345678901234567890' });

    expect(result.ok).toBe(true);
    expect(mockTranscribeVideoFromNative).toHaveBeenCalledWith(video.id, {
      force: false,
      prefer: undefined,
    });
    expect(mockSummarizeVideo).toHaveBeenCalledWith(video.id);
    expect(mockPublishVideoToKnowledge).toHaveBeenCalledWith(video.id, 'col-knowledge');
  });

  it('fails honestly when publish is requested but no default knowledge collection is configured', async () => {
    mockGetDouyinCollectorSettings.mockReturnValue({
      ...defaultSettings(),
      libraryCollectionId: null,
    });
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7345678901234567891',
      title: '无知识库视频',
      transcript_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    const result = await processVideoForAi({
      awemeId: '7345678901234567891',
      transcribe: false,
      summarize: false,
      publishToKnowledge: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('publish');
      expect(result.error).toMatch(/默认知识库/);
    }
    expect(mockPublishVideoToKnowledge).not.toHaveBeenCalled();
  });

  it('creates a keyword subscription and runs a keyword collect job for AI callers', async () => {
    mockCreateJob.mockImplementation((input: { kind: string; targetRef: string }) => ({
      id: 'job-1',
      kind: input.kind,
      target_ref: input.targetRef,
      status: 'queued',
      failure_reason: null,
    }));
    mockRunJob.mockResolvedValue({
      id: 'job-1',
      kind: 'keyword',
      target_ref: 'kw-1',
      status: 'success',
      failure_reason: null,
      discovered_count: 0,
    });

    const result = await collectKeywordForAi(' AI 赚钱 ', {
      timeWindow: 'week',
      dedupeWindowDays: 14,
    });

    expect(result.ok).toBe(true);
    expect(mockCreateJob).toHaveBeenCalledWith({
      kind: 'keyword',
      targetRef: expect.any(String),
    });
    expect(mockRunJob).toHaveBeenCalledWith('job-1');
    const keywords = buildStore().query<{ query?: string; dedupe_window_days?: number }>(
      COLLECTION_KEYWORDS,
    );
    expect(keywords).toHaveLength(1);
    expect(keywords[0].query).toBe('AI 赚钱');
    expect(keywords[0].dedupe_window_days).toBe(14);
  });

  it('auto-processes keyword collection results when requested', async () => {
    mockCreateJob.mockImplementation((input: { kind: string; targetRef: string }) => ({
      id: 'job-keyword-process',
      kind: input.kind,
      target_ref: input.targetRef,
      status: 'queued',
      failure_reason: null,
    }));
    mockRunJob.mockImplementation(async () => {
      buildStore().create(COLLECTION_VIDEOS, {
        aweme_id: '7345678901234567893',
        title: '关键词视频',
        tags: JSON.stringify(['AI 赚钱']),
        transcript_status: 'pending',
        library_status: 'unprocessed',
        updated_at: new Date().toISOString(),
      });
      return {
        id: 'job-keyword-process',
        kind: 'keyword',
        target_ref: 'kw-process',
        status: 'success',
        failure_reason: null,
        discovered_count: 1,
      };
    });
    mockTranscribeVideoFromNative.mockResolvedValue({
      ok: true,
      segments: [{ startSec: 0, endSec: 3, text: 'hello' }],
      sourceFormat: 'plain',
      transcriptId: 'transcript-keyword',
    });
    mockSummarizeVideo.mockResolvedValue({
      ok: true,
      summary: { summary: '摘要', chapters: [], tags: ['AI'] },
    });
    mockPublishVideoToKnowledge.mockResolvedValue({
      ok: true,
      documentId: 'doc-keyword',
      collectionId: 'col-knowledge',
    });

    const result = await collectKeywordForAi('AI 赚钱', {
      autoProcess: true,
      publishToKnowledge: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.process).toMatchObject({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      failures: [],
    });
    const video = buildStore().query<{ id: string }>(COLLECTION_VIDEOS)[0];
    expect(mockTranscribeVideoFromNative).toHaveBeenCalledWith(video.id, {
      force: false,
      prefer: undefined,
    });
    expect(mockSummarizeVideo).toHaveBeenCalledWith(video.id);
    expect(mockPublishVideoToKnowledge).toHaveBeenCalledWith(video.id, 'col-knowledge');
  });

  it('returns keyword auto-process failures instead of hiding them', async () => {
    mockCreateJob.mockImplementation((input: { kind: string; targetRef: string }) => ({
      id: 'job-keyword-process-failed',
      kind: input.kind,
      target_ref: input.targetRef,
      status: 'queued',
      failure_reason: null,
    }));
    mockRunJob.mockImplementation(async () => {
      buildStore().create(COLLECTION_VIDEOS, {
        aweme_id: '7345678901234567894',
        title: '关键词失败视频',
        tags: JSON.stringify(['AI 赚钱']),
        transcript_status: 'pending',
        library_status: 'unprocessed',
        updated_at: new Date().toISOString(),
      });
      return {
        id: 'job-keyword-process-failed',
        kind: 'keyword',
        target_ref: 'kw-process-failed',
        status: 'success',
        failure_reason: null,
        discovered_count: 1,
      };
    });
    mockTranscribeVideoFromNative.mockResolvedValue({
      ok: false,
      reason: '下载视频音频失败：HTTP 404',
    });

    const result = await collectKeywordForAi('AI 赚钱', {
      autoProcess: true,
      publishToKnowledge: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.process).toMatchObject({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      failures: [
        {
          awemeId: '7345678901234567894',
          phase: 'transcribe',
          error: '下载视频音频失败：HTTP 404',
        },
      ],
    });
    expect(mockSummarizeVideo).not.toHaveBeenCalled();
    expect(mockPublishVideoToKnowledge).not.toHaveBeenCalled();
  });

  it('classifies failed jobs as batch failures instead of successful results', async () => {
    mockCreateJob.mockImplementation((input: { kind: string; targetRef: string }) => ({
      id: 'job-link-failed',
      kind: input.kind,
      target_ref: input.targetRef,
      status: 'queued',
      failure_reason: null,
    }));
    mockRunJob.mockResolvedValue({
      id: 'job-link-failed',
      kind: 'link',
      target_ref: 'https://www.douyin.com/video/7345678901234567892',
      status: 'failed',
      failure_reason: 'Cookie 失效',
      discovered_count: 0,
    });

    const result = await batchCollectForAi({
      links: ['7345678901234567892'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.results).toHaveLength(0);
    expect(result.failures).toEqual([
      { input: '7345678901234567892', error: 'Cookie 失效' },
    ]);
  });
});
