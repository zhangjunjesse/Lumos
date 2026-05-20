import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { generateStructured, EcommerceLlmUnavailableError } from './llm-client';
import { fetchViaBrowser, BrowserFetchError } from './browser-fetcher';
import { getBrowserFetchSettings } from './discover-settings';
import { parseProductFromHtml, type ParsedProduct } from './url-adapters';
import { enrichListingDetailsWithEhunt } from './ehunt/collect';
import { isAdsPowerContext } from './ehunt/detector';
import type { EhuntMetrics } from './ehunt/types';

export interface MarketSample {
  title: string;
  productId?: string;
  price?: string;
  rating?: string;
  reviews?: string;
  sales?: string;
  brand?: string;
  category?: string;
  url?: string;
  imageUrl?: string;
  imageUrls?: string[];
  keywordTags?: string[];
  badges?: string[];
  sponsored?: boolean;
  heatScore?: number;
  heatLevel?: string;
  heatConfidence?: string;
  heatReasons?: string[];
}

export interface MarketProductDetail {
  source: string;
  rank: number;
  title: string;
  url: string;
  productId?: string;
  price?: string;
  rating?: string;
  reviews?: string;
  sales?: string;
  brand?: string;
  category?: string;
  availability?: string;
  bulletPoints: string[];
  description?: string;
  imageUrl?: string;
  galleryImageUrls?: string[];
  reviewSnippets?: string[];
  badges?: string[];
  /** EHunt 注入指标（仅 AdsPower + 装了 EHunt 时非空；缺失不影响普通采集）。 */
  ehunt?: EhuntMetrics;
  fetchedAt: string;
  fetchedVia: 'browser' | 'server-fetch';
}

export interface FetchSamplesResult {
  source: string; // 'amazon-us' / 'etsy' / etc.
  url: string;
  samples: MarketSample[];
  details: MarketProductDetail[];
  warning?: string;
  detailWarnings?: string[];
  fetchedAt: string;
  fetchedVia?: 'browser' | 'server-fetch';
}

const sampleSchema = z.object({
  title: z.string().min(1).max(300),
  price: z.string().max(40).optional(),
  rating: z.string().max(20).optional(),
  reviews: z.string().max(40).optional(),
  sales: z.string().max(80).optional(),
  brand: z.string().max(120).optional(),
  category: z.string().max(160).optional(),
  badges: z.array(z.string().max(80)).max(8).default([]),
  // The model may see relative marketplace URLs in HTML. We normalize to
  // absolute URLs after extraction.
  url: z.string().max(800).optional(),
  image_url: z.string().max(800).optional(),
});

const extractionSchema = z.object({
  samples: z.array(sampleSchema).min(0).max(30),
});

const productDetailSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  price: z.string().max(80).optional(),
  rating: z.string().max(40).optional(),
  reviews: z.string().max(80).optional(),
  sales: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  category: z.string().max(160).optional(),
  availability: z.string().max(160).optional(),
  bullet_points: z.array(z.string().max(300)).max(8).default([]),
  description: z.string().max(1200).optional(),
  image_url: z.string().max(1000).optional(),
  image_urls: z.array(z.string().max(1000)).max(20).default([]),
  review_snippets: z.array(z.string().max(400)).max(6).default([]),
  badges: z.array(z.string().max(80)).max(8).default([]),
});

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_SEARCH_SAMPLE_COUNT = 12;
const MAX_SEARCH_SAMPLE_COUNT = 30;
const DEFAULT_DETAIL_FETCH_DELAY_MS = 1800;
const DEFAULT_DETAIL_FETCH_JITTER_MS = 1400;

/**
 * Best-effort fetch + LLM-driven extraction of top product results from a
 * search URL. NEVER throws — returns a result with `samples: []` and a
 * `warning` describing why on failure, so the caller can graceful-degrade
 * to a model-only flow.
 *
 * Fetches use the user's local IP (Lumos runs as an Electron desktop app
 * on the user's machine), so the success rate depends on the user's
 * network reaching the target site without captcha.
 */
export interface FetchSamplesOpts {
  source: string;
  url: string;
  acceptLanguage?: string;
  abortSignal?: AbortSignal;
  maxSamples?: number;
  /**
   * If provided AND browser fetch is enabled, routes the fetch through Lumos
   * Browser Bridge using the configured browser context. Falls back to plain
   * server fetch on browser failure (we still want SOME chance of data).
   */
  store?: AppDataStore;
}

export async function fetchSearchSamples(opts: FetchSamplesOpts): Promise<FetchSamplesResult> {
  const fetchedAt = new Date().toISOString();
  const max = Math.min(
    Math.max(Math.floor(opts.maxSamples ?? DEFAULT_SEARCH_SAMPLE_COUNT), 1),
    MAX_SEARCH_SAMPLE_COUNT,
  );

  // 1) Try Lumos browser path first if enabled. This reuses the user's browser
  // provider settings (embedded / AdsPower / external CDP) instead of storing
  // marketplace anti-bot credentials inside the ecommerce app.
  if (opts.store) {
    const browser = getBrowserFetchSettings(opts.store);
    if (browser.enabled) {
      let browserOut: Awaited<ReturnType<typeof fetchViaBrowser>>;
      try {
        browserOut = await fetchViaBrowser(opts.url, browser, {
          timeoutMs: 90_000,
          abortSignal: opts.abortSignal,
        });
      } catch (err) {
        // Browser runtime not running / provider invalid / CDP error → annotate and
        // fall through to plain fetch so user still has a chance.
        const reason =
          err instanceof BrowserFetchError
            ? `浏览器抓取: ${err.message}`
            : err instanceof Error
              ? `浏览器抓取: ${err.message}`
              : `浏览器抓取: ${String(err)}`;
        const fallback = await plainServerFetch({ ...opts, max, fetchedAt });
        return {
          ...fallback,
          warning: fallback.warning
            ? `${reason}; 退回 server fetch 后又失败：${fallback.warning}`
            : reason
                ? `${reason}; 已用 server fetch 兜底成功`
                : undefined,
        };
      }

      try {
        const browserResult = await extractFromHtml({
          source: opts.source,
          url: browserOut.url || opts.url,
          html: browserOut.html,
          fetchedAt,
          max,
          abortSignal: opts.abortSignal,
          fetchedVia: 'browser',
          acceptLanguage: opts.acceptLanguage,
          browserSettings: browser,
          browserContextId: browserOut.browserContextId,
        });
        if (browserResult.samples.length > 0) {
          // EHunt 指标增强：仅 AdsPower 上下文 + Etsy 页面才尝试；失败只警告，绝不阻断采集。
          if (
            browserResult.fetchedVia === 'browser'
            && isAdsPowerContext(browserOut.browserContextId)
            && /etsy\.com/i.test(browserResult.url)
          ) {
            try {
              const det = await enrichListingDetailsWithEhunt(
                browserResult.details,
                browserOut.browserContextId,
                browserResult.url,
                { signal: opts.abortSignal },
              );
              if (det.status !== 'ok') {
                browserResult.detailWarnings = [
                  ...(browserResult.detailWarnings ?? []),
                  `EHunt: ${det.reason}`,
                ];
              }
            } catch (err) {
              browserResult.detailWarnings = [
                ...(browserResult.detailWarnings ?? []),
                `EHunt 指标采集异常: ${err instanceof Error ? err.message : String(err)}`,
              ];
            }
          }
          return browserResult;
        }
        const fallback = await plainServerFetch({ ...opts, max, fetchedAt });
        return {
          ...fallback,
          warning: fallback.warning
            ? `${browserResult.warning ?? '浏览器抓取未获得商品卡片'}；退回 server fetch 后又失败：${fallback.warning}`
            : browserResult.warning
              ? `${browserResult.warning}；已用 server fetch 兜底成功`
              : undefined,
        };
      } catch (err) {
        const reason =
          err instanceof Error
            ? `浏览器页面解析: ${err.message}`
            : `浏览器页面解析: ${String(err)}`;
        const fallback = await plainServerFetch({ ...opts, max, fetchedAt });
        return {
          ...fallback,
          warning: fallback.warning
            ? `${reason}; 退回 server fetch 后又失败：${fallback.warning}`
            : `${reason}; 已用 server fetch 兜底成功`,
        };
      }
    }
  }

  // 2) Plain server fetch (browser scraping disabled or unavailable).
  return plainServerFetch({ ...opts, max, fetchedAt });
}

interface PlainFetchOpts extends FetchSamplesOpts {
  max: number;
  fetchedAt: string;
}

