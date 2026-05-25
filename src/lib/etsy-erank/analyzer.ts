// ⑥ 商业分析 = EHunt 深度抓取 + 聚合 + LLM 一句话切入建议
// 对应 scripts/erank-ehunt-deep.mjs + erank-ehunt-aggregate.mjs

import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { startAdsPowerForContext } from './adspower';
import { loadScoreProvider } from './scorer';
import { getDb } from '../db/connection';
import { ANALYZER_SYSTEM_PROMPT } from './prompts';

const IMG_DIR = path.resolve('public/etsy-images');

interface ListingItem {
  listing_id: string;
  title: string;
  img_url: string;
  price: string;
  shop_text: string;
  shop_name: string;
  shop_rating: number | null;
  shop_review_count: number | null;
  href: string;
  ehunt: {
    sales: number | null;
    sales_window: number | null;
    favorites: number | null;
    store_weekly_sales: number | null;
    listed_date: string | null;
  };
}

async function scrapeListings(page: Page, topN: number): Promise<ListingItem[]> {
  await page.waitForSelector('[data-listing-id]', { timeout: 30_000 });
  try {
    await page.waitForSelector('.eh-mask-info-fetched-item', { timeout: 15_000 });
  } catch {
    /* EHunt 没注入 — 继续抓 Etsy 原生 */
  }
  await page.waitForTimeout(4000);

  return page.evaluate((TOP: number) => {
    function parseEhunt(card: Element) {
      const items = [...card.querySelectorAll('.eh-mask-info-fetched-item')];
      const out: { sales: number | null; sales_window: number | null; favorites: number | null; store_weekly_sales: number | null; listed_date: string | null } = {
        sales: null, sales_window: null, favorites: null, store_weekly_sales: null, listed_date: null,
      };
      for (const item of items) {
        const text = ((item as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
        const salesM = text.match(/Sales:\s*(\d+)(?:\((\d+)\))?/i);
        if (salesM) {
          out.sales = parseInt(salesM[1], 10);
          if (salesM[2] != null) out.sales_window = parseInt(salesM[2], 10);
        }
        const favM = text.match(/Favorites:\s*(\d+)/i);
        if (favM) out.favorites = parseInt(favM[1], 10);
        const wsM = text.match(/Store Weekly Sales:\s*(\d+)/i);
        if (wsM) out.store_weekly_sales = parseInt(wsM[1], 10);
        const listM = text.match(/Listed:\s*([\d/\-]+)/i);
        if (listM) out.listed_date = listM[1];
      }
      return out;
    }

    const cards = [...document.querySelectorAll('[data-listing-id]')] as HTMLElement[];
    const seen = new Set<string>();
    const unique: HTMLElement[] = [];
    for (const c of cards) {
      const id = c.dataset.listingId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(c);
      if (unique.length >= TOP) break;
    }

    return unique.map((card) => {
      const titleEl = card.querySelector('h3, h2, [data-listing-card-listing-title]');
      const imgEl = card.querySelector('img') as HTMLImageElement | null;
      const priceEl = card.querySelector('[class*="price"], [class*="currency"]');
      const shopEl = card.querySelector('.shop-name-with-rating, [class*="shop"]');
      const linkEl = card.querySelector('a[href*="/listing/"]') as HTMLAnchorElement | null;

      let img_url = imgEl?.src || '';
      const srcset = imgEl?.srcset || '';
      if (srcset) {
        const m = srcset.match(/(\S+)\s+1x/) || srcset.match(/(\S+)\s+2x/);
        if (m) img_url = m[1];
      }
      img_url = img_url.replace(/il_\w+xN/, 'il_300x300');

      const shopText = ((shopEl as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim();
      const ratingM = shopText.match(/^(\d\.\d)/);
      const revCountM = shopText.match(/\((\d[\d,]*)\)/);
      const shopNameM = shopText.match(/By\s+([^\n]+?)(?:\s+From|$)/);

      return {
        listing_id: card.dataset.listingId || '',
        title: ((titleEl as HTMLElement | null)?.innerText || '').trim().slice(0, 200),
        img_url,
        price: ((priceEl as HTMLElement | null)?.innerText || '').split('\n')[0].trim().slice(0, 40),
        shop_text: shopText.slice(0, 100),
        shop_name: shopNameM?.[1]?.trim() || '',
        shop_rating: ratingM ? parseFloat(ratingM[1]) : null,
        shop_review_count: revCountM ? parseInt(revCountM[1].replace(/,/g, ''), 10) : null,
        href: linkEl?.href || '',
        ehunt: parseEhunt(card),
      };
    });
  }, topN);
}

function downloadImage(url: string, listingId: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!url || !listingId) return resolve(false);
    const dest = path.join(IMG_DIR, `${listingId}.jpg`);
    if (fs.existsSync(dest)) return resolve(true);
    fs.mkdirSync(IMG_DIR, { recursive: true });
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(false); }
        const f = fs.createWriteStream(dest);
        res.pipe(f);
        f.on('finish', () => f.close(() => resolve(true)));
        f.on('error', () => resolve(false));
      })
      .on('error', () => resolve(false));
  });
}

