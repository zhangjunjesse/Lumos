// 自动级联引擎 — collect → metrics → analyze → report
//
// 各 step 跑完后调 maybeCascadeNext;失败/abort 不级联。

import { appendLog, getRun, getStep, updateRunCounters, updateStep } from './runs';
import { registerJob, unregisterJob } from './jobs';
import type { CascadeTarget, StepId } from './types';

const CASCADE_ORDER: Record<CascadeTarget, number> = {
  none: -1,
  collect: 0,
  metrics: 1,
  analyze: 2,
  etsy_listings: 3,
  report: 4,
};

const STEP_TO_TARGET: Record<string, CascadeTarget> = {
  collect: 'collect',
  metrics: 'metrics',
  analyze: 'analyze',
  etsy_listings: 'etsy_listings',
  report: 'report',
};

const NEXT_STEP: Record<StepId, StepId | null> = {
  huntground: 'collect',
  collect: 'metrics',
  metrics: 'analyze',
  analyze: 'etsy_listings',
  etsy_listings: 'report',
  report: null,
};

function shouldCascade(cascadeTo: CascadeTarget, nextStep: StepId): boolean {
  const nextTarget = STEP_TO_TARGET[nextStep];
  if (!nextTarget) return false;
  return CASCADE_ORDER[nextTarget] <= CASCADE_ORDER[cascadeTo];
}

