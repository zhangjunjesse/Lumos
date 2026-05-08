import crypto from 'node:crypto';

import type { AccountStatusEntry } from '@/lib/goofish/auth';
import { listAccountStatuses } from '@/lib/goofish/auth';
import { isGoofishInstalled } from '@/lib/goofish/cli';
import { getInbox, type InboxSession } from '@/lib/goofish/inbox';
import { sendMessage } from '@/lib/goofish/messages';
import { runSyncAllAccounts, type SyncResult } from '@/lib/goofish/sync';

import type { AppManifest } from './manifest/types';
import type { AppDataStore, AppRow } from './runtime/data-store';

export interface GoofishAppSyncOptions {
  fetchNum?: number;
  watchSecs?: number;
  messageLimit?: number;
  sessionLimit?: number;
  messagesPerChat?: number;
}

export interface GoofishAppSyncResult {
  ok: boolean;
  runId: string;
  message: string;
  accountsWritten: number;
  conversationsWritten: number;
  itemMarksWritten: number;
  messagesSeen: number;
  syncResults: SyncResult[];
  error?: string;
}

export interface GoofishDraftSendResult {
  ok: boolean;
  runId: string;
  message: string;
  draftId: string;
  conversationId?: string;
  error?: string;
}

interface GoofishAppSyncInput {
  manifest: AppManifest;
  store: AppDataStore;
  options?: GoofishAppSyncOptions;
  deps?: Partial<GoofishAppSyncDeps>;
}

export interface GoofishAppSyncDeps {
  now: () => number;
  isInstalled: () => boolean;
  listAccounts: () => Promise<AccountStatusEntry[]>;
  runSyncAllAccounts: (opts: GoofishAppSyncOptions) => Promise<SyncResult[]>;
  getInbox: (opts: {
    sessionLimit: number;
    messagesPerChat: number;
  }) => InboxSession[];
  sendMessage: (cid: string, toid: string, text: string) => Promise<void>;
}

type GoofishAccountRow = {
  account_label?: string;
  account_unb?: string;
  login_status?: 'needs_auth' | 'ready' | 'failed' | 'unknown';
  sync_status?: 'not_connected' | 'idle' | 'syncing' | 'success' | 'failed';
  last_sync_at?: string;
  last_error?: string;
  updated_at?: string;
};

type BuyerConversationRow = {
  conversation_id?: string;
  account_unb?: string;
  buyer_name?: string;
  buyer_user_id?: string;
  item_id?: string;
  item_title?: string;
  unread_count?: number;
  last_message?: string;
  last_message_at?: string;
  reply_status?: '待回复' | '已草稿' | '待确认' | '已回复' | '忽略';
  priority?: '普通' | '重要' | '紧急';
  notes?: string;
  updated_at?: string;
};

type ItemMarkRow = {
  item_id?: string;
  item_title?: string;
  status?: '只读' | '待处理' | '重点跟进' | '已关闭';
  notes?: string;
  updated_at?: string;
};

type ReplyDraftRow = {
  conversation_id?: string;
  buyer_name?: string;
  item_title?: string;
  incoming_message?: string;
  draft_text?: string;
  status?: 'draft' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';
  confirmation_channel?: '应用内确认' | '微信 IM 确认' | '未确认';
  risk_note?: string;
  failure_reason?: string;
  updated_at?: string;
};

const defaultDeps: GoofishAppSyncDeps = {
  now: () => Date.now(),
  isInstalled: isGoofishInstalled,
  listAccounts: listAccountStatuses,
  runSyncAllAccounts: (opts) => runSyncAllAccounts(opts),
  getInbox: (opts) => getInbox(opts),
  sendMessage,
};

export function isGoofishNativeApp(manifest: AppManifest): boolean {
  const text = [
    manifest.id,
    manifest.name,
    manifest.description ?? '',
    ...(manifest.tags ?? []),
  ].join('\n');
  return /(goofish|xianyu|闲鱼|咸鱼)/i.test(text);
}

