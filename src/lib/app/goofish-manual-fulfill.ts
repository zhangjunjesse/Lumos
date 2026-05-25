import { sendMessage as goofishSendMessage } from '@/lib/goofish/messages';

import { isGoofishNativeApp } from './goofish-app-sync';
import {
  bumpCountersAndCloseLog,
  defaultTemplate,
  fetchCardFromApi,
  findConversationByRowOrCid,
  findListingForItem,
  findRecentSentLog,
  pickActiveCard,
  pickActiveLink,
  renderTemplate,
  textValue,
  type BuyerConversationRow,
  type CardPick,
  type FulStatus,
  type FulTrigger,
  type FulfillmentLogRow,
  type ProductCardRow,
  type ProductListingRow,
  type ProductRow,
} from './goofish-fulfill-helpers';
import type { AppManifest } from './manifest/types';
import type { AppDataStore } from './runtime/data-store';

export interface FulfillInput {
  manifest: AppManifest;
  store: AppDataStore;
  conversationRowId?: string;
  conversationId?: string;
  trigger: FulTrigger;
  detectedMessageId?: string;
  detectionKeyword?: string;
  sender?: (cid: string, toid: string, text: string) => Promise<void>;
}

export interface FulfillResult {
  ok: boolean;
  status: FulStatus;
  logId?: string;
  message?: string;
}

