/**
 * In-process tracker for live retry attempts.
 *
 * The compiler's `__executeStep` loop emits `onStepStarted` with `attempt` and
 * `maxAttempts` on every try. The engine forwards those events here so the UI
 * can render a retry indicator (N/M + amber ring) while a step is mid-retry.
 *
 * This is intentionally ephemeral: entries are cleared on step completion,
 * and the map is keyed per `${workflowRunId}:${stepId}` so parallel runs
 * don't clobber each other.
 */

export interface StepAttemptState {
  workflowRunId: string;
  stepId: string;
  attempt: number;
  maxAttempts: number;
  startedAt: string;
}

const attempts = new Map<string, StepAttemptState>();

function keyOf(workflowRunId: string, stepId: string): string {
  return `${workflowRunId}:${stepId}`;
}

export function recordStepAttempt(
  workflowRunId: string,
  stepId: string,
  attempt: number | undefined,
  maxAttempts: number | undefined,
): void {
  if (typeof attempt !== 'number' || typeof maxAttempts !== 'number') return;
  if (maxAttempts <= 1) return;
  attempts.set(keyOf(workflowRunId, stepId), {
    workflowRunId,
    stepId,
    attempt,
    maxAttempts,
    startedAt: new Date().toISOString(),
  });
}

export function clearStepAttempt(workflowRunId: string, stepId: string): void {
  attempts.delete(keyOf(workflowRunId, stepId));
}

export function clearRunAttempts(workflowRunId: string): void {
  for (const key of attempts.keys()) {
    if (key.startsWith(`${workflowRunId}:`)) attempts.delete(key);
  }
}

export function listRunAttempts(workflowRunId: string): StepAttemptState[] {
  const out: StepAttemptState[] = [];
  for (const state of attempts.values()) {
    if (state.workflowRunId === workflowRunId) out.push(state);
  }
  return out;
}

/** Test helper — not part of the public runtime surface. */
export function __resetStepAttemptsForTests(): void {
  attempts.clear();
}
