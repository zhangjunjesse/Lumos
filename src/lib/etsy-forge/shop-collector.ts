// 单店铺采集(浏览器层):开店铺主页 → scrapeShopPage + 整店首页截图 + 本地化 banner/代表图。
// 同 detail-collector 范式(AdsPower CDP)。永远返回结构化结果,失败原因在 failureReason 可见,不抛。

import { type Browser } from 'playwright';
import { connectBrowserOverCDP, startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';
import { downloadImageToLocal, saveImageBufferToLocal } from './image-fetch';
import { scrapeShopPage, type ShopPageData } from './shop-collector-page';

export interface ShopCollectResult {
  ok: boolean;
  data?: ShopPageData;
  bannerPath?: string;
  repListingPaths?: string[];
  screenshotPath?: string; // 整店首页截图(装修存档)
  failureReason?: string;
}

export interface ShopCollectOptions {
  shopUrl: string;
  browserContextId?: string;
  appendLog?: (m: string) => void;
}

export async function collectShop(opts: ShopCollectOptions): Promise<ShopCollectResult> {
  const log = opts.appendLog ?? (() => {});
  let browser: Browser | null = null;
  try {
    const handle = await startAdsPowerForContext(opts.browserContextId);
    browser = await connectBrowserOverCDP(handle);
    const ctx = browser.contexts()[0];
    if (!ctx) return { ok: false, failureReason: 'AdsPower / CDP 无可用 context' };

    const page = await ctx.newPage();
    try {
      log(`▶ 打开店铺页：${opts.shopUrl}`);
      await page.goto(opts.shopUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });
      if (/\/signin|\/login/i.test(page.url())) {
        return { ok: false, failureReason: '被重定向到登录页，请先登录 Etsy。' };
      }
      await page.waitForSelector('a[href*="/listing/"], [data-shop-name], h1', { timeout: 15_000 }).catch(() => {});
      // 滚到中部触发 banner/listing 懒加载,再截全页。
      await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight / 2))).catch(() => {});
      await page.waitForTimeout(800);

      const data = await scrapeShopPage(page);
      log(`▶ 店铺：${data.shopName ?? '(无名)'} · 销量 ${data.totalSales ?? '?'} · EHunt ${data.ehuntRaw ? '有' : '未接入'}`);

      const screenshotPath = await page
        .screenshot({ fullPage: true })
        .then((buf) => saveImageBufferToLocal(buf, '.png'))
        .catch(() => undefined);
      const bannerPath = data.bannerUrl ? await downloadImageToLocal(data.bannerUrl).catch(() => undefined) : undefined;
      const repListingPaths = (
        await Promise.all(data.repListingUrls.map((u) => downloadImageToLocal(u).catch(() => undefined)))
      ).filter((p): p is string => !!p);

      return { ok: true, data, bannerPath, repListingPaths, screenshotPath };
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err) {
    return { ok: false, failureReason: `店铺采集失败：${err instanceof Error ? err.message : String(err)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    log('▶ disconnect CDP · 浏览器窗口保留');
  }
}
