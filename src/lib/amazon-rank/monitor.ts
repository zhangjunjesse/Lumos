import type Database from 'better-sqlite3';

import type { AppDataStore } from '@/lib/app/runtime/data-store';

import { RUN_STATUS_LABELS } from './constants';
import { getActiveRunId, startRankRun, RankRunBusyError, type StartRankRunInput } from './run-manager';
import { getWatchlist } from './settings';
import { getRunResults } from './store';
import type { RankRunRow } from './types';

export interface MonitorReport {
  ok: boolean;
  message: string;
  reasons: string[];
  runId?: string;
}

export interface MonitorDeps {
  start?: (input: StartRankRunInput) => ReturnType<typeof startRankRun>;
  notify?: (input: { db: Database.Database; appId: string; title: string; text: string; severity: 'success' | 'warning' | 'error' }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * 「每日排名监控」自动化入口：跑监控清单里的词和 ASIN，等运行结束，
 * 汇总一句人话摘要；配置了 IM 目标时推送通知（推送失败如实附在 reasons 里）。
 */
export async function runMonitorAutomation(
  input: { store: AppDataStore; db?: Database.Database; appId?: string },
  deps: MonitorDeps = {},
): Promise<MonitorReport> {
  const watchlist = getWatchlist(input.store);
  if (watchlist.keywords.length === 0 || watchlist.asins.length === 0) {
    return {
      ok: false,
      message: '还没有设置监控清单。先在应用里跑一次查询，然后点「设为每日监控」。',
      reasons: ['监控清单为空'],
    };
  }

  const activeId = getActiveRunId();
  if (activeId) {
    return {
      ok: false,
      message: '已有一个排名查询在运行，本次监控跳过。',
      reasons: [`运行 ${activeId} 尚未结束`],
    };
  }

  const start = deps.start ?? startRankRun;
  let finalRun: RankRunRow | null;
  let runId: string;
  try {
    const started = start({
      store: input.store,
      source: 'monitor',
      keywords: watchlist.keywords,
      asins: watchlist.asins,
    });
    runId = started.run.id;
    finalRun = await started.finished;
  } catch (error) {
    if (error instanceof RankRunBusyError) {
      return { ok: false, message: error.message, reasons: [error.message] };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `监控运行启动失败：${message}`, reasons: [message] };
  }

  if (!finalRun) {
    return { ok: false, message: '监控运行异常中断，详见运行详情。', reasons: ['运行异常中断'], runId };
  }

  const summary = buildSummary(input.store, finalRun);
  const ok = finalRun.status === 'success' || finalRun.status === 'partial';
  const reasons: string[] = [];
  if (!ok && finalRun.failure_reason) reasons.push(finalRun.failure_reason);

  if (input.db && input.appId) {
    const notify = deps.notify ?? defaultNotify;
    const severity = finalRun.status === 'success' ? 'success' : ok ? 'warning' : 'error';
    const sent = await notify({
      db: input.db,
      appId: input.appId,
      title: '亚马逊排名监控',
      text: summary,
      severity,
    });
    if (!sent.ok && sent.error) {
      reasons.push(`IM 通知未发出：${sent.error}`);
    }
  }

  return { ok, message: summary, reasons, runId };
}

function buildSummary(store: AppDataStore, run: RankRunRow): string {
  const results = getRunResults(store, run.id);
  const ok = results.filter((r) => r.status === 'ok').length;
  const noResults = results.filter((r) => r.status === 'no_results').length;
  const bad = results.filter(
    (r) => r.status === 'blocked' || r.status === 'parse_failed' || r.status === 'failed',
  ).length;

  const parts = [
    `监控 ${run.keywords_total} 个关键词：${ok} 个查到排名页，命中 ${run.matches_total} 个排名`,
  ];
  if (noResults > 0) parts.push(`${noResults} 个无搜索结果`);
  if (bad > 0) parts.push(`${bad} 个失败`);
  if (run.status === 'failed' && run.failure_reason) parts.push(run.failure_reason);
  parts.push(`状态：${RUN_STATUS_LABELS[run.status] ?? run.status}`);
  return parts.join('；');
}

async function defaultNotify(input: {
  db: Database.Database;
  appId: string;
  title: string;
  text: string;
  severity: 'success' | 'warning' | 'error';
}): Promise<{ ok: boolean; error?: string }> {
  const { sendAppImNotification } = await import('@/lib/app/im-notifications');
  const result = await sendAppImNotification({
    db: input.db,
    appId: input.appId,
    title: input.title,
    text: input.text,
    severity: input.severity,
  });
  return { ok: result.ok, error: result.error };
}
