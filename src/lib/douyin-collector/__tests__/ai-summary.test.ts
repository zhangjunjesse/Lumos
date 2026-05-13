import Database from 'better-sqlite3';

import {
  COLLECTION_TRANSCRIPTS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import {
  buildSummaryRequest,
  summarizeVideo,
  type SummaryShape,
} from '../ai-summary';

let _db: Database.Database | null = null;

jest.mock('@/lib/db/providers', () => ({
  ...jest.requireActual('@/lib/db/providers'),
  getDefaultProvider: jest.fn(),
}));
jest.mock('@/lib/model-metadata', () => ({
  ...jest.requireActual('@/lib/model-metadata'),
  resolveProviderModelForRequest: jest.fn(),
}));
jest.mock('@/lib/provider-config', () => ({
  ...jest.requireActual('@/lib/provider-config'),
  providerSupportsCapability: jest.fn(),
}));
jest.mock('@/lib/text-generator', () => ({
  ...jest.requireActual('@/lib/text-generator'),
  generateObjectFromProvider: jest.fn(),
}));
jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getDouyinCollectorStore: () => buildStore(),
  };
});
jest.mock('../settings', () => ({
  getDouyinCollectorSettings: () => ({
    cookie: '',
    cookieCheckedAt: null,
    transcribePrefer: 'allow-asr' as const,
    longVideoSplitMinutes: 10,
    transcribeConcurrency: 3,
    libraryCollectionId: null,
    autoPublish: false,
    aiSummaryPrompt: 'mock summary prompt',
    aiChaptersPrompt: 'mock chapters prompt',
    aiTagsPrompt: 'mock tags prompt',
    riskNote: 'mock risk',
  }),
}));

import { getDefaultProvider } from '@/lib/db/providers';
import { resolveProviderModelForRequest } from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';
import { generateObjectFromProvider } from '@/lib/text-generator';

const mockGetDefaultProvider = getDefaultProvider as jest.MockedFunction<typeof getDefaultProvider>;
const mockResolveModel = resolveProviderModelForRequest as jest.MockedFunction<
  typeof resolveProviderModelForRequest
>;
const mockSupportsCap = providerSupportsCapability as jest.MockedFunction<
  typeof providerSupportsCapability
>;
const mockGenerate = generateObjectFromProvider as jest.MockedFunction<
  typeof generateObjectFromProvider
>;

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
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  mockGetDefaultProvider.mockReset();
  mockResolveModel.mockReset();
  mockSupportsCap.mockReset();
  mockGenerate.mockReset();
});

function seedVideoWithTranscript(): string {
  const store = buildStore();
  const v = store.create(COLLECTION_VIDEOS, {
    aweme_id: 'a1',
    title: '测试',
    creator_nickname: '博主 A',
    duration_seconds: 600,
  });
  store.create(COLLECTION_TRANSCRIPTS, {
    video_ref: v.id,
    source: 'native',
    segments: JSON.stringify([
      { startSec: 0, endSec: 5, text: '第一句' },
      { startSec: 5, endSec: 10, text: '第二句' },
    ]),
    word_count: 6,
  });
  return v.id;
}

