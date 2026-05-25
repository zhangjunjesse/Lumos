/**
 * X 雷达 patrol 共享类型 — 给 patrol.ts / patrol-monitor.ts / patrol-ai.ts 共用。
 */

import type Database from 'better-sqlite3';
import type { AppDataStore } from '@/lib/app/runtime/data-store';

export interface PatrolInput {
  store: AppDataStore;
  /** 主进程 SQLite handle；patrol 调 IM / 跨应用 service 时需要。可选，纯抓取场景可不传。 */
  db?: Database.Database;
  /** 应用安装 ID；调 IM 时识别应用身份。 */
  appId?: string;
  now?: () => number;
  /** 取消信号 —— 前端 abort 请求时 patrol 检查这个，已 abort 立即返回，不再消耗 X 配额。 */
  signal?: AbortSignal;
}

/** 通用 helper：检查 abort signal，已取消则抛 AbortError（patrol 内部捕获后返 cancelled 结果）。 */
export function throwIfAborted(signal: AbortSignal | undefined, where: string): void {
  if (signal?.aborted) {
    const err = new Error(`patrol cancelled at ${where}`);
    err.name = 'AbortError';
    throw err;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

const EVIDENCE_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * 每次 patrol 顺手清 30 天前的 tweet_evidence + 同步清 task_evidence_refs 里
 * 超 TTL 或指向已删 tweet 的悬挂引用。防止 isolated DB 无限膨胀。
 */
export function cleanupOldEvidence(store: AppDataStore, now: number): void {
  const cutoff = now - EVIDENCE_TTL_MS;
  const rows = store.query<{ snapshot_at?: string }>('tweet_evidence', { limit: 5000 });
  const deletedTweetIds = new Set<string>();
  for (const row of rows) {
    const at = row.snapshot_at ? Date.parse(row.snapshot_at) : NaN;
    if (Number.isFinite(at) && at < cutoff) {
      try { store.delete('tweet_evidence', row.id); deletedTweetIds.add(row.id); } catch { /* ignore */ }
    }
  }
  const refs = store.query<{ tweet_id?: string; matched_at?: string }>('task_evidence_refs', { limit: 10000 });
  for (const ref of refs) {
    const refAt = ref.matched_at ? Date.parse(ref.matched_at) : NaN;
    const isStaleByTime = Number.isFinite(refAt) && refAt < cutoff;
    const isDangling = ref.tweet_id ? deletedTweetIds.has(ref.tweet_id) : true;
    if (isStaleByTime || isDangling) {
      try { store.delete('task_evidence_refs', ref.id); } catch { /* ignore */ }
    }
  }
}

export type RadarKind = 'monitor' | 'topic' | 'digest' | 'stats';

export interface PatrolReport {
  ok: boolean;
  scope: RadarKind;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  reasons: string[];
  message: string;
}

export interface RadarTaskRow extends Record<string, unknown> {
  id: string;
  name?: string;
  kind?: RadarKind;
  enabled?: boolean;
  cadence?: Cadence;
  config_json?: string;
  last_run_id?: string;
  /** 本次 patrol 开始时间戳（cadence 算法用这个，不用 updated_at —— updated_at 会被任何 update 刷新）。 */
  last_run_started_at?: string;
  last_status?: string;
  last_summary?: string;
  last_failure_reason?: string;
  next_run_at?: string;
  im_enabled?: boolean;
  im_target_label?: string;
  /** 推 IM 时报告格式：'image'（PNG 长图，默认）/ 'docx'。 */
  report_format?: string;
  /** 图片报告样式：'minimal' / 'business' / 'magazine' / 'dark'。仅 report_format='image' 生效。 */
  report_style?: string;
  updated_at?: string;
}

export type Cadence = 'hourly' | 'every_6_hours' | 'daily' | 'weekly' | 'manual';

export interface TaskResult { ok: boolean; reason: string; summary: string; }
