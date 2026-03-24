import { z } from 'zod';
import { getSetting, setSetting } from '@/lib/db/sessions';
import type { AgentExecutionBindingV1 } from '@/lib/team-run/runtime-contracts';
import type { WorkflowAgentRole } from './types';

export const WORKFLOW_CONFIGURABLE_AGENT_ROLES = [
  'scheduling',
  'worker',
  'researcher',
  'coder',
  'integration',
] as const;

export type WorkflowConfigurableAgentRole = (typeof WORKFLOW_CONFIGURABLE_AGENT_ROLES)[number];
export type WorkflowRuntimeCapability = AgentExecutionBindingV1['allowedTools'][number];

export function isWorkflowConfigurableAgentRole(value: string): value is WorkflowConfigurableAgentRole {
  return (WORKFLOW_CONFIGURABLE_AGENT_ROLES as readonly string[]).includes(value);
}

export interface WorkflowPlanningRoleConfig {
  role: 'scheduling';
  title: string;
  shortLabel: string;
  description: string;
  roleName: string;
  agentType: string;
  systemPrompt: string;
  tools: string[];
  notes: string[];
  plannerTimeoutMs: number;
  plannerMaxRetries: number;
}

export interface WorkflowExecutionRoleConfig {
  role: WorkflowAgentRole;
  title: string;
  shortLabel: string;
  description: string;
  roleName: string;
  agentType: string;
  systemPrompt: string;
  allowedTools: WorkflowRuntimeCapability[];
  capabilityTags: string[];
  memoryPolicy: AgentExecutionBindingV1['memoryPolicy'];
  concurrencyLimit: number;
  notes: string[];
}

export type WorkflowAgentRoleConfig =
  | WorkflowPlanningRoleConfig
  | WorkflowExecutionRoleConfig;

export interface WorkflowAgentRoleProfile {
  role: WorkflowConfigurableAgentRole;
  title: string;
  shortLabel: string;
  scope: 'planning' | 'execution';
  implementationStatus: 'live' | 'partial';
  description: string;
  roleName: string;
  agentType: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  hasOverrides: boolean;
  notes: string[];
  tools: string[];
  defaultTools: string[];
  editableToolOptions: string[];
  capabilityTags: string[];
  memoryPolicy?: AgentExecutionBindingV1['memoryPolicy'];
  concurrencyLimit?: number;
  defaultConcurrencyLimit?: number;
  plannerTimeoutMs?: number;
  defaultPlannerTimeoutMs?: number;
  plannerMaxRetries?: number;
  defaultPlannerMaxRetries?: number;
}

interface WorkflowAgentRoleOverride {
  systemPrompt?: string;
  allowedTools?: WorkflowRuntimeCapability[];
  concurrencyLimit?: number;
  plannerTimeoutMs?: number;
  plannerMaxRetries?: number;
}

interface WorkflowAgentRoleOverrideStore {
  version: 'v1';
  roles: Partial<Record<WorkflowConfigurableAgentRole, WorkflowAgentRoleOverride>>;
}

export interface WorkflowAgentRoleUpdateInput {
  systemPrompt?: string;
  allowedTools?: WorkflowRuntimeCapability[];
  concurrencyLimit?: number;
  plannerTimeoutMs?: number;
  plannerMaxRetries?: number;
}

const WORKFLOW_AGENT_ROLE_OVERRIDES_SETTING_KEY = 'workflow_agent_role_overrides_v1';

const runtimeCapabilitySchema = z.enum(['workspace.read', 'workspace.write', 'shell.exec']);
const workflowAgentRoleOverrideSchema = z.object({
  systemPrompt: z.string().trim().min(1).optional(),
  allowedTools: z.array(runtimeCapabilitySchema).optional(),
  concurrencyLimit: z.number().int().min(1).max(10).optional(),
  plannerTimeoutMs: z.number().int().min(5_000).max(120_000).optional(),
  plannerMaxRetries: z.number().int().min(0).max(5).optional(),
}).strict();
const workflowAgentRoleOverrideStoreSchema = z.object({
  version: z.literal('v1').default('v1'),
  roles: z.object({
    scheduling: workflowAgentRoleOverrideSchema.optional(),
    worker: workflowAgentRoleOverrideSchema.optional(),
    researcher: workflowAgentRoleOverrideSchema.optional(),
    coder: workflowAgentRoleOverrideSchema.optional(),
    integration: workflowAgentRoleOverrideSchema.optional(),
  }).partial().default({}),
}).strict();

