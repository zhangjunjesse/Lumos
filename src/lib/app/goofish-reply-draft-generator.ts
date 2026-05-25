import { getProviderModelOptions } from '@/lib/model-metadata';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateTextFromProvider } from '@/lib/text-generator';

import { isGoofishNativeApp } from './goofish-app-sync';
import {
  buildFallbackDraft,
  buildReplyDraftPrompts,
  loadProductContextForConversation,
} from './goofish-reply-prompt-builder';
import type { AppManifest } from './manifest/types';
import type { AppDataStore, AppRow } from './runtime/data-store';

export interface GoofishReplyDraftGenerationResult {
  ok: boolean;
  runId: string;
  message: string;
  conversationRowId: string;
  draftId?: string;
  confirmationCode?: string;
  conversationId?: string;
  providerId?: string;
  model?: string;
  usedFallback?: boolean;
  error?: string;
}

export interface GoofishReplyDraftGeneratorDeps {
  now?: () => number;
  generateDraftText?: (input: {
    system: string;
    prompt: string;
    maxTokens: number;
    temperature: number;
  }) => Promise<{ text: string; providerId?: string; model?: string }>;
}

interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  item_id?: string;
  item_title?: string;
  unread_count?: number;
  last_message?: string;
  reply_status?: '待回复' | '已草稿' | '待确认' | '已回复' | '忽略';
  priority?: '普通' | '重要' | '紧急';
  notes?: string;
  updated_at?: string;
}

interface ReplyDraftRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  item_title?: string;
  incoming_message?: string;
  draft_text?: string;
  status?: 'draft' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';
  confirmation_channel?: '应用内确认' | '微信 IM 确认' | '未确认';
  confirmation_code?: string;
  confirmation_expires_at?: string;
  risk_note?: string;
  failure_reason?: string;
  updated_at?: string;
}

interface AppSettingsRow extends Record<string, unknown> {
  ai_system_prompt?: string;
  risk_note?: string;
}

interface ItemMarkRow extends Record<string, unknown> {
  item_id?: string;
  item_title?: string;
  status?: string;
  notes?: string;
}

export async function generateGoofishReplyDraft(input: {
  manifest: AppManifest;
  store: AppDataStore;
  rowId: string;
  deps?: GoofishReplyDraftGeneratorDeps;
}): Promise<GoofishReplyDraftGenerationResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    throw new Error('当前应用未声明为闲鱼类应用，不能生成闲鱼回复草稿。');
  }

  const now = input.deps?.now?.() ?? Date.now();
  const updatedAt = new Date(now).toISOString();
  const run = input.store.create('run_history', {
    title: '生成闲鱼回复草稿',
    status: 'running',
    summary: '正在根据买家会话生成回复草稿；只会保存草稿，不会发送消息。',
    updated_at: updatedAt,
  });

  const fail = (message: string): GoofishReplyDraftGenerationResult => {
    input.store.update('run_history', run.id, {
      status: 'failed',
      summary: message,
      failure_reason: message,
      updated_at: updatedAt,
    });
    return {
      ok: false,
      runId: run.id,
      message,
      conversationRowId: input.rowId,
      error: message,
    };
  };

  const conversation = input.store.get<BuyerConversationRow>('buyer_conversations', input.rowId);
  if (!conversation) {
    return fail('找不到要生成草稿的买家会话。');
  }

  const buyerName = textValue(conversation.buyer_name) || '买家';
  const lastMessage = textValue(conversation.last_message);
  const itemTitle = textValue(conversation.item_title);
  if (!lastMessage) {
    return fail('当前买家会话缺少最近消息，无法生成可审核的回复草稿。');
  }

  const settings = loadLatestSettings(input.store);
  const itemContext = loadItemContext(input.store, conversation);
  const productContext = loadProductContextForConversation(input.store, conversation);
  const prompts = buildReplyDraftPrompts({
    manifest: input.manifest,
    conversation,
    settings,
    itemContext,
    productContext,
  });

  let generated: { text: string; providerId?: string; model?: string } | null = null;
  let fallbackReason = '';
  const generateDraftText = input.deps?.generateDraftText ?? generateDraftTextWithConfiguredProvider;
  try {
    generated = await generateDraftText({
      system: prompts.system,
      prompt: prompts.prompt,
      maxTokens: 700,
      temperature: 0.2,
    });
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : String(error);
  }

  let draftText = normalizeDraftText(generated?.text ?? '');
  if (!draftText) {
    fallbackReason = fallbackReason || 'AI 没有返回可保存的草稿正文。';
    draftText = buildFallbackDraft({
      buyerName,
      itemTitle,
      lastMessage,
    });
  }

  const riskNote = [
    fallbackReason
      ? `AI 草稿生成不可用或返回异常，已使用保守模板草稿：${clip(fallbackReason, 120)}。`
      : 'AI 已根据当前买家会话生成回复草稿。',
    '这只是草稿；发送前必须由用户在应用内确认。',
    textValue(settings.risk_note) || '不得承诺平台外交易、未核实库存、绕过平台规则或自动降价。',
  ].join('\n');

  const draft = input.store.create<ReplyDraftRow>('reply_drafts', {
    conversation_id: textValue(conversation.conversation_id),
    buyer_name: buyerName,
    item_title: itemTitle,
    incoming_message: lastMessage,
    draft_text: draftText,
    status: 'draft',
    confirmation_channel: '未确认',
    risk_note: riskNote,
    failure_reason: '',
    updated_at: updatedAt,
  });
  const confirmationCode = draftConfirmationCode(draft.id);
  input.store.update<ReplyDraftRow>('reply_drafts', draft.id, {
    confirmation_code: confirmationCode,
    confirmation_expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    updated_at: updatedAt,
  });

  input.store.update<BuyerConversationRow>('buyer_conversations', conversation.id, {
    reply_status: '已草稿',
    updated_at: updatedAt,
  });

  const message = fallbackReason
    ? `已为 ${buyerName} 保存一条保守模板回复草稿；AI 生成未完成，发送前仍需人工确认。`
    : `已为 ${buyerName} 保存一条回复草稿；发送前仍需人工确认。`;
  input.store.update('run_history', run.id, {
    status: 'success',
    summary: message,
    failure_reason: '',
    updated_at: updatedAt,
  });

  return {
    ok: true,
    runId: run.id,
    message,
    conversationRowId: input.rowId,
    draftId: draft.id,
    confirmationCode,
    conversationId: textValue(conversation.conversation_id) || undefined,
    providerId: generated?.providerId,
    model: generated?.model,
    usedFallback: Boolean(fallbackReason),
  };
}

