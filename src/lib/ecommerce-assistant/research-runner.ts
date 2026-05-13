import {
  createResearchReport,
  getResearchReport,
  getResearchStore,
  patchResearchReport,
  writeReportMarkdown,
  type CreateResearchReportArgs,
  type ResearchReportRow,
} from './research-storage';
import {
  getRegisteredSource,
  getRegisteredSourceNames,
  type ResearchSourceContext,
  type ResearchSourceResult,
} from './research-sources';
import { composeResearchReport, type ResearchAnalysis } from './research-compose';
import { analyzeResearch } from './research-analyze';

const REGISTRY_KEY = '__lumos_ecommerce_research_registry';

interface RegistryState {
  controllers: Map<string, AbortController>;
}

function getState(): RegistryState {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = { controllers: new Map<string, AbortController>() };
  }
  return g[REGISTRY_KEY] as RegistryState;
}

export function isReportRunning(id: string): boolean {
  return getState().controllers.has(id);
}

export interface StartReportArgs extends CreateResearchReportArgs {
  // Override per-source timeout (ms). Default 60_000 (1 minute).
  sourceTimeoutMs?: number;
}

const DEFAULT_SOURCE_TIMEOUT_MS = 60_000;

export async function startReport(args: StartReportArgs): Promise<ResearchReportRow> {
  const platform = args.platform.trim();
  const query = args.query.trim();
  if (!platform) throw new Error('platform 不能为空');
  if (!query) throw new Error('query 不能为空');
  const store = getResearchStore();
  // Default to all three built-in sources. Each adapter politely skips when
  // its data isn't applicable to the current platform/query, so always
  // running them keeps the LLM's context complete.
  const sources = args.sources && args.sources.length > 0 ? args.sources : ['web', 'deepsearch', 'douyin'];
  const row = createResearchReport(store, {
    platform,
    query,
    instruction: args.instruction ?? null,
    sources,
  });
  void runReportInBackground(row.id, {
    platform,
    query,
    instruction: args.instruction ?? null,
    sources,
    sourceTimeoutMs: args.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS,
  });
  return row;
}

interface RunArgs {
  platform: string;
  query: string;
  instruction: string | null;
  sources: string[];
  sourceTimeoutMs: number;
}

async function runReportInBackground(id: string, args: RunArgs): Promise<void> {
  const state = getState();
  if (state.controllers.has(id)) return;
  const controller = new AbortController();
  state.controllers.set(id, controller);
  const store = getResearchStore();
  try {
    patchResearchReport(store, id, {
      status: 'running',
      stage: 'collecting',
      started_at: new Date().toISOString(),
      progress: 5,
    });

    const sourceResults = await collectAllSources({
      platform: args.platform,
      query: args.query,
      instruction: args.instruction,
      sources: args.sources,
      sourceTimeoutMs: args.sourceTimeoutMs,
      signal: controller.signal,
    });

    if (controller.signal.aborted) {
      throw new ResearchAbortError();
    }

    patchResearchReport(store, id, { stage: 'analyzing', progress: 50 });

    let analysis: ResearchAnalysis | null = null;
    try {
      analysis = await analyzeResearch({
        platform: args.platform,
        query: args.query,
        instruction: args.instruction,
        sourceResults,
        signal: controller.signal,
      });
    } catch {
      // LLM hard-failure (timeout, schema, network) — fall through with
      // template-only report so users still get the raw data dump. The
      // missing "AI 洞察" section is itself the visible signal.
      analysis = null;
    }

    if (controller.signal.aborted) {
      throw new ResearchAbortError();
    }

    patchResearchReport(store, id, { stage: 'composing', progress: 80 });

    const composed = composeResearchReport({
      platform: args.platform,
      query: args.query,
      instruction: args.instruction,
      sourceResults,
      analysis,
    });

    if (controller.signal.aborted) {
      throw new ResearchAbortError();
    }

    const persisted = writeReportMarkdown(id, composed.markdown);

    patchResearchReport(store, id, {
      status: 'completed',
      stage: 'done',
      progress: 100,
      source_results: JSON.stringify(serializeSourceResults(sourceResults)),
      summary: composed.summary,
      report_path: persisted.relativePath,
      word_count: persisted.wordCount,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof ResearchAbortError) {
      patchResearchReport(store, id, {
        status: 'cancelled',
        stage: 'cancelled',
        error: '任务被取消',
        failure_stage: 'cancelled',
        completed_at: new Date().toISOString(),
      });
    } else {
      const reason = err instanceof Error ? err.message : String(err);
      patchResearchReport(store, id, {
        status: 'failed',
        stage: 'error',
        error: reason,
        failure_stage: 'unknown',
        completed_at: new Date().toISOString(),
      });
    }
  } finally {
    state.controllers.delete(id);
  }
}

export function cancelReport(id: string): boolean {
  const controller = getState().controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

interface CollectArgs {
  platform: string;
  query: string;
  instruction: string | null;
  sources: string[];
  sourceTimeoutMs: number;
  signal: AbortSignal;
}

async function collectAllSources(args: CollectArgs): Promise<ResearchSourceResult[]> {
  // Run sources in parallel; each one is bounded by its own timeout.
  // Failed/timed-out sources record an error result rather than aborting the report.
  return Promise.all(
    args.sources.map(async (sourceName) => {
      const adapter = getRegisteredSource(sourceName);
      if (!adapter) {
        return {
          source: sourceName,
          ok: false,
          items: [],
          error: `未注册数据源 ${sourceName}（可用：${getRegisteredSourceNames().join(', ')}）`,
        } satisfies ResearchSourceResult;
      }
      const started = Date.now();
      try {
        const result = await withTimeout(
          adapter(makeContext(args, args.signal)),
          args.sourceTimeoutMs,
          sourceName,
        );
        return { ...result, latency_ms: Date.now() - started };
      } catch (err) {
        return {
          source: sourceName,
          ok: false,
          items: [],
          error: err instanceof Error ? err.message : String(err),
          latency_ms: Date.now() - started,
        } satisfies ResearchSourceResult;
      }
    }),
  );
}

function makeContext(args: CollectArgs, signal: AbortSignal): ResearchSourceContext {
  return {
    platform: args.platform,
    query: args.query,
    instruction: args.instruction,
    signal,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超过 ${ms}ms 未返回`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function serializeSourceResults(results: ResearchSourceResult[]): Array<Omit<ResearchSourceResult, 'items'> & { item_count: number }> {
  // Don't persist potentially-large item arrays into the row JSON; the full
  // content lives in the markdown file. Keep the per-source diagnostic shape.
  return results.map((r) => ({
    source: r.source,
    ok: r.ok,
    error: r.error,
    latency_ms: r.latency_ms,
    item_count: r.items.length,
  }));
}

class ResearchAbortError extends Error {
  constructor() {
    super('research aborted');
    this.name = 'ResearchAbortError';
  }
}

// Convenience accessor for callers that need to know the report's current state.
export function getReportSnapshot(id: string): ResearchReportRow | null {
  return getResearchReport(getResearchStore(), id);
}
