import { randomUUID } from 'crypto';
import fs from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveProviderApiKey } from '@/lib/provider-model-discovery';
import { getSession, addMessage } from '@/lib/db';
import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import type { ApiProvider } from '@/types';
import type {
  AgentExecutionBindingV1,
  StageExecutionPayloadV1,
  StageExecutionResultV1,
} from '@/lib/team-run/runtime-contracts';
import { StageWorker } from '@/lib/team-run/stage-worker';
import { formatStepOutputMarkdown, type RawTraceEvent } from '@/lib/workflow/step-output-formatter';
import { isClaudeLocalAuthProvider } from '@/lib/claude/provider-env';
import type {
  AgentStepInput,
  InlineAgentDef,
  JsonValue,
  StepResult,
  WorkflowAgentExecutionMode,
  WorkflowAgentRole,
  WorkflowStepRuntimeContext,
} from './types';
import { executeCodeHandler } from './code-executor';
import { getWorkflowExecutionRoleConfig } from './agent-config';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildPromptCapabilitiesSystemPrompt(_tools?: unknown): string { return ''; }
import { getWorkflowAgentPreset, type WorkflowAgentPreset } from '@/lib/db/workflow-agent-presets';
import { getAgentPreset, type AgentPresetDirectoryItem } from '@/lib/db/agent-presets';
import { generateObjectWithClaudeSdk } from '@/lib/claude/structured-output';
import { z } from 'zod';

type RuntimeCapability = AgentExecutionBindingV1['allowedTools'][number];

interface ResolvedWorkflowAgentDefinition {
  role: WorkflowAgentRole;
  binding: AgentExecutionBindingV1;
  ignoredToolRequests: string[];
}

interface ActiveWorkflowAgentExecution {
  workflowRunId: string;
  stepId: string;
  abortController: AbortController;
  worker: StageWorker;
  startedAt: string;
  lifecycleState: 'preparing' | 'running';
  cancelRequested: boolean;
  role: WorkflowAgentRole;
  roleName: string;
  agentType: string;
  executionMode: Exclude<WorkflowAgentExecutionMode, 'auto'>;
  requestedModel?: string;
  allowedTools: AgentExecutionBindingV1['allowedTools'];
  capabilityTags: AgentExecutionBindingV1['capabilityTags'];
  memoryPolicy: AgentExecutionBindingV1['memoryPolicy'];
  concurrencyLimit: number;
  sessionId?: string;
  runId?: string;
  stageId?: string;
  memoryRefs?: StageExecutionPayloadV1['memoryRefs'];
  workspace?: StageExecutionPayloadV1['workspace'];
}

export interface WorkflowAgentExecutionSnapshot {
  workflowRunId: string;
  stepId: string;
  startedAt: string;
  lifecycleState: 'preparing' | 'running';
  cancelRequested: boolean;
  role: WorkflowAgentRole;
  roleName: string;
  agentType: string;
  executionMode: Exclude<WorkflowAgentExecutionMode, 'auto'>;
  requestedModel?: string;
  allowedTools: AgentExecutionBindingV1['allowedTools'];
  capabilityTags: AgentExecutionBindingV1['capabilityTags'];
  memoryPolicy: AgentExecutionBindingV1['memoryPolicy'];
  concurrencyLimit: number;
  sessionId?: string;
  runId?: string;
  stageId?: string;
  memoryRefs?: StageExecutionPayloadV1['memoryRefs'];
  workspace?: StageExecutionPayloadV1['workspace'];
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_WORKFLOW_AGENT_ROLE: WorkflowAgentRole = 'worker';
const LEGACY_WORKFLOW_AGENT_ROLE_ALIASES: Record<string, WorkflowAgentRole> = {
  general: 'worker',
};
const RUNTIME_CAPABILITY_ALIASES: Record<string, RuntimeCapability> = {
  'workspace.read': 'workspace.read',
  'workspace.write': 'workspace.write',
  'shell.exec': 'shell.exec',
  read_file: 'workspace.read',
  search_code: 'workspace.read',
  write_file: 'workspace.write',
};

const activeWorkflowAgentExecutions = new Map<string, ActiveWorkflowAgentExecution>();
const WORKFLOW_AGENT_CANCELLED_MESSAGE = 'Task execution cancelled';

function toWorkflowAgentExecutionSnapshot(
  execution: ActiveWorkflowAgentExecution,
): WorkflowAgentExecutionSnapshot {
  return {
    workflowRunId: execution.workflowRunId,
    stepId: execution.stepId,
    startedAt: execution.startedAt,
    lifecycleState: execution.lifecycleState,
    cancelRequested: execution.cancelRequested,
    role: execution.role,
    roleName: execution.roleName,
    agentType: execution.agentType,
    executionMode: execution.executionMode,
    requestedModel: execution.requestedModel,
    allowedTools: [...execution.allowedTools],
    capabilityTags: [...execution.capabilityTags],
    memoryPolicy: execution.memoryPolicy,
    concurrencyLimit: execution.concurrencyLimit,
    sessionId: execution.sessionId,
    runId: execution.runId,
    stageId: execution.stageId,
    memoryRefs: execution.memoryRefs
      ? { ...execution.memoryRefs }
      : undefined,
    workspace: execution.workspace
      ? { ...execution.workspace }
      : undefined,
  };
}

function updateActiveWorkflowAgentExecution(
  key: string,
  patch: Partial<ActiveWorkflowAgentExecution>,
): void {
  const current = activeWorkflowAgentExecutions.get(key);
  if (!current) {
    return;
  }

  activeWorkflowAgentExecutions.set(key, {
    ...current,
    ...patch,
  });
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

function hasLikelyFileExtension(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() || '';
  return /\.[a-zA-Z0-9]{1,16}$/.test(fileName);
}

function cleanAbsoluteFilePath(value: string): string | null {
  const trimmed = value.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!trimmed || !isAbsoluteFilePath(trimmed) || !hasLikelyFileExtension(trimmed)) {
    return null;
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return null;
  }
  return trimmed;
}

function extractPreferredContextSummary(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ['summary', 'message', 'result', 'content', 'text', 'title', 'url', 'screenshotPath']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function collectContextArtifactRefs(value: unknown, refs = new Set<string>(), seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') {
    const cleaned = cleanAbsoluteFilePath(value);
    if (cleaned) {
      refs.add(cleaned);
    }
    return Array.from(refs);
  }

  if (!value || typeof value !== 'object') {
    return Array.from(refs);
  }

  if (seen.has(value)) {
    return Array.from(refs);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectContextArtifactRefs(item, refs, seen);
      if (refs.size >= 8) {
        break;
      }
    }
    return Array.from(refs);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase().includes('base64')) {
      continue;
    }
    collectContextArtifactRefs(nested, refs, seen);
    if (refs.size >= 8) {
      break;
    }
  }

  return Array.from(refs);
}

