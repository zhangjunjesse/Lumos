import { resolveEhuntBridgeConfig, openBridgePage, evaluateOnPage, closeBridgePage, releaseBridgeContext } from './bridge-page';
import type { EtsyReviewBundle, EhuntCollectStatus } from './types';

const COLLECT_TIMEOUT_MS = 180_000;
const MAX_PAGES_HARD_CAP = 60;

/**
 * 在已打开的 listing 页面内，复刻该页自己发出的 `deep_dive_reviews` 请求，
 * 同源 + 沿用 profile 登录态/代理，按 page 翻到 totalPages 聚合全部评论。
 *
 * 不写死 member/public：在页面上下文里 fetch，登录态由浏览器上下文自然决定。
 * 字段路径按已验证的真实响应映射（reviewInfo/buyerInfo/reviewContent/sellerResponse）。
 */
function buildCollectExpression(): string {
  return `(async () => {
  const out = { status: 'failed', message: '', listingId: '', shopId: null, totalReviews: 0,
    averageRating: null, ratingCounts: {}, tagFilters: [], reviews: [], pagesFetched: 0, totalPages: 0 };
  const m = location.pathname.match(/\\/listing\\/(\\d+)/);
  if (!m) { out.message = '当前页面不是 Etsy listing 页'; return out; }
  out.listingId = m[1];
  const html = document.documentElement.outerHTML;
  const shopMatch = html.match(/"shop_id"\\s*:\\s*"?(\\d{3,})"?/) || html.match(/"shopId"\\s*:\\s*"?(\\d{3,})"?/);
  out.shopId = shopMatch ? shopMatch[1] : null;
  const tokenEl = document.querySelector('meta[name="csrf_nonce"]');
  let csrf = tokenEl ? tokenEl.getAttribute('content') : '';
  if (!csrf) {
    const t = html.match(/"csrf_nonce"\\s*:\\s*"([^"]+)"/) || html.match(/csrfToken"\\s*:\\s*"([^"]+)"/);
    csrf = t ? t[1] : '';
  }
  const SPEC = ['Etsy','Modules','ListingPage','Reviews','DeepDive','AsyncApiSpec'].join(String.fromCharCode(92));
  const endpoint = '/api/v3/ajax/bespoke/member/neu/specs/deep_dive_reviews';
  const fetchPage = async (page) => {
    const body = { log_performance_metrics: false, specs: { deep_dive_reviews: [SPEC, {
      listing_id: Number(out.listingId), shop_id: out.shopId ? Number(out.shopId) : null,
      scope: 'listingReviews', page, sort_option: 'Relevancy', rating_filter: null,
      tag_filters: [], should_lazy_load_images: false, should_show_variations: true } ] } };
    const resp = await fetch(endpoint, { method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify(body) });
    const text = await resp.text();
    if (!resp.ok) return { httpError: resp.status, text: text.slice(0, 300) };
    try { return { json: JSON.parse(text) }; } catch (e) { return { parseError: text.slice(0, 300) }; }
  };
  const mapReview = (r) => {
    const ri = r.reviewInfo || {}, bi = r.buyerInfo || {}, rc = r.reviewContent || {}, sr = r.sellerResponse || {};
    return {
      transactionId: String(r.transactionId || ''),
      rating: typeof ri.rating === 'number' ? ri.rating : null,
      date: typeof ri.reviewDate === 'string' ? ri.reviewDate : null,
      text: typeof rc.reviewText === 'string' ? rc.reviewText : '',
      buyerName: bi.isAnonymous ? null : (typeof bi.name === 'string' ? bi.name : null),
      variations: typeof ri.variationSummary === 'string' ? ri.variationSummary : null,
      hasPhoto: Boolean(rc.appreciationPhotoUrl && typeof rc.appreciationPhotoUrl === 'object'
        && Object.keys(rc.appreciationPhotoUrl).length > 0),
      sellerResponse: typeof sr.responseText === 'string' && sr.responseText ? sr.responseText : null,
    };
  };
  const first = await fetchPage(1);
  if (first.httpError) { out.status = first.httpError === 403 ? 'needs_login' : 'failed';
    out.message = 'deep_dive_reviews HTTP ' + first.httpError; return out; }
  if (first.parseError) { out.status = 'needs_login'; out.message = '响应非 JSON（疑似未登录/拦截）'; return out; }
  const j1 = first.json || {};
  const jd = j1.jsData;
  if (!jd || !Array.isArray(jd.reviews)) { out.status = 'etsy_contract_changed';
    out.message = 'jsData.reviews 缺失，Etsy 响应契约可能已变'; return out; }
  out.totalReviews = Number(jd.totalReviews) || 0;
  out.averageRating = typeof jd.averageRating === 'number' ? Number(jd.averageRating.toFixed(2)) : null;
  out.ratingCounts = jd.ratingCounts || {};
  out.tagFilters = Array.isArray(jd.tagFilters) ? jd.tagFilters.map(t => ({ tag: t.tag, frequency: Number(t.frequency) || 0 })) : [];
  out.totalPages = Number(jd.totalPages) || 1;
  const seen = new Set();
  const push = (arr) => { for (const r of arr) { const mr = mapReview(r); if (mr.transactionId && !seen.has(mr.transactionId)) { seen.add(mr.transactionId); out.reviews.push(mr); } } };
  push(jd.reviews);
  out.pagesFetched = 1;
  const maxPages = Math.min(out.totalPages, ${MAX_PAGES_HARD_CAP});
  for (let p = 2; p <= maxPages; p++) {
    const r = await fetchPage(p);
    if (r.json && r.json.jsData && Array.isArray(r.json.jsData.reviews)) { push(r.json.jsData.reviews); out.pagesFetched++; }
    await new Promise(res => setTimeout(res, 350));
  }
  out.status = 'ok';
  return out;
})()`;
}

/** 采集单个 listing 的全部原始评论。永远返回结构化 bundle，失败原因写入 status/message。 */
export async function collectEtsyReviews(
  listingUrl: string,
  browserContextId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EtsyReviewBundle> {
  const capturedAt = new Date().toISOString();
  const base: EtsyReviewBundle = {
    listingId: '', shopId: null, totalReviews: 0, averageRating: null, ratingCounts: {},
    tagFilters: [], reviews: [], pagesFetched: 0, totalPages: 0, capturedAt, status: 'failed',
  };
  const config = resolveEhuntBridgeConfig(browserContextId);
  if (!config) {
    return { ...base, status: 'bridge_unavailable', message: 'Browser Bridge 未连接，请确认 Lumos 桌面端浏览器运行时已启动。' };
  }
  let pageId: string | null = null;
  try {
    pageId = await openBridgePage(config, listingUrl, opts);
    if (!pageId) return { ...base, status: 'failed', message: '浏览器打开页面后没有返回 pageId。' };

    const value = await evaluateOnPage<Partial<EtsyReviewBundle> & { status?: EhuntCollectStatus }>(
      config, pageId, buildCollectExpression(), { signal: opts.signal, timeoutMs: COLLECT_TIMEOUT_MS },
    );
    if (!value || typeof value !== 'object') {
      return { ...base, status: 'etsy_contract_changed', message: '页面脚本未返回有效结果。' };
    }
    return { ...base, ...value, capturedAt, status: (value.status as EhuntCollectStatus) || 'failed' };
  } catch (error) {
    return { ...base, status: 'failed', message: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      if (pageId) await closeBridgePage(config, pageId);
    } finally {
      await releaseBridgeContext(config);
    }
  }
}
