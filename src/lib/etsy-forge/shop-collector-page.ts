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
  // EHunt 若在店铺页注入,和搜索页一样是异步的:先等元素出现(没有就算了,标未接入),
  // 出现后 EHunt 还会逐个补字段(销量→收藏→周销→上架),再多等一下,避免读早了只读到前两个。
  await page
    .waitForFunction(() => document.querySelectorAll('.eh-mask-info-fetched-item').length > 0, { timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(2_500);

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

    // 店铺头部摘要行:取含 "sales" 且 "on Etsy" 的最小元素(避免在整页里抓到评论区 "5 stars"、页脚年份之类垃圾)。
    let header = '';
    for (const el of Array.from(document.querySelectorAll('header,section,div,span,p'))) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length <= 160 && /\bsales\b/i.test(t) && /on Etsy/i.test(t)) {
        header = t;
        break;
      }
    }
    const scope = header || bodyText;

    // 评分 + 评价数:Etsy 头部格式是 "4.9 (637)"。
    const rr = scope.match(/(\d(?:\.\d)?)\s*\(([\d,]+)\)/);
    const reviewRating = rr ? rr[1] : null;
    const reviewCount = rr ? rr[2].replace(/,/g, '') : null;

    // 总销量:优先精确 "2,886 sales",否则 "2.9k sales"。
    const salesExact = bodyText.match(/([\d,]{2,})\s*sales/i);
    const salesK = scope.match(/([\d.]+\s*[kKmM])\s*sales/i);
    const totalSales = salesExact ? salesExact[1].replace(/,/g, '') : salesK ? salesK[1].replace(/\s/g, '') : null;

    // 开店时长:"5 years on Etsy"。
    const yrM = scope.match(/(\d+)\s*years?\s*on Etsy/i);
    const sinceYear = yrM ? `${yrM[1]}年` : null;

    // 地点:正好是一个 "City, Region" 的小节点("Estero, Florida"),不含数字、不在 listing 卡内,避开日期/商品标题。
    let location: string | null = null;
    for (const el of Array.from(document.querySelectorAll('span,div,p,a'))) {
      if (el.closest('a[href*="/listing/"]')) continue;
      const t = (el.textContent || '').trim();
      if (t.length <= 40 && !/\d/.test(t) && /^[A-Z][A-Za-z.'\- ]+,\s*[A-Z][A-Za-z.'\- ]+$/.test(t)) {
        location = t;
        break;
      }
    }

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
