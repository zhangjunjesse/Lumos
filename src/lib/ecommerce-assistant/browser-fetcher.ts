import {
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
} from '@/lib/browser-runtime/bridge-client';
import { normalizeBrowserContextId } from '@/lib/browser-provider/labels';
import type { BrowserFetchSettings } from './discover-settings';

export interface BrowserFetchResult {
  url: string;
  title: string;
  html: string;
  elapsedMs: number;
  browserContextId: string;
  pageId: string;
}

export class BrowserFetchError extends Error {
  constructor(
    message: string,
    public readonly stage: 'connect' | 'open' | 'evaluate' | 'parse',
  ) {
    super(message);
    this.name = 'BrowserFetchError';
  }
}

interface BridgePageMutationResponse extends BrowserBridgeResponse {
  pageId?: string;
}

interface BridgePageEvaluateResponse extends BrowserBridgeResponse {
  pageId?: string;
  value?: unknown;
  result?: unknown;
}

interface CapturedHtml {
  url: string;
  title: string;
  html: string;
  productImageUrls: string[];
  readyState: string;
  bodyHtmlLength: number;
  bodyTextLength: number;
  bodyChildCount: number;
}

const DEFAULT_BROWSER_FETCH_TIMEOUT_MS = 90_000;
const BROWSER_FETCH_LOCK_OWNER = 'ecommerce-discover';
const HTML_CAPTURE_POLL_MS = 750;
const HTML_MIN_SETTLE_MS = 12_000;
const MARKETPLACE_PRODUCT_WAIT_MS = 45_000;
const ETSY_INTERSTITIAL_GRACE_MS = 20_000;
// Keep marketplace research non-interruptive by default. If a platform only
// renders useful content in a focused tab, fail with diagnostics instead of
// stealing the user's foreground browser window.
const MARKETPLACE_FETCH_BACKGROUND = true;
const HTML_CAPTURE_EXPRESSION = `(() => {
  const imageUrls = [];
  const add = (value) => {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    imageUrls.push(trimmed);
  };
  const addSrcSet = (value) => {
    if (!value || typeof value !== 'string') return;
    for (const part of value.split(',')) {
      add(part.trim().split(/\\s+/)[0]);
    }
  };
  const selectors = [
    'img',
    'source',
    '[style*="background"]',
    '[data-src]',
    '[data-srcset]',
    '[data-src-zoom-image]',
    '[data-full-image-href]',
    '[data-zoom-image]',
    '[data-large-image]',
    '[data-preload-lp-src]',
    '[data-preload-lp-srcset]',
    '[data-image]',
    '[data-image-url]',
    '[data-full-image]',
    '[data-thumbnail]',
    '[data-palette-image]'
  ].join(',');
  for (const el of document.querySelectorAll(selectors)) {
    add(el.currentSrc);
    add(el.src);
    addSrcSet(el.srcset);
    add(el.getAttribute('src'));
    addSrcSet(el.getAttribute('srcset'));
    add(el.getAttribute('data-src'));
    addSrcSet(el.getAttribute('data-srcset'));
    add(el.getAttribute('data-src-zoom-image'));
    add(el.getAttribute('data-full-image-href'));
    add(el.getAttribute('data-zoom-image'));
    add(el.getAttribute('data-large-image'));
    add(el.getAttribute('data-preload-lp-src'));
    addSrcSet(el.getAttribute('data-preload-lp-srcset'));
    add(el.getAttribute('data-image'));
    add(el.getAttribute('data-image-url'));
    add(el.getAttribute('data-full-image'));
    add(el.getAttribute('data-thumbnail'));
    add(el.getAttribute('data-palette-image'));
    const style = el.getAttribute('style') || '';
    for (const match of style.matchAll(/url\\(["']?([^"')]+)["']?\\)/gi)) add(match[1]);
    for (const attr of Array.from(el.attributes || [])) {
      const value = attr && typeof attr.value === 'string' ? attr.value : '';
      if (/etsystatic\\.com|https?:\\/\\/|\\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(value)) {
        if (/srcset/i.test(attr.name)) addSrcSet(value);
        else add(value);
      }
    }
  }
  return {
    url: window.location.href,
    title: document.title || '',
    readyState: document.readyState || '',
    bodyHtmlLength: document.body ? (document.body.innerHTML || '').length : 0,
    bodyTextLength: document.body ? (document.body.innerText || '').trim().length : 0,
    bodyChildCount: document.body ? document.body.childElementCount : 0,
    productImageUrls: Array.from(new Set(imageUrls)).slice(0, 120),
    html: document.documentElement ? document.documentElement.outerHTML : ''
  };
})()`;