function buildWorkflowAgentDependencies(context: AgentStepInput['context']): StageExecutionPayloadV1['dependencies'] {
  if (!context || !isRecord(context)) {
    return [];
  }

  return Object.entries(context).map(([key, value]) => ({
    stageId: key,
    title: key,
    summary: extractPreferredContextSummary(value) || 'N/A',
    artifactRefs: collectContextArtifactRefs(value),
  }));
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function getWorkflowAgentRootDir(): string {
  const baseDir = process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
  return path.join(baseDir, 'workflow-agent-runs');
}

function resolveWorkflowAgentRole(role: string | undefined): WorkflowAgentRole {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_WORKFLOW_AGENT_ROLE;
  }
  if (normalized in LEGACY_WORKFLOW_AGENT_ROLE_ALIASES) {
    return LEGACY_WORKFLOW_AGENT_ROLE_ALIASES[normalized];
  }
  try {
    getWorkflowExecutionRoleConfig(normalized as WorkflowAgentRole);
    return normalized as WorkflowAgentRole;
  } catch {
    return DEFAULT_WORKFLOW_AGENT_ROLE;
  }
}

function resolveAllowedCapabilities(
  baseAllowedTools: RuntimeCapability[],
  requestedTools: string[] | undefined,
): { allowedTools: RuntimeCapability[]; ignoredToolRequests: string[] } {
  if (!Array.isArray(requestedTools) || requestedTools.length === 0) {
    return {
      allowedTools: [...baseAllowedTools],
      ignoredToolRequests: [],
    };
  }

  const normalizedRequests = requestedTools
    .map((tool) => tool.trim())
    .filter(Boolean);
  const mappedCapabilities = normalizedRequests
    .map((tool) => RUNTIME_CAPABILITY_ALIASES[tool])
    .filter((tool): tool is RuntimeCapability => Boolean(tool));
  const ignoredToolRequests = normalizedRequests.filter((tool) => !(tool in RUNTIME_CAPABILITY_ALIASES));

  if (mappedCapabilities.length === 0) {
    return {
      allowedTools: [...baseAllowedTools],
      ignoredToolRequests,
    };
  }

  const requestedCapabilitySet = new Set(mappedCapabilities);
  return {
    allowedTools: baseAllowedTools.filter((tool) => requestedCapabilitySet.has(tool)),
    ignoredToolRequests,
  };
}

function buildDefinitionFromConversationPreset(
  preset: AgentPresetDirectoryItem,
  input: AgentStepInput,
): ResolvedWorkflowAgentDefinition {
  const baseAllowedTools: RuntimeCapability[] = ['workspace.read', 'workspace.write', 'shell.exec'];
  const capabilitySelection = resolveAllowedCapabilities(baseAllowedTools, input.tools);
  const capabilityPrompt = buildPromptCapabilitiesSystemPrompt(input.tools);
  const enhancedSystemPrompt = (preset.systemPrompt ?? '') + capabilityPrompt;

  return {
    role: 'worker',
    binding: {
      agentDefinitionId: `workflow-agent-def:conversation-preset:${preset.id}`,
      agentType: 'workflow.agent',
      roleName: preset.name,
      systemPrompt: enhancedSystemPrompt,
      allowedTools: uniqueValues(capabilitySelection.allowedTools),
      capabilityTags: [],
      memoryPolicy: 'ephemeral-stage',
      outputSchema: 'stage-execution-result/v1',
      concurrencyLimit: 1,
    },
    ignoredToolRequests: capabilitySelection.ignoredToolRequests,
  };
}

