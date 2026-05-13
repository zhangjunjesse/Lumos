import {
  absoluteUrl,
  dedupeStrings,
  decodeEntities,
  findJsonLdProducts,
  getMeta,
  getTitleTag,
  pickFirstString,
  pickStringArray,
  stripTags,
} from './html-utils';
import { emptyParsedProduct, type AdapterContext, type ParsedProduct, type UrlAdapter } from './types';

/**
 * Site-agnostic fallback. Two complementary signals:
 *   1. JSON-LD `Product` (Shopify, Etsy, many headless storefronts emit this).
 *   2. OpenGraph + meta + title tag (almost everyone emits these).
 * The site-specific adapters extend, never replace, this — they call into it
 * to fill anything they didn't catch.
 */
export const genericAdapter: UrlAdapter = {
  id: 'generic',
  label: 'Generic (JSON-LD + OpenGraph)',
  matches() {
    return true;
  },
  parse(ctx) {
    return parseGeneric(ctx);
  },
};

export function parseGeneric(ctx: AdapterContext): ParsedProduct {
  const out = emptyParsedProduct();
  applyJsonLd(out, ctx);
  applyMetaTags(out, ctx);
  applyTitleFallback(out, ctx);
  out.bullets = dedupeStrings(out.bullets).slice(0, 8);
  out.gallery = dedupeStrings(out.gallery).slice(0, 8);
  return out;
}

function applyJsonLd(out: ParsedProduct, ctx: AdapterContext): void {
  const products = findJsonLdProducts(ctx.rawHtml);
  if (products.length === 0) return;
  // Prefer the product with the richest data (image + offer + name).
  const ranked = [...products].sort((a, b) => scoreLd(b.raw) - scoreLd(a.raw));
  const main = ranked[0].raw;

  if (!out.title) out.title = pickFirstString(main.name);
  if (!out.brand) {
    out.brand = pickFirstString(main.brand)
      ?? pickFirstString((main.brand as Record<string, unknown> | undefined)?.name);
  }
  if (!out.description) {
    const desc = pickFirstString(main.description);
    if (desc) out.description = stripTags(decodeEntities(desc));
  }
  if (!out.category) out.category = pickFirstString(main.category);

  const images = pickStringArray(main.image);
  if (images.length > 0) {
    if (!out.mainImage) out.mainImage = absoluteUrl(images[0], ctx.url);
    for (const img of images.slice(1)) {
      const abs = absoluteUrl(img, ctx.url);
      if (abs) out.gallery.push(abs);
    }
  }

  const offers = main.offers;
  if (offers && typeof offers === 'object') {
    const offer = Array.isArray(offers) ? offers[0] : offers;
    if (offer && typeof offer === 'object') {
      const o = offer as Record<string, unknown>;
      const priceText = pickFirstString(o.price, o.lowPrice, o.priceSpecification);
      const currency = pickFirstString(o.priceCurrency);
      if (!out.price && priceText) {
        out.price = currency ? `${currency} ${priceText}` : priceText;
      }
    }
  }

  const aggregate = main.aggregateRating as Record<string, unknown> | undefined;
  if (aggregate && typeof aggregate === 'object') {
    if (!out.rating) out.rating = pickFirstString(aggregate.ratingValue);
    if (!out.reviewsCount) out.reviewsCount = pickFirstString(aggregate.reviewCount, aggregate.ratingCount);
  }
}

function scoreLd(raw: Record<string, unknown>): number {
  let n = 0;
  if (raw.name) n += 4;
  if (raw.image) n += 3;
  if (raw.description) n += 2;
  if (raw.offers) n += 2;
  if (raw.brand) n += 1;
  return n;
}

function applyMetaTags(out: ParsedProduct, ctx: AdapterContext): void {
  if (!out.title) out.title = getMeta(ctx.rawHtml, 'og:title');
  if (!out.description) {
    const desc = getMeta(ctx.rawHtml, 'og:description') ?? getMeta(ctx.rawHtml, 'description');
    if (desc) out.description = decodeEntities(desc);
  }
  if (!out.mainImage) {
    out.mainImage = absoluteUrl(getMeta(ctx.rawHtml, 'og:image'), ctx.url);
  }
  if (!out.price) {
    const priceAmount = getMeta(ctx.rawHtml, 'product:price:amount') ?? getMeta(ctx.rawHtml, 'og:price:amount');
    const priceCurrency = getMeta(ctx.rawHtml, 'product:price:currency') ?? getMeta(ctx.rawHtml, 'og:price:currency');
    if (priceAmount) out.price = priceCurrency ? `${priceCurrency} ${priceAmount}` : priceAmount;
  }
  // Many OG sites repeat product images via `og:image` siblings. Capture them
  // as gallery candidates without losing the primary one.
  const ogImages = collectAllMetaContents(ctx.rawHtml, 'og:image');
  for (const img of ogImages) {
    const abs = absoluteUrl(img, ctx.url);
    if (!abs) continue;
    if (out.mainImage && abs === out.mainImage) continue;
    out.gallery.push(abs);
  }
}

function applyTitleFallback(out: ParsedProduct, ctx: AdapterContext): void {
  if (!out.title) out.title = getTitleTag(ctx.rawHtml);
}

function collectAllMetaContents(html: string, key: string): string[] {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    'gi',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) != null) out.push(m[1]);
  return out;
}
