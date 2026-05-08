import { generateGoofishReplyDraft } from '../goofish-reply-draft-generator';
import type { AppManifest } from '../manifest/types';
import type { AppDataStore, AppRow, Filter, QueryOptions } from '../runtime/data-store';

const manifest: AppManifest = {
  id: 'goofish-assistant',
  name: '闲鱼助手',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'inbox',
  tags: ['闲鱼'],
};

describe('goofish reply draft generator', () => {
  it('generates a safe draft from one buyer conversation row and records evidence', async () => {
    const store = createMemoryStore();
    store.create('app_settings', {
      id: 'settings-1',
      ai_system_prompt: '回复要简短，先确认事实，不承诺平台外交易。',
      risk_note: '禁止引导微信交易。',
    });
    store.create('buyer_conversations', {
      id: 'conversation-row-1',
      conversation_id: 'cid-1',
      buyer_name: '张三',
      item_id: 'item-1',
      item_title: '二手相机',
      unread_count: 2,
      last_message: '能便宜点吗？今天能发货吗？',
      reply_status: '待回复',
      priority: '重要',
      notes: '价格空间很小。',
    });
    store.create('item_marks', {
      id: 'item-1-row',
      item_id: 'item-1',
      item_title: '二手相机',
      status: '重点跟进',
      notes: '成色好，暂不大幅降价。',
    });

    const generateDraftText = jest.fn().mockResolvedValue({
      text: '您好，相机还在的，价格我再确认一下可优惠空间；发货时间也需要看今天打包情况，确认后回复您。',
      providerId: 'provider-1',
      model: 'model-1',
    });

    const result = await generateGoofishReplyDraft({
      manifest,
      store,
      rowId: 'conversation-row-1',
      deps: {
        now: () => 1714470000000,
        generateDraftText,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.providerId).toBe('provider-1');
    expect(result.confirmationCode).toBeTruthy();
    expect(generateDraftText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('张三'),
      system: expect.stringContaining('禁止引导微信交易'),
      temperature: 0.2,
    }));
    expect(generateDraftText.mock.calls[0][0].prompt).toContain('能便宜点吗');
    expect(generateDraftText.mock.calls[0][0].prompt).toContain('成色好');

    const drafts = store.query('reply_drafts');
    expect(drafts).toEqual([
      expect.objectContaining({
        conversation_id: 'cid-1',
        buyer_name: '张三',
        item_title: '二手相机',
        incoming_message: '能便宜点吗？今天能发货吗？',
        draft_text: expect.stringContaining('相机还在'),
        status: 'draft',
        confirmation_channel: '未确认',
        confirmation_code: result.confirmationCode,
        confirmation_expires_at: '2024-05-01T09:40:00.000Z',
        risk_note: expect.stringContaining('发送前必须由用户在应用内确认'),
      }),
    ]);
    expect(store.get('buyer_conversations', 'conversation-row-1')).toEqual(expect.objectContaining({
      reply_status: '已草稿',
    }));
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({
        title: '生成闲鱼回复草稿',
        status: 'success',
        summary: expect.stringContaining('已为 张三 保存一条回复草稿'),
      }),
    ]);
  });

  it('falls back to a conservative draft when AI generation is unavailable', async () => {
    const store = createMemoryStore();
    store.create('buyer_conversations', {
      id: 'conversation-row-1',
      conversation_id: 'cid-1',
      buyer_name: '李四',
      item_title: '键盘',
      last_message: '还在吗？',
      reply_status: '待回复',
    });

    const result = await generateGoofishReplyDraft({
      manifest,
      store,
      rowId: 'conversation-row-1',
      deps: {
        now: () => 1714470000000,
        generateDraftText: jest.fn().mockRejectedValue(new Error('未配置可用的文本生成服务商。')),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.message).toContain('保守模板');
    expect(store.query('reply_drafts')).toEqual([
      expect.objectContaining({
        buyer_name: '李四',
        draft_text: expect.stringContaining('目前还在'),
        risk_note: expect.stringContaining('未配置可用的文本生成服务商'),
      }),
    ]);
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({
        status: 'success',
        summary: expect.stringContaining('AI 生成未完成'),
      }),
    ]);
  });

  it('does not create a draft without a concrete buyer message', async () => {
    const store = createMemoryStore();
    store.create('buyer_conversations', {
      id: 'conversation-row-1',
      buyer_name: '王五',
      item_title: '耳机',
      last_message: '',
      reply_status: '待回复',
    });

    const result = await generateGoofishReplyDraft({
      manifest,
      store,
      rowId: 'conversation-row-1',
      deps: { now: () => 1714470000000 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('缺少最近消息');
    expect(store.query('reply_drafts')).toEqual([]);
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({
        status: 'failed',
        failure_reason: expect.stringContaining('缺少最近消息'),
      }),
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
      rows = applyFilter(rows, opts.filter);
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
    count(name: string, filter?: Filter): number {
      return applyFilter(Array.from(collection(name).values()), filter).length;
    },
  };
}

function applyFilter<T extends Record<string, unknown>>(rows: T[], filter?: Filter): T[] {
  if (!filter) return rows;
  return rows.filter((row) => (
    Object.entries(filter).every(([field, value]) => row[field] === value)
  ));
}
