const mockGetDefaultProvider = jest.fn();
const mockGetProvider = jest.fn();
const mockResolveProviderModelForRequest = jest.fn();
const mockGetWeChatAssistantSettings = jest.fn();
const mockExtractEventsAndTodos = jest.fn();
const mockCreateRun = jest.fn();
const mockInsertEvents = jest.fn();
const mockInsertTodoSuggestions = jest.fn();
const mockListTodos = jest.fn();
const mockMarkRunDone = jest.fn();
const mockMarkRunFailed = jest.fn();

jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: () => mockGetDefaultProvider(),
  getProvider: (id: string) => mockGetProvider(id),
}));

jest.mock('@/lib/model-metadata', () => ({
  resolveProviderModelForRequest: (...args: unknown[]) => mockResolveProviderModelForRequest(...args),
}));

jest.mock('../settings-store', () => ({
  getWeChatAssistantSettings: () => mockGetWeChatAssistantSettings(),
}));

jest.mock('../ai-event-extractor', () => ({
  extractEventsAndTodos: (...args: unknown[]) => mockExtractEventsAndTodos(...args),
}));

jest.mock('../db', () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  getLatestRun: jest.fn(() => null),
  insertEvents: (...args: unknown[]) => mockInsertEvents(...args),
  insertTodoSuggestions: (...args: unknown[]) => mockInsertTodoSuggestions(...args),
  listEventsByRun: jest.fn(() => []),
  listTodos: (...args: unknown[]) => mockListTodos(...args),
  markRunDone: (...args: unknown[]) => mockMarkRunDone(...args),
  markRunFailed: (...args: unknown[]) => mockMarkRunFailed(...args),
}));

import { runAIAnalysis, WeChatAIAnalysisError } from '../ai-runner';
import type { WeChatSnapshot } from '../analysis';

const provider = { id: 'provider-1', name: 'Provider 1' };
const selectedProvider = { id: 'selected-provider', name: 'Selected Provider' };

function settings(overrides: Partial<{
  providerId: string | null;
  model: string | null;
  followupPrompt: string;
  windowDays: 7 | 14 | 30 | 60;
  sensitivity: 'strict' | 'balanced' | 'loose';
  excludedPersonIds: string[];
}> = {}) {
  return {
    ai: {
      providerId: overrides.providerId ?? null,
      model: overrides.model ?? null,
      windowDays: overrides.windowDays ?? 14,
      sensitivity: overrides.sensitivity ?? 'balanced',
      prompts: {
        followupExtractor: overrides.followupPrompt ?? 'CUSTOM FOLLOWUP PROMPT',
        dailyReporter: 'DAILY',
        topicExtractor: 'TOPIC',
      },
    },
    excludedPersonIds: overrides.excludedPersonIds ?? [],
  };
}

const snapshot: WeChatSnapshot = {
  sessions: [],
  messages: [{
    wxid: 'alice',
    display: 'Alice',
    isGroup: false,
    ts: 1,
    sender: 'me',
    type: 1,
    content: '我明天发方案',
  }],
  sessionsScanned: 1,
  messagesScanned: 1,
  totalReadableMessages: 1,
  selectedReadableMessages: 1,
  messagesTruncated: false,
  scanScope: 'test',
  safetyLimit: 10,
};

