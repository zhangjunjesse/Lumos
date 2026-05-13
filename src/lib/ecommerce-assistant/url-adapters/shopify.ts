import { absoluteUrl, dedupeStrings, decodeEntities, stripTags } from './html-utils';
import { parseGeneric } from './generic';
import type { AdapterContext, ParsedProduct, UrlAdapter } from './types';

/**
 * Shopify product pages have two huge advantages:
 *   1. They emit `<meta name="generator" content="Shopify">` so we can detect them on any custom domain.
 *   2. They expose `/products/<handle>.json` — but we already have the HTML, so we look for the inline
 *      `var meta = {...}` blob that Shopify themes always inject.
 */
export const shopifyAdapter: UrlAdapter = {
  id: 'shopify',
  label: 'Shopify (custom domain or *.myshopify.com)',
  matches(url, html?: string) {
    if (/(^|\.)myshopify\.com$/i.test(url.hostname)) return true;
    if (typeof html === 'string') {
      return /<meta[^>]+name\s*=\s*["']generator["'][^>]+content\s*=\s*["']Shopify["']/i.test(html);
    }
    return false;
  },
  parse(ctx) {
    const base = parseGeneric(ctx);
    enrichShopify(base, ctx);
    base.bullets = dedupeStrings(base.bullets).slice(0, 8);
    base.gallery = dedupeStrings(base.gallery).slice(0, 8);
    return base;
  },
};

function enrichShopify(out: ParsedProduct, ctx: AdapterContext): void {
  const html = ctx.rawHtml;

  // Inline `var meta = {...}` — Shopify global object with product metadata.
  const metaBlob = /var\s+meta\s*=\s*({[\s\S]*?});/i.exec(html);
  if (metaBlob) {
    try {
      const data = JSON.parse(metaBlob[1]) as { product?: Record<string, unknown> };
      const product = data.product;
      if (product) {
        if (!out.title && typeof product.title === 'string') out.title = product.title;
        if (!out.brand && typeof product.vendor === 'string') out.brand = product.vendor;
        if (!out.category && typeof product.type === 'string') out.category = product.type;
      }
    } catch {
      // ignore malformed
    }
  }

  // Product description block — `.product__description` is theme-conventional.
  if (!out.description) {
    const desc = /class\s*=\s*["'][^"']*product__description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (desc) {
      const text = stripTags(decodeEntities(desc[1])).trim();
      if (text) out.description = text.slice(0, 2000);
    }
  }

  // Gallery — product carousel images. Themes vary; cover the common shapes.
  const carouselRe = /data-(?:zoom|full)-(?:src|url|image)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = carouselRe.exec(html)) != null) {
    const raw = m[1].startsWith('//') ? `https:${m[1]}` : m[1];
    const abs = absoluteUrl(raw, ctx.url);
    if (!abs) continue;
    if (!out.mainImage) out.mainImage = abs;
    else if (abs !== out.mainImage) out.gallery.push(abs);
  }
}

