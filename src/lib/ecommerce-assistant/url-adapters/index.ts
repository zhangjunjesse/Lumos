import { amazonAdapter } from './amazon';
import { etsyAdapter } from './etsy';
import { genericAdapter } from './generic';
import { shopifyAdapter } from './shopify';
import { taobaoAdapter } from './taobao';
import type { AdapterContext, ParsedProduct, UrlAdapter } from './types';
import { isParsedProductSufficient } from './types';

export type { ParsedProduct, AdapterContext, UrlAdapter } from './types';
export { isParsedProductSufficient, emptyParsedProduct } from './types';

/**
 * Order matters — first match wins. The generic adapter is always last so
 * we never fail to produce *some* parse result for the LLM fallback to
 * augment.
 */
const ADAPTERS: UrlAdapter[] = [
  amazonAdapter,
  taobaoAdapter,
  etsyAdapter,
  shopifyAdapter,
  genericAdapter,
];

export function pickAdapter(rawUrl: string, html?: string): UrlAdapter {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return genericAdapter;
  }
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.matches(url, html)) return adapter;
    } catch {
      continue;
    }
  }
  return genericAdapter;
}

export function parseProductFromHtml(rawUrl: string, html: string): {
  product: ParsedProduct;
  adapter: UrlAdapter;
  sufficient: boolean;
} {
  const cleanedHtml = cleanForAnalysis(html);
  const adapter = pickAdapter(rawUrl, html);
  const ctx: AdapterContext = { url: rawUrl, cleanedHtml, rawHtml: html };
  const product = adapter.parse(ctx);
  return { product, adapter, sufficient: isParsedProductSufficient(product) };
}

function cleanForAnalysis(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
