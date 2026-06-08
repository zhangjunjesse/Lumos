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
  // EHunt 若在店铺页注入,和搜索页一样是异步的:先等元素出现(没有就算了,标未接入)。
  await page
    .waitForFunction(() => document.querySelectorAll('.eh-mask-info-fetched-item').length > 0, { timeout: 8_000 })
    .catch(() => {});
  // EHunt 出现后还会逐个补字段(销量→收藏→周销→上架):轮询到文本稳定(连续 3 次不变)再读,确保四个字段填全。
  await page
    .evaluate(async () => {
      const read = () => (document.querySelector('.eh-mask-info-fetched-item')?.textContent || '').trim();
      let prev = '';
      let same = 0;
      for (let i = 0; i < 25 && same < 3; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const cur = read();
        same = cur && cur === prev ? same + 1 : 0;
        prev = cur;
      }
    })
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

    // 店铺 banner(招牌横幅,如那条 "XXX.COM" 彩虹长条):页面顶部 DOM 靠前、又宽又扁的大图。
    // 先试已知选择器,没有再按"宽高比≥2.2 且足够宽"的启发式在前 40 张图里找(banner 通常 ~4:1,商品图近方形会被排除)。
    let bannerUrl: string | null =
      (document.querySelector('.shop-banner img, [data-shop-banner] img, .shop-cover img, .banner img') as HTMLImageElement | null)?.src ||
      null;
    if (!bannerUrl) {
      for (const img of Array.from(document.querySelectorAll('img')).slice(0, 40)) {
        const r = img.getBoundingClientRect();
        const w = img.naturalWidth || r.width;
        const h = img.naturalHeight || r.height;
        if (w >= 600 && h > 0 && w / h >= 2.2) {
          bannerUrl = (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src || null;
          break;
        }
      }
    }

    // 店铺头部各字段按节点精确匹配(Etsy 把 "4.9 (637) · 2.9k sales · 5 years on Etsy" 拆成各自独立小节点)。
    // 在小节点(≤40 字)里找,排除 listing 卡内,避免抓到评论区/商品标题/页脚的垃圾。各项取首个命中。
    let reviewRating: string | null = null;
    let reviewCount: string | null = null;
    let sinceYear: string | null = null;
    let location: string | null = null;

    // 评分/评价数优先从 JSON-LD 结构化数据取(Etsy 为 SEO 内嵌 aggregateRating,最可靠)。
    for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const items = JSON.parse(s.textContent || '');
        for (const o of Array.isArray(items) ? items : [items]) {
          const ar = o && typeof o === 'object' ? o.aggregateRating : null;
          if (!ar) continue;
          if (!reviewRating && ar.ratingValue != null) reviewRating = String(ar.ratingValue);
          const cnt = ar.reviewCount ?? ar.ratingCount;
          if (!reviewCount && cnt != null) reviewCount = String(cnt).replace(/[^\d]/g, '') || null;
        }
      } catch {
        /* 忽略坏 JSON */
      }
    }

    for (const el of Array.from(document.querySelectorAll('span,div,p,a'))) {
      if (el.closest('a[href*="/listing/"]')) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 40) continue;
      if (!reviewRating) {
        const m = t.match(/(\d(?:\.\d)?)\s*\(([\d,]+)\)/); // "4.9 (637)"
        if (m) {
          reviewRating = m[1];
          reviewCount = m[2].replace(/,/g, '');
          continue;
        }
      }
      if (!sinceYear) {
        const m = t.match(/(\d+)\s*years?\s+on Etsy/i); // "5 years on Etsy"
        if (m) {
          sinceYear = `${m[1]}年`;
          continue;
        }
      }
      if (!location && !/\d/.test(t) && /^[A-Z][A-Za-z.'\- ]+,\s*[A-Z][A-Za-z.'\- ]+$/.test(t)) {
        location = t; // "Estero, Florida"
        continue;
      }
    }

    // 总销量:优先精确 "2,886 sales",否则 "2.9k sales"。
    const salesExact = bodyText.match(/([\d,]{2,})\s*sales/i);
    const salesK = bodyText.match(/([\d.]+\s*[kKmM])\s*sales/i);
    const totalSales = salesExact ? salesExact[1].replace(/,/g, '') : salesK ? salesK[1].replace(/\s/g, '') : null;

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

    // EHunt 文本:取含数据(销量/收藏)且最长的那个注入元素,防字段分散在多个节点只读到一半。
    let ehBest = '';
    for (const el of Array.from(document.querySelectorAll('.eh-mask-info-fetched-item, [class*="eh-mask"], [class*="eh-shop"]'))) {
      const t = (el.textContent || '').trim();
      if (/sales|favorit|listed|销量|收藏|上架/i.test(t) && t.length > ehBest.length) ehBest = t;
    }
    const ehuntRaw = ehBest ? ehBest.slice(0, 600) : null;

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
