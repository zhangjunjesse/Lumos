jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: jest.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
    name,
    description,
    schema,
    handler,
  })),
  createSdkMcpServer: jest.fn((cfg: { name: string; tools: Array<{ name: string }> }) => ({
    type: 'sdk',
    name: cfg.name,
    tools: cfg.tools,
  })),
}));

jest.mock('@/lib/db', () => ({
  getAllMcpServers: jest.fn(),
  getAllProviders: jest.fn(),
  getAllSessions: jest.fn(),
  getAllSkills: jest.fn(),
  getDefaultProvider: jest.fn(),
  getMessages: jest.fn(),
  getTasksBySession: jest.fn(),
  listBrowserProviderConfigs: jest.fn(),
  listDeepSearchRuns: jest.fn(),
  listDeepSearchSites: jest.fn(),
}));

jest.mock('@/lib/db/connection', () => ({
  getDb: jest.fn(),
}));

jest.mock('@/lib/db/capabilities', () => ({
  listDrafts: jest.fn(),
  listPackages: jest.fn(),
  listPublishedCodeCapabilities: jest.fn(),
  listPublishedPromptCapabilities: jest.fn(),
}));

jest.mock('@/lib/db/scheduled-workflows', () => ({
  listScheduledWorkflows: jest.fn(),
}));

jest.mock('@/lib/runtime-resources', () => ({
  getExternalRuntimeResourceRoot: jest.fn(() => '/tmp/lumos/runtime-resources'),
  getRuntimeResourceRoots: jest.fn(() => ['/tmp/lumos/runtime-resources']),
  resolveRuntimeResourcePath: jest.fn(() => null),
}));

jest.mock('@/lib/im', () => ({
  listPlugins: jest.fn(),
  getEnabledProviders: jest.fn(),
  getDefaultProviderId: jest.fn(),
  isProviderConfigured: jest.fn(),
  listActiveAdapters: jest.fn(),
}));

import {
  buildLumosStatus,
  createLumosButlerMcpServer,
  getLumosSessionSummary,
  LUMOS_BUTLER_MCP_SERVER_NAME,
  searchLumosHistory,
} from '../lumos-butler-mcp-server';
import {
  getAllMcpServers,
  getAllProviders,
  getAllSessions,
  getAllSkills,
  getDefaultProvider,
  getMessages,
  getTasksBySession,
  listBrowserProviderConfigs,
  listDeepSearchRuns,
} from '@/lib/db';
import { getDb } from '@/lib/db/connection';
import { listDrafts, listPackages, listPublishedCodeCapabilities, listPublishedPromptCapabilities } from '@/lib/db/capabilities';
import { listScheduledWorkflows } from '@/lib/db/scheduled-workflows';
import { getEnabledProviders, getDefaultProviderId, isProviderConfigured, listActiveAdapters, listPlugins } from '@/lib/im';
import type { ApiProvider, ChatSession, Message } from '@/types';

function mockFn<T extends (...args: never[]) => unknown>(fn: T) {
  return fn as jest.MockedFunction<T>;
}

function createProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: '["agent-chat"]',
    provider_origin: 'custom',
    auth_mode: 'api_key',
    base_url: 'https://api.example.com',
    api_key: 'SECRET_API_KEY',
    is_active: 0,
    sort_order: 0,
    extra_env: '{}',
    model_catalog: '[{"value":"model-a","label":"Model A"}]',
    model_catalog_source: 'manual',
    model_catalog_updated_at: '2026-01-01 00:00:00',
    notes: '',
    is_builtin: 0,
    user_modified: 1,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-02 00:00:00',
    ...overrides,
  };
}

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-1',
    title: 'Main Agent',
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-02 00:00:00',
    model: '',
    requested_model: '',
    resolved_model: '',
    system_prompt: '__LUMOS_MAIN_AGENT__',
    working_directory: '',
    sdk_session_id: '',
    project_name: '',
    status: 'active',
    mode: 'code',
    provider_name: '',
    provider_id: '',
    browser_context_id: 'embedded:default',
    sdk_cwd: '',
    runtime_status: '',
    runtime_updated_at: '',
    runtime_error: '',
    folder: '',
    ...overrides,
  };
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    session_id: 'session-1',
    role: 'user',
    content: 'hello',
    created_at: '2026-01-02 00:00:00',
    token_usage: null,
    elapsed_ms: null,
    ...overrides,
  };
}

function mockEmptyDb() {
  mockFn(getDb).mockReturnValue({
    prepare: jest.fn(() => ({
      get: jest.fn(() => undefined),
      all: jest.fn(() => []),
      run: jest.fn(),
    })),
  } as never);
}