async function plainServerFetch(opts: PlainFetchOpts): Promise<FetchSamplesResult> {
  let html: string;
  try {
    const res = await fetch(opts.url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': opts.acceptLanguage ?? 'en-US,en;q=0.9',
      },
      signal: opts.abortSignal,
      redirect: 'follow',
    });
    if (!res.ok) {
      return {
        source: opts.source,
        url: opts.url,
        samples: [],
        details: [],
        warning: `HTTP ${res.status}`,
        fetchedAt: opts.fetchedAt,
        fetchedVia: 'server-fetch',
      };
    }
    html = await res.text();
  } catch (err) {
      return {
        source: opts.source,
        url: opts.url,
        samples: [],
        details: [],
        warning: err instanceof Error ? err.message : String(err),
        fetchedAt: opts.fetchedAt,
        fetchedVia: 'server-fetch',
      };
  }
  return extractFromHtml({
    source: opts.source,
    url: opts.url,
    html,
    fetchedAt: opts.fetchedAt,
    max: opts.max,
    abortSignal: opts.abortSignal,
    fetchedVia: 'server-fetch',
    acceptLanguage: opts.acceptLanguage,
  });
}

interface ExtractOpts {
  source: string;
  url: string;
  html: string;
  fetchedAt: string;
  max: number;
  abortSignal?: AbortSignal;
  fetchedVia: 'browser' | 'server-fetch';
  acceptLanguage?: string;
  browserSettings?: ReturnType<typeof getBrowserFetchSettings>;
  browserContextId?: string;
}

async function extractFromHtml(opts: ExtractOpts): Promise<FetchSamplesResult> {
  const { url, html, fetchedAt, max } = opts;
  const diagnostics = buildHtmlDiagnostics(html, url);
  const deterministicSamples = extractMarketplaceSamples(opts.source, html, url, max);
  if (deterministicSamples.length > 0) {
    const result: FetchSamplesResult = {
      source: opts.source,
      url: opts.url,
      samples: deterministicSamples,
      details: [],
      fetchedAt,
      fetchedVia: opts.fetchedVia,
    };
    return await enrichWithProductDetails(result, opts);
  }

  const block = detectBlock(html);
  if (block) {
    return {
      source: opts.source,
      url: opts.url,
      samples: [],
      details: [],
      warning: withDiagnostics(block, opts, diagnostics, html),
      fetchedAt,
      fetchedVia: opts.fetchedVia,
    };
  }
  if (html.length < 3000) {
    return {
      source: opts.source,
      url: opts.url,
      samples: [],
      details: [],
      warning: withDiagnostics(`响应过短（${html.length} 字节），疑似被拦截或页面尚未渲染。`, opts, diagnostics, html),
      fetchedAt,
      fetchedVia: opts.fetchedVia,
    };
  }

  // Take a relevant slice — keep the body, strip scripts/styles to fit context.
  const slice = sliceForLlm(html);
  if (slice.length < 500) {
    return {
      source: opts.source,
      url: opts.url,
      samples: [],
      details: [],
      warning: withDiagnostics('清洗后内容为空。', opts, diagnostics, html),
      fetchedAt,
      fetchedVia: opts.fetchedVia,
    };
  }

  try {
    const data = await generateStructured({
      schema: extractionSchema,
      system: `You extract top product search results from raw HTML.
Be strict: only return items that are clearly individual product cards (skip ads, "people also bought", category nav, sponsored fillers).
Use the exact text you see — do NOT invent prices / ratings / urls.
If no real product cards are present (captcha page, error page, empty results), return samples: [].`,
      prompt: [
        `Extract up to ${max} top product results from this ${opts.source} search page snippet.`,
        'For each: title (concrete product name as shown), price (with currency symbol), rating (e.g. "4.5"), reviews (e.g. "1,234"), sales if visible (e.g. "10K+ bought in past month" / "1,000+ sales"), badges if visible (e.g. Best Seller, Amazon Choice), url (the product/detail href exactly as visible; relative href is allowed), image_url if visible.',
        '',
        '----- BEGIN HTML SNIPPET -----',
        slice,
        '----- END HTML SNIPPET -----',
      ].join('\n'),
      abortSignal: opts.abortSignal,
      maxTokens: max > 10 ? 8192 : 4096,
    });
    const samples = data.samples
      .slice(0, max)
      .map((sample) => normalizeSample(sample, url))
      .filter((sample): sample is MarketSample => Boolean(sample));
    if (samples.length === 0) {
      return {
        source: opts.source,
        url: opts.url,
        samples: [],
        details: [],
        warning: withDiagnostics('页面已抓取，但没有识别到真实商品卡片。', opts, diagnostics, html),
        fetchedAt,
        fetchedVia: opts.fetchedVia,
      };
    }
    const result: FetchSamplesResult = {
      source: opts.source,
      url: opts.url,
      samples,
      details: [],
      fetchedAt,
      fetchedVia: opts.fetchedVia,
    };
    return await enrichWithProductDetails(result, opts);
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return {
      source: opts.source,
      url: opts.url,
      samples: [],
      details: [],
      warning: withDiagnostics(`LLM 解析不可用：${err.message}`, opts, diagnostics, html),
      fetchedAt,
      fetchedVia: opts.fetchedVia,
    };
    }
    return {
      source: opts.source,
      url: opts.url,
      samples: [],
      details: [],
      warning: withDiagnostics(`解析失败：${err instanceof Error ? err.message : String(err)}`, opts, diagnostics, html),
      fetchedAt,
      fetchedVia: opts.fetchedVia,
    };
  }
}

