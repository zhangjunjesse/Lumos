// ==========================================
// Database Models
// ==========================================

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model: string;
  requested_model: string;
  resolved_model: string;
  system_prompt: string;
  working_directory: string;
  sdk_session_id: string; // Claude Agent SDK session ID for resume
  project_name: string;
  status: 'active' | 'archived';
  mode?: 'code' | 'plan' | 'ask';
  needs_approval?: boolean;
  provider_name: string;
  provider_id: string;
  sdk_cwd: string;
  runtime_status: string;
  runtime_updated_at: string;
  runtime_error: string;
  folder: string;
}

// ==========================================
// Project / File Types
// ==========================================

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  extension?: string;
}

export interface FilePreview {
  path: string;
  content: string;
  language: string;
  line_count: number;
}

// ==========================================
// Task Types
// ==========================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type TaskKind = 'manual' | 'team_plan';

export interface TaskItem {
  id: string;
  session_id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  task_kind?: TaskKind;
  team_plan_json?: string | null;
  team_approval_status?: TeamPlanApprovalStatus | null;
  current_run_id?: string | null;
  final_result_summary?: string;
  source_message_id?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  last_action_at?: string | null;
  created_at: string;
  updated_at: string;
}

export const TEAM_PLAN_TASK_KIND = 'team-plan' as const;
export const TEAM_PLAN_BLOCK_KIND = 'lumos-team-plan' as const;

export type TeamPlanApprovalStatus = 'pending' | 'approved' | 'rejected';
export type TeamPlanActivationReason = 'user_requested' | 'main_agent_suggested';
export type TeamPlanRoleKind = 'main_agent' | 'orchestrator' | 'lead' | 'worker';
export type TeamAgentPresetRoleKind = Exclude<TeamPlanRoleKind, 'main_agent'>;

export interface TeamPlanRole {
  id: string;
  name: string;
  kind: TeamPlanRoleKind;
  responsibility: string;
  parentRoleId?: string;
}

export interface TeamPlanStep {
  id: string;
  title: string;
  ownerRoleId: string;
  summary: string;
  dependsOn: string[];
  expectedOutput: string;
}

export type TeamRunStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'summarizing'
  | 'done'
  | 'failed';

export interface TeamRunStage {
  id: string;
  planTaskId: string;
  title: string;
  ownerRoleId: string;
  dependsOn: string[];
  expectedOutput: string;
  status: TeamRunStatus;
  latestResult?: string;
  updatedAt?: string | null;
}

export interface TeamRunBudget {
  maxParallelWorkers: number;
  maxRetriesPerTask: number;
  maxRunMinutes: number;
}

export type TeamRunContextSource = 'auto' | 'manual';

export interface TeamRunContext {
  summary: string;
  finalSummary: string;
  summarySource?: TeamRunContextSource;
  finalSummarySource?: TeamRunContextSource;
  blockedReason?: string;
  lastError?: string;
  publishedAt?: string | null;
}

export interface TeamRun {
  status: TeamRunStatus;
  hierarchy: TeamPlanRoleKind[];
  maxDepth: 4;
  lockScope: 'session_runtime';
  budget: TeamRunBudget;
  context: TeamRunContext;
  resumeCount: number;
  phases: TeamRunStage[];
  pauseRequestedAt?: string | null;
  cancelRequestedAt?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastUpdatedAt?: string | null;
}

export interface TeamPlan {
  version: 1;
  summary: string;
  activationReason: TeamPlanActivationReason;
  userGoal: string;
  roles: TeamPlanRole[];
  tasks: TeamPlanStep[];
  expectedOutcome: string;
  risks?: string[];
  confirmationPrompt?: string;
}

export interface TeamPlanTaskRecord {
  kind: typeof TEAM_PLAN_TASK_KIND;
  plan: TeamPlan;
  approvalStatus: TeamPlanApprovalStatus;
  run: TeamRun;
  sourceMessageId?: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  lastActionAt?: string | null;
}

export const MAIN_AGENT_AGENT_PRESET_KIND = 'main-agent-agent-preset' as const;
export const MAIN_AGENT_TEAM_TEMPLATE_KIND = 'main-agent-team-template' as const;

