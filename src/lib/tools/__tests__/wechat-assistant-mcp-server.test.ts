const mockCreateSdkMcpServer = jest.fn((cfg: { name: string; tools: Array<{ name: string }> }) => cfg);
const mockTool = jest.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
  name,
  description,
  schema,
  handler,
}));
const mockGetSyncState = jest.fn();
const mockSearchMessages = jest.fn();
const mockReadChatMessages = jest.fn();
const mockListTodos = jest.fn();
const mockAddManualTodo = jest.fn();
const mockSetTodoStatus = jest.fn();
const mockDeleteTodo = jest.fn();
const mockListWeChatAutomations = jest.fn();
const mockCreateWeChatAutomation = jest.fn();
const mockTriggerWeChatAutomation = jest.fn();
const mockUpdateWeChatAutomation = jest.fn();
const mockDeleteWeChatAutomation = jest.fn();
const mockRunSync = jest.fn();
const mockGetArchivedReport = jest.fn();
const mockGetLatestArchivedReportForAutomation = jest.fn();

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (...args: unknown[]) => mockCreateSdkMcpServer(...args),
  tool: (...args: unknown[]) => mockTool(...args),
}));

jest.mock('@/lib/wechat-assistant/mirror-store', () => ({
  getSyncState: (...args: unknown[]) => mockGetSyncState(...args),
  readChatMessages: (...args: unknown[]) => mockReadChatMessages(...args),
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

jest.mock('@/lib/wechat-assistant/sync-engine', () => ({
  FRESH_WINDOW_MS: 5 * 60 * 1000,
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));

jest.mock('@/lib/wechat-assistant/report-archive', () => ({
  getArchivedWeChatAutomationReport: (...args: unknown[]) => mockGetArchivedReport(...args),
  getLatestArchivedReportForAutomation: (...args: unknown[]) =>
    mockGetLatestArchivedReportForAutomation(...args),
}));

import {
  createWeChatAssistantMcpServer,
  WECHAT_ASSISTANT_MCP_SYSTEM_HINT,
  WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT,
  WECHAT_ASSISTANT_MCP_SERVER_NAME,
} from '../wechat-assistant-mcp-server';

describe('wechat assistant MCP server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSyncState.mockReturnValue({
      cursorTs: 1,
      firstStartedAt: 1,
      lastFinishedAt: Date.now(),
      lastError: null,
      totalMessages: 42,
    });
    mockRunSync.mockResolvedValue({
      status: 'completed',
      inserted: 0,
      seen: 0,
      cursorTs: 1,
      durationMs: 0,
    });
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
      'read_wechat_automation_report',
      'read_wechat_chat',
      'resolve_wechat_automation',
      'resolve_wechat_followup',
      'search_wechat_messages',
      'set_wechat_automation_enabled',
      'trigger_wechat_automation',
      'update_wechat_automation',
    ]);
  });

  it('registers only read-only message tools for standard Agent Chat access', () => {
    const server = createWeChatAssistantMcpServer({ readOnly: true }) as {
      name: string;
      tools: Array<{ name: string }>;
    };

    expect(server.name).toBe(WECHAT_ASSISTANT_MCP_SERVER_NAME);
    expect(server.tools.map((item) => item.name).sort()).toEqual([
      'get_wechat_assistant_status',
      'read_wechat_chat',
      'search_wechat_messages',
    ]);
    expect(server.tools.map((item) => item.name)).not.toContain('create_wechat_automation');
    expect(server.tools.map((item) => item.name)).not.toContain('update_wechat_automation');
    expect(server.tools.map((item) => item.name)).not.toContain('delete_wechat_followup');
  });

  it('documents the Agent Chat read-only WeChat search path in the system hint', () => {
    expect(WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT).toContain(
      'mcp__lumos-wechat-assistant__search_wechat_messages',
    );
    expect(WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT).toContain(
      'mcp__lumos-wechat-assistant__read_wechat_chat',
    );
    expect(WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT).toContain('read-only');
    expect(WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT).toContain('instead of saying you do not have this capability');
    expect(WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT).toContain('wechat_read_chat');
    expect(WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT).toContain('200-message limit is one page only');
  });

  it('routes report forwarding through the archived report instead of re-summarizing', () => {
    expect(WECHAT_ASSISTANT_MCP_SYSTEM_HINT).toContain('not a delivery channel');
    expect(WECHAT_ASSISTANT_MCP_SYSTEM_HINT).toContain('read_wechat_automation_report');
    expect(WECHAT_ASSISTANT_MCP_SYSTEM_HINT).toContain('reuse its `report_markdown` verbatim');
    expect(WECHAT_ASSISTANT_MCP_SYSTEM_HINT).toContain(
      'Never re-run a message search to regenerate a different, lighter summary',
    );
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
      msgType: 1,
      content: '请整理节前遗留问题清单',
    }]);

    const result = await searchTool?.handler({ query: '节前', limit: 120, offset: 40 });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockSearchMessages).toHaveBeenCalledWith(expect.objectContaining({
      query: '节前',
      scope: 'all',
      limit: 120,
      offset: 40,
    }));
    expect(text).toContain('客户群');
    expect(text).toContain('张三');
    expect(text).toContain('请整理节前遗留问题清单');
    expect(text).toContain('"offset": 40');
  });

  it('refreshes a stale WeChat mirror before searching messages', async () => {
    createWeChatAssistantMcpServer();
    const searchTool = findTool('search_wechat_messages');
    mockGetSyncState
      .mockReturnValueOnce({
        cursorTs: 1,
        firstStartedAt: 1,
        lastFinishedAt: Date.now() - 10 * 60 * 1000,
        lastError: null,
        totalMessages: 42,
      })
      .mockReturnValueOnce({
        cursorTs: 2,
        firstStartedAt: 1,
        lastFinishedAt: Date.now(),
        lastError: null,
        totalMessages: 43,
      });
    mockRunSync.mockResolvedValue({
      status: 'completed',
      inserted: 1,
      seen: 8,
      cursorTs: 2,
      durationMs: 12,
    });
    mockSearchMessages.mockReturnValue([]);

    const result = await searchTool.handler({ query: '陈啟伟', limit: 5 });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockSearchMessages).toHaveBeenCalledWith(expect.objectContaining({
      query: '陈啟伟',
      limit: 5,
    }));
    expect(text).toContain('"inserted": 1');
    expect(text).toContain('"total_messages": 43');
  });

  it('syncs before reading a chat even when the previous mirror sync is fresh', async () => {
    createWeChatAssistantMcpServer({ readOnly: true });
    const readTool = findTool('read_wechat_chat');
    mockGetSyncState
      .mockReturnValueOnce({
        cursorTs: 1,
        firstStartedAt: 1,
        lastFinishedAt: Date.now(),
        lastError: null,
        totalMessages: 42,
      })
      .mockReturnValueOnce({
        cursorTs: 3,
        firstStartedAt: 1,
        lastFinishedAt: Date.now(),
        lastError: null,
        totalMessages: 44,
      });
    mockRunSync.mockResolvedValue({
      status: 'completed',
      inserted: 2,
      seen: 3,
      cursorTs: 3,
      durationMs: 20,
    });
    mockReadChatMessages.mockReturnValue({
      status: 'ok',
      query: '客户群',
      chat: {
        wxid: 'group_x@chatroom',
        display: '客户群',
        isGroup: true,
        lastTs: 1_777_000_100,
        messageCount: 300,
        unreadCount: 0,
        summary: '',
      },
      candidates: [],
      messages: [],
      limit: 200,
      offset: 0,
      hasMore: true,
      nextOffset: 200,
    });

    const result = await readTool.handler({ chat: '客户群', limit: 200 });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(mockReadChatMessages).toHaveBeenCalledWith(expect.objectContaining({
      chat: '客户群',
      limit: 200,
      offset: 0,
    }));
    expect(text).toContain('"attempted": true');
    expect(text).toContain('"next_offset": 200');
  });

  it('read_wechat_chat reads a visible chat directly without keyword matching', async () => {
    createWeChatAssistantMcpServer({ readOnly: true });
    const readTool = findTool('read_wechat_chat');
    mockReadChatMessages.mockReturnValue({
      status: 'ok',
      query: '陈啟伟',
      chat: {
        wxid: 'wxid_xxx',
        display: '陈啟伟',
        isGroup: false,
        lastTs: 1_777_000_100,
        messageCount: 88,
        unreadCount: 0,
        summary: '',
      },
      candidates: [],
      messages: [
        { ts: 1_777_000_000, sender: 'them', senderDisplay: null, msgType: 1, content: '今天的对话内容' },
        { ts: 1_777_000_010, sender: 'me', senderDisplay: null, msgType: 3, content: '' },
        { ts: 1_777_000_020, sender: 'them', senderDisplay: null, msgType: 1, content: '\u0001\u0002\u0003���' },
        {
          ts: 1_777_000_030,
          sender: 'them',
          senderDisplay: null,
          msgType: 49,
          content: '[文件] 报价单.xlsx · 12.0KB · 本地可打开',
          attachment: {
            kind: 'file',
            title: '报价单.xlsx',
            size: 12288,
            sizeLabel: '12.0KB',
            ext: 'xlsx',
            exists: true,
          },
        },
      ],
      limit: 50,
      offset: 0,
      hasMore: true,
      nextOffset: 50,
    });

    const result = await readTool.handler({ chat: '陈啟伟', limit: 50 });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockReadChatMessages).toHaveBeenCalledWith(expect.objectContaining({
      chat: '陈啟伟',
      scope: 'all',
      limit: 50,
      offset: 0,
    }));
    expect(text).toContain('陈啟伟');
    expect(text).toContain('今天的对话内容');
    expect(text).toContain('[图片]');
    expect(text).toContain('[暂不支持的消息]');
    expect(text).toContain('报价单.xlsx');
    expect(text).toContain('"kind": "file"');
    expect(text).toContain('"next_offset": 50');
    expect(text).not.toContain('wxid_xxx');
  });

  it('read_wechat_chat returns visible candidates when a chat name is ambiguous', async () => {
    createWeChatAssistantMcpServer({ readOnly: true });
    const readTool = findTool('read_wechat_chat');
    mockReadChatMessages.mockReturnValue({
      status: 'ambiguous',
      query: '项目',
      chat: null,
      candidates: [
        {
          wxid: 'group_1@chatroom',
          display: '项目群',
          isGroup: true,
          lastTs: 1_777_000_000,
          messageCount: 12,
          unreadCount: 0,
          summary: '讨论上线',
        },
        {
          wxid: 'group_2@chatroom',
          display: '项目复盘群',
          isGroup: true,
          lastTs: 1_776_000_000,
          messageCount: 5,
          unreadCount: 0,
          summary: '',
        },
      ],
      messages: [],
      limit: 50,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    const result = await readTool.handler({ chat: '项目' });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(text).toContain('"status": "ambiguous"');
    expect(text).toContain('项目群');
    expect(text).toContain('项目复盘群');
    expect(text).toContain('不要猜');
    expect(text).not.toContain('group_1@chatroom');
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

  it('read_wechat_automation_report returns the archived report verbatim for forwarding', async () => {
    createWeChatAssistantMcpServer();
    const reportTool = findTool('read_wechat_automation_report');
    mockListWeChatAutomations.mockReturnValue([automation({ id: 'a1', name: '每日微信总结' })]);
    mockGetLatestArchivedReportForAutomation.mockReturnValue({
      id: 'run-1',
      automationId: 'a1',
      automationName: '每日微信总结',
      scheduleId: 's1',
      runId: 'run-1',
      status: 'success',
      startedAt: '2026-05-15T01:00:00.000Z',
      completedAt: '2026-05-15T01:02:00.000Z',
      summary: '今日 3 个待办，2 个重点会话',
      error: '',
      reportMarkdown: '# 每日微信总结\n\n## 要点\n- 客户A确认下单\n\n## 待跟进\n- 回复客户B报价',
      reportFileName: 'wechat-daily-summary.md',
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await reportTool.handler({ automation_id: 'a1' });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(mockGetLatestArchivedReportForAutomation).toHaveBeenCalledWith('a1', { status: 'success' });
    expect(text).toContain('"found": true');
    expect(text).toContain('客户A确认下单');
    expect(text).toContain('回复客户B报价');
    expect(text).toContain('"has_full_report": true');
    expect(text).toContain('report_markdown 原文');
  });

  it('read_wechat_automation_report does not fabricate a report when none is archived', async () => {
    createWeChatAssistantMcpServer();
    const reportTool = findTool('read_wechat_automation_report');
    mockListWeChatAutomations.mockReturnValue([automation({ id: 'a1', name: '每日微信总结' })]);
    mockGetLatestArchivedReportForAutomation.mockReturnValue(null);

    const result = await reportTool.handler({ automation_id: 'a1' });
    const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

    expect(text).toContain('"found": false');
    expect(text).toContain('不要用临时重新汇总的内容冒充');
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
