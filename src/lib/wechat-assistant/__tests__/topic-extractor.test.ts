import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-topic-test-'));

const mockRunSync = jest.fn();

jest.mock('@/lib/db', () => ({ dataDir: TMP_ROOT }));
jest.mock('@/lib/text-generator', () => ({
  generateObjectWithFallback: jest.fn(),
}));
jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: jest.fn(),
  getProvider: jest.fn(),
}));
jest.mock('@/lib/model-metadata', () => ({
  resolveProviderModelForRequest: jest.fn(),
}));
jest.mock('../settings-store', () => ({
  getWeChatAssistantSettings: jest.fn(),
}));
jest.mock('../sync-engine', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('@/lib/wechat-export/disclaimer', () => ({ hasValidConsent: () => true }));
jest.mock('@/lib/wechat-export/setup-state', () => ({ hasRecoveredKey: () => true }));

import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import { resolveProviderModelForRequest } from '@/lib/model-metadata';
import { generateObjectWithFallback } from '@/lib/text-generator';

import {
  getTopicMessageContext,
  getTopicRangeSummary,
  hasTopicDailySummary,
  insertMessages,
  resetMirror,
  setTopicDailyState,
  type ChatMessagesBundle,
  type TopicEntry,
  upsertSessions,
} from '../mirror-store';
import { getWeChatAssistantSettings } from '../settings-store';
import { mergeTopics, planBatches, runTopicExtraction } from '../topic-extractor';
import { buildUserPrompt } from '../topic-prompt';
import { businessDateForTimestamp, defaultTopicDateRange } from '../topic-time';

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

const mockGetDefaultProvider = jest.mocked(getDefaultProvider);
const mockGetProvider = jest.mocked(getProvider);
const mockResolveProviderModelForRequest = jest.mocked(resolveProviderModelForRequest);
const mockGenerateObjectWithFallback = jest.mocked(generateObjectWithFallback);
const mockGetWeChatAssistantSettings = jest.mocked(getWeChatAssistantSettings);

beforeEach(() => {
  mockRunSync.mockReset();
  mockRunSync.mockResolvedValue({
    status: 'completed',
    inserted: 0,
    seen: 0,
    cursorTs: 0,
    durationMs: 0,
  });
});

describe('planBatches', () => {
  function bundle(wxid: string, count: number, isGroup = false): ChatMessagesBundle {
    return {
      wxid,
      display: wxid,
      isGroup,
      messages: Array.from({ length: count }, (_, i) => ({
        ts: 1_700_000_000 + i,
        sender: i % 2 === 0 ? ('me' as const) : ('them' as const),
        content: `msg ${i}`,
      })),
    };
  }

  it('emits one batch per chat when each fits within max', () => {
    const out = planBatches([bundle('alice', 80), bundle('bob', 40)], 200);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe('alice');
    expect(out[1].label).toBe('bob');
    expect(out[0].messageCount).toBe(80);
    expect(out[0].participants).toEqual(['alice']);
  });

  it('splits a chat that exceeds max into multiple labelled batches', () => {
    const out = planBatches([bundle('verbose', 1100)], 500);
    expect(out).toHaveLength(3); // ceil(1100/500) = 3
    expect(out[0].label).toBe('verbose (1/3)');
    expect(out[1].label).toBe('verbose (2/3)');
    expect(out[2].label).toBe('verbose (3/3)');
    const total = out.reduce((s, b) => s + b.messageCount, 0);
    expect(total).toBe(1100);
  });

  it('clamps tiny max values to a sensible floor (50)', () => {
    const out = planBatches([bundle('alice', 200)], 1);
    // Should split using max=50 instead of 1
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps internal WeChat ids out of batch labels and topic prompts', () => {
    const out = planBatches([{
      wxid: '45434442516@chatroom',
      display: '45434442516@chatroom',
      isGroup: true,
      messages: [{
        ts: 1_700_000_000,
        sender: 'them',
        senderDisplay: '25984985930267888@openim',
        content: '25984985930267888@openim: 5.6语文作业 订正默写本',
      }],
    }], 50);

    expect(out[0].label).toBe('微信群聊');
    expect(out[0].participants).toEqual(['群成员']);

    const prompt = buildUserPrompt({ scope: 'group', bundles: out[0].bundles, windowDays: 7 });
    expect(prompt).toContain('群聊：微信群聊');
    expect(prompt).toContain('群成员');
    expect(prompt).toContain('5.6语文作业 订正默写本');
    expect(prompt).not.toContain('45434442516');
    expect(prompt).not.toContain('25984985930267888@openim');
  });

  it('uses visible group member names as topic participants when available', () => {
    const out = planBatches([{
      wxid: 'team@chatroom',
      display: '客户群',
      isGroup: true,
      messages: [
        {
          ts: 1_700_000_000,
          sender: 'them',
          senderDisplay: '张三',
          content: '节前遗留问题清单今天发',
        },
        {
          ts: 1_700_000_060,
          sender: 'me',
          senderDisplay: null,
          content: '我来整理',
        },
      ],
    }], 50);

    expect(out[0].participants).toEqual(['张三', '我']);
  });
});

describe('mergeTopics', () => {
  const t = (title: string, summary: string, count: number, parts: string[]): TopicEntry => ({
    title,
    summary,
    messageCount: count,
    participants: parts,
  });

  it('merges topics with the same normalized title', () => {
    const merged = mergeTopics([
      t('客户合同进展', '签约前最后一轮谈判很紧张', 10, ['Alice']),
      t(' 客户合同进展 ', '修改了几条', 5, ['Bob']),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].messageCount).toBe(15);
    expect(merged[0].participants.sort()).toEqual(['Alice', 'Bob']);
    // longest summary wins — first one is longer here
    expect(merged[0].summary).toBe('签约前最后一轮谈判很紧张');
  });

  it('keeps unrelated topics distinct + sorts by count desc', () => {
    const merged = mergeTopics([
      t('周末爬山', 'A', 4, ['Alice']),
      t('客户合同', 'B', 12, ['Bob']),
      t('周末爬山', 'C longer summary', 3, ['Charlie']),
    ]);
    expect(merged.map((m) => m.title)).toEqual(['客户合同', '周末爬山']);
    const hike = merged.find((m) => m.title === '周末爬山')!;
    expect(hike.messageCount).toBe(7);
    expect(hike.summary).toBe('C longer summary'); // longer wins
    expect(hike.participants.sort()).toEqual(['Alice', 'Charlie']);
  });

  it('drops entries with empty title', () => {
    const merged = mergeTopics([
      t('', 'noise', 5, []),
      t('   ', 'noise2', 3, []),
      t('真话题', 'ok', 2, ['Alice']),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('真话题');
  });

  it('treats punctuation/whitespace differences as same topic', () => {
    const merged = mergeTopics([
      t('Q4 OKR  规划', 'A', 5, []),
      t('Q4 OKR规划', 'B longer', 7, []),
      t('Q4-OKR-规划', 'C', 3, []),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].messageCount).toBe(15);
  });
});

describe('topic business day archive', () => {
  beforeEach(() => {
    resetMirror();
    jest.clearAllMocks();
    mockGetDefaultProvider.mockReturnValue({ id: 'global-provider', name: 'Global Provider' } as never);
    mockGetProvider.mockReturnValue(null);
    mockResolveProviderModelForRequest.mockReturnValue('resolved-model');
    mockGenerateObjectWithFallback.mockResolvedValue({
      topics: [{ title: '合同回款', summary: '讨论合同回款确认', messageCount: 2 }],
    } as never);
    mockGetWeChatAssistantSettings.mockReturnValue({
      ai: {
        providerId: null,
        model: null,
        windowDays: 14,
        prompts: {
          followupExtractor: 'FOLLOWUP',
          dailyReporter: 'DAILY',
          topicExtractor: 'TOPIC {scope} {windowDays}',
        },
      },
      topicAnalysis: {
        whitelistPersonal: ['alice', 'bob'],
        whitelistGroups: [],
        maxMessagesPerCall: 500,
        minChatMessages: 1,
      },
      excludedPersonIds: [],
    } as never);
    const ts = Date.parse('2026-05-06T10:00:00+08:00') / 1000;
    upsertSessions([
      { wxid: 'alice', display: 'Alice', isGroup: false, lastTs: ts, messageCount: 2, unreadCount: 0, summary: '' },
      { wxid: 'bob', display: 'Bob', isGroup: false, lastTs: ts, messageCount: 2, unreadCount: 0, summary: '' },
    ]);
    insertMessages([
      { wxid: 'alice', ts, sender: 'me', msgType: 1, content: '合同回款今天确认' },
      { wxid: 'alice', ts: ts + 60, sender: 'them', msgType: 1, content: '合同回款金额没问题' },
      { wxid: 'bob', ts: ts + 120, sender: 'them', msgType: 1, content: '合同回款资料发一下' },
      { wxid: 'bob', ts: ts + 180, sender: 'me', msgType: 1, content: '我整理合同回款资料' },
    ]);
  });

  it('uses 04:00 local time as the business-day boundary', () => {
    expect(businessDateForTimestamp(Date.parse('2026-05-06T03:59:00+08:00') / 1000)).toBe('2026-05-05');
    expect(businessDateForTimestamp(Date.parse('2026-05-06T04:00:00+08:00') / 1000)).toBe('2026-05-06');
  });

  it('defaults archive viewing to the last completed business day', () => {
    expect(defaultTopicDateRange(Date.parse('2026-05-07T10:00:00+08:00'))).toEqual({
      from: '2026-04-30',
      to: '2026-05-06',
    });
  });

  it('archives daily topic results grouped by source', async () => {
    const result = await runTopicExtraction({ scope: 'personal', businessDate: '2026-05-06' });

    expect(result.status).toBe('completed');
    expect(result.businessDate).toBe('2026-05-06');
    const range = getTopicRangeSummary('personal', '2026-05-06', '2026-05-06');
    expect(range.sources.map((source) => source.display).sort()).toEqual(['Alice', 'Bob']);
    expect(range.sources[0].topics[0]).toEqual(expect.objectContaining({
      title: '合同回款',
    }));
  });

  it('sanitizes AI topic titles and summaries before returning and archiving them', async () => {
    mockGenerateObjectWithFallback.mockResolvedValue({
      topics: [{
        title: '45434442516 客户群',
        summary: '25984985930267888@openim: 5.6语文作业需要确认',
        messageCount: 2,
      }],
    } as never);

    const result = await runTopicExtraction({ scope: 'personal', businessDate: '2026-05-06' });
    const range = getTopicRangeSummary('personal', '2026-05-06', '2026-05-06');
    const visible = JSON.stringify({ result, range });

    expect(visible).toContain('客户群');
    expect(visible).toContain('5.6语文作业需要确认');
    expect(visible).not.toContain('45434442516');
    expect(visible).not.toContain('@openim');
    expect(visible).not.toContain('@chatroom');
  });

  it('finds message context for an archived source topic', async () => {
    await runTopicExtraction({ scope: 'personal', businessDate: '2026-05-06' });

    const context = getTopicMessageContext({
      wxid: 'alice',
      title: '合同回款',
      summary: '讨论合同回款确认',
      dateFrom: '2026-05-06',
      dateTo: '2026-05-06',
    });

    expect(context?.display).toBe('Alice');
    expect(context?.messages.map((message) => message.content).join('\n')).toContain('合同回款');
  });

  it('does not treat a skipped or failed daily archive as permanently complete', () => {
    const now = Date.now();
    setTopicDailyState('personal', '2026-05-06', 'skipped', 'no_provider');
    setTopicDailyState('group', '2026-05-06', 'failed', 'provider timeout');

    expect(hasTopicDailySummary('personal', '2026-05-06', now)).toBe(true);
    expect(hasTopicDailySummary('personal', '2026-05-06', now + 31 * 60 * 1000)).toBe(false);
    expect(hasTopicDailySummary('group', '2026-05-06', now)).toBe(true);
    expect(hasTopicDailySummary('group', '2026-05-06', now + 31 * 60 * 1000)).toBe(false);
  });

  it('does not keep a stale running daily archive locked forever', () => {
    const now = Date.now();
    setTopicDailyState('personal', '2026-05-06', 'running');

    expect(hasTopicDailySummary('personal', '2026-05-06', now + 30 * 60 * 1000)).toBe(true);
    expect(hasTopicDailySummary('personal', '2026-05-06', now + 3 * 60 * 60 * 1000)).toBe(false);
  });
});

describe('runTopicExtraction provider settings', () => {
  beforeEach(() => {
    resetMirror();
    jest.clearAllMocks();
    mockGetDefaultProvider.mockReturnValue({ id: 'global-provider', name: 'Global Provider' } as never);
    mockGetProvider.mockReturnValue({ id: 'selected-provider', name: 'Selected Provider' } as never);
    mockResolveProviderModelForRequest.mockReturnValue('resolved-model');
    mockGenerateObjectWithFallback.mockResolvedValue({
      topics: [{ title: '项目进展', summary: '讨论项目推进', messageCount: 2 }],
    } as never);
    mockGetWeChatAssistantSettings.mockReturnValue({
      ai: {
        providerId: null,
        model: null,
        windowDays: 14,
        prompts: {
          followupExtractor: 'FOLLOWUP',
          dailyReporter: 'DAILY',
          topicExtractor: 'TOPIC {scope} {windowDays}',
        },
      },
      topicAnalysis: {
        whitelistPersonal: ['alice'],
        whitelistGroups: [],
        maxMessagesPerCall: 500,
        minChatMessages: 1,
      },
      excludedPersonIds: [],
    } as never);
    upsertSessions([{
      wxid: 'alice',
      display: 'Alice',
      isGroup: false,
      lastTs: Math.floor(Date.now() / 1000),
      messageCount: 2,
      unreadCount: 0,
      summary: '',
    }]);
    insertMessages([
      {
        wxid: 'alice',
        ts: Math.floor(Date.now() / 1000) - 10,
        sender: 'me',
        msgType: 1,
        content: '项目今天推进',
      },
      {
        wxid: 'alice',
        ts: Math.floor(Date.now() / 1000) - 5,
        sender: 'them',
        msgType: 1,
        content: '收到',
      },
    ]);
  });

  it('uses global default provider when settings follow global', async () => {
    const result = await runTopicExtraction({ scope: 'personal' });

    expect(result.status).toBe('completed');
    expect(mockRunSync).toHaveBeenCalled();
    expect(mockGetDefaultProvider).toHaveBeenCalled();
    expect(mockResolveProviderModelForRequest).toHaveBeenCalledWith(
      { id: 'global-provider', name: 'Global Provider' },
      null,
      'sonnet',
    );
    expect(mockGenerateObjectWithFallback).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'global-provider',
      model: 'resolved-model',
      system: expect.stringContaining('一对一私聊'),
    }));
  });

  it('uses the selected WeChat assistant provider and model when configured', async () => {
    mockGetWeChatAssistantSettings.mockReturnValue({
      ai: {
        providerId: 'selected-provider',
        model: 'selected-model',
        windowDays: 14,
        prompts: {
          followupExtractor: 'FOLLOWUP',
          dailyReporter: 'DAILY',
          topicExtractor: 'TOPIC {scope} {windowDays}',
        },
      },
      topicAnalysis: {
        whitelistPersonal: ['alice'],
        whitelistGroups: [],
        maxMessagesPerCall: 500,
        minChatMessages: 1,
      },
      excludedPersonIds: [],
    } as never);

    await runTopicExtraction({ scope: 'personal' });

    expect(mockGetProvider).toHaveBeenCalledWith('selected-provider');
    expect(mockResolveProviderModelForRequest).toHaveBeenCalledWith(
      { id: 'selected-provider', name: 'Selected Provider' },
      'selected-model',
      'sonnet',
    );
    expect(mockGenerateObjectWithFallback).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'selected-provider',
      model: 'resolved-model',
    }));
  });

  it('skips topic extraction when WeChat sync is unavailable', async () => {
    mockRunSync.mockResolvedValueOnce({
      status: 'skipped',
      reason: 'no_key',
      inserted: 0,
      seen: 0,
      cursorTs: 0,
      durationMs: 0,
    });

    const result = await runTopicExtraction({ scope: 'personal' });

    expect(result).toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'sync_unavailable',
    }));
    expect(mockGenerateObjectWithFallback).not.toHaveBeenCalled();
  });

  it('skips topic extraction when the default provider uses local auth', async () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'local-provider',
      name: '本地',
      auth_mode: 'local_auth',
      capabilities: '["text-gen"]',
    } as never);

    const result = await runTopicExtraction({ scope: 'personal' });

    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'no_provider' }));
    expect(mockResolveProviderModelForRequest).not.toHaveBeenCalled();
    expect(mockGenerateObjectWithFallback).not.toHaveBeenCalled();
  });

  it('uses a local fallback when group topic AI returns malformed JSON', async () => {
    mockGetWeChatAssistantSettings.mockReturnValue({
      ai: {
        providerId: null,
        model: null,
        windowDays: 14,
        prompts: {
          followupExtractor: 'FOLLOWUP',
          dailyReporter: 'DAILY',
          topicExtractor: 'TOPIC {scope} {windowDays}',
        },
      },
      topicAnalysis: {
        whitelistPersonal: [],
        whitelistGroups: ['group-1@chatroom'],
        maxMessagesPerCall: 500,
        minChatMessages: 1,
      },
      excludedPersonIds: [],
    } as never);
    upsertSessions([{
      wxid: 'group-1@chatroom',
      display: '项目群',
      isGroup: true,
      lastTs: Math.floor(Date.now() / 1000),
      messageCount: 4,
      unreadCount: 0,
      summary: '',
    }]);
    insertMessages([
      {
        wxid: 'group-1@chatroom',
        ts: Math.floor(Date.now() / 1000) - 30,
        sender: 'them',
        msgType: 1,
        content: '合同回款今天需要确认',
      },
      {
        wxid: 'group-1@chatroom',
        ts: Math.floor(Date.now() / 1000) - 20,
        sender: 'them',
        msgType: 1,
        content: '合同回款金额请再核对',
      },
      {
        wxid: 'group-1@chatroom',
        ts: Math.floor(Date.now() / 1000) - 10,
        sender: 'me',
        msgType: 1,
        content: '我来确认合同回款',
      },
    ]);
    mockGenerateObjectWithFallback.mockRejectedValueOnce(
      new SyntaxError("Expected ',' or '}' after property value in JSON at position 353"),
    );

    const result = await runTopicExtraction({ scope: 'group' });

    expect(result.status).toBe('completed');
    expect(result.topics.length).toBeGreaterThan(0);
    expect(result.topics[0]?.summary).toContain('本地兜底');
    expect(result.error).toBeUndefined();
  });
});
