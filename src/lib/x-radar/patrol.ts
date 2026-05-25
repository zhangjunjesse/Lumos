/**
 * X 雷达 native_action 入口。runner 调度 → 调本文件 → dispatch 到 4 个 kind 的具体实现。
 *
 * - cadence / queue / 错误短路 / X 登录前置检查 在这里
 * - monitor 的真业务在 patrol-monitor.ts
 * - topic/digest/stats 的 X 抓取 + LLM 报告生成在 patrol-ai.ts
 *
 * LLM 走 Lumos 通用 text-generator（patrol-ai.ts 内调用）；provider 不可用时如实写
 * failure_reason，不冒充 success。
 */

import type { AppRow } from '@/lib/app/runtime/data-store';
import { getAuthStatus } from '@/lib/x-platform/auth';
import { isXAuthExpiredError } from '@/lib/x-platform/auth-error';
import { runMonitor } from './patrol-monitor';
import { runTopic, runDigest, runStats } from './patrol-ai';
import { cleanupOldEvidence, isAbortError, throwIfAborted } from './patrol-types';
import type { Cadence, PatrolInput, PatrolReport, RadarKind, RadarTaskRow, TaskResult } from './patrol-types';

export type { PatrolReport, RadarKind } from './patrol-types';

const CADENCE_MS: Record<Cadence, number> = {
  hourly: 60 * 60_000,
  every_6_hours: 6 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
  manual: Number.POSITIVE_INFINITY,
};

const FATAL_PATTERNS = [/X[ _-]?AUTH[ _-]?EXPIRED/i, /cookie/i, /rate[ _-]?limit/i, /HTTP 4\d\d/, /HTTP 5\d\d/, /timeout/i];

function isFatalReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return FATAL_PATTERNS.some((p) => p.test(reason));
}

export function shouldRunByCadence(cadence: Cadence | undefined, lastRunAt: string | null | undefined, now = new Date()): boolean {
  const c = cadence ?? 'daily';
  if (c === 'manual') return false;
  const window = CADENCE_MS[c];
  if (!Number.isFinite(window)) return false;
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= window;
}

function emptyReport(scope: RadarKind, message: string): PatrolReport {
  return { ok: true, scope, processed: 0, succeeded: 0, failed: 0, skipped: 0, reasons: [], message };
}

export async function patrolXRadar(kind: RadarKind, input: PatrolInput): Promise<PatrolReport> {
  const now = input.now?.() ?? Date.now();
  const auth = await getAuthStatus().catch(() => null);
  if (!auth || !auth.loggedIn) {
    return { ok: false, scope: kind, processed: 0, succeeded: 0, failed: 0, skipped: 0, reasons: ['X_AUTH_EXPIRED'], message: 'X 未登录或 cookie 失效；请到「服务 → X」重新登录。' };
  }
  // 每次 patrol 顺手清理 30 天前的 tweet_evidence —— 防止 isolated DB 无限膨胀
  // 注：仅清快照表，告警/报告/摘要不动（它们是用户产物）
  cleanupOldEvidence(input.store, now);

  const allTasks = input.store
    .query<RadarTaskRow>('radar_tasks', { limit: 200 })
    .filter((t) => t.kind === kind && t.enabled === true);
  if (allTasks.length === 0) {
    return emptyReport(kind, `没有启用的 ${kind} 任务，跳过本次巡更。`);
  }
  // cadence 判定用 last_run_started_at（patrol 写入），不用 updated_at —— 后者会被任意 update 刷新
  const due = allTasks.filter((t) => shouldRunByCadence(t.cadence, t.last_run_started_at ?? null));
  const skipped = allTasks.length - due.length;
  if (due.length === 0) {
    return { ok: true, scope: kind, processed: 0, succeeded: 0, failed: 0, skipped, reasons: [], message: `所有 ${allTasks.length} 个 ${kind} 任务都未到 cadence 间隔。` };
  }
  return runQueue(kind, due, input, now, skipped);
}

export const patrolMonitorTasks = (input: PatrolInput) => patrolXRadar('monitor', input);
export const patrolTopicTasks = (input: PatrolInput) => patrolXRadar('topic', input);
export const patrolDigestTasks = (input: PatrolInput) => patrolXRadar('digest', input);
export const patrolStatsTasks = (input: PatrolInput) => patrolXRadar('stats', input);