// ============ 聚合 ============

function cleanShopName(name: string): string {
  if (!name) return '';
  return name.replace(/\s+Ad\s+from\s+shop\s+.+$/i, '').replace(/\s+From\s+shop\s+.+$/i, '').trim();
}

function parsePrice(p: string): number | null {
  if (!p) return null;
  const m = p.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, ''));
}

function parseListedDate(d: string | null): Date | null {
  if (!d) return null;
  const m = d.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const year = 2000 + parseInt(m[3], 10);
  return new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'shop', 'sale', 'price', 'free', 'gift', 'new', 'ready', 'set',
  'pcs', 'pack', 'one', 'two', 'three', 'item', 'made', 'use', 'design', 'custom', 'best',
  'this', 'that', 'pro', 'top', 'all', 'add', 'usa', 'inc', 'llc',
]);

function ngramTitles(titles: string[]): Array<{ gram: string; count: number; pct: number }> {
  const tokenize = (s: string) => s
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const grams: Record<string, number> = {};
  for (const t of titles) {
    const toks = tokenize(t);
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const g = toks.slice(i, i + n).join(' ');
        grams[g] = (grams[g] || 0) + 1;
      }
    }
  }
  const total = titles.length;
  return Object.entries(grams)
    .map(([gram, count]) => ({ gram, count, pct: count / total }))
    .filter((x) => x.pct >= 0.3 && x.gram.length >= 4)
    .sort((a, b) => b.count - a.count)
    .slice(0, 13);
}

interface Aggregate {
  keyword: string;
  listingCount: number;
  ehuntCoverage: number;
  sales: { max: number | null; median: number | null; p75: number | null; total: number; top10: number[] };
  favorites: { max: number; median: number | null; total: number };
  storeWeeklySales: { median: number | null; max: number };
  price: { min: number; max: number; median: number | null; p25: number | null; p75: number | null };
  newStores: { within30: number; within90: number; within30WithSales: number; ageDistribution: number[] };
  topShops: Array<{ name: string; listings: number; sales: number; favs: number }>;
  top5SalesPct: number;
  topNgrams: Array<{ gram: string; count: number; pct: number }>;
  llmInsight?: string;
}