export interface AgentPresetToolPermissions {
  read: boolean;
  write: boolean;
  exec: boolean;
}

export interface AgentPresetRecord {
  kind: typeof MAIN_AGENT_AGENT_PRESET_KIND;
  version: 1;
  name: string;
  roleKind: TeamAgentPresetRoleKind;
  responsibility: string;
  systemPrompt: string;
  description?: string;
  collaborationStyle?: string;
  outputContract?: string;
  preferredModel?: string;
  mcpServers?: string[];
  toolPermissions?: AgentPresetToolPermissions;
}

export interface TeamTemplateRecord {
  kind: typeof MAIN_AGENT_TEAM_TEMPLATE_KIND;
  version: 1;
  name: string;
  summary: string;
  agentPresetIds: string[];
  activationHint?: string;
  defaultGoal?: string;
  defaultOutcome?: string;
  notes?: string;
}

export type AgentPresetSource = 'user';
export type TeamTemplateSource = 'user';

export interface AgentPresetDirectoryItem {
  id: string;
  source: AgentPresetSource;
  name: string;
  roleKind: TeamAgentPresetRoleKind;
  responsibility: string;
  systemPrompt: string;
  updatedAt: string;
  description?: string;
  collaborationStyle?: string;
  outputContract?: string;
  preferredModel?: string;
  mcpServers?: string[];
  toolPermissions?: AgentPresetToolPermissions;
  templateCount: number;
}

export interface TeamTemplateDirectoryItem {
  id: string;
  source: TeamTemplateSource;
  name: string;
  summary: string;
  agentPresetIds: string[];
  agentPresetNames: string[];
  updatedAt: string;
  activationHint?: string;
  defaultGoal?: string;
  defaultOutcome?: string;
  notes?: string;
}

export interface TeamWorkspaceProjectionV1 {
  projectionVersion: 1;
  taskId: string;
  runId?: string;
  approvalStatus: TeamPlanApprovalStatus;
  plan: TeamPlan;
  run: TeamRun;
}

export interface TeamBannerHistoryItemV1 {
  taskId: string;
  runId?: string;
  title: string;
  approvalStatus: TeamPlanApprovalStatus;
  runStatus: TeamRunStatus;
  currentStageTitle?: string;
  currentExecutorName?: string;
  taskPath: string;
  teamPath: string;
}

export interface TeamBannerProjectionV1 {
  projectionVersion: number;
  sessionId: string;
  taskId: string;
  runId?: string;
  approvalStatus: TeamPlanApprovalStatus;
  runStatus: TeamRunStatus;
  title: string;
  summary: string;
  completedStageCount: number;
  totalStageCount: number;
  currentStageTitle?: string;
  currentExecutorName?: string;
  taskPath: string;
  teamPath: string;
  historyCount: number;
  recent: TeamBannerHistoryItemV1[];
  workspace?: TeamWorkspaceProjectionV1;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTeamPlanRole(value: unknown): TeamPlanRole | null {
  if (!isObjectRecord(value)) return null;
  if (
    !isNonEmptyString(value.id)
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.kind)
    || !isNonEmptyString(value.responsibility)
  ) {
    return null;
  }

  const kind = value.kind.trim() as TeamPlanRoleKind;
  if (!['main_agent', 'orchestrator', 'lead', 'worker'].includes(kind)) {
    return null;
  }

  return {
    id: value.id.trim(),
    name: value.name.trim(),
    kind,
    responsibility: value.responsibility.trim(),
    ...(isNonEmptyString(value.parentRoleId) ? { parentRoleId: value.parentRoleId.trim() } : {}),
  };
}

function parseTeamPlanStep(value: unknown): TeamPlanStep | null {
  if (!isObjectRecord(value)) return null;
  if (
    !isNonEmptyString(value.id)
    || !isNonEmptyString(value.title)
    || !isNonEmptyString(value.ownerRoleId)
    || !isNonEmptyString(value.summary)
    || !isNonEmptyString(value.expectedOutput)
  ) {
    return null;
  }

  const dependsOn = Array.isArray(value.dependsOn)
    ? value.dependsOn.filter(isNonEmptyString).map((item) => item.trim())
    : [];

  return {
    id: value.id.trim(),
    title: value.title.trim(),
    ownerRoleId: value.ownerRoleId.trim(),
    summary: value.summary.trim(),
    dependsOn,
    expectedOutput: value.expectedOutput.trim(),
  };
}

