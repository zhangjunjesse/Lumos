// Etsy 商品详情图爬取（第二步）—— 选中商品 url → 详情页 → 抓所有详情图 URL。
// 同 product-collector 范式：startAdsPowerForContext + Playwright connectOverCDP。
// 只抓图 URL（默认不下载，省磁盘）；调用方决定是否 persist 到本地。
// Etsy 详情页图在 carousel；DOM 变动时需对真实详情页调选择器。

import { chromium } from 'playwright';
import { startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';

export interface DetailImage {
  imageUrl: string;
  position: number;
  isMain: boolean;
}

export interface CollectDetailResult {
  listingId: string;
  url: string;
  images: DetailImage[];
  ok: boolean;
  failureReason?: string;
}

export interface CollectDetailOptions {
  productUrl: string;
  listingId: string;
  browserContextId?: string;
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
  };

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    const handle = await startAdsPowerForContext(opts.browserContextId);
    browser = await chromium.connectOverCDP(handle.wsEndpoint);
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
      return { ...base, images, ok: true };
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

/** 在页面内抓详情 carousel 的所有图 URL，去重、优先取高清（data-src-zoom-image）。 */
function scrapeDetailImages(page: import('playwright').Page): Promise<string[]> {
  return page.evaluate(() => {
    const urls = new Set<string>();
    const candidates = Array.from(
      document.querySelectorAll(
        '.listing-page-image-carousel-component img, [data-carousel-pane] img, ul.carousel-pane-list img, img[src*="/il/"]',
      ),
    ) as HTMLImageElement[];

    for (const img of candidates) {
      const hi =
        img.getAttribute('data-src-zoom-image') ||
        img.getAttribute('data-src-delay') ||
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        '';
      if (!hi || !/\/il\//.test(hi)) continue;
      // 归一化：去查询串
      const clean = hi.split('?')[0];
      urls.add(clean);
    }
    return Array.from(urls);
  });
}