describe('summarizeVideo', () => {
  it('rejects when video does not exist', async () => {
    const r = await summarizeVideo('does-not-exist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/视频记录/);
  });

  it('rejects when transcript is missing', async () => {
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, { aweme_id: 'b1', title: 't' });
    const r = await summarizeVideo(v.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/transcript|抓字幕/);
  });

  it('rejects when no default provider is configured', async () => {
    mockGetDefaultProvider.mockReturnValue(null);
    const id = seedVideoWithTranscript();
    const r = await summarizeVideo(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/provider/i);
  });

  it('rejects when provider does not support text-gen capability', async () => {
    mockGetDefaultProvider.mockReturnValue({ id: 'p1', name: 'P1' } as never);
    mockSupportsCap.mockReturnValue(false);
    const id = seedVideoWithTranscript();
    const r = await summarizeVideo(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/不支持文本/);
  });

  it('on success: writes summary / tags / chapters back to the video record', async () => {
    mockGetDefaultProvider.mockReturnValue({ id: 'p1', name: 'P1' } as never);
    mockSupportsCap.mockReturnValue(true);
    mockResolveModel.mockReturnValue('claude-sonnet-4-6');
    const fakeSummary: SummaryShape = {
      summary: '一句话摘要',
      chapters: [
        { startSec: 0, title: '开场' },
        { startSec: 60, title: '正题' },
      ],
      tags: ['ai', 'douyin'],
    };
    mockGenerate.mockResolvedValue(fakeSummary);

    const id = seedVideoWithTranscript();
    const r = await summarizeVideo(id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toEqual(fakeSummary);

    const store = buildStore();
    const v = store.get<{ summary?: string; tags?: string; chapters?: string }>(
      COLLECTION_VIDEOS,
      id,
    );
    expect(v?.summary).toBe('一句话摘要');
    expect(JSON.parse(v?.tags ?? '[]')).toEqual(['ai', 'douyin']);
    expect(JSON.parse(v?.chapters ?? '[]')).toHaveLength(2);
  });

  it('merges AI tags with pre-existing tags (preserves keyword seed / user edits)', async () => {
    mockGetDefaultProvider.mockReturnValue({ id: 'p1', name: 'P1' } as never);
    mockSupportsCap.mockReturnValue(true);
    mockResolveModel.mockReturnValue('claude-sonnet-4-6');
    mockGenerate.mockResolvedValue({
      summary: 's',
      chapters: [],
      tags: ['ai', 'cache'],
    } satisfies SummaryShape);

    // Seed a video that already has user-edited tags + a keyword seed
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a-keyword',
      title: 't',
      tags: '["prompt-caching", "AI"]', // pre-existing
    });
    store.create(COLLECTION_TRANSCRIPTS, {
      video_ref: v.id,
      source: 'native',
      segments: JSON.stringify([{ startSec: 0, endSec: 1, text: 'x' }]),
    });

    const r = await summarizeVideo(v.id);
    expect(r.ok).toBe(true);

    const got = store.get<{ tags?: string }>(COLLECTION_VIDEOS, v.id);
    const tags = JSON.parse(got?.tags ?? '[]');
    // - 'prompt-caching' kept (no AI conflict)
    // - 'AI' kept (case-insensitive dedup with AI's 'ai')
    // - 'cache' added (new from AI)
    expect(tags).toEqual(['prompt-caching', 'AI', 'cache']);
  });

  it('on LLM error: returns structured failure, does not corrupt video record', async () => {
    mockGetDefaultProvider.mockReturnValue({ id: 'p1', name: 'P1' } as never);
    mockSupportsCap.mockReturnValue(true);
    mockResolveModel.mockReturnValue('claude-sonnet-4-6');
    mockGenerate.mockRejectedValue(new Error('rate limited'));

    const id = seedVideoWithTranscript();
    const r = await summarizeVideo(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/LLM|rate limited/);

    const store = buildStore();
    const v = store.get<{ summary?: string }>(COLLECTION_VIDEOS, id);
    expect(v?.summary).toBeUndefined();
  });
});

describe('buildSummaryRequest', () => {
  const base = {
    title: 'Claude API 实战',
    creatorNickname: 'AI 实践者',
    durationSeconds: 1800,
    transcriptText: '第一句\n第二句',
    summaryStyle: '4-6 句话客观摘要',
    chaptersStyle: '每段 1-3 分钟',
    tagsStyle: '3-8 个具体标签',
  };

  it('renders title / creator / duration into the system block', () => {
    const { system } = buildSummaryRequest(base);
    expect(system).toContain('视频元信息：标题「Claude API 实战」');
    expect(system).toContain('作者「AI 实践者」');
    expect(system).toContain('时长 1800 秒');
  });

  it('uses placeholder fallbacks when title / creator are empty', () => {
    const { system } = buildSummaryRequest({
      ...base,
      title: '',
      creatorNickname: null,
    });
    expect(system).toContain('「未知标题」');
    expect(system).toContain('「未知博主」');
  });

  it('embeds user-configured style guidance verbatim', () => {
    const { system } = buildSummaryRequest({
      ...base,
      summaryStyle: 'CUSTOM-SUMMARY',
      chaptersStyle: 'CUSTOM-CHAPTERS',
      tagsStyle: 'CUSTOM-TAGS',
    });
    expect(system).toContain('摘要风格：CUSTOM-SUMMARY');
    expect(system).toContain('章节切分风格：CUSTOM-CHAPTERS');
    expect(system).toContain('标签风格：CUSTOM-TAGS');
  });

  it('stuffs full transcript into the user prompt with [m:ss] markers (Round 174)', () => {
    const { prompt } = buildSummaryRequest(base);
    expect(prompt).toContain('第一句');
    expect(prompt).toContain('第二句');
    // Round 174: prompt header now describes the [m:ss] format so the
    // LLM treats inline timestamps as authoritative for chapter starts.
    expect(prompt.startsWith('下面是该视频的字幕（每行格式 [m:ss] 文本）')).toBe(true);
  });
});