function normalizeSample(
  sample: z.infer<typeof sampleSchema>,
  baseUrl: string,
): MarketSample | null {
  const title = cleanExtractedText(sample.title);
  if (!title) return null;
  const url = absoluteUrl(cleanExtractedText(sample.url), baseUrl);
  const imageUrl = absoluteUrl(cleanExtractedText(sample.image_url), baseUrl);
  const imageUrls = imageUrl ? dedupeImageUrls([imageUrl], baseUrl) : [];
  const productId = extractProductId('', url ?? '');
  const badges = cleanExtractedList(sample.badges);
  return {
    title,
    ...(productId ? { productId } : {}),
    ...(cleanExtractedText(sample.price) ? { price: cleanExtractedText(sample.price) } : {}),
    ...(cleanExtractedText(sample.rating) ? { rating: cleanExtractedText(sample.rating) } : {}),
    ...(cleanExtractedText(sample.reviews) ? { reviews: cleanExtractedText(sample.reviews) } : {}),
    ...(cleanExtractedText(sample.sales) ? { sales: cleanExtractedText(sample.sales) } : {}),
    ...(cleanExtractedText(sample.brand) ? { brand: cleanExtractedText(sample.brand) } : {}),
    ...(cleanExtractedText(sample.category) ? { category: cleanExtractedText(sample.category) } : {}),
    ...(url ? { url } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(badges.length ? { badges } : {}),
  };
}

async function enrichWithProductDetails(
  result: FetchSamplesResult,
  opts: Pick<ExtractOpts, 'acceptLanguage' | 'abortSignal' | 'browserSettings' | 'browserContextId'>,
): Promise<FetchSamplesResult> {
  const detailTargets = result.samples
    .map((sample, idx) => ({ sample, rank: idx + 1 }))
    .filter((item) => Boolean(item.sample.url))
    .slice(0, MAX_SEARCH_SAMPLE_COUNT);
  if (detailTargets.length === 0) {
    return result;
  }

  const details: MarketProductDetail[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < detailTargets.length; index += 1) {
    const item = detailTargets[index];
    const url = item.sample.url;
    if (!url) continue;
    const outcome = await fetchProductDetail({
      source: result.source,
      url,
      rank: item.rank,
      fallbackTitle: item.sample.title,
      fallbackPrice: item.sample.price,
      fallbackRating: item.sample.rating,
      fallbackReviews: item.sample.reviews,
      fallbackSales: item.sample.sales,
      fallbackBrand: item.sample.brand,
      fallbackCategory: item.sample.category,
      fallbackImageUrl: item.sample.imageUrl,
      acceptLanguage: opts.acceptLanguage,
      abortSignal: opts.abortSignal,
      browserSettings: opts.browserSettings,
      browserContextId: opts.browserContextId,
    });
    if (outcome.detail) {
      details.push(outcome.detail);
    } else if (outcome.warning) {
      warnings.push(`#${item.rank} ${outcome.warning}`);
    }
    if (index < detailTargets.length - 1) {
      await waitBetweenDetailFetches(opts.abortSignal);
    }
  }

  return {
    ...result,
    details,
    ...(warnings.length ? { detailWarnings: warnings } : {}),
    ...(details.length === 0 && warnings.length
      ? { warning: joinWarning(result.warning, `商品详情抓取失败：${warnings.join('；')}`) }
      : {}),
  };
}

async function waitBetweenDetailFetches(abortSignal?: AbortSignal): Promise<void> {
  const delayMs = resolveDetailFetchDelayMs();
  if (delayMs <= 0) return;
  await sleep(delayMs, abortSignal);
}

function resolveDetailFetchDelayMs(): number {
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') return 0;
  const configured = Number(process.env.ECOMMERCE_DISCOVER_DETAIL_DELAY_MS);
  const base = Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_DETAIL_FETCH_DELAY_MS;
  const configuredJitter = Number(process.env.ECOMMERCE_DISCOVER_DETAIL_JITTER_MS);
  const jitter = Number.isFinite(configuredJitter) && configuredJitter >= 0
    ? configuredJitter
    : DEFAULT_DETAIL_FETCH_JITTER_MS;
  return Math.round(base + Math.random() * jitter);
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(abortSignal.reason ?? new Error('Aborted'));
  }
  return new Promise((resolve, reject) => {
    function cleanup() {
      abortSignal?.removeEventListener('abort', onAbort);
    }
    function onAbort() {
      clearTimeout(timer);
      cleanup();
      reject(abortSignal?.reason ?? new Error('Aborted'));
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchProductDetail(args: {
  source: string;
  url: string;
  rank: number;
  fallbackTitle: string;
  fallbackPrice?: string;
  fallbackRating?: string;
  fallbackReviews?: string;
  fallbackSales?: string;
  fallbackBrand?: string;
  fallbackCategory?: string;
  fallbackImageUrl?: string;
  acceptLanguage?: string;
  abortSignal?: AbortSignal;
  browserSettings?: ReturnType<typeof getBrowserFetchSettings>;
  browserContextId?: string;
}): Promise<{ detail?: MarketProductDetail; warning?: string }> {
  const fetchedAt = new Date().toISOString();
  let html: string;
  let finalUrl = args.url;
  let fetchedVia: 'browser' | 'server-fetch' = 'server-fetch';

  try {
    if (args.browserSettings?.enabled) {
      const out = await fetchViaBrowser(args.url, args.browserSettings, {
        timeoutMs: 90_000,
        abortSignal: args.abortSignal,
      });
      html = out.html;
      finalUrl = out.url || args.url;
      fetchedVia = 'browser';
    } else {
      const out = await fetchHtmlServer(args.url, args.acceptLanguage, args.abortSignal);
      html = out.html;
      finalUrl = out.url || args.url;
    }
  } catch (err) {
    if (args.browserSettings?.enabled) {
      try {
        const out = await fetchHtmlServer(args.url, args.acceptLanguage, args.abortSignal);
        html = out.html;
        finalUrl = out.url || args.url;
      } catch (fallbackErr) {
        return {
          warning: `详情页无法打开：${errorMessage(err)}；server fetch 也失败：${errorMessage(fallbackErr)}`,
        };
      }
    } else {
      return { warning: `详情页无法打开：${errorMessage(err)}` };
    }
  }

  if (html.length < 1200) {
    return {
      warning: withDetailDiagnostics(`详情页响应过短（${html.length} 字节）`, args, fetchedVia, html, finalUrl, 0),
    };
  }
  const parsed = parseProductFromHtml(finalUrl, html).product;
  const deterministicSales = extractMarketplaceSalesSignal(args.source, html);
  const deterministicBadges = extractMarketplaceBadges(html);
  const deterministicImages = collectDetailImageUrls(parsed, html, finalUrl, args.fallbackImageUrl);
  const block = detectBlock(html);
  if (block && !hasUsefulProductDetailEvidence(parsed, deterministicImages, args.fallbackImageUrl)) {
    return {
      warning: withDetailDiagnostics(block, args, fetchedVia, html, finalUrl, deterministicImages.length),
    };
  }
  const slice = sliceForLlm(html);
  if (slice.length < 500) {
    const fallback = buildDetailFromParsedProduct({
      parsed,
      source: args.source,
      rank: args.rank,
      url: finalUrl,
      fetchedAt,
      fetchedVia,
      fallbackTitle: args.fallbackTitle,
      fallbackPrice: args.fallbackPrice,
      fallbackRating: args.fallbackRating,
      fallbackReviews: args.fallbackReviews,
      fallbackSales: args.fallbackSales,
      fallbackBrand: args.fallbackBrand,
      fallbackCategory: args.fallbackCategory,
      images: deterministicImages,
      sales: deterministicSales,
      badges: deterministicBadges,
    });
    if (fallback) {
      return { detail: fallback };
    }
    return {
      warning: withDetailDiagnostics('详情页清洗后内容为空', args, fetchedVia, html, finalUrl, deterministicImages.length),
    };
  }

  try {
    const data = await generateStructured({
      schema: productDetailSchema,
      system: `You extract factual product details from raw marketplace product pages.
Be strict: only return facts visible in the page. Do NOT infer or invent missing specs.`,
      prompt: [
        `Extract product details from this ${args.source} product page.`,
        `Fallback search-card title: ${args.fallbackTitle}`,
        '',
        'Return title, price, rating, reviews, sales if visible, brand/store, category, availability, bullet_points, short description, main image_url, all visible product/gallery image_urls, visible review_snippets, and badges such as Best Seller / Amazon Choice / popular item if present.',
        '',
        '----- BEGIN HTML SNIPPET -----',
        slice,
        '----- END HTML SNIPPET -----',
      ].join('\n'),
      abortSignal: args.abortSignal,
      maxTokens: 4096,
    });
    const llmImageUrls = cleanExtractedList(data.image_urls);
    const imageUrls = dedupeImageUrls(
      [
        absoluteUrl(cleanExtractedText(data.image_url), finalUrl),
        ...llmImageUrls.map((img) => absoluteUrl(img, finalUrl)),
        ...deterministicImages,
        args.fallbackImageUrl,
      ],
      finalUrl,
    ).slice(0, 24);
    const imageUrl = imageUrls[0] || args.fallbackImageUrl;
    const llmBulletPoints = cleanExtractedList(data.bullet_points);
    const parsedBulletPoints = cleanExtractedList(parsed.bullets);
    const bulletPoints = llmBulletPoints.length ? llmBulletPoints : parsedBulletPoints;
    const detail: MarketProductDetail = {
        source: args.source,
        rank: args.rank,
        title:
          cleanExtractedText(data.title) ||
          cleanExtractedText(parsed.title) ||
          cleanExtractedText(args.fallbackTitle) ||
          finalUrl,
        url: finalUrl,
        productId: extractProductId(args.source, finalUrl),
        price: cleanExtractedText(data.price) || cleanExtractedText(parsed.price) || cleanExtractedText(args.fallbackPrice),
        rating:
          cleanExtractedText(data.rating) ||
          cleanExtractedText(parsed.rating) ||
          cleanExtractedText(args.fallbackRating),
        reviews:
          cleanExtractedText(data.reviews) ||
          cleanExtractedText(parsed.reviewsCount) ||
          cleanExtractedText(args.fallbackReviews),
        sales:
          cleanExtractedText(data.sales) ||
          deterministicSales ||
          cleanExtractedText(args.fallbackSales),
        brand:
          cleanExtractedText(data.brand) ||
          cleanExtractedText(parsed.brand) ||
          cleanExtractedText(args.fallbackBrand),
        category:
          cleanExtractedText(data.category) ||
          cleanExtractedText(parsed.category) ||
          cleanExtractedText(args.fallbackCategory),
        availability: cleanExtractedText(data.availability),
        bulletPoints: bulletPoints.slice(0, 10),
        description: cleanExtractedText(data.description) || cleanExtractedText(parsed.description),
        imageUrl,
        galleryImageUrls: imageUrls.filter((img) => img !== imageUrl),
        reviewSnippets: cleanExtractedList(data.review_snippets),
        badges: uniqueLocalStrings([...cleanExtractedList(data.badges), ...deterministicBadges]),
        fetchedAt,
        fetchedVia,
    };
    return { detail };
  } catch (err) {
    const fallback = buildDetailFromParsedProduct({
      parsed,
      source: args.source,
      rank: args.rank,
      url: finalUrl,
      fetchedAt,
      fetchedVia,
      fallbackTitle: args.fallbackTitle,
      fallbackPrice: args.fallbackPrice,
      fallbackRating: args.fallbackRating,
      fallbackReviews: args.fallbackReviews,
      fallbackSales: args.fallbackSales,
      fallbackBrand: args.fallbackBrand,
      fallbackCategory: args.fallbackCategory,
      images: deterministicImages,
      sales: deterministicSales,
      badges: deterministicBadges,
    });
    if (fallback) {
      return { detail: fallback };
    }
    return {
      warning: withDetailDiagnostics(`详情解析失败：${errorMessage(err)}`, args, fetchedVia, html, finalUrl, deterministicImages.length),
    };
  }
}

function hasUsefulProductDetailEvidence(
  parsed: ParsedProduct,
  imageUrls: string[],
  fallbackImageUrl?: string,
): boolean {
  const pageImageCount = fallbackImageUrl
    ? imageUrls.filter((imageUrl) => imageUrl !== fallbackImageUrl).length
    : imageUrls.length;
  if (pageImageCount >= 2) return true;
  return Boolean(parsed.title && (parsed.price || parsed.description || parsed.bullets.length > 0 || pageImageCount > 0));
}

function buildDetailFromParsedProduct(args: {
  parsed: ParsedProduct;
  source: string;
  rank: number;
  url: string;
  fetchedAt: string;
  fetchedVia: 'browser' | 'server-fetch';
  fallbackTitle: string;
  fallbackPrice?: string;
  fallbackRating?: string;
  fallbackReviews?: string;
  fallbackSales?: string;
  fallbackBrand?: string;
  fallbackCategory?: string;
  images: string[];
  sales?: string;
  badges?: string[];
}): MarketProductDetail | null {
  const title = cleanExtractedText(args.parsed.title) || cleanExtractedText(args.fallbackTitle);
  if (!title && args.images.length === 0) return null;
  const imageUrl = args.images[0];
  return {
    source: args.source,
    rank: args.rank,
    title: title || args.url,
    url: args.url,
    productId: extractProductId(args.source, args.url),
    price: cleanExtractedText(args.parsed.price) || cleanExtractedText(args.fallbackPrice),
    rating: cleanExtractedText(args.parsed.rating) || cleanExtractedText(args.fallbackRating),
    reviews: cleanExtractedText(args.parsed.reviewsCount) || cleanExtractedText(args.fallbackReviews),
    sales: cleanExtractedText(args.sales) || cleanExtractedText(args.fallbackSales),
    brand: cleanExtractedText(args.parsed.brand) || cleanExtractedText(args.fallbackBrand),
    category: cleanExtractedText(args.parsed.category) || cleanExtractedText(args.fallbackCategory),
    bulletPoints: cleanExtractedList(args.parsed.bullets).slice(0, 10),
    description: cleanExtractedText(args.parsed.description),
    imageUrl,
    galleryImageUrls: args.images.filter((img) => img !== imageUrl),
    reviewSnippets: [],
    badges: cleanExtractedList(args.badges),
    fetchedAt: args.fetchedAt,
    fetchedVia: args.fetchedVia,
  };
}

async function fetchHtmlServer(
  url: string,
  acceptLanguage?: string,
  abortSignal?: AbortSignal,
): Promise<{ url: string; html: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': acceptLanguage ?? 'en-US,en;q=0.9',
    },
    signal: abortSignal,
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return { url: res.url || url, html: await res.text() };
}

function absoluteUrl(raw: string | undefined, baseUrl: string): string | undefined {
  const normalized = raw?.trim();
  if (!normalized) return undefined;
  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function extractProductId(source: string, rawUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const pathName = decodeURIComponent(url.pathname);
    const amazon = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)|\/-\/[a-z]{2}\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(pathName);
    if (amazon?.[1] || amazon?.[2]) return amazon[1] ?? amazon[2];
    const etsy = /\/listing\/(\d+)/i.exec(pathName);
    if (etsy?.[1]) return etsy[1];
    const walmart = /\/ip\/(?:[^/]+\/)?(\d+)(?:[/?]|$)/i.exec(pathName);
    if (walmart?.[1]) return walmart[1];
    if (source.startsWith('amazon')) {
      const asin = /(?:^|[?&])(?:asin|ASIN)=([A-Z0-9]{10})(?:&|$)/.exec(url.search);
      if (asin?.[1]) return asin[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function collectDetailImageUrls(
  parsed: ParsedProduct,
  html: string,
  baseUrl: string,
  fallbackImageUrl?: string,
): string[] {
  return dedupeImageUrls(
    [
      parsed.mainImage,
      ...parsed.gallery,
      ...collectImageUrlsFromHtml(html, baseUrl, 28),
      fallbackImageUrl,
    ],
    baseUrl,
  ).slice(0, 28);
}

function collectImageUrlsFromHtml(html: string, baseUrl: string, limit: number): string[] {
  const out: string[] = [];
  const add = (raw: string | undefined | null) => {
    if (!raw) return;
    const abs = absoluteUrl(decodeHtmlEntities(raw), baseUrl);
    if (abs && isLikelyProductImageUrl(abs)) out.push(abs);
  };

  const dynamicImageRe = /data-a-dynamic-image\s*=\s*["']({[^"']+})["']/gi;
  for (const match of html.matchAll(dynamicImageRe)) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1])) as Record<string, [number, number]>;
      Object.entries(parsed)
        .sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])
        .forEach(([url]) => add(url));
    } catch {
      // ignore malformed marketplace blobs
    }
  }

  const attrNames = [
    'data-old-hires',
    'data-src-zoom-image',
    'data-zoom-image',
    'data-hires',
    'data-large-image',
    'data-preload-lp-src',
    'data-src',
    'src',
  ];
  for (const attr of attrNames) {
    const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
    for (const match of html.matchAll(re)) add(match[1]);
  }

  for (const attr of ['srcset', 'data-srcset', 'data-preload-lp-srcset']) {
    const srcSetRe = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
    for (const match of html.matchAll(srcSetRe)) {
      for (const part of match[1].split(',')) {
        const raw = part.trim().split(/\s+/)[0];
        add(raw);
      }
    }
  }

  const metaImageRe = /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(metaImageRe)) add(match[1]);

  const capturedImagesRe = /<script[^>]+data-lumos-captured-images[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(capturedImagesRe)) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1])) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') add(item);
        }
      }
    } catch {
      // ignore malformed browser capture hints
    }
  }

  const normalizedHtml = decodeHtmlEntities(html)
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/');
  const rawImageRe = /https?:\/\/[^"'<>\s\\]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'<>\s\\]*)?/gi;
  for (const match of normalizedHtml.matchAll(rawImageRe)) add(match[0]);

  return dedupeImageUrls(out, baseUrl).slice(0, limit);
}

