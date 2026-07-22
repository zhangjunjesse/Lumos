import { randomUUID } from 'node:crypto';

import type { AppDataStore } from '@/lib/app/runtime/data-store';

import { HARD_MAX_KEYWORDS } from './constants';
import { runOutputDir } from './paths';
import { executeRankRun, type ExecuteRankRunDeps } from './runner';
import { getRankSettings } from './settings';
import { cancelRemainingResults, createRun, finishRun } from './store';
import type { RankRunRow, RankRunSource } from './types';

/**
 * 进程内活跃运行注册表。排名查询共用一个浏览器页顺序执行，
 * 同一时刻只允许一个运行（第二个直接拒绝，不排队，避免用户等一个看不见的队列）。
 */
const activeRuns = new Map<string, AbortController>();

export function getActiveRunId(): string | null {
  return activeRuns.keys().next().value ?? null;
}

export interface StartRankRunInput {
  store: AppDataStore;
  source: RankRunSource;
  keywords: string[];
  asins: string[];
  deps?: ExecuteRankRunDeps;
}

export interface StartRankRunResult {
  run: RankRunRow;
  /** 运行结束时 resolve（手动运行不 await；监控自动化 await 它拿终态） */
  finished: Promise<RankRunRow | null>;
}

export function startRankRun(input: StartRankRunInput): StartRankRunResult {
  const activeId = getActiveRunId();
  if (activeId) {
    throw new RankRunBusyError(activeId);
  }

  const settings = getRankSettings(input.store);
  const keywords = input.keywords.slice(0, Math.min(settings.maxKeywords, HARD_MAX_KEYWORDS));
  if (keywords.length === 0) throw new Error('没有可查询的关键词');
  if (input.asins.length === 0) throw new Error('没有要匹配的 ASIN');

  const runId = randomUUID();
  const run = createRun(input.store, {
    id: runId,
    source: input.source,
    engine: settings.executionMode,
    site: settings.site,
    zipCode: settings.zipCode,
    keywords,
    asins: input.asins,
    outputDir: resolveOutputDir(runId),
  });

  const controller = new AbortController();
  activeRuns.set(runId, controller);

  const finished = executeRankRun(input.store, runId, controller.signal, input.deps)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      cancelRemainingResults(input.store, runId, '运行异常中断');
      finishRun(input.store, runId, 'failed', `运行异常：${message}`);
      return null;
    })
    .finally(() => {
      activeRuns.delete(runId);
    });

  return { run, finished };
}

export function stopRankRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export class RankRunBusyError extends Error {
  readonly activeRunId: string;
  constructor(activeRunId: string) {
    super('已有一个排名查询在运行，请等它结束或先停止它');
    this.name = 'RankRunBusyError';
    this.activeRunId = activeRunId;
  }
}

function resolveOutputDir(runId: string): string {
  try {
    return runOutputDir(runId);
  } catch {
    return '';
  }
}
