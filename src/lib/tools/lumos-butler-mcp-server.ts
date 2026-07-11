import fs from 'fs';
import path from 'path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
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
import {
  getRunHistory,
  getScheduledWorkflow,
  listScheduledWorkflows,
} from '@/lib/db/scheduled-workflows';
import { listRunSteps } from '@/lib/db/schedule-run-steps';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { getExternalRuntimeResourceRoot, getRuntimeResourceRoots, resolveRuntimeResourcePath } from '@/lib/runtime-resources';
import { listPlugins, getEnabledProviders as getEnabledImProviders, getDefaultProviderId as getDefaultImProviderId, isProviderConfigured as isImProviderConfigured, listActiveAdapters } from '@/lib/im';
import { providerSupportsCapability } from '@/lib/provider-config';
import {
  listActiveWorkflowAgentExecutionSnapshots,
  type WorkflowAgentExecutionSnapshot,
} from '@/lib/workflow/subagent';
import type { ApiProvider, ChatSession, Message, ProviderCapability } from '@/types';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface ButlerDiagnostic {
  severity: 'info' | 'warning' | 'error';
  area: string;
  title: string;
  message: string;
  route?: string;
}

type SearchScope = 'all' | 'sessions' | 'messages' | 'tasks' | 'workflows' | 'deepsearch' | 'capabilities';

interface ButlerDeepSearchSite {
  siteKey: string;
  displayName: string;
  liveState: { loginState: string } | null;
}

interface WorkflowProjectionSummary {
  workflow_id: string;
  task_id: string;
  workflow_name: string;
  workflow_version: string;
  status: string;
  progress: number;
  current_step: string | null;
  completed_steps: string[];
  running_steps: string[];
  skipped_steps: string[];
  step_ids: string[];
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  result_summary: string | null;
  error_summary: string | null;
}

const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;
const SESSION_SUMMARY_MESSAGE_LIMIT = 12;
const DEFAULT_WORKFLOW_LIMIT = 20;
const MAX_WORKFLOW_LIMIT = 50;
const WORKFLOW_RUN_STATUSES = ['pending', 'running', 'success', 'error', 'completed', 'failed', 'cancelled'] as const;

export const LUMOS_BUTLER_MCP_SERVER_NAME = 'lumos-butler';

export const LUMOS_BUTLER_MCP_SYSTEM_HINT = `
## Lumos 管家只读能力

当前会话是 Lumos 主 Agent，会额外获得只读的 Lumos 管家工具。可用工具:
- \`mcp__lumos-butler__get_lumos_status()\`: 查看 Lumos 全局状态、配置概览、最近任务、明显问题和建议入口。
- \`mcp__lumos-butler__search_lumos_history(query, scope?, limit?)\`: 搜索 Lumos 历史会话、消息、任务、Workflow、DeepSearch 和已发布能力。
- \`mcp__lumos-butler__get_lumos_session_summary(session_id, message_limit?)\`: 查看任意 Lumos 会话的标题、最近消息和关联任务。
- \`mcp__lumos-butler__list_workflow_runs(status?, task_id?, schedule_id?, limit?)\`: 查看最近 Workflow 执行记录和运行态投影。
- \`mcp__lumos-butler__get_workflow_run(run_id)\`: 查看单次 Workflow 执行详情、步骤状态和失败原因。
- \`mcp__lumos-butler__list_active_workflow_agents(workflow_run_id?)\`: 查看当前进程里正在运行的 Workflow Agent 会话。

使用规则:
- 用户问“哪里坏了 / 帮我看看配置 / 上次那个文件或任务在哪 / 某个能力是否安装 / 最近跑了什么”时，先调用这些工具，不要凭记忆猜测状态。
- 用户问“哪个任务在跑 / 刚才任务为什么失败 / 哪个 Agent 卡住了”时，优先调用 Workflow 执行记录和活跃 Agent 工具，不要回答“没有查询接口”。
- 这是第一阶段只读管家能力。不要声称已经执行删除、覆盖、付款、发 IM、导出敏感数据、批量操作或回滚；这类动作当前不可用，需要后续有明确确认和专门工具。
- 面向小白用户回复时，用页面、按钮、状态和下一步动作解释，不要只抛内部表名或实现术语。
`;

export function createLumosButlerMcpServer(options: { sessionId?: string; userId?: string } = {}) {
  return createSdkMcpServer({
    name: LUMOS_BUTLER_MCP_SERVER_NAME,
    tools: [
      createGetLumosStatusTool(options),
      createSearchLumosHistoryTool(),
      createGetLumosSessionSummaryTool(),
      createListWorkflowRunsTool(),
      createGetWorkflowRunTool(),
      createListActiveWorkflowAgentsTool(),
    ],
  });
}