function buildDefinitionFromPreset(
  preset: WorkflowAgentPreset,
  input: AgentStepInput,
): ResolvedWorkflowAgentDefinition {
  const role = resolveWorkflowAgentRole(preset.config.role);
  const baseAllowedTools = (preset.config.allowedTools ?? ['workspace.read', 'workspace.write', 'shell.exec']) as RuntimeCapability[];
  const capabilitySelection = resolveAllowedCapabilities(baseAllowedTools, input.tools);
  const capabilityPrompt = buildPromptCapabilitiesSystemPrompt(input.tools);
  const enhancedSystemPrompt = (preset.config.systemPrompt ?? '') + capabilityPrompt;

  return {
    role,
    binding: {
      agentDefinitionId: `workflow-agent-def:preset:${preset.id}`,
      agentType: `workflow.${role}`,
      roleName: preset.name,
      systemPrompt: enhancedSystemPrompt,
      allowedTools: uniqueValues(capabilitySelection.allowedTools),
      capabilityTags: [...(preset.config.capabilityTags ?? [])],
      memoryPolicy: (preset.config.memoryPolicy ?? 'ephemeral-stage') as AgentExecutionBindingV1['memoryPolicy'],
      outputSchema: 'stage-execution-result/v1',
      concurrencyLimit: preset.config.concurrencyLimit ?? 1,
    },
    ignoredToolRequests: capabilitySelection.ignoredToolRequests,
  };
}

function buildDefinitionFromInlineAgentDef(
  agentDef: InlineAgentDef,
  input: AgentStepInput,
): ResolvedWorkflowAgentDefinition {
  const role = resolveWorkflowAgentRole(agentDef.role);
  const baseAllowedTools = (agentDef.allowedTools ?? ['workspace.read', 'workspace.write', 'shell.exec']) as RuntimeCapability[];
  const capabilitySelection = resolveAllowedCapabilities(baseAllowedTools, input.tools);
  const capabilityPrompt = buildPromptCapabilitiesSystemPrompt(input.tools);
  const enhancedSystemPrompt = (agentDef.systemPrompt ?? '') + capabilityPrompt;

  return {
    role,
    binding: {
      agentDefinitionId: `workflow-agent-def:inline:${agentDef.name}`,
      agentType: `workflow.${role}`,
      roleName: agentDef.name,
      systemPrompt: enhancedSystemPrompt,
      allowedTools: uniqueValues(capabilitySelection.allowedTools),
      capabilityTags: [...(agentDef.capabilityTags ?? [])],
      memoryPolicy: (agentDef.memoryPolicy ?? 'ephemeral-stage') as AgentExecutionBindingV1['memoryPolicy'],
      outputSchema: 'stage-execution-result/v1',
      concurrencyLimit: agentDef.concurrencyLimit ?? 1,
    },
    ignoredToolRequests: capabilitySelection.ignoredToolRequests,
  };
}

function resolveWorkflowAgentDefinition(input: AgentStepInput): ResolvedWorkflowAgentDefinition {
  if (input.preset) {
    // First try workflow-agent presets (legacy/builtin)
    const workflowPreset = getWorkflowAgentPreset(input.preset);
    if (workflowPreset && workflowPreset.isEnabled !== false) {
      return buildDefinitionFromPreset(workflowPreset, input);
    }
    // Then try conversation presets (user-created agents)
    const conversationPreset = getAgentPreset(input.preset);
    if (conversationPreset) {
      return buildDefinitionFromConversationPreset(conversationPreset, input);
    }
    // Fallback: use inline agentDef if preset ID not found locally (imported workflow)
    if (input.agentDef) {
      return buildDefinitionFromInlineAgentDef(input.agentDef, input);
    }
    // #8: Error instead of silently falling back when preset is missing
    throw new Error(`Agent preset「${input.preset}」不存在或已被删除，请检查工作流配置`);
  }

  const role = resolveWorkflowAgentRole(input.role);
  const roleDefinition = getWorkflowExecutionRoleConfig(role);
  const capabilitySelection = resolveAllowedCapabilities(roleDefinition.allowedTools, input.tools);

  // 注入指令型能力到 system prompt
  const capabilityPrompt = buildPromptCapabilitiesSystemPrompt(input.tools);
  const enhancedSystemPrompt = roleDefinition.systemPrompt + capabilityPrompt;

  return {
    role,
    binding: {
      agentDefinitionId: `workflow-agent-def:${role}`,
      agentType: roleDefinition.agentType,
      roleName: roleDefinition.roleName,
      systemPrompt: enhancedSystemPrompt,
      allowedTools: uniqueValues(capabilitySelection.allowedTools),
      capabilityTags: [...roleDefinition.capabilityTags],
      memoryPolicy: roleDefinition.memoryPolicy,
      outputSchema: 'stage-execution-result/v1',
      concurrencyLimit: roleDefinition.concurrencyLimit,
    },
    ignoredToolRequests: capabilitySelection.ignoredToolRequests,
  };
}

function getDefaultRuntimeContext(): WorkflowStepRuntimeContext {
  return {
    workflowRunId: `workflow-run-${randomUUID()}`,
    stepId: `agent-step-${randomUUID().slice(0, 8)}`,
    stepType: 'agent',
  };
}

function parseExecutionMode(rawValue: string | undefined): WorkflowAgentExecutionMode {
  switch (rawValue?.trim().toLowerCase()) {
    case 'claude':
      return 'claude';
    case 'synthetic':
      return 'synthetic';
    case 'auto':
    default:
      return 'auto';
  }
}