describe('lumos-butler MCP server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFn(getAllProviders).mockReturnValue([createProvider()]);
    mockFn(getDefaultProvider).mockReturnValue(undefined);
    mockFn(getAllMcpServers).mockReturnValue([]);
    mockFn(getAllSkills).mockReturnValue([]);
    mockFn(getAllSessions).mockReturnValue([]);
    mockFn(getMessages).mockReturnValue({ messages: [], hasMore: false });
    mockFn(getTasksBySession).mockReturnValue([]);
    mockFn(listBrowserProviderConfigs).mockReturnValue([]);
    mockFn(listDeepSearchRuns).mockReturnValue([]);
    mockFn(listDrafts).mockReturnValue([]);
    mockFn(listPackages).mockReturnValue([]);
    mockFn(listPublishedCodeCapabilities).mockReturnValue([]);
    mockFn(listPublishedPromptCapabilities).mockReturnValue([]);
    mockFn(listScheduledWorkflows).mockReturnValue([]);
    mockFn(listPlugins).mockReturnValue([]);
    mockFn(getEnabledProviders).mockReturnValue([]);
    mockFn(getDefaultProviderId).mockReturnValue(null);
    mockFn(isProviderConfigured).mockReturnValue(false);
    mockFn(listActiveAdapters).mockReturnValue([]);
    mockEmptyDb();
  });

  test('registers the expected in-process MCP tools', () => {
    const server = createLumosButlerMcpServer() as unknown as {
      name: string;
      tools: Array<{ name: string }>;
    };

    expect(server.name).toBe(LUMOS_BUTLER_MCP_SERVER_NAME);
    expect(server.tools.map((toolDef) => toolDef.name).sort()).toEqual([
      'get_lumos_session_summary',
      'get_lumos_status',
      'search_lumos_history',
    ]);
  });

  test('summarizes global status without leaking provider secrets', () => {
    mockFn(getAllMcpServers).mockReturnValue([
      {
        id: 'mcp-1',
        name: 'broken-mcp',
        command: 'node',
        args: '[]',
        env: '{"TOKEN":"secret"}',
        type: 'stdio',
        run_mode: 'on_demand',
        runtime_kind: 'node',
        url: '',
        headers: '{}',
        is_enabled: 1,
        scope: 'user',
        source: 'manual',
        content_hash: '',
        description: '',
        health_status: 'failed',
        health_checked_at: '',
        health_error: 'bad token',
        health_message: '',
        health_tools: '[]',
        health_transport: 'stdio',
        created_at: '2026-01-01 00:00:00',
        updated_at: '2026-01-02 00:00:00',
      },
    ]);

    const status = buildLumosStatus() as unknown as {
      providers: { providers: Array<{ has_api_key: boolean; api_key?: string }> };
      diagnostics: Array<{ area: string; title: string }>;
    };
    const serialized = JSON.stringify(status);

    expect(status.providers.providers[0].has_api_key).toBe(true);
    expect(status.providers.providers[0].api_key).toBeUndefined();
    expect(serialized).not.toContain('SECRET_API_KEY');
    expect(serialized).not.toContain('TOKEN');
    expect(status.diagnostics.some((item) => item.area === 'providers')).toBe(true);
    expect(status.diagnostics.some((item) => item.area === 'mcp' && item.title.includes('自检失败'))).toBe(true);
  });

  test('searches message history and returns bounded snippets with routes', () => {
    mockFn(getDb).mockReturnValue({
      prepare: jest.fn((sql: string) => {
        if (sql.includes("sqlite_master")) {
          return {
            get: jest.fn((tableName: string) => (
              tableName === 'messages' || tableName === 'chat_sessions'
                ? { name: tableName }
                : undefined
            )),
          };
        }
        if (sql.includes('FROM messages m')) {
          return {
            all: jest.fn(() => [{
              id: 'message-1',
              session_id: 'session-1',
              role: 'assistant',
              content: JSON.stringify([{ type: 'text', text: '这里是能力生成器安装失败的排查记录' }]),
              created_at: '2026-01-02 00:00:00',
              session_title: '管家测试会话',
              system_prompt: '__LUMOS_MAIN_AGENT__',
            }]),
          };
        }
        return {
          get: jest.fn(() => undefined),
          all: jest.fn(() => []),
        };
      }),
    } as never);

    const result = searchLumosHistory({
      query: '能力生成器',
      scope: 'messages',
      limit: 5,
    }) as { total: number; results: Array<{ type: string; route: string; snippet: string }> };

    expect(result.total).toBe(1);
    expect(result.results[0].type).toBe('message');
    expect(result.results[0].route).toBe('/main-agent/session-1');
    expect(result.results[0].snippet).toContain('能力生成器安装失败');
  });

  test('returns session summary with recent messages and linked tasks', () => {
    mockFn(getAllSessions).mockReturnValue([createSession()]);
    mockFn(getMessages).mockReturnValue({
      hasMore: false,
      messages: [
        createMessage({
          id: 'message-1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: '帮我找上次的 PDF' }]),
        }),
      ],
    });
    mockFn(getTasksBySession).mockReturnValue([
      {
        id: 'task-1',
        session_id: 'session-1',
        title: '导出 PDF',
        status: 'completed',
        description: '整理报告并导出',
        task_kind: 'manual',
        team_plan_json: null,
        team_approval_status: null,
        current_run_id: 'run-1',
        final_result_summary: 'PDF 已生成',
        source_message_id: null,
        approved_at: null,
        rejected_at: null,
        last_action_at: null,
        created_at: '2026-01-01 00:00:00',
        updated_at: '2026-01-02 00:00:00',
      },
    ]);

    const summary = getLumosSessionSummary('session-1') as {
      found: boolean;
      recent_messages: Array<{ text: string }>;
      tasks: Array<{ title: string; summary: string }>;
    };

    expect(summary.found).toBe(true);
    expect(summary.recent_messages[0].text).toContain('上次的 PDF');
    expect(summary.tasks[0]).toEqual(expect.objectContaining({
      title: '导出 PDF',
      summary: 'PDF 已生成',
    }));
  });
});