function aggregate(keyword: string, listings: ListingItem[]): Aggregate {
  const today = new Date();
  const ehunt = listings.filter((l) => l.ehunt.sales != null);
  const sales = ehunt.map((l) => l.ehunt.sales as number).filter((x) => x != null);
  const favs = ehunt.map((l) => l.ehunt.favorites).filter((x): x is number => x != null);
  const weeklySales = ehunt.map((l) => l.ehunt.store_weekly_sales).filter((x): x is number => x != null);
  const prices = listings.map((l) => parsePrice(l.price)).filter((x): x is number => x != null);

  const listedAges = ehunt
    .map((l) => parseListedDate(l.ehunt.listed_date))
    .filter((d): d is Date => d != null)
    .map((d) => Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
  const newWithin30 = listedAges.filter((a) => a <= 30).length;
  const newWithin90 = listedAges.filter((a) => a <= 90).length;
  const newWithin30WithSales = ehunt.filter((l) => {
    const d = parseListedDate(l.ehunt.listed_date);
    if (!d) return false;
    const age = (today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    return age <= 30 && (l.ehunt.sales ?? 0) > 0;
  }).length;

  const shopCounts: Record<string, { name: string; listings: number; sales: number; favs: number }> = {};
  for (const l of listings) {
    const name = cleanShopName(l.shop_name);
    if (!name) continue;
    if (!shopCounts[name]) shopCounts[name] = { name, listings: 0, sales: 0, favs: 0 };
    shopCounts[name].listings++;
    shopCounts[name].sales += l.ehunt.sales || 0;
    shopCounts[name].favs += l.ehunt.favorites || 0;
  }
  const topShops = Object.values(shopCounts).sort((a, b) => b.sales - a.sales || b.listings - a.listings).slice(0, 5);
  const totalSales = sales.reduce((s, x) => s + x, 0);
  const top5SalesPct = totalSales > 0
    ? topShops.slice(0, 5).reduce((s, x) => s + x.sales, 0) / Math.max(1, totalSales)
    : 0;

  const titles = listings.map((l) => l.title).filter(Boolean);
  const topNgrams = ngramTitles(titles);

  return {
    keyword,
    listingCount: listings.length,
    ehuntCoverage: ehunt.length,
    sales: {
      max: sales.length > 0 ? Math.max(...sales) : null,
      median: median(sales),
      p75: percentile(sales, 0.75),
      total: totalSales,
      top10: [...sales].sort((a, b) => b - a).slice(0, 10),
    },
    favorites: {
      max: favs.length > 0 ? Math.max(...favs) : 0,
      median: median(favs),
      total: favs.reduce((s, x) => s + x, 0),
    },
    storeWeeklySales: {
      median: median(weeklySales),
      max: weeklySales.length > 0 ? Math.max(...weeklySales) : 0,
    },
    price: {
      min: prices.length > 0 ? Math.min(...prices) : 0,
      max: prices.length > 0 ? Math.max(...prices) : 0,
      median: median(prices),
      p25: percentile(prices, 0.25),
      p75: percentile(prices, 0.75),
    },
    newStores: { within30: newWithin30, within90: newWithin90, within30WithSales: newWithin30WithSales, ageDistribution: listedAges.sort((a, b) => a - b) },
    topShops,
    top5SalesPct,
    topNgrams,
  };
}

async function callLLMInsight(agg: Aggregate): Promise<string> {
  const provider = loadScoreProvider();
  const system = ANALYZER_SYSTEM_PROMPT;

  const user = `keyword = ${JSON.stringify(agg.keyword)}

数据:
- listing 数: ${agg.listingCount}, EHunt 覆盖: ${agg.ehuntCoverage}
- 销量: 最高 ${agg.sales.max}, 中位 ${agg.sales.median}, P75 ${agg.sales.p75}, top 10 合计 ${agg.sales.top10.reduce((s, x) => s + x, 0)}
- 收藏: 最高 ${agg.favorites.max}, 中位 ${agg.favorites.median}, 合计 ${agg.favorites.total}
- 价格: \$${agg.price.min}-${agg.price.max}, 中位 \$${agg.price.median}, P25-P75 \$${agg.price.p25}-\$${agg.price.p75}
- 新店(上架 ≤30 天): ${agg.newStores.within30} 个, 其中 ${agg.newStores.within30WithSales} 个已出单
- 头部 5 店占总销量: ${(agg.top5SalesPct * 100).toFixed(0)}%
- 头部店铺: ${agg.topShops.slice(0, 3).map((s) => `${s.name}(销 ${s.sales}/listing ${s.listings})`).join(', ')}
- 头部 SEO 词: ${agg.topNgrams.slice(0, 8).map((n) => n.gram).join(' / ')}

输出"切入建议"(1-2 句,纯文本):`;

  const res = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
}

function loadAGradeKeywords(runId: string, skipAlreadyAnalyzed = true): string[] {
  const db = getDb();
  const aRows = db.prepare(`SELECT keyword FROM radar_bulk WHERE run_id = ? AND grade = 'A' ORDER BY keyword`).all(runId) as Array<{ keyword: string }>;
  if (!skipAlreadyAnalyzed) return aRows.map((r) => r.keyword);

  // 续跑模式:排除已 ⑥ 跑过的 keyword,只跑剩下的
  const doneRows = db.prepare(`SELECT keyword FROM radar_ehunt WHERE run_id = ?`).all(runId) as Array<{ keyword: string }>;
  const done = new Set(doneRows.map((r) => r.keyword));
  return aRows.map((r) => r.keyword).filter((k) => !done.has(k));
}

function saveEhunt(runId: string, keyword: string, agg: Aggregate, listings: ListingItem[]): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO radar_ehunt (run_id, keyword, analysis_json, listings_json, ehunt_coverage, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, keyword) DO UPDATE SET
      analysis_json = excluded.analysis_json,
      listings_json = excluded.listings_json,
      ehunt_coverage = excluded.ehunt_coverage,
      analyzed_at = excluded.analyzed_at
  `).run(runId, keyword, JSON.stringify(agg), JSON.stringify(listings), agg.ehuntCoverage, Date.now());
}

export interface AnalyzeOptions {
  runId: string;
  topN?: number;        // 每词抓多少 listing(默认 24)
  browserContextId?: string;
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
  reportProgress?: (done: number, total: number) => void;
}

export interface AnalyzeResult {
  keywordCount: number;
  succeed: number;
  failed: number;
  imagesDownloaded: number;
}

export async function analyzeAllAGrade(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const { runId, appendLog, isAborted, reportProgress } = opts;
  const topN = opts.topN ?? 24;

  const allAGrade = loadAGradeKeywords(runId, false);
  const keywords = loadAGradeKeywords(runId, true);
  const skipped = allAGrade.length - keywords.length;
  if (allAGrade.length === 0) throw new Error('没有 A 级关键词 — 先跑 ④');
  if (keywords.length === 0) {
    appendLog(`✓ 全部 ${allAGrade.length} 个 A 级 keyword 都已 ⑥ 跑过,无需续跑`);
    return { keywordCount: allAGrade.length, succeed: 0, failed: 0, imagesDownloaded: 0 };
  }
  appendLog(`▶ A 级 keyword 共 ${allAGrade.length} 个 · 已跑 ${skipped} · 续跑剩余 ${keywords.length} 个`);

  appendLog(`▶ 启动 AdsPower`);
  const handle = await startAdsPowerForContext(opts.browserContextId);
  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower 无 context');
  }

  let succeed = 0;
  let failed = 0;
  let imagesOk = 0;

  try {
    for (let i = 0; i < keywords.length; i++) {
      if (isAborted()) throw new Error('aborted');
      const kw = keywords[i];
      appendLog(`[${i + 1}/${keywords.length}] ${kw}`);
      const page = await ctx.newPage();
      try {
        await page.goto(`https://www.etsy.com/search?q=${encodeURIComponent(kw)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const listings = await scrapeListings(page, topN);
        const ehuntCount = listings.filter((l) => l.ehunt.sales != null).length;

        // 下载图
        for (const l of listings) {
          const ok = await downloadImage(l.img_url, l.listing_id);
          if (ok) imagesOk++;
        }

        // 聚合
        const agg = aggregate(kw, listings);

        // LLM 一句话(失败不阻塞)
        try {
          agg.llmInsight = await callLLMInsight(agg);
        } catch (e) {
          agg.llmInsight = `LLM 失败: ${(e as Error).message.slice(0, 100)}`;
        }

        // 转成 UI 期望的 EhuntListing 形态(img 字段是本地路径,shop_name 清洗)
        const uiListings = listings.map((l) => ({
          listing_id: l.listing_id,
          title: l.title,
          img: `/etsy-images/${l.listing_id}.jpg`,
          price: l.price,
          shop_name: cleanShopName(l.shop_name),
          shop_rating: l.shop_rating,
          shop_review_count: l.shop_review_count,
          href: l.href,
          ehunt: l.ehunt,
        }));
        saveEhunt(runId, kw, agg, uiListings as unknown as ListingItem[]);
        succeed++;
        appendLog(`  ✓ ${listings.length} listings · EHunt 覆盖 ${ehuntCount}`);
      } catch (e) {
        failed++;
        appendLog(`  ✗ ${(e as Error).message.slice(0, 120)}`, 'warn');
      } finally {
        await page.close().catch(() => {});
      }
      reportProgress?.(i + 1, keywords.length);
    }
  } finally {
    await browser.close().catch(() => {});
    appendLog(`▶ disconnect CDP · AdsPower 窗口保留`);
  }

  return { keywordCount: keywords.length, succeed, failed, imagesDownloaded: imagesOk };
}
