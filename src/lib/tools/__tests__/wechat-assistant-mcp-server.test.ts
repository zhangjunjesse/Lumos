const mockCreateSdkMcpServer = jest.fn((cfg: { name: string; tools: Array<{ name: string }> }) => cfg);
const mockTool = jest.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
  name,
  description,
  schema,
  handler,
}));
const mockGetSyncState = jest.fn();
const mockSearchMessages = jest.fn();
const mockListTodos = jest.fn();
const mockAddManualTodo = jest.fn();
const mockSetTodoStatus = jest.fn();
const mockDeleteTodo = jest.fn();
const mockListWeChatAutomations = jest.fn();
const mockCreateWeChatAutomation = jest.fn();
const mockTriggerWeChatAutomation = jest.fn();
const mockUpdateWeChatAutomation = jest.fn();
const mockDeleteWeChatAutomation = jest.fn();

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (...args: unknown[]) => mockCreateSdkMcpServer(...args),
  tool: (...args: unknown[]) => mockTool(...args),
}));

jest.mock('@/lib/wechat-assistant/mirror-store', () => ({
  getSyncState: (...args: unknown[]) => mockGetSyncState(...args),
  searchMessages: (...args: unknown[]) => mockSearchMessages(...args),
}));

jest.mock('@/lib/wechat-assistant/db', () => ({
  addManualTodo: (...args: unknown[]) => mockAddManualTodo(...args),
  deleteTodo: (...args: unknown[]) => mockDeleteTodo(...args),
  listTodos: (...args: unknown[]) => mockListTodos(...args),
  setTodoStatus: (...args: unknown[]) => mockSetTodoStatus(...args),
}));

jest.mock('@/lib/wechat-assistant/automations', () => ({
  createWeChatAutomation: (...args: unknown[]) => mockCreateWeChatAutomation(...args),
  deleteWeChatAutomation: (...args: unknown[]) => mockDeleteWeChatAutomation(...args),
  listWeChatAutomations: (...args: unknown[]) => mockListWeChatAutomations(...args),
  triggerWeChatAutomation: (...args: unknown[]) => mockTriggerWeChatAutomation(...args),
  updateWeChatAutomation: (...args: unknown[]) => mockUpdateWeChatAutomation(...args),
}));

import {
  createWeChatAssistantMcpServer,
  WECHAT_ASSISTANT_MCP_SERVER_NAME,
} from '../wechat-assistant-mcp-server';

