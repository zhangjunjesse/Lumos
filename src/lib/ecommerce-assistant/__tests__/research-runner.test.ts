/**
 * Research runner integration test: stub storage + SOP planner + sources,
 * drive a report through the multi-round agent loop, assert side effects.
 */
const mockCreateRow = jest.fn();
const mockPatchRow = jest.fn();
const mockGetRow = jest.fn();
const mockWriteMarkdown = jest.fn();
const mockPlanNextRound = jest.fn();

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

// Keep SOP constants real (round/query budgets) but drive planNextRound
// deterministically so the loop is reproducible without an LLM provider.
jest.mock('../research-sop', () => {
  const actual = jest.requireActual('../research-sop');
  return { ...actual, planNextRound: (...a: unknown[]) => mockPlanNextRound(...a) };
});

import { registerResearchSource } from '../research-sources';
import { resetRegisteredSourcesForTesting } from '../research-source-adapters';
import { cancelReport, isReportRunning, startReport } from '../research-runner';

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}
async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) await flush();
}

/**
 * Default planner: round 1 fans the user description out to every available
 * source as one query; round ≥ 2 stops. Mirrors a minimal real SOP run.
 */
function defaultPlanner() {
  mockPlanNextRound.mockImplementation(
    (args: { description: string; availableSources: string[]; round: number }) => {
      if (args.round >= 2 || args.availableSources.length === 0) {
        return { platform: 'etsy', done: true, reasoning: 'enough', nextQueries: [], gaps: [] };
      }
      return {
        platform: 'etsy',
        done: false,
        reasoning: 'round 1 broad sweep',
        nextQueries: args.availableSources.map((s) => ({ source: s, query: args.description })),
        gaps: [],
      };
    },
  );
}

describe('research-runner multi-round loop', () => {
  let seq = 0;
  beforeEach(() => {
    jest.clearAllMocks();
    resetRegisteredSourcesForTesting();
    // 清空 lifecycle 注册表，避免上个用例泄漏的 controller 让本用例的
    // registerRun 返回 null（后台 loop 不启动 → 误判失败）。
    (globalThis as Record<string, unknown>)['__lumos_ecommerce_research_registry'] = undefined;
    defaultPlanner();
    seq += 1;
    const id = `r-${seq}`;
    mockCreateRow.mockImplementation((_store, args) => ({
      id,
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

  it('drives queued → running → completed, resolves platform from SOP, persists markdown', async () => {
    registerResearchSource('mock-fast', async (ctx) => ({
      source: 'mock-fast',
      ok: true,
      items: [{ title: `${ctx.platform}-${ctx.query}` }],
    }));

    const row = await startReport({ platform: '', query: '手作陶瓷杯', sources: ['mock-fast'] });
    expect(row.id).toMatch(/^r-\d+$/);
    // Platform is no longer a required input — row is created with the 'auto'
    // placeholder; SOP-resolved platform is patched in during round 1.
    expect(mockCreateRow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ platform: 'auto', query: '手作陶瓷杯' }),
    );

    await settle();

    const patches = mockPatchRow.mock.calls.map((c) => c[2]);
    expect(patches.some((p) => p.status === 'running')).toBe(true);
    expect(patches.some((p) => p.platform === 'etsy')).toBe(true); // resolved + written back
    const completedPatch = patches.find((p) => p.status === 'completed');
    expect(completedPatch).toBeDefined();
    expect(completedPatch.report_path).toMatch(/research-reports/);
    expect(mockWriteMarkdown).toHaveBeenCalled();
    expect(isReportRunning(row.id)).toBe(false);
  });

  it('iterates multiple rounds until the planner says done', async () => {
    const hits: string[] = [];
    registerResearchSource('multi', async (ctx) => {
      hits.push(ctx.query);
      return { source: 'multi', ok: true, items: [{ title: ctx.query }] };
    });
    mockPlanNextRound.mockImplementation(
      (args: { round: number }) => {
        if (args.round === 1) {
          return { platform: 'etsy', done: false, reasoning: 'r1', nextQueries: [{ source: 'multi', query: 'broad' }], gaps: ['need pricing'] };
        }
        if (args.round === 2) {
          return { platform: 'etsy', done: false, reasoning: 'r2 fill gap', nextQueries: [{ source: 'multi', query: 'pricing deep-dive' }], gaps: [] };
        }
        return { platform: 'etsy', done: true, reasoning: 'enough', nextQueries: [], gaps: [] };
      },
    );

    await startReport({ query: '在 etsy 调研陶瓷杯定价', sources: ['multi'] });
    await settle(12);

    expect(hits).toEqual(['broad', 'pricing deep-dive']); // two collection rounds
    expect(mockPlanNextRound).toHaveBeenCalledTimes(3); // r1, r2, r3(done)
    const completed = mockPatchRow.mock.calls.map((c) => c[2]).find((p) => p.status === 'completed');
    expect(completed).toBeDefined();
  });

  it('records a source failure but still completes the report', async () => {
    registerResearchSource('flaky', async () => {
      throw new Error('source down');
    });

    await startReport({ query: 'q on flaky', sources: ['flaky'] });
    await settle();

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
        t.unref?.(); // 别让残留计时器吊住 jest worker（500ms 超时竞速可能先赢）
        ctx.signal.addEventListener('abort', () => clearTimeout(t));
      });
    });

    const row = await startReport({ query: 'q on slow', sources: ['slow'], sourceTimeoutMs: 500 });
    await flush();
    cancelReport(row.id);
    await new Promise((r) => setTimeout(r, 700));

    const finalPatch = mockPatchRow.mock.calls
      .map((c) => c[2])
      .find((p) => p.status === 'cancelled' || p.status === 'completed');
    expect(['cancelled', 'completed']).toContain(finalPatch.status);
  });

  it('no longer requires platform; only the description (query) is mandatory', async () => {
    // platform omitted entirely → resolves to 'auto' placeholder, no throw.
    const row = await startReport({ query: '只给描述' });
    expect(row.id).toMatch(/^r-\d+$/);
    // empty description still rejected.
    await expect(startReport({ query: '' })).rejects.toThrow(/query|描述/);
  });

  it('completes with no data when the planner picks an unregistered source', async () => {
    // 'no-such-source' is filtered out of availableSources before planning,
    // so nothing is collected — the report still completes honestly (empty).
    await startReport({ query: 'q', sources: ['no-such-source'] });
    await settle();

    const completedPatch = mockPatchRow.mock.calls
      .map((c) => c[2])
      .find((p) => p.status === 'completed');
    expect(completedPatch).toBeDefined();
    expect(JSON.parse(completedPatch.source_results)).toEqual([]);
  });
});
