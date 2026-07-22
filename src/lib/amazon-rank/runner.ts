import fs from 'node:fs';

import type { AppDataStore } from '@/lib/app/runtime/data-store';

import { ensureDeliveryZip } from './amazon-page';
import { createProviderGenerate, type StructuredGenerate } from './ai-operator';
import { openRankBrowserSession, type RankBrowserSession } from './browser-session';
import { CONSECUTIVE_FAILURE_LIMIT } from './constants';
import { createAiEngine, createCodeEngine, type EngineContext, type QueryEngine } from './engines';
import { getActiveRules } from './extraction-rules';
import { snapshotFilePath } from './paths';
import { getRankSettings } from './settings';
import {
  cancelRemainingResults,
  finishRun,
  getRun,
  getRunResults,
  markResultDone,
  summarizeRunStatus,
  updateResult,
  updateRun,
} from './store';
import type { RankRunRow, RankSettings } from './types';

export interface ExecuteRankRunDeps {
  openSession?: typeof openRankBrowserSession;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  saveSnapshot?: (runId: string, seq: number, keyword: string, html: string) => string | undefined;
  /** 测试注入 AI 生成函数；缺省按 Lumos 默认 provider 构建 */
  generate?: StructuredGenerate;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function defaultSaveSnapshot(
  runId: string,
  seq: number,
  keyword: string,
  html: string,
): string | undefined {
  try {
    if (!html || html.length < 100) return undefined;
    const file = snapshotFilePath(runId, seq, keyword);
    fs.writeFileSync(file, html, 'utf-8');
    return file;
  } catch {
    return undefined;
  }
}

/**
 * 执行一次排名运行：设邮编 → 逐词查询（代码/AI 引擎按设置选） → 匹配 ASIN → 落库。
 * 所有进度实时写进 amazon_rank_runs / amazon_rank_results，UI 轮询即可。
 * 遇验证码立即中止（两种引擎都不硬闯风控）；连续执行层失败达到阈值也中止。
 */
export async function executeRankRun(
  store: AppDataStore,
  runId: string,
  signal: AbortSignal,
  deps: ExecuteRankRunDeps = {},
): Promise<RankRunRow | null> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const openSession = deps.openSession ?? openRankBrowserSession;

  const run = getRun(store, runId);
  if (!run) return null;
  const settings = getRankSettings(store);

  const opened = await openSession({ settings, runId, signal });
  if ('error' in opened) {
    cancelRemainingResults(store, runId, '运行未开始');
    finishRun(store, runId, 'failed', opened.error);
    return recordHistory(store, runId);
  }

  const session = opened;
  const ctx: EngineContext = {
    session,
    settings,
    store,
    runId,
    saveSnapshot: deps.saveSnapshot ?? defaultSaveSnapshot,
    sleep,
    signal,
  };
  let engine: QueryEngine;
  try {
    engine = buildEngine(ctx, deps);
  } catch (error) {
    await session.close();
    const message = error instanceof Error ? error.message : String(error);
    cancelRemainingResults(store, runId, '运行未开始');
    finishRun(store, runId, 'failed', `AI 操作模式不可用：${message}`);
    return recordHistory(store, runId);
  }

  try {
    const zipConfirmed = await trySetZip(session, settings, sleep);
    updateRun(store, runId, { zip_confirmed: zipConfirmed });

    const results = getRunResults(store, runId).filter((r) => r.status === 'pending');
    const targetAsins = (run.asins ?? []).map((a) => a.toUpperCase());
    let matchesTotal = 0;
    let done = 0;
    let consecutiveFailures = 0;

    for (const row of results) {
      if (signal.aborted) {
        cancelRemainingResults(store, runId, '用户停止了运行');
        finishRun(store, runId, 'cancelled');
        return recordHistory(store, runId);
      }

      updateResult(store, row.id, { status: 'running', started_at: new Date().toISOString() });
      const outcome = await engine.queryOne(row, targetAsins);
      markResultDone(store, row.id, outcome);

      done++;
      matchesTotal += outcome.matches?.length ?? 0;
      updateRun(store, runId, { keywords_done: done, matches_total: matchesTotal });

      if (outcome.status === 'blocked') {
        cancelRemainingResults(store, runId, '疑似触发风控，运行已中止');
        finishRun(store, runId, 'failed', `第 ${row.seq} 个关键词「${row.keyword}」遇到验证码，已立即中止，请过段时间再试`);
        return recordHistory(store, runId);
      }
      consecutiveFailures = outcome.status === 'failed' ? consecutiveFailures + 1 : 0;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        cancelRemainingResults(store, runId, '连续执行失败，运行已中止');
        finishRun(store, runId, 'failed', `连续 ${CONSECUTIVE_FAILURE_LIMIT} 个关键词执行失败（${outcome.errorMessage ?? '未知原因'}），已中止`);
        return recordHistory(store, runId);
      }

      const isLast = done >= results.length;
      if (!isLast) {
        await sleep(settings.delayMinMs + random() * Math.max(0, settings.delayMaxMs - settings.delayMinMs));
      }
    }

    const finalStatus = summarizeRunStatus(getRunResults(store, runId));
    finishRun(
      store,
      runId,
      finalStatus,
      finalStatus === 'failed' ? '所有关键词都没有查询成功，详见每个关键词的失败原因' : undefined,
    );
    return recordHistory(store, runId);
  } finally {
    try {
      engine.finalize();
    } catch {
      /* 规则草稿落库失败不影响运行终态 */
    }
    await session.close();
  }
}

function buildEngine(ctx: EngineContext, deps: ExecuteRankRunDeps): QueryEngine {
  const active = getActiveRules(ctx.store);
  if (ctx.settings.executionMode === 'ai') {
    const generate = deps.generate ?? createProviderGenerate(ctx.runId);
    return createAiEngine(ctx, active, generate);
  }
  return createCodeEngine(ctx, active);
}

async function trySetZip(
  session: RankBrowserSession,
  settings: RankSettings,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  try {
    return await ensureDeliveryZip(session.api, settings.zipCode, sleep);
  } catch {
    return false;
  }
}

function recordHistory(store: AppDataStore, runId: string): RankRunRow | null {
  const run = getRun(store, runId);
  if (!run) return null;
  if (run.source === 'monitor') return run; // 监控运行的 run_history 由自动化桥统一写，避免重复

  const historyStatus =
    run.status === 'cancelled' ? 'cancelled' : run.status === 'failed' ? 'failed' : 'success';
  const summaryParts = [
    `${run.keywords_done}/${run.keywords_total} 个关键词完成`,
    `命中 ${run.matches_total} 个排名`,
  ];
  if (run.status === 'partial') summaryParts.push('部分关键词失败，详见运行详情');
  store.create('run_history', {
    title: `排名查询：${run.keywords_total} 词 × ${(run.asins ?? []).length} ASIN`,
    status: historyStatus,
    summary: summaryParts.join('，'),
    failure_reason: run.failure_reason,
    kind: 'rank_query',
    ref_id: run.id,
    started_at: run.started_at,
    ended_at: run.ended_at,
    updated_at: new Date().toISOString(),
  });
  return run;
}