describe('wechat assistant MCP server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers the expected in-process tools for the unified ChatView panel', () => {
    const server = createWeChatAssistantMcpServer() as { name: string; tools: Array<{ name: string }> };

    expect(server.name).toBe(WECHAT_ASSISTANT_MCP_SERVER_NAME);
    expect(server.tools.map((item) => item.name).sort()).toEqual([
      'batch_set_wechat_automations_enabled',
      'complete_wechat_followup',
      'create_wechat_automation',
      'create_wechat_followup',
      'delete_wechat_automation',
      'delete_wechat_followup',
      'diagnose_wechat_automation',
      'get_wechat_assistant_status',
      'list_wechat_automations',
      'list_wechat_followups',
      'resolve_wechat_automation',
      'resolve_wechat_followup',
      'search_wechat_messages',
      'set_wechat_automation_enabled',
      'trigger_wechat_automation',
      'update_wechat_automation',
    ]);
  });

  it('search_wechat_messages returns product-facing fields', async () => {
    createWeChatAssistantMcpServer();
    const searchTool = mockTool.mock.results
      .map((result) => result.value as { name: string; handler: (args: unknown) => Promise<unknown> })
      .find((item) => item.name === 'search_wechat_messages');

    mockSearchMessages.mockReturnValue([{
      display: '客户群',
      isGroup: true,
      sender: 'them',
      senderDisplay: '张三',
      ts: 1_777_000_000,
      content: '请整理节前遗留问题清单',
    }]);

    const result = await searchTool?.handler({ query: '节前', limit: 5 });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockSearchMessages).toHaveBeenCalledWith(expect.objectContaining({
      query: '节前',
      scope: 'all',
      limit: 5,
    }));
    expect(text).toContain('客户群');
    expect(text).toContain('张三');
    expect(text).toContain('请整理节前遗留问题清单');
  });

  it('update_wechat_automation updates schedule and message content', async () => {
    createWeChatAssistantMcpServer();
    const updateTool = findTool('update_wechat_automation');
    mockListWeChatAutomations.mockReturnValue([
      automation({ id: 'a1', name: '每日微信总结', action: { kind: 'wechat_summary', messageTemplate: '旧要求' } }),
    ]);
    mockUpdateWeChatAutomation.mockResolvedValue(
      automation({
        id: 'a1',
        name: '每日微信总结',
        cron: '0 22 * * *',
        cronLabel: '每天 22:00',
        action: { kind: 'wechat_summary', messageTemplate: '只总结待办' },
      }),
    );

    const result = await updateTool.handler({
      id: 'a1',
      schedule_text: '每天晚上 10 点',
      message_template: '只总结待办',
    });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockUpdateWeChatAutomation).toHaveBeenCalledWith('a1', expect.objectContaining({
      kind: 'reminder_recurring',
      cron: '0 22 * * *',
      cronLabel: '每天 22:00',
      action: { kind: 'wechat_summary', messageTemplate: '只总结待办' },
    }));
    expect(text).toContain('每天 22:00');
    expect(text).toContain('只总结待办');
  });

  it('create_wechat_automation creates a daily summary automation from natural schedule text', async () => {
    createWeChatAssistantMcpServer();
    const createTool = findTool('create_wechat_automation');
    mockListWeChatAutomations.mockReturnValue([]);
    mockCreateWeChatAutomation.mockResolvedValue(
      automation({
        id: 'a1',
        name: '每日微信总结',
        cron: '0 22 * * *',
        cronLabel: '每天 22:00',
        action: { kind: 'wechat_summary', messageTemplate: '只总结待办' },
      }),
    );

    const result = await createTool.handler({
      schedule_text: '每天晚上 10 点',
      action_kind: 'wechat_summary',
      message_template: '只总结待办',
    });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockCreateWeChatAutomation).toHaveBeenCalledWith(expect.objectContaining({
      name: '每日微信总结',
      kind: 'reminder_recurring',
      cron: '0 22 * * *',
      cronLabel: '每天 22:00',
      action: { kind: 'wechat_summary', messageTemplate: '只总结待办' },
      enabled: true,
    }));
    expect(text).toContain('"created": true');
    expect(text).toContain('每日微信总结');
  });

  it('resolve_wechat_automation returns candidates without exposing internal ids as display names', async () => {
    createWeChatAssistantMcpServer();
    const resolveTool = findTool('resolve_wechat_automation');
    mockListWeChatAutomations.mockReturnValue([
      automation({ id: 'a1', name: '每日微信总结' }),
      automation({ id: 'a2', name: '客户回款提醒' }),
    ]);

    const result = await resolveTool.handler({ query: '每日总结' });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(text).toContain('每日微信总结');
    expect(text).toContain('a1');
    expect(text).toContain('match_score');
  });

  it('delete_wechat_followup deletes the requested follow-up', async () => {
    createWeChatAssistantMcpServer();
    const deleteTool = findTool('delete_wechat_followup');
    mockListTodos.mockReturnValue([
      followup({ id: 'f1', text: '整理客户问题清单' }),
    ]);
    mockDeleteTodo.mockReturnValue(true);

    const result = await deleteTool.handler({ id: 'f1' });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockDeleteTodo).toHaveBeenCalledWith('f1');
    expect(text).toContain('整理客户问题清单');
  });

  it('delete_wechat_automation deletes the requested automation', async () => {
    createWeChatAssistantMcpServer();
    const deleteTool = findTool('delete_wechat_automation');
    mockListWeChatAutomations.mockReturnValue([automation({ id: 'a1', name: '每日微信总结' })]);
    mockDeleteWeChatAutomation.mockResolvedValue(true);

    const result = await deleteTool.handler({ id: 'a1' });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockDeleteWeChatAutomation).toHaveBeenCalledWith('a1');
    expect(text).toContain('每日微信总结');
  });

  it('get_wechat_assistant_status returns sync and visible task counts', async () => {
    createWeChatAssistantMcpServer();
    const statusTool = findTool('get_wechat_assistant_status');
    mockGetSyncState.mockReturnValue({
      cursorTs: 1,
      firstStartedAt: 1,
      lastFinishedAt: 1_777_000_000_000,
      lastError: null,
      totalMessages: 42,
    });
    mockListTodos.mockReturnValue([
      followup({ id: 'f1', status: 'open' }),
      followup({ id: 'f2', status: 'suggested' }),
    ]);
    mockListWeChatAutomations.mockReturnValue([
      automation({ id: 'a1', enabled: true }),
      automation({ id: 'a2', enabled: false }),
    ]);

    const result = await statusTool.handler({});
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(text).toContain('"total_messages": 42');
    expect(text).toContain('"active_count": 2');
    expect(text).toContain('"enabled_count": 1');
  });
});

function findTool(name: string): { name: string; handler: (args: unknown) => Promise<unknown> } {
  const item = mockTool.mock.results
    .map((result) => result.value as { name: string; handler: (args: unknown) => Promise<unknown> })
    .find((toolDef) => toolDef.name === name);
  if (!item) throw new Error(`missing tool ${name}`);
  return item;
}

function automation(patch: Partial<{
  id: string;
  name: string;
  kind: 'reminder_recurring' | 'reminder_once';
  cron: string;
  cronLabel: string;
  enabled: boolean;
  action: { kind: 'wechat_summary' | 'custom'; messageTemplate: string };
}> = {}) {
  return {
    id: patch.id ?? 'a1',
    name: patch.name ?? '提醒',
    kind: patch.kind ?? 'reminder_recurring',
    cron: patch.cron ?? '0 9 * * *',
    cronLabel: patch.cronLabel ?? '每天 09:00',
    enabled: patch.enabled ?? true,
    createdAt: 1,
    action: patch.action ?? { kind: 'custom', messageTemplate: '提醒内容' },
  };
}

function followup(patch: Partial<{
  id: string;
  text: string;
  status: 'suggested' | 'open' | 'in_progress' | 'done' | 'dismissed';
}> = {}) {
  return {
    id: patch.id ?? 'f1',
    runId: null,
    text: patch.text ?? '整理客户问题清单',
    source: 'manual',
    sourceMsgId: null,
    sourceText: null,
    sourceDisplay: null,
    sourceSenderDisplay: null,
    sourceWxid: null,
    involvedWxids: [],
    byWhenText: null,
    summary: null,
    nextStep: null,
    followupType: 'other',
    dueAt: null,
    remindAt: null,
    confidence: null,
    status: patch.status ?? 'open',
    createdAt: 1,
    confirmedAt: 1,
    doneAt: null,
  };
}
