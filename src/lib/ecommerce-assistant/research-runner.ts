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
  countDataItems,
  getRegisteredSource,
  getRegisteredSourceNames,
  type ResearchSourceContext,
  type ResearchSourceResult,
} from './research-sources';
import { composeResearchReport, type ResearchAnalysis } from './research-compose';
import { analyzeResearch } from './research-analyze';
import { registerRun, unregisterRun } from './research-lifecycle';
import {
  MAX_RESEARCH_ROUNDS,
  MAX_QUERIES_PER_ROUND,
  planNextRound,
  type RoundDigest,
} from './research-sop';
// Side-effect: 加载内置 adapter 模块 → 其底部自注册 web/deepsearch/douyin。
// research-sources 已不再 import adapters（保持单向依赖），由编排入口触发。
import './research-source-adapters';

// 生命周期（取消 / 终态对账 / 删除前取消）集中在 research-lifecycle。
// 这里 re-export 以保持既有 import 路径（cancel route / mcp-server / 测试）不变。
export { cancelReport, isReportRunning } from './research-lifecycle';

export interface StartReportArgs extends CreateResearchReportArgs {
  // Override per-source timeout (ms). Default 60_000 (1 minute).
  sourceTimeoutMs?: number;
}

const DEFAULT_SOURCE_TIMEOUT_MS = 60_000;

export async function startReport(args: StartReportArgs): Promise<ResearchReportRow> {
  // 平台不再是独立必填项——它写在用户的自然语言描述（query）里，由 SOP
  // planner 首轮抽取。空缺时占位 'auto'，runner 解析后回写真实平台。
  const platform = (args.platform ?? '').trim() || 'auto';
  const query = args.query.trim();
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
  // 同步登记 controller：在 startReport 返回前注册表已就绪，消除「行已建、
  // controller 未注册」与并发对账之间的竞态。
  const controller = registerRun(row.id);
  if (controller) {
    void runReportInBackground(row.id, controller, {
      platform,
      query,
      instruction: args.instruction ?? null,
      sources,
      sourceTimeoutMs: args.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS,
    });
  }
  return row;
}

interface RunArgs {
  platform: string;
  query: string;
  instruction: string | null;
  sources: string[];
  sourceTimeoutMs: number;
}

