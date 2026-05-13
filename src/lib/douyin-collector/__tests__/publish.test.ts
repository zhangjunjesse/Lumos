import Database from 'better-sqlite3';

import {
  COLLECTION_LIBRARY_LINKS,
  COLLECTION_TRANSCRIPTS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import { publishVideoToKnowledge } from '../publish';

let _db: Database.Database | null = null;

const knowledgeStub = {
  findItemBySourceKey: jest.fn(),
  addItem: jest.fn(),
  updateItem: jest.fn(),
  patchItem: jest.fn(),
  saveChunks: jest.fn(),
  updateItemProcessing: jest.fn(),
};
let mockIndexItemChunks: jest.Mock;
let mockIndexItem: jest.Mock;
let mockClearSummaryArtifacts: jest.Mock;
let mockSummarizeAndEmbedStrict: jest.Mock;
let mockAutoTagCategorizedStrict: jest.Mock;
let mockBuildTagCandidates: jest.Mock;
let mockSyncItemTagSystem: jest.Mock;
let mockIsKnowledgeEnhancementUnavailableError: jest.Mock;

jest.mock('@/lib/knowledge/store', () => knowledgeStub);
jest.mock('@/lib/knowledge/bm25', () => ({
  indexItemChunks: (...args: unknown[]) => mockIndexItemChunks(...args),
}));
jest.mock('@/lib/knowledge/embedder', () => ({
  indexItem: (...args: unknown[]) => mockIndexItem(...args),
}));
jest.mock('@/lib/knowledge/summarizer', () => ({
  clearSummaryArtifacts: (...args: unknown[]) => mockClearSummaryArtifacts(...args),
  summarizeAndEmbedStrict: (...args: unknown[]) => mockSummarizeAndEmbedStrict(...args),
}));
jest.mock('@/lib/knowledge/tagger', () => ({
  autoTagCategorizedStrict: (...args: unknown[]) => mockAutoTagCategorizedStrict(...args),
}));
jest.mock('@/lib/knowledge/tag-system', () => ({
  buildTagCandidates: (...args: unknown[]) => mockBuildTagCandidates(...args),
  syncItemTagSystem: (...args: unknown[]) => mockSyncItemTagSystem(...args),
}));
jest.mock('@/lib/knowledge/llm', () => ({
  isKnowledgeEnhancementUnavailableError: (...args: unknown[]) =>
    mockIsKnowledgeEnhancementUnavailableError(...args),
}));

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
  knowledgeStub.findItemBySourceKey.mockReset();
  knowledgeStub.addItem.mockReset();
  knowledgeStub.updateItem.mockReset();
  knowledgeStub.patchItem.mockReset();
  knowledgeStub.saveChunks.mockReset();
  knowledgeStub.updateItemProcessing.mockReset();
  mockIndexItemChunks = jest.fn(() => undefined);
  mockIndexItem = jest.fn().mockResolvedValue(undefined);
  mockClearSummaryArtifacts = jest.fn();
  mockSummarizeAndEmbedStrict = jest.fn((itemId: string) =>
    Promise.resolve({
      itemId,
      summary: '索引概述',
      keyPoints: ['关键要点'],
      generatedAt: '2026-05-11T00:00:00.000Z',
    }),
  );
  mockAutoTagCategorizedStrict = jest.fn().mockResolvedValue({ matched: [], suggested: [] });
  mockBuildTagCandidates = jest.fn((tags: string[]) => tags);
  mockSyncItemTagSystem = jest.fn();
  mockIsKnowledgeEnhancementUnavailableError = jest.fn(() => false);
});

function seedVideoWithTranscript(): { videoId: string; transcriptId: string } {
  const store = buildStore();
  const v = store.create(COLLECTION_VIDEOS, {
    aweme_id: 'a-publish-1',
    title: 'Claude API 实战',
    creator_nickname: 'AI 实践者',
    duration_seconds: 1800,
    duration_bucket: 'long',
    subtitle_source: 'native',
    summary: '一句话摘要',
    tags: JSON.stringify(['ai', 'api']),
  });
  const t = store.create(COLLECTION_TRANSCRIPTS, {
    video_ref: v.id,
    lang: 'zh-CN',
    source: 'native',
    segments: JSON.stringify([
      { startSec: 0, endSec: 5, text: '第一句' },
      { startSec: 5, endSec: 10, text: '第二句' },
    ]),
    word_count: 6,
  });
  return { videoId: v.id, transcriptId: t.id };
}

