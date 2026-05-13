import { listAccounts as listGoofishAccounts } from '@/lib/goofish/accounts';
import { isGoofishAuthExpiredError } from '@/lib/goofish/auth-error';
import { searchGoofishItems, type GoofishSearchItem } from '@/lib/goofish/browser-search';
import { searchMessages, type SearchHit } from '@/lib/goofish/db';

import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';
import type { AppDataStore, AppRow } from './runtime/data-store';

export type SearchScope = 'market' | 'shop' | 'history' | 'buyer';

export interface SearchInput {
  store: AppDataStore;
  manifest: AppManifest;
  scope: SearchScope;
  query: string;
  accountId?: string;
  limit?: number;
}

export interface SearchResultItem {
  scope: SearchScope;
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  meta?: Record<string, string | number>;
  link?: { type: 'conversation' | 'item' | 'buyer'; id: string };
}

export interface SearchResult {
  scope: SearchScope;
  query: string;
  items: SearchResultItem[];
  total: number;
  reachable: boolean;
  notReachableReason?: string;
  errors: string[];
}

interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  account_unb?: string;
  buyer_name?: string;
  buyer_user_id?: string;
  item_id?: string;
  item_title?: string;
  unread_count?: number;
  last_message?: string;
  last_message_at?: string;
  reply_status?: string;
  notes?: string;
}

const QUERY_MAX_LEN = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SEARCH_TIMEOUT_MS = 15_000;
const SHOP_NOT_REACHABLE =
  '当前 goofish MCP 和内置 API 不提供「列出本店上架商品」能力，需扩展 goofish MCP 或新增 mtop 商品列表接口';

export async function aggregateSearch(input: SearchInput): Promise<SearchResult> {
  const query = normalizeQuery(input.query);
  const limit = clampLimit(input.limit);
  const base = { scope: input.scope, query };

  if (!query) return notReachable(input.scope, query, '查询关键词不能为空');
  if (!isGoofishNativeApp(input.manifest)) {
    return notReachable(input.scope, query, '当前应用未声明为闲鱼类应用');
  }

  try {
    return await withTimeout(runScope({ ...input, query, limit }), SEARCH_TIMEOUT_MS, base);
  } catch (error) {
    return {
      ...base,
      items: [],
      total: 0,
      reachable: false,
      notReachableReason: '搜索执行失败',
      errors: [errorMessage(error)],
    };
  }
}

interface NormalizedInput extends SearchInput {
  query: string;
  limit: number;
}

async function runScope(input: NormalizedInput): Promise<SearchResult> {
  switch (input.scope) {
    case 'market':
      return runMarket(input);
    case 'shop':
      return notReachable('shop', input.query, SHOP_NOT_REACHABLE);
    case 'history':
      return runHistory(input);
    case 'buyer':
      return runBuyer(input);
    default:
      return notReachable(input.scope, input.query, `未知 scope：${input.scope}`);
  }
}

async function runMarket(input: NormalizedInput): Promise<SearchResult> {
  const accountUnb = pickAccountUnb(input.accountId);
  if (!accountUnb) {
    return notReachable('market', input.query, '没有已登录的闲鱼账号，全平台市场搜索需要账号 cookies');
  }
  try {
    const result = await searchGoofishItems(input.query, { accountUnb, limit: input.limit });
    if (result.blocked) {
      return notReachable('market', input.query, `闲鱼风控拦截（${result.blockReason || '非法访问'}）`);
    }
    const items = (result.items ?? []).slice(0, input.limit).map(marketItemToResult);
    return reachable('market', input.query, items);
  } catch (error) {
    if (isGoofishAuthExpiredError(error)) {
      return notReachable('market', input.query, '账号登录已失效，请在「扩展 > 闲鱼」重新登录');
    }
    return notReachable('market', input.query, `全平台市场搜索失败：${errorMessage(error)}`);
  }
}

function runHistory(input: NormalizedInput): SearchResult {
  const accountUnb = pickAccountUnb(input.accountId);
  try {
    const hits = searchMessages(input.query, { accountUnb, limit: input.limit });
    const items = hits.slice(0, input.limit).map((hit) => historyHitToResult(hit, input.query));
    return reachable('history', input.query, items);
  } catch (error) {
    return notReachable('history', input.query, `历史会话搜索失败：${errorMessage(error)}`);
  }
}

