import {
  isGoofishNativeApp,
  sendGoofishDraftFromApp,
  syncGoofishIntoApp,
} from '../goofish-app-sync';
import type { AppManifest } from '../manifest/types';
import type { AppDataStore, AppRow, QueryOptions } from '../runtime/data-store';
import type { AccountStatusEntry } from '@/lib/goofish/auth';
import type { InboxSession } from '@/lib/goofish/inbox';
import type { SyncResult } from '@/lib/goofish/sync';

const manifest: AppManifest = {
  id: 'goofish-assistant',
  name: '闲鱼助手',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'inbox',
  tags: ['闲鱼'],
};

describe('goofish app sync', () => {
  it('detects Goofish-like generated apps', () => {
    expect(isGoofishNativeApp(manifest)).toBe(true);
    expect(isGoofishNativeApp({ ...manifest, id: 'crm', name: '客户跟进', tags: [] })).toBe(false);
  });

  it('writes a clear failure row when the native Goofish integration is not installed', async () => {
    const store = createMemoryStore();
    const result = await syncGoofishIntoApp({
      manifest,
      store,
      deps: {
        now: () => 1714470000000,
        isInstalled: () => false,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('扩展 > 闲鱼');
    expect(store.query('goofish_accounts')).toEqual([
      expect.objectContaining({
        account_label: '待授权闲鱼账号',
        login_status: 'needs_auth',
        sync_status: 'not_connected',
      }),
    ]);
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({
        title: '同步闲鱼数据',
        status: 'failed',
        failure_reason: expect.stringContaining('扩展 > 闲鱼'),
      }),
    ]);
  });

  it('syncs accounts, buyer conversations, item marks, and run evidence into app-local collections', async () => {
    const store = createMemoryStore();
    const account: AccountStatusEntry = {
      accountUnb: '10001',
      unb: '10001',
      nick: '卖家号',
      tracknick: '',
      valid: true,
    };
    const syncResult: SyncResult = {
      ok: true,
      accountUnb: '10001',
      sessionsTotal: 1,
      sessionsSynced: 1,
      messagesUpserted: 2,
      durationMs: 12,
    };
    const inbox: InboxSession[] = [{
      cid: 'cid-1',
      account_unb: '10001',
      session_type: 1,
      peer_user_id: 'buyer-1',
      peer_nick: '张三',
      peer_avatar: '',
      unread: 2,
      last_msg: '能便宜点吗？',
      ts: 1714470000000,
      item_id: 'item-1',
      item_title: '二手相机',
      item_main_pic: '',
      source: 'archive',
      recent: [
        {
          message_id: 'm1',
          from_user_id: 'buyer-1',
          from_user_name: '张三',
          created_at: 1714470000000,
          content_kind: 'text',
          content_text: '能便宜点吗？',
        },
      ],
    }];

    const result = await syncGoofishIntoApp({
      manifest,
      store,
      deps: {
        now: () => 1714470000000,
        isInstalled: () => true,
        listAccounts: async () => [account],
        runSyncAllAccounts: async () => [syncResult],
        getInbox: () => inbox,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      accountsWritten: 1,
      conversationsWritten: 1,
      itemMarksWritten: 1,
      messagesSeen: 1,
    });
    expect(store.query('goofish_accounts')).toEqual([
      expect.objectContaining({
        account_label: '卖家号',
        login_status: 'ready',
        sync_status: 'success',
      }),
    ]);
    expect(store.query('buyer_conversations')).toEqual([
      expect.objectContaining({
        conversation_id: 'cid-1',
        buyer_name: '张三',
        item_title: '二手相机',
        unread_count: 2,
        last_message: '能便宜点吗？',
        reply_status: '待回复',
      }),
    ]);
    expect(store.query('item_marks')).toEqual([
      expect.objectContaining({
        item_id: 'item-1',
        item_title: '二手相机',
        status: '只读',
      }),
    ]);
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({
        status: 'success',
        summary: expect.stringContaining('写入 1 个买家会话'),
      }),
    ]);
  });

  it('sends a saved draft only after explicit confirmation and a synced buyer id', async () => {
    const store = createMemoryStore();
    store.create('buyer_conversations', {
      id: 'conversation-row',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      buyer_user_id: 'buyer-1',
      reply_status: '待确认',
      unread_count: 2,
    });
    store.create('reply_drafts', {
      id: 'draft-row',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      draft_text: '您好，可以小刀一点，平台内交易更安全。',
      status: 'pending_confirmation',
      confirmation_channel: '未确认',
    });
    const send = jest.fn<Promise<void>, [string, string, string]>().mockResolvedValue(undefined);

    const result = await sendGoofishDraftFromApp({
      manifest,
      store,
      rowId: 'draft-row',
      confirmed: true,
      deps: {
        now: () => 1714470000000,
        sendMessage: send,
      },
    });

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledWith(
      'cid-1',
      'buyer-1',
      '您好，可以小刀一点，平台内交易更安全。',
    );
    expect(store.get('reply_drafts', 'draft-row')).toEqual(expect.objectContaining({
      status: 'sent',
      confirmation_channel: '应用内确认',
      failure_reason: '',
    }));
    expect(store.get('buyer_conversations', 'conversation-row')).toEqual(expect.objectContaining({
      reply_status: '已回复',
      unread_count: 0,
    }));
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({
        title: '发送闲鱼回复草稿',
        status: 'success',
      }),
    ]);
  });

  it('refuses to send a draft without UI confirmation', async () => {
    const store = createMemoryStore();
    store.create('reply_drafts', {
      id: 'draft-row',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      draft_text: '您好。',
      status: 'draft',
    });
    const send = jest.fn<Promise<void>, [string, string, string]>().mockResolvedValue(undefined);

    const result = await sendGoofishDraftFromApp({
      manifest,
      store,
      rowId: 'draft-row',
      confirmed: false,
      deps: {
        now: () => 1714470000000,
        sendMessage: send,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('明确确认');
    expect(send).not.toHaveBeenCalled();
    expect(store.get('reply_drafts', 'draft-row')).toEqual(expect.objectContaining({
      status: 'failed',
      failure_reason: expect.stringContaining('明确确认'),
    }));
  });
});

function createMemoryStore(): AppDataStore {
  const collections = new Map<string, Map<string, AppRow>>();
  let counter = 0;
  const collection = (name: string) => {
    let rows = collections.get(name);
    if (!rows) {
      rows = new Map();
      collections.set(name, rows);
    }
    return rows;
  };
  return {
    query<T = Record<string, unknown>>(name: string, opts: QueryOptions = {}): AppRow<T>[] {
      let rows = Array.from(collection(name).values()) as AppRow<T>[];
      if (opts.limit !== undefined) rows = rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
      return rows;
    },
    get<T = Record<string, unknown>>(name: string, id: string): AppRow<T> | null {
      return (collection(name).get(id) as AppRow<T> | undefined) ?? null;
    },
    create<T extends Record<string, unknown>>(name: string, data: T & { id?: string }): AppRow<T> {
      const id = data.id ?? `row-${++counter}`;
      const { id: _ignored, ...rest } = data;
      void _ignored;
      const row = { ...rest, id } as AppRow<T>;
      collection(name).set(id, row);
      return row;
    },
    update<T extends Record<string, unknown>>(name: string, id: string, patch: Partial<T>): AppRow<T> | null {
      const existing = collection(name).get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, id } as AppRow<T>;
      collection(name).set(id, next);
      return next;
    },
    delete(name: string, id: string): boolean {
      return collection(name).delete(id);
    },
    count(name: string): number {
      return collection(name).size;
    },
  };
}