function dedupeImageUrls(values: Array<string | undefined | null>, baseUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const abs = absoluteUrl(value ?? undefined, baseUrl);
    if (!abs || !isLikelyProductImageUrl(abs)) continue;
    const key = normalizeImageDedupeKey(abs);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
}

function normalizeImageDedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (/etsystatic\.com$/i.test(parsed.hostname)) {
      const etsyImage = /(?:\/c\/\d+\/\d+\/\d+\/\d+)?\/(?:r\/)?il\/([^/]+)\/(\d+)\/il_[^/.]+\.([0-9]+)_([a-z0-9]+)\.(jpe?g|png|webp|avif)$/i.exec(parsed.pathname);
      if (etsyImage) {
        return `${parsed.hostname}/il/${etsyImage[1]}/${etsyImage[2]}/${etsyImage[3]}_${etsyImage[4]}.${etsyImage[5]}`.toLowerCase();
      }
      return `${parsed.hostname}${parsed.pathname
        .replace(/\/il_[^/.]+\.([0-9]+)_([a-z0-9]+)\.(jpe?g|png|webp|avif)$/i, '/$1_$2.$3')
        .toLowerCase()}`;
    }
  } catch {
    // fall through to generic normalization
  }
  return url
    .replace(/\._AC_[^./]+_\./i, '.')
    .replace(/\._[^./]+_\./i, '.')
    .replace(/[?&](?:width|height|w|h|resize|fit|format|quality|auto)=[^&]+/gi, '');
}

function isLikelyProductImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const value = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    if (/\.(?:js|css|svg|mp4|m3u8|webm)(?:$|[?#])/i.test(parsed.pathname)) {
      return false;
    }
    if (/transparent-pixel|grey-pixel|nav-sprite|sprite|\/logos?\//i.test(value)) {
      return false;
    }
    const hasImageExtension = /\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(parsed.pathname);
    if (
      hasImageExtension &&
      /m\.media-amazon|images-na\.ssl-images-amazon|ssl-images-amazon|etsystatic|walmartimages|alicdn|shopify|cdn\.shopify|cloudfront|scene7|product|image|img/.test(value)
    ) {
      return true;
    }
    return hasImageExtension;
  } catch {
    return false;
  }
}