function runBuyer(input: NormalizedInput): SearchResult {
  try {
    const rows = input.store.query<BuyerConversationRow>('buyer_conversations', { limit: 500 });
    const matched = filterBuyerRows(rows, input.query, input.accountId).slice(0, input.limit);
    const items = matched.map((row) => buyerRowToResult(row, input.query));
    return reachable('buyer', input.query, items);
  } catch (error) {
    return notReachable('buyer', input.query, `买家搜索失败：${errorMessage(error)}`);
  }
}

function marketItemToResult(item: GoofishSearchItem): SearchResultItem {
  const meta: Record<string, string | number> = {};
  if (item.price) meta.price = item.price;
  if (item.sellerNick) meta.sellerNick = item.sellerNick;
  if (item.location) meta.location = item.location;
  if (item.url) meta.url = item.url;
  return {
    scope: 'market',
    id: item.itemId,
    title: item.title || '未命名商品',
    subtitle: item.sellerNick,
    snippet: item.url,
    meta,
    link: { type: 'item', id: item.itemId },
  };
}

function historyHitToResult(hit: SearchHit, query: string): SearchResultItem {
  return {
    scope: 'history',
    id: `${hit.cid}:${hit.message_id}`,
    title: hit.peer_nick || hit.peer_user_id || '未命名买家',
    subtitle: hit.item_title,
    snippet: makeSnippet(hit.content_text, query),
    meta: {
      cid: hit.cid,
      from: hit.from_user_name || hit.from_user_id,
      createdAt: hit.created_at,
      itemId: hit.item_id,
    },
    link: { type: 'conversation', id: hit.cid },
  };
}

function buyerRowToResult(row: AppRow<BuyerConversationRow>, query: string): SearchResultItem {
  const meta: Record<string, string | number> = {};
  if (row.account_unb) meta.accountUnb = row.account_unb;
  if (row.buyer_user_id) meta.buyerUserId = row.buyer_user_id;
  if (typeof row.unread_count === 'number') meta.unreadCount = row.unread_count;
  if (row.reply_status) meta.replyStatus = row.reply_status;
  if (row.last_message_at) meta.lastMessageAt = row.last_message_at;
  return {
    scope: 'buyer',
    id: row.id,
    title: row.buyer_name || row.buyer_user_id || '未命名买家',
    subtitle: row.item_title,
    snippet: makeSnippet(row.last_message ?? '', query),
    meta,
    link: { type: 'buyer', id: row.id },
  };
}

function filterBuyerRows(
  rows: AppRow<BuyerConversationRow>[],
  query: string,
  accountId: string | undefined,
): AppRow<BuyerConversationRow>[] {
  const needle = query.toLowerCase();
  return rows.filter((row) => {
    if (accountId && row.account_unb && row.account_unb !== accountId) return false;
    const haystack = [row.buyer_name, row.buyer_user_id, row.notes]
      .filter((v): v is string => typeof v === 'string')
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function pickAccountUnb(accountId: string | undefined): string | undefined {
  if (accountId && accountId !== 'all') return accountId;
  const accounts = listGoofishAccounts().filter((a) => a.hasCookies);
  return accounts[0]?.unb;
}

function reachable(scope: SearchScope, query: string, items: SearchResultItem[]): SearchResult {
  return { scope, query, items, total: items.length, reachable: true, errors: [] };
}

function notReachable(scope: SearchScope, query: string, reason: string): SearchResult {
  return { scope, query, items: [], total: 0, reachable: false, notReachableReason: reason, errors: [] };
}

function makeSnippet(text: string, query: string, radius = 40): string {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function normalizeQuery(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed.length > QUERY_MAX_LEN ? trimmed.slice(0, QUERY_MAX_LEN) : trimmed;
}

function clampLimit(limit: number | undefined): number {
  const value = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout(
  promise: Promise<SearchResult>,
  ms: number,
  base: { scope: SearchScope; query: string },
): Promise<SearchResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SearchResult>((resolve) => {
    timer = setTimeout(() => {
      resolve(notReachable(base.scope, base.query, `搜索超时（>${Math.floor(ms / 1000)}s）`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
