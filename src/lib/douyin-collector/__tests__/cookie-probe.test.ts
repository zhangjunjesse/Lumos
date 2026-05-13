import Database from 'better-sqlite3';

import { DOUYIN_COLLECTOR_APP_ID } from '../constants';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

let _db: Database.Database | null = null;
let _settings = stubSettings();
const _markCookieOk = jest.fn();

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getDouyinCollectorStore: () => storeForTests(),
  };
});

jest.mock('../settings', () => ({
  getDouyinCollectorSettings: () => _settings,
  markCookieOk: (now?: Date) => _markCookieOk(now),
}));

import { probeCookie, runScheduledCookieProbe } from '../cookie-probe';

function storeForTests() {
  if (!_db) throw new Error('test db not initialised');
  return createAppDataStore(_db, DOUYIN_COLLECTOR_APP_ID);
}

function stubSettings(overrides: Partial<typeof _settings> = {}) {
  return {
    cookie: '',
    cookieCheckedAt: null as string | null,
    cookieLastOkAt: null as string | null,
    transcribePrefer: 'allow-asr',
    longVideoSplitMinutes: 10,
    transcribeConcurrency: 3,
    libraryCollectionId: null,
    autoPublish: false,
    autoSummarize: false,
    autoTranscribe: false,
    aiSummaryPrompt: '',
    aiChaptersPrompt: '',
    aiTagsPrompt: '',
    riskNote: '',
    ...overrides,
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
  _settings = stubSettings();
  _markCookieOk.mockReset();
});

describe('probeCookie', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=false with structured message when cookie is empty', async () => {
    const r = await probeCookie('');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('尚未配置');
  });

  it('returns ok=true on HTTP 200', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof globalThis.fetch;
    const r = await probeCookie('fake-cookie');
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  });

  it('returns ok=false on 3xx (interpreted as expired cookie)', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 302 })) as unknown as typeof globalThis.fetch;
    const r = await probeCookie('fake-cookie');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(302);
    expect(r.message).toContain('过期');
  });

  it('returns ok=false on 4xx with bodyPreview', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('blocked by risk control', { status: 403 })) as unknown as typeof globalThis.fetch;
    const r = await probeCookie('fake-cookie');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.bodyPreview).toContain('blocked');
  });

  it('catches network errors without throwing', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof globalThis.fetch;
    const r = await probeCookie('fake-cookie');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('ECONNRESET');
  });
});

describe('runScheduledCookieProbe — cooldown gate', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns "unconfigured" when no cookie set; never calls fetch', async () => {
    _settings = stubSettings({ cookie: '' });
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    expect(await runScheduledCookieProbe()).toBe('unconfigured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns "skipped" when last ok < 1h ago — saves the rate-limit budget', async () => {
    const now = new Date('2026-05-10T12:00:00Z');
    _settings = stubSettings({
      cookie: 'c',
      cookieLastOkAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
    });
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    expect(await runScheduledCookieProbe(now)).toBe('skipped');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(_markCookieOk).not.toHaveBeenCalled();
  });

  it('probes when last ok > 1h ago; on success markCookieOk and no run_history entry', async () => {
    const now = new Date('2026-05-10T12:00:00Z');
    _settings = stubSettings({
      cookie: 'c',
      cookieLastOkAt: new Date(now.getTime() - 90 * 60_000).toISOString(),
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof globalThis.fetch;
    expect(await runScheduledCookieProbe(now)).toBe('ok');
    expect(_markCookieOk).toHaveBeenCalledTimes(1);
    const store = storeForTests();
    expect(store.query('run_history')).toHaveLength(0);
  });

  it('on probe failure: returns "failed" and writes ONE run_history entry', async () => {
    _settings = stubSettings({ cookie: 'c', cookieLastOkAt: null });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 401 })) as unknown as typeof globalThis.fetch;
    expect(await runScheduledCookieProbe()).toBe('failed');
    expect(_markCookieOk).not.toHaveBeenCalled();
    const store = storeForTests();
    const history = store.query<{ status: string; title?: string; failure_reason?: string }>(
      'run_history',
    );
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('failed');
    expect(history[0].title).toContain('Cookie');
    expect(history[0].failure_reason).toContain('401');
  });

  it('probes on first ever run (cookieLastOkAt is null)', async () => {
    _settings = stubSettings({ cookie: 'c', cookieLastOkAt: null });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof globalThis.fetch;
    expect(await runScheduledCookieProbe()).toBe('ok');
    expect(_markCookieOk).toHaveBeenCalledTimes(1);
  });

  it('parallel calls coalesce — only one fetch even with 5 concurrent invocations', async () => {
    _settings = stubSettings({ cookie: 'c', cookieLastOkAt: null });
    const fetchSpy = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;
    const results = await Promise.all([
      runScheduledCookieProbe(),
      runScheduledCookieProbe(),
      runScheduledCookieProbe(),
      runScheduledCookieProbe(),
      runScheduledCookieProbe(),
    ]);
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    // Single fetch — coalesced via in-flight promise tracking
    expect((fetchSpy as jest.Mock).mock.calls).toHaveLength(1);
    expect(_markCookieOk).toHaveBeenCalledTimes(1);
  });

  it('parallel failures coalesce — only one run_history failure entry', async () => {
    _settings = stubSettings({ cookie: 'c', cookieLastOkAt: null });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 401 })) as unknown as typeof globalThis.fetch;
    await Promise.all([
      runScheduledCookieProbe(),
      runScheduledCookieProbe(),
      runScheduledCookieProbe(),
    ]);
    const store = storeForTests();
    const history = store.query<{ status: string }>('run_history');
    expect(history).toHaveLength(1); // not 3
  });
});