export function parseTeamPlan(value: unknown): TeamPlan | null {
  if (!isObjectRecord(value)) return null;
  if (
    !isNonEmptyString(value.summary)
    || !isNonEmptyString(value.activationReason)
    || !isNonEmptyString(value.userGoal)
    || !isNonEmptyString(value.expectedOutcome)
  ) {
    return null;
  }

  const activationReason = value.activationReason.trim() as TeamPlanActivationReason;
  if (!['user_requested', 'main_agent_suggested'].includes(activationReason)) {
    return null;
  }

  const roles = Array.isArray(value.roles)
    ? value.roles.map(parseTeamPlanRole).filter((role): role is TeamPlanRole => role !== null)
    : [];
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map(parseTeamPlanStep).filter((task): task is TeamPlanStep => task !== null)
    : [];

  if (roles.length === 0 || tasks.length === 0) {
    return null;
  }

  return {
    version: 1,
    summary: value.summary.trim(),
    activationReason,
    userGoal: value.userGoal.trim(),
    roles,
    tasks,
    expectedOutcome: value.expectedOutcome.trim(),
    ...(Array.isArray(value.risks)
      ? { risks: value.risks.filter(isNonEmptyString).map((risk) => risk.trim()) }
      : {}),
    ...(isNonEmptyString(value.confirmationPrompt)
      ? { confirmationPrompt: value.confirmationPrompt.trim() }
      : {}),
  };
}

function isTeamAgentPresetRoleKind(value: unknown): value is TeamAgentPresetRoleKind {
  return typeof value === 'string' && ['orchestrator', 'lead', 'worker'].includes(value);
}

function isTeamRunStatus(value: unknown): value is TeamRunStatus {
  return typeof value === 'string' && [
    'pending',
    'ready',
    'running',
    'waiting',
    'blocked',
    'paused',
    'cancelling',
    'cancelled',
    'summarizing',
    'done',
    'failed',
  ].includes(value);
}

export function createTeamRunSkeleton(plan: TeamPlan): TeamRun {
  const phases: TeamRunStage[] = plan.tasks.map((task) => ({
    id: `phase-${task.id}`,
    planTaskId: task.id,
    title: task.title,
    ownerRoleId: task.ownerRoleId,
    dependsOn: task.dependsOn,
    expectedOutput: task.expectedOutput,
    status: task.dependsOn.length > 0 ? 'pending' : 'ready',
  }));

  return {
    status: 'pending',
    hierarchy: ['main_agent', 'orchestrator', 'lead', 'worker'],
    maxDepth: 4,
    lockScope: 'session_runtime',
    budget: {
      maxParallelWorkers: 3,
      maxRetriesPerTask: 1,
      maxRunMinutes: 120,
    },
    context: {
      summary: '',
      finalSummary: '',
      summarySource: 'auto',
      finalSummarySource: 'auto',
      publishedAt: null,
    },
    resumeCount: 0,
    phases,
    createdAt: null,
    startedAt: null,
    completedAt: null,
    lastUpdatedAt: null,
  };
}

function parseTeamRunStage(value: unknown): TeamRunStage | null {
  if (!isObjectRecord(value)) return null;
  if (
    !isNonEmptyString(value.id)
    || !isNonEmptyString(value.planTaskId)
    || !isNonEmptyString(value.title)
    || !isNonEmptyString(value.ownerRoleId)
    || !isNonEmptyString(value.expectedOutput)
    || !isTeamRunStatus(value.status)
  ) {
    return null;
  }

  return {
    id: value.id.trim(),
    planTaskId: value.planTaskId.trim(),
    title: value.title.trim(),
    ownerRoleId: value.ownerRoleId.trim(),
    dependsOn: Array.isArray(value.dependsOn)
      ? value.dependsOn.filter(isNonEmptyString).map((item) => item.trim())
      : [],
    expectedOutput: value.expectedOutput.trim(),
    status: value.status,
    ...(isNonEmptyString(value.latestResult) ? { latestResult: value.latestResult.trim() } : {}),
    updatedAt: isNonEmptyString(value.updatedAt) ? value.updatedAt.trim() : null,
  };
}

