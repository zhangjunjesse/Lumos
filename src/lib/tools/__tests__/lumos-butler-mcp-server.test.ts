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
  getRunHistory: jest.fn(),
  getScheduledWorkflow: jest.fn(),
  listRunHistory: jest.fn(),
  listScheduledWorkflows: jest.fn(),
}));

jest.mock('@/lib/db/schedule-run-steps', () => ({
  listRunSteps: jest.fn(),
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

jest.mock('@/lib/workflow/subagent', () => ({
  listActiveWorkflowAgentExecutionSnapshots: jest.fn(),
}));

import {
  buildLumosStatus,
  createLumosButlerMcpServer,
  getWorkflowRun,
  listActiveWorkflowAgents,
  listWorkflowTasks,
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
import { getRunHistory, getScheduledWorkflow, listScheduledWorkflows } from '@/lib/db/scheduled-workflows';
import { listRunSteps } from '@/lib/db/schedule-run-steps';
import { getEnabledProviders, getDefaultProviderId, isProviderConfigured, listActiveAdapters, listPlugins } from '@/lib/im';
import { listActiveWorkflowAgentExecutionSnapshots } from '@/lib/workflow/subagent';
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
    kind: 'main-agent',
    system_prompt: '',
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
    mockFn(getRunHistory).mockReturnValue(null);
    mockFn(getScheduledWorkflow).mockReturnValue(null);
    mockFn(listRunSteps).mockReturnValue([]);
    mockFn(listScheduledWorkflows).mockReturnValue([]);
    mockFn(listPlugins).mockReturnValue([]);
    mockFn(getEnabledProviders).mockReturnValue([]);
    mockFn(getDefaultProviderId).mockReturnValue(null);
    mockFn(isProviderConfigured).mockReturnValue(false);
    mockFn(listActiveAdapters).mockReturnValue([]);
    mockFn(listActiveWorkflowAgentExecutionSnapshots).mockReturnValue([]);
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
      'get_workflow_run',
      'get_workflow_task',
      'list_active_workflow_agents',
      'list_workflow_runs',
      'list_workflow_tasks',
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
              kind: 'main-agent',
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

  test('lists workflow tasks with projection metadata and routes', () => {
    mockFn(listScheduledWorkflows).mockReturnValue([
      {
        id: 'schedule-1',
        name: '每日巡检',
        workflowDsl: { version: 'v3', name: '每日巡检', nodes: [], edges: [] },
        workflowId: null,
        runMode: 'scheduled',
        intervalMinutes: 1440,
        scheduleTime: '09:00',
        scheduleDayOfWeek: null,
        workingDirectory: '',
        browserContextId: 'embedded:default',
        enabled: true,
        notifyOnComplete: true,
        runParams: {},
        lastRunAt: null,
        nextRunAt: '2026-05-05T01:00:00.000Z',
        runCount: 0,
        lastRunStatus: '',
        lastError: '',
        createdAt: '2026-05-04T01:00:00.000Z',
        updatedAt: '2026-05-04T01:00:00.000Z',
      },
    ]);
    mockFn(getDb).mockReturnValue({
      prepare: jest.fn((sql: string) => {
        if (sql.includes("sqlite_master")) {
          return {
            get: jest.fn((tableName: string) => (
              ['task_management_tasks', 'workflow_executions'].includes(tableName)
                ? { name: tableName }
                : undefined
            )),
          };
        }
        if (sql.includes('FROM task_management_tasks') && sql.includes('ORDER BY created_at DESC')) {
          return {
            all: jest.fn(() => [{
              id: 'task-1',
              session_id: 'session-1',
              source_message_id: null,
              source_assistant_message_id: null,
              summary: '生成竞品分析报告',
              requirements: '["打开页面","汇总结果"]',
              status: 'running',
              progress: 30,
              created_at: '2026-05-04T01:00:00.000Z',
              started_at: '2026-05-04T01:01:00.000Z',
              completed_at: null,
              estimated_duration: 120,
              result: null,
              errors: null,
              metadata: JSON.stringify({
                scheduling: { strategy: 'workflow' },
                workflow: { workflowId: 'workflow-1' },
              }),
            }]),
          };
        }
        if (sql.includes('FROM workflow_executions') && sql.includes('WHERE workflow_id = ?')) {
          return {
            get: jest.fn(() => ({
              workflow_id: 'workflow-1',
              task_id: 'session-1',
              workflow_name: '竞品分析',
              workflow_version: '1',
              status: 'running',
              progress: 60,
              current_step: 'summarize',
              completed_steps_json: '["open"]',
              running_steps_json: '["summarize"]',
              skipped_steps_json: '[]',
              step_ids_json: '["open","summarize"]',
              result_json: null,
              error_json: null,
              started_at: '2026-05-04T01:01:00.000Z',
              completed_at: null,
              updated_at: '2026-05-04T01:02:00.000Z',
            })),
          };
        }
        if (sql.includes('FROM schedule_run_history')) {
          return { all: jest.fn(() => []) };
        }
        return {
          get: jest.fn(() => undefined),
          all: jest.fn(() => []),
        };
      }),
    } as never);

    const result = listWorkflowTasks({ limit: 5 }) as {
      total: number;
      tasks: Array<{ id: string; progress: number; current_step: string; route: string }>;
      scheduled_workflows_total: number;
      scheduled_workflows: Array<{ id: string; route: string }>;
    };

    expect(result.total).toBe(1);
    expect(result.tasks[0]).toEqual(expect.objectContaining({
      id: 'task-1',
      progress: 60,
      current_step: 'summarize',
      route: '/workflow?taskId=task-1',
    }));
    expect(result.scheduled_workflows_total).toBe(1);
    expect(result.scheduled_workflows[0]).toEqual(expect.objectContaining({
      id: 'schedule-1',
      route: '/workflow/schedules/schedule-1',
    }));
  });

  test('returns workflow run detail with step summaries', () => {
    mockFn(getRunHistory).mockReturnValue({
      id: 'run-1',
      scheduleId: 'task-1',
      sessionId: 'session-1',
      browserContextId: 'embedded:default',
      status: 'error',
      error: '截图失败',
      startedAt: '2026-05-04T01:00:00.000Z',
      completedAt: '2026-05-04T01:02:00.000Z',
      workflowDslSnapshot: null,
    });
    mockFn(getScheduledWorkflow).mockReturnValue({
      id: 'task-1',
      name: '截图任务',
      workflowDsl: { version: 'v3', name: '截图任务', nodes: [], edges: [] },
      workflowId: null,
      runMode: 'once',
      intervalMinutes: 0,
      scheduleTime: null,
      scheduleDayOfWeek: null,
      workingDirectory: '',
      browserContextId: 'embedded:default',
      enabled: false,
      notifyOnComplete: true,
      runParams: {},
      lastRunAt: null,
      nextRunAt: null,
      runCount: 1,
      lastRunStatus: 'error',
      lastError: '截图失败',
      createdAt: '2026-05-04T01:00:00.000Z',
      updatedAt: '2026-05-04T01:02:00.000Z',
    });
    mockFn(listRunSteps).mockReturnValue([
      {
        id: 'step-row-1',
        runId: 'run-1',
        stepId: 'screenshot',
        presetName: '',
        status: 'error',
        error: '截图失败',
        outputSummary: '',
        durationMs: 500,
        startedAt: '2026-05-04T01:01:00.000Z',
        completedAt: '2026-05-04T01:02:00.000Z',
      },
    ]);

    const result = getWorkflowRun('run-1') as {
      found: boolean;
      run: { id: string; status: string; route: string };
      steps: Array<{ step_id: string; status: string; error: string }>;
    };

    expect(result.found).toBe(true);
    expect(result.run.route).toBe('/workflow/schedules/task-1/runs/run-1');
    expect(result.steps[0]).toEqual(expect.objectContaining({
      step_id: 'screenshot',
      status: 'error',
      error: '截图失败',
    }));
  });

  test('lists active workflow agents from runtime snapshots', () => {
    mockFn(getRunHistory).mockReturnValue(null);
    mockFn(getDb).mockReturnValue({
      prepare: jest.fn((sql: string) => {
        if (sql.includes("sqlite_master")) {
          return {
            get: jest.fn((tableName: string) => (
              tableName === 'schedule_run_history'
                ? { name: tableName }
                : undefined
            )),
          };
        }
        if (sql.includes('FROM schedule_run_history') && sql.includes('WHERE session_id = ?')) {
          return {
            get: jest.fn(() => ({
              id: 'run-history-1',
              schedule_id: 'schedule-1',
            })),
          };
        }
        return {
          get: jest.fn(() => undefined),
          all: jest.fn(() => []),
        };
      }),
    } as never);
    mockFn(listActiveWorkflowAgentExecutionSnapshots).mockReturnValue([
      {
        workflowRunId: 'workflow-1',
        stepId: 'summarize',
        startedAt: '2026-05-04T01:01:00.000Z',
        lifecycleState: 'running',
        cancelRequested: false,
        role: 'researcher',
        roleName: '研究代理',
        agentType: 'workflow.agent',
        executionMode: 'claude-sdk',
        requestedModel: 'deepseek-v4-pro',
        resolvedModel: 'deepseek-v4-pro',
        allowedTools: ['workspace.read'],
        capabilityTags: ['research'],
        memoryPolicy: 'ephemeral',
        concurrencyLimit: 1,
        sessionId: 'session-1',
        runId: 'run-1',
        stageId: 'summarize',
      },
    ]);

    const result = listActiveWorkflowAgents('workflow-1') as {
      total: number;
      agents: Array<{
        workflow_run_id: string;
        step_id: string;
        resolved_model: string;
        schedule_id: string;
        schedule_run_id: string;
        route: string;
        route_kind: string;
      }>;
    };

    expect(result.total).toBe(1);
    expect(result.agents[0]).toEqual(expect.objectContaining({
      workflow_run_id: 'workflow-1',
      step_id: 'summarize',
      resolved_model: 'deepseek-v4-pro',
      schedule_id: 'schedule-1',
      schedule_run_id: 'run-history-1',
      route: '/workflow/schedules/schedule-1/runs/run-history-1',
      route_kind: 'schedule_run',
    }));
  });
});
