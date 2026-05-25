// ⑤ Etsy 抓取(listing + 市场切片)
//
// 每个 trending 词在 etsy.com/search?q= 抓:
//   - top N 个 listing(图、title、price、shop、href)→ pinterest_etsy_listings
//   - EHunt 注入字段(sales/sales_window/favorites/store_weekly_sales/listed_date)
//     EHunt 是浏览器扩展,装在 AdsPower 时会往 listing card 注入 .eh-mask-info-fetched-item
//     没装 → 字段全空,不假装
//   - 搜索结果总数(竞争 proxy)+ 价格中位/区间(基于 top N)→ pinterest_etsy_market
//
// parseEhunt 逻辑 inline,不跨 import etsy-erank(模块边界)。

import { chromium, type BrowserContext, type Page } from 'playwright';

import { startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';
import { getDb } from '../db/connection';

export interface FetchEtsyListingsOptions {
  runId: string;
  topPerTerm?: number;             // 每词抓多少 listing,默认 6
  browserContextId?: string;
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
  reportProgress?: (done: number, total: number) => void;
}

export interface FetchEtsyListingsResult {
  termCount: number;
  totalListings: number;
  failedTerms: number;
  ehuntHits: number;               // 有 EHunt 数据的 listing 数(用于在 UI 反馈是否装了)
}

interface ListingItem {
  listing_id: string;
  title: string;
  img_url: string;
  price: string;
  shop: string;
  href: string;
  // EHunt 字段;装了扩展时有,没装时全 null
  sales: number | null;
  sales_window: number | null;
  favorites: number | null;
  store_weekly_sales: number | null;
  listed_date: string;             // 'YYYY/MM/DD' 或 'YYYY-MM-DD' 或空
}

interface MarketSnapshot {
  totalResults: number | null;
  totalResultsText: string;
  priceMin: number | null;
  priceMedian: number | null;
  priceMax: number | null;
}

/** 抓单个 term:listing 数组 + 市场切片 */
async function scrapeOneTerm(
  page: Page,
  term: string,
  topN: number,
): Promise<{ listings: ListingItem[]; market: MarketSnapshot }> {
  const url = `https://www.etsy.com/search?q=${encodeURIComponent(term)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  try {
    await page.waitForSelector('[data-listing-id]', { timeout: 20_000 });
  } catch {
    return { listings: [], market: emptyMarket() };
  }

  // EHunt 异步注入:扩展在 listing card 渲染后扫描,**串行调后端 API** 取销量/收藏/上架。
  // 注入不一定优先前 6 个 listing(可能按可见性/滚动位置乱序),所以等 "≥ topN" 容易超时;
  // 也不能等"第一个出现就走"(后面 60+ card 还没注入完)。
  //
  // 正确策略:轮询等到 .eh-mask-info-fetched-item 数量**稳定不再增长**,或超时 35s。
  // 稳定定义:连续 2 次轮询(间隔 1.5s)数量没变化。
  try {
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __ehLastCount?: number; __ehStableTicks?: number };
        const cur = document.querySelectorAll('.eh-mask-info-fetched-item').length;
        if (cur === 0) return false;          // 还没开始注入,继续等
        if (w.__ehLastCount === cur) {
          w.__ehStableTicks = (w.__ehStableTicks ?? 0) + 1;
        } else {
          w.__ehLastCount = cur;
          w.__ehStableTicks = 0;
        }
        return (w.__ehStableTicks ?? 0) >= 2;  // 连续 2 次没变 = 稳定
      },
      { timeout: 35_000, polling: 1500 },
    );
  } catch {
    // 超时:EHunt 真没在工作(用户没装 / 扩展挂了 / 这种词无覆盖)— 接受空数据
  }

  return page.evaluate((TOP: number) => {
    // ============ 1. 市场切片 ============
    // 总结果数 — Etsy 多个版本可能落在不同选择器,试多个
    const totalText = (() => {
      const candidates = [
        '[data-search-results-count]',
        '.search-listings-group h1',
        '.wt-text-caption.search-listings-group',
        '[class*="searchResults"] h1',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el?.innerText) return el.innerText;
      }
      // 兜底:扫整页找 "X+ results" 模式
      const bodyText = document.body.innerText || '';
      const m = bodyText.match(/([\d,]+\+?)\s*(?:results|件结果|个结果|results found)/i);
      return m ? m[0] : '';
    })();
    const totalNumMatch = totalText.replace(/,/g, '').match(/(\d+)/);
    const totalResults = totalNumMatch ? parseInt(totalNumMatch[1], 10) : null;

    // ============ 2. listings ============
    function parseEhunt(card: Element): {
      sales: number | null; sales_window: number | null;
      favorites: number | null; store_weekly_sales: number | null; listed_date: string;
    } {
      const out = { sales: null as number | null, sales_window: null as number | null,
                    favorites: null as number | null, store_weekly_sales: null as number | null,
                    listed_date: '' };
      const items = card.querySelectorAll('.eh-mask-info-fetched-item');
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

    function parsePriceNumber(text: string): number | null {
      const m = text.match(/([\d,]+(?:\.\d+)?)/);
      if (!m) return null;
      const n = parseFloat(m[1].replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
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

    const listings = unique.map((card) => {
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

      const eh = parseEhunt(card);
      const priceText = ((priceEl as HTMLElement | null)?.innerText || '').split('\n')[0].trim().slice(0, 40);

      return {
        listing_id: card.dataset.listingId || '',
        title: ((titleEl as HTMLElement | null)?.innerText || '').trim().slice(0, 160),
        img_url,
        price: priceText,
        shop: ((shopEl as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        href: linkEl?.href || '',
        sales: eh.sales,
        sales_window: eh.sales_window,
        favorites: eh.favorites,
        store_weekly_sales: eh.store_weekly_sales,
        listed_date: eh.listed_date,
        _priceNum: parsePriceNumber(priceText),
      };
    });

    // ============ 3. 价格中位/区间(用 top N listings 的价格)============
    const prices = listings.map((l) => l._priceNum).filter((n): n is number => n != null).sort((a, b) => a - b);
    const market = {
      totalResults,
      totalResultsText: totalText.slice(0, 80),
      priceMin: prices.length > 0 ? prices[0] : null,
      priceMax: prices.length > 0 ? prices[prices.length - 1] : null,
      priceMedian: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null,
    };

    // 去掉 _priceNum 内部字段
    return {
      listings: listings.map(({ _priceNum, ...rest }) => rest),
      market,
    };

    function emptyMarket() { return { totalResults: null, totalResultsText: '', priceMin: null, priceMedian: null, priceMax: null }; }
  }, topN);
}

function emptyMarket(): MarketSnapshot {
  return { totalResults: null, totalResultsText: '', priceMin: null, priceMedian: null, priceMax: null };
}

export async function fetchEtsyListings(opts: FetchEtsyListingsOptions): Promise<FetchEtsyListingsResult> {
  const { runId, browserContextId, appendLog: log, isAborted, reportProgress } = opts;
  const topN = Math.max(3, Math.min(12, opts.topPerTerm ?? 6));

  const db = getDb();
  const terms = db.prepare(`
    SELECT DISTINCT t.term
      FROM pinterest_trending t
      LEFT JOIN pinterest_etsy_listings l ON l.run_id = t.run_id AND l.term = t.term
     WHERE t.run_id = ? AND l.term IS NULL
     ORDER BY t.rank ASC NULLS LAST, t.id ASC
  `).all(runId) as Array<{ term: string }>;
  const total = terms.length;
  if (total === 0) {
    log('  没有待抓的 term(都已抓过)');
    return { termCount: 0, totalListings: 0, failedTerms: 0, ehuntHits: 0 };
  }
  log(`  待抓 ${total} 个 term · 每词 ${topN} 个 listing(同时抓 EHunt 销量 + 市场切片)`);

  log(`▶ 启动浏览器抓 Etsy search`);
  const handle = await startAdsPowerForContext(browserContextId);
  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0] as BrowserContext | undefined;
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower 无 context');
  }

  const page = await ctx.newPage();
  let totalListings = 0;
  let failedTerms = 0;
  let ehuntHits = 0;
  let done = 0;

  const insertListing = db.prepare(`
    INSERT INTO pinterest_etsy_listings
      (run_id, term, rank, listing_id, title, img_url, price, shop, href,
       sales, sales_window, favorites, store_weekly_sales, listed_date, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertMarket = db.prepare(`
    INSERT INTO pinterest_etsy_market
      (run_id, term, total_results, total_results_text, price_min, price_median, price_max, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, term) DO UPDATE SET
      total_results=excluded.total_results,
      total_results_text=excluded.total_results_text,
      price_min=excluded.price_min,
      price_median=excluded.price_median,
      price_max=excluded.price_max,
      fetched_at=excluded.fetched_at
  `);
  const insertMany = db.transaction((term: string, items: ListingItem[], market: MarketSnapshot) => {
    const now = Date.now();
    items.forEach((it, i) => {
      insertListing.run(
        runId, term, i + 1, it.listing_id, it.title, it.img_url, it.price, it.shop, it.href,
        it.sales, it.sales_window, it.favorites, it.store_weekly_sales, it.listed_date,
        now,
      );
    });
    upsertMarket.run(
      runId, term, market.totalResults, market.totalResultsText,
      market.priceMin, market.priceMedian, market.priceMax, now,
    );
  });

  try {
    for (const { term } of terms) {
      if (isAborted()) throw new Error('aborted');
      try {
        const { listings, market } = await scrapeOneTerm(page, term, topN);
        if (listings.length === 0) {
          log(`  ⚠ ${term}: 无 listing`, 'warn');
          failedTerms++;
        } else {
          insertMany(term, listings, market);
          totalListings += listings.length;
          const termEhunt = listings.filter((l) => l.sales != null || l.favorites != null).length;
          ehuntHits += termEhunt;
          if (done === 0 && termEhunt === 0) {
            // 不要轻易说"用户没装 EHunt" — EHunt 是异步注入,首词可能也没等够;
            // 也可能这种词 EHunt 后端没覆盖。继续跑,看汇总命中率。
            log(`  ⚠ 首词 EHunt 0 命中 — 继续观察其他词的覆盖率`, 'warn');
          }
        }
      } catch (e) {
        log(`  ✗ ${term}: ${e instanceof Error ? e.message : String(e)}`, 'error');
        failedTerms++;
      }
      done++;
      reportProgress?.(done, total);
      if (done % 3 === 0) log(`  进度 ${done}/${total} · 累计 ${totalListings} listing · EHunt 命中 ${ehuntHits} · 失败 ${failedTerms}`);
      await page.waitForTimeout(1200);
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return { termCount: total, totalListings, failedTerms, ehuntHits };
}