function parseTeamRun(value: unknown, plan: TeamPlan): TeamRun {
  if (!isObjectRecord(value) || !isTeamRunStatus(value.status)) {
    return createTeamRunSkeleton(plan);
  }

  const base = createTeamRunSkeleton(plan);
  const hierarchy = Array.isArray(value.hierarchy)
    ? value.hierarchy.filter((kind): kind is TeamPlanRoleKind =>
        typeof kind === 'string' && ['main_agent', 'orchestrator', 'lead', 'worker'].includes(kind),
      )
    : base.hierarchy;
  const phases = Array.isArray(value.phases)
    ? value.phases.map(parseTeamRunStage).filter((phase): phase is TeamRunStage => phase !== null)
    : base.phases;
  const budget = isObjectRecord(value.budget)
    ? {
        maxParallelWorkers: typeof value.budget.maxParallelWorkers === 'number' ? value.budget.maxParallelWorkers : base.budget.maxParallelWorkers,
        maxRetriesPerTask: typeof value.budget.maxRetriesPerTask === 'number' ? value.budget.maxRetriesPerTask : base.budget.maxRetriesPerTask,
        maxRunMinutes: typeof value.budget.maxRunMinutes === 'number' ? value.budget.maxRunMinutes : base.budget.maxRunMinutes,
      }
    : base.budget;
  const context = isObjectRecord(value.context)
    ? {
        summary: isNonEmptyString(value.context.summary) ? value.context.summary.trim() : '',
        finalSummary: isNonEmptyString(value.context.finalSummary) ? value.context.finalSummary.trim() : '',
        summarySource: value.context.summarySource === 'manual' ? 'manual' as const : 'auto' as const,
        finalSummarySource: value.context.finalSummarySource === 'manual' ? 'manual' as const : 'auto' as const,
        ...(isNonEmptyString(value.context.blockedReason) ? { blockedReason: value.context.blockedReason.trim() } : {}),
        ...(isNonEmptyString(value.context.lastError) ? { lastError: value.context.lastError.trim() } : {}),
        publishedAt: isNonEmptyString(value.context.publishedAt) ? value.context.publishedAt.trim() : null,
      }
    : base.context;

  return {
    status: value.status,
    hierarchy: hierarchy.length > 0 ? hierarchy : base.hierarchy,
    maxDepth: 4,
    lockScope: 'session_runtime',
    budget,
    context,
    resumeCount: typeof value.resumeCount === 'number' ? value.resumeCount : 0,
    phases: phases.length > 0 ? phases : base.phases,
    pauseRequestedAt: isNonEmptyString(value.pauseRequestedAt) ? value.pauseRequestedAt.trim() : null,
    cancelRequestedAt: isNonEmptyString(value.cancelRequestedAt) ? value.cancelRequestedAt.trim() : null,
    createdAt: isNonEmptyString(value.createdAt) ? value.createdAt.trim() : null,
    startedAt: isNonEmptyString(value.startedAt) ? value.startedAt.trim() : null,
    completedAt: isNonEmptyString(value.completedAt) ? value.completedAt.trim() : null,
    lastUpdatedAt: isNonEmptyString(value.lastUpdatedAt) ? value.lastUpdatedAt.trim() : null,
  };
}

