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
  loadFailedStepsInWindow,
} from '@/lib/db/debug-session';
import { insertRunHistory, updateRunHistory } from '@/lib/db/scheduled-workflows';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';
import { submitWorkflow } from '@/lib/workflow/api';
import {
  buildConfigHashes,
  buildDebugRuntimeContext,
  computeTransitiveDownstream,
} from './debug-cache';
import { formatWorkflowError } from './error-format';
import { extractFailureDetail, type StepFailureDetail } from './debug-failure-extract';
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

  const latestRunId = getLatestDebugRunId(workflowId);
  return { session, cachedSteps, latestRunId };
}

function getLatestDebugRunId(workflowId: string): string | null {
  const row = getDb().prepare(
    "SELECT id FROM schedule_run_history WHERE schedule_id = ? AND mode = 'debug' ORDER BY started_at DESC LIMIT 1",
  ).get(workflowId) as { id?: string } | undefined;
  return row?.id ?? null;
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

export type DebugRunFailure = StepFailureDetail;

export interface DebugRunFailureReport {
  runError: string;
  failures: DebugRunFailure[];
}

/**
 * 给 runId 定位到失败的 step:
 *   1. 读 schedule_run_history 拿到 debug_session_id 和时间窗
 *   2. 查 session 下时间窗内 status='error' 的 step outputs
 *   3. 清洗 run 级 error + 每个 step 的 error,提取 summary
 */
export function getDebugRunFailures(runId: string): DebugRunFailureReport {
  const row = getDb().prepare(
    "SELECT error, started_at, completed_at, debug_session_id FROM schedule_run_history WHERE id = ? AND mode = 'debug'",
  ).get(runId) as {
    error?: string;
    started_at?: string;
    completed_at?: string | null;
    debug_session_id?: string | null;
  } | undefined;
  if (!row) return { runError: '执行记录不存在', failures: [] };

  const runError = formatWorkflowError(row.error ?? '');
  if (!row.debug_session_id || !row.started_at) {
    return { runError, failures: [] };
  }

  const steps = loadFailedStepsInWindow(
    row.debug_session_id,
    row.started_at,
    row.completed_at ?? null,
  );
  const failures = steps.map(s => extractFailureDetail({
    stepId: s.stepId,
    output: s.output,
    error: s.error,
    durationMs: s.durationMs,
    completedAt: s.completedAt,
  }));
  return { runError, failures };
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
  // insertRunHistory only JSON-stringifies the DSL value; cast keeps the type loose.
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
        updateRunHistory(runId, 'error', formatWorkflowError(event.error?.message));
        setDebugSessionStatus(session.id, 'error');
      },
    },
    debugContext,
  );

  if (submitResult.status === 'rejected') {
    setDebugSessionStatus(session.id, 'error');
    const err = formatWorkflowError((submitResult.errors || []).join('; '));
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
