import Database from 'better-sqlite3';

import {
  COLLECTION_TRANSCRIPTS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from '../constants';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import {
  exportLibraryAsAnki,
  exportLibraryAsCsv,
  exportLibraryAsJson,
  exportLibraryAsMarkdown,
} from '../export';

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

describe('exportLibraryAsMarkdown', () => {
  it('returns an empty-state header when no videos match', () => {
    const md = exportLibraryAsMarkdown({ scope: 'published', includeTranscript: true });
    expect(md).toContain('# 抖音采集器导出');
    expect(md).toContain('没有匹配的视频');
  });

  it('renders headings, metadata, summary, tags, chapters, transcript for published videos', () => {
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, {
      aweme_id: '7xxxxxxxxxxxxxx',
      title: 'Claude API 实战',
      creator_nickname: 'AI 实践者',
      duration_seconds: 1800,
      duration_bucket: 'long',
      subtitle_source: 'native',
      summary: '一句话摘要：先讲原理，再讲实战。',
      tags: JSON.stringify(['ai', 'api']),
      chapters: JSON.stringify([
        { startSec: 0, title: '开场' },
        { startSec: 60, title: '正题' },
      ]),
      library_status: 'published',
    });
    store.create(COLLECTION_TRANSCRIPTS, {
      video_ref: v.id,
      source: 'native',
      segments: JSON.stringify([
        { startSec: 0, endSec: 5, text: '第一句' },
        { startSec: 5, endSec: 10, text: '第二句' },
      ]),
    });

    const md = exportLibraryAsMarkdown({ scope: 'published', includeTranscript: true });
    expect(md).toContain('## Claude API 实战');
    expect(md).toContain('AI 实践者');
    expect(md).toContain('https://www.douyin.com/video/7xxxxxxxxxxxxxx');
    expect(md).toContain('### 摘要');
    expect(md).toContain('一句话摘要');
    expect(md).toContain('#ai');
    expect(md).toContain('#api');
    expect(md).toContain('### 章节');
    expect(md).toContain('0:00 开场');
    expect(md).toContain('1:00 正题');
    expect(md).toContain('### 字幕原文');
    expect(md).toContain('第一句');
    expect(md).toContain('第二句');
  });

  it('scope=published excludes unprocessed videos', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      title: 'PUB',
      library_status: 'published',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      title: 'UNPROC',
      library_status: 'unprocessed',
    });
    const md = exportLibraryAsMarkdown({ scope: 'published', includeTranscript: false });
    expect(md).toContain('PUB');
    expect(md).not.toContain('UNPROC');
  });

  it('includeTranscript=false omits the 字幕原文 section entirely (no "尚未抓取字幕" placeholder)', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      title: 'NO TRANSCRIPT',
      library_status: 'published',
    });
    const md = exportLibraryAsMarkdown({ scope: 'published', includeTranscript: false });
    expect(md).toContain('NO TRANSCRIPT');
    expect(md).not.toContain('### 字幕原文');
    expect(md).not.toContain('尚未抓取字幕');
  });

  it('scope=all excludes discarded videos', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      title: 'KEEP',
      library_status: 'unprocessed',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      title: 'DROP',
      library_status: 'discarded',
    });
    const md = exportLibraryAsMarkdown({ scope: 'all', includeTranscript: false });
    expect(md).toContain('KEEP');
    expect(md).not.toContain('DROP');
  });
});

