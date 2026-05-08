import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';
import type { AppDataStore } from './runtime/data-store';

export interface GoofishDraftControlResult {
  ok: boolean;
  runId: string;
  message: string;
  draftId: string;
  error?: string;
}

interface ReplyDraftRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  item_title?: string;
  draft_text?: string;
  status?: 'draft' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';
  confirmation_channel?: '应用内确认' | '微信 IM 确认' | '未确认';
  failure_reason?: string;
  updated_at?: string;
}

interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  reply_status?: '待回复' | '已草稿' | '待确认' | '已回复' | '忽略';
  updated_at?: string;
}

export function rejectGoofishDraftFromApp(input: {
  manifest: AppManifest;
  store: AppDataStore;
  rowId: string;
  confirmed: boolean;
  now?: number;
}): GoofishDraftControlResult {
  if (!isGoofishNativeApp(input.manifest)) {
    throw new Error('当前应用未声明为闲鱼类应用，不能拒绝闲鱼回复草稿。');
  }

  const now = input.now ?? Date.now();
  const updatedAt = new Date(now).toISOString();
  const run = input.store.create('run_history', {
    title: '拒绝闲鱼回复草稿',
    status: 'running',
    summary: '正在拒绝本地回复草稿；不会发送任何消息。',
    updated_at: updatedAt,
  });

  const fail = (message: string): GoofishDraftControlResult => {
    input.store.update('run_history', run.id, {
      status: 'failed',
      summary: message,
      failure_reason: message,
      updated_at: updatedAt,
    });
    return {
      ok: false,
      runId: run.id,
      draftId: input.rowId,
      message,
      error: message,
    };
  };

  if (!input.confirmed) {
    return fail('拒绝回复草稿前必须由用户明确确认。');
  }

  const draft = input.store.get<ReplyDraftRow>('reply_drafts', input.rowId);
  if (!draft) {
    return fail('找不到要拒绝的回复草稿。');
  }
  if (draft.status === 'sent') {
    return fail('这条回复草稿已经发送，不能再拒绝。');
  }
  if (draft.status === 'rejected') {
    const message = '这条回复草稿已经是已拒绝状态。';
    input.store.update('run_history', run.id, {
      status: 'success',
      summary: message,
      failure_reason: '',
      updated_at: updatedAt,
    });
    return {
      ok: true,
      runId: run.id,
      draftId: input.rowId,
      message,
    };
  }

  input.store.update<ReplyDraftRow>('reply_drafts', input.rowId, {
    status: 'rejected',
    failure_reason: '用户已拒绝该草稿；不会发送。',
    updated_at: updatedAt,
  });

  const conversationId = stringValue(draft.conversation_id);
  if (conversationId) {
    const conversation = input.store.query<BuyerConversationRow>('buyer_conversations', {
      filter: { conversation_id: conversationId },
      limit: 1,
    })[0];
    if (conversation && (conversation.reply_status === '已草稿' || conversation.reply_status === '待确认')) {
      input.store.update<BuyerConversationRow>('buyer_conversations', conversation.id, {
        reply_status: '待回复',
        updated_at: updatedAt,
      });
    }
  }

  const buyer = stringValue(draft.buyer_name) || '买家';
  const message = `已拒绝 ${buyer} 的回复草稿；不会发送。`;
  input.store.update('run_history', run.id, {
    status: 'success',
    summary: message,
    failure_reason: '',
    updated_at: updatedAt,
  });
  return {
    ok: true,
    runId: run.id,
    draftId: input.rowId,
    message,
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
