import { agentStep } from './steps/agentStep';
import { capabilityStep } from './steps/capabilityStep';
import { notificationStep } from './steps/notificationStep';
import { persistDebugCacheResult } from './debug-cache';
import type { DebugRuntimeContext } from './debug-types';
import type {
  AgentStepInput,
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
    notificationStep: (input) => STEP_RUNTIME_REGISTRY.notification.execute(input),
    capabilityStep: (input) => STEP_RUNTIME_REGISTRY.capability.execute(input),
    waitStep: (input: WaitStepInput) => STEP_RUNTIME_REGISTRY.wait.execute(input),
  };
}

export interface InstrumentedBindingOptions {
  onStepStarted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepCompleted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepSkipped?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepOutput?: (event: WorkflowStepOutputEvent) => Promise<void> | void;
  /** When set, wraps each step binding to honor the debug skip set + cache. */
  debugContext?: DebugRuntimeContext | null;
}

export function createInstrumentedWorkflowRuntimeBindings(
  options: InstrumentedBindingOptions = {},
): WorkflowRuntimeBindings {
  const base = createWorkflowRuntimeBindings();
  const { debugContext } = options;

  const containerOutputHook = async (event: WorkflowStepOutputEvent) => {
    if (options.onStepOutput) await options.onStepOutput(event);
    if (debugContext) await persistContainerOutput(debugContext, event);
  };

  if (!debugContext) {
    return {
      ...base,
      onStepStarted: options.onStepStarted,
      onStepCompleted: options.onStepCompleted,
      onStepSkipped: options.onStepSkipped,
      onStepOutput: containerOutputHook,
    };
  }

  return {
    agentStep: wrapWithDebug(base.agentStep, debugContext),
    notificationStep: wrapWithDebug(base.notificationStep, debugContext),
    capabilityStep: wrapWithDebug(base.capabilityStep, debugContext),
    waitStep: wrapWithDebug(base.waitStep, debugContext),
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
 * Return path:
 *   1. skipSet hit → synthesize a no-op success result (metadata.skippedByDebug)
 *   2. cache hit (and hash matches current config) → return cached result
 *   3. otherwise run for real + persist to cache (non-blocking)
 */
function wrapWithDebug<I extends WorkflowStepRuntimeCarrier>(
  fn: (input: I) => Promise<StepResult>,
  ctx: DebugRuntimeContext,
): (input: I) => Promise<StepResult> {
  return async (input: I): Promise<StepResult> => {
    const stepId = input?.__runtime?.stepId;
    if (!stepId) return fn(input);

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
  };
}

/**
 * Persist a container's aggregated output as a cache entry. Fires from the
 * {@link onStepOutput} hook since containers don't flow through wrapWithDebug.
 */
async function persistContainerOutput(
  ctx: DebugRuntimeContext,
  event: WorkflowStepOutputEvent,
): Promise<void> {
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
