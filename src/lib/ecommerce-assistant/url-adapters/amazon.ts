import {
  absoluteUrl,
  dedupeStrings,
  decodeEntities,
  stripTags,
} from './html-utils';
import { parseGeneric } from './generic';
import type { AdapterContext, ParsedProduct, UrlAdapter } from './types';

export const amazonAdapter: UrlAdapter = {
  id: 'amazon',
  label: 'Amazon (US/UK/JP/DE/FR/IT/ES/CA/AU)',
  matches(url) {
    if (!/(^|\.)amazon\./i.test(url.hostname)) return false;
    return /\/(dp|gp\/product)\//i.test(url.pathname) || /\/-\/[a-z]{2}\/dp\//i.test(url.pathname);
  },
  parse(ctx) {
    const base = parseGeneric(ctx);
    enrichFromAmazonHtml(base, ctx);
    base.bullets = dedupeStrings(base.bullets).slice(0, 8);
    base.gallery = dedupeStrings(base.gallery).slice(0, 8);
    return base;
  },
};

function enrichFromAmazonHtml(out: ParsedProduct, ctx: AdapterContext): void {
  const html = ctx.rawHtml;

  // Title — prefer #productTitle which Amazon always emits in main DOM.
  const titleMatch = /<span[^>]+id\s*=\s*["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
  if (titleMatch) {
    const text = stripTags(decodeEntities(titleMatch[1])).trim();
    if (text && (!out.title || text.length > out.title.length)) {
      out.title = text;
    }
  }

  // Bullets — `#feature-bullets li span.a-list-item`. We tolerate ordering.
  const bulletsBlock = /<div[^>]+id\s*=\s*["']feature-bullets["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html);
  if (bulletsBlock) {
    const items = bulletsBlock[1].matchAll(/<span[^>]+class\s*=\s*["'][^"']*a-list-item[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi);
    for (const m of items) {
      const text = stripTags(decodeEntities(m[1])).trim();
      if (text && text.length > 4 && text.length < 320) {
        out.bullets.push(text);
      }
    }
  }

  // Hero image — landingImage data-old-hires takes priority (full-resolution).
  const landing = /<img[^>]+id\s*=\s*["']landingImage["'][^>]*>/i.exec(html);
  if (landing) {
    const tag = landing[0];
    const oldHires = /data-old-hires\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const dynamic = /data-a-dynamic-image\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const candidate = oldHires || largestFromDynamicImage(dynamic) || src;
    const abs = absoluteUrl(candidate, ctx.url);
    if (abs) {
      // Always prefer Amazon high-res over OG which is often a thumbnail.
      out.mainImage = abs;
    }
  }

  // Gallery — `colorImages` data-a-dynamic-image carries variant images.
  const dynamicImages = html.match(/data-a-dynamic-image\s*=\s*["']({[^"']+})["']/gi) ?? [];
  for (const blob of dynamicImages) {
    const inner = /["']({[^"']+})["']/.exec(blob)?.[1];
    if (!inner) continue;
    const url = largestFromDynamicImage(inner);
    const abs = absoluteUrl(url, ctx.url);
    if (abs && abs !== out.mainImage) out.gallery.push(abs);
  }

  // Brand — `bylineInfo` link text.
  if (!out.brand) {
    const brand = /<a[^>]+id\s*=\s*["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i.exec(html);
    if (brand) {
      const text = stripTags(decodeEntities(brand[1])).replace(/^Visit the |Brand:\s*|品牌:\s*|店：\s*/i, '').trim();
      if (text) out.brand = text;
    }
  }

  // Price — try priceblock first, then a-price aria-text.
  if (!out.price) {
    const ariaPrice = /<span[^>]+class\s*=\s*["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/i.exec(html);
    if (ariaPrice) {
      const text = ariaPrice[1].trim();
      if (text && text.length < 40) out.price = text;
    }
  }

  // Rating + reviews — acrPopover.
  if (!out.rating) {
    const rating = /<span[^>]+class\s*=\s*["'][^"']*a-icon-alt[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)\s*(?:out of|颗星|顆星|星)/i.exec(html);
    if (rating) out.rating = rating[1];
  }
  if (!out.reviewsCount) {
    const reviews = /<span[^>]+id\s*=\s*["']acrCustomerReviewText["'][^>]*>([^<]+)<\/span>/i.exec(html);
    if (reviews) {
      const text = reviews[1].replace(/[^0-9.,]/g, '').trim();
      if (text) out.reviewsCount = text;
    }
  }

  // Long description — `productDescription` block, plain text.
  if (!out.description) {
    const desc = /<div[^>]+id\s*=\s*["']productDescription["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (desc) {
      const text = stripTags(decodeEntities(desc[1])).trim();
      if (text) out.description = text.slice(0, 2000);
    }
  }
}

/**
 * Amazon emits an inline JSON map of `imageUrl -> [w, h]`. Pick the URL with
 * the largest area so we don't regress to a 200px thumbnail when we have a
 * 1500px master available.
 */
function largestFromDynamicImage(blob: string | null | undefined): string | null {
  if (!blob) return null;
  let parsed: Record<string, [number, number]>;
  try {
    // Amazon sometimes HTML-escapes the inline JSON.
    const cleaned = decodeEntities(blob);
    parsed = JSON.parse(cleaned) as Record<string, [number, number]>;
  } catch {
    return null;
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1]);
  return entries[0][0] ?? null;
}
