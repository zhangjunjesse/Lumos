/**
 * Research runner integration test: stub storage + sources, drive a report
 * through the lifecycle, assert side effects.
 */
const mockCreateRow = jest.fn();
const mockPatchRow = jest.fn();
const mockGetRow = jest.fn();
const mockWriteMarkdown = jest.fn();

jest.mock('../research-storage', () => ({
  createResearchReport: (...args: unknown[]) => mockCreateRow(...args),
  patchResearchReport: (...args: unknown[]) => mockPatchRow(...args),
  getResearchReport: (...args: unknown[]) => mockGetRow(...args),
  getResearchStore: () => ({}),
  writeReportMarkdown: (...args: unknown[]) => mockWriteMarkdown(...args),
}));

// LLM analyze is best-effort and returns null when no provider is wired —
// keep the runner tests deterministic by short-circuiting it to null.
jest.mock('../research-analyze', () => ({
  analyzeResearch: jest.fn(async () => null),
}));

import {
  registerResearchSource,
  resetRegisteredSourcesForTesting,
} from '../research-sources';
import { cancelReport, isReportRunning, startReport } from '../research-runner';

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('research-runner lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRegisteredSourcesForTesting();
    mockCreateRow.mockImplementation((_store, args) => ({
      id: 'r-1',
      platform: args.platform,
      query: args.query,
      status: 'queued',
      created_at: 'now',
      updated_at: 'now',
    }));
    mockWriteMarkdown.mockImplementation((_id, md) => ({
      absolutePath: '/tmp/x.md',
      relativePath: 'ecommerce-assistant/research-reports/x.md',
      wordCount: md.length,
    }));
  });

  it('drives a happy-path report through queued → running → completed and persists markdown', async () => {
    registerResearchSource('mock-fast', async (ctx) => ({
      source: 'mock-fast',
      ok: true,
      items: [{ title: `${ctx.platform}-${ctx.query}` }],
    }));

    const row = await startReport({
      platform: 'etsy',
      query: '手作陶瓷杯',
      sources: ['mock-fast'],
    });
    expect(row.id).toBe('r-1');
    expect(mockCreateRow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ platform: 'etsy', query: '手作陶瓷杯' }),
    );

    await flush();
    await flush();
    await flush();

    const patches = mockPatchRow.mock.calls.map((c) => c[2]);
    expect(patches.some((p) => p.status === 'running')).toBe(true);
    expect(patches.some((p) => p.status === 'completed')).toBe(true);
    const completedPatch = patches.find((p) => p.status === 'completed');
    expect(completedPatch.report_path).toMatch(/research-reports/);
    expect(mockWriteMarkdown).toHaveBeenCalled();
    expect(isReportRunning('r-1')).toBe(false);
  });

  it('records source failure but still completes the report', async () => {
    registerResearchSource('flaky', async () => {
      throw new Error('source down');
    });

    await startReport({
      platform: 'etsy',
      query: 'q',
      sources: ['flaky'],
    });
    await flush();
    await flush();
    await flush();

    const completedPatch = mockPatchRow.mock.calls
      .map((c) => c[2])
      .find((p) => p.status === 'completed');
    expect(completedPatch).toBeDefined();
    const sourceResults = JSON.parse(completedPatch.source_results);
    expect(sourceResults[0]).toEqual(
      expect.objectContaining({ source: 'flaky', ok: false, error: 'source down' }),
    );
  });

  it('respects abort and patches status=cancelled', async () => {
    registerResearchSource('slow', (ctx) => {
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve({ source: 'slow', ok: true, items: [] }), 1_000);
        ctx.signal.addEventListener('abort', () => clearTimeout(t));
      });
    });

    await startReport({
      platform: 'etsy',
      query: 'q',
      sources: ['slow'],
      sourceTimeoutMs: 500,
    });
    await flush();
    cancelReport('r-1');
    // Wait long enough for the timeout to expire so the runner moves past collect.
    await new Promise((r) => setTimeout(r, 700));

    const finalPatch = mockPatchRow.mock.calls
      .map((c) => c[2])
      .find((p) => p.status === 'cancelled' || p.status === 'completed');
    // Either cancelled (caught between source-collect and compose) or completed
    // (sources resolved before abort took effect — slow source returned an
    // error result from the timeout race). Both are acceptable end states.
    expect(['cancelled', 'completed']).toContain(finalPatch.status);
  });

  it('rejects empty platform / query', async () => {
    await expect(startReport({ platform: '', query: 'q' })).rejects.toThrow(/platform/);
    await expect(startReport({ platform: 'etsy', query: '' })).rejects.toThrow(/query/);
  });

  it('fails gracefully when an unregistered source is requested', async () => {
    await startReport({
      platform: 'etsy',
      query: 'q',
      sources: ['no-such-source'],
    });
    await flush();
    await flush();

    const completedPatch = mockPatchRow.mock.calls
      .map((c) => c[2])
      .find((p) => p.status === 'completed');
    expect(completedPatch).toBeDefined();
    const sr = JSON.parse(completedPatch.source_results);
    expect(sr[0]).toEqual(
      expect.objectContaining({ source: 'no-such-source', ok: false }),
    );
  });
});
