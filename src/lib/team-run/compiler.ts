import { DependencyResolver } from './dependency-resolver';
import { resolveAgentDefinitionForRole } from './agent-definitions';
import type {
  AgentPresetDirectoryItem,
  TeamPlan,
  TeamPlanRoleKind,
  TeamRun,
} from '@/types';

export interface CompiledRoleV1 {
  roleId: string;
  externalRoleId: string;
  name: string;
  roleKind: TeamPlanRoleKind;
  responsibility: string;
  parentRoleId?: string;
  agentType: string;
  agentDefinitionId?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  capabilityTags?: string[];
  outputSchema?: 'stage-execution-result/v1';
  memoryPolicy?: 'ephemeral-stage' | 'sticky-run';
  concurrencyLimit?: number;
  presetId?: string;
}

export interface CompiledBudgetV1 {
  maxParallelWorkers: number;
  maxRetriesPerTask: number;
  maxRunMinutes: number;
}

export interface CompiledStageV1 {
  stageId: string;
  externalTaskId: string;
  title: string;
  description: string;
  expectedOutput: string;
  ownerRoleId: string;
  ownerExternalRoleId: string;
  ownerAgentType: string;
  ownerAgentDefinitionId?: string;
  dependsOnStageIds: string[];
  inputContract: {
    requiredDependencyOutputs: Array<{
      fromStageId: string;
      kind: 'summary' | 'artifact_ref';
      required: true;
    }>;
    taskContext: {
      includeUserGoal: true;
      includeExpectedOutcome: true;
      includeRunSummary: boolean;
    };
  };
  outputContract: {
    primaryFormat: 'markdown';
    mustProduceSummary: true;
    mayProduceArtifacts: boolean;
    artifactKinds: Array<'file' | 'log' | 'metadata' | 'report'>;
  };
  acceptanceCriteria: string[];
}

export interface CompiledRunPlanV1 {
  contractVersion: 'compiled-run-plan/v1';
  taskId: string;
  sessionId: string;
  runId: string;
  plannerMode: 'direct_plan_v1';
  workspaceRoot: string;
  publicTaskContext: {
    userGoal: string;
    summary: string;
    expectedOutcome: string;
    risks: string[];
  };
  roles: CompiledRoleV1[];
  budget: CompiledBudgetV1;
  stages: CompiledStageV1[];
  stageOrder: string[];
  createdAt: string;
}

const DEFAULT_RUN_BUDGET_V1: CompiledBudgetV1 = {
  maxParallelWorkers: 3,
  maxRetriesPerTask: 1,
  maxRunMinutes: 120,
};

function sanitizeRuntimeId(prefix: string, raw: string, index: number, scope?: string): string {
  const scopedRaw = scope?.trim()
    ? `${scope.trim()}-${raw}`
    : raw

  const sanitized = scopedRaw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = sanitized || `${index + 1}`;
  return `${prefix}-${index + 1}-${suffix}`;
}

