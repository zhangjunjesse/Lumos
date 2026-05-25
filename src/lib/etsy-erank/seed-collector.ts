// ② 市场热词采集 — 把 scripts/erank-seed-collect.mjs 的逻辑搬到 lib
// 用 Playwright + AdsPower CDP 抓 eRank Trend Buzz + Monthly Trends 表格
// SOP §5.1:不停 AdsPower / 不切用户当前可见 tab / 不烧 eRank 配额

import { chromium, type Page } from 'playwright';

import { startAdsPowerForContext } from './adspower';
import { getDb } from '../db/connection';

const TREND_BUZZ_URL = 'https://erank.com/trend-buzz';
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TIMEFRAME_LABELS: Record<string, string> = {
  yesterday: 'Yesterday',
  'last-30-days': 'Last 30 Days',
};

function resolveTimeframeLabel(tf: string): string {
  if (TIMEFRAME_LABELS[tf]) return TIMEFRAME_LABELS[tf];
  const m = tf.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTH_SHORT[parseInt(m[2], 10) - 1]} ${m[1]}`;
  return tf;
}

interface ScrapedTable {
  headers: string[];
  rows: string[][];
}

async function scrape(page: Page): Promise<ScrapedTable> {
  await page.waitForLoadState('networkidle').catch(() => {});
  const initial = await page
    .evaluate(() => document.querySelectorAll('table tbody tr').length)
    .catch(() => 0);
  if (initial < 20) {
    try {
      await page.mouse.move(400, 400);
      let lastCount = initial;
      let stable = 0;
      const start = Date.now();
      while (Date.now() - start < 30_000 && stable < 5) {
        await page.mouse.wheel(0, 1500);
        await page.waitForTimeout(350);
        const c = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
        if (c === lastCount) stable += 1;
        else {
          stable = 0;
          lastCount = c;
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    } catch {
      /* ignore */
    }
  }
  return page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    if (tables.length === 0) return { headers: [], rows: [] };
    const table = tables.reduce<HTMLTableElement | null>((max, t) => {
      const cnt = t.querySelectorAll('tbody tr').length;
      const maxCnt = max ? max.querySelectorAll('tbody tr').length : -1;
      return cnt > maxCnt ? t : max;
    }, null);
    if (!table) return { headers: [], rows: [] };
    let headers = [...table.querySelectorAll('thead th')].map((th) => (th as HTMLElement).innerText.trim());
    if (headers.length === 0) {
      const headTable = tables.find((t) => t.querySelectorAll('thead th').length > 0);
      headers = headTable
        ? [...headTable.querySelectorAll('thead th')].map((th) => (th as HTMLElement).innerText.trim())
        : [];
    }
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
      return [...tr.querySelectorAll('td')].map((td) => {
        const el = td as HTMLElement;
        const txt = el.innerText.trim();
        if (txt) return txt;
        const bar = el.querySelector('[style*="width"]') as HTMLElement | null;
        if (bar && bar.style && bar.style.width) return `bar:${bar.style.width}`;
        const aria = el.getAttribute('aria-label');
        if (aria) return aria;
        if (el.querySelector('svg')) return '(sparkline)';
        return '';
      });
    });
    return { headers, rows };
  });
}

async function setTimeframe(page: Page, timeframe: string): Promise<boolean> {
  const label = resolveTimeframeLabel(timeframe);
  const ok = await page.evaluate(async (want: string) => {
    // 原生 <select>
    const selects = [...document.querySelectorAll('select')] as HTMLSelectElement[];
    for (const s of selects) {
      const opt = [...s.options].find((o) => o.text.trim() === want);
      if (opt) {
        s.value = opt.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // 自定义 dropdown
    const candidates = [...document.querySelectorAll('button, [role="combobox"], [role="button"]')] as HTMLElement[];
    const trigger = candidates.find((b) => /(Yesterday|Last 30 Days|[A-Z][a-z]{2} \d{4})/.test((b.innerText || '')));
    if (!trigger) return false;
    trigger.click();
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        const items = [...document.querySelectorAll('[role="option"], li, button')] as HTMLElement[];
        const item = items.find((i) => (i.innerText || '').trim() === want);
        if (item) {
          item.click();
          resolve(true);
        } else {
          resolve(false);
        }
      }, 300);
    });
  }, label);
  if (ok) await page.waitForLoadState('networkidle').catch(() => {});
  return ok;
}

async function discoverMonthlyTrendsUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')] as HTMLAnchorElement[];
    const match = links.find((a) => /monthly\s*trends?/i.test(a.textContent || ''));
    return match ? new URL(match.getAttribute('href')!, location.origin).toString() : null;
  });
}

function rowToObject(headers: string[], row: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[h || `col_${i}`] = row[i] ?? '';
  });
  return o;
}

// 把 eRank 列名映射到 DB 字段
function pickColumn(obj: Record<string, string>, candidates: string[]): string {
  for (const k of candidates) {
    for (const key of Object.keys(obj)) {
      if (key.trim().toLowerCase() === k.toLowerCase()) return obj[key] ?? '';
    }
  }
  return '';
}

export interface CollectOptions {
  runId: string;
  timeframe?: string;          // 'yesterday' (默认) / 'last-30-days' / 'YYYY-MM'
  limit?: number;              // 每源最多多少行
  browserContextId?: string;   // Lumos browser context(可选,默认走 env)
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
}

export interface CollectResult {
  trendBuzzCount: number;
  monthlyCount: number;
  totalInserted: number;
}

function insertSeeds(runId: string, sourceTool: string, timeframe: string, objects: Array<Record<string, string>>) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO radar_seeds (run_id, source_tool, timeframe, rank, keyword, change_str, avg_searches, avg_ctr, competition, trend_note, category, collected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const insertMany = db.transaction((rows: Array<Record<string, string>>) => {
    for (const o of rows) {
      const keyword = pickColumn(o, ['Keywords', 'Keyword']).trim();
      if (!keyword) continue;
      const rank = Number(pickColumn(o, ['Rank', '#'])) || null;
      stmt.run(
        runId,
        sourceTool,
        timeframe,
        rank,
        keyword,
        pickColumn(o, ['Change', '涨跌']),
        pickColumn(o, ['Avg Searches', 'Searches', '月搜']),
        pickColumn(o, ['Avg CTR', 'CTR']),
        pickColumn(o, ['Etsy Competition', 'Competition']),
        pickColumn(o, ['Search Trend', 'Top Month', 'Peak']),
        pickColumn(o, ['Category', 'Cat']),
        now,
      );
    }
  });
  insertMany(objects);
}

export async function collectSeeds(opts: CollectOptions): Promise<CollectResult> {
  const { runId, appendLog, isAborted } = opts;
  const timeframe = opts.timeframe ?? 'yesterday';
  const limit = opts.limit ?? 100;

  appendLog(`▶ 启动 AdsPower profile`);
  const handle = await startAdsPowerForContext(opts.browserContextId);
  appendLog(`  debug_port=${handle.debugPort}`);

  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower 无 context');
  }

  let trendBuzzCount = 0;
  let monthlyCount = 0;
  let totalInserted = 0;

  try {
    // 1. Trend Buzz
    appendLog(`▶ Trend Buzz — ${TREND_BUZZ_URL} (timeframe=${timeframe})`);
    if (isAborted()) throw new Error('aborted');
    const tbPage = await ctx.newPage();
    try {
      await tbPage.goto(TREND_BUZZ_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (/login|signin/i.test(tbPage.url())) {
        throw new Error(`未登录 eRank — 当前页 ${tbPage.url()}`);
      }
      await tbPage.waitForSelector('table tbody tr', { timeout: 15_000 }).catch(() => {});
      const switched = await setTimeframe(tbPage, timeframe);
      appendLog(`  timeframe 切换:${switched ? '成功' : '失败,回退默认 yesterday'}`);
      const { headers, rows } = await scrape(tbPage);
      const limited = rows.slice(0, limit);
      const objects = limited.map((r) => rowToObject(headers, r));
      const actualTf = switched ? timeframe : 'yesterday';
      insertSeeds(runId, 'Trend Buzz', actualTf, objects);
      trendBuzzCount = objects.length;
      totalInserted += objects.length;
      appendLog(`  ✓ Trend Buzz 入库 ${trendBuzzCount} 行`);

      // 2. Monthly Trends — 侧边栏发现 URL
      if (isAborted()) throw new Error('aborted');
      const monthlyUrl = await discoverMonthlyTrendsUrl(tbPage);
      if (monthlyUrl) {
        appendLog(`▶ Monthly Trends — ${monthlyUrl}`);
        const mtPage = await ctx.newPage();
        try {
          await mtPage.goto(monthlyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await mtPage.waitForSelector('table tbody tr', { timeout: 15_000 }).catch(() => {});
          const r2 = await scrape(mtPage);
          const lim2 = r2.rows.slice(0, limit);
          const objs2 = lim2.map((r) => rowToObject(r2.headers, r));
          insertSeeds(runId, 'Monthly Trends', '15-month', objs2);
          monthlyCount = objs2.length;
          totalInserted += objs2.length;
          appendLog(`  ✓ Monthly Trends 入库 ${monthlyCount} 行`);
        } finally {
          await mtPage.close().catch(() => {});
        }
      } else {
        appendLog(`  ⚠ 侧边栏未发现 Monthly Trends 链接`, 'warn');
      }
    } finally {
      await tbPage.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
    appendLog(`▶ disconnect CDP · AdsPower 窗口保留`);
  }

  return { trendBuzzCount, monthlyCount, totalInserted };
}