export async function syncGoofishIntoApp(
  input: GoofishAppSyncInput,
): Promise<GoofishAppSyncResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    throw new Error('当前应用未声明为闲鱼类应用，不能调用 goofish 原生同步。');
  }

  const deps = { ...defaultDeps, ...(input.deps ?? {}) };
  const now = deps.now();
  const updatedAt = new Date(now).toISOString();
  const run = input.store.create('run_history', {
    title: '同步闲鱼数据',
    status: 'running',
    summary: '正在通过 Lumos 受控闲鱼集成同步账号、买家会话和商品上下文。',
    updated_at: updatedAt,
  });

  try {
    if (!deps.isInstalled()) {
      const message = '未检测到闲鱼 CLI / 受控集成，请先在「扩展 > 闲鱼」完成安装。';
      writeSetupRequiredAccount(input.store, message, updatedAt);
      return finishRun(input.store, run.id, {
        ok: false,
        runId: run.id,
        message,
        accountsWritten: 1,
        conversationsWritten: 0,
        itemMarksWritten: 0,
        messagesSeen: 0,
        syncResults: [],
        error: message,
      }, updatedAt);
    }

    const accounts = await deps.listAccounts();
    if (accounts.length === 0) {
      const message = '没有已授权的闲鱼账号，请先在「扩展 > 闲鱼」登录。';
      writeSetupRequiredAccount(input.store, message, updatedAt);
      return finishRun(input.store, run.id, {
        ok: false,
        runId: run.id,
        message,
        accountsWritten: 1,
        conversationsWritten: 0,
        itemMarksWritten: 0,
        messagesSeen: 0,
        syncResults: [],
        error: message,
      }, updatedAt);
    }

    for (const account of accounts) {
      upsertAccount(input.store, account, {
        syncStatus: 'syncing',
        lastError: '',
        updatedAt,
      });
    }

    const syncResults = await deps.runSyncAllAccounts({
      fetchNum: input.options?.fetchNum ?? 80,
      watchSecs: input.options?.watchSecs ?? 6,
      messageLimit: input.options?.messageLimit ?? 20,
    });
    const resultByAccount = new Map(syncResults.map((result) => [result.accountUnb, result]));
    for (const account of accounts) {
      const result = resultByAccount.get(account.accountUnb);
      upsertAccount(input.store, account, {
        syncStatus: result?.ok ? 'success' : 'failed',
        lastError: result?.ok ? '' : result?.error ?? '同步失败',
        updatedAt,
      });
    }

    const inbox = deps.getInbox({
      sessionLimit: input.options?.sessionLimit ?? 80,
      messagesPerChat: input.options?.messagesPerChat ?? 8,
    });
    const conversationsWritten = upsertConversations(input.store, inbox, updatedAt);
    const itemMarksWritten = upsertItemMarks(input.store, inbox, updatedAt);
    const messagesSeen = inbox.reduce((sum, session) => sum + session.recent.length, 0);
    const okCount = syncResults.filter((result) => result.ok).length;
    const ok = okCount > 0;
    const message = ok
      ? `已同步 ${okCount}/${syncResults.length} 个闲鱼账号，写入 ${conversationsWritten} 个买家会话、${itemMarksWritten} 个商品标记。`
      : `闲鱼同步失败：${syncResults.map((result) => result.error).filter(Boolean).join('；') || '没有账号同步成功'}`;

    return finishRun(input.store, run.id, {
      ok,
      runId: run.id,
      message,
      accountsWritten: accounts.length,
      conversationsWritten,
      itemMarksWritten,
      messagesSeen,
      syncResults,
      error: ok ? undefined : message,
    }, updatedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finishRun(input.store, run.id, {
      ok: false,
      runId: run.id,
      message,
      accountsWritten: 0,
      conversationsWritten: 0,
      itemMarksWritten: 0,
      messagesSeen: 0,
      syncResults: [],
      error: message,
    }, updatedAt);
  }
}

