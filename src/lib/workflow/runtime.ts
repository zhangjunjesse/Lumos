import { agentStep } from './steps/agentStep';
import { capabilityStep } from './steps/capabilityStep';
import { notificationStep } from './steps/notificationStep';
import { approvalStep } from './steps/approvalStep';
import { getDebugContext, persistDebugCacheResult } from './debug-cache';
import type { DebugRuntimeContext } from './debug-types';
import type {
  AgentStepInput,
  TeamStepInput,
  ApprovalStepInput,
  CapabilityStepInput,
  NotificationStepInput,
  WaitStepInput,
  StepResult,
  WorkflowStepLifecycleEvent,
  WorkflowStepOutputEvent,
  WorkflowStepRuntimeCarrier,
  WorkflowRuntimeBindings,
  WorkflowStepType,
} from './types';

interface StepRuntimeDefinition<TInput extends object> {
  type: WorkflowStepType;
  execute: (input: TInput) => Promise<StepResult>;
}

export const STEP_RUNTIME_REGISTRY = {
  agent: {
    type: 'agent',
    execute: (input: AgentStepInput) => agentStep(input),
  },
  team: {
    type: 'team',
    // 动态加载:teamStep 的依赖链含 Claude SDK 的 ESM 产物,静态 import 会把它拖进
    // 所有引擎单测(jest 解析 sdk.mjs 直接炸,老坑)。执行时才加载,测试面干净。
    execute: async (input: TeamStepInput) => {
      const { teamStep } = await import('./steps/teamStep');
      return teamStep(input);
    },
  },
  notification: {
    type: 'notification',
    execute: (input: NotificationStepInput) => notificationStep(input),
  },
  capability: {
    type: 'capability',
    execute: (input: CapabilityStepInput) => capabilityStep(input),
  },
  wait: {
    type: 'wait',
    execute: async (input: { durationMs?: number }) => {
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, input.durationMs ?? 1000)));
      return { success: true, output: { durationMs: input.durationMs ?? 1000 } };
    },
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Partial<Record<WorkflowStepType, StepRuntimeDefinition<any>>>;

export function createWorkflowRuntimeBindings(): WorkflowRuntimeBindings {
  return {
    agentStep: (input) => STEP_RUNTIME_REGISTRY.agent.execute(input),
    teamStep: (input) => STEP_RUNTIME_REGISTRY.team.execute(input),
    notificationStep: (input) => STEP_RUNTIME_REGISTRY.notification.execute(input),
    capabilityStep: (input) => STEP_RUNTIME_REGISTRY.capability.execute(input),
    waitStep: (input: WaitStepInput) => STEP_RUNTIME_REGISTRY.wait.execute(input),
    approvalStep: (input: ApprovalStepInput) => approvalStep(input),
  };
}

export interface InstrumentedBindingOptions {
  onStepStarted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepCompleted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepSkipped?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepOutput?: (event: WorkflowStepOutputEvent) => Promise<void> | void;
}

/**
 * Build the {@link WorkflowRuntimeBindings} used by compiled workflow modules.
 *
 * The returned bindings are pure per workflow spec — they hold no per-run
 * state — so the OpenWorkflow registry can safely reuse the same definition
 * across every run of `name@version`. Debug behavior (skip set / cache) is
 * resolved at call time via `input.__runtime.workflowRunId` against the
 * module-level registry in `debug-cache.ts`; production runs never register
 * and fall straight through to the real step.
 */
export function createInstrumentedWorkflowRuntimeBindings(
  options: InstrumentedBindingOptions = {},
): WorkflowRuntimeBindings {
  const base = createWorkflowRuntimeBindings();

  const containerOutputHook = async (event: WorkflowStepOutputEvent) => {
    if (options.onStepOutput) await options.onStepOutput(event);
    await persistContainerOutput(event);
  };

  return {
    agentStep: wrapWithDebug(base.agentStep),
    teamStep: wrapWithDebug(base.teamStep),
    notificationStep: wrapWithDebug(base.notificationStep),
    capabilityStep: wrapWithDebug(base.capabilityStep),
    waitStep: wrapWithDebug(base.waitStep),
    approvalStep: base.approvalStep,
    onStepStarted: options.onStepStarted,
    onStepCompleted: options.onStepCompleted,
    onStepSkipped: options.onStepSkipped,
    onStepOutput: containerOutputHook,
  };
}

/**
 * Wraps a step binding so that debug-mode runs consult the skip set + cache
 * BEFORE calling the real implementation, and persist the result after.
 *
 * The debug context is looked up per-invocation via `workflowRunId`, so the
 * wrapped fn is safe to register once and share across production + debug
 * runs of the same spec.
 *
 * Return path:
 *   1. no debug context registered → call the real fn unchanged
 *   2. skipSet hit → synthesize a no-op success result (metadata.skippedByDebug)
 *   3. cache hit (and hash matches current config) → return cached result
 *   4. otherwise run for real + persist to cache (non-blocking)
 */
function wrapWithDebug<I extends WorkflowStepRuntimeCarrier>(
  fn: (input: I) => Promise<StepResult>,
): (input: I) => Promise<StepResult> {
  return async (input: I): Promise<StepResult> => {
    const ctx = getDebugContext(input?.__runtime?.workflowRunId);
    const stepId = input?.__runtime?.stepId;
    if (!ctx || !stepId) return fn(input);

    return applyDebugWrap(fn, ctx, stepId, input);
  };
}

async function applyDebugWrap<I extends WorkflowStepRuntimeCarrier>(
  fn: (input: I) => Promise<StepResult>,
  ctx: DebugRuntimeContext,
  stepId: string,
  input: I,
): Promise<StepResult> {
  if (ctx.skipSet.has(stepId)) {
    return {
      success: true,
      output: { skipped: true, reason: 'debug-skip' },
      metadata: { skippedByDebug: true },
    };
  }

  const currentHash = ctx.configHashes.get(stepId) ?? '';
  const cached = ctx.cache.get(stepId);
  if (cached && cached.configHash === currentHash) {
    return {
      success: cached.status === 'success',
      output: cached.output,
      error: cached.error,
      metadata: { ...cached.metadata, fromDebugCache: true },
    };
  }

  const start = Date.now();
  const result = await fn(input);
  void persistDebugCacheResult(ctx, stepId, result, currentHash, Date.now() - start);
  return result;
}

/**
 * Persist a container's aggregated output as a cache entry. Fires from the
 * {@link onStepOutput} hook since containers don't flow through wrapWithDebug.
 * No-op outside of debug runs.
 */
async function persistContainerOutput(event: WorkflowStepOutputEvent): Promise<void> {
  const ctx = getDebugContext(event.workflowRunId);
  if (!ctx) return;
  if (ctx.skipSet.has(event.stepId)) return;
  const currentHash = ctx.configHashes.get(event.stepId) ?? '';
  const cached = ctx.cache.get(event.stepId);
  if (cached && cached.configHash === currentHash) return; // cache already fresh
  await persistDebugCacheResult(
    ctx,
    event.stepId,
    { success: true, output: event.output },
    currentHash,
    0,
  );
}
