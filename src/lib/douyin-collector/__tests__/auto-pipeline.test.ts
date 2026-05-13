import Database from 'better-sqlite3';

import { DOUYIN_COLLECTOR_APP_ID } from '../constants';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

let _db: Database.Database | null = null;
let _autoTranscribe = false;

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
    autoTranscribe: _autoTranscribe,
    aiSummaryPrompt: '',
    aiChaptersPrompt: '',
    aiTagsPrompt: '',
    riskNote: '',
  }),
}));

jest.mock('../transcribe', () => ({
  transcribeVideoFromNative: jest.fn(),
}));

import { transcribeVideoFromNative as mockedTranscribe } from '../transcribe';
import { maybeRunAutoPipeline } from '../auto-pipeline';

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
  _autoTranscribe = false;
  (mockedTranscribe as jest.Mock).mockReset();
});

describe('maybeRunAutoPipeline', () => {
  it('is a no-op when autoTranscribe is off — never calls transcribe', async () => {
    _autoTranscribe = false;
    const result = await maybeRunAutoPipeline(['v1', 'v2', 'v3']);
    expect(mockedTranscribe).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
      skipReason: 'auto_transcribe_disabled',
    });
  });

  it('is a no-op for empty input even when enabled', async () => {
    _autoTranscribe = true;
    const result = await maybeRunAutoPipeline([]);
    expect(mockedTranscribe).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
      skipReason: 'empty',
    });
  });

  it('processes each id sequentially and writes a single rolled-up run_history success', async () => {
    _autoTranscribe = true;
    (mockedTranscribe as jest.Mock).mockResolvedValue({ ok: true, segments: [] });

    const result = await maybeRunAutoPipeline(['v1', 'v2', 'v3']);

    expect(mockedTranscribe).toHaveBeenCalledTimes(3);
    expect(mockedTranscribe).toHaveBeenNthCalledWith(1, 'v1');
    expect(mockedTranscribe).toHaveBeenNthCalledWith(2, 'v2');
    expect(mockedTranscribe).toHaveBeenNthCalledWith(3, 'v3');

    const store = storeForTests();
    const history = store.query<{ status: string; summary: string; title: string }>(
      'run_history',
      { orderBy: { field: 'updated_at', direction: 'desc' } },
    );
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('success');
    expect(history[0].title).toContain('自动管线');
    expect(history[0].summary).toContain('3 / 3');
    expect(history[0].summary).toContain('自动总结关闭');
    expect(history[0].summary).toContain('自动入库关闭');
    expect(result).toMatchObject({
      attempted: 3,
      succeeded: 3,
      failed: 0,
      skipped: false,
    });
  });

  it('per-video failure does NOT abort the queue — succeeds 2/3 and reports failure_reason', async () => {
    _autoTranscribe = true;
    (mockedTranscribe as jest.Mock)
      .mockResolvedValueOnce({ ok: true, segments: [] })
      .mockResolvedValueOnce({ ok: false, reason: 'cookie expired' })
      .mockResolvedValueOnce({ ok: true, segments: [] });

    await maybeRunAutoPipeline(['v1', 'v2', 'v3']);

    expect(mockedTranscribe).toHaveBeenCalledTimes(3);

    const store = storeForTests();
    const history = store.query<{
      status: string;
      summary: string;
      failure_reason: string | null;
    }>('run_history', { orderBy: { field: 'updated_at', direction: 'desc' } });
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('failed');
    expect(history[0].summary).toContain('2 成功');
    expect(history[0].summary).toContain('1 失败');
    expect(history[0].summary).toContain('cookie expired');
  });

  it('thrown errors from transcribe are caught and counted as failures', async () => {
    _autoTranscribe = true;
    (mockedTranscribe as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, segments: [] });

    await maybeRunAutoPipeline(['v1', 'v2']);

    const store = storeForTests();
    const history = store.query<{ status: string; summary: string }>('run_history');
    expect(history[0].status).toBe('failed');
    expect(history[0].summary).toContain('boom');
  });

  it('dedups failure reasons in the rolled-up summary (caps at 3 distinct)', async () => {
    _autoTranscribe = true;
    (mockedTranscribe as jest.Mock)
      .mockResolvedValueOnce({ ok: false, reason: 'A' })
      .mockResolvedValueOnce({ ok: false, reason: 'A' })
      .mockResolvedValueOnce({ ok: false, reason: 'B' })
      .mockResolvedValueOnce({ ok: false, reason: 'C' })
      .mockResolvedValueOnce({ ok: false, reason: 'D' });

    await maybeRunAutoPipeline(['v1', 'v2', 'v3', 'v4', 'v5']);

    const store = storeForTests();
    const history = store.query<{ summary: string }>('run_history');
    // 'A' appears once (deduped). Cap at 3 distinct so 'D' is dropped.
    const matchA = history[0].summary.match(/A/g) ?? [];
    expect(matchA.length).toBe(1);
    expect(history[0].summary).toContain('B');
    expect(history[0].summary).toContain('C');
    expect(history[0].summary).not.toContain('D');
  });

  it('runs concurrently up to transcribeConcurrency=3 (Round 12 fix) — sequential loop would be slow', async () => {
    _autoTranscribe = true;
    // Track in-flight count over time. Each transcribe takes 50ms; with
    // 6 ids and concurrency=3, peak in-flight should hit 3 (not 1, which
    // is what the old sequential loop produced).
    let inFlight = 0;
    let peakInFlight = 0;
    (mockedTranscribe as jest.Mock).mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return { ok: true, segments: [] };
    });

    await maybeRunAutoPipeline(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);

    expect(mockedTranscribe).toHaveBeenCalledTimes(6);
    // Sequential would peak at 1; bounded pool at concurrency=3 must
    // hit exactly 3 (or close to it under jest fake-timer jitter).
    expect(peakInFlight).toBeGreaterThanOrEqual(3);
    expect(peakInFlight).toBeLessThanOrEqual(3);
  });
});
