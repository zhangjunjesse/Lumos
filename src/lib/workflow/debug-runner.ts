/**
 * Business logic for /api/workflows/[id]/debug — wires the workflow debug
 * session DB layer, the cache util, and the existing schedule-run flow.
 *
 * Keeps the API route files thin (per CLAUDE.md).
 */
import { getDb } from '@/lib/db';
import { createSession } from '@/lib/db/sessions';
import { getWorkflow } from '@/lib/db/workflows';
import {
  getOrCreateDebugSession,
  getDebugSessionByWorkflow,
  setDebugSessionStatus,
  loadCachedSteps,
  loadCachedStep,
  loadStepCacheMetas,
  deleteCachedStepsAndDownstream,
  clearDebugSession,
  deleteCachedStep,
} from '@/lib/db/debug-session';
import { insertRunHistory, updateRunHistory } from '@/lib/db/scheduled-workflows';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';
import { submitWorkflow } from '@/lib/workflow/api';
import {
  buildConfigHashes,
  buildDebugRuntimeContext,
  computeTransitiveDownstream,
} from './debug-cache';
import type {
  DebugRunRequest,
  DebugSessionSnapshot,
  DebugStepCacheMeta,
} from './debug-types';
import type { AnyWorkflowDSL } from './types';

// ── Snapshot ────────────────────────────────────────────────────────────────

export function buildDebugSessionSnapshot(workflowId: string): DebugSessionSnapshot {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const session = getOrCreateDebugSession(workflowId);
  const metas = loadStepCacheMetas(session.id);
  const cachedByStep = loadCachedSteps(session.id);
  const hashByStep = new Map<string, string>();
  for (const c of cachedByStep) hashByStep.set(c.stepId, c.configHash);

  const currentHashes = buildConfigHashes(workflow.workflowDsl);
  const cachedSteps: Record<string, DebugStepCacheMeta> = {};
  for (const m of metas) {
    const current = currentHashes.get(m.stepId) ?? '';
    const cachedHash = hashByStep.get(m.stepId) ?? '';
    cachedSteps[m.stepId] = { ...m, stale: cachedHash !== current };
  }

  return { session, cachedSteps };
}

// ── Delete cache entries ────────────────────────────────────────────────────

export function clearDebugSessionForWorkflow(workflowId: string): void {
  const session = getOrCreateDebugSession(workflowId);
  clearDebugSession(session.id);
}

export function getDebugStepOutput(
  workflowId: string,
  stepId: string,
): import('./debug-types').DebugStepOutput | null {
  const session = getDebugSessionByWorkflow(workflowId);
  if (!session) return null;
  return loadCachedStep(session.id, stepId);
}

export function deleteDebugStep(
  workflowId: string,
  stepId: string,
  cascade: boolean,
): void {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  const session = getOrCreateDebugSession(workflowId);
  if (!cascade) {
    deleteCachedStep(session.id, stepId);
    return;
  }
  const downstream = computeTransitiveDownstream(stepId, workflow.workflowDsl);
  deleteCachedStepsAndDownstream(session.id, [stepId, ...downstream]);
}

// ── Run ─────────────────────────────────────────────────────────────────────

export interface DebugRunResult {
  runId: string;
  sessionId: string;
  workflowRunId: string;
  debugSnapshot: DebugSessionSnapshot;
}

/**
 * Entry point for `POST /api/workflows/[id]/debug/run`.
 *
 * Steps:
 *   1. Resolve workflow DSL
 *   2. Get/create debug session
 *   3. If `rerun-only`: invalidate target + transitive downstream cache
 *   4. Build `DebugRuntimeContext`
 *   5. Compile DSL → submit to workflow engine with debugContext
 */
export async function runDebugWorkflow(
  request: DebugRunRequest,
): Promise<DebugRunResult> {
  const workflow = getWorkflow(request.workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${request.workflowId}`);

  const dsl = workflow.workflowDsl;
  const session = getOrCreateDebugSession(request.workflowId);

  if (request.mode === 'rerun-only') {
    const ids = [request.targetStepId, ...computeTransitiveDownstream(request.targetStepId, dsl)];
    deleteCachedStepsAndDownstream(session.id, ids);
  }

  const cachedSteps = loadCachedSteps(session.id);
  const debugContext = buildDebugRuntimeContext({
    sessionId: session.id,
    mode: request.mode,
    targetStepId: request.targetStepId,
    dsl,
    cachedSteps,
  });

  const artifact = generateWorkflowFromDsl(dsl);
  if (!artifact.validation.valid) {
    throw new Error(`DSL invalid: ${artifact.validation.errors.join('; ')}`);
  }

  const chatSession = createSession(
    `[调试] ${workflow.name}`,
    undefined,
    undefined,
    undefined,
    'workflow',
  );
  // insertRunHistory is typed for v1 DSL, but only JSON-stringifies the value.
  // Cast to align with AnyWorkflowDSL (covers both v1 and v2).
  const runId = insertRunHistory(
    request.workflowId,
    chatSession.id,
    dsl as unknown as Parameters<typeof insertRunHistory>[2],
  );
  tagRunAsDebug(runId, session.id);

  setDebugSessionStatus(session.id, 'running');

  const submitResult = await submitWorkflow(
    {
      taskId: chatSession.id,
      workflowCode: artifact.code,
      workflowManifest: artifact.manifest,
      inputs: {
        __lumosRuntime: {
          taskId: chatSession.id,
          sessionId: chatSession.id,
        },
        ...mergeParamDefaults(dsl, {}),
      },
    },
    {
      onCompleted: () => {
        updateRunHistory(runId, 'success');
        setDebugSessionStatus(session.id, 'idle');
      },
      onFailed: (event) => {
        updateRunHistory(runId, 'error', event.error.message);
        setDebugSessionStatus(session.id, 'error');
      },
    },
    debugContext,
  );

  if (submitResult.status === 'rejected') {
    setDebugSessionStatus(session.id, 'error');
    const err = (submitResult.errors || []).join('; ');
    updateRunHistory(runId, 'error', err);
    throw new Error(`Workflow rejected: ${err}`);
  }

  return {
    runId,
    sessionId: session.id,
    workflowRunId: submitResult.workflowId,
    debugSnapshot: buildDebugSessionSnapshot(request.workflowId),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function tagRunAsDebug(runId: string, debugSessionId: string): void {
  getDb().prepare(
    "UPDATE schedule_run_history SET mode = 'debug', debug_session_id = ? WHERE id = ?",
  ).run(debugSessionId, runId);
}

function mergeParamDefaults(
  dsl: AnyWorkflowDSL,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const paramDefs = (dsl as { params?: Array<{ name: string; default?: unknown }> }).params;
  if (!paramDefs?.length) return params;
  const merged = { ...params };
  for (const p of paramDefs) {
    if (!(p.name in merged) && p.default !== undefined) {
      merged[p.name] = p.default;
    }
  }
  return merged;
}