export async function sendGoofishDraftFromApp(input: {
  manifest: AppManifest;
  store: AppDataStore;
  rowId: string;
  confirmed: boolean;
  deps?: Partial<GoofishAppSyncDeps>;
}): Promise<GoofishDraftSendResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    throw new Error('当前应用未声明为闲鱼类应用，不能调用 goofish 原生发送。');
  }

  const deps = { ...defaultDeps, ...(input.deps ?? {}) };
  const updatedAt = new Date(deps.now()).toISOString();
  const run = input.store.create('run_history', {
    title: '发送闲鱼回复草稿',
    status: 'running',
    summary: '正在发送已确认的闲鱼回复草稿。',
    updated_at: updatedAt,
  });

  const fail = (
    message: string,
    opts: { markDraftFailed?: boolean } = { markDraftFailed: true },
  ): GoofishDraftSendResult => {
    input.store.update('run_history', run.id, {
      status: 'failed',
      summary: message,
      failure_reason: message,
      updated_at: updatedAt,
    });
    if (input.rowId && opts.markDraftFailed !== false) {
      input.store.update<ReplyDraftRow>('reply_drafts', input.rowId, {
        status: 'failed',
        failure_reason: message,
        updated_at: updatedAt,
      });
    }
    return {
      ok: false,
      runId: run.id,
      draftId: input.rowId,
      message,
      error: message,
    };
  };

  if (!input.confirmed) {
    return fail('发送闲鱼回复草稿前必须由用户在界面明确确认。');
  }

  const draft = input.store.get<ReplyDraftRow>('reply_drafts', input.rowId);
  if (!draft) {
    return fail('找不到要发送的回复草稿。');
  }
  if (draft.status === 'sent') {
    return fail('这条回复草稿已经发送过，不能重复发送。', { markDraftFailed: false });
  }
  const conversationId = (draft.conversation_id ?? '').trim();
  const draftText = (draft.draft_text ?? '').trim();
  if (!conversationId || !draftText) {
    return fail('回复草稿缺少明确会话 ID 或草稿正文，不能发送。');
  }

  const conversation = input.store
    .query<BuyerConversationRow>('buyer_conversations', {
      filter: { conversation_id: conversationId },
      limit: 1,
    })[0] ?? null;
  const buyerUserId = (conversation?.buyer_user_id ?? '').trim();
  if (!buyerUserId) {
    return fail('当前草稿没有绑定可发送的买家用户 ID；请先同步闲鱼数据后再发送。');
  }

  try {
    await deps.sendMessage(conversationId, buyerUserId, draftText);
    input.store.update<ReplyDraftRow>('reply_drafts', input.rowId, {
      status: 'sent',
      confirmation_channel: '应用内确认',
      failure_reason: '',
      updated_at: updatedAt,
    });
    if (conversation?.id) {
      input.store.update<BuyerConversationRow>('buyer_conversations', conversation.id, {
        reply_status: '已回复',
        unread_count: 0,
        updated_at: updatedAt,
      });
    }
    const message = `已发送给 ${draft.buyer_name || conversation?.buyer_name || '买家'}，会话 ${conversationId}。`;
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
      conversationId,
      message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  }
}

function finishRun(
  store: AppDataStore,
  runId: string,
  result: GoofishAppSyncResult,
  updatedAt: string,
): GoofishAppSyncResult {
  store.update('run_history', runId, {
    status: result.ok ? 'success' : 'failed',
    summary: result.message,
    failure_reason: result.ok ? '' : result.error ?? result.message,
    updated_at: updatedAt,
  });
  return result;
}

function writeSetupRequiredAccount(store: AppDataStore, message: string, updatedAt: string): void {
  upsertRow<GoofishAccountRow>(store, 'goofish_accounts', 'goofish_account_setup_required', {
    account_label: '待授权闲鱼账号',
    account_unb: '',
    login_status: 'needs_auth',
    sync_status: 'not_connected',
    last_error: message,
    updated_at: updatedAt,
  });
}

