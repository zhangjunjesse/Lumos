import { getDb } from '@/lib/db/connection';

import { isGoofishNativeApp } from './goofish-app-sync';
import { fulfillForConversation } from './goofish-manual-fulfill';
import type { AppManifest } from './manifest/types';
import type { AppDataStore } from './runtime/data-store';

const DEFAULT_LOOKBACK_MS = 30 * 60 * 1000;

const SYSTEM_PAID_KEYWORDS = [
  '已付款',
  '已支付',
  '付款成功',
  '下单成功',
  '交易成功',
  '订单已生成',
  '买家已付款',
];

const BUYER_TEXT_PAID_KEYWORDS = [
  '我已付款',
  '已经付款',
  '刚拍下',
  '刚下单',
  '付款了',
];

interface AppSettingsRow extends Record<string, unknown> {
  auto_fulfill_enabled?: boolean;
  auto_fulfill_max_price?: number;
  auto_fulfill_account_unb_whitelist?: string[] | string;
  auto_fulfill_trigger?: string[] | string;
}

interface MessageRow {
  message_id: string;
  cid: string;
  account_unb: string;
  from_user_id: string;
  content_kind: string;
  content_text: string;
  created_at: number;
}

interface ListingRow extends Record<string, unknown> {
  product_id?: string;
  account_unb?: string;
  item_id?: string;
  listed_price?: number;
}

interface ConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  item_id?: string;
  account_unb?: string;
}

interface LogRow extends Record<string, unknown> {
  detected_message_id?: string;
  status?: string;
}

export interface AutoFulfillScanInput {
  manifest: AppManifest;
  store: AppDataStore;
  lookbackMs?: number;
  now?: number;
}

export interface AutoFulfillScanResult {
  ok: boolean;
  scanned: number;
  triggered: number;
  skipped: number;
  errors: number;
  details: Array<{
    messageId: string;
    keyword: string;
    status: 'sent' | 'failed' | 'duplicate_skip' | 'skipped';
    message: string;
  }>;
  message: string;
}

export async function runAutoFulfillScan(
  input: AutoFulfillScanInput,
): Promise<AutoFulfillScanResult> {
  const empty = makeEmpty();
  if (!isGoofishNativeApp(input.manifest)) {
    return { ...empty, message: '当前应用不是闲鱼类应用。' };
  }
  const settings = readSettings(input.store);
  if (!settings.auto_fulfill_enabled) {
    return { ...empty, ok: true, message: '自动发货已禁用。' };
  }
  const triggers = parseStringArray(settings.auto_fulfill_trigger, ['system_msg']);
  if (!triggers.includes('system_msg') && !triggers.includes('buyer_text')) {
    return { ...empty, ok: true, message: '没有启用任何识别策略。' };
  }
  const maxPrice = typeof settings.auto_fulfill_max_price === 'number'
    ? settings.auto_fulfill_max_price : 0;
  const whitelist = parseStringArray(settings.auto_fulfill_account_unb_whitelist, []);

  const lookback = input.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const now = input.now ?? Date.now();
  const messages = findRecentPaidMessages({
    since: now - lookback,
    triggers,
  });

  if (messages.length === 0) {
    return { ...empty, ok: true, scanned: 0, message: '没有命中付款消息。' };
  }

  const alreadyProcessed = collectProcessedMessageIds(input.store);
  let triggered = 0;
  let skipped = 0;
  let errors = 0;
  const details: AutoFulfillScanResult['details'] = [];

  for (const msg of messages) {
    if (alreadyProcessed.has(msg.message_id)) {
      skipped += 1;
      continue;
    }
    if (whitelist.length > 0 && !whitelist.includes(msg.account_unb)) {
      skipped += 1;
      continue;
    }
    const conv = findConversationByCid(input.store, msg.cid);
    if (!conv) {
      skipped += 1;
      details.push({
        messageId: msg.message_id,
        keyword: matchedKeyword(msg),
        status: 'skipped',
        message: '该会话尚未同步到应用数据库。',
      });
      continue;
    }
    if (maxPrice > 0) {
      const listing = findListingByItem(input.store, conv.item_id ?? '');
      const price = typeof listing?.listed_price === 'number' ? listing.listed_price : 0;
      if (price > maxPrice) {
        skipped += 1;
        details.push({
          messageId: msg.message_id,
          keyword: matchedKeyword(msg),
          status: 'skipped',
          message: `单价 ￥${price} 超过自动发货上限 ￥${maxPrice}。`,
        });
        continue;
      }
    }

    const result = await fulfillForConversation({
      manifest: input.manifest,
      store: input.store,
      conversationId: msg.cid,
      trigger: 'auto_scan',
      detectedMessageId: msg.message_id,
      detectionKeyword: matchedKeyword(msg),
    });

    if (result.status === 'sent') {
      triggered += 1;
    } else if (result.status === 'failed') {
      errors += 1;
    } else {
      skipped += 1;
    }
    details.push({
      messageId: msg.message_id,
      keyword: matchedKeyword(msg),
      status: detailStatusOf(result.status),
      message: result.message ?? '',
    });
  }

  return {
    ok: errors === 0 || triggered > 0,
    scanned: messages.length,
    triggered,
    skipped,
    errors,
    details,
    message: `扫描 ${messages.length} 条付款消息：发出 ${triggered}，跳过 ${skipped}，失败 ${errors}。`,
  };
}

