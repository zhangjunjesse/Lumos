// 自动级联引擎 — step done 时按 RunConfig.cascadeTo 触发下一步
// 各 step API 在 success 路径上调用 onStepDone(runId, stepId, succeeded=true)
//
// 顺序: seed → converge → verify → score → analyze
// 失败/abort 不级联(用户必须显式重跑)

import { appendLog, getRun, getStep, updateStep } from './runs';
import { registerJob, unregisterJob } from './jobs';
import type { CascadeTarget, StepId } from './types';
import { isRunCancelled, clearRunCancellation } from '@/lib/app/runtime/run-control';

const APP_ID = 'etsy-erank';

const CASCADE_ORDER: Record<CascadeTarget, number> = {
  none: -1,
  seed: 0,
  converge: 1,
  verify: 2,
  score: 3,
  analyze: 4,
};

const STEP_TO_TARGET: Record<string, CascadeTarget> = {
  seed: 'seed',
  converge: 'converge',
  verify: 'verify',
  score: 'score',
  analyze: 'analyze',
};

const NEXT_STEP: Record<StepId, StepId | null> = {
  huntground: 'seed',
  seed: 'converge',
  converge: 'verify',
  verify: 'score',
  score: 'analyze',
  analyze: 'manual',
  manual: null,
};

function shouldCascade(cascadeTo: CascadeTarget, nextStep: StepId): boolean {
  const nextTarget = STEP_TO_TARGET[nextStep];
  if (!nextTarget) return false;
  return CASCADE_ORDER[nextTarget] <= CASCADE_ORDER[cascadeTo];
}