function getSyntheticDelayMs(): number {
  const rawValue = process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS;
  if (!rawValue) {
    return 0;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function buildActiveExecutionKey(runtimeContext: WorkflowStepRuntimeContext): string {
  return `${runtimeContext.workflowRunId}::${runtimeContext.stepId}`;
}

function buildCancelledError(): Error {
  const error = new Error(WORKFLOW_AGENT_CANCELLED_MESSAGE) as Error & { code?: string };
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function isCancelledError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    candidate.name === 'AbortError'
    || candidate.code === 'ABORT_ERR'
    || candidate.code === 'execution_cancelled'
    || candidate.message === WORKFLOW_AGENT_CANCELLED_MESSAGE
  );
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  if (signal.aborted) {
    throw buildCancelledError();
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(buildCancelledError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface ResolvedExecutionMode {
  mode: Exclude<WorkflowAgentExecutionMode, 'auto'>;
  provider?: ApiProvider;
}

function resolveSessionProvider(sessionId?: string): ApiProvider | undefined {
  const id = sessionId?.trim();
  if (!id) return undefined;
  const session = getSession(id);
  const providerId = session?.provider_id?.trim();
  if (!providerId) return undefined;
  return getProvider(providerId);
}

async function resolveExecutionMode(runtimeContext?: WorkflowStepRuntimeContext): Promise<ResolvedExecutionMode> {
  const configuredMode = parseExecutionMode(process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE);
  if (configuredMode === 'claude' || configuredMode === 'synthetic') {
    return { mode: configuredMode };
  }

  const provider = resolveSessionProvider(runtimeContext?.sessionId) || getDefaultProvider();
  if (!provider) {
    return { mode: 'synthetic' };
  }
  if (isClaudeLocalAuthProvider(provider)) {
    return { mode: 'claude', provider };
  }
  const hasCredentials = Boolean(resolveProviderApiKey(provider));
  return { mode: hasCredentials ? 'claude' : 'synthetic', provider };
}

/** Extract the first directory path from resolved context values. */
function extractContextWorkingDir(context: AgentStepInput['context']): string | null {
  if (!context || typeof context !== 'object') return null;
  for (const value of Object.values(context)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    // Accept absolute paths that look like directories (no file extension or end with /)
    if (trimmed.startsWith('/') && (!path.extname(trimmed) || trimmed.endsWith('/'))) {
      try {
        if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) return trimmed;
      } catch { /* ignore */ }
    }
  }
  return null;
}

async function prepareWorkflowAgentWorkspace(
  runtimeContext: WorkflowStepRuntimeContext,
  context?: AgentStepInput['context'],
): Promise<StageExecutionPayloadV1['workspace']> {
  const safeRunId = sanitizePathSegment(runtimeContext.workflowRunId, 'workflow-run');
  const safeStepId = sanitizePathSegment(runtimeContext.stepId, 'agent-step');
  const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
  // Context-provided directory takes priority over default workspace
  const contextDir = extractContextWorkingDir(context);
  const sessionWorkspace = contextDir || runtimeContext.workingDirectory?.trim() || dataDir;
  const runWorkspace = path.join(getWorkflowAgentRootDir(), safeRunId);
  const stageWorkspace = path.join(runWorkspace, 'stages', safeStepId);
  const sharedReadDir = path.join(runWorkspace, 'shared');
  const artifactOutputDir = path.join(stageWorkspace, 'output');

  await Promise.all([
    mkdir(path.join(stageWorkspace, 'input'), { recursive: true }),
    mkdir(path.join(stageWorkspace, 'temp'), { recursive: true }),
    mkdir(sharedReadDir, { recursive: true }),
    mkdir(artifactOutputDir, { recursive: true }),
  ]);

  return {
    sessionWorkspace,
    runWorkspace,
    stageWorkspace,
    sharedReadDir,
    artifactOutputDir,
  };
}

async function buildWorkflowAgentPayload(
  input: AgentStepInput,
  runtimeContext: WorkflowStepRuntimeContext,
  definition: ResolvedWorkflowAgentDefinition,
): Promise<StageExecutionPayloadV1> {
  const workspace = await prepareWorkflowAgentWorkspace(runtimeContext, input.context);
  const dependencies = buildWorkflowAgentDependencies(input.context);

  return {
    contractVersion: 'stage-execution-payload/v1',
    taskId: runtimeContext.taskId || runtimeContext.workflowRunId,
    sessionId: runtimeContext.sessionId || `workflow:${runtimeContext.workflowRunId}`,
    requestedModel: input.model || runtimeContext.requestedModel,
    runId: runtimeContext.workflowRunId,
    stageId: runtimeContext.stepId,
    attempt: 1,
    workspace,
    agent: definition.binding,
    taskContext: {
      userGoal: input.prompt,
      summary: `Workflow agent step ${runtimeContext.stepId}`,
      expectedOutcome: 'Complete the assigned task and produce a concise text summary. Write detailed reports/documents as files when appropriate.',
    },
    stage: {
      title: runtimeContext.stepId,
      description: input.prompt,
      acceptanceCriteria: [
        `Address the prompt assigned to workflow step ${runtimeContext.stepId}.`,
        'Produce a concise summary that downstream workflow steps can consume.',
        'Write detailed reports/documents as files under the artifact output directory.',
        ...(dependencies.length > 0
          ? ['Use the provided dependency context to produce an integrated result; do not ignore branch outputs.']
          : []),
        '禁止模拟、伪造或用脚本替代真实操作。如果所需工具（如浏览器 MCP）不可用，必须如实报告失败，绝不能用 Python/curl/fetch 等替代方案伪造结果。',
        '如果 MCP 工具调用失败或超时，先重试 1-2 次再判定失败。',
        ...(input.outputMode === 'structured'
          ? ['CRITICAL: You MUST include a ```json code block in your response containing ALL structured output fields as a JSON object. Example:\n```json\n{"field1": value1, "field2": value2}\n```\nThis JSON block is machine-parsed by downstream steps — omitting it will break the workflow.']
          : []),
        ...(input.outputSchema
          ? [(() => {
              const raw = JSON.stringify(input.outputSchema, null, 2);
              const schema = raw.length > 4000 ? JSON.stringify(input.outputSchema) : raw;
              return `Your output MUST conform to the following JSON Schema:\n${schema.slice(0, 4000)}\nReturn your result as valid JSON matching this schema.`;
            })()]
          : []),
      ],
      responseMode: 'plain-text' as const,  // Phase 1 always plain text; outcome classified in Phase 2
      inputContract: {
        requiredDependencyOutputs: [],
        taskContext: {
          includeUserGoal: true,
          includeExpectedOutcome: true,
          includeRunSummary: true,
        },
      },
      outputContract: {
        primaryFormat: 'markdown',
        mustProduceSummary: true,
        mayProduceArtifacts: false,
        artifactKinds: [],
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      },
    },
    dependencies,
    memoryRefs: {
      taskMemoryId: `workflow-task-memory:${runtimeContext.workflowRunId}`,
      plannerMemoryId: `workflow-planner-memory:${runtimeContext.workflowRunId}`,
      agentMemoryId: `workflow-agent-memory:${runtimeContext.stepId}`,
    },
    ...(input.knowledge?.enabled ? { knowledgeConfig: input.knowledge } : {}),
  };
}

function buildWorkflowAgentExecutionMetadata(input: {
  runtimeContext: WorkflowStepRuntimeContext;
  executionMode: Exclude<WorkflowAgentExecutionMode, 'auto'>;
  definition: ResolvedWorkflowAgentDefinition;
  requestedModel?: string;
  payload?: StageExecutionPayloadV1 | null;
  cancelled?: boolean;
  timedOut?: boolean;
}): Record<string, JsonValue> {
  const {
    runtimeContext,
    executionMode,
    definition,
    requestedModel,
    payload,
    cancelled,
    timedOut,
  } = input;

  return {
    workflowRunId: runtimeContext.workflowRunId,
    stepId: runtimeContext.stepId,
    executionMode,
    role: definition.role,
    agentType: definition.binding.agentType,
    allowedTools: definition.binding.allowedTools,
    ignoredToolRequests: definition.ignoredToolRequests,
    capabilityTags: definition.binding.capabilityTags,
    memoryPolicy: definition.binding.memoryPolicy,
    concurrencyLimit: definition.binding.concurrencyLimit,
    requestedModel: requestedModel ?? null,
    timeoutMs: typeof runtimeContext.timeoutMs === 'number' ? runtimeContext.timeoutMs : null,
    ...(typeof cancelled === 'boolean' ? { cancelled } : {}),
    ...(typeof timedOut === 'boolean' ? { timedOut } : {}),
    ...(payload
      ? {
          sessionId: payload.sessionId,
          runId: payload.runId,
          stageId: payload.stageId,
          memoryRefs: {
            taskMemoryId: payload.memoryRefs.taskMemoryId,
            plannerMemoryId: payload.memoryRefs.plannerMemoryId,
            agentMemoryId: payload.memoryRefs.agentMemoryId,
          },
          workspace: {
            sessionWorkspace: payload.workspace.sessionWorkspace,
            runWorkspace: payload.workspace.runWorkspace,
            stageWorkspace: payload.workspace.stageWorkspace,
            sharedReadDir: payload.workspace.sharedReadDir,
            artifactOutputDir: payload.workspace.artifactOutputDir,
          },
        }
      : {}),
  };
}

/** Try to extract structured JSON fields from agent summary text. */
function extractStructuredFields(summary: string | undefined): Record<string, unknown> | null {
  if (!summary?.trim()) return null;
  const text = summary.trim();

  // 1. Try parsing the entire summary as JSON
  if (text.startsWith('{')) {
    try { return JSON.parse(text); } catch { /* fall through */ }
  }

  // 2. Extract from ```json ... ``` fenced block
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
  }

  // 3. Extract from first { ... } block (greedy)
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* ignore */ }
  }

  // 4. Fallback: parse markdown key-value patterns like "- **key**: value" or "- key: value"
  const kvPattern = /[-*]\s*\**(\w+)\**\s*[:：]\s*(.+)/g;
  let kvMatch;
  const kvResult: Record<string, unknown> = {};
  let kvCount = 0;
  while ((kvMatch = kvPattern.exec(text)) !== null) {
    const key = kvMatch[1].trim();
    const rawVal = kvMatch[2].trim();
    // Parse typed values
    if (rawVal === 'true') kvResult[key] = true;
    else if (rawVal === 'false') kvResult[key] = false;
    else if (/^-?\d+$/.test(rawVal)) kvResult[key] = parseInt(rawVal, 10);
    else if (/^-?\d+\.\d+$/.test(rawVal)) kvResult[key] = parseFloat(rawVal);
    else kvResult[key] = rawVal;
    kvCount++;
  }
  if (kvCount > 0) return kvResult;

  return null;
}

