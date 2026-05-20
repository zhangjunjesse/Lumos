/**
 * In-process live progress registry for douyin collect jobs.
 *
 * Why a side-channel module instead of a column on the job row: the
 * collect pipeline (runKeywordJob / runCreatorJob in jobs.ts) runs
 * synchronously inside a fire-and-forget `void runJob()` (see
 * /api/.../jobs route). The chat UX problem is that a 2-5 min job shows
 * no semantic steps. `douyin_job_status` reads this registry to report
 * "正在处理 3/20、已入库 2、被风控 1" while the job is still running.
 *
 * Deliberately additive and isolated: it imports nothing from jobs.ts /
 * scraper.ts and adds no field to CollectJobRecord, so it does not
 * collide with the parallel risk-skeleton work in those files. The job
 * pipeline only needs a few `reportJobProgress()` call sites.
 *
 * Process-local by design: progress is ephemeral and only meaningful
 * while the owning Next.js process is alive (the same process that runs
 * the job). Terminal state is also mirrored onto the job row by the
 * existing markJobStatus path, so a restart loses only the live ticker,
 * never the final outcome.
 */

export type JobProgressPhase =
  | 'discovering' // browser scrape: finding aweme ids
  | 'backfilling' // per-video metadata back-fill (the slow burst)
  | 'processing' // transcribe / summarize / publish pipeline
  | 'done'
  | 'failed';

export interface JobProgress {
  jobId: string;
  phase: JobProgressPhase;
  /** Total items in the current countable phase (0 = unknown yet). */
  total: number;
  /** Items consumed so far in the current phase. */
  processed: number;
  /** Videos successfully upserted. */
  added: number;
  /** Items that hit douyin rate-limit skeleton (recoverable). */
  risk: number;
  /** Items skipped as invalid / non-target. */
  skipped: number;
  /** Human one-liner, e.g. '正在采集"电商SOP"…' / '处理 3/20'. */
  message: string;
  updatedAt: string;
}

type ProgressPatch = Partial<Omit<JobProgress, 'jobId' | 'updatedAt'>>;

// Bound the map so a long-lived process can't leak. The registry is a
// transient ticker, not a store of record — pruning the oldest entries
// when over capacity is safe (their jobs' terminal state lives on the
// job row regardless).
const MAX_ENTRIES = 200;

const registry = new Map<string, JobProgress>();

function freshProgress(jobId: string): JobProgress {
  return {
    jobId,
    phase: 'discovering',
    total: 0,
    processed: 0,
    added: 0,
    risk: 0,
    skipped: 0,
    message: '',
    updatedAt: new Date().toISOString(),
  };
}

function pruneIfNeeded(): void {
  if (registry.size <= MAX_ENTRIES) return;
  const overflow = registry.size - MAX_ENTRIES;
  // Map preserves insertion order; the first keys are the oldest.
  let removed = 0;
  for (const key of registry.keys()) {
    registry.delete(key);
    if (++removed >= overflow) break;
  }
}

/**
 * Merge a progress patch for `jobId`. Auto-initialises on first call.
 * Counters in the patch are treated as absolute values (callers own the
 * running totals); pass the new value, not a delta.
 */
export function reportJobProgress(jobId: string, patch: ProgressPatch): JobProgress {
  if (!jobId) {
    // Defensive: never throw from a progress emit — it must not be able
    // to break the job pipeline that calls it.
    return { ...freshProgress(''), ...patch, updatedAt: new Date().toISOString() };
  }
  const current = registry.get(jobId) ?? freshProgress(jobId);
  const next: JobProgress = {
    ...current,
    ...patch,
    jobId,
    updatedAt: new Date().toISOString(),
  };
  registry.delete(jobId);
  registry.set(jobId, next);
  pruneIfNeeded();
  return next;
}

/** Read the live progress for `jobId`, or null if none recorded. */
export function getJobProgress(jobId: string): JobProgress | null {
  if (!jobId) return null;
  return registry.get(jobId) ?? null;
}

/** Drop a job's progress entry (optional explicit cleanup). */
export function clearJobProgress(jobId: string): void {
  registry.delete(jobId);
}

/** Test-only: wipe the registry so suites don't leak state. */
export function _resetJobProgressForTests(): void {
  registry.clear();
}

/**
 * Build the user-facing one-liner for a phase + counts. Centralised so
 * the MCP status tool and any UI surface phrase progress identically.
 */
export function describeJobProgress(p: JobProgress): string {
  if (p.message) return p.message;
  switch (p.phase) {
    case 'discovering':
      return '正在抖音搜索 / 打开页面，发现视频列表…';
    case 'backfilling':
      return p.total > 0
        ? `正在补全视频元数据 ${p.processed}/${p.total}（已入库 ${p.added}、被风控 ${p.risk}）`
        : '正在补全视频元数据…';
    case 'processing':
      return p.total > 0
        ? `正在抓字幕 / 总结 / 入库 ${p.processed}/${p.total}`
        : '正在抓字幕 / 总结 / 入库…';
    case 'done':
      return `完成：已入库 ${p.added}${p.risk > 0 ? `、被风控 ${p.risk}` : ''}${
        p.skipped > 0 ? `、跳过 ${p.skipped}` : ''
      }`;
    case 'failed':
      return '任务失败（见 failure_reason）';
    default:
      return '';
  }
}
