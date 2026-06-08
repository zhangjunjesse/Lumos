// Etsy 店铺主页「页内抓取」:店名/头像/banner/地点/总销量/评价/开店年份/公告 + 代表 listing 图 + EHunt 注入原文。
// 被 shop-collector.ts 调用。选择器针对 2026 Etsy 店铺页 DOM,多重兜底 + 文本正则(DOM 变动时优先靠文本)。
// EHunt 在店铺页是否注入未验证:试等 .eh-mask-info-fetched-item,抓不到 ehuntRaw=null(上层按「未接入」处理,不编)。

const REP_LISTING_CAP = 8;

export interface ShopPageData {
  shopName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  location: string | null;
  totalSales: string | null;
  reviewCount: string | null;
  reviewRating: string | null;
  sinceYear: string | null;
  announcement: string | null;
  repListingUrls: string[];
  ehuntRaw: string | null; // EHunt 在店铺页注入的原文;null=没注入=未接入
}

export async function scrapeShopPage(page: import('playwright').Page): Promise<ShopPageData> {
  // EHunt 若在店铺页注入,和搜索页一样是异步的:给一小段时间等(没有就算了,标未接入)。
  await page
    .waitForFunction(() => document.querySelectorAll('.eh-mask-info-fetched-item').length > 0, { timeout: 8_000 })
    .catch(() => {});

  return page.evaluate((cap: number): ShopPageData => {
    const txt = (el: Element | null) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const bodyText = document.body.innerText || '';

    const shopName =
      txt(document.querySelector('[data-shop-name], .shop-name h1, h1.shop-name, .shop-name-and-title-container h1')) ||
      txt(document.querySelector('header h1')) ||
      null;

    const avatarEl = document.querySelector(
      '.shop-icon img, img.shop-icon-external, [data-shop-icon] img, .shop-header img[src*="iusa"]',
    ) as HTMLImageElement | null;
    const avatarUrl = avatarEl?.src || null;

    // banner:封面 img,没有再试背景图。
    const bannerEl = document.querySelector(
      '.shop-banner img, [data-shop-banner] img, .shop-cover img, .banner img',
    ) as HTMLImageElement | null;
    let bannerUrl = bannerEl?.src || null;
    if (!bannerUrl) {
      const bg = document.querySelector('.shop-banner, [data-shop-banner], .shop-cover') as HTMLElement | null;
      const m = bg && getComputedStyle(bg).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      bannerUrl = m ? m[1] : null;
    }

    const salesM =
      bodyText.match(/([\d,]+)\s*(?:Sales|sales)/) || bodyText.match(/(?:销量|Sales)[:：\s]*([\d,]+)/);
    const totalSales = salesM ? salesM[1].replace(/,/g, '') : null;

    const revM = bodyText.match(/([\d,]+)\s*reviews?/i) || bodyText.match(/(?:评价|评论)[:：\s]*([\d,]+)/);
    const reviewCount = revM ? revM[1].replace(/,/g, '') : null;
    const rateM = bodyText.match(/([\d.]+)\s*(?:out of 5|\/\s*5|stars)/i);
    const reviewRating = rateM ? rateM[1] : null;

    const sinceM = bodyText.match(/(?:On Etsy since|since|开店于|自)\s*(\d{4})/i);
    const sinceYear = sinceM ? sinceM[1] : null;

    const locM = bodyText.match(/(?:Located in|Ships from|位于)\s*([A-Za-z .,'-]{2,60})/);
    const location = locM ? locM[1].trim() : null;

    const announcement =
      txt(
        document.querySelector(
          '.shop-announcement, [data-shop-announcement], .announcement, [data-appears-component-name*="announcement"]',
        ),
      ).slice(0, 1000) || null;

    const repListingUrls: string[] = [];
    const seen = new Set<string>();
    for (const img of Array.from(document.querySelectorAll('a[href*="/listing/"] img')) as HTMLImageElement[]) {
      const u = (img.src || img.getAttribute('data-src') || '').split('?')[0];
      if (!u || !/\/il\//.test(u) || seen.has(u)) continue;
      seen.add(u);
      repListingUrls.push(u);
      if (repListingUrls.length >= cap) break;
    }

    const eh = document.querySelector('.eh-mask-info-fetched-item');
    const ehuntRaw = eh ? (eh.textContent || '').trim().slice(0, 600) || null : null;

    return {
      shopName,
      avatarUrl,
      bannerUrl,
      location,
      totalSales,
      reviewCount,
      reviewRating,
      sinceYear,
      announcement,
      repListingUrls,
      ehuntRaw,
    };
  }, REP_LISTING_CAP);
}
