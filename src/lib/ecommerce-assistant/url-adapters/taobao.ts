import { absoluteUrl, dedupeStrings, decodeEntities, getTitleTag, stripTags } from './html-utils';
import { parseGeneric } from './generic';
import type { AdapterContext, ParsedProduct, UrlAdapter } from './types';

/**
 * Taobao / Tmall product pages are React/Vue SPAs that hydrate from inline
 * JSON blobs (`window.runParams`, `__INIT_DATA__`, `__NEXT_DATA__`). We try
 * several known shapes; if the page is fully render-blocked behind a login
 * wall, the LLM fallback in url-ingest.ts takes over.
 */
export const taobaoAdapter: UrlAdapter = {
  id: 'taobao',
  label: 'Taobao / Tmall',
  matches(url) {
    return /(^|\.)(taobao|tmall|tb)\.(com|cn)$/i.test(url.hostname)
      || /(^|\.)detail\.tmall\.com$/i.test(url.hostname)
      || /(^|\.)item\.taobao\.com$/i.test(url.hostname);
  },
  parse(ctx) {
    const base = parseGeneric(ctx);
    enrich(base, ctx);
    base.bullets = dedupeStrings(base.bullets).slice(0, 8);
    base.gallery = dedupeStrings(base.gallery).slice(0, 8);
    return base;
  },
};

function enrich(out: ParsedProduct, ctx: AdapterContext): void {
  const html = ctx.rawHtml;

  // Hydration blob — search common variable names. Stay defensive: any failure
  // just falls through to the OG/JSON-LD already populated by parseGeneric.
  const blobs: Array<{ name: string; data: unknown }> = [];
  for (const re of HYDRATION_REGEXES) {
    const m = re.exec(html);
    if (!m) continue;
    try {
      blobs.push({ name: re.source.slice(0, 40), data: JSON.parse(m[1]) });
    } catch {
      // skip malformed
    }
  }
  for (const blob of blobs) {
    const product = findProductInBlob(blob.data);
    if (!product) continue;
    if (!out.title && typeof product.title === 'string') out.title = product.title.trim();
    if (typeof product.mainImg === 'string' && !out.mainImage) {
      out.mainImage = absoluteUrl(normalizeProto(product.mainImg), ctx.url);
    }
    if (Array.isArray(product.images)) {
      for (const img of product.images) {
        if (typeof img !== 'string') continue;
        const abs = absoluteUrl(normalizeProto(img), ctx.url);
        if (!abs) continue;
        if (abs === out.mainImage) continue;
        out.gallery.push(abs);
      }
    }
    if (Array.isArray(product.props)) {
      for (const prop of product.props) {
        if (typeof prop === 'string' && prop.length > 4 && prop.length < 200) {
          out.bullets.push(prop);
        }
      }
    }
    if (!out.price && typeof product.price === 'string') {
      out.price = product.price.includes('¥') ? product.price : `¥${product.price}`;
    }
    if (!out.brand && typeof product.brand === 'string') out.brand = product.brand;
  }

  // Light DOM fallback — Taobao SSR sometimes still renders `tb-main-title`.
  if (!out.title) {
    const titleMatch = /<h3[^>]+class\s*=\s*["'][^"']*(?:tb-main-title|main-title)[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(html);
    if (titleMatch) {
      const text = stripTags(decodeEntities(titleMatch[1])).trim();
      if (text) out.title = text;
    }
  }
  if (!out.title) out.title = getTitleTag(html);
}

const HYDRATION_REGEXES: RegExp[] = [
  /window\.runParams\s*=\s*({[\s\S]*?});\s*<\/script>/,
  /__INIT_DATA__\s*=\s*({[\s\S]*?})\s*<\/script>/,
  /<script[^>]+id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/,
];

function findProductInBlob(node: unknown): ProductLite | null {
  // BFS for any object that has the field shape we recognize.
  const queue: unknown[] = [node];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const item of cur) queue.push(item);
      continue;
    }
    const obj = cur as Record<string, unknown>;
    const lite = matchProductShape(obj);
    if (lite) return lite;
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}

interface ProductLite {
  title?: string;
  mainImg?: string;
  images?: unknown[];
  props?: unknown[];
  price?: string;
  brand?: string;
}

function matchProductShape(obj: Record<string, unknown>): ProductLite | null {
  // Tmall detail data: { item: { title, taobaoPid, ... }, props: { groupProps } }
  const item = obj.item as Record<string, unknown> | undefined;
  if (item && typeof item === 'object' && 'title' in item) {
    const images = Array.isArray((item as Record<string, unknown>).images)
      ? ((item as Record<string, unknown>).images as unknown[])
      : Array.isArray((obj.itemPath as Record<string, unknown> | undefined)?.imgs)
        ? ((obj.itemPath as Record<string, unknown>).imgs as unknown[])
        : [];
    return {
      title: typeof item.title === 'string' ? item.title : undefined,
      mainImg: typeof images[0] === 'string' ? (images[0] as string) : undefined,
      images: images.slice(1),
      brand: typeof item.brand === 'string' ? item.brand : undefined,
    };
  }
  // Taobao itemDO.title shape
  if (obj.itemDO && typeof obj.itemDO === 'object') {
    const itemDo = obj.itemDO as Record<string, unknown>;
    return {
      title: typeof itemDo.title === 'string' ? itemDo.title : undefined,
      mainImg: typeof itemDo.picUrl === 'string' ? (itemDo.picUrl as string) : undefined,
      images: Array.isArray(itemDo.auctionImages) ? (itemDo.auctionImages as unknown[]) : [],
    };
  }
  return null;
}

function normalizeProto(src: string): string {
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}