async function runReportInBackground(
  id: string,
  controller: AbortController,
  args: RunArgs,
): Promise<void> {
  const store = getResearchStore();
  try {
    patchResearchReport(store, id, {
      status: 'running',
      stage: 'collecting',
      started_at: new Date().toISOString(),
      progress: 5,
    });

    // 多轮 planner-executor 循环：SOP 每轮决定平台/检索，跑 adapter 累积
    // corpus，直到 done 或撞轮次预算。平台从用户描述里抽（不再有平台字段）。
    const registered = getRegisteredSourceNames();
    const availableSources =
      args.sources && args.sources.length > 0
        ? args.sources.filter((s) => registered.includes(s))
        : registered;
    let resolvedPlatform =
      args.platform && args.platform !== 'auto' ? args.platform : '';
    const digests: RoundDigest[] = [];
    const accumulated: ResearchSourceResult[] = [];

    for (let round = 1; round <= MAX_RESEARCH_ROUNDS; round += 1) {
      if (controller.signal.aborted) throw new ResearchAbortError();
      const plan = await planNextRound({
        description: args.query,
        instruction: args.instruction,
        availableSources,
        digests,
        round,
        abortSignal: controller.signal,
      });
      if (!resolvedPlatform) {
        resolvedPlatform = (plan.platform || 'general').trim() || 'general';
      }
      if (round === 1) {
        // 把 SOP 抽出的真实平台回写行，列表不再显示占位 'auto'。
        patchResearchReport(store, id, { platform: resolvedPlatform });
      }
      const pairs = plan.nextQueries
        .filter((q) => availableSources.includes(q.source))
        .slice(0, MAX_QUERIES_PER_ROUND);
      if (plan.done || pairs.length === 0) break;

      const roundResults = await runRoundQueries(
        pairs,
        resolvedPlatform,
        args.instruction,
        args.sourceTimeoutMs,
        controller.signal,
      );
      accumulated.push(...roundResults);
      roundResults.forEach((r, i) => {
        digests.push({
          round,
          source: r.source,
          query: pairs[i].query,
          dataItems: countDataItems(r),
          sampleTitles: r.items
            .filter((it) => it.kind !== 'notice')
            .slice(0, 5)
            .map((it) => it.title),
        });
      });
      patchResearchReport(store, id, {
        stage: 'collecting',
        progress: Math.min(50, 5 + Math.round((round / MAX_RESEARCH_ROUNDS) * 45)),
      });
    }

    const sourceResults = accumulated;

    if (controller.signal.aborted) {
      throw new ResearchAbortError();
    }

    patchResearchReport(store, id, { stage: 'analyzing', progress: 50 });

    let analysis: ResearchAnalysis | null = null;
    let analyzeError: string | null = null;
    const realDataCount = sourceResults.reduce((s, r) => s + countDataItems(r), 0);
    try {
      if (realDataCount === 0) {
        // 零真实数据：绝不让 LLM 基于失败态/占位提示编整页空话（用户实测
        // 投诉的脏数据根因）。如实写出原因，跳过分析。
        analyzeError =
          '本次未采集到任何真实数据（见下方各数据源失败原因 / 提示），未做 AI 洞察；请修复数据源后「重新跑」。';
      } else {
        analysis = await analyzeResearch({
          platform: resolvedPlatform,
          query: args.query,
          instruction: args.instruction,
          sourceResults,
          signal: controller.signal,
        });
        if (analysis === null) {
          // analyzeResearch 对「未配置可用模型」返回 null（预期降级），但仍要
          // 在报告里如实写出原因，禁止静默省略 AI 洞察。
          analyzeError = '未配置可用的文本生成模型，AI 洞察未生成（原始数据仍完整）。';
        }
      }
    } catch (err) {
      // LLM 硬失败（超时 / schema / 网络）。不静默：保留模板报告 + 原始数据
      // dump，并把真实原因写进报告，对齐项目「失败原因必须可见」红线。
      analysis = null;
      analyzeError = controller.signal.aborted
        ? null
        : `AI 洞察分析失败：${err instanceof Error ? err.message : String(err)}`;
    }

    if (controller.signal.aborted) {
      throw new ResearchAbortError();
    }

    patchResearchReport(store, id, { stage: 'composing', progress: 80 });

    const composed = composeResearchReport({
      platform: resolvedPlatform,
      query: args.query,
      instruction: args.instruction,
      sourceResults,
      analysis,
      analyzeError,
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
    unregisterRun(id);
  }
}

interface RoundQuery {
  source: string;
  query: string;
}

/**
 * 跑一轮 planner 决定的 (source, query) 对：并行、每条独立超时；失败/超时
 * 只记错不中断整轮（沿用原 collectAllSources 的降级语义）。query 由 SOP
 * 每轮生成，故不再是「一个 query 跑所有源」，而是逐对执行。
 */
async function runRoundQueries(
  pairs: RoundQuery[],
  platform: string,
  instruction: string | null,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ResearchSourceResult[]> {
  return Promise.all(
    pairs.map(async ({ source, query }) => {
      const adapter = getRegisteredSource(source);
      if (!adapter) {
        return {
          source,
          ok: false,
          items: [],
          error: `未注册数据源 ${source}（可用：${getRegisteredSourceNames().join(', ')}）`,
        } satisfies ResearchSourceResult;
      }
      const started = Date.now();
      try {
        const ctx: ResearchSourceContext = { platform, query, instruction, signal };
        const result = await withTimeout(adapter(ctx), timeoutMs, source);
        return { ...result, latency_ms: Date.now() - started };
      } catch (err) {
        return {
          source,
          ok: false,
          items: [],
          error: err instanceof Error ? err.message : String(err),
          latency_ms: Date.now() - started,
        } satisfies ResearchSourceResult;
      }
    }),
  );
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
