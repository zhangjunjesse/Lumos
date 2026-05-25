import type { AppDataStore } from './runtime/data-store';

export interface ComposeListingTextInput {
  store: AppDataStore;
  productId: string;
}

export interface ComposeListingTextResult {
  ok: boolean;
  title?: string;
  description?: string;
  price?: number;
  fulfillmentTemplate?: string;
  message?: string;
}

interface ProductRow extends Record<string, unknown> {
  title?: string;
  summary?: string;
  suggested_price?: number;
  fulfillment_template?: string;
  ai_generated_description?: string;
}

export function composeListingText(input: ComposeListingTextInput): ComposeListingTextResult {
  if (!input.productId) {
    return { ok: false, message: '缺少商品 ID。' };
  }
  const row = input.store.get<ProductRow>('products', input.productId);
  if (!row) {
    return { ok: false, message: '找不到该商品。' };
  }
  const title = textValue(row.title);
  if (!title) {
    return { ok: false, message: '该商品还没有标题。' };
  }
  const description = textValue(row.summary) || textValue(row.ai_generated_description);
  return {
    ok: true,
    title,
    description: description || undefined,
    price: typeof row.suggested_price === 'number' ? row.suggested_price : 0,
    fulfillmentTemplate: textValue(row.fulfillment_template) || undefined,
  };
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