describe('runAIAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDefaultProvider.mockReturnValue(provider);
    mockGetProvider.mockReturnValue(selectedProvider);
    mockResolveProviderModelForRequest.mockReturnValue('resolved-model');
    mockGetWeChatAssistantSettings.mockReturnValue(settings());
    mockCreateRun.mockReturnValue({
      id: 'run-1',
      snapshotHash: 'hash',
      providerId: 'provider-1',
      model: 'resolved-model',
      startedAt: 1,
      finishedAt: null,
      status: 'running',
      message: null,
      eventsCount: 0,
      todosCount: 0,
      tokensIn: null,
      tokensOut: null,
      messagesScanned: 1,
    });
    mockExtractEventsAndTodos.mockResolvedValue({ events: [], todos: [], cropped: { messages: [] } });
    mockInsertEvents.mockReturnValue([]);
    mockInsertTodoSuggestions.mockReturnValue([]);
    mockListTodos.mockReturnValue([]);
  });

  it('uses the WeChat assistant selected provider, selected model, and followup prompt', async () => {
    mockGetWeChatAssistantSettings.mockReturnValue(settings({
      providerId: 'selected-provider',
      model: 'selected-model',
      followupPrompt: '只提取明确待办',
    }));

    await runAIAnalysis(snapshot);

    expect(mockGetProvider).toHaveBeenCalledWith('selected-provider');
    expect(mockResolveProviderModelForRequest).toHaveBeenCalledWith(
      selectedProvider,
      'selected-model',
      'sonnet',
    );
    expect(mockExtractEventsAndTodos).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'selected-provider',
      model: 'resolved-model',
      systemPrompt: expect.stringContaining('只提取明确待办'),
      cropOptions: { windowDays: 14 },
    }));
  });

  it('falls back to the global default provider when WeChat settings follow global', async () => {
    mockGetWeChatAssistantSettings.mockReturnValue(settings({ providerId: null, model: null }));

    await runAIAnalysis(snapshot);

    expect(mockGetDefaultProvider).toHaveBeenCalled();
    expect(mockResolveProviderModelForRequest).toHaveBeenCalledWith(provider, null, 'sonnet');
  });

  it('reports no_model when the chosen provider has no usable model', async () => {
    mockResolveProviderModelForRequest.mockReturnValue(null);

    await expect(runAIAnalysis(snapshot)).rejects.toMatchObject({
      code: 'no_model',
    } satisfies Partial<WeChatAIAnalysisError>);
    expect(mockExtractEventsAndTodos).not.toHaveBeenCalled();
  });

  it('rejects local auth providers before lightweight extraction', async () => {
    mockGetDefaultProvider.mockReturnValue({
      ...provider,
      auth_mode: 'local_auth',
      capabilities: '["text-gen"]',
    });

    await expect(runAIAnalysis(snapshot)).rejects.toMatchObject({
      code: 'no_provider',
      message: expect.stringContaining('本地登录授权'),
    } satisfies Partial<WeChatAIAnalysisError>);
    expect(mockResolveProviderModelForRequest).not.toHaveBeenCalled();
    expect(mockExtractEventsAndTodos).not.toHaveBeenCalled();
  });

  it('applies excluded chat ids before sending the snapshot to the LLM', async () => {
    mockGetWeChatAssistantSettings.mockReturnValue(settings({
      excludedPersonIds: ['blocked'],
      windowDays: 7,
      sensitivity: 'strict',
    }));
    const input: WeChatSnapshot = {
      ...snapshot,
      sessions: [
        { wxid: 'alice', display: 'Alice' },
        { wxid: 'blocked', display: 'Blocked' },
      ],
      messages: [
        ...snapshot.messages,
        {
          wxid: 'blocked',
          display: 'Blocked',
          isGroup: false,
          ts: 2,
          sender: 'them',
          type: 1,
          content: '不要发送给模型',
        },
      ],
      messagesScanned: 2,
    };

    await runAIAnalysis(input);

    const call = mockExtractEventsAndTodos.mock.calls[0]?.[0] as { snapshot: WeChatSnapshot; cropOptions: { windowDays: number }; systemPrompt: string };
    expect(call.snapshot.messages.map((message) => message.wxid)).toEqual(['alice']);
    expect(call.snapshot.sessions.map((session) => session.wxid)).toEqual(['alice']);
    expect(call.cropOptions).toEqual({ windowDays: 7 });
    expect(call.systemPrompt).toContain('灵敏度：严格');
    expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({ messagesScanned: 1 }));
  });
});