export function createGetLumosStatusTool(options: { sessionId?: string; userId?: string } = {}) {
  return tool(
    'get_lumos_status',
    'Read-only Lumos global status summary for the Main Agent butler. Secrets are redacted.',
    {
      include_recent: z.boolean().optional().describe('Whether to include recent sessions/runs. Defaults to true.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const status = buildLumosStatus({
          currentSessionId: options.sessionId,
          includeRecent: args.include_recent !== false,
        });
        return jsonResult(status);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function createSearchLumosHistoryTool() {
  return tool(
    'search_lumos_history',
    'Search Lumos history and feature records. Returns bounded snippets and UI routes.',
    {
      query: z.string().min(1).describe('Search query.'),
      scope: z.enum(['all', 'sessions', 'messages', 'tasks', 'workflows', 'deepsearch', 'capabilities']).optional()
        .describe('Optional search scope. Defaults to all.'),
      limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional()
        .describe(`Max results per broad search. Defaults to ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}.`),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = searchLumosHistory({
          query: args.query,
          scope: args.scope ?? 'all',
          limit: args.limit,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function createGetLumosSessionSummaryTool() {
  return tool(
    'get_lumos_session_summary',
    'Read a bounded summary of any Lumos chat session, including recent messages and linked tasks.',
    {
      session_id: z.string().min(1).describe('Lumos chat session id.'),
      message_limit: z.number().int().min(1).max(30).optional()
        .describe(`Recent message count. Defaults to ${SESSION_SUMMARY_MESSAGE_LIMIT}.`),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const summary = getLumosSessionSummary(args.session_id, args.message_limit);
        return jsonResult(summary);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function createListWorkflowRunsTool() {
  return tool(
    'list_workflow_runs',
    'List workflow run history with linked task and schedule context.',
    {
      status: z.enum(WORKFLOW_RUN_STATUSES).optional()
        .describe('Optional run status filter.'),
      task_id: z.string().min(1).optional()
        .describe('Optional task id filter.'),
      schedule_id: z.string().min(1).optional()
        .describe('Optional schedule id filter.'),
      limit: z.number().int().min(1).max(MAX_WORKFLOW_LIMIT).optional()
        .describe(`Result limit. Defaults to ${DEFAULT_WORKFLOW_LIMIT}, max ${MAX_WORKFLOW_LIMIT}.`),
    },
    async (args): Promise<CallToolResult> => {
      try {
        return jsonResult(listWorkflowRuns({
          status: args.status,
          taskId: args.task_id?.trim() || undefined,
          scheduleId: args.schedule_id?.trim() || undefined,
          limit: args.limit,
        }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function createGetWorkflowRunTool() {
  return tool(
    'get_workflow_run',
    'Get a workflow run detail with steps, schedule metadata, projection status, and route links.',
    {
      run_id: z.string().min(1).describe('Workflow run id.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        return jsonResult(getWorkflowRun(args.run_id));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function createListActiveWorkflowAgentsTool() {
  return tool(
    'list_active_workflow_agents',
    'List active workflow agent executions currently held in process memory.',
    {
      workflow_run_id: z.string().min(1).optional()
        .describe('Optional workflow run id filter.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        return jsonResult(listActiveWorkflowAgents(args.workflow_run_id?.trim() || undefined));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function buildLumosStatus(options: {
  currentSessionId?: string;
  includeRecent?: boolean;
} = {}) {
  const diagnostics: ButlerDiagnostic[] = [];
  const readErrors: Array<{ area: string; error: string }> = [];
  const includeRecent = options.includeRecent !== false;

  const capture = <T>(area: string, fallback: T, fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      readErrors.push({ area, error: errorMessage(error) });
      return fallback;
    }
  };

  const providers = capture('providers', [] as ApiProvider[], () => getAllProviders());
  const defaultProvider = capture('defaultProvider', undefined as ApiProvider | undefined, () => getDefaultProvider());
  const providerStatus = summarizeProviders(providers, defaultProvider, diagnostics);

  const mcpServers = capture('mcpServers', [] as ReturnType<typeof getAllMcpServers>, () => getAllMcpServers());
  const skillRecords = capture('skills', [] as ReturnType<typeof getAllSkills>, () => getAllSkills());
  const capabilityPackages = capture('capabilityPackages', [] as ReturnType<typeof listPackages>, () => listPackages());
  const capabilityDrafts = capture('capabilityDrafts', [] as ReturnType<typeof listDrafts>, () => listDrafts());
  const promptCapabilities = capture('promptCapabilities', [] as ReturnType<typeof listPublishedPromptCapabilities>, () => listPublishedPromptCapabilities());
  const codeCapabilities = capture('codeCapabilities', [] as ReturnType<typeof listPublishedCodeCapabilities>, () => listPublishedCodeCapabilities());

  const sessions = capture('sessions', [] as ChatSession[], () => getAllSessions());
  const schedules = capture('workflowSchedules', [] as ReturnType<typeof listScheduledWorkflows>, () => listScheduledWorkflows());
  const deepSearchSites = capture('deepSearchSites', [] as ButlerDeepSearchSite[], () => readDeepSearchSitesSnapshot());
  const deepSearchRuns = capture('deepSearchRuns', [] as ReturnType<typeof listDeepSearchRuns>, () => listDeepSearchRuns(20));
  const browserContexts = capture('browserContexts', [] as ReturnType<typeof listBrowserProviderConfigs>, () => listBrowserProviderConfigs());
  const imPlugins = capture('imPlugins', [] as ReturnType<typeof listPlugins>, () => listPlugins());
  const enabledImProviders = capture('enabledImProviders', [] as ReturnType<typeof getEnabledImProviders>, () => getEnabledImProviders());
  const activeImAdapters = capture('activeImAdapters', [] as ReturnType<typeof listActiveAdapters>, () => listActiveAdapters());

  const workflowRunStats = capture('workflowRunStats', emptyWorkflowRunStats(), () => readWorkflowRunStats());
  const workflowProjectionStats = capture('workflowProjectionStats', emptyProjectionStats(), () => readWorkflowProjectionStats());
  const knowledgeStats = capture('knowledgeStats', emptyKnowledgeStats(), () => readKnowledgeStats());
  const runtimeResources = capture('runtimeResources', null as ReturnType<typeof summarizeRuntimeResources> | null, () => summarizeRuntimeResources());

  appendExtensionDiagnostics(mcpServers, diagnostics);
  appendCapabilityDiagnostics(capabilityPackages, capabilityDrafts, diagnostics);
  appendWorkflowDiagnostics(workflowRunStats, workflowProjectionStats, diagnostics);
  appendKnowledgeDiagnostics(knowledgeStats, diagnostics);
  appendDeepSearchDiagnostics(deepSearchSites, deepSearchRuns, diagnostics);
  appendBrowserDiagnostics(browserContexts, diagnostics);
  appendRuntimeDiagnostics(runtimeResources, diagnostics);

  for (const readError of readErrors) {
    diagnostics.push({
      severity: 'warning',
      area: readError.area,
      title: '部分状态读取失败',
      message: readError.error,
    });
  }

  return {
    schema: 'lumos-butler-status/v1',
    generated_at: new Date().toISOString(),
    phase: 'read_only_butler_phase_1',
    current_main_agent_session_id: options.currentSessionId || null,
    providers: providerStatus,
    extensions: {
      mcp: summarizeMcpServers(mcpServers),
      skills: summarizeSkills(skillRecords),
      capabilities: {
        packages_total: capabilityPackages.length,
        drafts_total: capabilityDrafts.length,
        published_prompt_nodes: promptCapabilities.length,
        published_code_nodes: codeCapabilities.length,
        ready_to_publish: capabilityPackages.filter((item) => item.status === 'ready_to_publish').length,
        failed_or_disabled: capabilityPackages.filter((item) => (
          item.status === 'validation_failed' || item.status === 'test_failed' || item.status === 'disabled'
        )).length,
        recent: includeRecent
          ? capabilityPackages.slice(0, 8).map((item) => ({
              id: item.id,
              name: item.name,
              kind: item.kind ?? 'code',
              status: item.status,
              updated_at: item.updatedAt,
            }))
          : [],
      },
    },
    workflow: {
      schedules_total: schedules.length,
      schedules_enabled: schedules.filter((item) => item.enabled).length,
      one_time_tasks: schedules.filter((item) => item.runMode === 'once').length,
      running_runs: workflowRunStats.running,
      recent_failures: workflowRunStats.recentFailures,
      last_run_at: workflowRunStats.lastRunAt,
      projection_running: workflowProjectionStats.running,
      projection_failed: workflowProjectionStats.failed,
      recent_runs: includeRecent ? workflowRunStats.recentRuns : [],
    },
    sessions: {
      total: sessions.length,
      main_agent_sessions: sessions.filter(isMainAgentSession).length,
      active_runtime_sessions: sessions.filter((session) => Boolean(normalizeText(session.runtime_status))).length,
      latest_session_at: sessions[0]?.updated_at ?? null,
      recent: includeRecent ? sessions.slice(0, 10).map(summarizeSessionRow) : [],
    },
    knowledge: knowledgeStats,
    deepsearch: summarizeDeepSearch(deepSearchSites, deepSearchRuns, includeRecent),
    im: {
      registered_providers: imPlugins.map((plugin) => plugin.manifest.id),
      enabled_providers: enabledImProviders,
      configured_providers: imPlugins
        .filter((plugin) => isImProviderConfigured(plugin.manifest.id))
        .map((plugin) => plugin.manifest.id),
      default_provider_id: getDefaultImProviderId(),
      active_adapters: activeImAdapters.map((adapter) => adapter.id),
    },
    browser: {
      contexts_total: browserContexts.length,
      enabled_contexts: browserContexts.filter((item) => item.enabled).length,
      failed_or_untested: browserContexts.filter((item) => item.last_test_status !== 'success').length,
      contexts: browserContexts.slice(0, 20).map((item) => ({
        context_id: item.context_id,
        display_name: item.display_name,
        provider_type: item.provider_type,
        enabled: Boolean(item.enabled),
        last_test_status: item.last_test_status,
        last_test_message: truncateText(item.last_test_message, 180),
        chat_session_count: item.usage?.chat_session_count ?? 0,
        schedule_count: item.usage?.schedule_count ?? 0,
        aliases: item.aliases ?? [],
      })),
    },
    runtime_resources: runtimeResources,
    diagnostics,
    available_butler_tools: [
      'get_lumos_status',
      'search_lumos_history',
      'get_lumos_session_summary',
      'list_workflow_runs',
      'get_workflow_run',
      'list_active_workflow_agents',
    ],
  };
}

export function searchLumosHistory(input: {
  query: string;
  scope?: SearchScope;
  limit?: number;
}) {
  const query = input.query.trim();
  if (!query) {
    return {
      schema: 'lumos-butler-history-search/v1',
      query,
      scope: input.scope ?? 'all',
      total: 0,
      results: [],
    };
  }

  const scope = input.scope ?? 'all';
  const limit = clampLimit(input.limit);
  const like = `%${query}%`;
  const results: Array<Record<string, unknown>> = [];

  if (scope === 'all' || scope === 'sessions') {
    results.push(...searchSessions(like, limit));
  }
  if (scope === 'all' || scope === 'messages') {
    results.push(...searchMessages(like, limit));
  }
  if (scope === 'all' || scope === 'tasks') {
    results.push(...searchTasks(like, limit));
  }
  if (scope === 'all' || scope === 'workflows') {
    results.push(...searchWorkflows(like, limit));
  }
  if (scope === 'all' || scope === 'deepsearch') {
    results.push(...searchDeepSearchRuns(like, limit));
  }
  if (scope === 'all' || scope === 'capabilities') {
    results.push(...searchCapabilities(like, limit));
  }

  return {
    schema: 'lumos-butler-history-search/v1',
    query,
    scope,
    limit,
    total: results.length,
    results: results.slice(0, scope === 'all' ? limit * 3 : limit),
  };
}

export function getLumosSessionSummary(sessionId: string, messageLimit?: number) {
  const session = getAllSessions().find((item) => item.id === sessionId) ?? null;
  if (!session) {
    return {
      schema: 'lumos-butler-session-summary/v1',
      session_id: sessionId,
      found: false,
      error: 'Session not found',
    };
  }

  const limit = Math.max(1, Math.min(messageLimit ?? SESSION_SUMMARY_MESSAGE_LIMIT, 30));
  const { messages, hasMore } = getMessages(sessionId, { limit });
  const tasks = getTasksBySession(sessionId);

  return {
    schema: 'lumos-butler-session-summary/v1',
    session_id: sessionId,
    found: true,
    session: summarizeSessionRow(session),
    has_more_messages: hasMore,
    tasks: tasks.slice(0, 20).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      updated_at: task.updated_at,
      summary: truncateText(task.description || '', 400),
    })),
    recent_messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      created_at: message.created_at,
      text: truncateText(extractMessageText(message), 1200),
    })),
  };
}

export function listWorkflowRuns(input: {
  status?: string;
  taskId?: string;
  scheduleId?: string;
  limit?: number;
}) {
  const limit = clampWorkflowLimit(input.limit);
  const status = normalizeWorkflowRunStatus(input.status);
  const taskId = normalizeText(input.taskId);
  const scheduleId = normalizeText(input.scheduleId);

  const runs = gatherWorkflowRunSummaries().filter((run) => {
    if (status && run.status !== status) return false;
    if (taskId && run.task_id !== taskId) return false;
    if (scheduleId && run.schedule_id !== scheduleId) return false;
    return true;
  });

  return {
    schema: 'lumos-butler-workflow-run-list/v1',
    total: runs.length,
    limit,
    filters: {
      status: status ?? null,
      task_id: taskId || null,
      schedule_id: scheduleId || null,
    },
    runs: runs.slice(0, limit),
  };
}

export function getWorkflowRun(runId: string) {
  const run = getRunHistory(runId);
  if (!run) {
    return {
      schema: 'lumos-butler-workflow-run/v1',
      found: false,
      run_id: runId,
      error: 'Run not found',
    };
  }

  const schedule = getScheduledWorkflow(run.scheduleId);
  const steps = listRunSteps(run.id);
  const projection = buildRunProjectionSummary(run.id);

  return {
    schema: 'lumos-butler-workflow-run/v1',
    found: true,
    run: {
      id: run.id,
      schedule_id: run.scheduleId,
      schedule_name: schedule?.name ?? null,
      task_id: null,
      task_title: null,
      status: run.status,
      error: run.error || null,
      started_at: run.startedAt,
      completed_at: run.completedAt,
      browser_context_id: run.browserContextId,
      workflow_dsl_snapshot: run.workflowDslSnapshot ?? null,
      route: `/workflow/schedules/${encodeURIComponent(run.scheduleId)}/runs/${encodeURIComponent(run.id)}`,
    },
    projection,
    steps: steps.map((step) => ({
      id: step.id,
      step_id: step.stepId,
      preset_name: step.presetName,
      status: step.status,
      error: step.error || null,
      output_summary: step.outputSummary || null,
      duration_ms: step.durationMs,
      started_at: step.startedAt,
      completed_at: step.completedAt,
    })),
  };
}

export function listActiveWorkflowAgents(workflowRunId?: string) {
  const sessions = listActiveWorkflowAgentExecutionSnapshots();
  const filtered = workflowRunId?.trim()
    ? sessions.filter((session) => session.workflowRunId === workflowRunId.trim())
    : sessions;

  return {
    schema: 'lumos-butler-workflow-agent-list/v1',
    total: filtered.length,
    workflow_run_id: workflowRunId?.trim() || null,
    agents: filtered.map((session) => summarizeActiveWorkflowAgent(session)),
  };
}

function summarizeProviders(providers: ApiProvider[], defaultProvider: ApiProvider | undefined, diagnostics: ButlerDiagnostic[]) {
  const supports = (capability: ProviderCapability) => (
    providers.filter((provider) => providerSupportsCapability(provider, capability)).length
  );

  if (!defaultProvider) {
    diagnostics.push({
      severity: 'error',
      area: 'providers',
      title: '默认聊天服务商未配置',
      message: '主 Agent 可能无法正常调用模型。请到设置里的服务商页面选择默认服务商。',
      route: '/settings#providers',
    });
  } else if (!providerSupportsCapability(defaultProvider, 'agent-chat')) {
    diagnostics.push({
      severity: 'error',
      area: 'providers',
      title: '默认服务商不支持主聊天',
      message: `当前默认服务商“${defaultProvider.name}”不支持主聊天/Agent 能力。`,
      route: '/settings#providers',
    });
  }

  return {
    total: providers.length,
    default_provider_id: defaultProvider?.id ?? null,
    default_provider_name: defaultProvider?.name ?? null,
    agent_chat_ready_count: supports('agent-chat'),
    text_gen_ready_count: supports('text-gen'),
    image_gen_ready_count: supports('image-gen'),
    embedding_ready_count: supports('embedding'),
    providers: providers.slice(0, 20).map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.provider_type,
      api_protocol: provider.api_protocol,
      capabilities: safeJsonArray(provider.capabilities),
      auth_mode: provider.auth_mode,
      has_api_key: Boolean(provider.api_key),
      base_url: truncateText(provider.base_url, 160),
      model_catalog_source: provider.model_catalog_source,
      model_count: safeJsonArray(provider.model_catalog).length,
      updated_at: provider.updated_at,
    })),
  };
}

function summarizeMcpServers(servers: ReturnType<typeof getAllMcpServers>) {
  const enabled = servers.filter((server) => server.is_enabled);
  return {
    total: servers.length,
    enabled: enabled.length,
    healthy: enabled.filter((server) => server.health_status === 'ok').length,
    failed: enabled.filter((server) => server.health_status === 'failed').length,
    unknown: enabled.filter((server) => !server.health_status || server.health_status === 'unknown').length,
    keep_alive_declared: enabled.filter((server) => server.run_mode === 'keep_alive').length,
    runtimes: countBy(servers, (server) => server.runtime_kind || 'auto'),
    servers: servers.slice(0, 30).map((server) => ({
      id: server.id,
      name: server.name,
      scope: server.scope,
      enabled: Boolean(server.is_enabled),
      type: server.type || 'stdio',
      run_mode: server.run_mode || 'on_demand',
      runtime: server.runtime_kind || 'auto',
      health_status: server.health_status || 'unknown',
      health_message: truncateText(server.health_message || server.health_error || '', 220),
      health_tools_count: safeJsonArray(server.health_tools).length,
      updated_at: server.updated_at,
    })),
  };
}

function summarizeSkills(skills: ReturnType<typeof getAllSkills>) {
  return {
    total: skills.length,
    enabled: skills.filter((skill) => skill.is_enabled).length,
    builtin: skills.filter((skill) => skill.scope === 'builtin').length,
    user: skills.filter((skill) => skill.scope === 'user').length,
    recent: skills.slice(0, 20).map((skill) => ({
      id: skill.id,
      name: skill.name,
      scope: skill.scope,
      enabled: Boolean(skill.is_enabled),
      description: truncateText(skill.description, 180),
      updated_at: skill.updated_at,
    })),
  };
}

function summarizeDeepSearch(
  sites: ButlerDeepSearchSite[],
  runs: ReturnType<typeof listDeepSearchRuns>,
  includeRecent: boolean,
) {
  return {
    sites_total: sites.length,
    login_ready_sites: sites.filter((site) => site.liveState?.loginState === 'connected').length,
    waiting_login_sites: sites.filter((site) => (
      site.liveState?.loginState === 'missing'
      || site.liveState?.loginState === 'expired'
      || site.liveState?.loginState === 'suspected_expired'
    )).length,
    recent_runs_total: runs.length,
    running_runs: runs.filter((run) => run.status === 'running' || run.status === 'pending').length,
    waiting_login_runs: runs.filter((run) => run.status === 'waiting_login').length,
    failed_runs: runs.filter((run) => run.status === 'failed').length,
    recent_runs: includeRecent
      ? runs.slice(0, 10).map((run) => ({
          id: run.id,
          query: truncateText(run.queryText, 180),
          status: run.status,
          status_message: truncateText(run.statusMessage, 220),
          updated_at: run.updatedAt,
          route: `/extensions?tab=deepsearch&runId=${encodeURIComponent(run.id)}`,
        }))
      : [],
  };
}

function summarizeRuntimeResources() {
  const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodePath = resolveRuntimeResourcePath(path.join('node-runtime', process.platform, process.arch, nodeExe));
  const pythonRoot = resolveRuntimeResourcePath(path.join('python-runtime', process.platform, process.arch, 'python'));
  const gitBashPath = resolveRuntimeResourcePath(path.join('git-bash', process.platform, process.arch, 'bin', 'bash.exe'))
    || resolveRuntimeResourcePath(path.join('git-bash', process.platform, process.arch, 'usr', 'bin', 'bash.exe'))
    || resolveRuntimeResourcePath(path.join('git-bash', process.platform, process.arch, 'bash.exe'));
  const embeddingModelConfig = resolveRuntimeResourcePath(path.join(
    'runtime',
    'embedding-models',
    'Xenova',
    'bge-small-zh-v1.5',
    'config.json',
  ));

  const roots = getRuntimeResourceRoots();
  const existingRoots = roots.filter((root) => safeExists(root));
  const manifest = findFirstExisting([
    path.join(getExternalRuntimeResourceRoot(), 'manifest.json'),
    ...roots.map((root) => path.join(root, 'manifest.json')),
    path.join(process.cwd(), 'release', 'runtime-resources', 'manifest.json'),
  ]);

  return {
    external_root: getExternalRuntimeResourceRoot(),
    roots: roots.map((root) => ({ path: root, exists: safeExists(root) })),
    existing_roots: existingRoots.length,
    node_runtime_found: Boolean(nodePath),
    python_runtime_found: Boolean(pythonRoot),
    git_bash_found: Boolean(gitBashPath),
    embedding_model_found: Boolean(embeddingModelConfig),
    manifest_found: Boolean(manifest),
    manifest_path: manifest ?? null,
  };
}

function readWorkflowRunStats() {
  if (!tableExists('schedule_run_history')) return emptyWorkflowRunStats();
  const db = getDb();
  const statusRows = db.prepare(
    'SELECT status, COUNT(*) as count FROM schedule_run_history GROUP BY status',
  ).all() as Array<{ status?: string; count?: number }>;
  const byStatus = Object.fromEntries(statusRows.map((row) => [row.status || 'unknown', Number(row.count || 0)]));
  const recentFailureRow = db.prepare(
    "SELECT COUNT(*) as count FROM schedule_run_history WHERE status = 'error' AND started_at >= ?",
  ).get(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) as { count?: number } | undefined;
  const lastRow = db.prepare(
    'SELECT MAX(started_at) as lastRunAt FROM schedule_run_history',
  ).get() as { lastRunAt?: string | null } | undefined;
  const recentRows = db.prepare(`
    SELECT r.id, r.schedule_id, r.session_id, r.status, r.error, r.started_at, r.completed_at,
           s.name as schedule_name
    FROM schedule_run_history r
    LEFT JOIN scheduled_workflows s ON s.id = r.schedule_id
    ORDER BY r.started_at DESC
    LIMIT 8
  `).all() as Array<Record<string, unknown>>;

  return {
    byStatus,
    running: Number(byStatus.running || 0),
    recentFailures: Number(recentFailureRow?.count || 0),
    lastRunAt: lastRow?.lastRunAt ?? null,
    recentRuns: recentRows.map((row) => ({
      id: String(row.id),
      schedule_id: String(row.schedule_id),
      schedule_name: String(row.schedule_name ?? ''),
      session_id: row.session_id ? String(row.session_id) : null,
      status: String(row.status),
      error: truncateText(String(row.error ?? ''), 240),
      started_at: String(row.started_at ?? ''),
      completed_at: row.completed_at ? String(row.completed_at) : null,
      route: `/workflow/schedules/${encodeURIComponent(String(row.schedule_id))}/runs/${encodeURIComponent(String(row.id))}`,
    })),
  };
}

function readWorkflowProjectionStats() {
  if (!tableExists('workflow_executions')) return emptyProjectionStats();
  const rows = getDb().prepare(
    'SELECT status, COUNT(*) as count FROM workflow_executions GROUP BY status',
  ).all() as Array<{ status?: string; count?: number }>;
  const byStatus = Object.fromEntries(rows.map((row) => [row.status || 'unknown', Number(row.count || 0)]));
  return {
    byStatus,
    running: Number(byStatus.pending || 0) + Number(byStatus.running || 0),
    failed: Number(byStatus.failed || 0),
  };
}

function gatherWorkflowRunSummaries(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  if (tableExists('schedule_run_history')) {
    rows.push(...(getDb().prepare(`
      SELECT r.id, r.schedule_id, r.session_id, r.browser_context_id, r.status, r.error,
             r.started_at, r.completed_at, s.name as schedule_name
      FROM schedule_run_history r
      LEFT JOIN scheduled_workflows s ON s.id = r.schedule_id
      ORDER BY r.started_at DESC
      LIMIT 200
    `).all() as Array<Record<string, unknown>>).map((row) => summarizeRunHistoryRow(row)));
  }

  if (tableExists('workflow_executions')) {
    const existingIds = new Set(rows.map((row) => String(row.workflow_id ?? '')));
    const projections = getDb().prepare(`
      SELECT *
      FROM workflow_executions
      ORDER BY updated_at DESC
      LIMIT 200
    `).all() as Array<Record<string, unknown>>;
    for (const projectionRow of projections) {
      const projection = parseWorkflowProjectionRow(projectionRow);
      if (!projection || existingIds.has(projection.workflow_id)) continue;
      rows.push({
        type: 'workflow_projection',
        id: projection.workflow_id,
        workflow_id: projection.workflow_id,
        task_id: projection.task_id,
        task_title: null,
        schedule_id: null,
        schedule_name: projection.workflow_name,
        session_id: projection.task_id,
        status: projection.status,
        error: projection.error_summary,
        started_at: projection.started_at,
        completed_at: projection.completed_at,
        updated_at: projection.updated_at,
        progress: projection.progress,
        current_step: projection.current_step,
        route: '/workflow',
      });
    }
  }

  return rows.sort(compareRunLikeRows);
}

function summarizeRunHistoryRow(row: Record<string, unknown>): Record<string, unknown> {
  const runId = String(row.id ?? '');
  const scheduleId = String(row.schedule_id ?? '');
  const sessionId = row.session_id ? String(row.session_id) : null;
  const projection = getWorkflowProjectionByTaskId(sessionId || '') || getWorkflowProjectionByRunId(runId);
  return {
    type: 'schedule_run',
    id: runId,
    run_id: runId,
    workflow_id: projection?.workflow_id ?? null,
    task_id: null,
    task_title: null,
    schedule_id: scheduleId,
    schedule_name: String(row.schedule_name ?? ''),
    session_id: sessionId,
    browser_context_id: row.browser_context_id ? String(row.browser_context_id) : null,
    status: String(row.status ?? ''),
    error: truncateText(String(row.error ?? '') || projection?.error_summary || '', 500) || null,
    started_at: String(row.started_at ?? ''),
    completed_at: row.completed_at ? String(row.completed_at) : null,
    updated_at: projection?.updated_at ?? String(row.completed_at ?? row.started_at ?? ''),
    progress: projection?.progress ?? null,
    current_step: projection?.current_step ?? null,
    route: `/workflow/schedules/${encodeURIComponent(scheduleId)}/runs/${encodeURIComponent(runId)}`,
  };
}

function summarizeActiveWorkflowAgent(session: WorkflowAgentExecutionSnapshot): Record<string, unknown> {
  const route = resolveActiveWorkflowAgentRoute(session);
  return {
    workflow_run_id: session.workflowRunId,
    step_id: session.stepId,
    lifecycle_state: session.lifecycleState,
    cancel_requested: session.cancelRequested,
    role: session.role,
    role_name: session.roleName,
    agent_type: session.agentType,
    execution_mode: session.executionMode,
    requested_model: session.requestedModel ?? null,
    resolved_model: session.resolvedModel ?? null,
    allowed_tools: session.allowedTools,
    capability_tags: session.capabilityTags,
    memory_policy: session.memoryPolicy,
    concurrency_limit: session.concurrencyLimit,
    session_id: session.sessionId ?? null,
    run_id: session.runId ?? null,
    stage_id: session.stageId ?? null,
    started_at: session.startedAt,
    task_id: route.taskId,
    schedule_id: route.scheduleId,
    schedule_run_id: route.scheduleRunId,
    route: route.route,
    route_kind: route.kind,
  };
}

function resolveActiveWorkflowAgentRoute(session: WorkflowAgentExecutionSnapshot): {
  kind: 'schedule_run' | 'workflow_task' | 'workflow_overview';
  route: string;
  taskId: string | null;
  scheduleId: string | null;
  scheduleRunId: string | null;
} {
  const scheduleRun = findScheduleRunForActiveAgent(session);
  if (scheduleRun) {
    return {
      kind: 'schedule_run',
      route: `/workflow/schedules/${encodeURIComponent(scheduleRun.scheduleId)}/runs/${encodeURIComponent(scheduleRun.id)}`,
      taskId: null,
      scheduleId: scheduleRun.scheduleId,
      scheduleRunId: scheduleRun.id,
    };
  }

  return {
    kind: 'workflow_overview',
    route: '/workflow',
    taskId: null,
    scheduleId: null,
    scheduleRunId: null,
  };
}

function findScheduleRunForActiveAgent(session: WorkflowAgentExecutionSnapshot): { id: string; scheduleId: string } | null {
  if (session.runId) {
    const direct = getRunHistory(session.runId);
    if (direct) {
      return { id: direct.id, scheduleId: direct.scheduleId };
    }
  }

  const bySession = findLatestScheduleRunBySessionId(session.sessionId);
  if (bySession) return bySession;

  const projection = getWorkflowProjectionSummary(session.workflowRunId);
  return findLatestScheduleRunBySessionId(projection?.task_id);
}

function findLatestScheduleRunBySessionId(sessionId: string | null | undefined): { id: string; scheduleId: string } | null {
  const normalized = normalizeText(sessionId);
  if (!normalized || !tableExists('schedule_run_history')) return null;
  const row = getDb().prepare(`
    SELECT id, schedule_id
    FROM schedule_run_history
    WHERE session_id = ?
    ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at DESC
    LIMIT 1
  `).get(normalized) as { id?: string; schedule_id?: string } | undefined;
  if (!row?.id || !row.schedule_id) return null;
  return { id: String(row.id), scheduleId: String(row.schedule_id) };
}

function buildRunProjectionSummary(runId: string): WorkflowProjectionSummary | null {
  return getWorkflowProjectionByRunId(runId);
}

function getWorkflowProjectionByRunId(runId: string): WorkflowProjectionSummary | null {
  if (!tableExists('workflow_task_mapping') || !tableExists('workflow_executions')) return null;
  const row = getDb().prepare(`
    SELECT we.*
    FROM workflow_task_mapping m
    JOIN workflow_executions we ON we.workflow_id = m.workflow_id
    WHERE m.execution_id = ?
    LIMIT 1
  `).get(runId) as Record<string, unknown> | undefined;
  return row ? parseWorkflowProjectionRow(row) : null;
}

function getWorkflowProjectionByTaskId(taskId: string): WorkflowProjectionSummary | null {
  if (!taskId || !tableExists('workflow_executions')) return null;
  const row = getDb().prepare(`
    SELECT *
    FROM workflow_executions
    WHERE task_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(taskId) as Record<string, unknown> | undefined;
  return row ? parseWorkflowProjectionRow(row) : null;
}

function getWorkflowProjectionSummary(workflowId: string): WorkflowProjectionSummary | null {
  if (!workflowId || !tableExists('workflow_executions')) return null;
  const row = getDb().prepare(`
    SELECT *
    FROM workflow_executions
    WHERE workflow_id = ?
  `).get(workflowId) as Record<string, unknown> | undefined;
  return row ? parseWorkflowProjectionRow(row) : null;
}

function parseWorkflowProjectionRow(row: Record<string, unknown>): WorkflowProjectionSummary | null {
  const workflowId = normalizeText(row.workflow_id);
  if (!workflowId) return null;
  return {
    workflow_id: workflowId,
    task_id: String(row.task_id ?? ''),
    workflow_name: String(row.workflow_name ?? ''),
    workflow_version: String(row.workflow_version ?? ''),
    status: String(row.status ?? ''),
    progress: Number(row.progress ?? 0),
    current_step: row.current_step ? String(row.current_step) : null,
    completed_steps: parseStringArray(row.completed_steps_json),
    running_steps: parseStringArray(row.running_steps_json),
    skipped_steps: parseStringArray(row.skipped_steps_json),
    step_ids: parseStringArray(row.step_ids_json),
    started_at: row.started_at ? String(row.started_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    updated_at: String(row.updated_at ?? ''),
    result_summary: summarizeUnknown(parseJsonValue(row.result_json), 500),
    error_summary: summarizeUnknown(parseJsonValue(row.error_json), 500),
  };
}

function readKnowledgeStats() {
  if (!tableExists('kb_items')) return emptyKnowledgeStats();
  const processingRows = getDb().prepare(
    'SELECT processing_status as status, COUNT(*) as count FROM kb_items GROUP BY processing_status',
  ).all() as Array<{ status?: string; count?: number }>;
  const processing = Object.fromEntries(processingRows.map((row) => [row.status || 'unknown', Number(row.count || 0)]));
  return {
    collections: tableExists('kb_collections') ? scalarCount('kb_collections') : 0,
    items_total: scalarCount('kb_items'),
    processing,
    chunks_total: tableExists('kb_chunks') ? scalarCount('kb_chunks') : 0,
    embedded_chunks: tableExists('kb_chunks') ? scalarCount('kb_chunks', 'embedding IS NOT NULL') : 0,
    failed_items: Number(processing.failed || 0),
    pending_or_processing_items: Number(processing.pending || 0) + Number(processing.processing || 0),
  };
}

function readDeepSearchSitesSnapshot(): ButlerDeepSearchSite[] {
  if (!tableExists('deepsearch_sites')) return [];
  const hasStates = tableExists('deepsearch_site_states');
  const rows = hasStates
    ? getDb().prepare(`
        SELECT s.site_key, s.display_name, st.login_state
        FROM deepsearch_sites s
        LEFT JOIN deepsearch_site_states st ON st.site_key = s.site_key
        ORDER BY s.display_name COLLATE NOCASE ASC
      `).all()
    : getDb().prepare(`
        SELECT site_key, display_name, NULL as login_state
        FROM deepsearch_sites
        ORDER BY display_name COLLATE NOCASE ASC
      `).all();
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    siteKey: String(row.site_key ?? ''),
    displayName: String(row.display_name ?? row.site_key ?? ''),
    liveState: row.login_state ? { loginState: String(row.login_state) } : null,
  }));
}

function emptyWorkflowRunStats() {
  return {
    byStatus: {} as Record<string, number>,
    running: 0,
    recentFailures: 0,
    lastRunAt: null as string | null,
    recentRuns: [] as Array<Record<string, unknown>>,
  };
}

function emptyProjectionStats() {
  return {
    byStatus: {} as Record<string, number>,
    running: 0,
    failed: 0,
  };
}

function emptyKnowledgeStats() {
  return {
    collections: 0,
    items_total: 0,
    processing: {} as Record<string, number>,
    chunks_total: 0,
    embedded_chunks: 0,
    failed_items: 0,
    pending_or_processing_items: 0,
  };
}

function appendExtensionDiagnostics(servers: ReturnType<typeof getAllMcpServers>, diagnostics: ButlerDiagnostic[]) {
  const enabled = servers.filter((server) => server.is_enabled);
  const failed = enabled.filter((server) => server.health_status === 'failed');
  const unknown = enabled.filter((server) => !server.health_status || server.health_status === 'unknown');
  if (failed.length > 0) {
    diagnostics.push({
      severity: 'error',
      area: 'mcp',
      title: '有 MCP 服务器自检失败',
      message: `失败数量 ${failed.length}。优先检查: ${failed.slice(0, 3).map((server) => server.name).join(', ')}。`,
      route: '/extensions?tab=mcp',
    });
  }
  if (unknown.length > 0) {
    diagnostics.push({
      severity: 'warning',
      area: 'mcp',
      title: '有 MCP 服务器尚未检测',
      message: `未检测数量 ${unknown.length}。可以在“扩展 > MCP 服务器”点击“检测全部”。`,
      route: '/extensions?tab=mcp',
    });
  }
}

function appendCapabilityDiagnostics(
  packages: ReturnType<typeof listPackages>,
  drafts: ReturnType<typeof listDrafts>,
  diagnostics: ButlerDiagnostic[],
) {
  const failed = packages.filter((item) => item.status === 'validation_failed' || item.status === 'test_failed');
  const ready = packages.filter((item) => item.status === 'ready_to_publish');
  if (failed.length > 0) {
    diagnostics.push({
      severity: 'warning',
      area: 'capabilities',
      title: '有能力生成失败或测试失败',
      message: `失败数量 ${failed.length}。可以从“扩展 > 能力生成器”继续查看失败原因。`,
      route: '/extensions?tab=builder',
    });
  }
  if (ready.length > 0 || drafts.length > 0) {
    diagnostics.push({
      severity: 'info',
      area: 'capabilities',
      title: '有待发布或未完成能力',
      message: `待发布 ${ready.length} 个，草稿 ${drafts.length} 个。`,
      route: '/extensions?tab=builder',
    });
  }
}

function appendWorkflowDiagnostics(
  runStats: ReturnType<typeof emptyWorkflowRunStats>,
  projectionStats: ReturnType<typeof emptyProjectionStats>,
  diagnostics: ButlerDiagnostic[],
) {
  if (runStats.recentFailures > 0 || projectionStats.failed > 0) {
    diagnostics.push({
      severity: 'warning',
      area: 'workflow',
      title: '最近有 Workflow 执行失败',
      message: `最近 7 天执行失败 ${runStats.recentFailures} 条，投影失败 ${projectionStats.failed} 条。`,
      route: '/workflow/schedules',
    });
  }
  if (runStats.running > 0 || projectionStats.running > 0) {
    diagnostics.push({
      severity: 'info',
      area: 'workflow',
      title: '有任务正在执行',
      message: `运行中执行记录 ${runStats.running} 条，运行中投影 ${projectionStats.running} 条。`,
      route: '/workflow/schedules',
    });
  }
}

function appendKnowledgeDiagnostics(
  stats: ReturnType<typeof emptyKnowledgeStats>,
  diagnostics: ButlerDiagnostic[],
) {
  if (stats.failed_items > 0) {
    diagnostics.push({
      severity: 'warning',
      area: 'knowledge',
      title: '知识库有索引失败条目',
      message: `失败条目 ${stats.failed_items} 个。建议到知识库页面查看导入/向量化状态。`,
      route: '/library',
    });
  }
  if (stats.pending_or_processing_items > 0) {
    diagnostics.push({
      severity: 'info',
      area: 'knowledge',
      title: '知识库仍有内容在处理',
      message: `待处理或处理中 ${stats.pending_or_processing_items} 个。`,
      route: '/library',
    });
  }
}

function appendDeepSearchDiagnostics(
  sites: ButlerDeepSearchSite[],
  runs: ReturnType<typeof listDeepSearchRuns>,
  diagnostics: ButlerDiagnostic[],
) {
  const waitingLoginRuns = runs.filter((run) => run.status === 'waiting_login');
  const failedRuns = runs.filter((run) => run.status === 'failed');
  const loginBlockedSites = sites.filter((site) => (
    site.liveState?.loginState === 'missing'
    || site.liveState?.loginState === 'expired'
    || site.liveState?.loginState === 'suspected_expired'
  ));
  if (waitingLoginRuns.length > 0 || loginBlockedSites.length > 0) {
    diagnostics.push({
      severity: 'warning',
      area: 'deepsearch',
      title: 'DeepSearch 有登录态卡点',
      message: `等待登录任务 ${waitingLoginRuns.length} 条，可能需要登录的站点 ${loginBlockedSites.length} 个。`,
      route: '/extensions?tab=deepsearch',
    });
  }
  if (failedRuns.length > 0) {
    diagnostics.push({
      severity: 'warning',
      area: 'deepsearch',
      title: 'DeepSearch 最近有失败任务',
      message: `最近失败任务 ${failedRuns.length} 条。`,
      route: '/extensions?tab=deepsearch',
    });
  }
}

function appendBrowserDiagnostics(
  contexts: ReturnType<typeof listBrowserProviderConfigs>,
  diagnostics: ButlerDiagnostic[],
) {
  const failed = contexts.filter((context) => context.enabled && context.last_test_status === 'failed');
  const untested = contexts.filter((context) => context.enabled && context.last_test_status === 'untested');
  if (failed.length > 0) {
    diagnostics.push({
      severity: 'warning',
      area: 'browser',
      title: '有浏览器配置测试失败',
      message: `失败数量 ${failed.length}。优先检查: ${failed.slice(0, 3).map((item) => item.display_name).join(', ')}。`,
      route: '/settings/browsers',
    });
  }
  if (untested.length > 0) {
    diagnostics.push({
      severity: 'info',
      area: 'browser',
      title: '有浏览器配置尚未测试',
      message: `未测试数量 ${untested.length}。`,
      route: '/settings/browsers',
    });
  }
}

function appendRuntimeDiagnostics(
  resources: ReturnType<typeof summarizeRuntimeResources> | null,
  diagnostics: ButlerDiagnostic[],
) {
  if (!resources) return;
  if (!resources.node_runtime_found) {
    diagnostics.push({
      severity: 'info',
      area: 'runtime',
      title: '未发现外置 Node runtime',
      message: '当前可能仍走系统或安装包内资源；这不一定是错误，但会影响后续资源拆包验收。',
    });
  }
  if (!resources.embedding_model_found) {
    diagnostics.push({
      severity: 'warning',
      area: 'runtime',
      title: '未发现本地 embedding 模型配置文件',
      message: '知识库本地向量化可能无法在离线或打包环境中完成。',
      route: '/library',
    });
  }
}

function searchSessions(like: string, limit: number) {
  if (!tableExists('chat_sessions')) return [];
  const rows = getDb().prepare(`
    SELECT id, title, updated_at, working_directory, mode, kind
    FROM chat_sessions
    WHERE title LIKE ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(like, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const routePrefix = row.kind === 'main-agent' ? '/main-agent' : '/chat';
    return {
      type: 'session',
      id: String(row.id),
      title: String(row.title ?? ''),
      snippet: String(row.title ?? ''),
      updated_at: String(row.updated_at ?? ''),
      route: `${routePrefix}/${encodeURIComponent(String(row.id))}`,
      metadata: {
        mode: String(row.mode ?? ''),
        working_directory: String(row.working_directory ?? ''),
      },
    };
  });
}

function searchMessages(like: string, limit: number) {
  if (!tableExists('messages') || !tableExists('chat_sessions')) return [];
  const rows = getDb().prepare(`
    SELECT m.id, m.session_id, m.role, m.content, m.created_at,
           s.title as session_title, s.kind as kind
    FROM messages m
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE m.content LIKE ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(like, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const routePrefix = row.kind === 'main-agent' ? '/main-agent' : '/chat';
    return {
      type: 'message',
      id: String(row.id),
      session_id: String(row.session_id),
      title: String(row.session_title ?? ''),
      role: String(row.role ?? ''),
      snippet: truncateText(extractContentText(String(row.content ?? '')), 500),
      created_at: String(row.created_at ?? ''),
      route: `${routePrefix}/${encodeURIComponent(String(row.session_id))}`,
    };
  });
}

function searchTasks(like: string, limit: number) {
  if (!tableExists('tasks')) return [];
  const rows = getDb().prepare(`
    SELECT id, session_id, title, status, description, final_result_summary, updated_at, current_run_id
    FROM tasks
    WHERE title LIKE ? OR description LIKE ? OR final_result_summary LIKE ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(like, like, like, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    type: 'task',
    id: String(row.id),
    session_id: String(row.session_id),
    title: String(row.title ?? ''),
    status: String(row.status ?? ''),
    snippet: truncateText(String(row.final_result_summary || row.description || row.title || ''), 500),
    updated_at: String(row.updated_at ?? ''),
    route: `/main-agent/${encodeURIComponent(String(row.session_id))}`,
    metadata: {
      current_run_id: row.current_run_id ? String(row.current_run_id) : null,
    },
  }));
}

function searchWorkflows(like: string, limit: number) {
  const results: Array<Record<string, unknown>> = [];
  if (tableExists('scheduled_workflows')) {
    const rows = getDb().prepare(`
      SELECT id, name, enabled, run_mode, last_run_status, last_error, updated_at
      FROM scheduled_workflows
      WHERE name LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(like, limit) as Array<Record<string, unknown>>;
    results.push(...rows.map((row) => ({
      type: 'workflow_schedule',
      id: String(row.id),
      title: String(row.name ?? ''),
      status: String(row.last_run_status ?? ''),
      snippet: truncateText(String(row.last_error || row.name || ''), 500),
      updated_at: String(row.updated_at ?? ''),
      route: `/workflow/schedules/${encodeURIComponent(String(row.id))}`,
      metadata: {
        enabled: Boolean(row.enabled),
        run_mode: String(row.run_mode ?? ''),
      },
    })));
  }
  if (tableExists('workflow_definitions')) {
    const rows = getDb().prepare(`
      SELECT id, name, version, created_at
      FROM workflow_definitions
      WHERE name LIKE ? OR id LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(like, like, limit) as Array<Record<string, unknown>>;
    results.push(...rows.map((row) => ({
      type: 'workflow_definition',
      id: String(row.id),
      title: String(row.name ?? row.id ?? ''),
      snippet: `version ${String(row.version ?? '')}`,
      created_at: String(row.created_at ?? ''),
      route: '/workflow',
    })));
  }
  return results.slice(0, limit);
}

function searchDeepSearchRuns(like: string, limit: number) {
  if (!tableExists('deepsearch_runs')) return [];
  const rows = getDb().prepare(`
    SELECT id, query_text, status, status_message, result_summary, updated_at
    FROM deepsearch_runs
    WHERE query_text LIKE ? OR result_summary LIKE ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(like, like, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    type: 'deepsearch_run',
    id: String(row.id),
    title: truncateText(String(row.query_text ?? ''), 160),
    status: String(row.status ?? ''),
    snippet: truncateText(String(row.result_summary || row.status_message || row.query_text || ''), 500),
    updated_at: String(row.updated_at ?? ''),
    route: `/extensions?tab=deepsearch&runId=${encodeURIComponent(String(row.id))}`,
  }));
}

function searchCapabilities(like: string, limit: number) {
  if (!tableExists('capability_packages')) return [];
  const rows = getDb().prepare(`
    SELECT id, name, description, status, category, risk_level, updated_at
    FROM capability_packages
    WHERE name LIKE ? OR description LIKE ? OR id LIKE ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(like, like, like, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    type: 'capability',
    id: String(row.id),
    title: String(row.name ?? ''),
    status: String(row.status ?? ''),
    snippet: truncateText(String(row.description || row.name || ''), 500),
    updated_at: String(row.updated_at ?? ''),
    route: '/extensions?tab=builder',
    metadata: {
      category: String(row.category ?? ''),
      risk_level: String(row.risk_level ?? ''),
    },
  }));
}

function summarizeSessionRow(session: ChatSession) {
  const routePrefix = isMainAgentSession(session) ? '/main-agent' : '/chat';
  return {
    id: session.id,
    title: session.title,
    mode: session.mode ?? 'code',
    status: session.status,
    provider_name: session.provider_name || '',
    provider_id: session.provider_id || '',
    model: session.model || session.requested_model || '',
    resolved_model: session.resolved_model || '',
    working_directory: session.working_directory || session.sdk_cwd || '',
    browser_context_id: session.browser_context_id || 'embedded:default',
    runtime_status: session.runtime_status || '',
    created_at: session.created_at,
    updated_at: session.updated_at,
    route: `${routePrefix}/${encodeURIComponent(session.id)}`,
  };
}

function tableExists(tableName: string): boolean {
  try {
    const row = getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    ).get(tableName) as { name?: string } | undefined;
    return row?.name === tableName;
  } catch {
    return false;
  }
}

function scalarCount(tableName: string, whereClause?: string): number {
  const sql = whereClause
    ? `SELECT COUNT(*) as count FROM ${tableName} WHERE ${whereClause}`
    : `SELECT COUNT(*) as count FROM ${tableName}`;
  const row = getDb().prepare(sql).get() as { count?: number } | undefined;
  return Number(row?.count || 0);
}

function extractMessageText(message: Message): string {
  return extractContentText(message.content);
}

function extractContentText(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((block) => {
        if (!block || typeof block !== 'object') return '';
        const record = block as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.summary === 'string') return record.summary;
        if (typeof record.content === 'string') return record.content;
        if (typeof record.name === 'string') return `[tool:${record.name}]`;
        return '';
      }).filter(Boolean).join('\n');
    }
  } catch {
    // Plain text message.
  }
  return content;
}

function safeJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseStringArray(raw: unknown): string[] {
  const parsed = parseJsonValue(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function countBy<T>(items: T[], picker: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = picker(item) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorkflowRunStatus(value: unknown): string | undefined {
  const text = normalizeText(value);
  return WORKFLOW_RUN_STATUSES.includes(text as (typeof WORKFLOW_RUN_STATUSES)[number])
    ? text
    : undefined;
}

function truncateText(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT));
}

function clampWorkflowLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_WORKFLOW_LIMIT, MAX_WORKFLOW_LIMIT));
}

function summarizeUnknown(value: unknown, maxChars: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return truncateText(value, maxChars) || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return truncateText(JSON.stringify(value), maxChars) || null;
  } catch {
    return null;
  }
}


function compareRunLikeRows(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftTime = Date.parse(String(left.updated_at || left.completed_at || left.started_at || '')) || 0;
  const rightTime = Date.parse(String(right.updated_at || right.completed_at || right.started_at || '')) || 0;
  return rightTime - leftTime;
}

function safeExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function findFirstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (safeExists(candidate)) return candidate;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: false,
        error: errorMessage(error),
      }, null, 2),
    }],
    isError: true,
  };
}
