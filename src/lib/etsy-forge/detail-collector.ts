// Etsy 商品详情图爬取（第二步）—— 选中商品 url → 详情页 → 抓所有详情图 URL。
// 同 product-collector 范式：startAdsPowerForContext + Playwright connectOverCDP。
// 只抓图 URL（默认不下载，省磁盘）；调用方决定是否 persist 到本地。
// Etsy 详情页图在 carousel；DOM 变动时需对真实详情页调选择器。

import { type Browser } from 'playwright';
import { connectBrowserOverCDP, startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';
import { scrapeReviewsFromPage, type CollectedReview } from './review-collector';

export interface DetailImage {
  imageUrl: string;
  position: number;
  isMain: boolean;
}

export interface CollectDetailResult {
  listingId: string;
  url: string;
  images: DetailImage[];
  reviews: CollectedReview[];
  shopName?: string; // listing 页抓到的店铺名(供「采集店铺」步)
  shopUrl?: string; // 店铺主页 URL
  ok: boolean;
  failureReason?: string;
}

export interface CollectDetailOptions {
  productUrl: string;
  listingId: string;
  browserContextId?: string;
  maxReviews?: number; // 抓评论上限（0=不抓）
  isAborted?: () => boolean;
  appendLog?: (msg: string) => void;
}

/**
 * 单个商品详情图采集。开页 → 抓 carousel 全部图 → 关页。
 * 永远返回结构化结果；失败原因在 failureReason 可见，不抛（除 abort）。
 */
export async function collectProductDetailImages(
  opts: CollectDetailOptions,
): Promise<CollectDetailResult> {
  const log = opts.appendLog ?? (() => {});
  const base: Omit<CollectDetailResult, 'images' | 'ok'> = {
    listingId: opts.listingId,
    url: opts.productUrl,
    reviews: [],
  };
  const maxReviews = Math.max(0, Math.floor(opts.maxReviews ?? 0));

  let browser: Browser | null = null;
  try {
    const handle = await startAdsPowerForContext(opts.browserContextId);
    browser = await connectBrowserOverCDP(handle);
    const ctx = browser.contexts()[0];
    if (!ctx) return { ...base, images: [], ok: false, failureReason: 'AdsPower / CDP 无可用 context' };

    const page = await ctx.newPage();
    try {
      log(`▶ 打开详情页：${opts.productUrl}`);
      await page.goto(opts.productUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });

      if (/\/signin|\/login/i.test(page.url())) {
        return { ...base, images: [], ok: false, failureReason: '被重定向到登录页，请先登录 Etsy。' };
      }
      if (opts.isAborted?.()) throw new Error('aborted');

      await page
        .waitForSelector('img[src*="/il/"], [data-carousel-pane] img, .listing-page-image-carousel-component img', {
          timeout: 20_000,
        })
        .catch(() => {});

      const urls = await scrapeDetailImages(page);
      if (urls.length === 0) {
        return { ...base, images: [], ok: false, failureReason: '详情页未抓到任何图（懒加载未触发或 DOM 结构变动）。' };
      }

      const images: DetailImage[] = urls.map((u, i) => ({ imageUrl: u, position: i, isMain: i === 0 }));
      log(`▶ 抓到 ${images.length} 张详情图`);

      const shop = await scrapeShopRef(page); // 顺手抓店铺链接(失败不影响详情)
      if (shop) log(`▶ 店铺：${shop.shopName}`);

      let reviews: CollectedReview[] = [];
      if (maxReviews > 0 && !opts.isAborted?.()) {
        log(`▶ 抓评论（上限 ${maxReviews}）…`);
        reviews = await scrapeReviewsFromPage(page, maxReviews, log).catch(() => []);
        log(`▶ 抓到 ${reviews.length} 条评论`);
      }
      return { ...base, images, reviews, shopName: shop?.shopName, shopUrl: shop?.shopUrl, ok: true };
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'aborted') throw err;
    return { ...base, images: [], ok: false, failureReason: `详情采集失败：${err instanceof Error ? err.message : String(err)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    log('▶ disconnect CDP · 浏览器窗口保留');
  }
}

/** 从 listing 页抓店铺引用：取首个 /shop/<slug> 链接 → 店名 + 规范店铺主页 URL。抓不到返回 null。 */
function scrapeShopRef(page: import('playwright').Page): Promise<{ shopName: string; shopUrl: string } | null> {
  return page
    .evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/shop/"]')) as HTMLAnchorElement[];
      for (const a of links) {
        const m = a.href.match(/\/shop\/([^/?#]+)/);
        if (!m) continue;
        const slug = m[1];
        const name = (a.textContent || '').trim().replace(/\s+/g, ' ') || decodeURIComponent(slug);
        return { shopName: name.slice(0, 120), shopUrl: `https://www.etsy.com/shop/${slug}` };
      }
      return null;
    })
    .catch(() => null);
}

/**
 * 在页面内抓商品图 carousel 的详情图 URL，只要大图：
 * 1) 只在商品图 carousel 内找（避开"关联推荐/猜你喜欢/评论图"等页面其它 /il/ 图）；
 * 2) 按 Etsy 图片 id 去重——同一张图的缩略图/大图只是 size 不同，每张只留最大尺寸；
 * 3) 丢掉最大也只有缩略尺寸（<500px）的，多为变体小图标/混入的非详情图。
 */
function scrapeDetailImages(page: import('playwright').Page): Promise<string[]> {
  return page.evaluate(() => {
    const SCOPE_SEL = [
      '.listing-page-image-carousel-component',
      '[data-component="listing-page-image-carousel"]',
      '[data-carousel-pane]',
      'ul.carousel-pane-list',
    ].join(',');
    const scopes = Array.from(document.querySelectorAll(SCOPE_SEL));
    let imgs: HTMLImageElement[] = [];
    for (const root of scopes) imgs.push(...(Array.from(root.querySelectorAll('img')) as HTMLImageElement[]));
    // carousel 选择器没命中时退回全页 /il/ 图，靠下面的尺寸过滤兜底滤掉小图。
    if (imgs.length === 0) {
      imgs = Array.from(
        document.querySelectorAll('img[src*="/il/"], img[data-src*="/il/"]'),
      ) as HTMLImageElement[];
    }

    // Etsy 图 URL 形如 .../il_<size>.<imageId>_<hash>.jpg
    const widthOf = (u: string): number => {
      if (/il_fullxfull/i.test(u)) return 5000;
      const m = u.match(/il_(\d+)x/i);
      return m ? parseInt(m[1], 10) : 0;
    };
    const idOf = (u: string): string => {
      const m = u.match(/il_[^.]+\.(\d+)_/);
      return m ? m[1] : u;
    };

    const best = new Map<string, { url: string; w: number }>();
    for (const img of imgs) {
      const cand =
        img.getAttribute('data-src-zoom-image') ||
        img.getAttribute('data-src-delay') ||
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        '';
      if (!cand || !/\/il\//.test(cand)) continue;
      const clean = cand.split('?')[0];
      const w = widthOf(clean);
      const id = idOf(clean);
      const prev = best.get(id);
      if (!prev || w > prev.w) best.set(id, { url: clean, w });
    }

    const MIN_DETAIL_WIDTH = 500;
    return Array.from(best.values())
      .filter((b) => b.w >= MIN_DETAIL_WIDTH)
      .map((b) => b.url);
  });
}
