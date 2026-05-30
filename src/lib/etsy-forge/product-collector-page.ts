// Etsy 搜索结果「单页」抓取：打开一页 → 滚动加载全部卡 → 等 EHunt 注入 → 抓商品卡。
// 被 product-collector.ts 的翻页编排调用。选择器针对 2026 Etsy 搜索页 DOM + EHunt 注入元素。

import type { CollectedProduct } from './product-collector';

// 每页商品卡抓取上限（Etsy 一页约 48，留余量）。
const PER_PAGE_CARD_CAP = 80;

export interface OnePageResult {
  products: CollectedProduct[];
  ehuntInjected: boolean;
  loginRedirect: boolean;
}

export async function crawlOnePage(
  page: import('playwright').Page,
  url: string,
  isAdsPower: boolean,
  log: (m: string) => void,
): Promise<OnePageResult> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  if (/\/signin|\/login/i.test(page.url())) {
    return { products: [], ehuntInjected: false, loginRedirect: true };
  }

  await page
    .waitForSelector('[data-listing-id], a[href*="/listing/"]', { timeout: 20_000 })
    .catch(() => {});

  // 滚动到底触发懒加载，把整页商品卡都加载出来再抓——否则只拿到首屏一部分，会漏货。
  await autoScrollToBottom(page);

  // EHunt 是异步逐卡注入的（见 project_ehunt_async_injection）：等到 ≥3 个注入元素或 20s 超时。
  let ehuntInjected = false;
  if (isAdsPower) {
    log('  等待 EHunt 注入指标（最多 20s）…');
    ehuntInjected = await page
      .waitForFunction(() => document.querySelectorAll('.eh-mask-info-fetched-item').length >= 3, {
        timeout: 20_000,
      })
      .then(() => true)
      .catch(() => false);
  }

  const products = await scrapeProductCards(page);
  return { products, ehuntInjected, loginRedirect: false };
}

/** 在页内分步滚动到底，触发 Etsy 搜索结果的懒加载，把整页商品卡都加载进 DOM；高度不再增长即停。 */
async function autoScrollToBottom(page: import('playwright').Page): Promise<void> {
  await page
    .evaluate(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let lastH = 0;
      for (let i = 0; i < 15; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(350);
        const h = document.body.scrollHeight;
        if (h === lastH) break; // 高度不再增长 = 这页加载完了
        lastH = h;
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

/** 在页面内抓当前页所有商品卡：listingId / title / url / 主图 / 价格 / 评分 + EHunt 注入文本。 */
function scrapeProductCards(page: import('playwright').Page): Promise<CollectedProduct[]> {
  return page.evaluate((cap: number) => {
    function parseEhunt(text: string): {
      salesTotal: number | null;
      salesRecent: number | null;
      favorites: number | null;
      listedDate: string | null;
      raw: string;
    } | null {
      // EHunt 扩展可能输出英文或中文，正则需中英兼容（中文用全角/半角冒号）：
      //   英文: "Sales: 1,234 (56)  Favorites: 3.4k  Listed: 2023/01/02"
      //   中文: "总销量: 1234(56)  收藏量: 341  上架: 2023/01/02"
      if (!text || !/sales|favorit|listed|销量|收藏|上架/i.test(text)) return null;
      const sales = text.match(/(?:total sales|sales|总销量|销量)[:：\s]*([\d,]+)\s*(?:\(([\d,]+)\))?/i);
      const favText = text.match(/(?:favorit[a-z]*|收藏量|收藏)[:：\s]*([\d.,]+\s*[kKmM]?)/i);
      const parseNum = (s: string | undefined): number | null => {
        if (!s) return null;
        const m = s.trim().match(/^([\d.,]+)\s*([kKmM]?)$/);
        if (!m) return null;
        let n = parseFloat(m[1].replace(/,/g, ''));
        if (/k/i.test(m[2])) n *= 1000;
        if (/m/i.test(m[2])) n *= 1_000_000;
        return Math.round(n);
      };
      const listed = text.match(/(?:listed|上架(?:日期|时间)?)[:：\s]*([\d/.\-]+)/i);
      return {
        salesTotal: sales ? parseNum(sales[1]) : null,
        salesRecent: sales && sales[2] ? parseNum(sales[2]) : null,
        favorites: favText ? parseNum(favText[1]) : null,
        listedDate: listed ? listed[1] : null,
        raw: text.slice(0, 300),
      };
    }

    const cards = Array.from(
      document.querySelectorAll('[data-listing-id], li.wt-list-unstyled, .v2-listing-card'),
    ).slice(0, cap);

    const seen = new Set<string>();
    const out: CollectedProduct[] = [];

    for (const card of cards) {
      const link = card.matches('a[href*="/listing/"]')
        ? (card as HTMLAnchorElement)
        : (card.querySelector('a[href*="/listing/"]') as HTMLAnchorElement | null);
      const href = link?.href ?? '';
      const idMatch = href.match(/\/listing\/(\d+)/);
      if (!idMatch) continue;
      const listingId = idMatch[1];
      if (seen.has(listingId)) continue;
      seen.add(listingId);

      const img = card.querySelector('img') as HTMLImageElement | null;
      const mainImageUrl =
        img?.getAttribute('src') ||
        img?.getAttribute('data-src') ||
        img?.getAttribute('srcset')?.split(' ')[0] ||
        '';

      const titleEl = card.querySelector('h3, h2, [data-listing-card-title]') as HTMLElement | null;
      const title = (titleEl?.textContent || img?.getAttribute('alt') || '').trim().slice(0, 280);

      // 价格：取 .currency-value（纯数值）并补上 .currency-symbol（$ 等），范围价取首个=低价。
      // 注意只认 .currency-value（价格专属类），不要用 .wt-text-title-small 之类通用排版类——
      // 那会把"评分数字"（4.9/5.0）当成价格。评分另外单独抓。
      const valEl = card.querySelector(
        '.currency-value, [data-buy-box-region] .currency-value',
      ) as HTMLElement | null;
      const symEl = card.querySelector('.currency-symbol') as HTMLElement | null;
      const price = valEl
        ? ((symEl?.textContent || '').trim() + (valEl.textContent || '').trim()).slice(0, 40) || null
        : null;

      // 评分 + 评论数：从无障碍文本 "X out of 5 stars[. Y reviews]" 里取，和价格彻底分开。
      let rating: string | null = null;
      let reviews: string | null = null;
      const ratingEls = Array.from(
        card.querySelectorAll(
          '[aria-label*="out of 5"], [aria-label*="stars"], .wt-screen-reader-only, .screen-reader-only',
        ),
      );
      for (const el of ratingEls) {
        const t = (el.getAttribute('aria-label') || el.textContent || '').trim();
        const rm = t.match(/([\d.]+)\s*out of\s*5/i);
        if (rm) {
          rating = rm[1];
          const vm = t.match(/([\d,]+)\s*reviews?/i);
          if (vm) reviews = vm[1].replace(/,/g, '');
          break;
        }
      }
      if (rating === null) {
        const inp = card.querySelector('input[name="rating"]') as HTMLInputElement | null;
        const v = inp?.getAttribute('value') || '';
        if (/^[\d.]+$/.test(v)) rating = v;
      }

      const ehMask = card.querySelector('.eh-mask-info-fetched-item') as HTMLElement | null;
      const ehunt = ehMask ? parseEhunt(ehMask.textContent || '') : null;

      out.push({ listingId, title, url: href.split('?')[0], mainImageUrl, price, rating, reviews, ehunt });
    }
    return out;
  }, PER_PAGE_CARD_CAP) as Promise<CollectedProduct[]>;
}
