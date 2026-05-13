import { absoluteUrl, dedupeStrings, decodeEntities, getMeta, stripTags } from './html-utils';
import { parseGeneric } from './generic';
import type { AdapterContext, ParsedProduct, UrlAdapter } from './types';

/**
 * Etsy listing pages emit excellent JSON-LD that parseGeneric already covers,
 * so the adapter mostly fills bullets (Etsy doesn't put feature lists in
 * structured data) and the gallery (carousel images live as data attributes).
 */
export const etsyAdapter: UrlAdapter = {
  id: 'etsy',
  label: 'Etsy listing',
  matches(url) {
    return /(^|\.)etsy\.com$/i.test(url.hostname) && /\/listing\/\d+/i.test(url.pathname);
  },
  parse(ctx) {
    const base = parseGeneric(ctx);
    enrichEtsy(base, ctx);
    base.bullets = dedupeStrings(base.bullets).slice(0, 8);
    base.gallery = dedupeStrings(base.gallery).slice(0, 8);
    return base;
  },
};

function enrichEtsy(out: ParsedProduct, ctx: AdapterContext): void {
  const html = ctx.rawHtml;

  collectEtsyGallery(html, ctx.url, out);

  if (!out.price) out.price = extractEtsyPrice(html);
  if (!out.rating) out.rating = extractEtsyRating(html);
  if (!out.reviewsCount) out.reviewsCount = extractEtsyReviews(html);
  if (!out.brand) out.brand = extractEtsyShopName(html);
  if (!out.category) out.category = extractEtsyCategory(html);
  if (!out.description) out.description = extractEtsyDescription(html);

  // Highlights bullets — `<li class="wt-display-flex-xs ...">` inside the
  // overview block. Use a structural fallback: any list near "Highlights".
  const highlights = /Highlights<\/h2>([\s\S]*?)<\/ul>/i.exec(html);
  if (highlights) {
    const items = highlights[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
    for (const item of items) {
      const text = stripTags(decodeEntities(item[1])).trim();
      if (text && text.length > 4 && text.length < 240) out.bullets.push(text);
    }
  }

  // Item details bullet (materials / dimensions / etc) — `id="wt-content-toggle-product-details-read-more"`.
  const details = /id\s*=\s*["']wt-content-toggle-product-details-read-more["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (details) {
    const blocks = details[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const block of blocks) {
      const text = stripTags(decodeEntities(block[1])).trim();
      if (text && text.length > 4 && text.length < 320) out.bullets.push(text);
    }
  }
}

function collectEtsyGallery(html: string, baseUrl: string, out: ParsedProduct): void {
  const add = (raw: string | undefined | null) => {
    if (!raw) return;
    const abs = absoluteUrl(decodeEntities(raw), baseUrl);
    if (!abs || !isLikelyEtsyImage(abs)) return;
    if (!out.mainImage) {
      out.mainImage = abs;
    } else if (abs !== out.mainImage) {
      out.gallery.push(abs);
    }
  };

  const attrNames = [
    'data-src-zoom-image',
    'data-full-image-href',
    'data-zoom-image',
    'data-preload-lp-src',
    'data-src',
    'src',
  ];
  for (const attr of attrNames) {
    const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
    for (const match of html.matchAll(re)) add(match[1]);
  }

  for (const attr of ['srcset', 'data-srcset', 'data-preload-lp-srcset']) {
    const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
    for (const match of html.matchAll(re)) {
      for (const part of match[1].split(',')) {
        add(part.trim().split(/\s+/)[0]);
      }
    }
  }
}

function extractEtsyPrice(html: string): string | null {
  const metaAmount = getMeta(html, 'product:price:amount') ?? getMeta(html, 'og:price:amount');
  const metaCurrency = getMeta(html, 'product:price:currency') ?? getMeta(html, 'og:price:currency');
  if (metaAmount) return metaCurrency ? `${metaCurrency} ${metaAmount}` : metaAmount;

  const buyBox = sliceAroundMarker(html, 'data-buy-box-region="price"', 8000)
    ?? sliceAroundMarker(html, "data-buy-box-region='price'", 8000)
    ?? html;
  const pair = /<span\b[^>]*\bclass=["'][^"']*\bcurrency-symbol\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*\bclass=["'][^"']*\bcurrency-value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(buyBox)
    ?? /<span\b[^>]*\bclass=["'][^"']*\bcurrency-symbol\b[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]{0,800}?<span\b[^>]*\bclass=["'][^"']*\bcurrency-value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(buyBox);
  if (pair) {
    const symbol = cleanText(pair[1]);
    const value = cleanText(pair[2]);
    if (value) return `${symbol || '$'}${value}`.replace(/\s+/g, '');
  }

  const text = cleanText(buyBox);
  return /(?:US\$|CA\$|AU\$|\$|€|£)\s?\d[\d,.]*(?:\.\d{2})?\+?/.exec(text)?.[0]?.trim()
    ?? /\d[\d,.]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|CAD|AUD)\b/i.exec(text)?.[0]?.trim()
    ?? null;
}

function extractEtsyRating(html: string): string | null {
  const candidates = [
    attrValue(/\baria-label=["']([0-5](?:\.\d+)?)\s*out of\s*5\s*stars?/i, html),
    attrValue(/\baria-label=["']([0-5](?:\.\d+)?)\s*star rating\b/i, html),
    /([0-5](?:\.\d+)?)\s*out of\s*5\s*stars?/i.exec(cleanText(html))?.[1],
    /([0-5](?:\.\d+)?)\s*star rating\b/i.exec(cleanText(html))?.[1],
  ];
  return firstClean(candidates);
}

function extractEtsyReviews(html: string): string | null {
  const aria = attrValue(/\baria-label=["'][^"']*?\bwith\s+([\d,.]+[KkMm]?)\s+reviews?\b/i, html);
  const text = cleanText(html);
  return firstClean([
    aria,
    /\b([\d,.]+[KkMm]?)\s+reviews?\b/i.exec(text)?.[1],
    /\(([\d,.]+[KkMm]?)\)\s*reviews?\b/i.exec(text)?.[1],
  ]);
}

function extractEtsyShopName(html: string): string | null {
  const candidates = [
    attrValue(/\bdata-shop-name=["']([^"']+)["']/i, html),
    attrValue(/\bdata-shop-url=["'][^"']*\/shop\/([^"'/?#]+)[^"']*["']/i, html),
    /\/shop\/([^"'/?#<>\s]+)/i.exec(html)?.[1],
    /<span\b[^>]*\bdata-seller-name-link\b[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1],
    /<a\b[^>]*href=["'][^"']*\/shop\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1],
  ];
  const value = firstClean(candidates)?.replace(/^Ad\s*[·・]\s*By\s+/i, '').trim();
  if (!value || /^etsy$/i.test(value)) return null;
  return value;
}

function extractEtsyCategory(html: string): string | null {
  const meta = getMeta(html, 'product:category') ?? getMeta(html, 'category');
  if (meta) return decodeEntities(meta).trim();

  const breadcrumb =
    /<nav\b[^>]*(?:aria-label=["']Breadcrumb["']|data-ui=["']breadcrumbs["'])[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1]
    ?? /<ol\b[^>]*\bclass=["'][^"']*breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/ol>/i.exec(html)?.[1];
  if (breadcrumb) {
    const parts = [...breadcrumb.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => cleanText(match[1]))
      .filter((part) => part && !/^(etsy|home)$/i.test(part));
    if (parts.length) return parts[parts.length - 1];
  }

  const categoryLink = /<a\b[^>]+href=["'][^"']*\/c\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1];
  return firstClean([categoryLink]);
}

function extractEtsyDescription(html: string): string | null {
  const candidates = [
    /data-product-details-description-text-content[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1],
    /id=["']wt-content-toggle-product-details-read-more["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1],
    /data-id=["']description-text["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1],
    /class=["'][^"']*listing-page-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1],
  ];
  for (const candidate of candidates) {
    const value = cleanDescription(candidate);
    if (value) return value;
  }
  return null;
}

function sliceAroundMarker(html: string, marker: string, length: number): string | null {
  const index = html.indexOf(marker);
  if (index < 0) return null;
  return html.slice(index, Math.min(html.length, index + length));
}

function isLikelyEtsyImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /etsystatic\.com$/i.test(parsed.hostname)
      && /\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(parsed.pathname)
      && !/avatar|shop-icon|logo|sprite|transparent-pixel/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function attrValue(pattern: RegExp, html: string): string | undefined {
  return pattern.exec(html)?.[1];
}

function firstClean(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = cleanText(value ?? '');
    if (text) return text;
  }
  return null;
}

function cleanText(value: string): string {
  return stripTags(decodeEntities(value))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDescription(value: string | null | undefined): string | null {
  const text = cleanText(value ?? '')
    .replace(/\bLearn more about this item\b.*$/i, '')
    .replace(/\bMeet your seller\b.*$/i, '')
    .trim();
  if (!text || text.length < 12) return null;
  return text.slice(0, 1200);
}
