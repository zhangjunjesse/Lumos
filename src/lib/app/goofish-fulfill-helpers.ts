import type { AppDataStore, AppRow } from './runtime/data-store';

export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type FulTrigger = 'auto_scan' | 'manual_button' | 'ai_in_chat';
export type FulStatus = 'pending' | 'sent' | 'failed' | 'duplicate_skip';

export interface ProductRow extends Record<string, unknown> {
  title?: string;
  fulfillment_template?: string;
  links?: ProductLinkRow[];
  cards?: ProductCardRow[];
  total_sold?: number;
  last_sold_at?: string;
}

export interface ProductLinkRow {
  id: string;
  provider: string;
  url: string;
  code: string;
  note?: string;
  health?: 'ok' | 'broken' | 'unchecked';
}

export type ProductCardKind = 'text' | 'data' | 'api' | 'image';

export interface ProductCardRow {
  id: string;
  kind: ProductCardKind;
  name?: string;
  enabled?: boolean;
  delay_seconds?: number;
  text_content?: string;
  data_lines?: string[];
  data_used_count?: number;
  api_config?: {
    url?: string;
    method?: string;
    timeout_ms?: number;
    headers_json?: string;
    body_template?: string;
    response_jsonpath?: string;
  };
  image_url?: string;
}

export interface CardPick {
  card: ProductCardRow;
  cardIndex: number;
  consumedLineIndex?: number;
  consumedValue?: string;
}

/**
 * 优先卡密（按顺序找第一个可用），没卡密回退到链接。
 * data 类型卡密自带"一次一码出库"语义：调用方拿到 consumedLineIndex 后必须
 * 写回 product.cards[cardIndex].data_used_count = consumedLineIndex + 1。
 */
export function pickActiveCard(cards: ProductCardRow[]): CardPick | null {
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (card.enabled === false) continue;
    if (card.kind === 'data') {
      const lines = (card.data_lines ?? []).filter((l) => typeof l === 'string' && l.trim());
      const used = card.data_used_count ?? 0;
      if (used < lines.length) {
        return { card, cardIndex: i, consumedLineIndex: used, consumedValue: lines[used] };
      }
      continue;
    }
    if (card.kind === 'text' && card.text_content?.trim()) {
      return { card, cardIndex: i, consumedValue: card.text_content };
    }
    if (card.kind === 'image' && card.image_url?.trim()) {
      return { card, cardIndex: i, consumedValue: card.image_url };
    }
    if (card.kind === 'api' && card.api_config?.url?.trim()) {
      return { card, cardIndex: i };
    }
  }
  return null;
}