export async function fulfillForConversation(input: FulfillInput): Promise<FulfillResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    return { ok: false, status: 'failed', message: '当前应用不是闲鱼类应用。' };
  }
  const conv = findConversationByRowOrCid(input.store, {
    rowId: input.conversationRowId,
    conversationId: input.conversationId,
  });
  if (!conv) {
    return {
      ok: false, status: 'failed',
      message: '找不到买家会话。请先到「自动化 → 同步闲鱼数据」运行一次同步，把这个会话拉进 Lumos。',
    };
  }
  const conversationId = textValue(conv.conversation_id);
  const buyerUserId = textValue(conv.buyer_user_id);
  if (!conversationId || !buyerUserId) {
    return { ok: false, status: 'failed', message: '会话缺少 conversation_id 或 buyer_user_id。' };
  }

  const listing = findListingForItem(input.store, textValue(conv.item_id));
  if (!listing) {
    return {
      ok: false, status: 'failed',
      message: `该商品（item_id=${textValue(conv.item_id) || '空'}）没在「商品库 → 关联商品」里挂载任何商品。请先去商品库把这个商品 ID 回填到对应商品上。`,
    };
  }
  const productId = textValue(listing.product_id);
  const product = productId ? input.store.get<ProductRow>('products', productId) : null;
  if (!product) {
    return { ok: false, status: 'failed', message: '关联的商品不存在或已删除。' };
  }
  // 1) 先看卡密池（一次一码、固定文本、API 动态取卡）
  // 2) 退回网盘链接
  const cardPick = pickActiveCard(product.cards ?? []);
  const link = cardPick ? null : pickActiveLink(product.links ?? []);
  if (!cardPick && !link) {
    return { ok: false, status: 'failed', message: '该商品既没有可用卡密也没有可用链接。请到「商品库」添加。' };
  }
  const deliveryWarning = !cardPick && link && link.health !== 'ok'
    ? '⚠ 这个链接还没测试过有效性，建议先测一下再发。'
    : '';

  const duplicate = findRecentSentLog(input.store, conversationId, productId);
  if (duplicate) {
    const log = input.store.create<FulfillmentLogRow>('fulfillment_log', {
      trigger_source: input.trigger,
      conversation_id: conversationId,
      buyer_user_id: buyerUserId,
      buyer_name: textValue(conv.buyer_name),
      account_unb: textValue(conv.account_unb),
      item_id: textValue(conv.item_id),
      item_title: textValue(conv.item_title),
      product_id: productId,
      product_title: textValue(product.title),
      product_listing_id: listing.id,
      detected_message_id: input.detectedMessageId ?? '',
      detection_keyword: input.detectionKeyword ?? '',
      sent_text: '',
      status: 'duplicate_skip',
      failure_reason: `24 小时内已经给此买家发过这件商品（log=${duplicate.id}）。`,
      created_at: new Date().toISOString(),
    });
    return { ok: true, status: 'duplicate_skip', logId: log.id, message: '已跳过：24 小时内重复请求。' };
  }

  let cardValue = '';
  if (cardPick) {
    try {
      cardValue = await resolveCardValue(cardPick);
    } catch (err) {
      return {
        ok: false, status: 'failed',
        message: `取卡失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  const sentText = renderTemplate(
    textValue(product.fulfillment_template) || defaultTemplate(cardPick !== null),
    {
      url: link?.url ?? '',
      code: link?.code ?? '',
      card: cardValue,
      title: textValue(product.title),
      buyer: textValue(conv.buyer_name),
    },
  );

  const log = input.store.create<FulfillmentLogRow>('fulfillment_log', {
    trigger_source: input.trigger,
    conversation_id: conversationId,
    buyer_user_id: buyerUserId,
    buyer_name: textValue(conv.buyer_name),
    account_unb: textValue(conv.account_unb),
    item_id: textValue(conv.item_id),
    item_title: textValue(conv.item_title),
    product_id: productId,
    product_title: textValue(product.title),
    product_listing_id: listing.id,
    detected_message_id: input.detectedMessageId ?? '',
    detection_keyword: input.detectionKeyword ?? '',
    sent_text: sentText,
    status: 'pending',
    failure_reason: '',
    created_at: new Date().toISOString(),
  });

  const send = input.sender ?? goofishSendMessage;
  try {
    await send(conversationId, buyerUserId, sentText);
    if (cardPick) {
      consumeCardFromProduct(input.store, productId, product, cardPick);
    }
    bumpCountersAndCloseLog(input.store, {
      logId: log.id, productId, product, listing, conv,
    });
    return {
      ok: true, status: 'sent', logId: log.id,
      message: deliveryWarning ? `已发出。${deliveryWarning}` : '已发出。',
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : '发送失败';
    input.store.update<FulfillmentLogRow>('fulfillment_log', log.id, {
      status: 'failed',
      failure_reason: reason,
    });
    return { ok: false, status: 'failed', logId: log.id, message: reason };
  }
}

async function resolveCardValue(pick: CardPick): Promise<string> {
  if (pick.consumedValue !== undefined) return pick.consumedValue;
  if (pick.card.kind === 'api') {
    return fetchCardFromApi(pick.card);
  }
  throw new Error('卡密类型未知或缺少内容');
}

function consumeCardFromProduct(
  store: AppDataStore,
  productId: string,
  product: ProductRow,
  pick: CardPick,
): void {
  if (pick.consumedLineIndex === undefined) return;
  const cards = (product.cards ?? []).slice();
  const target = cards[pick.cardIndex];
  if (!target) return;
  cards[pick.cardIndex] = {
    ...target,
    data_used_count: pick.consumedLineIndex + 1,
  } as ProductCardRow;
  store.update<ProductRow>('products', productId, { cards });
}

export async function retryFulfillment(input: {
  manifest: AppManifest;
  store: AppDataStore;
  logId: string;
  sender?: (cid: string, toid: string, text: string) => Promise<void>;
}): Promise<FulfillResult> {
  const log = input.store.get<FulfillmentLogRow>('fulfillment_log', input.logId);
  if (!log) {
    return { ok: false, status: 'failed', message: '找不到要重发的发货流水。' };
  }
  if (log.status === 'sent') {
    return { ok: true, status: 'sent', logId: log.id, message: '这条已经发过了。' };
  }
  if (log.status === 'pending') {
    return {
      ok: false, status: 'failed', logId: log.id,
      message: '这条流水卡在 pending（上次可能已发出但记录失败），不能直接重发避免买家收到两份。请先人工确认买家是否已收到。',
    };
  }
  if (log.status === 'duplicate_skip') {
    return {
      ok: false, status: 'failed', logId: log.id,
      message: '这条是去重跳过记录，不存在「重发」语义。请到收件箱手动发起新发货。',
    };
  }
  const conversationId = textValue(log.conversation_id);
  const buyerUserId = textValue(log.buyer_user_id);
  const sentText = textValue(log.sent_text);
  if (!conversationId || !buyerUserId || !sentText) {
    return { ok: false, status: 'failed', logId: log.id, message: '流水缺少必要字段，无法重发。' };
  }
  const send = input.sender ?? goofishSendMessage;
  try {
    await send(conversationId, buyerUserId, sentText);
    const productId = textValue(log.product_id);
    const product = productId ? input.store.get<ProductRow>('products', productId) : null;
    const listingId = textValue(log.product_listing_id);
    const listing = listingId ? input.store.get<ProductListingRow>('product_listings', listingId) : null;
    const conv = input.store.query<BuyerConversationRow>('buyer_conversations', {
      filter: { conversation_id: conversationId }, limit: 1,
    })[0] ?? null;
    if (product && listing && conv) {
      bumpCountersAndCloseLog(input.store, {
        logId: log.id, productId, product, listing, conv,
      });
    } else {
      input.store.update<FulfillmentLogRow>('fulfillment_log', log.id, {
        status: 'sent', sent_at: new Date().toISOString(), failure_reason: '',
      });
    }
    return { ok: true, status: 'sent', logId: log.id, message: '已重发。' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : '重发失败';
    input.store.update<FulfillmentLogRow>('fulfillment_log', log.id, {
      status: 'failed', failure_reason: reason,
    });
    return { ok: false, status: 'failed', logId: log.id, message: reason };
  }
}
