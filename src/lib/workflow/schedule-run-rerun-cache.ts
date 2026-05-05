import { buildConfigHashes, computeTransitiveDownstream } from './debug-cache';
import type { DebugStepOutput } from './debug-types';
import type { StepResult, WorkflowDSLV3 } from './types';

export interface ResumeStepAttemptRow {
  step_name: string;
  status: string;
  output: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export function buildCachedStepsForResume(input: {
  dsl: WorkflowDSLV3;
  attempts: ResumeStepAttemptRow[];
  sourceRunId: string;
  targetStepId: string;
}): DebugStepOutput[] {
  const configHashes = buildConfigHashes(input.dsl);
  const downstream = new Set(computeTransitiveDownstream(input.targetStepId, input.dsl));
  downstream.add(input.targetStepId);

  const latestCompleted = new Map<string, ResumeStepAttemptRow>();
  for (const attempt of input.attempts) {
    if (!isSuccessfulAttemptStatus(attempt.status)) continue;
    if (downstream.has(attempt.step_name)) continue;
    latestCompleted.set(attempt.step_name, attempt);
  }

  const out: DebugStepOutput[] = [];
  for (const [stepId, attempt] of latestCompleted) {
    const parsed = parseStepResult(attempt.output);
    if (!parsed) continue;
    out.push({
      sessionId: `rerun:${input.sourceRunId}`,
      stepId,
      output: parsed.output,
      metadata: {
        ...(parsed.metadata ?? {}),
        fromProductionRun: true,
        sourceRunId: input.sourceRunId,
      },
      status: parsed.success ? 'success' : 'error',
      error: parsed.error,
      durationMs: computeDurationMs(attempt.started_at, attempt.finished_at),
      completedAt: attempt.finished_at ?? attempt.created_at,
      configHash: configHashes.get(stepId) ?? '',
    });
  }
  return out;
}

export function findFirstTerminalFailedStep(
  attempts: ResumeStepAttemptRow[],
  dsl: WorkflowDSLV3,
): string | null {
  const nodeIds = new Set(dsl.nodes.map((node) => node.id));
  const latestTerminalByStep = new Map<string, ResumeStepAttemptRow>();

  for (const attempt of attempts) {
    if (!nodeIds.has(attempt.step_name)) continue;
    if (!isTerminalAttemptStatus(attempt.status)) continue;
    latestTerminalByStep.set(attempt.step_name, attempt);
  }

  for (const attempt of attempts) {
    if (attempt.status !== 'failed') continue;
    if (latestTerminalByStep.get(attempt.step_name) === attempt) {
      return attempt.step_name;
    }
  }
  return null;
}

function parseStepResult(raw: string | null): StepResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StepResult>;
    if (!parsed || typeof parsed !== 'object' || !('success' in parsed)) return null;
    return {
      success: Boolean(parsed.success),
      output: parsed.output ?? null,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      metadata: isJsonObject(parsed.metadata) ? parsed.metadata : undefined,
    };
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is NonNullable<StepResult['metadata']> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function computeDurationMs(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

function isSuccessfulAttemptStatus(status: string): boolean {
  return status === 'completed' || status === 'succeeded';
}

function isTerminalAttemptStatus(status: string): boolean {
  return isSuccessfulAttemptStatus(status) || status === 'failed';
}
