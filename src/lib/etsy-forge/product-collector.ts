// Etsy 商品列表爬取（第一步）—— 关键词 → Etsy 搜索页（自动翻页）→ 商品卡（主图/url/价格）+ EHunt 注入指标。
// 复用 etsy-erank 验证过的范式：startAdsPowerForContext + Playwright connectOverCDP 直接操作页面。
// EHunt 指标依赖 AdsPower profile + 已装 EHunt 扩展；抓不到时如实标 no_ehunt，不 mock。
//
// 想爬多少由 maxProducts 决定：每页约 48 个，按需翻 ?page=N 直到攒够或没有更多页。
// 选择器针对 2026 Etsy 搜索页 DOM + EHunt 注入元素（.eh-mask-info-fetched-item）。

import { connectBrowserOverCDP, startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';
import { crawlOnePage } from './product-collector-page';

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
  rating: string | null;
  reviews: string | null;
  ehunt: CollectedEhunt | null;
}

export interface CollectListResult {
  products: CollectedProduct[];
  ehuntStatus: ProductEhuntStatus;
  ehuntHitCount: number;
  searchUrl: string;
  warning?: string;
  aborted?: boolean; // 用户中途点了「停止」：翻完手头这页就收手，已爬到的照常返回。
  // 诊断：翻了几页、累计抓到多少商品卡（去重前每页和），方便看有没有漏 / 翻页有没有推进。
  pagesExamined: number;
  rawSeen: number;
}

export interface CollectListOptions {
  keyword: string;
  maxProducts: number;
  // 历史已采过的 listing_id：翻页时跳过，只攒「没采过的新商品」直到凑够 maxProducts。
  excludeListingIds?: Set<string>;
  // 采集过滤门槛：销量/收藏不达标的不采（按 EHunt 指标，无指标按 0 计）。0 = 不过滤。
  minSales?: number;
  minFavorites?: number;
  // 价格区间过滤（按商品卡标价，不依赖 EHunt）。minPrice=0 不限下限；maxPrice<=0 不限上限。
  minPrice?: number;
  maxPrice?: number;
  // 最大翻页数（默认 40，硬上限 PAGE_LIMIT_CEILING）。控制往深里翻多少页。
  maxPages?: number;
  browserContextId?: string;
  isAborted?: () => boolean;
  appendLog?: (msg: string) => void;
}

// 翻页绝对上限：防一个关键词把浏览器跑到天荒地老（每页等 EHunt 最多 20s + 滚动加载）。
const PAGE_LIMIT_CEILING = 100;
const DEFAULT_MAX_PAGES = 40;

export function buildEtsySearchUrl(keyword: string, pageNum = 1): string {
  const base = `https://www.etsy.com/search?q=${encodeURIComponent(keyword.trim())}`;
  return pageNum > 1 ? `${base}&page=${pageNum}` : base;
}