describe('exportLibraryAsJson', () => {
  it('returns an empty array when no videos match', () => {
    expect(exportLibraryAsJson({ scope: 'published', includeTranscript: true })).toEqual(
      [],
    );
  });

  it('serializes structured fields including parsed tags / chapters and the share URL', () => {
    const store = buildStore();
    const v = store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000001',
      title: 'V1',
      creator_nickname: 'creator',
      duration_seconds: 1800,
      duration_bucket: 'long',
      subtitle_source: 'native',
      summary: 'AI 摘要',
      tags: JSON.stringify(['ai', 'api']),
      chapters: JSON.stringify([{ startSec: 0, title: '开场' }]),
      library_status: 'published',
    });
    store.create(COLLECTION_TRANSCRIPTS, {
      video_ref: v.id,
      source: 'native',
      segments: JSON.stringify([{ startSec: 0, endSec: 5, text: '第一句' }]),
    });

    const items = exportLibraryAsJson({ scope: 'published', includeTranscript: true });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      awemeId: '7000000000000000001',
      title: 'V1',
      creator: 'creator',
      durationSeconds: 1800,
      subtitleSource: 'native',
      libraryStatus: 'published',
      url: 'https://www.douyin.com/video/7000000000000000001',
      summary: 'AI 摘要',
      tags: ['ai', 'api'],
      chapters: [{ startSec: 0, title: '开场' }],
      transcript: '第一句',
    });
  });

  it('includeTranscript=false sets transcript to null', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      title: 'NO TX',
      library_status: 'published',
    });
    const items = exportLibraryAsJson({ scope: 'published', includeTranscript: false });
    expect(items).toHaveLength(1);
    expect(items[0].transcript).toBeNull();
  });

  it('scope=all excludes discarded; scope=published excludes drafts', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a1',
      title: 'PUB',
      library_status: 'published',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a2',
      title: 'UNPROC',
      library_status: 'unprocessed',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: 'a3',
      title: 'DROP',
      library_status: 'discarded',
    });
    const all = exportLibraryAsJson({ scope: 'all', includeTranscript: false });
    expect(all.map((i) => i.title).sort()).toEqual(['PUB', 'UNPROC']);
    const pub = exportLibraryAsJson({ scope: 'published', includeTranscript: false });
    expect(pub.map((i) => i.title)).toEqual(['PUB']);
  });
});

describe('exportLibraryAsAnki', () => {
  it('emits header rows even when no videos match (so import does not break)', () => {
    const tsv = exportLibraryAsAnki({ scope: 'published', includeTranscript: false });
    expect(tsv).toContain('#separator:tab');
    expect(tsv).toContain('#html:true');
    expect(tsv).toContain('#columns:Front\tBack\tTags');
  });

  it('skips videos without an AI summary (Anki cards need a back side)', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000200',
      title: 'no summary yet',
      library_status: 'published',
      // summary missing
    });
    const tsv = exportLibraryAsAnki({ scope: 'published', includeTranscript: false });
    const dataLines = tsv.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(dataLines.filter(Boolean)).toHaveLength(0);
  });

  it('renders title \\t back \\t tags for videos with summary', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000201',
      title: 'How prompt caching works',
      summary: 'Caches the system prompt prefix; saves 90% tokens.',
      tags: '["ai","caching"]',
      chapters: '[{"startSec":0,"title":"intro"},{"startSec":120,"title":"how"}]',
      library_status: 'published',
    });
    const tsv = exportLibraryAsAnki({ scope: 'published', includeTranscript: false });
    const cards = tsv.split('\n').filter((l) => !l.startsWith('#') && l.length > 0);
    expect(cards).toHaveLength(1);
    const cols = cards[0].split('\t');
    expect(cols).toHaveLength(3);
    expect(cols[0]).toContain('How prompt caching works');
    expect(cols[1]).toContain('Caches the system prompt');
    expect(cols[1]).toContain('章节');
    expect(cols[1]).toContain('intro'); // chapter title
    expect(cols[1]).toContain('https://www.douyin.com/video/7000000000000000201');
    expect(cols[2]).toBe('ai caching');
  });

  it('escapes tabs and newlines in fields (TSV would otherwise break)', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000202',
      title: 'has\ttab and\nnewline',
      summary: 'a\tb\nc',
      tags: '["x"]',
      library_status: 'published',
    });
    const tsv = exportLibraryAsAnki({ scope: 'published', includeTranscript: false });
    const cards = tsv.split('\n').filter((l) => !l.startsWith('#') && l.length > 0);
    expect(cards).toHaveLength(1);
    expect(cards[0]).not.toContain('has\ttab'); // tabs in field replaced with spaces
    expect(cards[0]).toContain('<br>'); // newlines → <br> for HTML mode
  });

  it('sanitizes whitespace and quotes from tags (Anki tag delimiter is space)', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000203',
      title: 't',
      summary: 's',
      tags: '["multi word", "with\\"quote"]',
      library_status: 'published',
    });
    const tsv = exportLibraryAsAnki({ scope: 'published', includeTranscript: false });
    const cards = tsv.split('\n').filter((l) => !l.startsWith('#') && l.length > 0);
    expect(cards).toHaveLength(1);
    const cols = cards[0].split('\t');
    // Spaces and quotes both → underscore
    expect(cols[2]).toBe('multi_word with_quote');
  });

  it('respects scope filter (published-only does not export drafts)', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000204',
      title: 'PUB',
      summary: 's1',
      library_status: 'published',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000205',
      title: 'DRAFT',
      summary: 's2',
      library_status: 'draft',
    });
    const tsv = exportLibraryAsAnki({ scope: 'published', includeTranscript: false });
    expect(tsv).toContain('PUB');
    expect(tsv).not.toContain('DRAFT');
  });
});