// 异步触发指定 step(避免阻塞 caller),失败写日志不抛
export function maybeCascadeNext(runId: string, finishedStep: StepId): void {
  const run = getRun(runId);
  if (!run) return;
  // 取消短路: 用户在 step A 跑到一半时点 cancel, abortJob 让 worker 跳出, 但
  // worker 可能仍走到 step "done" 路径(基于部分结果), 然后 cascade 会触发下一 step,
  // 新 step 创建新 AbortController 不知道用户已取消, 继续烧 X/AdsPower 配额。
  // 在 cascade 入口 check isRunCancelled 阻止级联, 一并清理 flag(本次 run 终态)。
  if (isRunCancelled(APP_ID, runId)) {
    appendLog(runId, finishedStep, `▶ 用户已取消, 不级联到下一步`);
    clearRunCancellation(APP_ID, runId);
    return;
  }
  const next = NEXT_STEP[finishedStep];
  if (!next || next === 'manual') return;
  if (!shouldCascade(run.config.cascadeTo, next)) {
    appendLog(runId, finishedStep, `▶ cascadeTo=${run.config.cascadeTo} 不触发 ${next},等用户手动`);
    return;
  }
  // 防重复:next 已经在 running 就跳过
  const nextStepRow = getStep(runId, next);
  if (nextStepRow?.state === 'running') return;

  appendLog(runId, finishedStep, `▶ 自动级联触发 ${next}`);

  // 异步触发对应 step 的 runner
  setImmediate(() => {
    triggerStep(runId, next).catch((err) => {
      appendLog(runId, next, `✗ 自动级联失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    });
  });
}

async function triggerStep(runId: string, step: StepId): Promise<void> {
  const run = getRun(runId);
  if (!run) throw new Error('run not found');

  // 用 dynamic import 解决循环依赖(各 runner 也 import cascade)
  switch (step) {
    case 'seed': {
      const { collectSeeds } = await import('./seed-collector');
      const { updateRunCounters } = await import('./runs');
      const { getDb } = await import('../db/connection');
      const ac = registerJob(runId, 'seed');
      updateStep(runId, 'seed', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'seed', msg, level);
      try {
        getDb().prepare('DELETE FROM radar_seeds WHERE run_id = ?').run(runId);
        const result = await collectSeeds({
          runId,
          timeframe: run.config.seedTimeframe,
          limit: run.config.seedLimit,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
        });
        updateStep(runId, 'seed', { state: 'done', progressDone: result.totalInserted, progressTotal: result.totalInserted });
        updateRunCounters(runId, { seedCount: result.totalInserted });
        log(`✓ ② 完成:Trend Buzz ${result.trendBuzzCount} + Monthly ${result.monthlyCount} = ${result.totalInserted}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'seed', { state: 'failed', errorMessage: msg });
        unregisterJob(runId, 'seed');
        return; // 失败不级联
      }
      unregisterJob(runId, 'seed');
      maybeCascadeNext(runId, 'seed');
      return;
    }
    case 'converge': {
      const { expandAll } = await import('./expander');
      const { updateRunCounters } = await import('./runs');
      const ac = registerJob(runId, 'converge');
      updateStep(runId, 'converge', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'converge', msg, level);
      try {
        const result = await expandAll({
          runId,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
          reportProgress: (done, total) => updateStep(runId, 'converge', { progressDone: done, progressTotal: total }),
        });
        updateStep(runId, 'converge', {
          state: 'done', progressDone: result.expandedTotal, progressTotal: result.expandedTotal,
          meta: { candidateCount: result.candidateCount, listingsTotal: result.listingsTotal, imagesDownloaded: result.imagesDownloaded },
        });
        updateRunCounters(runId, { convergeCount: result.expandedTotal });
        log(`✓ ③ 完成:候选 ${result.candidateCount} → 扩词 ${result.expandedTotal}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'converge', { state: 'failed', errorMessage: msg });
        unregisterJob(runId, 'converge');
        return;
      }
      unregisterJob(runId, 'converge');
      maybeCascadeNext(runId, 'converge');
      return;
    }
    case 'verify': {
      const { verifyBulk } = await import('./verifier');
      const { updateRunCounters } = await import('./runs');
      const ac = registerJob(runId, 'verify');
      updateStep(runId, 'verify', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'verify', msg, level);
      try {
        const result = await verifyBulk({
          runId,
          maxBatches: run.config.verifyMaxBatches,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
          reportProgress: (done, total) => updateStep(runId, 'verify', { progressDone: done, progressTotal: total }),
        });
        updateStep(runId, 'verify', { state: 'done', progressDone: result.batchesRun, progressTotal: result.batchesRun, meta: { gradeCounts: result.gradeCounts } });
        updateRunCounters(runId, { gradeA: result.gradeCounts.A, gradeB: result.gradeCounts.B, gradeC: result.gradeCounts.C });
        log(`✓ ④ 完成 ${result.batchesRun} 批 · A ${result.gradeCounts.A} / B ${result.gradeCounts.B} / C ${result.gradeCounts.C}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'verify', { state: 'failed', errorMessage: msg });
        unregisterJob(runId, 'verify');
        return;
      }
      unregisterJob(runId, 'verify');
      maybeCascadeNext(runId, 'verify');
      return;
    }
    case 'score': {
      const { scoreNiches } = await import('./scorer');
      const ac = registerJob(runId, 'score');
      updateStep(runId, 'score', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'score', msg, level);
      try {
        const result = await scoreNiches({
          runId,
          userDirection: run.capabilities,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
          reportProgress: (done, total) => updateStep(runId, 'score', { progressDone: done, progressTotal: total }),
        });
        updateStep(runId, 'score', { state: 'done', progressDone: result.nicheCount, progressTotal: result.nicheCount, meta: { scored: result.scored, cached: result.cached, failed: result.failed } });
        log(`✓ ⑤ 完成: ${result.scored} 新解读 · ${result.cached} 缓存 · ${result.failed} 失败`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'score', { state: 'failed', errorMessage: msg });
        unregisterJob(runId, 'score');
        return;
      }
      unregisterJob(runId, 'score');
      maybeCascadeNext(runId, 'score');
      return;
    }
    case 'analyze': {
      const { analyzeAllAGrade } = await import('./analyzer');
      const ac = registerJob(runId, 'analyze');
      updateStep(runId, 'analyze', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'analyze', msg, level);
      try {
        const result = await analyzeAllAGrade({
          runId,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
          reportProgress: (done, total) => updateStep(runId, 'analyze', { progressDone: done, progressTotal: total }),
        });
        updateStep(runId, 'analyze', { state: 'done', progressDone: result.keywordCount, progressTotal: result.keywordCount, meta: { succeed: result.succeed, failed: result.failed, imagesDownloaded: result.imagesDownloaded } });
        log(`✓ ⑥ 完成: ${result.succeed}/${result.keywordCount} 词`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'analyze', { state: 'failed', errorMessage: msg });
        unregisterJob(runId, 'analyze');
        return;
      }
      unregisterJob(runId, 'analyze');
      // analyze 后无自动下一步(manual 永远等人工)
      return;
    }
    default:
      return;
  }
}

/** 给 POST /runs 用:刚创建好的 run 立即启动 cascadeTo 链 */
export function startCascadeFromCreation(runId: string): void {
  const run = getRun(runId);
  if (!run) return;
  if (run.config.cascadeTo === 'none') {
    appendLog(runId, 'seed', `▶ cascadeTo=none,等用户手动启 ②`);
    return;
  }
  appendLog(runId, 'seed', `▶ 自动启动 ②(cascadeTo=${run.config.cascadeTo})`);
  setImmediate(() => {
    triggerStep(runId, 'seed').catch((err) => {
      appendLog(runId, 'seed', `✗ 自动启动失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    });
  });
}
