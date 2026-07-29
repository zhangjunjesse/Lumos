const mockAddMessage = jest.fn();
const mockGetMessages = jest.fn();
const mockGetSession = jest.fn();
const mockGetMcpServerByNameAndScope = jest.fn();
const mockGetSetting = jest.fn();
const mockUpdateSdkSessionId = jest.fn();
const mockUpdateSessionModel = jest.fn();
const mockUpdateSessionProvider = jest.fn();
const mockUpdateSessionProviderId = jest.fn();
const mockUpdateSessionResolvedModel = jest.fn();
const mockResolveEnabledMcpServers = jest.fn();
const mockStreamClaude = jest.fn();
const mockCreateWeChatAssistantMcpServer = jest.fn();
const mockResolveProviderForCapability = jest.fn();
const mockGetProviderEffectiveDefaultModel = jest.fn();

jest.mock('@/lib/db', () => ({
  dataDir: '/tmp/lumos-test-data',
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
  getMessages: (...args: unknown[]) => mockGetMessages(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getMcpServerByNameAndScope: (...args: unknown[]) => mockGetMcpServerByNameAndScope(...args),
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  updateSdkSessionId: (...args: unknown[]) => mockUpdateSdkSessionId(...args),
  updateSessionModel: (...args: unknown[]) => mockUpdateSessionModel(...args),
  updateSessionProvider: (...args: unknown[]) => mockUpdateSessionProvider(...args),
  updateSessionProviderId: (...args: unknown[]) => mockUpdateSessionProviderId(...args),
  updateSessionResolvedModel: (...args: unknown[]) => mockUpdateSessionResolvedModel(...args),
}));

jest.mock('@/lib/mcp-resolver', () => ({
  resolveEnabledMcpServers: (...args: unknown[]) => mockResolveEnabledMcpServers(...args),
}));

jest.mock('@/lib/provider-resolver', () => ({
  resolveProviderForCapability: (...args: unknown[]) => mockResolveProviderForCapability(...args),
}));

jest.mock('@/lib/claude/provider-env', () => ({
  getProviderEffectiveDefaultModel: (...args: unknown[]) => mockGetProviderEffectiveDefaultModel(...args),
}));

jest.mock('@/lib/claude-client', () => ({
  streamClaude: (...args: unknown[]) => mockStreamClaude(...args),
}));

jest.mock('@/lib/auth/user-service', () => ({
  getActiveUserId: () => 'user-1',
}));

jest.mock('@/lib/app/im-bridge', () => ({
  buildLatestAppImNotificationHint: () => '',
}));

jest.mock('@/lib/tools/wechat-assistant-mcp-server', () => ({
  createWeChatAssistantMcpServer: (...args: unknown[]) => mockCreateWeChatAssistantMcpServer(...args),
  WECHAT_ASSISTANT_MCP_SYSTEM_HINT: 'WECHAT_FULL_HINT',
  WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT: 'WECHAT_RO_HINT',
}));

jest.mock('@/lib/tools/lumos-mcp-server', () => ({
  createLumosMcpServer: () => ({ name: 'lumos-image' }),
}));

jest.mock('@/lib/tools/lumos-butler-mcp-server', () => ({
  createLumosButlerMcpServer: () => ({ name: 'lumos-butler' }),
  LUMOS_BUTLER_MCP_SYSTEM_HINT: 'BUTLER_HINT_TEXT',
}));

jest.mock('@/lib/tools/lumos-issue-reporter-mcp-server', () => ({
  createLumosIssueReporterMcpServer: () => ({ name: 'lumos-issue-reporter' }),
  LUMOS_ISSUE_REPORTER_MCP_SYSTEM_HINT: 'ISSUE_REPORTER_HINT_TEXT',
}));

jest.mock('@/lib/tools/workflow-mcp-server', () => ({
  createWorkflowMcpServer: () => ({ name: 'workflow-runner' }),
}));

jest.mock('@/lib/tools/ecommerce-assistant-mcp-server', () => ({
  createEcommerceAssistantMcpServer: () => ({ name: 'ecommerce-assistant' }),
}));

jest.mock('@/lib/knowledge/chat-knowledge-mcp', () => ({
  createChatKnowledgeMcpServer: () => ({ name: 'chat-knowledge' }),
  CHAT_KNOWLEDGE_MCP_SYSTEM_HINT: 'KNOWLEDGE_HINT_TEXT',
}));

jest.mock('@/lib/im', () => ({
  hasImToolsMcp: (servers?: Record<string, unknown>) => Boolean(servers?.['im-tools']),
  IM_TOOLS_SYSTEM_HINT: 'IM_TOOLS_HINT_TEXT',
}));

import { ConversationEngine } from '../conversation-engine';

function streamText(text: string): ReadableStream<string> {
  const chunk = `data: ${JSON.stringify({ type: 'text', data: text })}\n\n`;
  return new ReadableStream<string>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
}

function streamEvent(type: string, data: string): ReadableStream<string> {
  const chunk = `data: ${JSON.stringify({ type, data })}\n\n`;
  return new ReadableStream<string>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('ConversationEngine capability injection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMcpServerByNameAndScope.mockReturnValue({ is_enabled: 1 });
    mockCreateWeChatAssistantMcpServer.mockImplementation((options?: { readOnly?: boolean }) => ({
      name: 'lumos-wechat-assistant',
      readOnly: !!options?.readOnly,
    }));
    mockResolveEnabledMcpServers.mockReturnValue({
      'im-tools': {},
      feishu: {},
      deepsearch: {},
      'speech-to-text': {},
    });
    mockResolveProviderForCapability.mockReturnValue({
      id: 'provider-main',
      name: 'Main Provider',
      default_model: '',
      extra_env: '',
    });
    mockGetProviderEffectiveDefaultModel.mockReturnValue('claude-sonnet-test');
    mockGetSetting.mockReturnValue('');
    mockStreamClaude.mockReturnValue(streamText('已读到。'));
    mockGetMessages.mockReturnValue({
      messages: [
        { role: 'user', content: '上一条' },
        { role: 'user', content: '<!--source:wechat-->看下微信消息' },
      ],
    });
  });

  test('injects WeChat read tools for WeChat IM messages routed to Main Agent', async () => {
    mockGetSession.mockReturnValue({
      id: 'main-1',
      kind: 'main-agent',
      system_prompt: '',
      working_directory: '',
      sdk_session_id: null,
      requested_model: null,
      model: null,
      provider_id: '',
      provider_name: '',
      sdk_cwd: '',
    });

    const response = await new ConversationEngine().sendMessage(
      'main-1',
      '看下微信消息',
      undefined,
      { source: 'wechat', imContext: { providerId: 'wechat', chatId: 'wx-chat-1' } },
    );

    const resolverOptions = mockResolveEnabledMcpServers.mock.calls[0][0] as {
      skipNames: Set<string>;
      sessionWorkingDirectory?: string;
    };
    expect([...resolverOptions.skipNames]).toContain('wechat-export');
    expect(resolverOptions.sessionWorkingDirectory).toBe('/tmp/lumos-test-data');

    const streamOptions = mockStreamClaude.mock.calls[0][0] as {
      inProcessMcpServers: Record<string, { readOnly?: boolean }>;
      systemPrompt?: string;
      abortController?: AbortController;
      toolTimeoutSeconds?: number;
      provider?: { id: string };
      model?: string;
      workingDirectory?: string;
    };
    expect(Object.keys(streamOptions.inProcessMcpServers)).toEqual(
      expect.arrayContaining(['lumos-wechat-assistant', 'lumos-butler', 'lumos-image']),
    );
    expect(streamOptions.inProcessMcpServers['lumos-wechat-assistant'].readOnly).toBe(true);
    expect(streamOptions.systemPrompt).toContain('WECHAT_RO_HINT');
    expect(streamOptions.systemPrompt).toContain('BUTLER_HINT_TEXT');
    expect(streamOptions.systemPrompt).toContain('Active IM context');
    expect(streamOptions.abortController).toBeInstanceOf(AbortController);
    expect(streamOptions.toolTimeoutSeconds).toBe(900);
    expect(streamOptions.provider?.id).toBe('provider-main');
    expect(streamOptions.model).toBe('claude-sonnet-test');
    expect(streamOptions.workingDirectory).toBe('/tmp/lumos-test-data');
    expect(mockUpdateSessionProvider).toHaveBeenCalledWith('main-1', 'Main Provider');
    expect(mockUpdateSessionProviderId).toHaveBeenCalledWith('main-1', 'provider-main');
    expect(mockUpdateSessionModel).toHaveBeenCalledWith('main-1', 'claude-sonnet-test');
    expect(response.visibleText).toBe('已读到。');
  });

  test('surfaces Claude error SSE as visible IM text', async () => {
    mockGetSession.mockReturnValue({
      id: 'main-err',
      kind: 'main-agent',
      system_prompt: '',
      working_directory: '/tmp/lumos-main',
      sdk_session_id: null,
      requested_model: null,
      model: null,
      provider_id: 'provider-main',
      provider_name: 'Main Provider',
      sdk_cwd: '/tmp/lumos-main',
    });
    mockStreamClaude.mockReturnValue(streamEvent('error', '模型在 180 秒内没有返回首个内容。'));

    const response = await new ConversationEngine().sendMessage(
      'main-err',
      '你好',
      undefined,
      { source: 'wechat', imContext: { providerId: 'wechat', chatId: 'wx-chat-1' } },
    );

    expect(response.visibleText).toBe('模型在 180 秒内没有返回首个内容。');
    const assistantWrite = mockAddMessage.mock.calls.find((call) => call[1] === 'assistant');
    expect(assistantWrite?.[2]).toBe('模型在 180 秒内没有返回首个内容。');
  });

  test('keeps dedicated WeChat Assistant sessions on the full WeChat tool contract', async () => {
    mockGetSession.mockReturnValue({
      id: 'wechat-1',
      title: '微信助手 AI 对话',
      kind: 'wechat-assistant',
      system_prompt: '',
      working_directory: '/tmp/lumos-wechat',
      sdk_session_id: null,
      requested_model: null,
      model: null,
      provider_id: 'provider-main',
      provider_name: 'Main Provider',
      sdk_cwd: '/tmp/lumos-wechat',
    });

    await new ConversationEngine().sendMessage('wechat-1', '列出微信自动化');

    const streamOptions = mockStreamClaude.mock.calls[0][0] as {
      inProcessMcpServers: Record<string, { readOnly?: boolean }>;
      systemPrompt?: string;
    };
    expect(streamOptions.inProcessMcpServers['lumos-wechat-assistant'].readOnly).toBe(false);
    expect(streamOptions.systemPrompt).toContain('WECHAT_FULL_HINT');
    expect(streamOptions.systemPrompt).not.toContain('WECHAT_RO_HINT');
  });

  test('strips leaked tool trace markers before persisting or returning visible IM text', async () => {
    mockGetSession.mockReturnValue({
      id: 'main-2',
      kind: 'main-agent',
      system_prompt: '',
      working_directory: '/tmp/lumos-main',
      sdk_session_id: null,
      requested_model: null,
      model: null,
      provider_id: 'provider-main',
      provider_name: 'Main Provider',
      sdk_cwd: '/tmp/lumos-main',
    });
    mockStreamClaude.mockReturnValue(streamText(
      '我先采集这个视频。 [Used tool: mcp__douyin-collector__douyin_collect] [Tool result: {"ok":true,"tags":["眼镜"]}] 采集完成。',
    ));

    const response = await new ConversationEngine().sendMessage(
      'main-2',
      '看下这个抖音',
      undefined,
      { source: 'wechat', imContext: { providerId: 'wechat', chatId: 'wx-chat-1' } },
    );

    expect(response.visibleText).toBe('我先采集这个视频。采集完成。');
    const assistantWrite = mockAddMessage.mock.calls.find((call) => call[1] === 'assistant');
    expect(assistantWrite?.[2]).toBe('我先采集这个视频。采集完成。');
  });
});