export function maybeCascadeNext(runId: string, finishedStep: StepId): void {
  const run = getRun(runId);
  if (!run) return;
  const next = NEXT_STEP[finishedStep];
  if (!next) return;
  if (!shouldCascade(run.config.cascadeTo, next)) {
    appendLog(runId, finishedStep, `▶ cascadeTo=${run.config.cascadeTo} 不触发 ${next},等用户手动`);
    return;
  }
  const nextStepRow = getStep(runId, next);
  if (nextStepRow?.state === 'running') return;
  appendLog(runId, finishedStep, `▶ 自动级联触发 ${next}`);
  setImmediate(() => {
    triggerStep(runId, next).catch((err) => {
      appendLog(runId, next, `✗ 自动级联失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    });
  });
}

export async function triggerStep(runId: string, step: StepId): Promise<void> {
  const run = getRun(runId);
  if (!run) throw new Error('run not found');

  switch (step) {
    case 'collect': {
      const { collectTrending } = await import('./trending-collector');
      const ac = registerJob(runId, 'collect');
      updateStep(runId, 'collect', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'collect', msg, level);
      try {
        const result = await collectTrending({
          runId,
          country: run.config.country,
          preset: run.config.preset,
          category: run.config.category || undefined,
          limit: run.config.collectLimit,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
        });
        updateStep(runId, 'collect', { state: 'done', progressDone: result.inserted, progressTotal: result.inserted, meta: { apiReturned: result.apiReturned } });
        updateRunCounters(runId, { trendingCount: result.inserted });
        log(`✓ ② 完成:API 返回 ${result.apiReturned} → 入库 ${result.inserted}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'collect', { state: 'failed', errorMessage: msg });
        updateRunCounters(runId, { status: 'failed', failureReason: `collect: ${msg.slice(0, 200)}` });
        unregisterJob(runId, 'collect');
        return;
      }
      unregisterJob(runId, 'collect');
      maybeCascadeNext(runId, 'collect');
      return;
    }
    case 'metrics': {
      const { fetchAllMetrics } = await import('./metrics-fetcher');
      const ac = registerJob(runId, 'metrics');
      updateStep(runId, 'metrics', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'metrics', msg, level);
      try {
        const result = await fetchAllMetrics({
          runId,
          country: run.config.country,
          days: run.config.metricsDays,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
          reportProgress: (done, total) => updateStep(runId, 'metrics', { progressDone: done, progressTotal: total }),
        });
        updateStep(runId, 'metrics', { state: 'done', progressDone: result.fetched, progressTotal: result.totalTerms, meta: { failed: result.failed } });
        updateRunCounters(runId, { metricsCount: result.fetched });
        log(`✓ ③ 完成:fetched ${result.fetched} / failed ${result.failed} / total ${result.totalTerms}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'metrics', { state: 'failed', errorMessage: msg });
        updateRunCounters(runId, { status: 'failed', failureReason: `metrics: ${msg.slice(0, 200)}` });
        unregisterJob(runId, 'metrics');
        return;
      }
      unregisterJob(runId, 'metrics');
      maybeCascadeNext(runId, 'metrics');
      return;
    }
    case 'analyze': {
      const { analyzeAllTerms } = await import('./analyzer');
      const ac = registerJob(runId, 'analyze');
      updateStep(runId, 'analyze', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'analyze', msg, level);
      try {
        const result = await analyzeAllTerms({
          runId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
          reportProgress: (done, total) => updateStep(runId, 'analyze', { progressDone: done, progressTotal: total }),
        });
        updateStep(runId, 'analyze', { state: 'done', progressDone: result.succeeded, progressTotal: result.total, meta: { failed: result.failed, cached: result.cached } });
        updateRunCounters(runId, { analyzedCount: result.succeeded + result.cached });
        log(`✓ ④ 完成:${result.succeeded}/${result.total} · 失败 ${result.failed} · 缓存 ${result.cached}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'analyze', { state: 'failed', errorMessage: msg });
        updateRunCounters(runId, { status: 'failed', failureReason: `analyze: ${msg.slice(0, 200)}` });
        unregisterJob(runId, 'analyze');
        return;
      }
      unregisterJob(runId, 'analyze');
      maybeCascadeNext(runId, 'analyze');
      return;
    }
    case 'etsy_listings': {
      const { fetchEtsyListings } = await import('./etsy-listing-fetcher');
      const ac = registerJob(runId, 'etsy_listings');
      updateStep(runId, 'etsy_listings', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'etsy_listings', msg, level);
      try {
        const result = await fetchEtsyListings({
          runId,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
          reportProgress: (done, total) => updateStep(runId, 'etsy_listings', { progressDone: done, progressTotal: total }),
        });
        updateStep(runId, 'etsy_listings', { state: 'done', progressDone: result.termCount, progressTotal: result.termCount, meta: { totalListings: result.totalListings, failedTerms: result.failedTerms, ehuntHits: result.ehuntHits } });
        log(`✓ ⑤ 完成:${result.termCount} 词 · 累计 ${result.totalListings} listing · EHunt 命中 ${result.ehuntHits} · 失败 ${result.failedTerms} 词`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'etsy_listings', { state: 'failed', errorMessage: msg });
        updateRunCounters(runId, { status: 'failed', failureReason: `etsy_listings: ${msg.slice(0, 200)}` });
        unregisterJob(runId, 'etsy_listings');
        return;
      }
      unregisterJob(runId, 'etsy_listings');
      maybeCascadeNext(runId, 'etsy_listings');
      return;
    }
    case 'report': {
      const { generateReport } = await import('./reporter');
      const ac = registerJob(runId, 'report');
      updateStep(runId, 'report', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });
      const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(runId, 'report', msg, level);
      try {
        const result = await generateReport({
          runId,
          browserContextId: run.config.browserContextId,
          appendLog: log,
          isAborted: () => ac.signal.aborted,
        });
        updateStep(runId, 'report', { state: 'done', progressDone: 1, progressTotal: 1, meta: { filePath: result.filePath, termCount: result.termCount, sizeBytes: result.sizeBytes } });
        updateRunCounters(runId, { status: 'completed', summary: `报告: ${result.filePath}` });
        log(`✓ ⑤ 完成:${result.filePath} (${result.termCount} 词 · ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${msg}`, 'error');
        updateStep(runId, 'report', { state: 'failed', errorMessage: msg });
        updateRunCounters(runId, { status: 'failed', failureReason: `report: ${msg.slice(0, 200)}` });
        unregisterJob(runId, 'report');
        return;
      }
      unregisterJob(runId, 'report');
      return;
    }
    default:
      throw new Error(`unknown step: ${step}`);
  }
}

/** 刚创建好的 run 立即启动 cascadeTo 链 */
export function startCascadeFromCreation(runId: string): void {
  const run = getRun(runId);
  if (!run || run.config.cascadeTo === 'none') return;
  setImmediate(() => {
    triggerStep(runId, 'collect').catch((err) => {
      appendLog(runId, 'collect', `✗ 自动级联失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    });
  });
}