export function draftConfirmationCode(id: string): string {
  const normalized = id.replace(/[^a-z0-9]/gi, '');
  return (normalized || id).slice(0, 8);
}

function loadLatestSettings(store: AppDataStore): AppSettingsRow {
  return store.query<AppSettingsRow>('app_settings', { limit: 1 })[0] ?? {};
}

function loadItemContext(
  store: AppDataStore,
  conversation: AppRow<BuyerConversationRow>,
): ItemMarkRow | null {
  const itemId = textValue(conversation.item_id);
  if (itemId) {
    const byId = store.query<ItemMarkRow>('item_marks', {
      filter: { item_id: itemId },
      limit: 1,
    })[0];
    if (byId) return byId;
  }

  const itemTitle = textValue(conversation.item_title);
  if (!itemTitle) return null;
  return store.query<ItemMarkRow>('item_marks', {
    filter: { item_title: itemTitle },
    limit: 1,
  })[0] ?? null;
}

async function generateDraftTextWithConfiguredProvider(input: {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ text: string; providerId?: string; model?: string }> {
  const provider = resolveProviderForCapability({
    moduleKey: 'chat',
    capability: 'text-gen',
  });
  if (!provider) {
    throw new Error('未配置可用的文本生成服务商。');
  }
  const model = getProviderModelOptions(provider)[0]?.value?.trim() || '';
  if (!model) {
    throw new Error(`服务商“${provider.name}”没有可用模型。`);
  }
  const text = await generateTextFromProvider({
    providerId: provider.id,
    model,
    system: input.system,
    prompt: input.prompt,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    abortSignal: AbortSignal.timeout(120_000),
  });
  return { text, providerId: provider.id, model };
}

function normalizeDraftText(text: string): string {
  let normalized = text.trim();
  normalized = normalized.replace(/\[APP_ACTION\][\s\S]*?\[\/APP_ACTION\]/g, '').trim();
  normalized = normalized.replace(/^```(?:text|markdown)?\s*/i, '').replace(/```$/i, '').trim();
  normalized = normalized.replace(/^回复草稿[:：]\s*/, '').trim();
  normalized = normalized.replace(/^["“]|["”]$/g, '').trim();
  return clip(normalized, 1200);
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