const outcomeClassificationSchema = z.object({
  outcome: z.enum(['done', 'failed']),
  failureReason: z.string().optional(),
});

/** Phase 2: Lightweight SDK call to classify agent outcome from plain-text output. */
async function classifyAgentOutcome(input: {
  summary: string;
  stepId: string;
  provider?: ApiProvider;
  sessionId?: string;
  workingDirectory?: string;
  abortSignal?: AbortSignal;
}): Promise<z.infer<typeof outcomeClassificationSchema>> {
  const maxChars = 3000;
  const truncated = input.summary.length > maxChars
    ? `${input.summary.slice(0, maxChars)}\n...(已截断，共 ${input.summary.length} 字符)`
    : input.summary;

  return generateObjectWithClaudeSdk({
    system: '你是工作流步骤结果分类器。根据 agent 的执行输出判断任务是否成功完成。只输出 JSON。',
    prompt: [
      `工作流步骤「${input.stepId}」的 agent 执行输出如下：`,
      '',
      truncated,
      '',
      '请判断此步骤是否成功完成。',
      '如果 agent 明确报告了失败、错误、无法完成任务，则 outcome 为 "failed"，并在 failureReason 中简述原因；',
      '否则 outcome 为 "done"。',
    ].join('\n'),
    schema: outcomeClassificationSchema,
    provider: input.provider,
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    abortSignal: input.abortSignal,
  });
}

