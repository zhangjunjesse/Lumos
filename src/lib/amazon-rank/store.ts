import type { AppDataStore } from '@/lib/app/runtime/data-store';

import {
  RUNS_COLLECTION,
  RESULTS_COLLECTION,
  STALE_RUN_CUTOFF_MS,
} from './constants';
import type {
  KeywordStatus,
  RankMatch,
  RankResultRow,
  RankRunRow,
  RankRunSource,
  RankRunStatus,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

export function createRun(
  store: AppDataStore,
  input: {
    id?: string;
    source: RankRunSource;
    site: string;
    zipCode: string;
    keywords: string[];
    asins: string[];
    outputDir: string;
  },
): RankRunRow {
  const startedAt = nowIso();
  const run = store.create<RankRunRow>(RUNS_COLLECTION, {
    ...(input.id ? { id: input.id } : {}),
    source: input.source,
    status: 'running',
    site: input.site,
    zip_code: input.zipCode,
    zip_confirmed: false,
    keywords_total: input.keywords.length,
    keywords_done: 0,
    asins: input.asins,
    matches_total: 0,
    output_dir: input.outputDir,
    started_at: startedAt,
    updated_at: startedAt,
  } as RankRunRow);

  input.keywords.forEach((keyword, index) => {
    store.create(RESULTS_COLLECTION, {
      run_id: run.id,
      seq: index + 1,
      keyword,
      status: 'pending',
      top_asins: [] as string[],
      matches: [] as RankMatch[],
      organic_count: 0,
      updated_at: startedAt,
    });
  });

  return run;
}

export function getRun(store: AppDataStore, runId: string): RankRunRow | null {
  return store.get<RankRunRow>(RUNS_COLLECTION, runId);
}

export function listRuns(store: AppDataStore, limit = 30): RankRunRow[] {
  return store.query<RankRunRow>(RUNS_COLLECTION, {
    orderBy: { field: 'started_at', direction: 'desc' },
    limit,
  });
}

export function getRunResults(store: AppDataStore, runId: string): RankResultRow[] {
  return store.query<RankResultRow>(RESULTS_COLLECTION, {
    filter: { run_id: runId },
    orderBy: { field: 'seq', direction: 'asc' },
    limit: 1_000,
  });
}

export function updateRun(
  store: AppDataStore,
  runId: string,
  patch: Partial<RankRunRow>,
): void {
  store.update<RankRunRow>(RUNS_COLLECTION, runId, { ...patch, updated_at: nowIso() });
}

export function finishRun(
  store: AppDataStore,
  runId: string,
  status: RankRunStatus,
  failureReason?: string,
): void {
  updateRun(store, runId, {
    status,
    ended_at: nowIso(),
    ...(failureReason ? { failure_reason: failureReason } : {}),
  });
}

export function updateResult(
  store: AppDataStore,
  resultId: string,
  patch: Partial<RankResultRow>,
): void {
  store.update<RankResultRow>(RESULTS_COLLECTION, resultId, { ...patch, updated_at: nowIso() });
}

export function markResultDone(
  store: AppDataStore,
  resultId: string,
  outcome: {
    status: KeywordStatus;
    topAsins?: string[];
    matches?: RankMatch[];
    organicCount?: number;
    snapshotPath?: string;
    errorMessage?: string;
  },
): void {
  updateResult(store, resultId, {
    status: outcome.status,
    top_asins: outcome.topAsins ?? [],
    matches: outcome.matches ?? [],
    organic_count: outcome.organicCount ?? 0,
    ...(outcome.snapshotPath ? { snapshot_path: outcome.snapshotPath } : {}),
    ...(outcome.errorMessage ? { error_message: outcome.errorMessage } : {}),
    ended_at: nowIso(),
  });
}

/** 把没跑到的关键词标成 cancelled，避免残留 pending 装作还在排队 */
export function cancelRemainingResults(
  store: AppDataStore,
  runId: string,
  reason: string,
): void {
  for (const row of getRunResults(store, runId)) {
    if (row.status === 'pending' || row.status === 'running') {
      updateResult(store, row.id, { status: 'cancelled', error_message: reason, ended_at: nowIso() });
    }
  }
}

/**
 * 进程崩溃 / 强退后 running 的 run 不会自愈。启动时（default-automations seed 里调用）
 * 把超过阈值没有任何更新的 running run 判为失败，用户可以重新发起。
 */
export function recoverStaleRuns(store: AppDataStore): void {
  const cutoff = Date.now() - STALE_RUN_CUTOFF_MS;
  const runs = store.query<RankRunRow>(RUNS_COLLECTION, {
    filter: { status: 'running' },
    limit: 100,
  });
  for (const run of runs) {
    const updatedAt = Date.parse(run.updated_at ?? '');
    if (Number.isFinite(updatedAt) && updatedAt >= cutoff) continue;
    finishRun(store, run.id, 'failed', '上次运行未正常结束（Lumos 进程可能被关闭或崩溃）');
    cancelRemainingResults(store, run.id, '运行中断，未执行');
  }
}

/** 由逐词结果汇总运行终态 */
export function summarizeRunStatus(results: RankResultRow[]): RankRunStatus {
  const ok = results.filter((r) => r.status === 'ok').length;
  const bad = results.filter(
    (r) => r.status === 'no_results' || r.status === 'blocked' || r.status === 'parse_failed' || r.status === 'failed',
  ).length;
  if (ok > 0 && bad === 0) return 'success';
  if (ok > 0 && bad > 0) return 'partial';
  return 'failed';
}
