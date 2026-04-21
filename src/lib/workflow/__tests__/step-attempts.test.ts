import {
  __resetStepAttemptsForTests,
  clearRunAttempts,
  clearStepAttempt,
  listRunAttempts,
  recordStepAttempt,
} from '../step-attempts';

describe('step-attempts tracker', () => {
  beforeEach(() => {
    __resetStepAttemptsForTests();
  });

  test('ignores first-try events (maxAttempts <= 1)', () => {
    recordStepAttempt('run-1', 'step-a', 1, 1);
    expect(listRunAttempts('run-1')).toEqual([]);
  });

  test('ignores events without attempt/maxAttempts', () => {
    recordStepAttempt('run-1', 'step-a', undefined, undefined);
    expect(listRunAttempts('run-1')).toEqual([]);
  });

  test('records retry attempts with maxAttempts > 1', () => {
    recordStepAttempt('run-1', 'step-a', 2, 3);
    const list = listRunAttempts('run-1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      workflowRunId: 'run-1',
      stepId: 'step-a',
      attempt: 2,
      maxAttempts: 3,
    });
    expect(typeof list[0].startedAt).toBe('string');
  });

  test('overwrites previous attempt for same step', () => {
    recordStepAttempt('run-1', 'step-a', 2, 3);
    recordStepAttempt('run-1', 'step-a', 3, 3);
    const list = listRunAttempts('run-1');
    expect(list).toHaveLength(1);
    expect(list[0].attempt).toBe(3);
  });

  test('keyed per run × step — parallel runs isolated', () => {
    recordStepAttempt('run-1', 'step-a', 2, 3);
    recordStepAttempt('run-2', 'step-a', 2, 5);
    expect(listRunAttempts('run-1')).toHaveLength(1);
    expect(listRunAttempts('run-1')[0].maxAttempts).toBe(3);
    expect(listRunAttempts('run-2')).toHaveLength(1);
    expect(listRunAttempts('run-2')[0].maxAttempts).toBe(5);
  });

  test('clearStepAttempt removes one step only', () => {
    recordStepAttempt('run-1', 'step-a', 2, 3);
    recordStepAttempt('run-1', 'step-b', 2, 3);
    clearStepAttempt('run-1', 'step-a');
    const list = listRunAttempts('run-1');
    expect(list).toHaveLength(1);
    expect(list[0].stepId).toBe('step-b');
  });

  test('clearRunAttempts wipes all entries for one run, leaves others', () => {
    recordStepAttempt('run-1', 'step-a', 2, 3);
    recordStepAttempt('run-1', 'step-b', 2, 3);
    recordStepAttempt('run-2', 'step-a', 2, 3);
    clearRunAttempts('run-1');
    expect(listRunAttempts('run-1')).toEqual([]);
    expect(listRunAttempts('run-2')).toHaveLength(1);
  });

  test('clearRunAttempts with prefix-matching run ids only clears exact match', () => {
    recordStepAttempt('run-1', 'step-a', 2, 3);
    recordStepAttempt('run-10', 'step-b', 2, 3);
    clearRunAttempts('run-1');
    expect(listRunAttempts('run-1')).toEqual([]);
    expect(listRunAttempts('run-10')).toHaveLength(1);
  });
});
