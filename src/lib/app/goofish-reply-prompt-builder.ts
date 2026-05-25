/**
 * Reply draft prompts — 议价 + 商品级 AI 提示词 + 买家上下文。
 * 从 goofish-reply-draft-generator 拆出来，避免主文件超 300 行。
 */
import type { AppDataStore, AppRow } from './runtime/data-store';
import type { AppManifest } from './manifest/types';

export interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  item_id?: string;
  item_title?: string;
  unread_count?: number;
  last_message?: string;
  reply_status?: '待回复' | '已草稿' | '待确认' | '已回复' | '忽略';
  priority?: '普通' | '重要' | '紧急';
  notes?: string;
}

export interface ItemMarkRow extends Record<string, unknown> {
  item_id?: string;
  item_title?: string;
  status?: string;
  notes?: string;
}

export interface AppSettingsRow extends Record<string, unknown> {
  ai_system_prompt?: string;
  risk_note?: string;
}

export interface ProductContextRow extends Record<string, unknown> {
  id?: string;
  title?: string;
  ai_prompt?: string;
  min_price?: number;
  listed_price?: number;
}

interface ProductListingForContext extends Record<string, unknown> {
  product_id?: string;
  listed_price?: number;
}

interface ProductForContext extends Record<string, unknown> {
  title?: string;
  ai_prompt?: string;
  min_price?: number;
}

export function loadProductContextForConversation(
  store: AppDataStore,
  conversation: AppRow<BuyerConversationRow>,
): ProductContextRow | null {
  const itemId = textValue(conversation.item_id);
  if (!itemId) return null;
  const listing = store.query<ProductListingForContext>('product_listings', {
    filter: { item_id: itemId }, limit: 1,
  })[0];
  if (!listing) return null;
  const productId = textValue(listing.product_id);
  if (!productId) return null;
  const product = store.get<ProductForContext>('products', productId);
  if (!product) return null;
  return {
    id: productId,
    title: textValue(product.title),
    ai_prompt: textValue(product.ai_prompt),
    min_price: typeof product.min_price === 'number' ? product.min_price : undefined,
    listed_price: typeof listing.listed_price === 'number' ? listing.listed_price : undefined,
  };
}

export function buildReplyDraftPrompts(input: {
  manifest: AppManifest;
  conversation: AppRow<BuyerConversationRow>;
  settings: AppSettingsRow;
  itemContext: ItemMarkRow | null;
  productContext?: ProductContextRow | null;
}): { system: string; prompt: string } {
  const riskNote = textValue(input.settings.risk_note);
  const globalPrompt = textValue(input.settings.ai_system_prompt);
  const productPrompt = textValue(input.productContext?.ai_prompt);
  // 商品级提示词 > 全局提示词 > 默认
  const customPrompt = productPrompt || globalPrompt;
  const priceLines = buildPriceStrategyLines(input.productContext);

  const system = [
    customPrompt || `你是 Lumos 应用「${input.manifest.name}」里的闲鱼回复草稿生成器。`,
    '只输出一条回复草稿正文，不要输出解释、标题、Markdown、JSON 或动作块。',
    '草稿必须短、礼貌、可由卖家人工审核后再发送。',
    '不得承诺平台外交易、绕过平台规则、未核实库存、自动发货或已经发送。',
    ...priceLines,
    riskNote ? `应用风险边界：${riskNote}` : '',
  ].filter(Boolean).join('\n');

  const c = input.conversation;
  const prompt = [
    '请根据下面闲鱼买家会话生成一条待人工确认的回复草稿。',
    `买家：${textValue(c.buyer_name) || '买家'}`,
    textValue(c.item_title) ? `商品：${textValue(c.item_title)}` : '',
    `最近消息：${textValue(c.last_message)}`,
    `未读数：${Number(c.unread_count ?? 0) || 0}`,
    textValue(c.reply_status) ? `回复状态：${textValue(c.reply_status)}` : '',
    textValue(c.priority) ? `优先级：${textValue(c.priority)}` : '',
    textValue(c.notes) ? `卖家备注：${textValue(c.notes)}` : '',
    input.itemContext
      ? [
        '商品标记：',
        textValue(input.itemContext.status) ? `标记=${textValue(input.itemContext.status)}` : '',
        textValue(input.itemContext.notes) ? `备注=${textValue(input.itemContext.notes)}` : '',
      ].filter(Boolean).join(' ')
      : '',
    '输出要求：只输出草稿正文；不要替用户发送；不要要求买家脱离闲鱼交易。',
  ].filter(Boolean).join('\n');

  return { system, prompt };
}

function buildPriceStrategyLines(product: ProductContextRow | null | undefined): string[] {
  if (!product) return [];
  const listedPrice = product.listed_price;
  const minPrice = typeof product.min_price === 'number' ? product.min_price : 0;
  const lines: string[] = [];
  if (typeof listedPrice === 'number' && listedPrice > 0) {
    lines.push(`商品挂牌价：￥${listedPrice}`);
  }
  if (minPrice > 0) {
    lines.push(`【议价底线】允许让步到 ￥${minPrice}，绝对不能低于这个价。`);
    lines.push('议价策略：买家第一次砍价时按 (挂牌价 - 底线) 的 1/3 让步；第二次让步 1/3；接近底线时坚持不再让。');
    lines.push('如果买家要的价格低于底线，礼貌拒绝并解释"亏本不卖"，不要假装去问"上级"。');
  } else if (typeof listedPrice === 'number' && listedPrice > 0) {
    lines.push('议价策略：当前商品没有设议价底线，遇到砍价请回复"价格已经是底价"或转人工。');
  }
  return lines;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** AI provider 不可用时的兜底草稿，按买家意图选模板。 */
export function buildFallbackDraft(input: {
  buyerName: string;
  itemTitle: string;
  lastMessage: string;
}): string {
  const item = input.itemTitle ? `这件「${input.itemTitle}」` : '这个商品';
  const concern = inferConcern(input.lastMessage);
  switch (concern) {
    case 'price':
      return `您好，${item}还在的。价格我需要再确认一下可优惠空间，您可以先说下心理价位，我确认后再回复您。`;
    case 'availability':
      return `您好，${item}目前还在。我再确认一下商品状态和细节，确认后马上回复您。`;
    case 'shipping':
      return `您好，${item}可以继续沟通。运费和发货时间我需要按地址和商品情况确认一下，确认后回复您。`;
    default:
      return `您好，收到您的消息了。${item}的情况我先确认一下，稍后给您准确回复。`;
  }
}

function inferConcern(message: string): 'price' | 'availability' | 'shipping' | 'general' {
  if (/(便宜|优惠|刀|最低|价格|多少钱|包邮)/.test(message)) return 'price';
  if (/(还在|有吗|出了没|卖了吗|库存)/.test(message)) return 'availability';
  if (/(发货|快递|邮费|运费|几天|到哪里)/.test(message)) return 'shipping';
  return 'general';
}
