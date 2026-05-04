/**
 * Pure-function utilities for building a {@link DebugRuntimeContext}:
 *
 *   - compute a stable hash of a node's user-editable config (so we can detect
 *     "the cache is stale because the user changed the node")
 *   - given a target node + mode, derive the skip set (nodes that should be
 *     replaced with a no-op during this debug run)
 *   - given a changed node, enumerate its transitive downstream (so the caller
 *     can invalidate those cache entries before running)
 *
 * V3-native:直接吃 `WorkflowDSLV3.nodes / edges`,不再经 EditorStep。
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
import type { StepResult } from './types';
import type { WorkflowDSLV3, WorkflowNode } from './types-v3';

export { computeUpstreamClosure, computeTransitiveDownstream };

// ── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Stable sha256 over the node's user-editable config surface.
 * Changes to cosmetic-only fields (metadata.position) do NOT invalidate cache.
 */
export function computeConfigHash(node: WorkflowNode): string {
  const payload = {
    input: 'input' in node ? node.input ?? null : null,
    policy: node.policy ?? null,
  };
  return crypto.createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

/** Hash every node in a DSL; returns a Map keyed by node id. */
export function buildConfigHashes(dsl: WorkflowDSLV3): Map<string, string> {
  const m = new Map<string, string>();
  for (const node of dsl.nodes) m.set(node.id, computeConfigHash(node));
  return m;
}

// ── Debug runtime context builder ───────────────────────────────────────────

export interface BuildDebugRuntimeContextArgs {
  sessionId: string;
  mode: DebugRuntimeContext['mode'];
  targetStepId: string;
  dsl: WorkflowDSLV3;
  cachedSteps: DebugStepOutput[];
}

/**
 * Build the in-memory {@link DebugRuntimeContext} handed to the engine.
 *
 * The target node is never in `skipSet`. For `run-to` and `rerun-only` modes,
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

  const allIds = new Set(dsl.nodes.map((n) => n.id));
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

export interface BuildResumeRuntimeContextArgs {
  sessionId: string;
  targetStepId: string;
  dsl: WorkflowDSLV3;
  cachedSteps: DebugStepOutput[];
}

/**
 * Build a run-scoped cache context for production reruns.
 *
 * Unlike visual-editor debug modes, production rerun must keep upstream
 * stepOutputs intact instead of returning generic "skipped" placeholders.
 * Therefore skipSet stays empty and only cached steps are short-circuited;
 * the selected target and its downstream are omitted by the caller so they
 * execute for real in the new run.
 */
export function buildResumeRuntimeContext(
  args: BuildResumeRuntimeContextArgs,
): DebugRuntimeContext {
  const cache = new Map<string, DebugStepOutput>();
  for (const c of args.cachedSteps) cache.set(c.stepId, c);
  return {
    sessionId: args.sessionId,
    mode: 'continue-from',
    targetStepId: args.targetStepId,
    cache,
    skipSet: new Set<string>(),
    configHashes: buildConfigHashes(args.dsl),
    persist: false,
  };
}

// ── Runtime persistence ─────────────────────────────────────────────────────

// ── Run-scoped runtime context registry ─────────────────────────────────────
//
// Workflow definitions (the `fn` we hand to OpenWorkflow via `implementWorkflow`)
// are registered once per `name@version` and reused across every run of that
// spec. They must therefore be pure: no per-run state baked into the closure.
//
// Debug runs are per-run state (skip sets, caches, config hashes), so we keep
// them in a module-level map keyed by `workflowRunId` and the step bindings
// look them up at call time via `input.__runtime.workflowRunId`.
//
// `submitWorkflow` registers on entry; `waitForWorkflowCompletion` clears on
// exit. Production runs never register, so their bindings fall through to the
// real implementation.

const debugContextByRunId = new Map<string, DebugRuntimeContext>();

export function registerDebugContext(runId: string, ctx: DebugRuntimeContext): void {
  debugContextByRunId.set(runId, ctx);
}

export function getDebugContext(runId: string | undefined): DebugRuntimeContext | undefined {
  if (!runId) return undefined;
  return debugContextByRunId.get(runId);
}

export function clearDebugContext(runId: string): void {
  debugContextByRunId.delete(runId);
}

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
  if (ctx.persist !== false) {
    upsertCachedStep(ctx.sessionId, record);
  }
  // Update in-memory cache so subsequent steps in the same run see it.
  ctx.cache.set(stepId, record);
}
