// ② Trending 采集 — 直接调 Pinterest 的 /top_trends_filtered/ API
//
// 通过 _pinterest-tab-xhr-probe.mjs 实测发现:Pinterest Trends 4 个 tab 的真正数据源是
//   GET /top_trends_filtered/?lookbackWindow=2&endDate=YYYY-MM-DD&rankingMethod=3
//        &country=US&trendsPreset=N&numTermsToReturn=K
// trendsPreset:3=Growing, 4=Seasonal, 1=Monthly, 2=Yearly
// response: { "values": [{ term, reverseRank, normalizedCount, seasonality_score,
//                          wow_change:{value}, mom_change:{value}, yoy_change:{value} }] }
//
// 这个 API 一次返回 trending 词 + 增长率 + 季节性得分,完全替代旧的 DOM 选择器 / metrics 拦截策略。
// endDate 同样要求 ≥ 9 天前(Pinterest 当前数据延迟),用 10 天留余量。

import { chromium, type BrowserContext } from 'playwright';

import { startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';
import { getDb } from '../db/connection';
import type { TrendsPreset } from './types';

export interface CollectTrendingOptions {
  runId: string;
  country: string;
  preset: TrendsPreset;
  /** 已废弃 —— 4 tab 切换 URL 不变,Pinterest 不支持品类前置筛选,字段保留兼容 */
  category?: string;
  limit: number;                  // 20-200
  browserContextId?: string;
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
}

export interface CollectTrendingResult {
  inserted: number;
  apiReturned: number;
}

// trendsPreset URL 参数:实测见 scripts/_pinterest-tab-xhr-probe.mjs
const PRESET_PARAM: Record<TrendsPreset, string> = {
  growing: '3',
  seasonal: '4',
  monthly: '1',
  yearly: '2',
};

// 同步 metrics-fetcher 的延迟常量
const PINTEREST_DATA_LAG_DAYS = 10;

interface TopTrendsItem {
  term: string;
  reverseRank?: number;                // Pinterest 用反向:20 = #1,1 = #20
  normalizedCount?: number;
  seasonality_score?: number;
  wow_change?: { value?: number | null } | null;
  mom_change?: { value?: number | null } | null;
  yoy_change?: { value?: number | null } | null;
}

interface TopTrendsResponse {
  values?: TopTrendsItem[];
}

function buildEndDate(): string {
  return new Date(Date.now() - PINTEREST_DATA_LAG_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function collectTrending(opts: CollectTrendingOptions): Promise<CollectTrendingResult> {
  const { runId, country, preset, category, limit, browserContextId, appendLog: log, isAborted } = opts;
  if (category && category.trim()) {
    log(`  ⚠ category="${category}" 未生效(Pinterest /top_trends_filtered/ 不支持品类筛选)`, 'warn');
  }

  log(`▶ 启动浏览器(country=${country} preset=${preset} → trendsPreset=${PRESET_PARAM[preset]})`);
  const handle = await startAdsPowerForContext(browserContextId);
  log(`  debug_port=${handle.debugPort}`);
  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0] as BrowserContext | undefined;
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower 无 context');
  }

  // 必须从 trends.pinterest.com 页面发请求(Pinterest 校验 referer)
  const page = await ctx.newPage();
  let items: TopTrendsItem[] = [];
  try {
    log(`▶ 打开 trends.pinterest.com 拿登录态/referer`);
    if (isAborted()) throw new Error('aborted');
    await page.goto(`https://trends.pinterest.com/?country=${country}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2_500);

    const endDate = buildEndDate();
    // Pinterest /top_trends_filtered/ 硬上限实测 100(>= 150 直接 400 + body={})
    const numTerms = Math.max(20, Math.min(100, limit));
    const url = `/top_trends_filtered/?lookbackWindow=2&endDate=${endDate}&rankingMethod=3&country=${country}&trendsPreset=${PRESET_PARAM[preset]}&numTermsToReturn=${numTerms}`;
    log(`▶ GET ${url}`);
    if (isAborted()) throw new Error('aborted');

    const result = await page.evaluate(async (u: string) => {
      try {
        const res = await fetch(u, {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'x-new-site': 'true' },
          credentials: 'include',
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
        try {
          return { ok: true, status: res.status, body: JSON.parse(text) as unknown };
        } catch (e) {
          return { ok: false, status: res.status, error: `parse-error: ${(e as Error).message}` };
        }
      } catch (e) {
        return { ok: false, status: 0, error: (e as Error).message };
      }
    }, url);

    if (!result.ok) {
      throw new Error(`/top_trends_filtered/ HTTP ${result.status}: ${result.error}`);
    }
    const body = result.body as TopTrendsResponse;
    items = Array.isArray(body?.values) ? body.values : [];
    log(`  ✓ API 返回 ${items.length} 个 trending 词`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // 入库 —— 跑前清掉旧 trending(同一 run 重跑 ② 时覆盖)
  const db = getDb();
  db.prepare('DELETE FROM pinterest_trending WHERE run_id = ?').run(runId);
  const stmt = db.prepare(`
    INSERT INTO pinterest_trending (run_id, rank, term, preset, normalized_count, seasonality_score, wow_change, mom_change, yoy_change, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  // reverseRank: Pinterest 20=#1,1=#20。换算回 1-based rank。
  // numTermsToReturn=20 时,reverseRank ∈ [1,20]。
  const maxReverseRank = Math.max(...items.map((it) => it.reverseRank ?? 0), 0);
  const insertMany = db.transaction((rows: TopTrendsItem[]) => {
    for (const r of rows) {
      const term = r.term?.trim();
      if (!term) continue;
      const rank = r.reverseRank != null ? (maxReverseRank - r.reverseRank + 1) : null;
      stmt.run(
        runId, rank, term, preset,
        typeof r.normalizedCount === 'number' ? r.normalizedCount : null,
        typeof r.seasonality_score === 'number' ? r.seasonality_score : null,
        typeof r.wow_change?.value === 'number' ? r.wow_change.value : null,
        typeof r.mom_change?.value === 'number' ? r.mom_change.value : null,
        typeof r.yoy_change?.value === 'number' ? r.yoy_change.value : null,
        now,
      );
    }
  });
  insertMany(items);

  const inserted = (db.prepare('SELECT COUNT(*) as cnt FROM pinterest_trending WHERE run_id = ?').get(runId) as { cnt: number }).cnt;
  return { inserted, apiReturned: items.length };
}
