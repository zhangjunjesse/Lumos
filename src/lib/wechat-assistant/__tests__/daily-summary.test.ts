import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from '@/components/apps/builtin/wechat/app-settings';
import { DEFAULT_PROMPTS } from '@/components/apps/builtin/wechat/default-prompts';

const mockGenerateTextFromProvider = jest.fn();
const mockGetDefaultProvider = jest.fn();
const mockGetProvider = jest.fn();
const mockQuerySnapshot = jest.fn();

jest.mock('@/lib/text-generator', () => ({
  generateTextFromProvider: (...args: unknown[]) => mockGenerateTextFromProvider(...args),
}));

jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: () => mockGetDefaultProvider(),
  getProvider: (id: string) => mockGetProvider(id),
}));

jest.mock('../mirror-store', () => ({
  querySnapshot: (...args: unknown[]) => mockQuerySnapshot(...args),
}));

jest.mock('../settings-store', () => {
  const { DEFAULT_SETTINGS: defaults } = jest.requireActual('@/components/apps/builtin/wechat/app-settings');
  return { getWeChatAssistantSettings: () => defaults };
});

import {
  buildDailySummaryReport,
  collectRecentMessagesForDailySummary,
  selectTodosForDailySummary,
} from '../daily-summary';
import type { DailySummaryInput } from '../daily-summary';

const provider = {
  id: 'provider-1',
  name: '测试服务商',
  provider_type: 'anthropic',
  api_protocol: 'anthropic-messages',
  base_url: '',
  capabilities: '["text-gen"]',
  model_catalog: JSON.stringify([{ value: 'model-1', label: 'Model 1' }]),
  model_catalog_source: 'manual',
  model_catalog_updated_at: null,
};

function settings(patch: Partial<AppSettings['ai']> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ai: {
      ...DEFAULT_SETTINGS.ai,
      prompts: { ...DEFAULT_PROMPTS },
      ...patch,
    },
  };
}

function input(): DailySummaryInput {
  const now = Date.UTC(2026, 4, 6, 12, 0, 0);
  return {
    automationName: '每日微信总结',
    messageTemplate: '只总结待办和未回复消息',
    data: {
      generatedAt: now,
      windowDays: 14,
      totals: {
        activeChats: 2,
        messagesInWindow: 18,
        silentCount: 1,
      },
      rows: [
        {
          id: 'wxid_customer',
          name: '客户 A',
          isGroup: false,
          messageCount: 12,
          yourShare: 0.42,
          lastTs: now - 30 * 60 * 1000,
          interactionDays: [{ daysAgo: 0, count: 5 }],
        },
        {
          id: 'room1@chatroom',
          name: '项目群',
          isGroup: true,
          messageCount: 6,
          yourShare: 0.2,
          lastTs: now - 60 * 60 * 1000,
          interactionDays: [{ daysAgo: 0, count: 2 }],
        },
      ],
    },
    todos: [{
      text: '跟进客户 A 的合同回款',
      sourceDisplay: '客户 A',
      byWhenText: '今晚 21:00 前',
    }],
    sync: {
      status: 'completed',
      inserted: 3,
      seen: 10,
      cursorTs: 100,
      durationMs: 1200,
    },
    recentMessages: [{
      chatName: '客户 A',
      isGroup: false,
      sender: 'them',
      content: '合同回款今天能确认吗？',
      ts: now - 20 * 60 * 1000,
    }],
  };
}