export function compileTeamPlanToRunPlan(input: {
  taskId: string;
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  plan: TeamPlan;
  run: TeamRun;
  agentPresets?: AgentPresetDirectoryItem[];
}): CompiledRunPlanV1 {
  const { taskId, sessionId, runId, workspaceRoot, plan, run, agentPresets = [] } = input;
  if (plan.roles.length === 0) {
    throw new Error('Team plan must include at least one role');
  }
  if (plan.tasks.length === 0) {
    throw new Error('Team plan must include at least one task');
  }

  const roles = plan.roles.map((role, index) => {
    const definition = resolveAgentDefinitionForRole(role, agentPresets);
    return {
      roleId: sanitizeRuntimeId('role', role.id, index),
      externalRoleId: role.id,
      name: role.name,
      roleKind: role.kind,
      responsibility: role.responsibility,
      ...(role.parentRoleId ? { parentRoleId: role.parentRoleId } : {}),
      agentType: definition.agentType,
      agentDefinitionId: definition.id,
      systemPrompt: definition.systemPrompt,
      allowedTools: [...definition.allowedTools],
      capabilityTags: [...definition.capabilityTags],
      outputSchema: definition.outputSchema,
      memoryPolicy: definition.memoryPolicy,
      concurrencyLimit: definition.concurrencyLimit,
      ...(definition.presetId ? { presetId: definition.presetId } : {}),
    };
  });
  const roleByExternalId = new Map(roles.map((role) => [role.externalRoleId, role]));

  for (const task of plan.tasks) {
    if (!roleByExternalId.has(task.ownerRoleId)) {
      throw new Error(`Unknown owner role for task ${task.id}: ${task.ownerRoleId}`);
    }
  }

  const stageScope = runId.slice(0, 8) || taskId.slice(0, 8) || 'run'
  const stageIdByExternalTaskId = new Map(
    plan.tasks.map((task, index) => [task.id, sanitizeRuntimeId('stage', task.id, index, stageScope)]),
  );

  for (const task of plan.tasks) {
    for (const dependencyId of task.dependsOn) {
      if (!stageIdByExternalTaskId.has(dependencyId)) {
        throw new Error(`Unknown dependency for task ${task.id}: ${dependencyId}`);
      }
    }
  }

  const budget: CompiledBudgetV1 = {
    maxParallelWorkers: Math.max(1, run.budget.maxParallelWorkers || DEFAULT_RUN_BUDGET_V1.maxParallelWorkers),
    maxRetriesPerTask: Math.max(0, run.budget.maxRetriesPerTask || DEFAULT_RUN_BUDGET_V1.maxRetriesPerTask),
    maxRunMinutes: Math.max(1, run.budget.maxRunMinutes || DEFAULT_RUN_BUDGET_V1.maxRunMinutes),
  };

  const stages = plan.tasks.map((task) => {
    const owner = roleByExternalId.get(task.ownerRoleId);
    const stageId = stageIdByExternalTaskId.get(task.id)!;
    return {
      stageId,
      externalTaskId: task.id,
      title: task.title,
      description: task.summary,
      expectedOutput: task.expectedOutput,
      ownerRoleId: owner!.roleId,
      ownerExternalRoleId: owner!.externalRoleId,
      ownerAgentType: owner!.agentType,
      ownerAgentDefinitionId: owner!.agentDefinitionId,
      dependsOnStageIds: task.dependsOn.map((dependencyId) => stageIdByExternalTaskId.get(dependencyId)!),
      inputContract: {
        requiredDependencyOutputs: task.dependsOn.map((dependencyId) => ({
          fromStageId: stageIdByExternalTaskId.get(dependencyId)!,
          kind: 'summary' as const,
          required: true as const,
        })),
        taskContext: {
          includeUserGoal: true as const,
          includeExpectedOutcome: true as const,
          includeRunSummary: true,
        },
      },
      outputContract: {
        primaryFormat: 'markdown' as const,
        mustProduceSummary: true as const,
        mayProduceArtifacts: true,
        artifactKinds: ['file', 'log', 'metadata', 'report'] as Array<'file' | 'log' | 'metadata' | 'report'>,
      },
      acceptanceCriteria: [
        `Address the stage goal: ${task.summary}`,
        `Produce the expected output: ${task.expectedOutput}`,
      ],
    };
  });

  const resolver = new DependencyResolver();
  if (resolver.detectCycles(stages.map((stage) => ({ id: stage.stageId, dependencies: stage.dependsOnStageIds })))) {
    throw new Error('Team plan contains cyclic task dependencies');
  }

  return {
    contractVersion: 'compiled-run-plan/v1',
    taskId,
    sessionId,
    runId,
    plannerMode: 'direct_plan_v1',
    workspaceRoot,
    publicTaskContext: {
      userGoal: plan.userGoal,
      summary: plan.summary,
      expectedOutcome: plan.expectedOutcome,
      risks: plan.risks || [],
    },
    roles,
    budget,
    stages,
    stageOrder: stages.map((stage) => stage.stageId),
    createdAt: new Date().toISOString(),
  };
}

export function parseCompiledRunPlan(raw: string | null | undefined): CompiledRunPlanV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<CompiledRunPlanV1> & { contractVersion?: string };
    if (candidate.contractVersion === 'compiled-run-plan/v1' && Array.isArray(candidate.stages) && Array.isArray(candidate.roles)) {
      return candidate as CompiledRunPlanV1;
    }
    if (
      'compiledPlan' in (parsed as Record<string, unknown>)
      && typeof (parsed as { compiledPlan?: unknown }).compiledPlan === 'object'
      && (parsed as { compiledPlan?: { contractVersion?: string } }).compiledPlan?.contractVersion === 'compiled-run-plan/v1'
    ) {
      return (parsed as { compiledPlan: CompiledRunPlanV1 }).compiledPlan;
    }
    return null;
  } catch {
    return null;
  }
}
