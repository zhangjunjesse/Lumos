import { resolveEhuntBridgeConfig, evaluateOnPage } from './bridge-page';
import type { EhuntMetrics } from './types';

interface RawCard {
  listingId: string;
  sales: string | null;
  favorites: string | null;
  storeWeeklySales: string | null;
  listed: string | null;
}

interface RawDetail {
  panelText: string;
}

/**
 * 列表/分类/搜索页：每个商品卡 EHunt 注入的指标文本。
 * 只取原文（解析放 Node 侧），保持 in-page 脚本简单。
 */
const LIST_EXPRESSION = `(() => {
  const out = [];
  const seen = new Set();
  const findMetricText = (anchor) => {
    let el = anchor;
    for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
      const t = el.innerText || '';
      if (/Sales\\s*:|Favorites\\s*:|Store\\s+Weekly\\s+Sales\\s*:|Listed\\s*:/i.test(t)) return t;
    }
    return '';
  };
  for (const a of document.querySelectorAll('a[href*="/listing/"]')) {
    const m = (a.getAttribute('href') || '').match(/\\/listing\\/(\\d+)/);
    if (!m || seen.has(m[1])) continue;
    const t = findMetricText(a);
    if (!/Sales\\s*:|Favorites\\s*:|Store\\s+Weekly\\s+Sales\\s*:|Listed\\s*:/i.test(t)) continue;
    seen.add(m[1]);
    const g = (re) => { const x = t.match(re); return x ? x[1].trim() : null; };
    out.push({
      listingId: m[1],
      sales: g(/Sales\\s*:\\s*([\\d.,]+\\s*[KkMm]?\\+?\\s*(?:\\(\\s*[\\d.,]+\\s*[KkMm]?\\+?\\s*\\))?)/i),
      favorites: g(/Favorites\\s*:\\s*([\\d.,]+\\s*[KkMm]?\\+?)/i),
      storeWeeklySales: g(/Store\\s+Weekly\\s+Sales\\s*:\\s*([\\d.,]+\\s*[KkMm]?\\+?)/i),
      listed: g(/Listed\\s*:\\s*([\\d/.-]+)/i),
    });
  }
  return out;
})()`;

/** 详情页：抓 EHunt - Etsy Rank Tool 面板原始文本，解析交给 Node 侧。 */
const DETAIL_EXPRESSION = `(() => {
  const A = /EHunt\\s*-\\s*Etsy Rank Tool|Release Time|Total Sales/i;
  let best = null;
  for (const el of document.querySelectorAll('div,section,table')) {
    const t = el.innerText || '';
    if (A.test(t) && t.length >= 40 && t.length <= 6000) { if (!best || t.length < best.len) best = { len: t.length, t }; }
  }
  return { panelText: best ? best.t.replace(/\\s+/g, ' ').trim() : '' };
})()`;

function num(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, '').replace(/\+/g, '').trim();
  const mk = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KkMm])?$/);
  if (mk) {
    const base = parseFloat(mk[1]);
    const unit = mk[2];
    if (unit) return Math.round(base * (/[Mm]/.test(unit) ? 1_000_000 : 1_000));
    return Number.isFinite(base) ? base : null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSales(value: string | null): { total: number | null; recent: number | null } {
  if (!value) return { total: null, recent: null };
  const m = value.match(/^\s*([\d.,]+\s*[KkMm]?\+?)\s*\(\s*([\d.,]+\s*[KkMm]?\+?)\s*\)\s*$/);
  return m ? { total: num(m[1]), recent: num(m[2]) } : { total: num(value), recent: null };
}

function toMetrics(card: RawCard): EhuntMetrics {
  const sales = parseSales(card.sales);
  return {
    salesTotal: sales.total,
    salesRecent: sales.recent,
    favorites: num(card.favorites),
    storeWeeklySales: num(card.storeWeeklySales),
    listedDate: card.listed,
    raw: {
      ...(card.sales ? { sales: card.sales } : {}),
      ...(card.favorites ? { favorites: card.favorites } : {}),
      ...(card.storeWeeklySales ? { storeWeeklySales: card.storeWeeklySales } : {}),
      ...(card.listed ? { listed: card.listed } : {}),
    },
  };
}

/** 列表/分类/搜索页：返回 listingId → EhuntMetrics。无注入则返回空 Map（调用方据 detector 显示原因）。 */
export async function extractListMetrics(
  browserContextId: string,
  pageId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Map<string, EhuntMetrics>> {
  const config = resolveEhuntBridgeConfig(browserContextId);
  if (!config) return new Map();
  const value = await evaluateOnPage<RawCard[]>(config, pageId, LIST_EXPRESSION, { signal: opts.signal });
  const cards = Array.isArray(value) ? value : [];
  const map = new Map<string, EhuntMetrics>();
  for (const card of cards) {
    if (card && card.listingId) map.set(card.listingId, toMetrics(card));
  }
  return map;
}

/**
 * 详情页 EHunt 面板。其拼接文本歧义大，只稳妥解析强分隔字段；
 * 不可靠的留 null + 原文，绝不编造。
 */
export async function extractDetailMetrics(
  browserContextId: string,
  pageId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EhuntMetrics | null> {
  const config = resolveEhuntBridgeConfig(browserContextId);
  if (!config) return null;
  const detail = await evaluateOnPage<RawDetail>(config, pageId, DETAIL_EXPRESSION, { signal: opts.signal });
  const text = detail?.panelText?.trim();
  if (!text) return null;
  const g = (re: RegExp): string | null => { const m = text.match(re); return m ? m[1].trim() : null; };
  const salesField = g(/Total Sales\s*([\d.,]+\s*[KkMm]?\+?\s*(?:\(\s*[\d.,]+\s*[KkMm]?\+?\s*\))?)/i);
  const sales = parseSales(salesField);
  return {
    salesTotal: sales.total,
    salesRecent: sales.recent,
    favorites: num(g(/Total Favorites\s*([\d.,]+\s*[KkMm]?\+?)/i)),
    storeWeeklySales: null,
    listedDate: g(/Release Time\s*([\d-]+)/i),
    totalViews: g(/Total Views\s*N\/?A/i) ? null : num(g(/Total Views\s*([\d.,]+\s*[KkMm]?\+?)/i)),
    reviewRatio: g(/Review Ratio\s*([\d.]+%)/i),
    storeSales: num(g(/Store Sales\s*([\d.,]+\s*[KkMm]?\+?)/i)),
    bestSeller: /BestSeller/i.test(text),
    stocks: num(g(/Stocks\s*:?\s*([\d.,]+)/i)),
    raw: { panelText: text.slice(0, 800) },
  };
}