function joinWarning(...parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((part): part is string => Boolean(part?.trim()));
  return filtered.length ? filtered.join('; ') : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function detectBlock(html: string): string | null {
  const lc = html.toLowerCase();
  if (lc.includes('chrome-error://chromewebdata') || lc.includes('err_quic_protocol_error')) return '浏览器打开了 Chrome 错误页（ERR_QUIC_PROTOCOL_ERROR）。';
  if (lc.includes('err_tunnel_connection_failed')) return '浏览器代理隧道连接失败（ERR_TUNNEL_CONNECTION_FAILED）。';
  if (lc.includes('err_proxy_connection_failed')) return '浏览器代理连接失败（ERR_PROXY_CONNECTION_FAILED）。';
  if (lc.includes('bm-verify') || lc.includes('/_sec/verify?provider=interstitial')) {
    return '检测到 Amazon/Akamai 访问校验页，自动抓取被平台验证拦截。';
  }
  if (lc.includes('captcha') && lc.includes('robot')) return '检测到反爬验证码页面。';
  if (lc.includes('type the characters you see') || lc.includes('enter the characters you see')) return '检测到验证码页面。';
  if (lc.includes('sorry, we just need to make sure') && lc.includes('not a robot')) return '检测到机器人校验页面。';
  if (lc.includes('geo.captcha-delivery.com') || lc.includes('datadome')) return '检测到 DataDome 访问校验页，自动抓取被平台验证拦截。';
  if (lc.includes('please enable js') && lc.includes('disable any ad blocker')) return '检测到平台访问校验页，自动抓取被要求启用 JS/关闭拦截器。';
  if (lc.includes('access denied') && lc.length < 8000) return '访问被拒（access denied）。';
  if (lc.includes('blocked')) {
    // Many legitimate pages mention "blocked" elsewhere; only treat short
    // pages as bot-blocked.
    if (lc.length < 8000) return '页面提示被拦截。';
  }
  if (lc.includes('to discuss automated access')) return '亚马逊反爬页（automated access）。';
  return null;
}

function extractMarketplaceSamples(
  source: string,
  html: string,
  baseUrl: string,
  max: number,
): MarketSample[] {
  if (source.startsWith('amazon')) {
    return extractAmazonSamples(html, baseUrl, max);
  }
  if (source === 'etsy') {
    return extractEtsySamples(html, baseUrl, max);
  }
  return [];
}

function extractAmazonSamples(html: string, baseUrl: string, max: number): MarketSample[] {
  const samples: MarketSample[] = [];
  const seen = new Set<string>();
  const blockPattern =
    /<div\b(?=[^>]*\bdata-asin=["']([A-Z0-9]{10})["'])(?=[^>]*\bdata-component-type=["']s-search-result["'])[\s\S]*?(?=<div\b(?=[^>]*\bdata-asin=["'][A-Z0-9]{10}["'])(?=[^>]*\bdata-component-type=["']s-search-result["'])|<div\b[^>]*\bdata-component-type=["']s-impression-logger["']|$)/gi;

  for (const match of html.matchAll(blockPattern)) {
    if (samples.length >= max) break;
    const asin = match[1];
    const block = match[0];
    if (!asin || seen.has(asin)) continue;

    const title = cleanAmazonTitle(
      decodeHtmlEntities(
        attrValue(/<h2\b[^>]*\baria-label=["']([^"']+)["']/i, block)
          ?? attrValue(/<img\b[^>]*\bclass=["'][^"']*\bs-image\b[^"']*["'][^>]*\balt=["']([^"']+)["']/i, block)
          ?? stripTags(attrValue(/<h2\b[\s\S]*?<\/h2>/i, block) ?? ''),
      ),
    );
    if (!title || title.length < 4) continue;

    seen.add(asin);
    const price = cleanText(
      decodeHtmlEntities(
        attrValue(/<span\b[^>]*\bclass=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i, block)
          ?? attrValue(/<span\b[^>]*\bclass=["'][^"']*\ba-color-price\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i, block)
          ?? '',
      ),
    );
    const rating = cleanText(
      decodeHtmlEntities(
        attrValue(/\baria-label=["']([0-9]+(?:\.[0-9]+)?)\s*(?:颗星|stars?|out of 5)/i, block)
          ?? attrValue(/<span\b[^>]*\baria-hidden=["']true["'][^>]*\bclass=["'][^"']*\ba-size-small\b[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/span>/i, block)
          ?? '',
      ),
    );
    const reviews = cleanText(
      decodeHtmlEntities(
        attrValue(/\baria-label=["']([\d,，.]+)\s*(?:评级|ratings?|reviews?)/i, block)
          ?? attrValue(/<span\b[^>]*>\s*\(?([\d,，.]{2,})\)?\s*<\/span>/i, block)
          ?? '',
      ),
    ).replace(/[()]/g, '');
    const imageUrl = absoluteUrl(
      decodeHtmlEntities(attrValue(/<img\b[^>]*\bclass=["'][^"']*\bs-image\b[^"']*["'][^>]*\bsrc=["']([^"']+)["']/i, block) ?? ''),
      baseUrl,
    );
    const sales = extractAmazonSalesSignal(block);
    const badges = extractMarketplaceBadges(block);

    samples.push({
      title,
      productId: asin,
      ...(price ? { price } : {}),
      ...(rating ? { rating } : {}),
      ...(reviews ? { reviews } : {}),
      ...(sales ? { sales } : {}),
      url: new URL(`/dp/${asin}`, baseUrl).toString(),
      ...(imageUrl ? { imageUrl } : {}),
      imageUrls: collectImageUrlsFromHtml(block, baseUrl, 8),
      keywordTags: inferKeywordTags(title),
      ...(badges.length ? { badges } : {}),
      sponsored: /sponsored|赞助广告|广告/i.test(block),
    });
  }
  return samples;
}

function extractEtsyJsonLdSamples(html: string, baseUrl: string): Map<string, MarketSample> {
  const out = new Map<string, MarketSample>();
  const scriptRe = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const script of html.matchAll(scriptRe)) {
    const raw = script[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      continue;
    }
    for (const product of collectLdProductObjects(parsed)) {
      const url = absoluteUrl(pickLdString(product.url), baseUrl);
      const listingId = extractProductId('etsy', url ?? '');
      if (!url || !listingId || out.has(listingId)) continue;
      const title = cleanExtractedText(pickLdString(product.name));
      if (!title) continue;
      const images = pickLdStringArray(product.image)
        .map((img) => absoluteUrl(img, baseUrl))
        .filter((img): img is string => Boolean(img));
      const offers = firstObject(product.offers);
      const price = offers ? formatLdPrice(offers) : undefined;
      const aggregate = firstObject(product.aggregateRating);
      out.set(listingId, {
        title,
        productId: listingId,
        url,
        ...(price ? { price } : {}),
        ...(pickLdBrand(product.brand) ? { brand: pickLdBrand(product.brand) } : {}),
        ...(cleanExtractedText(pickLdString(product.category)) ? { category: cleanExtractedText(pickLdString(product.category)) } : {}),
        ...(cleanExtractedText(pickLdString(aggregate?.ratingValue)) ? { rating: cleanExtractedText(pickLdString(aggregate?.ratingValue)) } : {}),
        ...(cleanExtractedText(pickLdString(aggregate?.reviewCount, aggregate?.ratingCount)) ? { reviews: cleanExtractedText(pickLdString(aggregate?.reviewCount, aggregate?.ratingCount)) } : {}),
        ...(images[0] ? { imageUrl: images[0] } : {}),
        ...(images.length ? { imageUrls: dedupeImageUrls(images, baseUrl) } : {}),
        keywordTags: inferKeywordTags(title),
      });
    }
  }
  return out;
}

function collectLdProductObjects(node: unknown): Array<Record<string, unknown>> {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectLdProductObjects(item));
  if (typeof node !== 'object') return [];
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type : [type];
  const products: Array<Record<string, unknown>> = [];
  if (types.some((entry) => typeof entry === 'string' && /product/i.test(entry))) {
    products.push(obj);
  }
  if (Array.isArray(obj.itemListElement)) {
    for (const entry of obj.itemListElement) {
      if (!entry || typeof entry !== 'object') continue;
      const item = (entry as Record<string, unknown>).item;
      products.push(...collectLdProductObjects(item));
    }
  }
  if (Array.isArray(obj['@graph'])) {
    products.push(...collectLdProductObjects(obj['@graph']));
  }
  return products;
}

function pickLdString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      const nested = pickLdString(...value);
      if (nested) return nested;
    }
  }
  return undefined;
}

function pickLdStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => pickLdStringArray(item));
  }
  const single = pickLdString(value);
  return single ? [single] : [];
}

function firstObject(value: unknown): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object'
    ? candidate as Record<string, unknown>
    : undefined;
}

function pickLdBrand(value: unknown): string | undefined {
  if (typeof value === 'string') return cleanExtractedText(value);
  const obj = firstObject(value);
  return obj ? cleanExtractedText(pickLdString(obj.name)) : undefined;
}

function formatLdPrice(offer: Record<string, unknown>): string | undefined {
  const price = cleanExtractedText(pickLdString(offer.price, firstObject(offer.priceSpecification)?.price));
  if (!price) return undefined;
  const currency = cleanExtractedText(pickLdString(offer.priceCurrency, firstObject(offer.priceSpecification)?.priceCurrency));
  if (!currency) return price;
  if (/^[A-Z]{3}$/.test(currency)) return `${currency} ${price}`;
  return `${currency}${price}`.replace(/\s+/g, '');
}

function extractEtsySamples(html: string, baseUrl: string, max: number): MarketSample[] {
  const samples: MarketSample[] = [];
  const seen = new Set<string>();
  const structuredById = extractEtsyJsonLdSamples(html, baseUrl);
  const linkPattern = /href\s*=\s*["']([^"']*\/listing\/(\d+)[^"']*)["']/gi;

  for (const match of html.matchAll(linkPattern)) {
    if (samples.length >= max) break;
    const rawHref = match[1];
    const listingId = match[2];
    if (!listingId || seen.has(listingId)) continue;
    const url = absoluteUrl(decodeHtmlEntities(rawHref), baseUrl);
    if (!url) continue;
    const index = match.index ?? 0;
    const block = sliceEtsyListingCardBlock(html, index, listingId);
    const structured = structuredById.get(listingId);
    const title = extractEtsyTitle(block, url) ?? structured?.title;
    if (!title || title.length < 4) continue;

    const imageUrls = dedupeImageUrls(
      [...collectImageUrlsFromHtml(block, baseUrl, 12), ...(structured?.imageUrls ?? [])],
      baseUrl,
    ).slice(0, 12);
    const price = extractEtsyPrice(block) ?? structured?.price;
    const rating = extractEtsyRating(block);
    const reviews = extractEtsyReviews(block);
    const sales = extractMarketplaceSalesSignal('etsy', block);
    const brand = extractEtsyShopNameFromBlock(block) ?? structured?.brand;
    const category = structured?.category;
    const sponsored = isSponsoredEtsyBlock(block);
    const badges = extractEtsyBadges(block);
    const heat = scoreEtsyHotness({
      block,
      rank: samples.length + 1,
      rating,
      reviews,
      badges,
      sponsored,
    });

    seen.add(listingId);
    samples.push({
      title,
      productId: listingId,
      ...(price ? { price } : {}),
      ...(rating ? { rating } : {}),
      ...(reviews ? { reviews } : {}),
      ...(sales ? { sales } : {}),
      ...(brand ? { brand } : {}),
      ...(category ? { category } : {}),
      url,
      ...(imageUrls[0] ? { imageUrl: imageUrls[0] } : {}),
      ...(imageUrls.length ? { imageUrls } : {}),
      keywordTags: inferKeywordTags(title),
      ...(badges.length ? { badges } : {}),
      sponsored: heat.sponsored,
      heatScore: heat.score,
      heatLevel: heat.level,
      heatConfidence: heat.confidence,
      heatReasons: heat.reasons,
    });
  }

  if (samples.length > 0) return samples;
  return Array.from(structuredById.values()).slice(0, max);
}

function sliceEtsyListingCardBlock(html: string, index: number, listingId: string): string {
  const start = findEtsyListingCardStart(html, index, listingId);
  if (start == null) return sliceMarketplaceCardBlock(html, index);
  const next = findNextEtsyListingCardStart(html, start + 500, listingId);
  const end = next && next > start ? next : Math.min(html.length, start + 40_000);
  return html.slice(start, end);
}

function findEtsyListingCardStart(html: string, index: number, listingId: string): number | null {
  const lower = html.toLowerCase();
  const windowStart = Math.max(0, index - 30_000);
  const before = lower.slice(windowStart, index);
  const markers = [
    'data-behat-listing-card',
    `data-palette-listing-id="${listingId.toLowerCase()}"`,
    `data-listing-id="${listingId.toLowerCase()}" data-page-type="search"`,
  ];
  const markerAt = Math.max(...markers.map((marker) => before.lastIndexOf(marker)));
  if (markerAt < 0) return null;
  const markerIndex = windowStart + markerAt;
  const openDiv = lower.lastIndexOf('<div', markerIndex);
  const openLi = lower.lastIndexOf('<li', markerIndex);
  const start = Math.max(openDiv, openLi);
  return start >= windowStart ? start : null;
}

function findNextEtsyListingCardStart(html: string, from: number, currentListingId: string): number | null {
  const nextPattern = /data-palette-listing-id=["'](\d+)["']|data-behat-listing-card/gi;
  nextPattern.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = nextPattern.exec(html)) != null) {
    if (match[1] && match[1] === currentListingId) continue;
    const start = html.toLowerCase().lastIndexOf('<div', match.index);
    if (start >= 0) return start;
  }
  return null;
}

function sliceMarketplaceCardBlock(html: string, index: number): string {
  const windowStart = Math.max(0, index - 6000);
  const before = html.slice(windowStart, index);
  const startCandidates = ['<li', '<article', '<div'];
  const relativeStart =
    Math.max(...startCandidates.map((tag) => before.toLowerCase().lastIndexOf(tag))) || 0;
  const start = windowStart + Math.max(0, relativeStart);
  const closingLi = html.toLowerCase().indexOf('</li>', index);
  const closingArticle = html.toLowerCase().indexOf('</article>', index);
  const endCandidates = [closingLi > -1 ? closingLi + 5 : -1, closingArticle > -1 ? closingArticle + 10 : -1]
    .filter((value) => value > index && value - index < 20_000);
  const end = endCandidates.length ? Math.min(...endCandidates) : Math.min(html.length, index + 12_000);
  return html.slice(start, end);
}

function extractEtsyTitle(block: string, url: string): string | undefined {
  const candidates = [
    attrValue(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i, block),
    attrValue(/<img\b[^>]*\balt=["']([^"']+)["']/i, block),
    attrValue(/\baria-label=["']([^"']+)["']/i, block),
    attrValue(/\btitle=["']([^"']+)["']/i, block),
    etsyTitleFromUrl(url),
  ];
  for (const candidate of candidates) {
    const text = cleanEtsyTitleCandidate(candidate);
    if (text) return text;
  }
  return undefined;
}

function cleanEtsyTitleCandidate(value: string | undefined): string | undefined {
  const text = cleanExtractedText(decodeHtmlEntities(stripTags(value ?? '')))
    ?.replace(/^Ad by\s+[^.。|]+[.|]?\s*/i, '')
    .replace(/\s+Add to Favorites\s*$/i, '')
    .trim();
  if (!text || text.length < 4) return undefined;
  const lower = text.toLowerCase();
  if (
    lower.includes('add to favorites') ||
    lower.includes('star seller') ||
    lower.includes('out of 5 stars') ||
    lower === 'etsy' ||
    lower === 'loading'
  ) {
    return undefined;
  }
  return text;
}

function etsyTitleFromUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const slug = /\/listing\/\d+\/([^/?#]+)/i.exec(url.pathname)?.[1];
    if (!slug) return undefined;
    return decodeURIComponent(slug).replace(/[-_]+/g, ' ');
  } catch {
    return undefined;
  }
}

function extractEtsyShopNameFromBlock(block: string): string | undefined {
  const candidates = [
    attrValue(/\bdata-shop-url=["'][^"']*\/shop\/([^"'/?#]+)[^"']*["']/i, block),
    attrValue(/<span\b[^>]*\bdata-seller-name-link\b[^>]*>([\s\S]*?)<\/span>/i, block),
    attrValue(/<a\b[^>]*href=["'][^"']*\/shop\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i, block),
    attrValue(/Made by\s*<strong\b[^>]*>([\s\S]*?)<\/strong>/i, block),
  ];
  for (const candidate of candidates) {
    const value = cleanExtractedText(decodeHtmlEntities(stripTags(candidate ?? '')))
      ?.replace(/^Ad\s*[·・]\s*By\s+/i, '')
      .trim();
    if (value && !/^etsy$/i.test(value)) return value;
  }
  return undefined;
}

function extractEtsyBadges(block: string): string[] {
  const badgeOnlyHtml = block
    .replace(/<h3\b[\s\S]*?<\/h3>/gi, ' ')
    .replace(/\b(?:alt|title|aria-label)\s*=\s*["'][^"']*["']/gi, ' ');
  return extractMarketplaceBadges(badgeOnlyHtml);
}

function extractEtsyPrice(block: string): string | undefined {
  const symbol = cleanExtractedText(
    decodeHtmlEntities(
      attrValue(/<span\b[^>]*\bclass=["'][^"']*\bcurrency-symbol\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i, block)
        ?? '',
    ),
  );
  const value = cleanExtractedText(
    decodeHtmlEntities(
      attrValue(/<span\b[^>]*\bclass=["'][^"']*\bcurrency-value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i, block)
        ?? '',
    ),
  );
  if (value) return `${symbol ?? '$'}${value}`.replace(/\s+/g, '');

  const text = cleanText(decodeHtmlEntities(stripTags(block)));
  return /(?:US\$|CA\$|AU\$|\$|€|£)\s?\d[\d,.]*(?:\.\d{2})?/.exec(text)?.[0]?.trim()
    ?? /\d[\d,.]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|CAD|AUD)\b/i.exec(text)?.[0]?.trim();
}

function extractEtsyRating(block: string): string | undefined {
  const text = cleanText(decodeHtmlEntities(stripTags(block)));
  return attrValue(/\baria-label=["']([0-5](?:\.\d+)?)\s*out of\s*5\s*stars/i, block)
    ?? attrValue(/\baria-label=["']([0-5](?:\.\d+)?)\s*star rating\b/i, block)
    ?? /([0-5](?:\.\d+)?)\s*out of\s*5\s*stars/i.exec(text)?.[1]
    ?? /([0-5](?:\.\d+)?)\s*star rating\b/i.exec(text)?.[1];
}

function extractEtsyReviews(block: string): string | undefined {
  const text = cleanText(decodeHtmlEntities(stripTags(block)));
  return attrValue(/\baria-label=["'][^"']*?\bwith\s+([\d,.]+[KkMm]?)\s+reviews?\b/i, block)
    ?? /([\d,.]+[KkMm]?)\s+reviews?\b/i.exec(text)?.[1]
    ?? /\(([\d,.]+[KkMm]?)\)/.exec(text)?.[1];
}

function isSponsoredEtsyBlock(block: string): boolean {
  const text = cleanText(decodeHtmlEntities(stripTags(block)));
  return /\bAd by\b|\bSponsored\b/i.test(text);
}

function scoreEtsyHotness(args: {
  block: string;
  rank: number;
  rating?: string;
  reviews?: string;
  badges: string[];
  sponsored: boolean;
}): {
  score: number;
  level: string;
  confidence: string;
  reasons: string[];
  sponsored: boolean;
} {
  const text = cleanText(decodeHtmlEntities(stripTags(args.block)));
  const reasons: string[] = [];
  let score = 0;

  if (!args.sponsored && args.rank <= 3) {
    score += 25;
    reasons.push(`自然排名 #${args.rank}`);
  } else if (!args.sponsored && args.rank <= 10) {
    score += 20;
    reasons.push(`自然排名 #${args.rank}`);
  } else if (!args.sponsored && args.rank <= 20) {
    score += 12;
    reasons.push(`自然排名 #${args.rank}`);
  }

  if (args.badges.some((badge) => /bestseller/i.test(badge))) {
    score += 30;
    reasons.push('Etsy 显示 Bestseller');
  }
  if (args.badges.some((badge) => /popular now/i.test(badge))) {
    score += 18;
    reasons.push('Etsy 显示 Popular now');
  }
  if (args.badges.some((badge) => /in carts/i.test(badge))) {
    score += 12;
    reasons.push('有购物车热度提示');
  }

  const recentViews = parseCountSignal(/([\d,.]+[KkMm]?)\+?\s+views?\s+in\s+(?:the\s+)?(?:last|past)\s+24\s+hours?/i, text);
  if (recentViews != null) {
    const bonus = recentViews >= 100 ? 16 : recentViews >= 20 ? 12 : 8;
    score += bonus;
    reasons.push(`24 小时浏览 ${formatCountForReason(recentViews)}`);
  }

  const carts = parseCountSignal(/(?:in|inside)\s+([\d,.]+[KkMm]?)\+?\s+(?:people'?s\s+)?carts?/i, text)
    ?? parseCountSignal(/([\d,.]+[KkMm]?)\+?\s+(?:people\s+)?(?:have|has)\s+this\s+in\s+(?:their\s+)?carts?/i, text);
  if (carts != null) {
    score += carts >= 20 ? 14 : 9;
    reasons.push(`${formatCountForReason(carts)} 人加购`);
  }

  const favorites = parseCountSignal(/([\d,.]+[KkMm]?)\+?\s+favorites?/i, text)
    ?? parseCountSignal(/favorited\s+by\s+([\d,.]+[KkMm]?)\+?/i, text);
  if (favorites != null) {
    const bonus = favorites >= 1000 ? 10 : favorites >= 200 ? 7 : favorites >= 50 ? 4 : 2;
    score += bonus;
    reasons.push(`收藏 ${formatCountForReason(favorites)}`);
  }

  const reviews = parseCompactCount(args.reviews);
  if (reviews != null) {
    const bonus = reviews >= 1000 ? 15 : reviews >= 300 ? 12 : reviews >= 100 ? 9 : reviews >= 30 ? 5 : 2;
    score += bonus;
    reasons.push(`评论 ${formatCountForReason(reviews)}`);
  }

  const rating = args.rating ? Number(args.rating) : NaN;
  if (Number.isFinite(rating)) {
    if (rating >= 4.8) {
      score += 8;
      reasons.push(`评分 ${rating.toFixed(1)}`);
    } else if (rating >= 4.6) {
      score += 6;
      reasons.push(`评分 ${rating.toFixed(1)}`);
    } else if (rating >= 4.3) {
      score += 3;
      reasons.push(`评分 ${rating.toFixed(1)}`);
    } else {
      score -= 12;
      reasons.push(`评分偏低 ${rating.toFixed(1)}`);
    }
  }

  if (args.sponsored) {
    score -= 10;
    reasons.push('广告位降权');
  }

  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  const strongSignals = args.badges.some((badge) => /bestseller|popular now|in carts/i.test(badge))
    || recentViews != null
    || carts != null;
  const evidenceCount = [
    !args.sponsored && args.rank <= 20,
    strongSignals,
    reviews != null,
    Number.isFinite(rating),
    favorites != null,
  ].filter(Boolean).length;
  const confidence =
    strongSignals || evidenceCount >= 4
      ? '高'
      : evidenceCount >= 2
        ? '中'
        : '低';
  const level =
    normalized >= 70
      ? '强'
      : normalized >= 45
        ? '中'
        : normalized >= 20
          ? '弱'
          : '证据不足';

  return {
    score: normalized,
    level,
    confidence,
    reasons: reasons.length ? reasons.slice(0, 8) : ['缺少可见热销信号'],
    sponsored: args.sponsored,
  };
}

function extractMarketplaceSalesSignal(source: string, block: string): string | undefined {
  if (source.startsWith('amazon')) return extractAmazonSalesSignal(block);
  const text = cleanText(decodeHtmlEntities(stripTags(block)));
  const match =
    /(?:[0-9][\d,.]*\s*[KkMm]?\+?\s+(?:sales|sold|orders)|sold\s+[0-9][\d,.]*\s*[KkMm]?\+?|已售\s*[0-9][\d,.万千]*\+?|销量\s*[0-9][\d,.万千]*\+?|[0-9][\d,.万千]*\+?\s*(?:人)?(?:已买|购买|售出))/i.exec(text);
  return match?.[0]?.trim();
}

function extractAmazonSalesSignal(block: string): string | undefined {
  const text = cleanText(decodeHtmlEntities(stripTags(block)));
  const match =
    /(?:[0-9][\d,.]*\s*[KkMm]?\+?\s+(?:bought|sold|purchased)\s+(?:in|over)\s+(?:the\s+)?(?:past|last)\s+(?:month|30\s*days)|[0-9][\d,.]*\s*[KkMm]?\+?\s+people\s+(?:bought|purchased)\s+(?:in|over)\s+(?:the\s+)?(?:past|last)\s+(?:month|30\s*days)|过去\s*(?:一个月|30\s*天)\s*(?:购买|售出)\s*[0-9][\d,.万千]*\+?|[0-9][\d,.万千]*\+?\s*(?:人)?(?:过去一个月|近一个月|30\s*天内)(?:购买|售出))/i.exec(text);
  return match?.[0]?.trim();
}

function extractMarketplaceBadges(block: string): string[] {
  const text = cleanText(decodeHtmlEntities(stripTags(block)));
  const badges: string[] = [];
  if (/\bBest Seller\b|畅销商品|最畅销/i.test(text)) badges.push('Best Seller');
  if (/\bBestseller\b/i.test(text)) badges.push('Bestseller');
  if (/Amazon'?s Choice|亚马逊之选/i.test(text)) badges.push('Amazon Choice');
  if (/Limited time deal|限时优惠/i.test(text)) badges.push('Limited time deal');
  if (/Popular item/i.test(text)) badges.push('Popular item');
  if (/Popular now/i.test(text)) badges.push('Popular now');
  if (/\bin\s+\d[\d,.]*\+?\s+carts?\b|\d[\d,.]*\+?\s+people\s+have\s+this\s+in\s+their\s+carts?/i.test(text)) {
    badges.push('In carts');
  }
  return uniqueLocalStrings(badges).slice(0, 8);
}

function parseCountSignal(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  return parseCompactCount(match[1]);
}

function parseCompactCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/,/g, '').trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(normalized);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[2] === 'm') return Math.round(base * 1_000_000);
  if (match[2] === 'k') return Math.round(base * 1_000);
  return Math.round(base);
}

function formatCountForReason(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M+`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K+`;
  return `${value}`;
}

function cleanExtractedText(value: string | null | undefined): string | undefined {
  const text = cleanText(String(value ?? ''));
  if (!text) return undefined;
  const normalized = text
    .toLowerCase()
    .replace(/[。.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'none' ||
    normalized === 'null' ||
    normalized === 'undefined' ||
    normalized === 'unknown' ||
    normalized.startsWith('not visible') ||
    normalized.startsWith('not provided') ||
    normalized.startsWith('not available') ||
    normalized.startsWith('not found') ||
    normalized.includes('in provided html')
  ) {
    return undefined;
  }
  return text;
}

function cleanExtractedList(items: string[] | null | undefined): string[] {
  return uniqueLocalStrings(
    (items ?? [])
      .map((item) => cleanExtractedText(item))
      .filter((item): item is string => Boolean(item)),
  );
}

function uniqueLocalStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function inferKeywordTags(title: string): string[] {
  const stopWords = new Set(['with', 'from', 'for', 'and', 'the', 'this', 'that', 'your', 'case', 'cover']);
  return Array.from(
    new Set(
      title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 4 && !stopWords.has(word)),
    ),
  ).slice(0, 8);
}

function attrValue(pattern: RegExp, input: string): string | undefined {
  return pattern.exec(input)?.[1]?.trim();
}

function stripTags(input: string): string {
  return input.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function cleanAmazonTitle(input: string): string {
  return cleanText(input).replace(/^赞助广告[-\s]*/i, '').trim();
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

interface HtmlDiagnostics {
  finalUrl: string;
  title: string;
  htmlLength: number;
  textLength: number;
  textPreview: string;
}

interface SnapshotContext {
  source: string;
  url: string;
  fetchedVia: 'browser' | 'server-fetch';
  browserContextId?: string;
}

function buildHtmlDiagnostics(html: string, fallbackUrl: string): HtmlDiagnostics {
  const title = decodeHtmlEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyHtml = bodyMatch?.[1] ?? html;
  const text = decodeHtmlEntities(bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
  return {
    finalUrl: extractCanonicalUrl(html) ?? fallbackUrl,
    title,
    htmlLength: html.length,
    textLength: text.length,
    textPreview: text.slice(0, 300),
  };
}

function extractCanonicalUrl(html: string): string | null {
  const match = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(html);
  return match?.[1]?.trim() || null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (entity: string, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/&#(\d+);/g, (entity: string, code: string) => {
      const codePoint = Number.parseInt(code, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    });
}

function withDiagnostics(
  reason: string,
  opts: ExtractOpts,
  diagnostics: HtmlDiagnostics,
  html: string,
): string {
  const snapshotPath = writeDebugSnapshot(opts, diagnostics, html);
  const parts = [
    reason,
    `抓取方式=${opts.fetchedVia}`,
    opts.browserContextId ? `浏览器=${opts.browserContextId}` : null,
    `最终URL=${diagnostics.finalUrl}`,
    diagnostics.title ? `标题=${diagnostics.title}` : '标题=空',
    `HTML=${diagnostics.htmlLength}字节`,
    `正文=${diagnostics.textLength}字`,
    diagnostics.textPreview ? `预览=${diagnostics.textPreview}` : '预览=空',
    snapshotPath ? `调试快照=${snapshotPath}` : null,
  ].filter(Boolean);
  return parts.join('；');
}

function withDetailDiagnostics(
  reason: string,
  args: { source: string; url: string; rank: number; browserContextId?: string },
  fetchedVia: 'browser' | 'server-fetch',
  html: string,
  finalUrl: string,
  imageCandidateCount: number,
): string {
  const diagnostics = buildHtmlDiagnostics(html, finalUrl);
  const snapshotPath = writeDebugSnapshot({
    source: `${args.source}-detail-${args.rank}`,
    url: args.url,
    fetchedVia,
    browserContextId: args.browserContextId,
  }, diagnostics, html);
  const parts = [
    reason,
    `详情排名=#${args.rank}`,
    `抓取方式=${fetchedVia}`,
    args.browserContextId ? `浏览器=${args.browserContextId}` : null,
    `最终URL=${diagnostics.finalUrl}`,
    diagnostics.title ? `标题=${diagnostics.title}` : '标题=空',
    `HTML=${diagnostics.htmlLength}字节`,
    `正文=${diagnostics.textLength}字`,
    `图片候选=${imageCandidateCount}`,
    diagnostics.textPreview ? `预览=${diagnostics.textPreview}` : '预览=空',
    snapshotPath ? `调试快照=${snapshotPath}` : null,
  ].filter(Boolean);
  return parts.join('；');
}

function writeDebugSnapshot(
  opts: SnapshotContext,
  diagnostics: HtmlDiagnostics,
  html: string,
): string | null {
  try {
    const base = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
    const dir = path.join(base, 'logs', 'ecommerce-discover');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeSource = opts.source.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const file = path.join(dir, `${stamp}-${safeSource}.html`);
    const header = [
      '<!--',
      `source: ${opts.source}`,
      `url: ${opts.url}`,
      `finalUrl: ${diagnostics.finalUrl}`,
      `fetchedVia: ${opts.fetchedVia}`,
      `browserContextId: ${opts.browserContextId ?? ''}`,
      `title: ${diagnostics.title}`,
      `htmlLength: ${diagnostics.htmlLength}`,
      `textLength: ${diagnostics.textLength}`,
      `textPreview: ${diagnostics.textPreview}`,
      '-->',
      '',
    ].join('\n');
    fs.writeFileSync(file, header + html, 'utf8');
    return file;
  } catch {
    return null;
  }
}

function sliceForLlm(html: string): string {
  // Cheap clean: strip <script>...</script> and <style>...</style> blocks.
  let out = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  // Strip HTML comments
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  // Collapse runs of whitespace
  out = out.replace(/\s+/g, ' ');
  // Try to keep just the body content if obvious.
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(out);
  if (bodyMatch) out = bodyMatch[1];
  // Cap length so we don't send 500KB to the LLM.
  const MAX = 50_000;
  if (out.length > MAX) out = out.slice(0, MAX);
  return out.trim();
}

/**
 * Build platform-specific search URLs for a given keyword + market.
 * Mirrors the templates baked into the discover system prompt so the
 * fetcher uses the exact same canonical URLs the LLM would have referenced.
 */
export function buildPlatformSearchUrl(
  platform: string,
  keyword: string,
): { source: string; url: string; acceptLanguage: string } | null {
  const q = encodeURIComponent(keyword);
  switch (platform) {
    case 'amazon':
    case 'amazon-us':
      return { source: 'amazon-us', url: `https://www.amazon.com/s?k=${q}`, acceptLanguage: 'en-US,en;q=0.9' };
    case 'amazon-uk':
      return { source: 'amazon-uk', url: `https://www.amazon.co.uk/s?k=${q}`, acceptLanguage: 'en-GB,en;q=0.9' };
    case 'amazon-jp':
      return { source: 'amazon-jp', url: `https://www.amazon.co.jp/s?k=${q}`, acceptLanguage: 'ja,en;q=0.5' };
    case 'amazon-de':
      return { source: 'amazon-de', url: `https://www.amazon.de/s?k=${q}`, acceptLanguage: 'de,en;q=0.5' };
    case 'etsy':
      return { source: 'etsy', url: `https://www.etsy.com/search?q=${q}`, acceptLanguage: 'en-US,en;q=0.9' };
    case 'walmart':
      return { source: 'walmart', url: `https://www.walmart.com/search?q=${q}`, acceptLanguage: 'en-US,en;q=0.9' };
    case 'tiktok-shop':
    case 'tiktok-shop-us':
      return { source: 'tiktok-shop-us', url: `https://shop.tiktok.com/view/search?q=${q}`, acceptLanguage: 'en-US,en;q=0.9' };
    default:
      return null;
  }
}
