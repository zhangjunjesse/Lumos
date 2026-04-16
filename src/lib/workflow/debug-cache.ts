/**
 * Pure-function utilities for building a {@link DebugRuntimeContext}:
 *
 *   - compute a stable hash of a step's user-editable config (so we can detect
 *     "the cache is stale because the user changed the step")
 *   - given a target step + mode, derive the skip set (steps that should be
 *     replaced with a no-op during this debug run)
 *   - given a changed step, enumerate its transitive downstream (so the caller
 *     can invalidate those cache entries before running)
 *
 * Container semantics (matches UI contract): each control-flow container
 * (if-else / for-each / while) is cached as a whole; its body children are
 * considered part of the container. Graph traversal logic lives in
 * {@link ./debug-cache-graph} to keep this file under 300 lines.
 */
import crypto from 'crypto';
import { upsertCachedStep } from '@/lib/db/debug-session';
import {
  computeUpstreamClosure,
  computeTransitiveDownstream,
} from './debug-cache-graph';
import type {
  DebugRuntimeContext,
  DebugStepOutput,
} from './debug-types';
import type { AnyWorkflowDSL, StepResult, WorkflowStep } from './types';

export { computeUpstreamClosure, computeTransitiveDownstream };

// ── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Stable sha256 over the step's user-editable config surface.
 * Changes to cosmetic-only fields (metadata.position) do NOT invalidate cache.
 */
export function computeConfigHash(step: WorkflowStep): string {
  const payload = {
    input: step.input ?? null,
    when: step.when ?? null,
    policy: step.policy ?? null,
  };
  return crypto.createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

/** Hash every step in a DSL; returns a Map keyed by step id. */
export function buildConfigHashes(dsl: AnyWorkflowDSL): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of dsl.steps) m.set(s.id, computeConfigHash(s));
  return m;
}

// ── Debug runtime context builder ───────────────────────────────────────────

export interface BuildDebugRuntimeContextArgs {
  sessionId: string;
  mode: DebugRuntimeContext['mode'];
  targetStepId: string;
  dsl: AnyWorkflowDSL;
  cachedSteps: DebugStepOutput[];
}

/**
 * Build the in-memory {@link DebugRuntimeContext} handed to the engine.
 *
 * The target step is never in `skipSet`. For `run-to` and `rerun-only` modes,
 * `skipSet` contains everything that is NOT an upstream of the target. For
 * `continue-from`, we skip the target and all of its upstream (the target
 * must already be cached).
 */
export function buildDebugRuntimeContext(
  args: BuildDebugRuntimeContextArgs,
): DebugRuntimeContext {
  const { sessionId, mode, targetStepId, dsl, cachedSteps } = args;

  const cache = new Map<string, DebugStepOutput>();
  for (const c of cachedSteps) cache.set(c.stepId, c);

  const configHashes = buildConfigHashes(dsl);

  const allIds = new Set(dsl.steps.map(s => s.id));
  const upstream = computeUpstreamClosure(targetStepId, dsl);

  const skipSet = new Set<string>();
  if (mode === 'continue-from') {
    if (!cache.has(targetStepId)) {
      throw new Error(`continue-from requires a cached output for step "${targetStepId}"`);
    }
    // Skip target itself + everything upstream of it.
    skipSet.add(targetStepId);
    for (const id of upstream) skipSet.add(id);
  } else {
    // run-to / rerun-only: skip everything outside (upstream ∪ {target}).
    for (const id of allIds) {
      if (id === targetStepId) continue;
      if (upstream.has(id)) continue;
      skipSet.add(id);
    }
  }

  return { sessionId, mode, targetStepId, cache, skipSet, configHashes };
}

// ── Runtime persistence ─────────────────────────────────────────────────────

/**
 * Called by runtime.ts after each real step execution inside a debug run.
 * Writes the result to the session cache. Fire-and-forget; the caller
 * intentionally ignores the returned promise to not block step throughput.
 */
export async function persistDebugCacheResult(
  ctx: DebugRuntimeContext,
  stepId: string,
  result: StepResult,
  configHash: string,
  durationMs: number,
): Promise<void> {
  const record: DebugStepOutput = {
    sessionId: ctx.sessionId,
    stepId,
    output: result.output,
    metadata: result.metadata ?? {},
    status: result.success ? 'success' : 'error',
    error: result.error,
    durationMs,
    completedAt: new Date().toISOString(),
    configHash,
  };
  upsertCachedStep(ctx.sessionId, record);
  // Update in-memory cache so subsequent steps in the same run see it.
  ctx.cache.set(stepId, record);
}