/**
 * 用户手动「立即跑一次」专用：跑指定一个 task，跳过 cadence 检查（cadence 是给定时巡更用的）。
 * 仍校验 X 登录态。即使 task.enabled=false 也跑——用户既然在 UI 上手动点，意图很明确。
 */
export async function runSingleTaskNow(taskId: string, input: PatrolInput): Promise<PatrolReport> {
  const now = input.now?.() ?? Date.now();
  const task = input.store.get<RadarTaskRow>('radar_tasks', taskId);
  if (!task) {
    return { ok: false, scope: 'monitor', processed: 0, succeeded: 0, failed: 0, skipped: 0, reasons: ['task_not_found'], message: `找不到任务：${taskId}` };
  }
  const kind = (task.kind ?? 'monitor') as RadarKind;
  const auth = await getAuthStatus().catch(() => null);
  if (!auth || !auth.loggedIn) {
    return { ok: false, scope: kind, processed: 0, succeeded: 0, failed: 0, skipped: 0, reasons: ['X_AUTH_EXPIRED'], message: 'X 未登录或 cookie 失效；请到「服务 → X」重新登录。' };
  }

  try {
    const result = await runOneTask(kind, task, input, now);
    return {
      ok: result.ok,
      scope: kind,
      processed: 1,
      succeeded: result.ok ? 1 : 0,
      failed: result.ok ? 0 : 1,
      skipped: 0,
      reasons: result.ok ? [] : [result.reason],
      message: result.summary || result.reason || (result.ok ? '已跑完' : '失败'),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, scope: kind, processed: 1, succeeded: 0, failed: 1, skipped: 0, reasons: [reason], message: reason };
  }
}

async function runQueue(
  kind: RadarKind,
  tasks: AppRow<RadarTaskRow>[],
  input: PatrolInput,
  now: number,
  skipped: number,
): Promise<PatrolReport> {
  const failures: string[] = [];
  let succeeded = 0;
  let abortedAfter: string | null = null;
  let processed = 0;
  for (const task of tasks) {
    // patrol abort 信号检查 —— 用户主动取消 / 浏览器请求 abort 时立即跳出，不再消耗 X 配额
    if (input.signal?.aborted) {
      abortedAfter = '用户取消';
    }
    if (abortedAfter) {
      failures.push(`已跳过：${abortedAfter}`);
      continue;
    }
    try {
      const result = await runOneTask(kind, task, input, now);
      processed += 1;
      if (result.ok) succeeded += 1;
      else {
        failures.push(result.reason);
        if (isFatalReason(result.reason)) abortedAfter = result.reason;
      }
    } catch (err) {
      processed += 1;
      if (isAbortError(err)) { abortedAfter = '用户取消'; failures.push('用户取消'); continue; }
      const reason = err instanceof Error ? err.message : String(err);
      failures.push(reason);
      if (isFatalReason(reason)) abortedAfter = reason;
    }
  }
  const failed = tasks.length - succeeded;
  const reasons = Array.from(new Set(failures)).slice(0, 3);
  const skippedSuffix = skipped > 0 ? `（cadence 未到期跳过 ${skipped}）` : '';
  const abortSuffix = abortedAfter ? `；致命错误后短路（处理 ${processed} / ${tasks.length}）` : '';
  const reasonSuffix = reasons.length > 0 ? `；${reasons.join('；')}` : '';
  const message = failed === 0
    ? `${kindLabel(kind)}巡更：${succeeded} / ${tasks.length} 成功${skippedSuffix}。`
    : `${kindLabel(kind)}巡更：${succeeded} 成功 / ${failed} 失败${skippedSuffix}${abortSuffix}${reasonSuffix}`;
  return { ok: failed === 0, scope: kind, processed: tasks.length, succeeded, failed, skipped, reasons, message };
}

function kindLabel(kind: RadarKind): string {
  return { monitor: '监控雷达', topic: '选题挖掘', digest: '关注摘要', stats: '数据拆解' }[kind];
}