describe('publishVideoToKnowledge', () => {
  it('rejects when collectionId is empty', async () => {
    const r = await publishVideoToKnowledge('any-id', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/collection/i);
  });

  it('rejects when video does not exist', async () => {
    const r = await publishVideoToKnowledge('does-not-exist', 'col-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/视频记录/);
  });

  it('rejects when video has no transcript yet (refuse to write empty content)', async () => {
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, { aweme_id: 'a2', title: 't' });
    const r = await publishVideoToKnowledge(v.id, 'col-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/transcript/);
  });

  it('on first publish: writes text item, indexes it, writes library_links, marks video published', async () => {
    knowledgeStub.findItemBySourceKey.mockReturnValue(undefined);
    knowledgeStub.addItem.mockReturnValue({ id: 'kb-item-1' });
    const { videoId } = seedVideoWithTranscript();

    const r = await publishVideoToKnowledge(videoId, 'col-knowledge');
    expect(r.ok).toBe(true);

    expect(knowledgeStub.addItem).toHaveBeenCalledTimes(1);
    const call = knowledgeStub.addItem.mock.calls[0];
    expect(call[0]).toBe('col-knowledge');
    const data = call[1] as Record<string, unknown>;
    expect(data.source_type).toBe('manual');
    expect(data.source_key).toBe('douyin:a-publish-1');
    expect(typeof data.content).toBe('string');
    expect(String(data.content)).toContain('Claude API 实战');
    expect(String(data.content)).toContain('第一句');
    expect(String(data.content)).toContain('第二句');
    expect(data.tags).toEqual(['ai', 'api']);
    // Round 177: chapters block (when chapters present in video record)
    // — current seed has no chapters so it should NOT appear in content.
    expect(String(data.content)).not.toContain('## 章节');
    expect(knowledgeStub.saveChunks).toHaveBeenCalledWith(
      'kb-item-1',
      expect.arrayContaining([expect.stringContaining('Claude API 实战')]),
    );
    expect(mockIndexItemChunks).toHaveBeenCalledWith(
      'kb-item-1',
      expect.any(Array),
      'Claude API 实战',
    );
    expect(mockIndexItem).toHaveBeenCalledWith('kb-item-1', expect.any(Array));
    expect(mockClearSummaryArtifacts).toHaveBeenCalledWith('kb-item-1');
    expect(mockSummarizeAndEmbedStrict).toHaveBeenCalledWith('kb-item-1');
    expect(mockAutoTagCategorizedStrict).toHaveBeenCalledWith(
      expect.stringContaining('Claude API 实战'),
      ['ai', 'api'],
    );
    expect(knowledgeStub.updateItemProcessing).toHaveBeenLastCalledWith(
      'kb-item-1',
      expect.objectContaining({
        status: 'ready',
        detail: expect.stringContaining('"summary":"done"'),
        chunkCount: expect.any(Number),
      }),
    );

    const store = buildStore();
    const links = store.query<{ collection_id?: string; chunk_id?: string }>(COLLECTION_LIBRARY_LINKS);
    expect(links).toHaveLength(1);
    expect(links[0].collection_id).toBe('col-knowledge');
    expect(links[0].chunk_id).toBe('kb-item-1');

    const v = store.get<{ library_status?: string; library_collection_id?: string }>(
      COLLECTION_VIDEOS,
      videoId,
    );
    expect(v?.library_status).toBe('published');
    expect(v?.library_collection_id).toBe('col-knowledge');
  });

  it('on second publish for same video: idempotent — updates existing kb item, single library_links row', async () => {
    knowledgeStub.findItemBySourceKey
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ id: 'kb-item-1' });
    knowledgeStub.addItem.mockReturnValue({ id: 'kb-item-1' });
    const { videoId } = seedVideoWithTranscript();

    await publishVideoToKnowledge(videoId, 'col-knowledge');
    await publishVideoToKnowledge(videoId, 'col-knowledge');

    expect(knowledgeStub.addItem).toHaveBeenCalledTimes(1);
    expect(knowledgeStub.patchItem).toHaveBeenCalledTimes(1);
    expect(knowledgeStub.saveChunks).toHaveBeenCalledTimes(2);
    const store = buildStore();
    expect(store.query(COLLECTION_LIBRARY_LINKS)).toHaveLength(1);
  });

  it('content includes chapters section when video has chapters (Round 177)', async () => {
    knowledgeStub.findItemBySourceKey.mockReturnValue(undefined);
    knowledgeStub.addItem.mockReturnValue({ id: 'kb-item-1' });
    // Seed a video WITH chapters set on the row.
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a-publish-chapters',
      title: 'AI 应用入门',
      creator_nickname: '某老师',
      duration_seconds: 1500,
      summary: 'foo',
      tags: '[]',
      chapters: JSON.stringify([
        { startSec: 0, title: '开场' },
        { startSec: 135, title: '核心论点' },
        { startSec: 720, title: 'Q&A' },
      ]),
    });
    store.create(COLLECTION_TRANSCRIPTS, {
      video_ref: v.id,
      lang: 'zh-CN',
      source: 'native',
      segments: JSON.stringify([{ startSec: 0, endSec: 5, text: '正文' }]),
      word_count: 2,
    });

    await publishVideoToKnowledge(v.id, 'col-knowledge');

    const data = knowledgeStub.addItem.mock.calls[0][1] as Record<string, unknown>;
    const content = String(data.content);
    expect(content).toContain('## 章节');
    // Round 174 grounded timestamps surface verbatim — 135s = 2:15.
    expect(content).toContain('[0:00] 开场');
    expect(content).toContain('[2:15] 核心论点');
    expect(content).toContain('[12:00] Q&A');
  });
});