export function parseTeamPlanTaskRecord(description: string | null | undefined): TeamPlanTaskRecord | null {
  if (!description) return null;

  try {
    const parsed = JSON.parse(description) as unknown;
    if (!isObjectRecord(parsed) || parsed.kind !== TEAM_PLAN_TASK_KIND) {
      return null;
    }

    const plan = parseTeamPlan(parsed.plan);
    if (!plan) return null;

    const approvalStatus = isNonEmptyString(parsed.approvalStatus)
      ? parsed.approvalStatus.trim() as TeamPlanApprovalStatus
      : 'pending';

    if (!['pending', 'approved', 'rejected'].includes(approvalStatus)) {
      return null;
    }

    return {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus,
      run: parseTeamRun(parsed.run, plan),
      ...(isNonEmptyString(parsed.sourceMessageId) ? { sourceMessageId: parsed.sourceMessageId.trim() } : {}),
      approvedAt: isNonEmptyString(parsed.approvedAt) ? parsed.approvedAt.trim() : null,
      rejectedAt: isNonEmptyString(parsed.rejectedAt) ? parsed.rejectedAt.trim() : null,
      lastActionAt: isNonEmptyString(parsed.lastActionAt) ? parsed.lastActionAt.trim() : null,
    };
  } catch {
    return null;
  }
}

export function serializeTeamPlanTaskRecord(record: TeamPlanTaskRecord): string {
  return JSON.stringify(record);
}

export function parseAgentPresetRecord(value: unknown): AgentPresetRecord | null {
  if (!isObjectRecord(value)) return null;
  if (
    value.kind !== MAIN_AGENT_AGENT_PRESET_KIND
    || !isNonEmptyString(value.name)
    || !isTeamAgentPresetRoleKind(value.roleKind)
    || !isNonEmptyString(value.responsibility)
    || !isNonEmptyString(value.systemPrompt)
  ) {
    return null;
  }

  const mcpServers = Array.isArray(value.mcpServers)
    ? value.mcpServers.filter(isNonEmptyString)
    : undefined;

  const toolPermissions = isObjectRecord(value.toolPermissions)
    ? {
        read: Boolean(value.toolPermissions.read),
        write: Boolean(value.toolPermissions.write),
        exec: Boolean(value.toolPermissions.exec),
      }
    : undefined;

  return {
    kind: MAIN_AGENT_AGENT_PRESET_KIND,
    version: 1,
    name: value.name.trim(),
    roleKind: value.roleKind,
    responsibility: value.responsibility.trim(),
    systemPrompt: value.systemPrompt.trim(),
    ...(isNonEmptyString(value.description) ? { description: value.description.trim() } : {}),
    ...(isNonEmptyString(value.collaborationStyle) ? { collaborationStyle: value.collaborationStyle.trim() } : {}),
    ...(isNonEmptyString(value.outputContract) ? { outputContract: value.outputContract.trim() } : {}),
    ...(isNonEmptyString(value.preferredModel) ? { preferredModel: value.preferredModel.trim() } : {}),
    ...(mcpServers && mcpServers.length > 0 ? { mcpServers } : {}),
    ...(toolPermissions ? { toolPermissions } : {}),
  };
}

export function parseTeamTemplateRecord(value: unknown): TeamTemplateRecord | null {
  if (!isObjectRecord(value)) return null;
  if (
    value.kind !== MAIN_AGENT_TEAM_TEMPLATE_KIND
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.summary)
  ) {
    return null;
  }

  const agentPresetIds = Array.isArray(value.agentPresetIds)
    ? value.agentPresetIds.filter(isNonEmptyString).map((item) => item.trim())
    : [];

  if (agentPresetIds.length === 0) {
    return null;
  }

  return {
    kind: MAIN_AGENT_TEAM_TEMPLATE_KIND,
    version: 1,
    name: value.name.trim(),
    summary: value.summary.trim(),
    agentPresetIds,
    ...(isNonEmptyString(value.activationHint) ? { activationHint: value.activationHint.trim() } : {}),
    ...(isNonEmptyString(value.defaultGoal) ? { defaultGoal: value.defaultGoal.trim() } : {}),
    ...(isNonEmptyString(value.defaultOutcome) ? { defaultOutcome: value.defaultOutcome.trim() } : {}),
    ...(isNonEmptyString(value.notes) ? { notes: value.notes.trim() } : {}),
  };
}

export function parseTeamPlanBlock(text: string): { beforeText: string; plan: TeamPlan; afterText: string } | null {
  const escapedKind = TEAM_PLAN_BLOCK_KIND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\`\`\`${escapedKind}\\s*\\n?([\\s\\S]*?)\\n?\\s*\`\`\``);
  const match = text.match(regex);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    const plan = parseTeamPlan(parsed);
    if (!plan) return null;

    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return { beforeText, plan, afterText };
  } catch {
    return null;
  }
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string; // JSON string of MessageContentBlock[] for structured content
  created_at: string;
  token_usage: string | null; // JSON string of TokenUsage
}

