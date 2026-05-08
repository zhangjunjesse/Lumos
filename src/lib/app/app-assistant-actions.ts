import type { AppManifest } from './manifest/types';

export interface CreateReplyDraftAction {
  type: 'create_reply_draft';
  buyerName: string;
  itemTitle?: string;
  conversationId?: string;
  incomingMessage?: string;
  draftText: string;
  reason?: string;
  riskNote?: string;
}

export interface RunSelfCheckAction {
  type: 'run_self_check';
  reason?: string;
}

export type AppAssistantAction = CreateReplyDraftAction | RunSelfCheckAction;

const ACTION_BLOCK_RE = /\[APP_ACTION\]([\s\S]*?)\[\/APP_ACTION\]/g;

export function supportsReplyDraftActions(manifest: AppManifest): boolean {
  const text = `${manifest.id}\n${manifest.name}\n${manifest.description ?? ''}`.toLowerCase();
  return /(goofish|xianyu|闲鱼|咸鱼)/i.test(text);
}

export function stripAppAssistantActionBlocks(text: string): string {
  return text.replace(ACTION_BLOCK_RE, '').trim();
}

export function parseAppAssistantActions(text: string): AppAssistantAction[] {
  const actions: AppAssistantAction[] = [];
  for (const match of text.matchAll(ACTION_BLOCK_RE)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const parsed = safeJson<Record<string, unknown>>(raw);
    const action = parsed ? normalizeAction(parsed) : null;
    if (action) actions.push(action);
  }
  return actions;
}

function normalizeAction(value: Record<string, unknown>): AppAssistantAction | null {
  if (value.type === 'run_self_check') {
    return {
      type: 'run_self_check',
      reason: stringValue(value.reason) || undefined,
    };
  }
  if (value.type !== 'create_reply_draft') return null;
  const draftText = stringValue(value.draft_text ?? value.draftText);
  if (!draftText) return null;
  return {
    type: 'create_reply_draft',
    buyerName: stringValue(value.buyer_name ?? value.buyerName) || '未命名买家',
    itemTitle: stringValue(value.item_title ?? value.itemTitle) || undefined,
    conversationId: stringValue(value.conversation_id ?? value.conversationId) || undefined,
    incomingMessage: stringValue(value.incoming_message ?? value.incomingMessage) || undefined,
    draftText,
    reason: stringValue(value.reason) || undefined,
    riskNote: stringValue(value.risk_note ?? value.riskNote) || undefined,
  };
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
