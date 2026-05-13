/**
 * Settings store round-trip + helper tests.
 *
 * Mocks `@/lib/db` so we don't need the real Lumos SQLite — keeps the
 * settings module's behavior pinned even if the underlying KV impl
 * changes.
 */

const kv = new Map<string, string>();
let mockCollections: Array<{ id: string; name: string; description: string; created_at: number; updated_at: number }> = [];

const mockDb = {
  prepare: (sql: string) => ({
    get: (name: string) => {
      if (sql.includes('FROM kb_collections WHERE name = ?')) {
        return mockCollections
          .filter((collection) => collection.name === name)
          .sort((a, b) => b.created_at - a.created_at)
          .at(0);
      }
      return undefined;
    },
    run: (id: string, name: string, description: string, createdAt: number, updatedAt: number) => {
      if (sql.includes('INSERT INTO kb_collections')) {
        mockCollections.push({ id, name, description, created_at: createdAt, updated_at: updatedAt });
      }
    },
  }),
};

jest.mock('@/lib/db', () => ({
  getDb: () => mockDb,
  getSetting: (k: string) => (kv.has(k) ? kv.get(k) : null),
  setSetting: (k: string, v: string) => {
    kv.set(k, v);
  },
}));

import {
  getDouyinCollectorSettings,
  markCookieOk,
  updateDouyinCollectorSettings,
} from '../settings';

beforeEach(() => {
  kv.clear();
  mockCollections = [{
    id: 'web-search-col',
    name: '联网搜索资料',
    description: '由 DeepSearch 自动归档的网页内容，来自知乎、微信公众号、小红书、掘金等',
    created_at: 1,
    updated_at: 1,
  }];
});

describe('getDouyinCollectorSettings — defaults', () => {
  it('returns sensible defaults when nothing is saved', () => {
    const s = getDouyinCollectorSettings();
    expect(s.cookie).toBe('');
    expect(s.cookieCheckedAt).toBeNull();
    expect(s.cookieLastOkAt).toBeNull();
    expect(s.transcribePrefer).toBe('allow-asr');
    expect(s.longVideoSplitMinutes).toBe(10);
    expect(s.transcribeConcurrency).toBe(3);
    expect(s.libraryCollectionId).toBe('web-search-col');
    expect(s.autoPublish).toBe(false);
    expect(s.autoSummarize).toBe(false);
    expect(s.autoTranscribe).toBe(false);
    expect(typeof s.aiSummaryPrompt).toBe('string');
    expect(s.aiSummaryPrompt.length).toBeGreaterThan(0);
    expect(typeof s.riskNote).toBe('string');
  });
});

describe('updateDouyinCollectorSettings — round-trip', () => {
  it('writes back exactly what was set; subsequent get reads same values', () => {
    updateDouyinCollectorSettings({
      cookie: '  fake-cookie  ', // verify trimming
      transcribePrefer: 'force-local-asr',
      longVideoSplitMinutes: 15,
      transcribeConcurrency: 5,
      libraryCollectionId: 'col-123',
      autoPublish: true,
      autoSummarize: true,
      autoTranscribe: true,
      aiSummaryPrompt: 'short',
      aiChaptersPrompt: 'chap',
      aiTagsPrompt: 'tags',
      riskNote: 'risks',
    });
    const s = getDouyinCollectorSettings();
    expect(s.cookie).toBe('fake-cookie');
    expect(s.cookieCheckedAt).not.toBeNull(); // saving sets timestamp
    expect(s.transcribePrefer).toBe('force-local-asr');
    expect(s.longVideoSplitMinutes).toBe(15);
    expect(s.transcribeConcurrency).toBe(5);
    expect(s.libraryCollectionId).toBe('col-123');
    expect(s.autoPublish).toBe(true);
    expect(s.autoSummarize).toBe(true);
    expect(s.autoTranscribe).toBe(true);
    expect(s.aiSummaryPrompt).toBe('short');
    expect(s.aiChaptersPrompt).toBe('chap');
    expect(s.aiTagsPrompt).toBe('tags');
    expect(s.riskNote).toBe('risks');
  });

  it('libraryCollectionId=null clears the saved value and falls back to web-search collection', () => {
    updateDouyinCollectorSettings({ libraryCollectionId: 'a' });
    expect(getDouyinCollectorSettings().libraryCollectionId).toBe('a');
    updateDouyinCollectorSettings({ libraryCollectionId: null });
    expect(getDouyinCollectorSettings().libraryCollectionId).toBe('web-search-col');
  });

  it('creates the web-search collection when a fresh database does not have one', () => {
    mockCollections = [];
    const s = getDouyinCollectorSettings();
    expect(s.libraryCollectionId).toMatch(/^douyin_default_/);
    expect(mockCollections).toEqual([
      expect.objectContaining({
        id: s.libraryCollectionId,
        name: '联网搜索资料',
      }),
    ]);
  });

  it('rejects invalid transcribePrefer (default applies)', () => {
    updateDouyinCollectorSettings({
      transcribePrefer: 'BOGUS' as never,
    });
    expect(getDouyinCollectorSettings().transcribePrefer).toBe('allow-asr');
  });
});

