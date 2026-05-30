// 第一步编排：跑一个关键词任务 → collectEtsyListings 爬列表 → upsert 商品入 etsy_forge_products。
// 按 listing_id 去重（重爬更新 EHunt 指标，保留用户的 selected / detail 状态）。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { finishTask, setTaskRunning } from './collection-task';
import { collectEtsyListings } from './product-collector';
import { COLLECTIONS, type KeywordTaskRow, type ProductRow, type RunStatus } from './types';

export interface RunListCollectInput {
  browserContextId?: string;
  maxProductsOverride?: number;
  isAborted?: () => boolean;
  appendLog?: (msg: string) => void;
}

export interface RunListCollectResult {
  runId: string;
  productsFound: number;
  inserted: number;
  ehuntStatus: string;
  ehuntHitCount: number;
  warning?: string;
}

export async function runListCollect(
  store: AppDataStore,
  task: KeywordTaskRow,
  input: RunListCollectInput = {},
): Promise<RunListCollectResult> {
  const startedAt = new Date().toISOString();
  const run = store.create(COLLECTIONS.RUNS, {
    user_id: task.user_id,
    kind: 'list_collect',
    keyword: task.keyword,
    products_found: 0,
    ehunt_ok_count: 0,
    images_collected: 0,
    status: 'running',
    started_at: startedAt,
  });
  setTaskRunning(store, task.id);

  try {
    // 跨执行去重：这个关键词历史上采过的 listing_id 全排除，本次只攒没采过的新品。
    const prior = store.query<ProductRow>(COLLECTIONS.PRODUCTS, {
      filter: { user_id: task.user_id, keyword: task.keyword },
      limit: 5000,
    });
    const excludeListingIds = new Set(prior.map((p) => p.listing_id));

    const result = await collectEtsyListings({
      keyword: task.keyword,
      maxProducts: input.maxProductsOverride ?? task.max_products,
      excludeListingIds,
      minSales: task.min_sales ?? 0,
      minFavorites: task.min_favorites ?? 0,
      minPrice: task.min_price ?? 0,
      maxPrice: task.max_price ?? 0,
      maxPages: task.max_pages ?? 40,
      browserContextId: input.browserContextId,
      isAborted: input.isAborted,
      appendLog: input.appendLog,
    });

    // 每次执行是独立批次：本次爬到的商品全部入库（带 run_id/run_at）。
    // 同一次执行内已由 collector 按 listing_id 去重；不跨执行合并——
    // 反复跑同一关键词时每次执行各成一批快照，供按批次区分/对比。
    let inserted = 0;
    for (const p of result.products) {
      store.create(COLLECTIONS.PRODUCTS, {
        user_id: task.user_id,
        task_id: task.id,
        run_id: run.id,
        run_at: startedAt,
        keyword: task.keyword,
        source: 'etsy' as const,
        listing_id: p.listingId,
        title: p.title,
        url: p.url,
        main_image_url: p.mainImageUrl,
        price: p.price ?? undefined,
        rating: p.rating ?? undefined,
        reviews: p.reviews ?? undefined,
        ehunt_json: p.ehunt ? JSON.stringify(p.ehunt) : undefined,
        ehunt_status: result.ehuntStatus,
        selected: false,
        detail_status: 'idle',
        detail_image_count: 0,
        created_at: new Date().toISOString(),
      });
      inserted++;
    }

    const status: RunStatus = result.products.length > 0 ? 'success' : 'failed';
    store.update(COLLECTIONS.RUNS, run.id, {
      products_found: result.products.length,
      ehunt_ok_count: result.ehuntHitCount,
      status,
      failure_reason: result.products.length === 0 ? result.warning : undefined,
      ended_at: new Date().toISOString(),
    });
    finishTask(store, task.id, {
      status,
      collectedCount: inserted,
      failureReason: result.products.length === 0 ? result.warning : undefined,
      runId: run.id,
    });

    return {
      runId: run.id,
      productsFound: result.products.length,
      inserted,
      ehuntStatus: result.ehuntStatus,
      ehuntHitCount: result.ehuntHitCount,
      warning: result.warning,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    store.update(COLLECTIONS.RUNS, run.id, {
      status: 'failed',
      failure_reason: reason,
      ended_at: new Date().toISOString(),
    });
    finishTask(store, task.id, { status: 'failed', collectedCount: 0, failureReason: reason, runId: run.id });
    return {
      runId: run.id,
      productsFound: 0,
      inserted: 0,
      ehuntStatus: 'failed',
      ehuntHitCount: 0,
      warning: reason,
    };
  }
}

const SCHEDULE_INTERVAL_MS: Record<KeywordTaskRow['schedule'], number | null> = {
  manual: null,
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

function isTaskDue(task: KeywordTaskRow, now: number): boolean {
  const iv = SCHEDULE_INTERVAL_MS[task.schedule];
  if (iv === null) return false; // manual 永不自动跑
  if (!task.last_run_at) return true;
  const last = Date.parse(task.last_run_at);
  return !Number.isFinite(last) || now - last >= iv;
}

/** 后台批量：扫 enabled 关键词任务，按 schedule cadence 到点的逐个跑列表采集（供自动化用）。 */
export async function runAllEnabledListCollects(
  store: AppDataStore,
  browserContextId: string,
): Promise<{ ran: number; skipped: number; succeeded: number; failed: number; totalProducts: number }> {
  const tasks = store.query<KeywordTaskRow>(COLLECTIONS.TASKS, { filter: { enabled: true }, limit: 100 });
  const now = Date.now();
  let ran = 0;
  let skipped = 0;
  let succeeded = 0;
  let failed = 0;
  let totalProducts = 0;
  for (const task of tasks) {
    if (!isTaskDue(task, now)) {
      skipped++;
      continue;
    }
    const r = await runListCollect(store, task, { browserContextId });
    ran++;
    if (r.productsFound > 0) succeeded++;
    else failed++;
    totalProducts += r.productsFound;
  }
  return { ran, skipped, succeeded, failed, totalProducts };
}