function upsertAccount(
  store: AppDataStore,
  account: AccountStatusEntry,
  input: {
    syncStatus: GoofishAccountRow['sync_status'];
    lastError: string;
    updatedAt: string;
  },
): void {
  const label = account.nick || account.tracknick || account.unb || account.accountUnb;
  upsertRow<GoofishAccountRow>(store, 'goofish_accounts', stableId('goofish_account', account.accountUnb), {
    account_label: label || '闲鱼账号',
    account_unb: account.accountUnb,
    login_status: account.valid ? 'ready' : 'failed',
    sync_status: input.syncStatus,
    last_sync_at: input.syncStatus === 'success' ? input.updatedAt : '',
    last_error: account.valid ? input.lastError : input.lastError || '账号登录已失效，请重新登录。',
    updated_at: input.updatedAt,
  });
}

function upsertConversations(
  store: AppDataStore,
  inbox: InboxSession[],
  updatedAt: string,
): number {
  let written = 0;
  for (const session of inbox) {
    const latest = latestMessage(session);
    const id = stableId('goofish_conversation', session.cid);
    const existing = store.get<BuyerConversationRow>('buyer_conversations', id);
    upsertRow<BuyerConversationRow>(store, 'buyer_conversations', id, {
      conversation_id: session.cid,
      account_unb: session.account_unb,
      buyer_name: session.peer_nick || session.peer_user_id || '未命名买家',
      buyer_user_id: session.peer_user_id,
      item_id: session.item_id,
      item_title: session.item_title,
      unread_count: Number(session.unread) || 0,
      last_message: latest?.content_text || session.last_msg || '',
      last_message_at: latest ? new Date(latest.created_at).toISOString() : '',
      reply_status: nextReplyStatus(existing, session, latest),
      priority: existing?.priority ?? (Number(session.unread) > 0 ? '重要' : '普通'),
      notes: existing?.notes ?? '',
      updated_at: updatedAt,
    });
    written += 1;
  }
  return written;
}

function upsertItemMarks(
  store: AppDataStore,
  inbox: InboxSession[],
  updatedAt: string,
): number {
  const seen = new Set<string>();
  let written = 0;
  for (const session of inbox) {
    const key = session.item_id || session.item_title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const id = stableId('goofish_item', key);
    const existing = store.get<ItemMarkRow>('item_marks', id);
    upsertRow<ItemMarkRow>(store, 'item_marks', id, {
      item_id: session.item_id,
      item_title: session.item_title || '未命名商品',
      status: existing?.status ?? '只读',
      notes: existing?.notes ?? '来自闲鱼会话同步的只读商品上下文。',
      updated_at: updatedAt,
    });
    written += 1;
  }
  return written;
}

function latestMessage(session: InboxSession): InboxSession['recent'][number] | null {
  return session.recent.length > 0 ? session.recent[session.recent.length - 1] : null;
}

function nextReplyStatus(
  existing: AppRow<BuyerConversationRow> | null,
  session: InboxSession,
  latest: InboxSession['recent'][number] | null,
): BuyerConversationRow['reply_status'] {
  const latestFromBuyer = Boolean(latest?.from_user_id && latest.from_user_id !== session.account_unb);
  if (Number(session.unread) > 0 || latestFromBuyer) {
    if (existing?.reply_status === '已草稿' || existing?.reply_status === '待确认') {
      return existing.reply_status;
    }
    return '待回复';
  }
  return existing?.reply_status ?? '已回复';
}

function upsertRow<T extends Record<string, unknown>>(
  store: AppDataStore,
  collection: string,
  id: string,
  data: T,
): AppRow<T> {
  const existing = store.get<T>(collection, id);
  if (existing) return store.update<T>(collection, id, data) ?? existing;
  return store.create<T>(collection, { ...data, id });
}

function stableId(prefix: string, value: string): string {
  const hash = crypto.createHash('sha1').update(value || prefix).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}