export async function collectEtsyListings(opts: CollectListOptions): Promise<CollectListResult> {
  const { keyword, maxProducts } = opts;
  const log = opts.appendLog ?? (() => {});
  const firstUrl = buildEtsySearchUrl(keyword);
  const isAdsPower = (opts.browserContextId ?? '').startsWith('adspower:');

  log(`▶ 启动浏览器上下文 ${opts.browserContextId ?? 'embedded:default'}`);
  const handle = await startAdsPowerForContext(opts.browserContextId);
  const browser = await connectBrowserOverCDP(handle);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower / CDP 无可用 context');
  }

  const page = await ctx.newPage();
  const exclude = opts.excludeListingIds ?? new Set<string>();
  const minSales = Math.max(0, opts.minSales ?? 0);
  const minFavorites = Math.max(0, opts.minFavorites ?? 0);
  const minPrice = Math.max(0, opts.minPrice ?? 0);
  const maxPrice = (opts.maxPrice ?? 0) > 0 ? (opts.maxPrice as number) : Infinity;
  const ehuntFiltering = minSales > 0 || minFavorites > 0;
  const priceFiltering = minPrice > 0 || maxPrice < Infinity;
  const maxPages = Math.max(1, Math.min(PAGE_LIMIT_CEILING, Math.floor(opts.maxPages ?? DEFAULT_MAX_PAGES)));
  const collected: CollectedProduct[] = [];
  const seen = new Set<string>();
  let ehuntAnyInjected = false;
  let skippedKnown = 0;
  let skippedFilter = 0;
  let freshTotal = 0; // 累计「没采过的新 listing」数（不管过没过滤）
  let rawSeen = 0; // 累计抓到的商品卡数（每页去重后求和）
  let pagesExamined = 0;
  let noFreshStreak = 0;
  let aborted = false;

  try {
    // 一直翻页直到凑够 maxProducts，或翻到底（连续两页没带出任何没采过的新 listing）/ 到页数上限。
    // 关键：设了门槛时，「整页都被过滤掉」≠「到底了」——只要本页还带出没采过的新货就继续往后翻。
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (collected.length >= maxProducts) break;
      if (opts.isAborted?.()) {
        aborted = true; // 优雅停：跳出翻页循环，已爬到的照常入库
        break;
      }

      const url = buildEtsySearchUrl(keyword, pageNum);
      log(`▶ 打开 Etsy 搜索第 ${pageNum} 页：${url}`);
      const res = await crawlOnePage(page, url, isAdsPower, log);
      if (res.loginRedirect) {
        if (collected.length > 0) break; // 已有结果就用已采的，不当失败
        return emptyResult(firstUrl, 'failed', '被重定向到 Etsy 登录页，请先在该浏览器上下文登录 Etsy。', pagesExamined, rawSeen);
      }
      if (res.products.length === 0) break; // 这页一张卡都没有 = 到底了
      pagesExamined++;
      rawSeen += res.products.length;
      ehuntAnyInjected = ehuntAnyInjected || res.ehuntInjected;

      let newCount = 0;
      let freshThisPage = 0;
      for (const p of res.products) {
        if (seen.has(p.listingId)) continue; // 本次执行内去重（翻页没推进时这里挡住）
        if (exclude.has(p.listingId)) {
          skippedKnown++; // 历史已采过 → 跳过，继续找新的
          continue;
        }
        freshThisPage++; // 没采过的新 listing（不管过不过滤都算"翻页有推进"）
        if (ehuntFiltering && ((p.ehunt?.salesTotal ?? 0) < minSales || (p.ehunt?.favorites ?? 0) < minFavorites)) {
          skippedFilter++; // 销量/收藏不达标 → 跳过
          continue;
        }
        if (priceFiltering) {
          const pr = parsePriceNumber(p.price);
          if (pr === null || pr < minPrice || pr > maxPrice) {
            skippedFilter++; // 价格不在区间（或抓不到价格）→ 跳过
            continue;
          }
        }
        seen.add(p.listingId);
        collected.push(p);
        newCount++;
        if (collected.length >= maxProducts) break;
      }
      freshTotal += freshThisPage;
      log(
        `  第 ${pageNum} 页：本页卡 ${res.products.length}、新 listing ${freshThisPage}、达标新增 ${newCount}；累计达标 ${collected.length}/${maxProducts}`,
      );
      // 只有「本页没带出任何没采过的新 listing」才算到底/翻页没推进；连续两页如此才停。
      // 整页被门槛过滤掉（freshThisPage>0 但 newCount=0）不算到底，继续往后翻找达标的。
      if (freshThisPage === 0) {
        noFreshStreak++;
        if (noFreshStreak >= 2) break;
      } else {
        noFreshStreak = 0;
      }
    }

    const products = collected.slice(0, maxProducts);
    const ehuntHitCount = products.filter((p) => p.ehunt !== null).length;

    let ehuntStatus: ProductEhuntStatus;
    if (!isAdsPower) ehuntStatus = 'not_adspower';
    else if (ehuntHitCount > 0) ehuntStatus = 'ok';
    else ehuntStatus = 'no_ehunt';

    log(`▶ 共采到 ${products.length} 个新商品（跳过历史 ${skippedKnown}），EHunt 命中 ${ehuntHitCount}（${ehuntStatus}）`);

    // 诊断：翻了几页、共抓到多少卡、其中没采过/已采/不达标/达标各多少。漏没漏、翻页推没推进一眼可见。
    const diag = `翻了 ${pagesExamined}/${maxPages} 页、共抓到 ${rawSeen} 个商品卡（没采过 ${freshTotal}、已采过 ${skippedKnown}、不达标 ${skippedFilter}、达标 ${products.length}）`;

    let warning: string | undefined;
    if (aborted) {
      warning = `已手动停止：${diag}。已爬到的 ${products.length} 个达标新品已保留入库。`;
    } else if (ehuntFiltering && ehuntStatus === 'not_adspower') {
      warning = `设了销量/收藏门槛，但当前不是 AdsPower、拿不到 EHunt 指标，没法过滤。去设置选 AdsPower，或把门槛设 0。（${diag}）`;
    } else if (products.length === 0) {
      if (skippedFilter > 0) {
        const note = priceFiltering ? '销量/收藏/价格门槛' : '销量/收藏门槛';
        warning = `本次没有达标新商品：${diag}。放宽${note}或加大「最大翻页数」试试。`;
      } else if (skippedKnown > 0) {
        warning = `本次没有新商品：${diag}，搜到的之前都采过了，没有更多没采过的。`;
      } else {
        warning = `没抓到任何商品（选择器/反爬/登录墙），对着真实页面看下 DOM。（${diag}）`;
      }
    } else if (products.length < maxProducts) {
      warning = `只采到 ${products.length} 个达标新品（目标 ${maxProducts}）：${diag}。没有更多达标且没采过的了——加大「最大翻页数」或放宽门槛可挖更深。`;
    } else if (ehuntStatus === 'not_adspower') {
      warning = '当前不是 AdsPower 上下文，只能拿主图，没有 EHunt 指标。去设置→采集浏览器选 AdsPower。';
    } else if (ehuntStatus === 'no_ehunt') {
      warning = ehuntAnyInjected
        ? '页面有 EHunt 注入痕迹但未抽到指标，可能 EHunt 还在加载或 DOM 结构变动。'
        : '未检测到 EHunt 注入（确认 AdsPower profile 已装 EHunt 扩展且登录 Etsy）。';
    }

    return { products, ehuntStatus, ehuntHitCount, searchUrl: firstUrl, warning, aborted, pagesExamined, rawSeen };
  } catch (err) {
    return emptyResult(firstUrl, 'failed', `采集失败：${err instanceof Error ? err.message : String(err)}`, pagesExamined, rawSeen);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    log('▶ disconnect CDP · 浏览器窗口保留');
  }
}

function emptyResult(
  searchUrl: string,
  status: ProductEhuntStatus,
  warning: string,
  pagesExamined = 0,
  rawSeen = 0,
): CollectListResult {
  return { products: [], ehuntStatus: status, ehuntHitCount: 0, searchUrl, warning, pagesExamined, rawSeen };
}

/** 解析商品卡标价字符串为数字（去掉货币符号/千分位）；抓不到返回 null。 */
function parsePriceNumber(price: string | null | undefined): number | null {
  if (!price) return null;
  const n = parseFloat(price.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}