function toStepResult(input: {
  runtimeContext: WorkflowStepRuntimeContext;
  executionMode: Exclude<WorkflowAgentExecutionMode, 'auto'>;
  definition: ResolvedWorkflowAgentDefinition;
  payload: StageExecutionPayloadV1;
  result: StageExecutionResultV1;
  requestedModel?: string;
  timedOut?: boolean;
  codeFellBackToAgent?: boolean;
  agentInput?: AgentStepInput;
}): StepResult {
  const {
    runtimeContext,
    executionMode,
    definition,
    payload,
    result,
    requestedModel,
    timedOut,
    codeFellBackToAgent,
    agentInput,
  } = input;

  const errorMessage = timedOut
    ? `Workflow agent step timed out after ${runtimeContext.timeoutMs}ms`
    : result.outcome === 'done'
      ? undefined
      : result.error?.message
      || result.diagnostics?.sanitizedMessage
      || 'Workflow agent step failed';

  // When outputMode is 'structured', parse JSON fields from summary and merge into output.
  // This allows `steps.X.output.fieldName` references to work in downstream steps.
  const baseOutput: Record<string, unknown> = {
    summary: result.summary,
    outcome: result.outcome,
    role: definition.role,
    roleName: definition.binding.roleName,
    agentType: definition.binding.agentType,
    detailArtifactPath: result.detailArtifactPath ?? null,
    artifacts: result.artifacts,
    diagnostics: result.diagnostics ?? null,
    memoryAppend: result.memoryAppend ?? [],
    metrics: result.metrics,
  };

  if (agentInput?.outputMode === 'structured') {
    const parsed = extractStructuredFields(result.summary);
    if (parsed) {
      // Merge parsed fields into output, but don't overwrite system fields
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in baseOutput)) {
          baseOutput[key] = value;
        }
      }
    }
  }

  return {
    success: result.outcome === 'done',
    output: baseOutput,
    error: errorMessage,
    metadata: {
      ...buildWorkflowAgentExecutionMetadata({
        runtimeContext,
        executionMode,
        definition,
        requestedModel,
        payload,
        timedOut,
      }),
      ...(codeFellBackToAgent ? { executedVia: 'agent-fallback' as unknown as JsonValue, codeFellBack: true as unknown as JsonValue } : { executedVia: 'agent' as unknown as JsonValue }),
    },
  };
}