const DEFAULT_WORKFLOW_AGENT_CONFIGS: Record<WorkflowConfigurableAgentRole, WorkflowAgentRoleConfig> = {
  scheduling: {
    role: 'scheduling',
    title: 'Scheduling Agent',
    shortLabel: '调度代理',
    description: '负责分析任务、决定简单执行或工作流编排，并把任务约束收敛到 Workflow DSL v1。',
    roleName: 'Workflow Scheduling Agent',
    agentType: 'workflow.scheduling',
    systemPrompt: [
      'You are the Scheduling Layer planner for Workflow DSL v1.',
      'Decide whether the task should use simple execution or workflow orchestration.',
      'If workflow is selected, output only Workflow DSL v1 using the allowed step types: agent, browser, notification, capability.',
      'Do not invent unsupported step types, subworkflow, custom code, TypeScript, or inline scripts.',
      'If the task cannot be safely expressed with current DSL v1 constraints, choose simple.',
      'For research, security, remediation-plan, or report/export tasks that depend on external facts, prefer browser-based evidence collection before synthesis/export instead of pure report drafting.',
      'Agent prompts must be either a plain string literal or an exact reference like steps.someStep.output.summary.',
      'Browser steps only support action=navigate|click|fill|screenshot with fields url|selector|value|pageId|createPage.',
      'To express web search, first build a concrete static search-engine URL, then use browser.navigate with input.url.',
      'Do not invent browser input fields such as query or prompt.',
      'When the task has multiple independent concrete browser targets, you may express parallel execution by giving those steps the same dependency layer.',
      'Return JSON only.',
    ].join(' '),
    tools: ['generate_workflow', 'update_task_status'],
    notes: [
      '只允许输出受限 Workflow DSL v1，不允许生成任意脚本或 TypeScript。',
      '当前由调度层直接调用模型并执行重试、回退和 DSL 校验。',
    ],
    plannerTimeoutMs: 90_000,
    plannerMaxRetries: 2,
  },
  worker: {
    role: 'worker',
    title: 'Worker Agent',
    shortLabel: '执行代理',
    description: '执行通用工作流步骤，保证结果边界稳定，适合作为单步任务和默认工作执行者。',
    roleName: 'Workflow Worker Agent',
    agentType: 'workflow.worker',
    systemPrompt: [
      'You are the workflow worker agent.',
      'Execute only the assigned workflow step and keep the result bounded to the provided prompt.',
      'Use the local workspace when needed, but do not invent upstream context or perform out-of-band coordination.',
      'Return a structured stage result that downstream workflow steps can consume.',
    ].join('\n'),
    allowedTools: ['workspace.read', 'workspace.write', 'shell.exec'],
    capabilityTags: ['execution', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
    notes: [
      '适合单步工作和最小默认执行路径。',
      '不负责浏览器副作用或通知发送，这些仍由专门 step type 处理。',
    ],
  },
  researcher: {
    role: 'researcher',
    title: 'Research Agent',
    shortLabel: '研究代理',
    description: '负责分析、归纳和证据提炼，适合在执行层输出可交接摘要和事实性结论。',
    roleName: 'Workflow Research Agent',
    agentType: 'workflow.researcher',
    systemPrompt: [
      'You are the workflow research agent.',
      'Focus on analysis, synthesis, and extracting grounded facts from the provided context and local workspace.',
      'Do not browse the web or trigger side effects; browser and notification actions belong to dedicated workflow step types.',
      'Return a concise, evidence-oriented summary for downstream steps.',
    ].join('\n'),
    allowedTools: ['workspace.read'],
    capabilityTags: ['research', 'analysis', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
    notes: [
      '只允许读上下文，不允许直接写代码或触发副作用。',
      '适合先分析再交给其他执行角色继续推进。',
    ],
  },
  coder: {
    role: 'coder',
    title: 'Code Agent',
    shortLabel: '代码代理',
    description: '负责代码相关的实现、修改和代码级分析，但仍被约束在单个工作流步骤边界内。',
    roleName: 'Workflow Code Agent',
    agentType: 'workflow.coder',
    systemPrompt: [
      'You are the workflow code agent.',
      'Work directly against the local repository when the prompt requires code changes or code-aware analysis.',
      'Keep edits scoped to the assigned step and surface any blocking ambiguity in the structured result.',
      'Do not take browser or notification side effects; those belong to dedicated workflow step types.',
    ].join('\n'),
    allowedTools: ['workspace.read', 'workspace.write', 'shell.exec'],
    capabilityTags: ['code', 'implementation', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
    notes: [
      '适合仓库内实现和代码分析。',
      '浏览器操作和通知仍由专门 step type 执行，不通过代码代理越权。',
    ],
  },
  integration: {
    role: 'integration',
    title: 'Integration Agent',
    shortLabel: '集成代理',
    description: '负责生成面向集成的结果、消息载荷和交付说明，但不直接触发浏览器或通知副作用。',
    roleName: 'Workflow Integration Agent',
    agentType: 'workflow.integration',
    systemPrompt: [
      'You are the workflow integration agent.',
      'Prepare integration-ready outputs, message payloads, or coordination artifacts based on the provided context.',
      'Do not directly send notifications or operate the browser; dedicated workflow step types own those side effects in Workflow DSL v1.',
      'Return structured outputs that another workflow step can execute or publish.',
    ].join('\n'),
    allowedTools: ['workspace.read', 'workspace.write'],
    capabilityTags: ['integration', 'coordination', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
    notes: [
      '适合集成载荷、消息内容和交付衔接结果。',
      '不会越过 Workflow DSL v1 的副作用边界直接发送通知。',
    ],
  },
};

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function parseOverrideStore(raw: string | undefined): WorkflowAgentRoleOverrideStore {
  if (!raw || !raw.trim()) {
    return {
      version: 'v1',
      roles: {},
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return workflowAgentRoleOverrideStoreSchema.parse(parsed);
  } catch {
    return {
      version: 'v1',
      roles: {},
    };
  }
}

function readOverrideStore(): WorkflowAgentRoleOverrideStore {
  return parseOverrideStore(getSetting(WORKFLOW_AGENT_ROLE_OVERRIDES_SETTING_KEY));
}

function writeOverrideStore(store: WorkflowAgentRoleOverrideStore): void {
  setSetting(WORKFLOW_AGENT_ROLE_OVERRIDES_SETTING_KEY, JSON.stringify(store));
}

function normalizeExecutionTools(
  defaultTools: WorkflowRuntimeCapability[],
  overrideTools: WorkflowRuntimeCapability[] | undefined,
): WorkflowRuntimeCapability[] {
  if (!Array.isArray(overrideTools)) {
    return [...defaultTools];
  }

  const allowed = new Set(defaultTools);
  return uniqueValues(
    overrideTools.filter((tool) => allowed.has(tool)),
  );
}

function getRoleOverride(
  store: WorkflowAgentRoleOverrideStore,
  role: WorkflowConfigurableAgentRole,
): WorkflowAgentRoleOverride | undefined {
  return store.roles[role];
}

function isExecutionRoleConfig(
  config: WorkflowAgentRoleConfig,
): config is WorkflowExecutionRoleConfig {
  return config.role !== 'scheduling';
}

function buildRoleProfile(
  config: WorkflowAgentRoleConfig,
  override: WorkflowAgentRoleOverride | undefined,
): WorkflowAgentRoleProfile {
  if (config.role === 'scheduling') {
    return {
      role: config.role,
      title: config.title,
      shortLabel: config.shortLabel,
      scope: 'planning',
      implementationStatus: 'live',
      description: config.description,
      roleName: config.roleName,
      agentType: config.agentType,
      systemPrompt: override?.systemPrompt || config.systemPrompt,
      defaultSystemPrompt: config.systemPrompt,
      hasOverrides: Boolean(override && Object.keys(override).length > 0),
      notes: [...config.notes],
      tools: [...config.tools],
      defaultTools: [...config.tools],
      editableToolOptions: [],
      capabilityTags: ['planning', 'workflow-dsl'],
      plannerTimeoutMs: override?.plannerTimeoutMs ?? config.plannerTimeoutMs,
      defaultPlannerTimeoutMs: config.plannerTimeoutMs,
      plannerMaxRetries: override?.plannerMaxRetries ?? config.plannerMaxRetries,
      defaultPlannerMaxRetries: config.plannerMaxRetries,
    };
  }

  const allowedTools = normalizeExecutionTools(config.allowedTools, override?.allowedTools);

  return {
    role: config.role,
    title: config.title,
    shortLabel: config.shortLabel,
    scope: 'execution',
    implementationStatus: 'live',
    description: config.description,
    roleName: config.roleName,
    agentType: config.agentType,
    systemPrompt: override?.systemPrompt || config.systemPrompt,
    defaultSystemPrompt: config.systemPrompt,
    hasOverrides: Boolean(override && Object.keys(override).length > 0),
    notes: [...config.notes],
    tools: [...allowedTools],
    defaultTools: [...config.allowedTools],
    editableToolOptions: [...config.allowedTools],
    capabilityTags: [...config.capabilityTags],
    memoryPolicy: config.memoryPolicy,
    concurrencyLimit: override?.concurrencyLimit ?? config.concurrencyLimit,
    defaultConcurrencyLimit: config.concurrencyLimit,
  };
}

function normalizeOverrideForStorage(
  config: WorkflowAgentRoleConfig,
  input: WorkflowAgentRoleUpdateInput,
): WorkflowAgentRoleOverride {
  const nextOverride: WorkflowAgentRoleOverride = {};

  if (typeof input.systemPrompt === 'string' && input.systemPrompt.trim() && input.systemPrompt.trim() !== config.systemPrompt) {
    nextOverride.systemPrompt = input.systemPrompt.trim();
  }

  if (config.role === 'scheduling') {
    if (typeof input.plannerTimeoutMs === 'number' && input.plannerTimeoutMs !== config.plannerTimeoutMs) {
      nextOverride.plannerTimeoutMs = input.plannerTimeoutMs;
    }
    if (typeof input.plannerMaxRetries === 'number' && input.plannerMaxRetries !== config.plannerMaxRetries) {
      nextOverride.plannerMaxRetries = input.plannerMaxRetries;
    }
    return workflowAgentRoleOverrideSchema.parse(nextOverride);
  }

  if (Array.isArray(input.allowedTools)) {
    const normalizedTools = normalizeExecutionTools(config.allowedTools, input.allowedTools);
    if (
      normalizedTools.length !== config.allowedTools.length
      || normalizedTools.some((tool, index) => tool !== config.allowedTools[index])
    ) {
      nextOverride.allowedTools = normalizedTools;
    }
  }

  if (typeof input.concurrencyLimit === 'number' && input.concurrencyLimit !== config.concurrencyLimit) {
    nextOverride.concurrencyLimit = input.concurrencyLimit;
  }

  return workflowAgentRoleOverrideSchema.parse(nextOverride);
}

export function listWorkflowAgentRoleProfiles(): WorkflowAgentRoleProfile[] {
  const store = readOverrideStore();
  return WORKFLOW_CONFIGURABLE_AGENT_ROLES.map((role) => (
    buildRoleProfile(DEFAULT_WORKFLOW_AGENT_CONFIGS[role], getRoleOverride(store, role))
  ));
}

export function getWorkflowAgentRoleProfile(
  role: WorkflowConfigurableAgentRole,
): WorkflowAgentRoleProfile {
  const config = DEFAULT_WORKFLOW_AGENT_CONFIGS[role];
  const store = readOverrideStore();
  return buildRoleProfile(config, getRoleOverride(store, role));
}

export function updateWorkflowAgentRoleProfile(
  role: WorkflowConfigurableAgentRole,
  input: WorkflowAgentRoleUpdateInput,
): WorkflowAgentRoleProfile {
  const config = DEFAULT_WORKFLOW_AGENT_CONFIGS[role];
  const store = readOverrideStore();
  const normalizedOverride = normalizeOverrideForStorage(config, input);

  if (Object.keys(normalizedOverride).length === 0) {
    delete store.roles[role];
  } else {
    store.roles[role] = normalizedOverride;
  }

  writeOverrideStore(store);
  return getWorkflowAgentRoleProfile(role);
}

export function resetWorkflowAgentRoleProfile(role: WorkflowConfigurableAgentRole): WorkflowAgentRoleProfile {
  const store = readOverrideStore();
  delete store.roles[role];
  writeOverrideStore(store);
  return getWorkflowAgentRoleProfile(role);
}

export function getSchedulingPlannerConfig(): WorkflowPlanningRoleConfig {
  const profile = getWorkflowAgentRoleProfile('scheduling');
  const defaultConfig = DEFAULT_WORKFLOW_AGENT_CONFIGS.scheduling;
  if (defaultConfig.role !== 'scheduling') {
    throw new Error('Scheduling role config is invalid');
  }
  return {
    ...defaultConfig,
    systemPrompt: profile.systemPrompt,
    plannerTimeoutMs: profile.plannerTimeoutMs ?? defaultConfig.plannerTimeoutMs,
    plannerMaxRetries: profile.plannerMaxRetries ?? defaultConfig.plannerMaxRetries,
  };
}

export function getWorkflowExecutionRoleConfig(
  role: WorkflowAgentRole,
): WorkflowExecutionRoleConfig {
  const defaultConfig = DEFAULT_WORKFLOW_AGENT_CONFIGS[role];
  if (!isExecutionRoleConfig(defaultConfig)) {
    throw new Error(`Role "${role}" is not an execution role`);
  }

  const profile = getWorkflowAgentRoleProfile(role);
  return {
    ...defaultConfig,
    systemPrompt: profile.systemPrompt,
    allowedTools: normalizeExecutionTools(defaultConfig.allowedTools, profile.tools as WorkflowRuntimeCapability[]),
    concurrencyLimit: profile.concurrencyLimit ?? defaultConfig.concurrencyLimit,
  };
}
