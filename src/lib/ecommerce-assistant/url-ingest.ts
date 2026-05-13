import { z } from 'zod';

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { getBrowserFetchSettings } from './discover-settings';
import { fetchViaBrowser, BrowserFetchError } from './browser-fetcher';
import { generateStructured, EcommerceLlmUnavailableError } from './llm-client';
import { persistImageBuffer } from './upload';
import {
  isParsedProductSufficient,
  parseProductFromHtml,
  type ParsedProduct,
} from './url-adapters';
import type { ProductInputRecord } from './types';

export interface IngestUrlResult {
  inputId: string;
  parsedProduct: ParsedProduct;
  adapterId: string;
  llmFallbackUsed: boolean;
  mainImageSavedFrom: string | null;
  galleryCount: number;
  warnings: string[];
}

export class UrlIngestError extends Error {
  constructor(
    message: string,
    public readonly stage: 'fetch' | 'parse' | 'image-download' | 'llm' | 'persist',
  ) {
    super(message);
    this.name = 'UrlIngestError';
  }
}

const MAX_GALLERY = 4;
const MAX_BULLETS = 6;

const llmFallbackSchema = z.object({
  title: z.string().min(2).max(300).nullable(),
  main_image: z.string().url().nullable(),
  gallery: z.array(z.string().url()).default([]),
  price: z.string().max(80).nullable(),
  bullets: z.array(z.string().min(1).max(320)).default([]),
  description: z.string().max(4000).nullable(),
  category: z.string().max(160).nullable(),
  brand: z.string().max(160).nullable(),
});

interface IngestOptions {
  url: string;
  store: AppDataStore;
  abortSignal?: AbortSignal;
  /** Override the persisted product title (e.g. user-provided). */
  titleOverride?: string;
}

/**
 * Pull a product from a public storefront URL into a `product_inputs` row.
 *
 * Pipeline:
 *   1. Fetch the page through the user's configured browser (AdsPower if set,
 *      embedded Chromium otherwise) — same code path as discover.
 *   2. Run a site-specific DOM adapter; fall through to a generic JSON-LD +
 *      OpenGraph parse.
 *   3. If structured fields are still missing (no main image / no bullets),
 *      run a single LLM pass over the cleaned HTML to fill the gaps.
 *   4. Download the main image (and up to 4 gallery shots) into the same
 *      uploads dir that manual uploads use, so downstream SOP code is
 *      oblivious to where the image came from.
 *   5. Persist a `product_inputs` row with everything ready to start a job.
 */
