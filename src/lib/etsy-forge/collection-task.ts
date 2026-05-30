// 关键词采集任务 CRUD。任务运行（爬列表）在 list-collect.ts。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import {
  COLLECTIONS,
  type KeywordTaskRow,
  type TaskSchedule,
  type TaskStatus,
} from './types';

export const DEFAULT_MAX_PRODUCTS = 24;
export const DEFAULT_MAX_PAGES = 40;
export const MAX_PAGES_CAP = 100;

/** 价格门槛归一化：非负、保留两位小数。0 = 不限。 */
export function clampPrice(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

/** 最大翻页数归一化：整数，夹在 [1, MAX_PAGES_CAP]。 */
export function clampPages(n: number): number {
  return Math.max(1, Math.min(MAX_PAGES_CAP, Math.floor(n) || DEFAULT_MAX_PAGES));
}

export interface CreateTaskInput {
  userId: string;
  keyword: string;
  schedule?: TaskSchedule;
  maxProducts?: number;
  minSales?: number;
  minFavorites?: number;
  minPrice?: number;
  maxPrice?: number;
  maxPages?: number;
  enabled?: boolean;
}

export function createTask(store: AppDataStore, input: CreateTaskInput): KeywordTaskRow {
  const now = new Date().toISOString();
  const row = store.create(COLLECTIONS.TASKS, {
    user_id: input.userId,
    keyword: input.keyword.trim(),
    source: 'etsy',
    enabled: input.enabled ?? true,
    schedule: input.schedule ?? 'manual',
    max_products: input.maxProducts ?? DEFAULT_MAX_PRODUCTS,
    min_sales: input.minSales ?? 0,
    min_favorites: input.minFavorites ?? 0,
    min_price: input.minPrice ?? 0,
    max_price: input.maxPrice ?? 0,
    max_pages: input.maxPages ?? DEFAULT_MAX_PAGES,
    total_collected: 0,
    last_status: 'idle',
    last_collected_count: 0,
    created_at: now,
  });
  return row as unknown as KeywordTaskRow;
}

export function listTasks(store: AppDataStore, userId: string): KeywordTaskRow[] {
  return store.query<KeywordTaskRow>(COLLECTIONS.TASKS, {
    filter: { user_id: userId },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 200,
  });
}

export function getTask(store: AppDataStore, taskId: string): KeywordTaskRow | null {
  return store.get<KeywordTaskRow>(COLLECTIONS.TASKS, taskId);
}

export function updateTask(
  store: AppDataStore,
  taskId: string,
  patch: Partial<KeywordTaskRow>,
): KeywordTaskRow | null {
  return store.update<KeywordTaskRow>(COLLECTIONS.TASKS, taskId, patch);
}

export function deleteTask(store: AppDataStore, taskId: string): boolean {
  return store.delete(COLLECTIONS.TASKS, taskId);
}

export function setTaskRunning(store: AppDataStore, taskId: string): void {
  store.update<KeywordTaskRow>(COLLECTIONS.TASKS, taskId, {
    last_status: 'running' as TaskStatus,
    last_run_at: new Date().toISOString(),
  });
}

export function finishTask(
  store: AppDataStore,
  taskId: string,
  result: { status: TaskStatus; collectedCount: number; failureReason?: string; runId?: string },
): void {
  const existing = getTask(store, taskId);
  if (!existing) return;
  store.update<KeywordTaskRow>(COLLECTIONS.TASKS, taskId, {
    last_status: result.status,
    last_collected_count: result.collectedCount,
    last_failure_reason: result.failureReason,
    last_run_id: result.runId,
    total_collected: existing.total_collected + result.collectedCount,
  });
}

export function recoverStaleRunningTasks(store: AppDataStore): void {
  const cutoff = Date.now() - 10 * 60_000;
  const tasks = store.query<KeywordTaskRow>(COLLECTIONS.TASKS, { limit: 500 });
  for (const t of tasks) {
    if (t.last_status !== 'running') continue;
    const startedAt = t.last_run_at ? Date.parse(t.last_run_at) : NaN;
    if (Number.isFinite(startedAt) && startedAt >= cutoff) continue;
    store.update<KeywordTaskRow>(COLLECTIONS.TASKS, t.id, {
      last_status: 'failed',
      last_failure_reason: '上次运行未正常结束（可能进程被强退）',
    });
  }
}