export async function executeWorkflowAgentStep(input: AgentStepInput): Promise<StepResult> {
  const runtimeContext = input.__runtime ?? getDefaultRuntimeContext();

  // 代码模式拦截：优先执行固定代码，失败可回退到 agent
  const hasCodeConfig = Boolean(input.code?.script?.trim() || input.code?.handler);
  const codeOutcome = await executeCodeHandler(input, runtimeContext);
  if (codeOutcome) {
    // 在结果中标记执行路径，方便用户区分
    const result = { ...codeOutcome.result };
    const meta: Record<string, unknown> = { ...(result.metadata ?? {}), executedVia: codeOutcome.executedVia as string };
    if (codeOutcome.codeError) meta.codeError = codeOutcome.codeError;
    result.metadata = meta as StepResult['metadata'];

    // 持久化代码执行结果到 session 消息，使执行记录页面能展示
    const persistSessionId = runtimeContext.sessionId;
    if (persistSessionId && !persistSessionId.startsWith('workflow:')) {
      try {
        const roleName = (input.preset ?? runtimeContext.stepId).replace(/:/g, '：');
        const sid = runtimeContext.stepId.replace(/:/g, '：');
        const outcome = result.success ? 'done' : 'failed';
        const summary = typeof result.output === 'object' && result.output
          ? (result.output as Record<string, unknown>).summary as string ?? ''
          : String(result.output ?? '');
        const errorLine = result.error ? `\n\n> 错误: ${result.error}` : '';
        const md = `<!-- step:${roleName}:${sid}:${outcome} -->\n\n${summary}${errorLine}`;
        addMessage(persistSessionId, 'assistant', JSON.stringify([{ type: 'text', text: md }]));
      } catch (e) {
        console.warn('[subagent] addMessage (code path) failed:', e instanceof Error ? e.message : e);
      }
    }

    return result;
  }
  // codeOutcome === null: 代码配置不存在，或代码失败已回退到 agent
  const codeFellBackToAgent = hasCodeConfig;

  const requestedModel = input.model || runtimeContext.requestedModel;
  const definition = resolveWorkflowAgentDefinition(input);
  const { mode: executionMode, provider: workflowProvider } = await resolveExecutionMode(runtimeContext);
  const worker = new StageWorker(executionMode === 'claude');
  const abortController = new AbortController();
  const activeExecutionKey = buildActiveExecutionKey(runtimeContext);
  const timeoutMs = typeof runtimeContext.timeoutMs === 'number' && Number.isFinite(runtimeContext.timeoutMs) && runtimeContext.timeoutMs > 0
    ? runtimeContext.timeoutMs
    : undefined;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  if (timeoutMs) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, timeoutMs);
    timeoutHandle.unref?.();
  }

  activeWorkflowAgentExecutions.set(activeExecutionKey, {
    workflowRunId: runtimeContext.workflowRunId,
    stepId: runtimeContext.stepId,
    abortController,
    worker,
    startedAt: new Date().toISOString(),
    lifecycleState: 'preparing',
    cancelRequested: false,
    role: definition.role,
    roleName: definition.binding.roleName,
    agentType: definition.binding.agentType,
    executionMode,
    requestedModel,
    allowedTools: definition.binding.allowedTools,
    capabilityTags: definition.binding.capabilityTags,
    memoryPolicy: definition.binding.memoryPolicy,
    concurrencyLimit: definition.binding.concurrencyLimit,
  });

  let payload: StageExecutionPayloadV1 | null = null;
  const traceEvents: RawTraceEvent[] = [];

  try {
    payload = await buildWorkflowAgentPayload(input, runtimeContext, definition);
    updateActiveWorkflowAgentExecution(activeExecutionKey, {
      lifecycleState: 'running',
      sessionId: payload.sessionId,
      runId: payload.runId,
      stageId: payload.stageId,
      memoryRefs: payload.memoryRefs,
      workspace: payload.workspace,
    });

    if (executionMode === 'synthetic') {
      const syntheticDelayMs = getSyntheticDelayMs();
      if (syntheticDelayMs > 0) {
        await sleepWithSignal(syntheticDelayMs, abortController.signal);
      }
    }

    const persistSessionId = runtimeContext.sessionId;
    const shouldPersist = Boolean(persistSessionId && !persistSessionId.startsWith('workflow:'));

    const result = await worker.execute(payload, {
      abortController,
      provider: workflowProvider,
      onTraceEvent: shouldPersist
        ? (event) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const type = (event as any).type;
            if (type === 'assistant' || type === 'user') {
              traceEvents.push({ type: type as 'assistant' | 'user', raw: event });
            }
          }
        : undefined,
    });

    // Write step output to shared dir so downstream agents can read it as a file.
    if (result.outcome === 'done' && result.summary?.trim()) {
      try {
        const safeRunId = sanitizePathSegment(payload.runId, 'run');
        const safeStageId = sanitizePathSegment(payload.stageId, 'step');
        const outputFileName = `${safeRunId}_${safeStageId}_output.md`;
        await writeFile(path.join(payload.workspace.sharedReadDir, outputFileName), result.summary.trim(), 'utf-8');
      } catch (writeErr) {
        console.warn('[subagent] Failed to write step output to shared dir:', writeErr instanceof Error ? writeErr.message : writeErr);
      }
    }

    // ── Phase 2: Classify outcome via lightweight SDK call ──────────────
    // Phase 1 (plain-text mode) always returns outcome:'done' when SDK succeeds.
    // We need the model to self-report whether the task actually succeeded or failed.
    // Skip Phase 2 for structured-output steps: their data IS the result —
    // LLM classification often misreads "2 items pending" as "task failed".
    let finalResult: StageExecutionResultV1 = result;
    if (result.outcome === 'done' && result.summary?.trim() && input.outputMode !== 'structured') {
      try {
        const classification = await classifyAgentOutcome({
          summary: result.summary,
          stepId: runtimeContext.stepId,
          provider: workflowProvider,
          sessionId: runtimeContext.sessionId,
          workingDirectory: runtimeContext.workingDirectory,
          abortSignal: abortController.signal,
        });
        if (classification.outcome === 'failed') {
          finalResult = {
            ...result,
            outcome: 'failed',
            error: {
              code: 'agent_reported_failure',
              message: classification.failureReason || 'Agent 报告任务未完成',
              retryable: false,
            },
          };
        }
      } catch (classifyError) {
        const err = new Error(
          `Agent 执行完成但结果分类失败: ${classifyError instanceof Error ? classifyError.message : String(classifyError)}`,
        );
        (err as Error & { agentOutput?: string }).agentOutput = result.summary?.slice(0, 2000);
        throw err;
      }
    }

    // Persist step output to session so execution history can show it
    if (shouldPersist) {
      try {
        const md = formatStepOutputMarkdown(definition.binding.roleName, runtimeContext.stepId, finalResult, traceEvents);
        if (md) {
          addMessage(persistSessionId!, 'assistant', JSON.stringify([{ type: 'text', text: md }]));
        }
      } catch (e) {
        console.warn('[subagent] addMessage failed:', e instanceof Error ? e.message : e);
      }
    }

    return toStepResult({
      runtimeContext,
      executionMode,
      definition,
      payload,
      result: finalResult,
      requestedModel,
      timedOut,
      codeFellBackToAgent,
      agentInput: input,
    });
  } catch (error) {
    const cancelled = abortController.signal.aborted || isCancelledError(error);

    // 错误 + 部分 trace 写入 session 消息，让执行历史能看到
    const errSessionId = runtimeContext.sessionId;
    if (errSessionId && !errSessionId.startsWith('workflow:') && !cancelled) {
      const presetLabel = input.preset ? ` (preset: ${input.preset})` : '';
      const timeoutLabel = timedOut ? ` — 已运行 ${Math.round((timeoutMs ?? 0) / 1000)}s` : '';
      const errMsg = timedOut
        ? `步骤「${runtimeContext.stepId}」超时${presetLabel}${timeoutLabel}`
        : (error instanceof Error ? error.message : String(error));
      try {
        const roleName = definition.binding.roleName.replace(/:/g, '：');
        const sid = runtimeContext.stepId.replace(/:/g, '：');
        const parts: string[] = [
          `<!-- step:${roleName}:${sid}:failed -->`,
          '',
          `> **失败原因：** ${errMsg}`,
        ];
        // 附加部分执行 trace（超时前 agent 做了什么）
        if (traceEvents.length > 0) {
          const trace = formatStepOutputMarkdown(roleName, sid, {
            outcome: 'failed',
            summary: '',
            error: { message: errMsg },
          } as unknown as import('@/lib/team-run/runtime-contracts').StageExecutionResultV1, traceEvents);
          // 从格式化结果中提取 trace 部分（跳过 header，已有自己的 header）
          const traceSection = trace.split('---').slice(1).join('---').trim();
          if (traceSection) {
            parts.push('', '---', '', traceSection);
          }
        }
        addMessage(
          errSessionId,
          'assistant',
          JSON.stringify([{ type: 'text', text: parts.join('\n') }]),
        );
      } catch (e) {
        console.warn('[subagent] addMessage (error path) failed:', e instanceof Error ? e.message : e);
      }
    }

    return {
      success: false,
      output: {
        summary: timedOut
          ? `步骤「${runtimeContext.stepId}」超时（${Math.round((timeoutMs ?? 0) / 60000)} 分钟），agent 执行过程中有 ${traceEvents.length} 个 trace 事件`
          : '',
        outcome: 'failed',
        role: definition.role,
        roleName: definition.binding.roleName,
        agentType: definition.binding.agentType,
        detailArtifactPath: null,
        artifacts: [],
        diagnostics: null,
        memoryAppend: [],
      },
      error: timedOut
        ? `步骤「${runtimeContext.stepId}」超时 (${Math.round((timeoutMs ?? 0) / 60000)} 分钟)${input.preset ? `，preset: ${input.preset}` : ''}，收集到 ${traceEvents.length} 个 trace 事件`
        : cancelled
          ? WORKFLOW_AGENT_CANCELLED_MESSAGE
        : (error instanceof Error ? error.message : 'Unknown error'),
      metadata: {
        ...buildWorkflowAgentExecutionMetadata({
          runtimeContext,
          executionMode,
          definition,
          requestedModel,
          payload,
          cancelled,
          timedOut,
        }),
        ...(codeFellBackToAgent
          ? { executedVia: 'agent-fallback' as unknown as JsonValue, codeFellBack: true as unknown as JsonValue }
          : { executedVia: 'agent' as unknown as JsonValue }),
      },
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    const currentExecution = activeWorkflowAgentExecutions.get(activeExecutionKey);
    if (currentExecution?.worker === worker) {
      activeWorkflowAgentExecutions.delete(activeExecutionKey);
    }
  }
}

export async function cancelWorkflowAgentExecution(input: {
  workflowRunId: string;
  stepId?: string;
}): Promise<boolean> {
  const targets = Array.from(activeWorkflowAgentExecutions.values()).filter((execution) => (
    execution.workflowRunId === input.workflowRunId
    && (input.stepId === undefined || execution.stepId === input.stepId)
  ));

  if (targets.length === 0) {
    return false;
  }

  for (const execution of targets) {
    execution.cancelRequested = true;
    execution.abortController.abort();
    await execution.worker.cancel();
  }

  return true;
}

export function listActiveWorkflowAgentExecutionSnapshots(): WorkflowAgentExecutionSnapshot[] {
  return Array.from(activeWorkflowAgentExecutions.values())
    .map((execution) => toWorkflowAgentExecutionSnapshot(execution))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