// Structured message content blocks (stored as JSON in messages.content)
export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; summary: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'code'; language: string; code: string };

// Helper to parse message content - returns blocks or wraps plain text
export function parseMessageContent(content: string): MessageContentBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON, treat as plain text
  }
  return [{ type: 'text', text: content }];
}

export interface Setting {
  id: number;
  key: string;
  value: string;
}

// ==========================================
// API Provider Types
// ==========================================

export interface ApiProvider {
  id: string;
  name: string;
  provider_type: string; // 'anthropic' | 'openrouter' | 'bedrock' | 'vertex' | 'custom'
  api_protocol: ProviderApiProtocol;
  capabilities: string; // JSON string of ProviderCapability[]
  provider_origin: ProviderOrigin;
  auth_mode: ProviderAuthMode;
  base_url: string;
  api_key: string;
  is_active: number; // SQLite boolean: 0 or 1
  sort_order: number;
  extra_env: string; // JSON string of Record<string, string>
  model_catalog: string; // JSON string of ProviderModelOption[]
  model_catalog_source: ProviderModelCatalogSource;
  model_catalog_updated_at: string | null;
  notes: string;
  is_builtin: number; // SQLite boolean: 0 or 1, only one provider can be 1
  user_modified: number; // SQLite boolean: 0 or 1, tracks if builtin provider was modified
  created_at: string;
  updated_at: string;
}

export type ProviderApiProtocol = 'anthropic-messages' | 'openai-compatible';
export type ProviderCapability = 'agent-chat' | 'text-gen' | 'image-gen' | 'embedding';
export type ProviderOrigin = 'system' | 'preset' | 'custom';
export type ProviderAuthMode = 'api_key' | 'local_auth';

export type ProviderModelCatalogSource = 'default' | 'manual' | 'detected';

export interface ProviderModelOption {
  value: string;
  label: string;
}

export interface ProviderModelGroup {
  provider_id: string;       // provider DB id
  provider_name: string;
  provider_type: string;
  models: ProviderModelOption[];
  model_catalog_source: ProviderModelCatalogSource;
  model_catalog_updated_at: string | null;
  model_catalog_uses_default: boolean;
}

export interface CreateProviderRequest {
  name: string;
  provider_type?: string;
  api_protocol?: ProviderApiProtocol;
  capabilities?: string;
  provider_origin?: ProviderOrigin;
  auth_mode?: ProviderAuthMode;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  model_catalog?: string;
  model_catalog_source?: ProviderModelCatalogSource;
  model_catalog_updated_at?: string | null;
  notes?: string;
}

export interface UpdateProviderRequest {
  name?: string;
  provider_type?: string;
  api_protocol?: ProviderApiProtocol;
  capabilities?: string;
  provider_origin?: ProviderOrigin;
  auth_mode?: ProviderAuthMode;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  model_catalog?: string;
  model_catalog_source?: ProviderModelCatalogSource;
  model_catalog_updated_at?: string | null;
  notes?: string;
  sort_order?: number;
  is_active?: number;
}

export interface ProvidersResponse {
  providers: ApiProvider[];
  default_provider_id?: string;
}

export interface ProviderResponse {
  provider: ApiProvider;
}

export type ProviderPresetModule = 'chat' | 'knowledge' | 'workflow' | 'image';

export interface ProviderPreset {
  id: string;
  name: string;
  description: string;
  provider_type: string;
  api_protocol: ProviderApiProtocol;
  capabilities: ProviderCapability[];
  provider_origin: ProviderOrigin;
  auth_mode: ProviderAuthMode;
  base_url: string;
  notes?: string;
  tags?: string[];
  supported_modules?: ProviderPresetModule[];
  requires_base_url?: boolean;
  default_models?: ProviderModelOption[];
}

// ==========================================
// Token Usage
// ==========================================

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
}

// ==========================================
// API Request Types
// ==========================================

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  provider_id?: string;
  system_prompt?: string;
  working_directory?: string;
  mode?: string;
  entry?: 'chat' | 'main-agent';
  folder?: string;
}

