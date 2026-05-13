export interface ParsedProduct {
  /** Best-guess product title in source language. */
  title: string | null;
  /** Absolute URL of the hero / main product image. */
  mainImage: string | null;
  /** Additional gallery image URLs (absolute), capped by ingest layer. */
  gallery: string[];
  /** Display-form price (e.g. "$29.99"); we don't try to normalize currency here. */
  price: string | null;
  /** Bullet selling points, trimmed and deduplicated. */
  bullets: string[];
  /** Long description text (no HTML), if present. */
  description: string | null;
  /** Best-guess category / breadcrumb leaf. */
  category: string | null;
  /** Brand name if visible. */
  brand: string | null;
  /** Star rating as text (e.g. "4.5"). */
  rating: string | null;
  /** Reviews count as text (e.g. "1,234"). */
  reviewsCount: string | null;
}

export interface AdapterContext {
  /** Final URL after redirects (provided by browser bridge). */
  url: string;
  /** Cleaned HTML (scripts/styles stripped). */
  cleanedHtml: string;
  /** Raw HTML (for site-specific JSON blob extraction). */
  rawHtml: string;
}

export interface UrlAdapter {
  /** Stable adapter id (e.g. 'amazon', 'taobao', 'etsy', 'shopify', 'generic'). */
  id: string;
  /** Human label for diagnostics. */
  label: string;
  /**
   * True if this adapter wants to handle the URL. The optional `html` arg lets
   * adapters peek at the page (e.g. Shopify identifies itself via a generator
   * meta tag on custom domains).
   */
  matches(url: URL, html?: string): boolean;
  /** Parse what we can; return null fields where missing. The ingest layer fills gaps via LLM. */
  parse(ctx: AdapterContext): ParsedProduct;
}

export function emptyParsedProduct(): ParsedProduct {
  return {
    title: null,
    mainImage: null,
    gallery: [],
    price: null,
    bullets: [],
    description: null,
    category: null,
    brand: null,
    rating: null,
    reviewsCount: null,
  };
}

/** True iff the parsed product is "good enough" to skip LLM fallback. */
export function isParsedProductSufficient(p: ParsedProduct): boolean {
  if (!p.title || p.title.trim().length < 3) return false;
  if (!p.mainImage) return false;
  if (p.bullets.length === 0 && !p.description) return false;
  return true;
}
