import { runNativeAppCommand } from '../native-command-runner';
import type { AppManifest } from '../manifest/types';
import type { AppDataStore, AppRow, QueryOptions } from '../runtime/data-store';

const manifest: AppManifest = {
  id: 'goofish-assistant',
  name: '闲鱼助手',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'inbox',
  tags: ['闲鱼'],
};

const genericManifest: AppManifest = {
  id: 'customer-followup',
  name: '客户跟进',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'status',
};

describe('native app command runner', () => {
  it('runs a generic read-only status command for non-Goofish native apps', async () => {
    const store = createMemoryStore();
    store.create('app_settings', {
      id: 'settings-1',
      ai_system_prompt: '你是客户跟进助手。',
    });
    store.create('run_history', {
      id: 'run-old',
      title: '同步客户',
      status: 'failed',
      summary: '同步失败',
      failure_reason: '缺少账号授权',
    });
    store.create('acceptance_checks', {
      id: 'acceptance-1',
      acceptance_id: 'status-visible',
      done: true,
      status: 'passed',
    });
    store.create('acceptance_checks', {
      id: 'acceptance-2',
      acceptance_id: 'im-ready',
      done: false,
      status: 'blocked',
      failure_reason: '还没有接入外部 IM。',
    });
    store.create('app_command_runs', {
      id: 'cmd-status',
      command: '/status',
      risk_level: 'read',
      confirmation_required: false,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest: genericManifest,
      store,
      rowId: 'cmd-status',
      confirmed: false,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('客户跟进 状态');
    expect(result.message).toContain('设置 1 项');
    expect(result.message).toContain('验收 1/2');
    expect(result.message).toContain('异常 1 项');
    expect(store.get('app_command_runs', 'cmd-status')).toEqual(expect.objectContaining({
      status: 'success',
      result_summary: expect.stringContaining('客户跟进 状态'),
      last_run_id: result.runId,
    }));
    expect(store.query('run_history')).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '执行 IM 命令：/status', status: 'success' }),
    ]));
  });

  it('shows generic command guidance for unsupported non-Goofish commands', async () => {
    const store = createMemoryStore();
    store.create('app_command_runs', {
      id: 'cmd-custom',
      command: '/sync-now',
      risk_level: 'read',
      confirmation_required: false,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest: genericManifest,
      store,
      rowId: 'cmd-custom',
      confirmed: false,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('尚未接入命令：/sync-now');
    expect(result.message).toContain('/status、/runs、/acceptance、/help');
    expect(store.get('app_command_runs', 'cmd-custom')).toEqual(expect.objectContaining({
      status: 'failed',
      failure_reason: expect.stringContaining('通用只读命令'),
    }));
  });

  it('runs a read-only Goofish status command against app-local data', async () => {
    const store = createMemoryStore();
    store.create('goofish_accounts', {
      id: 'account-1',
      account_label: '卖家号',
      login_status: 'ready',
      sync_status: 'success',
    });
    store.create('app_command_runs', {
      id: 'cmd-status',
      command: '/goofish status',
      risk_level: 'read',
      confirmation_required: false,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-status',
      confirmed: false,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('闲鱼账号 1 个');
    expect(store.get('app_command_runs', 'cmd-status')).toEqual(expect.objectContaining({
      status: 'success',
      result_summary: expect.stringContaining('登录可用 1 个'),
      last_run_id: result.runId,
    }));
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({ title: '执行 IM 命令：/goofish status', status: 'success' }),
    ]);
  });

  it('summarizes unread Goofish conversations without external IM routing', async () => {
    const store = createMemoryStore();
    store.create('buyer_conversations', {
      id: 'conversation-1',
      buyer_name: '张三',
      item_title: '二手相机',
      unread_count: 2,
      reply_status: '待回复',
    });
    store.create('app_command_runs', {
      id: 'cmd-unread',
      command: '/goofish unread',
      risk_level: 'read',
      confirmation_required: false,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-unread',
      confirmed: false,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 个未读买家会话');
    expect(result.message).toContain('张三 / 二手相机');
    expect(store.get('app_command_runs', 'cmd-unread')).toEqual(expect.objectContaining({
      status: 'success',
      result_summary: expect.stringContaining('共 2 条未读'),
    }));
  });

  it('requires confirmation for low-risk sync commands', async () => {
    const store = createMemoryStore();
    store.create('app_command_runs', {
      id: 'cmd-sync',
      command: '/goofish sync',
      risk_level: 'low_write',
      confirmation_required: true,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-sync',
      confirmed: false,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('明确确认');
    expect(store.get('app_command_runs', 'cmd-sync')).toEqual(expect.objectContaining({
      status: 'pending_confirmation',
      failure_reason: expect.stringContaining('明确确认'),
    }));
  });

  it('generates a local Goofish reply draft from a buyer conversation command', async () => {
    const store = createMemoryStore();
    store.create('buyer_conversations', {
      id: 'conversation-1',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      item_title: '二手相机',
      unread_count: 1,
      last_message: '还能便宜点吗？',
      reply_status: '待回复',
      priority: '重要',
    });
    store.create('app_command_runs', {
      id: 'cmd-draft',
      command: '/goofish draft 张三',
      risk_level: 'low_write',
      confirmation_required: false,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-draft',
      confirmed: false,
      deps: {
        now: () => 1714470000000,
        replyDraft: {
          generateDraftText: jest.fn().mockResolvedValue({
            text: '您好，相机还在的，价格我再确认一下可优惠空间。',
            providerId: 'provider-1',
            model: 'model-1',
          }),
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('回复草稿');
    expect(result.message).toContain('应用内确认');
    expect(store.query('reply_drafts')).toEqual([
      expect.objectContaining({
        buyer_name: '张三',
        item_title: '二手相机',
        draft_text: expect.stringContaining('相机还在'),
        status: 'draft',
        confirmation_channel: '未确认',
      }),
    ]);
    expect(store.get('app_command_runs', 'cmd-draft')).toEqual(expect.objectContaining({
      status: 'success',
      result_summary: expect.stringContaining('回复草稿'),
    }));
    expect(store.query('run_history')).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '生成闲鱼回复草稿', status: 'success' }),
      expect.objectContaining({ title: '执行 IM 命令：/goofish draft 张三', status: 'success' }),
    ]));
  });

  it('lists and confirms one pending draft through an explicit IM command', async () => {
    const store = createMemoryStore();
    store.create('buyer_conversations', {
      id: 'conversation-1',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      buyer_user_id: 'buyer-1',
      item_title: '二手相机',
      last_message: '还能便宜点吗？',
      reply_status: '已草稿',
    });
    store.create('reply_drafts', {
      id: 'draft-abc123',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      item_title: '二手相机',
      incoming_message: '还能便宜点吗？',
      draft_text: '您好，相机还在的，价格我再确认一下。',
      status: 'draft',
      confirmation_channel: '未确认',
    });
    store.create('app_command_runs', {
      id: 'cmd-drafts',
      command: '/goofish drafts',
      risk_level: 'read',
      confirmation_required: false,
      status: 'draft',
    });

    const listResult = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-drafts',
      confirmed: false,
      deps: { now: () => 1714470000000 },
    });
    expect(listResult.ok).toBe(true);
    expect(listResult.message).toContain('draftabc');
    expect(listResult.message).toContain('/goofish confirm');

    store.create('app_command_runs', {
      id: 'cmd-confirm',
      command: '/goofish confirm draftabc',
      risk_level: 'low_write',
      confirmation_required: true,
      status: 'draft',
    });
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-confirm',
      confirmed: true,
      deps: {
        now: () => 1714470000000,
        goofish: { sendMessage },
      },
    });

    expect(result.ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith('cid-1', 'buyer-1', '您好，相机还在的，价格我再确认一下。');
    expect(store.get('reply_drafts', 'draft-abc123')).toEqual(expect.objectContaining({
      status: 'sent',
      confirmation_channel: '微信 IM 确认',
    }));
    expect(store.get('buyer_conversations', 'conversation-1')).toEqual(expect.objectContaining({
      reply_status: '已回复',
      unread_count: 0,
    }));
  });

  it('rejects expired WeChat draft confirmation codes', async () => {
    const store = createMemoryStore();
    store.create('reply_drafts', {
      id: 'draft-expired',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      item_title: '二手相机',
      draft_text: '您好，相机还在的。',
      status: 'draft',
      confirmation_channel: '未确认',
      confirmation_code: 'expired1',
      confirmation_expires_at: '2024-04-30T09:39:59.000Z',
    });
    store.create('app_command_runs', {
      id: 'cmd-confirm',
      command: '/goofish confirm expired1',
      risk_level: 'low_write',
      confirmation_required: true,
      status: 'draft',
    });
    const sendMessage = jest.fn();

    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-confirm',
      confirmed: true,
      deps: {
        now: () => 1714470000000,
        goofish: { sendMessage },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('已过确认有效期');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.get('reply_drafts', 'draft-expired')).toEqual(expect.objectContaining({
      status: 'draft',
      confirmation_channel: '未确认',
    }));
  });

  it('rejects a pending draft through an explicit IM command without sending', async () => {
    const store = createMemoryStore();
    store.create('buyer_conversations', {
      id: 'conversation-1',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      item_title: '二手相机',
      last_message: '还能便宜点吗？',
      reply_status: '已草稿',
    });
    store.create('reply_drafts', {
      id: 'draft-reject1',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      item_title: '二手相机',
      draft_text: '您好，相机还在的。',
      status: 'draft',
      confirmation_channel: '未确认',
      confirmation_code: 'reject1',
    });
    store.create('app_command_runs', {
      id: 'cmd-reject',
      command: '/goofish reject reject1',
      risk_level: 'low_write',
      confirmation_required: true,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-reject',
      confirmed: true,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('已拒绝');
    expect(store.get('reply_drafts', 'draft-reject1')).toEqual(expect.objectContaining({
      status: 'rejected',
      failure_reason: expect.stringContaining('不会发送'),
    }));
    expect(store.get('buyer_conversations', 'conversation-1')).toEqual(expect.objectContaining({
      reply_status: '待回复',
    }));
  });

  it('rejects unsupported commands with visible failure evidence', async () => {
    const store = createMemoryStore();
    store.create('app_command_runs', {
      id: 'cmd-risky',
      command: '/goofish change-price',
      risk_level: 'high_risk',
      confirmation_required: true,
      status: 'draft',
    });

    const result = await runNativeAppCommand({
      manifest,
      store,
      rowId: 'cmd-risky',
      confirmed: true,
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('高风险');
    expect(store.get('app_command_runs', 'cmd-risky')).toEqual(expect.objectContaining({
      status: 'rejected',
      result_summary: expect.stringContaining('高风险'),
    }));
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({ title: '执行 IM 命令：/goofish change-price', status: 'failed' }),
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