/** API 类型卡密：调外部接口动态取卡。返回拿到的卡密字符串或抛错。 */
export async function fetchCardFromApi(card: ProductCardRow): Promise<string> {
  const cfg = card.api_config;
  if (!cfg?.url) throw new Error('api 类型卡密缺少 url 配置');
  const method = (cfg.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.headers_json) {
    try {
      const parsed = JSON.parse(cfg.headers_json) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') headers[k] = v;
      }
    } catch { /* malformed headers ignored */ }
  }
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && cfg.body_template) {
    init.body = cfg.body_template;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout_ms ?? 15_000);
  try {
    const res = await fetch(cfg.url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`卡密 API 返回 HTTP ${res.status}`);
    const text = await res.text();
    if (!cfg.response_jsonpath || cfg.response_jsonpath.trim() === '') {
      return text.trim();
    }
    try {
      const parsed = JSON.parse(text);
      const value = extractByJsonPath(parsed, cfg.response_jsonpath.trim());
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (value !== undefined && value !== null) return String(value).trim();
      throw new Error(`卡密 API 响应里取不到 ${cfg.response_jsonpath}`);
    } catch (e) {
      if (e instanceof SyntaxError) return text.trim();
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
}

function extractByJsonPath(obj: unknown, jsonpath: string): unknown {
  // 极简 jsonpath: "data.code" / "result.0.value" — 支持点分 + 数字下标
  const parts = jsonpath.replace(/^\$\.?/, '').split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(p);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export interface ProductListingRow extends Record<string, unknown> {
  product_id?: string;
  account_unb?: string;
  item_id?: string;
  item_title?: string;
  sold_count?: number;
  listed_price?: number;
}

export interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  buyer_user_id?: string;
  account_unb?: string;
  item_id?: string;
  item_title?: string;
  reply_status?: string;
}

export interface FulfillmentLogRow extends Record<string, unknown> {
  trigger_source?: FulTrigger;
  conversation_id?: string;
  buyer_user_id?: string;
  buyer_name?: string;
  account_unb?: string;
  item_id?: string;
  item_title?: string;
  product_id?: string;
  product_title?: string;
  product_listing_id?: string;
  detected_message_id?: string;
  detection_keyword?: string;
  sent_text?: string;
  status?: FulStatus;
  failure_reason?: string;
  sent_at?: string;
  created_at?: string;
}

export function findConversationByRowOrCid(
  store: AppDataStore,
  opts: { rowId?: string; conversationId?: string },
): AppRow<BuyerConversationRow> | null {
  if (opts.rowId) {
    return store.get<BuyerConversationRow>('buyer_conversations', opts.rowId);
  }
  if (opts.conversationId) {
    return store.query<BuyerConversationRow>('buyer_conversations', {
      filter: { conversation_id: opts.conversationId }, limit: 1,
    })[0] ?? null;
  }
  return null;
}

export function findListingForItem(
  store: AppDataStore,
  itemId: string,
): AppRow<ProductListingRow> | null {
  if (!itemId) return null;
  return store.query<ProductListingRow>('product_listings', {
    filter: { item_id: itemId }, limit: 1,
  })[0] ?? null;
}

export function pickActiveLink(links: ProductLinkRow[]): ProductLinkRow | null {
  const ok = links.find((l) => l.health === 'ok' && l.url);
  if (ok) return ok;
  const unchecked = links.find((l) => (l.health === 'unchecked' || !l.health) && l.url);
  return unchecked ?? null;
}

export function findRecentSentLog(
  store: AppDataStore,
  conversationId: string,
  productId: string,
): AppRow<FulfillmentLogRow> | null {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const list = store.query<FulfillmentLogRow>('fulfillment_log', {
    filter: { conversation_id: conversationId, product_id: productId, status: 'sent' },
    limit: 50,
  });
  return list.find((l) => {
    const ts = Date.parse(textValue(l.sent_at) || textValue(l.created_at));
    return Number.isFinite(ts) && ts >= cutoff;
  }) ?? null;
}

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key.toLowerCase()] ?? '');
}

export function defaultTemplate(isCard = false): string {
  if (isCard) {
    return `亲，您下单的商品已发货：\n{{card}}\n请收好，有问题随时联系～`;
  }
  return `亲，您下单的商品交付链接：\n{{url}}\n提取码：{{code}}\n有问题随时联系～`;
}

export function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function bumpCountersAndCloseLog(
  store: AppDataStore,
  input: {
    logId: string;
    productId: string;
    product: ProductRow;
    listing: AppRow<ProductListingRow>;
    conv: AppRow<BuyerConversationRow>;
  },
): void {
  const now = new Date().toISOString();
  store.update<FulfillmentLogRow>('fulfillment_log', input.logId, {
    status: 'sent', sent_at: now, failure_reason: '',
  });
  store.update<ProductRow>('products', input.productId, {
    total_sold: (input.product.total_sold ?? 0) + 1,
    last_sold_at: now,
  });
  store.update<ProductListingRow>('product_listings', input.listing.id, {
    sold_count: (input.listing.sold_count ?? 0) + 1,
  });
  store.update<BuyerConversationRow>('buyer_conversations', input.conv.id, {
    reply_status: '已回复',
    updated_at: now,
  });
}