describe('exportLibraryAsCsv', () => {
  it('emits header row even when no videos match', () => {
    const csv = exportLibraryAsCsv({ scope: 'published', includeTranscript: false });
    const firstLine = csv.split('\r\n')[0];
    expect(firstLine).toBe(
      'aweme_id,title,creator,duration_seconds,library_status,subtitle_source,tags,summary,url,updated_at',
    );
  });

  it('renders one row per matching video with the right columns', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000300',
      title: 'simple',
      creator_nickname: 'creator-a',
      duration_seconds: 90,
      library_status: 'published',
      subtitle_source: 'native',
      tags: '["ai","cache"]',
      summary: 'a summary',
    });
    const csv = exportLibraryAsCsv({ scope: 'published', includeTranscript: false });
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2); // header + 1
    const cols = lines[1].split(',');
    expect(cols[0]).toBe('7000000000000000300');
    expect(cols[1]).toBe('simple');
    expect(cols[2]).toBe('creator-a');
    expect(cols[3]).toBe('90');
    expect(cols[4]).toBe('published');
    expect(cols[5]).toBe('native');
    expect(cols[6]).toBe('ai; cache'); // tags joined with semicolon
    expect(cols[7]).toBe('a summary');
    expect(cols[8]).toBe('https://www.douyin.com/video/7000000000000000300');
  });

  it('quotes fields with commas / quotes / newlines per RFC 4180', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000301',
      title: 'has, comma',
      creator_nickname: 'has "quote" inside',
      duration_seconds: 30,
      library_status: 'published',
      subtitle_source: 'none',
      tags: '[]',
      summary: 'multi\nline',
    });
    const csv = exportLibraryAsCsv({ scope: 'published', includeTranscript: false });
    // Quotes wrap fields needing escape. Embedded quotes are doubled.
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('"has ""quote"" inside"');
    expect(csv).toContain('"multi\nline"');
  });

  it('uses CRLF line endings (RFC 4180)', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000302',
      title: 't',
      summary: 's',
      library_status: 'published',
    });
    const csv = exportLibraryAsCsv({ scope: 'published', includeTranscript: false });
    expect(csv).toMatch(/\r\n/);
    // No bare LF outside of quoted fields. (Quoted fields may contain \n;
    // we don't have any in this fixture, so any \n must be part of \r\n.)
    const bareLf = csv.match(/(?<!\r)\n/g);
    expect(bareLf).toBeNull();
  });

  it('respects scope: published-only excludes drafts and discarded', () => {
    const store = buildStore();
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000303',
      title: 'PUB',
      library_status: 'published',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000304',
      title: 'DRAFT',
      library_status: 'draft',
    });
    store.create(COLLECTION_VIDEOS, {
      aweme_id: '7000000000000000305',
      title: 'DISCARDED',
      library_status: 'discarded',
    });
    const csv = exportLibraryAsCsv({ scope: 'published', includeTranscript: false });
    expect(csv).toContain('PUB');
    expect(csv).not.toContain('DRAFT');
    expect(csv).not.toContain('DISCARDED');
  });
});