export interface ChatKnowledgeOptions {
  enabled: boolean;
  tagIds: string[];
}

export interface SendMessageRequest {
  session_id: string;
  content: string;
  model?: string;
  mode?: string;
  provider_id?: string;
  knowledge_enabled?: boolean;
  knowledge_tag_ids?: string[];
}

export interface UpdateMCPConfigRequest {
  mcpServers: Record<string, MCPServerConfig>;
}

export interface AddMCPServerRequest {
  name: string;
  server: MCPServerConfig;
}

export interface UpdateSettingsRequest {
  settings: SettingsMap;
}

// --- File API ---

export interface FileTreeRequest {
  dir: string;
  depth?: number; // default 3
}

export interface FilePreviewRequest {
  path: string;
  maxLines?: number; // default 200
}

// --- Skill API ---

export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  prompt: string;
}

export interface UpdateSkillRequest {
  description?: string;
  prompt?: string;
  enabled?: boolean;
}

// ==========================================
// API Response Types
// ==========================================

export interface SessionsResponse {
  sessions: ChatSession[];
}

export interface SessionResponse {
  session: ChatSession;
}

export interface MessagesResponse {
  messages: Message[];
  hasMore?: boolean;
}

export interface SuccessResponse {
  success: true;
}

export interface ErrorResponse {
  error: string;
}

export interface SettingsResponse {
  settings: SettingsMap;
}

export interface PluginsResponse {
  plugins: PluginInfo[];
}

export interface MCPConfigResponse {
  mcpServers: Record<string, MCPServerConfig>;
}

// --- File API Responses ---

export interface FileTreeResponse {
  tree: FileTreeNode[];
  root: string;
}

export interface FilePreviewResponse {
  preview: FilePreview;
}

// --- Skill API Responses ---

export interface SkillsResponse {
  skills: SkillDefinition[];
}

export interface SkillResponse {
  skill: SkillDefinition;
}

// --- Task API Responses ---

export interface TeamBannerProjectionResponseV1 {
  banner: TeamBannerProjectionV1 | null;
}

// ==========================================
// SSE Event Types (streaming chat response)
// ==========================================

export type SSEEventType =
  | 'text'               // text content delta
  | 'tool_use_summary'   // summarized reasoning/tool-use progress
  | 'tool_use'           // tool invocation info
  | 'tool_result'        // tool execution result
  | 'tool_output'        // streaming tool output (stderr from SDK process)
  | 'tool_timeout'       // tool execution timed out
  | 'status'             // status update (compacting, etc.)
  | 'result'             // final result with usage stats
  | 'error'              // error occurred
  | 'permission_request' // permission approval needed
  | 'mode_changed'       // SDK permission mode changed (e.g. plan → code)
  | 'memory_captured'    // explicit memory captured from user input
  | 'memory_conflict'    // memory conflict detected
  | 'done';              // stream complete

export interface SSEEvent {
  type: SSEEventType;
  data: string;
}

// ==========================================
// Permission Types
// ==========================================

export interface PermissionSuggestion {
  type: string;
  rules?: Array<{ toolName: string; ruleContent?: string }>;
  behavior?: string;
  destination?: string;
}

export interface PermissionRequestEvent {
  permissionRequestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions?: PermissionSuggestion[];
  decisionReason?: string;
  blockedPath?: string;
  toolUseId: string;
  description?: string;
}

export interface PermissionResponseRequest {
  permissionRequestId: string;
  decision: {
    behavior: 'allow';
    updatedPermissions?: PermissionSuggestion[];
    updatedInput?: Record<string, unknown>;
  } | {
    behavior: 'deny';
    message?: string;
  };
}

// ==========================================
// Plugin / MCP Types
// ==========================================