export async function ingestProductFromUrl(opts: IngestOptions): Promise<IngestUrlResult> {
  const warnings: string[] = [];
  const browser = getBrowserFetchSettings(opts.store);
  if (!browser.enabled) {
    throw new UrlIngestError(
      '浏览器抓取已关闭。请在「电商助手 → 选品 → 浏览器」打开抓取，否则无法读取商品 URL。',
      'fetch',
    );
  }

  const fetched = await fetchPageHtml(opts.url, browser, opts.abortSignal);
  const finalUrl = fetched.url || opts.url;

  const { product, adapter } = parseProductFromHtml(finalUrl, fetched.html);
  let parsed: ParsedProduct = product;
  let llmFallbackUsed = false;
  if (!isParsedProductSufficient(parsed)) {
    try {
      parsed = await fillFromLlm(parsed, fetched.html, finalUrl, opts.abortSignal);
      llmFallbackUsed = true;
    } catch (err) {
      if (err instanceof EcommerceLlmUnavailableError) {
        warnings.push(`LLM 兜底未启用：${err.message}`);
      } else {
        warnings.push(`LLM 兜底失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (!parsed.title) {
    throw new UrlIngestError('未能从该 URL 提取商品标题，可能是登录墙或反爬页。', 'parse');
  }
  if (!parsed.mainImage) {
    throw new UrlIngestError('未能从该 URL 提取主图（页面可能用了懒加载或 SPA 渲染）。', 'parse');
  }

  // Downloads run sequentially to avoid hammering the source domain.
  const mainSaved = await downloadProductImage(parsed.mainImage, finalUrl, opts.abortSignal);
  if (!mainSaved) {
    throw new UrlIngestError(`主图下载失败：${parsed.mainImage}`, 'image-download');
  }

  const galleryPaths: string[] = [];
  for (const url of dedupeKeepOrder(parsed.gallery, parsed.mainImage).slice(0, MAX_GALLERY)) {
    const saved = await downloadProductImage(url, finalUrl, opts.abortSignal);
    if (saved) galleryPaths.push(saved);
  }

  const note = buildNote(parsed, finalUrl, adapter.id, llmFallbackUsed);
  const created = opts.store.create<ProductInputRecord>('product_inputs', {
    title: opts.titleOverride?.trim() || parsed.title,
    category_hint: parsed.category ?? null,
    main_image_path: mainSaved,
    reference_image_paths: galleryPaths.length > 0 ? JSON.stringify(galleryPaths) : null,
    note,
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return {
    inputId: (created as { id: string }).id,
    parsedProduct: parsed,
    adapterId: adapter.id,
    llmFallbackUsed,
    mainImageSavedFrom: parsed.mainImage,
    galleryCount: galleryPaths.length,
    warnings,
  };
}

async function fetchPageHtml(
  url: string,
  browser: ReturnType<typeof getBrowserFetchSettings>,
  abortSignal?: AbortSignal,
): Promise<{ url: string; html: string }> {
  try {
    const out = await fetchViaBrowser(url, browser, { abortSignal });
    return { url: out.url || url, html: out.html };
  } catch (err) {
    if (err instanceof BrowserFetchError) {
      throw new UrlIngestError(`Browser bridge 抓取失败（${err.stage}）：${err.message}`, 'fetch');
    }
    throw new UrlIngestError(err instanceof Error ? err.message : String(err), 'fetch');
  }
}

async function fillFromLlm(
  partial: ParsedProduct,
  html: string,
  finalUrl: string,
  abortSignal?: AbortSignal,
): Promise<ParsedProduct> {
  const slice = sliceForLlm(html);
  const data = await generateStructured({
    schema: llmFallbackSchema,
    system: [
      'You extract structured product info from a single product detail page HTML snippet.',
      'Be strict: copy text verbatim. Do NOT invent fields you do not see on the page.',
      'Image URLs must be absolute http(s) URLs visible in the snippet.',
      'If a field is genuinely absent (login-walled, captcha, or just missing), return null for it.',
    ].join(' '),
    prompt: [
      `Source URL: ${finalUrl}`,
      partial.title ? `Existing title hint (verify): ${partial.title}` : '',
      partial.mainImage ? `Existing main image hint (verify): ${partial.mainImage}` : '',
      '',
      'Return JSON: { title, main_image, gallery (≤6), price, bullets (≤6), description, category, brand }',
      '',
      '----- BEGIN HTML SNIPPET -----',
      slice,
      '----- END HTML SNIPPET -----',
    ].filter(Boolean).join('\n'),
    abortSignal,
    maxTokens: 2048,
  });
  return {
    title: partial.title ?? data.title,
    mainImage: partial.mainImage ?? data.main_image,
    gallery: dedupeKeepOrder([...(partial.gallery ?? []), ...(data.gallery ?? [])], null),
    price: partial.price ?? data.price,
    bullets: dedupeKeepOrder([...(partial.bullets ?? []), ...(data.bullets ?? [])], null).slice(0, MAX_BULLETS),
    description: partial.description ?? data.description,
    category: partial.category ?? data.category,
    brand: partial.brand ?? data.brand,
    rating: partial.rating,
    reviewsCount: partial.reviewsCount,
  };
}

async function downloadProductImage(
  url: string,
  refererUrl: string,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: abortSignal,
      redirect: 'follow',
      headers: {
        // Many CDNs (Amazon, Taobao, Etsy) only serve images when the Referer
        // matches the storefront origin. Pass the page URL through so we get
        // 200 instead of 403 on the very first request.
        Referer: safeOrigin(refererUrl),
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const saved = persistImageBuffer({
      buffer,
      filename: filenameFromUrl(url, contentType),
      mimeType: contentType,
    });
    return saved.absolutePath;
  } catch {
    return null;
  }
}

function filenameFromUrl(url: string, contentType: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? 'remote-image';
    if (/\.(png|jpe?g|webp|gif)$/i.test(last)) return last;
    return `${last}.${extensionFromContentType(contentType)}`;
  } catch {
    return `remote-image.${extensionFromContentType(contentType)}`;
  }
}

function extensionFromContentType(contentType: string): string {
  const mime = contentType.split(';')[0]?.trim().toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function dedupeKeepOrder(items: string[], excluding: string | null): string[] {
  const seen = new Set<string>();
  if (excluding) seen.add(excluding);
  const out: string[] = [];
  for (const item of items) {
    const key = item?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function sliceForLlm(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(out);
  if (body) out = body[1];
  if (out.length > 50_000) out = out.slice(0, 50_000);
  return out.trim();
}

function buildNote(
  parsed: ParsedProduct,
  url: string,
  adapterId: string,
  llmFallbackUsed: boolean,
): string {
  return [
    `[来自商品 URL] ${url}`,
    `解析方式：${adapterId}${llmFallbackUsed ? ' + LLM 兜底' : ''}`,
    parsed.brand ? `品牌：${parsed.brand}` : null,
    parsed.category ? `类目：${parsed.category}` : null,
    parsed.price ? `价格：${parsed.price}` : null,
    parsed.rating ? `评分：${parsed.rating}${parsed.reviewsCount ? ` (${parsed.reviewsCount})` : ''}` : null,
    parsed.bullets.length ? `卖点：\n${parsed.bullets.slice(0, MAX_BULLETS).map((b) => `  · ${b}`).join('\n')}` : null,
    parsed.description ? `描述：${parsed.description.slice(0, 600)}${parsed.description.length > 600 ? '…' : ''}` : null,
  ].filter(Boolean).join('\n');
}
