import { emitRuntimeHelpers } from '../compiler-helpers';

/**
 * Verifies the retry loop emitted by `__executeStep` forwards `attempt` and
 * `maxAttempts` to the lifecycle hooks so the UI can render a retry indicator.
 */
describe('__executeStep attempt emission', () => {
  const src = emitRuntimeHelpers().join('\n');

  test('onStepStarted receives attempt + maxAttempts on first try', async () => {
    const factory = new Function(`${src}\nreturn __executeStep;`);
    const executeStep = factory() as (opts: Record<string, unknown>) => Promise<unknown>;

    const started: Array<{ attempt: number; maxAttempts: number }> = [];
    await executeStep({
      workflowRunId: 'run-1',
      stepId: 'step-a',
      runStep: async () => ({ success: true, output: {} }),
      onStepStarted: (e: { attempt: number; maxAttempts: number }) => {
        started.push({ attempt: e.attempt, maxAttempts: e.maxAttempts });
      },
      onStepCompleted: () => {},
      retryPolicy: { maximumAttempts: 3 },
    });
    expect(started).toEqual([{ attempt: 1, maxAttempts: 3 }]);
  });

  test('retry loop emits increasing attempt numbers', async () => {
    const factory = new Function(`${src}\nreturn __executeStep;`);
    const executeStep = factory() as (opts: Record<string, unknown>) => Promise<unknown>;

    const started: Array<{ attempt: number; maxAttempts: number }> = [];
    let callCount = 0;
    await executeStep({
      workflowRunId: 'run-1',
      stepId: 'flaky',
      runStep: async () => {
        callCount += 1;
        if (callCount < 3) return { success: false, error: 'boom' };
        return { success: true, output: {} };
      },
      onStepStarted: (e: { attempt: number; maxAttempts: number }) => {
        started.push({ attempt: e.attempt, maxAttempts: e.maxAttempts });
      },
      onStepCompleted: () => {},
      // Skip backoff for test speed: compiler helper computes `Math.pow(2, attempt-2)`,
      // which yields 0.5/1/2s — acceptable for a 3-call retry.
      retryPolicy: { maximumAttempts: 5 },
    });
    expect(started.map((s) => s.attempt)).toEqual([1, 2, 3]);
    expect(started.every((s) => s.maxAttempts === 5)).toBe(true);
  }, 30_000);

  test('defaults maxAttempts to 1 when retryPolicy missing', async () => {
    const factory = new Function(`${src}\nreturn __executeStep;`);
    const executeStep = factory() as (opts: Record<string, unknown>) => Promise<unknown>;

    const started: Array<{ maxAttempts: number }> = [];
    await executeStep({
      workflowRunId: 'run-1',
      stepId: 'step-a',
      runStep: async () => ({ success: true, output: {} }),
      onStepStarted: (e: { maxAttempts: number }) => {
        started.push({ maxAttempts: e.maxAttempts });
      },
      onStepCompleted: () => {},
    });
    expect(started).toEqual([{ maxAttempts: 1 }]);
  });
});