function makeEmpty(): Omit<AutoFulfillScanResult, 'message'> {
  return { ok: false, scanned: 0, triggered: 0, skipped: 0, errors: 0, details: [] };
}

function readSettings(store: AppDataStore): AppSettingsRow {
  return store.query<AppSettingsRow>('app_settings', { limit: 1 })[0] ?? {};
}

function findRecentPaidMessages(input: {
  since: number;
  triggers: string[];
}): MessageRow[] {
  const db = getDb();
  const kinds: string[] = [];
  if (input.triggers.includes('system_msg')) kinds.push('system');
  if (input.triggers.includes('buyer_text')) kinds.push('text');
  if (kinds.length === 0) return [];
  const placeholders = kinds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT message_id, cid, account_unb, from_user_id, content_kind, content_text, created_at
    FROM goofish_messages
    WHERE created_at >= ? AND content_kind IN (${placeholders})
    ORDER BY created_at DESC LIMIT 500
  `).all(input.since, ...kinds) as MessageRow[];
  return rows.filter((r) => isLegitPaidSignal(r));
}

function isLegitPaidSignal(r: MessageRow): boolean {
  if (!r.content_text) return false;
  if (r.content_kind === 'system') {
    return SYSTEM_PAID_KEYWORDS.some((k) => r.content_text.includes(k));
  }
  if (r.content_kind === 'text') {
    if (!r.from_user_id || r.from_user_id === r.account_unb) return false;
    return BUYER_TEXT_PAID_KEYWORDS.some((k) => r.content_text.includes(k));
  }
  return false;
}

function detailStatusOf(status: string): 'sent' | 'failed' | 'duplicate_skip' | 'skipped' {
  if (status === 'sent' || status === 'failed' || status === 'duplicate_skip') return status;
  return 'skipped';
}

function matchedKeyword(r: MessageRow): string {
  if (!r.content_text) return '';
  const pool = r.content_kind === 'system' ? SYSTEM_PAID_KEYWORDS : BUYER_TEXT_PAID_KEYWORDS;
  return pool.find((k) => r.content_text.includes(k)) ?? '';
}

function collectProcessedMessageIds(store: AppDataStore): Set<string> {
  const logs = store.query<LogRow>('fulfillment_log', { limit: 500 });
  const ids = new Set<string>();
  for (const log of logs) {
    const id = typeof log.detected_message_id === 'string' ? log.detected_message_id : '';
    if (id) ids.add(id);
  }
  return ids;
}

function findConversationByCid(store: AppDataStore, cid: string): ConversationRow | null {
  if (!cid) return null;
  return store.query<ConversationRow>('buyer_conversations', {
    filter: { conversation_id: cid }, limit: 1,
  })[0] ?? null;
}

function findListingByItem(store: AppDataStore, itemId: string): ListingRow | null {
  if (!itemId) return null;
  return store.query<ListingRow>('product_listings', {
    filter: { item_id: itemId }, limit: 1,
  })[0] ?? null;
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : fallback;
  } catch {
    return fallback;
  }
}
