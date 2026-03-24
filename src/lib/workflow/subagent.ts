import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildClaudeSdkRuntimeBootstrap } from '@/lib/claude/sdk-runtime';
import type {
  AgentExecutionBindingV1,
  StageExecutionPayloadV1,
  StageExecutionResultV1,
} from '@/lib/team-run/runtime-contracts';
import { StageWorker } from '@/lib/team-run/stage-worker';
import type {
  AgentStepInput,
  JsonValue,
  StepResult,
  WorkflowAgentExecutionMode,
  WorkflowAgentRole,
  WorkflowStepRuntimeContext,
} from './types';
import { getWorkflowExecutionRoleConfig } from './agent-config';
import { buildPromptCapabilitiesSystemPrompt } from '@/lib/capability/prompt-loader';

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

function resolveWorkflowAgentDefinition(input: AgentStepInput): ResolvedWorkflowAgentDefinition {
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

function resolveExecutionMode(runtimeContext?: WorkflowStepRuntimeContext): Exclude<WorkflowAgentExecutionMode, 'auto'> {
  const configuredMode = parseExecutionMode(process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE);
  if (configuredMode === 'claude' || configuredMode === 'synthetic') {
    return configuredMode;
  }

  const runtimeBootstrap = buildClaudeSdkRuntimeBootstrap({
    sessionId: runtimeContext?.sessionId,
  });
  const hasAuthToken = Boolean(
    runtimeBootstrap.env.ANTHROPIC_AUTH_TOKEN || runtimeBootstrap.env.ANTHROPIC_API_KEY,
  );

  return hasAuthToken ? 'claude' : 'synthetic';
}

async function prepareWorkflowAgentWorkspace(runtimeContext: WorkflowStepRuntimeContext): Promise<StageExecutionPayloadV1['workspace']> {
  const safeRunId = sanitizePathSegment(runtimeContext.workflowRunId, 'workflow-run');
  const safeStepId = sanitizePathSegment(runtimeContext.stepId, 'agent-step');
  const sessionWorkspace = runtimeContext.workingDirectory?.trim() || process.cwd();
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
  const workspace = await prepareWorkflowAgentWorkspace(runtimeContext);
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
      expectedOutcome: 'Return a structured text result for the assigned workflow step prompt. Do not declare file artifacts for workflow agent steps.',
    },
    stage: {
      title: runtimeContext.stepId,
      description: input.prompt,
      acceptanceCriteria: [
        `Address the prompt assigned to workflow step ${runtimeContext.stepId}.`,
        'Produce a concise summary that downstream workflow steps can consume.',
        'Return summary text only; keep the artifacts array empty for workflow agent steps.',
        ...(dependencies.length > 0
          ? ['Use the provided dependency context to produce an integrated result; do not ignore branch outputs.']
          : []),
      ],
      ...(input.outputMode ? { responseMode: input.outputMode } : {}),
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
      },
    },
    dependencies,
    memoryRefs: {
      taskMemoryId: `workflow-task-memory:${runtimeContext.workflowRunId}`,
      plannerMemoryId: `workflow-planner-memory:${runtimeContext.workflowRunId}`,
      agentMemoryId: `workflow-agent-memory:${runtimeContext.stepId}`,
    },
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

function toStepResult(input: {
  runtimeContext: WorkflowStepRuntimeContext;
  executionMode: Exclude<WorkflowAgentExecutionMode, 'auto'>;
  definition: ResolvedWorkflowAgentDefinition;
  payload: StageExecutionPayloadV1;
  result: StageExecutionResultV1;
  requestedModel?: string;
  timedOut?: boolean;
}): StepResult {
  const {
    runtimeContext,
    executionMode,
    definition,
    payload,
    result,
    requestedModel,
    timedOut,
  } = input;

  const errorMessage = timedOut
    ? `Workflow agent step timed out after ${runtimeContext.timeoutMs}ms`
    : result.outcome === 'done'
      ? undefined
      : result.error?.message
      || result.diagnostics?.sanitizedMessage
      || 'Workflow agent step failed';

  return {
    success: result.outcome === 'done',
    output: {
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
    },
    error: errorMessage,
    metadata: buildWorkflowAgentExecutionMetadata({
      runtimeContext,
      executionMode,
      definition,
      requestedModel,
      payload,
      timedOut,
    }),
  };
}

export async function executeWorkflowAgentStep(input: AgentStepInput): Promise<StepResult> {
  const runtimeContext = input.__runtime ?? getDefaultRuntimeContext();
  const requestedModel = input.model || runtimeContext.requestedModel;
  const definition = resolveWorkflowAgentDefinition(input);
  const executionMode = resolveExecutionMode(runtimeContext);
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

    const result = await worker.execute(payload, { abortController });

    return toStepResult({
      runtimeContext,
      executionMode,
      definition,
      payload,
      result,
      requestedModel,
      timedOut,
    });
  } catch (error) {
    const cancelled = abortController.signal.aborted || isCancelledError(error);

    return {
      success: false,
      output: {
        summary: '',
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
        ? `Workflow agent step timed out after ${timeoutMs}ms`
        : cancelled
          ? WORKFLOW_AGENT_CANCELLED_MESSAGE
        : (error instanceof Error ? error.message : 'Unknown error'),
      metadata: buildWorkflowAgentExecutionMetadata({
        runtimeContext,
        executionMode,
        definition,
        requestedModel,
        payload,
        cancelled,
        timedOut,
      }),
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