async function runOneTask(kind: RadarKind, task: AppRow<RadarTaskRow>, input: PatrolInput, now: number): Promise<TaskResult> {
  const store = input.store;
  const startedAt = new Date(now).toISOString();
  const parsed = parseConfig(task.config_json);
  if ('error' in parsed) {
    // config JSON 语法错 — 如实标，不偷偷返回 {} 让用户摸不着头脑
    store.update<RadarTaskRow>('radar_tasks', task.id, {
      last_status: 'failed',
      last_summary: 'config_json 解析失败',
      last_failure_reason: parsed.error,
      last_run_started_at: startedAt,
      updated_at: startedAt,
    });
    return { ok: false, reason: parsed.error, summary: 'config_json 解析失败' };
  }
  const config = parsed.config;

  // last_run_started_at 是 cadence 算法的锚点 —— 一旦开始 patrol 就刷新，无论后续 success/failed
  // 都不能再用本字段做 cadence reset 漏洞。
  store.update<RadarTaskRow>('radar_tasks', task.id, {
    last_status: 'running',
    last_summary: `正在跑 ${kindLabel(kind)}`,
    last_run_started_at: startedAt,
    next_run_at: computeNextRunAt(task.cadence, now),
    updated_at: startedAt,
  });

  try {
    throwIfAborted(input.signal, 'before run');
    let result: TaskResult;
    if (kind === 'monitor') result = await runMonitor(task, config, store, startedAt, input);
    else if (kind === 'topic') result = await runTopic(task, config, store, startedAt, input);
    else if (kind === 'digest') result = await runDigest(task, config, store, startedAt, input);
    else result = await runStats(task, config, store, startedAt, input);

    const endedAt = new Date(Date.now()).toISOString();
    store.update<RadarTaskRow>('radar_tasks', task.id, {
      last_status: result.ok ? 'success' : 'failed',
      last_summary: result.summary,
      last_failure_reason: result.ok ? '' : result.reason,
      updated_at: endedAt,
    });
    writeRunHistory(store, task, kind, result.ok ? 'success' : 'failed', result.summary, result.ok ? '' : result.reason, startedAt, endedAt);
    return result;
  } catch (err) {
    // abort 时把 task 标 cancelled 而非 failed（语义区分用户主动停 vs 错误）
    if (isAbortError(err)) {
      const endedAt = new Date(Date.now()).toISOString();
      const summary = '用户取消';
      store.update<RadarTaskRow>('radar_tasks', task.id, {
        last_status: 'cancelled', last_summary: summary, last_failure_reason: '', updated_at: endedAt,
      });
      writeRunHistory(store, task, kind, 'failed', summary, '用户取消', startedAt, endedAt);
      throw err; // 上抛让 runQueue 短路
    }
    const reason = err instanceof Error ? err.message : String(err);
    const finalReason = isXAuthExpiredError(err) ? 'X_AUTH_EXPIRED' : reason;
    const endedAt = new Date(Date.now()).toISOString();
    const summary = finalReason === 'X_AUTH_EXPIRED' ? 'X 登录失效' : reason.slice(0, 200);
    store.update<RadarTaskRow>('radar_tasks', task.id, {
      last_status: 'failed', last_summary: summary, last_failure_reason: finalReason, updated_at: endedAt,
    });
    writeRunHistory(store, task, kind, 'failed', summary, finalReason, startedAt, endedAt);
    return { ok: false, reason: finalReason, summary };
  }
}

function writeRunHistory(
  store: import('@/lib/app/runtime/data-store').AppDataStore,
  task: AppRow<RadarTaskRow>,
  kind: RadarKind,
  status: 'success' | 'failed',
  summary: string,
  failureReason: string,
  startedAt: string,
  endedAt: string,
): void {
  try {
    store.create('run_history', {
      title: `${kindLabel(kind)}：${task.name ?? '未命名'}`,
      status,
      summary,
      failure_reason: failureReason,
      task_ref: task.id,
      task_kind: kind,
      started_at: startedAt,
      ended_at: endedAt,
      updated_at: endedAt,
    });
  } catch (err) {
    console.warn('[x-radar] writeRunHistory failed:', err instanceof Error ? err.message : err);
  }
}

function parseConfig(raw: string | undefined): { config: Record<string, unknown> } | { error: string } {
  if (!raw || !raw.trim()) return { config: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'config_json 必须是对象（{} 包裹的键值对）。' };
    }
    return { config: parsed as Record<string, unknown> };
  } catch (err) {
    return { error: `config_json 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

function computeNextRunAt(cadence: Cadence | undefined, now: number): string {
  const c = cadence ?? 'daily';
  if (c === 'manual') return '';
  const window = CADENCE_MS[c];
  if (!Number.isFinite(window)) return '';
  return new Date(now + window).toISOString();
}
// cleanup 实现见 patrol-types.ts 的 cleanupOldEvidence。
