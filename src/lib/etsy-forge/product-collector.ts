// Etsy 商品列表爬取（第一步）—— 关键词 → Etsy 搜索页 → 商品卡（主图/url/价格）+ EHunt 注入指标。
// 复用 etsy-erank 验证过的范式：startAdsPowerForContext + Playwright connectOverCDP 直接操作页面。
// EHunt 指标依赖 AdsPower profile + 已装 EHunt 扩展；抓不到时如实标 no_ehunt，不 mock。
//
// 选择器针对 2026 Etsy 搜索页 DOM + EHunt 注入元素（.eh-mask-info-fetched-item）。
// Etsy/EHunt DOM 变动时需对着真实页面调选择器——爬虫本质如此。

import { chromium } from 'playwright';
import { startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';

export type ProductEhuntStatus = 'ok' | 'no_ehunt' | 'not_adspower' | 'failed';

export interface CollectedEhunt {
  salesTotal: number | null;
  salesRecent: number | null;
  favorites: number | null;
  listedDate: string | null;
  raw: string;
}

export interface CollectedProduct {
  listingId: string;
  title: string;
  url: string;
  mainImageUrl: string;
  price: string | null;
  ehunt: CollectedEhunt | null;
}

export interface CollectListResult {
  products: CollectedProduct[];
  ehuntStatus: ProductEhuntStatus;
  ehuntHitCount: number;
  searchUrl: string;
  warning?: string;
}

export interface CollectListOptions {
  keyword: string;
  maxProducts: number;
  browserContextId?: string;
  isAborted?: () => boolean;
  appendLog?: (msg: string) => void;
}

export function buildEtsySearchUrl(keyword: string): string {
  return `https://www.etsy.com/search?q=${encodeURIComponent(keyword.trim())}`;
}

export async function collectEtsyListings(opts: CollectListOptions): Promise<CollectListResult> {
  const { keyword, maxProducts } = opts;
  const log = opts.appendLog ?? (() => {});
  const searchUrl = buildEtsySearchUrl(keyword);
  const isAdsPower = (opts.browserContextId ?? '').startsWith('adspower:');

  log(`▶ 启动浏览器上下文 ${opts.browserContextId ?? 'embedded:default'}`);
  const handle = await startAdsPowerForContext(opts.browserContextId);
  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower / CDP 无可用 context');
  }

  const page = await ctx.newPage();
  try {
    log(`▶ 打开 Etsy 搜索：${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });

    if (/\/signin|\/login/i.test(page.url())) {
      return emptyResult(searchUrl, 'failed', '被重定向到 Etsy 登录页，请先在该浏览器上下文登录 Etsy。');
    }

    // 等商品卡出现（Etsy 列表项带 data-listing-id）
    await page
      .waitForSelector('[data-listing-id], a[href*="/listing/"]', { timeout: 20_000 })
      .catch(() => {});

    // EHunt 是异步逐卡注入的（见 project_ehunt_async_injection）：
    // 等到出现 N 个 .eh-mask-info-fetched-item，或 20s 超时——超时不致命，按 no_ehunt 处理。
    let ehuntInjected = false;
    if (isAdsPower) {
      log('▶ 等待 EHunt 注入指标（最多 20s）…');
      ehuntInjected = await page
        .waitForFunction(
          () => document.querySelectorAll('.eh-mask-info-fetched-item').length >= 3,
          { timeout: 20_000 },
        )
        .then(() => true)
        .catch(() => false);
    }

    if (opts.isAborted?.()) throw new Error('aborted');

    const products = await scrapeProductCards(page, maxProducts);
    const ehuntHitCount = products.filter((p) => p.ehunt !== null).length;

    let ehuntStatus: ProductEhuntStatus;
    if (!isAdsPower) ehuntStatus = 'not_adspower';
    else if (ehuntHitCount > 0) ehuntStatus = 'ok';
    else ehuntStatus = 'no_ehunt';

    log(`▶ 抓到 ${products.length} 个商品，EHunt 命中 ${ehuntHitCount}（${ehuntStatus}）`);

    return {
      products,
      ehuntStatus,
      ehuntHitCount,
      searchUrl,
      warning:
        ehuntStatus === 'not_adspower'
          ? '当前不是 AdsPower 上下文，只能拿主图，没有 EHunt 指标。去设置→采集浏览器选 AdsPower。'
          : ehuntStatus === 'no_ehunt'
            ? (ehuntInjected
                ? '页面有 EHunt 注入痕迹但未抽到指标，可能 EHunt 还在加载或 DOM 结构变动。'
                : '未检测到 EHunt 注入（确认 AdsPower profile 已装 EHunt 扩展且登录 Etsy）。')
            : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'aborted') throw err;
    return emptyResult(searchUrl, 'failed', `采集失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    log('▶ disconnect CDP · 浏览器窗口保留');
  }
}

/**
 * 在页面内抓每个商品卡：listingId / title / url / 主图 / 价格 + EHunt 注入文本。
 * 全部在浏览器上下文里跑（page.evaluate），返回纯数据。
 */
function scrapeProductCards(
  page: import('playwright').Page,
  maxProducts: number,
): Promise<CollectedProduct[]> {
  return page.evaluate((max: number) => {
    function parseEhunt(text: string): {
      salesTotal: number | null;
      salesRecent: number | null;
      favorites: number | null;
      listedDate: string | null;
      raw: string;
    } | null {
      if (!text || !/sales|favorit|listed/i.test(text)) return null;
      // "Sales: 708(42)" → total 708, recent 42
      const sales = text.match(/sales[:\s]*([\d,]+)\s*(?:\((\d+)\))?/i);
      // "4.0K" → 4000
      const favText = text.match(/favorit[a-z]*[:\s]*([\d.]+\s*[kKmM]?)/i);
      const parseNum = (s: string | undefined): number | null => {
        if (!s) return null;
        const m = s.trim().match(/^([\d.,]+)\s*([kKmM]?)$/);
        if (!m) return null;
        let n = parseFloat(m[1].replace(/,/g, ''));
        if (/k/i.test(m[2])) n *= 1000;
        if (/m/i.test(m[2])) n *= 1_000_000;
        return Math.round(n);
      };
      const listed = text.match(/listed[:\s]*([\d/.\-]+)/i);
      return {
        salesTotal: sales ? parseNum(sales[1]) : null,
        salesRecent: sales && sales[2] ? parseInt(sales[2], 10) : null,
        favorites: favText ? parseNum(favText[1]) : null,
        listedDate: listed ? listed[1] : null,
        raw: text.slice(0, 300),
      };
    }

    const cards = Array.from(
      document.querySelectorAll('[data-listing-id], li.wt-list-unstyled, .v2-listing-card'),
    ).slice(0, max * 2);

    const seen = new Set<string>();
    const out: CollectedProduct[] = [];

    for (const card of cards) {
      if (out.length >= max) break;
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

      const priceEl = card.querySelector(
        '.currency-value, .wt-text-title-small, [data-buy-box-region] .currency-value',
      ) as HTMLElement | null;
      const price = priceEl ? (priceEl.textContent || '').trim().slice(0, 40) : null;

      const ehMask = card.querySelector('.eh-mask-info-fetched-item') as HTMLElement | null;
      const ehunt = ehMask ? parseEhunt(ehMask.textContent || '') : null;

      out.push({
        listingId,
        title,
        url: href.split('?')[0],
        mainImageUrl,
        price,
        ehunt,
      });
    }
    return out;
  }, maxProducts) as Promise<CollectedProduct[]>;
}

function emptyResult(
  searchUrl: string,
  status: ProductEhuntStatus,
  warning: string,
): CollectListResult {
  return { products: [], ehuntStatus: status, ehuntHitCount: 0, searchUrl, warning };
}
