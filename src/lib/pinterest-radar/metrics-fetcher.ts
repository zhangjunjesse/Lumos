// ③ Metrics 拉取 — 调 trends.pinterest.com/metrics/?terms=... 拿 90 天 sparkline + WoW/MoM/YoY
//
// 必须从 trends.pinterest.com 页面发请求(referer 校验)。
// 单次最多 5 个 term 一批(Pinterest 没明确限制,实测 50 也行,但保守批 10 个避免 429)。

import { chromium, type BrowserContext, type Page } from 'playwright';

import { startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';
import { getDb } from '../db/connection';

export interface FetchMetricsOptions {
  runId: string;
  country: string;
  days: number;
  browserContextId?: string;
  batchSize?: number;            // 默认 10
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
  reportProgress?: (done: number, total: number) => void;
}

export interface FetchMetricsResult {
  fetched: number;
  failed: number;
  totalTerms: number;
}

interface PinterestMetricsItem {
  term: string;
  growth_rates?: {
    wow_change?: number | null;
    mom_change?: number | null;
    yoy_change?: number | null;
  };
  counts?: Array<{ date: string; normalizedCount: number }>;
  has_prediction?: boolean;
}

// Pinterest /metrics 接口当前(2026-05 实测)数据延迟 9 天:
//   end_date < 9 天前 → 400 + body=[]
//   end_date >= 9 天前 → 200(返回近 90 天 sparkline + WoW/MoM/YoY)
// 取 10 天留 1 天余量,应对 Pinterest 偶发再延迟一天的情况。
// 实测脚本:scripts/_pinterest-metrics-test2.mjs
const METRICS_DATA_LAG_DAYS = 10;

function buildEndDate(): string {
  return new Date(Date.now() - METRICS_DATA_LAG_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 用 page.evaluate 调 fetch /metrics(走 referer + cookie),拿一批 terms 的数据 */
async function fetchMetricsBatch(
  page: Page,
  terms: string[],
  country: string,
  days: number,
  endDate: string,
): Promise<{ ok: boolean; status: number; items: PinterestMetricsItem[]; error?: string }> {
  return await page.evaluate(async (args: { terms: string[]; country: string; days: number; endDate: string }) => {
    // 空格用 + 表示(form-urlencoded 历史);逗号用 %2C 隔。
    // 不要再套 encodeURIComponent —— 会把 + 编成 %2B(字面加号),Pinterest 解析错。
    const termsParam = args.terms.map((k) => k.replace(/ /g, '+')).join('%2C');
    const url = `/metrics/?terms=${termsParam}&country=${args.country}&end_date=${args.endDate}&days=${args.days}&aggregation=2&normalize_against_group=false&predicted_days=0`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json, text/plain, */*', 'x-new-site': 'true' },
        credentials: 'include',
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, status: res.status, items: [], error: `HTTP ${res.status} — ${text.slice(0, 200)}` };
      }
      try {
        const parsed = JSON.parse(text) as PinterestMetricsItem[];
        if (!Array.isArray(parsed)) return { ok: false, status: res.status, items: [], error: 'not-array' };
        return { ok: true, status: res.status, items: parsed };
      } catch (e) {
        return { ok: false, status: res.status, items: [], error: `parse-error: ${(e as Error).message}` };
      }
    } catch (e) {
      return { ok: false, status: 0, items: [], error: (e as Error).message };
    }
  }, { terms, country, days, endDate });
}

export async function fetchAllMetrics(opts: FetchMetricsOptions): Promise<FetchMetricsResult> {
  const { runId, country, days, browserContextId, appendLog: log, isAborted, reportProgress } = opts;
  const batchSize = Math.max(1, Math.min(20, opts.batchSize ?? 10));

  // 拉本轮待补 metrics 的 terms — 尚未在 pinterest_metrics 表的 trending 词
  const db = getDb();
  const pending = db.prepare(`
    SELECT t.term
      FROM pinterest_trending t
      LEFT JOIN pinterest_metrics m ON m.run_id = t.run_id AND m.term = t.term
     WHERE t.run_id = ? AND m.term IS NULL
     ORDER BY t.rank ASC NULLS LAST, t.id ASC
  `).all(runId) as Array<{ term: string }>;
  const terms = pending.map((r) => r.term);
  const totalTerms = terms.length;
  if (totalTerms === 0) {
    log('  没有待补 metrics 的 trending 词(都已有数据)');
    return { fetched: 0, failed: 0, totalTerms: 0 };
  }
  log(`  待拉 metrics: ${totalTerms} 个 term · 每批 ${batchSize}`);

  log(`▶ 启动浏览器(走 Pinterest 登录态)`);
  const handle = await startAdsPowerForContext(browserContextId);
  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0] as BrowserContext | undefined;
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower 无 context');
  }

  // 每次新开 tab —— 复用已有页可能命中登录页 / 关键词详情页,page.evaluate 行为不定。
  // 拿完数据立即关掉,不残留。
  const page: Page = await ctx.newPage();
  await page.goto(`https://trends.pinterest.com/?country=${country}&trendsPreset=3`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3_000);

  let fetched = 0;
  let failed = 0;
  const endDate = buildEndDate();
  const insertStmt = db.prepare(`
    INSERT INTO pinterest_metrics (run_id, term, wow_change, mom_change, yoy_change, counts_json, has_prediction, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, term) DO UPDATE SET
      wow_change=excluded.wow_change,
      mom_change=excluded.mom_change,
      yoy_change=excluded.yoy_change,
      counts_json=excluded.counts_json,
      has_prediction=excluded.has_prediction,
      fetched_at=excluded.fetched_at
  `);
  const insertMany = db.transaction((items: PinterestMetricsItem[]) => {
    const now = Date.now();
    for (const it of items) {
      insertStmt.run(
        runId,
        it.term,
        typeof it.growth_rates?.wow_change === 'number' ? it.growth_rates.wow_change : null,
        typeof it.growth_rates?.mom_change === 'number' ? it.growth_rates.mom_change : null,
        typeof it.growth_rates?.yoy_change === 'number' ? it.growth_rates.yoy_change : null,
        JSON.stringify(it.counts ?? []),
        it.has_prediction ? 1 : 0,
        now,
      );
    }
  });

  try {
    for (let i = 0; i < terms.length; i += batchSize) {
      if (isAborted()) throw new Error('aborted');
      const batch = terms.slice(i, i + batchSize);
      const result = await fetchMetricsBatch(page, batch, country, days, endDate);
      if (!result.ok) {
        log(`  ✗ 批 ${i / batchSize + 1} 失败(${result.status}): ${result.error}`, 'error');
        failed += batch.length;
      } else {
        insertMany(result.items);
        fetched += result.items.length;
        const missing = batch.length - result.items.length;
        if (missing > 0) {
          log(`  ⚠ 批 ${i / batchSize + 1} 缺 ${missing} 个 term(Pinterest 没收录)`, 'warn');
          failed += missing;
        }
      }
      reportProgress?.(Math.min(i + batch.length, totalTerms), totalTerms);
      // 节流,避免 429
      await page.waitForTimeout(800);
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return { fetched, failed, totalTerms };
}