function parseCaptureValue(value: unknown): CapturedHtml {
  if (!value || typeof value !== 'object') {
    throw new BrowserFetchError('浏览器返回的页面内容为空。', 'parse');
  }
  const record = value as Record<string, unknown>;
  const html = typeof record.html === 'string' ? record.html : '';
  if (!html.trim()) {
    throw new BrowserFetchError('浏览器未返回 HTML 内容。', 'parse');
  }
  const bodyHtml = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? '';
  const fallbackBodyTextLength = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  return {
    url: typeof record.url === 'string' && record.url.trim() ? record.url : '',
    title: typeof record.title === 'string' ? record.title : '',
    html,
    productImageUrls: Array.isArray(record.productImageUrls)
      ? record.productImageUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    readyState: typeof record.readyState === 'string' ? record.readyState : '',
    bodyHtmlLength: typeof record.bodyHtmlLength === 'number' ? record.bodyHtmlLength : bodyHtml.length,
    bodyTextLength: typeof record.bodyTextLength === 'number' ? record.bodyTextLength : fallbackBodyTextLength,
    bodyChildCount: typeof record.bodyChildCount === 'number' ? record.bodyChildCount : 0,
  };
}

function isUsefulCapture(capture: CapturedHtml, elapsedMs: number): boolean {
  if (isEtsyListingPage(capture)) {
    const imageCount = countEtsyImageSignals(capture);
    if (imageCount >= 3) return true;
    if (elapsedMs < MARKETPLACE_PRODUCT_WAIT_MS) return false;
    return capture.bodyTextLength >= 500 && imageCount >= 1;
  }
  const marketplace = isMarketplacePage(capture);
  if (marketplace && hasMarketplaceProductMarkers(capture.html)) return true;
  if (marketplace && capture.bodyTextLength < 2_000) return false;
  if (capture.bodyTextLength >= 200) return true;
  if (capture.bodyHtmlLength >= 2_000 && capture.bodyChildCount > 0) return true;
  if (hasMarketplaceProductMarkers(capture.html)) return true;
  return false;
}

function isKnownInterstitial(capture: CapturedHtml): boolean {
  return /bm-verify|\/_sec\/verify\?provider=interstitial|akamai|captcha|robot check|type the characters you see/i
    .test(capture.html);
}

function isMarketplacePage(capture: CapturedHtml): boolean {
  return /amazon\.|etsy\.|walmart\./i.test(capture.url) || /Amazon\.|Etsy|Walmart/i.test(capture.title);
}