describe('markCookieOk', () => {
  it('writes cookieLastOkAt as ISO timestamp', () => {
    expect(getDouyinCollectorSettings().cookieLastOkAt).toBeNull();
    const fixed = new Date('2026-05-10T12:34:56Z');
    markCookieOk(fixed);
    const s = getDouyinCollectorSettings();
    expect(s.cookieLastOkAt).toBe('2026-05-10T12:34:56.000Z');
  });

  it('overwrites previous cookieLastOkAt on subsequent calls', () => {
    markCookieOk(new Date('2026-05-09T08:00:00Z'));
    markCookieOk(new Date('2026-05-10T08:00:00Z'));
    expect(getDouyinCollectorSettings().cookieLastOkAt).toBe(
      '2026-05-10T08:00:00.000Z',
    );
  });
});

describe('updateDouyinCollectorSettings — cookie identity invariants', () => {
  it('clears cookieLastOkAt when cookie value changes (Round 150)', () => {
    // Old cookie passed a probe in the past...
    updateDouyinCollectorSettings({ cookie: 'old-cookie' });
    markCookieOk(new Date('2026-05-09T08:00:00Z'));
    expect(getDouyinCollectorSettings().cookieLastOkAt).toBe(
      '2026-05-09T08:00:00.000Z',
    );
    // User pastes a new cookie. The "OK at 5/9" timestamp belongs to
    // the OLD value and must not haunt the new one.
    updateDouyinCollectorSettings({ cookie: 'new-cookie' });
    expect(getDouyinCollectorSettings().cookieLastOkAt).toBeNull();
  });

  it('preserves cookieLastOkAt when cookie value is unchanged on save', () => {
    // Re-saving the same value (e.g. user clicks save without editing)
    // is not a state change worth invalidating.
    updateDouyinCollectorSettings({ cookie: 'cookie-a' });
    markCookieOk(new Date('2026-05-09T08:00:00Z'));
    updateDouyinCollectorSettings({ cookie: 'cookie-a' });
    expect(getDouyinCollectorSettings().cookieLastOkAt).toBe(
      '2026-05-09T08:00:00.000Z',
    );
  });

  it('treats whitespace-only differences as no-change (trim is canonical)', () => {
    updateDouyinCollectorSettings({ cookie: 'cookie-a' });
    markCookieOk(new Date('2026-05-09T08:00:00Z'));
    updateDouyinCollectorSettings({ cookie: '  cookie-a  ' });
    expect(getDouyinCollectorSettings().cookieLastOkAt).toBe(
      '2026-05-09T08:00:00.000Z',
    );
  });

  it('clears cookieLastOkAt when user clears the cookie entirely', () => {
    updateDouyinCollectorSettings({ cookie: 'cookie-a' });
    markCookieOk(new Date('2026-05-09T08:00:00Z'));
    updateDouyinCollectorSettings({ cookie: '' });
    expect(getDouyinCollectorSettings().cookieLastOkAt).toBeNull();
  });
});

describe('updateDouyinCollectorSettings — autoPublish ↔ libraryCollectionId invariant (Round 172)', () => {
  it('clears autoPublish when libraryCollectionId is cleared', () => {
    // Setup: autoPublish=true with a valid collection.
    updateDouyinCollectorSettings({
      libraryCollectionId: 'col-A',
      autoTranscribe: true,
      autoPublish: true,
    });
    expect(getDouyinCollectorSettings().autoPublish).toBe(true);
    // User removes the collection. autoPublish has no meaning without
    // one — keep persisted state honest with what maybeAutoPublish
    // will actually do.
    updateDouyinCollectorSettings({ libraryCollectionId: null });
    expect(getDouyinCollectorSettings().libraryCollectionId).toBe('web-search-col');
    expect(getDouyinCollectorSettings().autoPublish).toBe(false);
  });

  it('preserves autoPublish when libraryCollectionId is replaced (not cleared)', () => {
    updateDouyinCollectorSettings({
      libraryCollectionId: 'col-A',
      autoTranscribe: true,
      autoPublish: true,
    });
    updateDouyinCollectorSettings({ libraryCollectionId: 'col-B' });
    expect(getDouyinCollectorSettings().autoPublish).toBe(true);
    expect(getDouyinCollectorSettings().libraryCollectionId).toBe('col-B');
  });
});