export interface PluginInfo {
  name: string;
  description: string;
  enabled: boolean;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  headers?: Record<string, string>;
  description?: string;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// Backward-compatible alias
export type MCPServer = MCPServerConfig;

// ==========================================
// Settings Types
// ==========================================

export interface SettingsMap {
  [key: string]: string;
}

// ==========================================
// Reference Image Types (for image generation)
// ==========================================

export interface ReferenceImage {
  mimeType: string;
  data?: string;       // base64 (user upload)
  localPath?: string;  // file path (generated result)
}

// ==========================================
// File Attachment Types
// ==========================================

export interface FileAttachment {
  id: string;
  name: string;
  type: string; // MIME type
  size: number;
  data: string; // base64 encoded content
  filePath?: string; // persisted disk path (for messages reloaded from DB)
}

// Check if a MIME type is an image
export function isImageFile(type: string): boolean {
  return type.startsWith('image/');
}

// Format bytes into human-readable size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==========================================
// Claude Client Types
// ==========================================

// ==========================================
// Batch Image Generation Types
// ==========================================

export type MediaJobStatus = 'draft' | 'planning' | 'planned' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type MediaJobItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface MediaJob {
  id: string;
  session_id: string | null;
  status: MediaJobStatus;
  doc_paths: string;       // JSON array of file paths
  style_prompt: string;
  batch_config: string;    // JSON of BatchConfig
  total_items: number;
  completed_items: number;
  failed_items: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MediaJobItem {
  id: string;
  job_id: string;
  idx: number;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  model: string;
  tags: string;            // JSON array of strings
  source_refs: string;     // JSON array of strings
  status: MediaJobItemStatus;
  retry_count: number;
  result_media_generation_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaContextEvent {
  id: string;
  session_id: string;
  job_id: string;
  payload: string;         // JSON object
  sync_mode: 'manual' | 'auto_batch';
  synced_at: string | null;
  created_at: string;
}

export interface BatchConfig {
  concurrency: number;     // max parallel image generations (default: 2)
  maxRetries: number;      // max retry attempts per item (default: 2)
  retryDelayMs: number;    // base delay for exponential backoff (default: 2000)
}

export interface PlannerItem {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  tags: string[];
  sourceRefs: string[];
}

export interface PlannerOutput {
  summary: string;
  items: PlannerItem[];
}

export type JobProgressEventType =
  | 'item_started'
  | 'item_completed'
  | 'item_failed'
  | 'item_retry'
  | 'job_completed'
  | 'job_paused'
  | 'job_cancelled';

export interface JobProgressEvent {
  type: JobProgressEventType;
  jobId: string;
  itemId?: string;
  itemIdx?: number;
  progress: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
  };
  error?: string;
  retryCount?: number;
  mediaGenerationId?: string;
  timestamp: string;
}

// --- Batch Image Gen API Types ---

export interface CreateMediaJobRequest {
  sessionId?: string;
  items: Array<{
    prompt: string;
    aspectRatio?: string;
    imageSize?: string;
    model?: string;
    tags?: string[];
    sourceRefs?: string[];
  }>;
  batchConfig?: Partial<BatchConfig>;
  stylePrompt?: string;
  docPaths?: string[];
}

export interface PlanMediaJobRequest {
  docPaths?: string[];
  docContent?: string;
  stylePrompt: string;
  sessionId?: string;
  count?: number;
}

export interface UpdateMediaJobItemsRequest {
  items: Array<{
    id: string;
    prompt?: string;
    aspectRatio?: string;
    imageSize?: string;
    tags?: string[];
  }>;
}

export interface ClaudeStreamOptions {
  prompt: string;
  /** Raw user prompt before any app-side context expansion (used by memory hooks). */
  rawPrompt?: string;
  sessionId: string;
  sdkSessionId?: string; // SDK session ID for resuming conversations
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  /** In-process MCP servers (created via createSdkMcpServer). Merged into mcpServers at query time. */
  inProcessMcpServers?: Record<string, import('@anthropic-ai/claude-agent-sdk').McpSdkServerConfigWithInstance>;
  abortController?: AbortController;
  permissionMode?: string;
  files?: FileAttachment[];
  toolTimeoutSeconds?: number;
  provider?: ApiProvider;
  knowledgeOptions?: ChatKnowledgeOptions;
  /** Recent conversation history from DB — used as fallback context when SDK resume is unavailable or fails */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onRuntimeStatusChange?: (status: string) => void;
}

export * from './deepsearch';
