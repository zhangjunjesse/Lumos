import { runNativeAppAutomation } from '../native-automation-runner';
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

describe('native app automation runner', () => {
  it('runs the controlled Goofish sync automation and writes visible status', async () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: 'auto-sync',
      title: '同步闲鱼数据',
      enabled: true,
      schedule: '手动触发',
      native_action: 'goofish:sync',
      last_status: 'idle',
    });

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
      messagesUpserted: 1,
      durationMs: 10,
    };
    const inbox: InboxSession[] = [{
      cid: 'cid-1',
      account_unb: '10001',
      session_type: 1,
      peer_user_id: 'buyer-1',
      peer_nick: '张三',
      peer_avatar: '',
      unread: 1,
      last_msg: '还在吗？',
      ts: 1714470000000,
      item_id: 'item-1',
      item_title: '二手相机',
      item_main_pic: '',
      source: 'archive',
      recent: [{
        message_id: 'm1',
        from_user_id: 'buyer-1',
        from_user_name: '张三',
        created_at: 1714470000000,
        content_kind: 'text',
        content_text: '还在吗？',
      }],
    }];

    const result = await runNativeAppAutomation({
      manifest,
      store,
      rowId: 'auto-sync',
      confirmed: true,
      deps: {
        now: () => 1714470000000,
        goofish: {
          now: () => 1714470000000,
          isInstalled: () => true,
          listAccounts: async () => [account],
          runSyncAllAccounts: async () => [syncResult],
          getInbox: () => inbox,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.nativeAction).toBe('goofish:sync');
    expect(store.get('app_automations', 'auto-sync')).toEqual(expect.objectContaining({
      last_status: 'success',
      last_run_id: result.runId,
      last_run_summary: expect.stringContaining('写入 1 个买家会话'),
    }));
    expect(store.query('buyer_conversations')).toEqual([
      expect.objectContaining({ conversation_id: 'cid-1', buyer_name: '张三' }),
    ]);
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({ title: '同步闲鱼数据', status: 'success' }),
    ]);
  });

  it('requires explicit UI confirmation before running an automation', async () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: 'auto-sync',
      title: '同步闲鱼数据',
      enabled: true,
      native_action: 'goofish:sync',
      last_status: 'idle',
    });

    const result = await runNativeAppAutomation({
      manifest,
      store,
      rowId: 'auto-sync',
      confirmed: false,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('明确确认');
    expect(store.get('app_automations', 'auto-sync')).toEqual(expect.objectContaining({
      last_status: 'failed',
      last_run_summary: expect.stringContaining('明确确认'),
      last_run_id: result.runId,
    }));
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({ status: 'failed', failure_reason: expect.stringContaining('明确确认') }),
    ]);
  });

  it('keeps unsupported automation actions visible as failed instead of pretending success', async () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: 'auto-risky',
      title: '自动改价',
      enabled: true,
      native_action: 'goofish:change-price',
      last_status: 'idle',
    });

    const result = await runNativeAppAutomation({
      manifest,
      store,
      rowId: 'auto-risky',
      confirmed: true,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('尚未接入动作');
    expect(store.get('app_automations', 'auto-risky')).toEqual(expect.objectContaining({
      last_status: 'failed',
      last_run_summary: expect.stringContaining('goofish:change-price'),
    }));
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({ title: '运行自动化：自动改价', status: 'failed' }),
    ]);
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