function hasMarketplaceProductMarkers(html: string): boolean {
  return /data-component-type=["']s-search-result["']|data-asin=["'][A-Z0-9]{10}["']|s-result-item|product-card|product-title|data-behat-listing-card|data-listing-card-v2|\/listing\/\d+/i
    .test(html);
}

function isEtsyListingPage(capture: CapturedHtml): boolean {
  return /(^|\/\/)(?:www\.)?etsy\.com\/listing\/\d+/i.test(capture.url);
}

function countEtsyImageSignals(capture: CapturedHtml): number {
  const urls = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    const normalized = value.replace(/\\\//g, '/');
    const matches = normalized.match(/https?:\/\/[^"'\\\s<>]+etsystatic\.com[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi) ?? [];
    for (const match of matches) urls.add(match.replace(/&amp;/g, '&'));
  };
  for (const url of capture.productImageUrls) add(url);
  add(capture.html);
  return urls.size;
}

function shouldKeepWaitingForEtsyGallery(capture: CapturedHtml, elapsedMs: number): boolean {
  return isEtsyListingPage(capture)
    && countEtsyImageSignals(capture) < 3
    && elapsedMs < MARKETPLACE_PRODUCT_WAIT_MS;
}

function shouldReturnKnownInterstitial(capture: CapturedHtml, elapsedMs: number): boolean {
  if (!isKnownInterstitial(capture)) return false;
  if (isEtsyListingPage(capture) && elapsedMs < ETSY_INTERSTITIAL_GRACE_MS) return false;
  return elapsedMs >= 3_000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

async function captureRenderedHtml(
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
  pageId: string,
  opts: { timeoutMs: number; abortSignal?: AbortSignal },
): Promise<CapturedHtml> {
  const startedAt = Date.now();
  const deadline = Date.now() + opts.timeoutMs;
  let lastCapture: CapturedHtml | null = null;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const evaluated = await postToBrowserBridge<BridgePageEvaluateResponse>(
        config,
        '/v1/pages/evaluate',
        {
          pageId,
          expression: HTML_CAPTURE_EXPRESSION,
          background: MARKETPLACE_FETCH_BACKGROUND,
        },
        { signal: opts.abortSignal, timeoutMs: Math.min(30_000, Math.max(1_000, deadline - Date.now())) },
      );
      const capture = parseCaptureValue(evaluated.value ?? evaluated.result);
      lastCapture = capture;
      const elapsedMs = Date.now() - startedAt;
      if (isUsefulCapture(capture, elapsedMs)) {
        return capture;
      }
      if (shouldReturnKnownInterstitial(capture, elapsedMs)) {
        return capture;
      }
      if (
        elapsedMs >= HTML_MIN_SETTLE_MS
        && capture.readyState === 'complete'
        && capture.html.length > 500
      ) {
        if (shouldKeepWaitingForEtsyGallery(capture, elapsedMs)) {
          await sleep(Math.min(HTML_CAPTURE_POLL_MS, Math.max(0, deadline - Date.now())), opts.abortSignal);
          continue;
        }
        if (isMarketplacePage(capture) && !hasMarketplaceProductMarkers(capture.html) && elapsedMs < MARKETPLACE_PRODUCT_WAIT_MS) {
          await sleep(Math.min(HTML_CAPTURE_POLL_MS, Math.max(0, deadline - Date.now())), opts.abortSignal);
          continue;
        }
        return capture;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(HTML_CAPTURE_POLL_MS, Math.max(0, deadline - Date.now())), opts.abortSignal);
  }

  if (lastCapture) return lastCapture;
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new BrowserFetchError('浏览器页面加载后没有返回可解析内容。', 'parse');
}

export async function fetchViaBrowser(
  url: string,
  settings: BrowserFetchSettings,
  opts: { timeoutMs?: number; abortSignal?: AbortSignal; closePage?: boolean } = {},
): Promise<BrowserFetchResult> {
  const browserContextId = normalizeBrowserContextId(settings.browserContextId);
  const config = resolveBrowserBridgeRuntimeConfig({
    browserContextId,
    lockOwnerId: BROWSER_FETCH_LOCK_OWNER,
  });
  if (!config) {
    throw new BrowserFetchError('Browser Bridge 未连接，请确认 Lumos 桌面端浏览器运行时已启动。', 'connect');
  }

  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BROWSER_FETCH_TIMEOUT_MS;
  let pageId: string | null = null;
  try {
    const created = await postToBrowserBridge<BridgePageMutationResponse>(
      config,
      '/v1/pages/new',
      { url, background: MARKETPLACE_FETCH_BACKGROUND },
      { signal: opts.abortSignal, timeoutMs },
    );
    pageId = typeof created.pageId === 'string' && created.pageId.trim() ? created.pageId : null;
    if (!pageId) {
      throw new BrowserFetchError('浏览器打开页面后没有返回 pageId。', 'open');
    }

    const capture = await captureRenderedHtml(config, pageId, {
      timeoutMs,
      abortSignal: opts.abortSignal,
    });
    return {
      url: capture.url || url,
      title: capture.title,
      html: appendCapturedImageHints(capture.html, capture.productImageUrls),
      elapsedMs: Date.now() - startedAt,
      browserContextId,
      pageId,
    };
  } catch (error) {
    if (error instanceof BrowserFetchError) {
      throw error;
    }
    throw new BrowserFetchError(error instanceof Error ? error.message : String(error), pageId ? 'evaluate' : 'open');
  } finally {
    try {
      if (pageId && opts.closePage !== false) {
        await closeBrowserBridgePage(config, pageId, opts.abortSignal).catch(() => undefined);
      }
    } finally {
      await releaseBrowserBridgeContext(config);
    }
  }
}

function appendCapturedImageHints(html: string, imageUrls: string[]): string {
  const clean = imageUrls
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 120);
  if (clean.length === 0) return html;
  return `${html}\n<script type="application/json" data-lumos-captured-images>${JSON.stringify(clean)}</script>`;
}

export async function closeBrowserFetchPage(
  result: Pick<BrowserFetchResult, 'pageId' | 'browserContextId'>,
  settings: BrowserFetchSettings,
): Promise<void> {
  const browserContextId = normalizeBrowserContextId(result.browserContextId || settings.browserContextId);
  const config = resolveBrowserBridgeRuntimeConfig({
    browserContextId,
    lockOwnerId: BROWSER_FETCH_LOCK_OWNER,
  });
  if (!config) return;
  try {
    await closeBrowserBridgePage(config, result.pageId);
  } finally {
    await releaseBrowserBridgeContext(config);
  }
}

async function closeBrowserBridgePage(
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
  pageId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  await postToBrowserBridge(
    config,
    '/v1/pages/close',
    { pageId, background: MARKETPLACE_FETCH_BACKGROUND },
    { signal: abortSignal, timeoutMs: 10_000 },
  );
}

async function releaseBrowserBridgeContext(
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
): Promise<void> {
  try {
    await postToBrowserBridge(
      config,
      '/v1/context/release',
      {},
      { timeoutMs: 10_000 },
    );
  } catch {
    // Releasing a best-effort automation lease must not hide the scrape result.
  }
}