describe('daily summary report', () => {
  beforeEach(() => {
    mockGenerateTextFromProvider.mockReset();
    mockGetDefaultProvider.mockReset();
    mockGetProvider.mockReset();
    mockQuerySnapshot.mockReset();
  });

  it('falls back to deterministic markdown when no text provider is available', async () => {
    mockGetDefaultProvider.mockReturnValue(undefined);

    const report = await buildDailySummaryReport(input(), { settings: settings() });

    expect(mockGenerateTextFromProvider).not.toHaveBeenCalled();
    expect(report.ai.status).toBe('skipped');
    expect(report.markdown).toContain('## 今日概览');
    expect(report.summary).toContain('今日微信新增 7 条消息');
  });

  it('skips LLM enhancement with a clear reason when the provider uses local auth', async () => {
    mockGetDefaultProvider.mockReturnValue({
      ...provider,
      auth_mode: 'local_auth',
    });

    const report = await buildDailySummaryReport(input(), { settings: settings() });

    expect(mockGenerateTextFromProvider).not.toHaveBeenCalled();
    expect(report.ai).toEqual(expect.objectContaining({
      status: 'skipped',
      error: expect.stringContaining('本地登录授权'),
    }));
    expect(report.markdown).toContain('AI 增强已跳过');
  });

  it('uses the configured provider to generate an enhanced markdown report', async () => {
    mockGetProvider.mockReturnValue(provider);
    mockGenerateTextFromProvider.mockResolvedValue([
      '## 今日要点',
      '',
      '客户 A 今天追问合同回款，需要优先处理。',
      '',
      '## 重点会话',
      '',
      '- 客户 A：围绕合同回款推进。',
      '',
      '## 待跟进',
      '',
      '- 今晚 21:00 前确认回款。',
      '',
      '## 建议行动',
      '',
      '- 先回复客户 A，再检查项目群。',
    ].join('\n'));

    const report = await buildDailySummaryReport(input(), {
      settings: settings({
        providerId: 'provider-1',
        model: 'model-1',
        prompts: {
          ...DEFAULT_PROMPTS,
          dailyReporter: '自定义日报提示词 {windowDays} {messageTemplate}',
        },
      }),
    });

    expect(report.ai).toEqual(expect.objectContaining({
      status: 'success',
      providerId: 'provider-1',
      model: 'model-1',
    }));
    expect(report.markdown.startsWith('# 每日微信总结')).toBe(true);
    expect(report.markdown).toContain('客户 A 今天追问合同回款');
    expect(report.summary).toContain('客户 A 今天追问合同回款');
    expect(report.notification).toContain('客户 A 今天追问合同回款');
    expect(mockGenerateTextFromProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-1',
      model: 'model-1',
      system: '自定义日报提示词 14 只总结待办和未回复消息',
    }));
  });

  it('keeps the deterministic report when LLM enhancement fails', async () => {
    mockGetProvider.mockReturnValue(provider);
    mockGenerateTextFromProvider.mockRejectedValue(new Error('provider timeout'));

    const report = await buildDailySummaryReport(input(), {
      settings: settings({ providerId: 'provider-1', model: 'model-1' }),
    });

    expect(report.ai).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'provider timeout',
    }));
    expect(report.markdown).toContain('## 今日概览');
    expect(report.markdown).toContain('AI 增强失败，已使用基础统计报告');
  });

  it('keeps internal WeChat ids out of deterministic and enhanced report text', async () => {
    mockGetProvider.mockReturnValue(provider);
    mockGenerateTextFromProvider.mockResolvedValue([
      '## 今日要点',
      '',
      '- 整理节前遗留问题清单发到 45434442516 客户群',
      '- 25984985930267888@openim: 5.6语文作业需要确认',
    ].join('\n'));
    const dirty = input();
    dirty.data.rows = [{
      ...dirty.data.rows[0],
      id: '45434442516@chatroom',
      name: '45434442516@chatroom',
      isGroup: true,
    }];
    dirty.todos = [{
      text: '整理节前遗留问题清单发到 45434442516 客户群',
      sourceWxid: '25984985930267888@openim',
      sourceDisplay: '25984985930267888@openim',
      byWhenText: '25984985930267888@openim: 今天',
    }];

    const report = await buildDailySummaryReport(dirty, {
      settings: settings({ providerId: 'provider-1', model: 'model-1' }),
    });
    const visible = `${report.markdown}\n${report.summary}\n${report.notification}`;

    expect(visible).toContain('客户群');
    expect(visible).toContain('5.6语文作业');
    expect(visible).not.toContain('45434442516');
    expect(visible).not.toContain('@openim');
    expect(visible).not.toContain('@chatroom');
  });

  it('collects useful recent text messages and skips pure placeholders', () => {
    mockQuerySnapshot.mockReturnValue({
      sessions: [
        { wxid: 'wxid_a', display: '客户 A', is_group: false },
        { wxid: 'room@chatroom', display: '项目群', is_group: true },
      ],
      messages: [
        { wxid: 'wxid_a', ts: 100, sender: 'them', content: ' 合同今天确认吗 ' },
        { wxid: 'wxid_a', ts: 90, sender: 'me', content: '[图片]' },
        { wxid: 'room@chatroom', ts: 80, sender: 'them', content: '群里同步一下进度' },
      ],
    });

    expect(collectRecentMessagesForDailySummary(14, 10, 1_000_000)).toEqual([
      {
        chatName: '客户 A',
        isGroup: false,
        sender: 'them',
        content: '合同今天确认吗',
        ts: 100_000,
      },
      {
        chatName: '项目群',
        isGroup: true,
        sender: 'them',
        content: '群里同步一下进度',
        ts: 80_000,
      },
    ]);
  });

  it('sanitizes recent message snippets before sending them to the daily reporter', () => {
    mockQuerySnapshot.mockReturnValue({
      sessions: [
        { wxid: '45434442516@chatroom', display: '45434442516@chatroom', is_group: true },
      ],
      messages: [
        {
          wxid: '45434442516@chatroom',
          ts: 100,
          sender: 'them',
          content: '25984985930267888@openim: 5.6语文作业 订正默写本',
        },
      ],
    });

    const snippets = collectRecentMessagesForDailySummary(14, 10, 1_000_000);

    expect(snippets).toEqual([{
      chatName: '微信群聊',
      isGroup: true,
      sender: 'them',
      content: '5.6语文作业 订正默写本',
      ts: 100_000,
    }]);
  });

  it('excludes configured chats from recent message snippets', () => {
    mockQuerySnapshot.mockReturnValue({
      sessions: [
        { wxid: 'wxid_a', display: '客户 A', is_group: false },
        { wxid: 'blocked', display: '已排除客户', is_group: false },
      ],
      messages: [
        { wxid: 'blocked', ts: 120, sender: 'them', content: '不要进入日报 AI 输入' },
        { wxid: 'wxid_a', ts: 100, sender: 'them', content: '合同今天确认吗' },
      ],
    });

    expect(
      collectRecentMessagesForDailySummary(14, 10, 1_000_000, { excludedIds: ['blocked'] }),
    ).toEqual([
      {
        chatName: '客户 A',
        isGroup: false,
        sender: 'them',
        content: '合同今天确认吗',
        ts: 100_000,
      },
    ]);
  });

  it('excludes configured chats from daily summary todos before limiting', () => {
    expect(
      selectTodosForDailySummary([
        { text: '不应出现', sourceWxid: 'blocked', sourceDisplay: '已排除客户' },
        { text: '跟进客户 A', sourceWxid: 'wxid_a', sourceDisplay: '客户 A' },
        { text: '手动事项', sourceWxid: null, sourceDisplay: null },
      ], ['blocked'], 2),
    ).toEqual([
      { text: '跟进客户 A', sourceWxid: 'wxid_a', sourceDisplay: '客户 A' },
      { text: '手动事项', sourceWxid: null, sourceDisplay: null },
    ]);
  });
});
