import fs from 'fs';
import os from 'os';
import path from 'path';

const mockGetWorkflowEngine = jest.fn();
const mockResetWorkflowClientForTests = jest.fn();
const mockCancelWorkflowAgentExecution = jest.fn();
const mockExecuteWorkflowAgentStep = jest.fn();

jest.mock('../openworkflow-client', () => ({
  getWorkflowEngine: () => mockGetWorkflowEngine(),
  resetWorkflowClientForTests: () => mockResetWorkflowClientForTests(),
}));

jest.mock('../subagent', () => ({
  cancelWorkflowAgentExecution: (...args: unknown[]) => mockCancelWorkflowAgentExecution(...args),
  executeWorkflowAgentStep: (...args: unknown[]) => mockExecuteWorkflowAgentStep(...args),
}));

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const matched = await predicate();
      if (matched) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(() => {
        void tick();
      }, 10);
    };
    void tick();
  });
}

describe('workflow engine running cancel', () => {
  jest.setTimeout(30_000);

  let tempDir: string;
  let previousDataDir: string | undefined;
  let previousNodeEnv: string | undefined;

  beforeEach(() => {
    jest.resetModules();
    mockGetWorkflowEngine.mockReset();
    mockResetWorkflowClientForTests.mockReset();
    mockCancelWorkflowAgentExecution.mockReset();
    mockExecuteWorkflowAgentStep.mockReset();
    mockCancelWorkflowAgentExecution.mockResolvedValue(false);

    previousDataDir = process.env.LUMOS_DATA_DIR;
    previousNodeEnv = process.env.NODE_ENV;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-engine-cancel-test-'));
    process.env.LUMOS_DATA_DIR = tempDir;
    process.env.NODE_ENV = 'test';
    fs.closeSync(fs.openSync(path.join(tempDir, 'lumos.db'), 'w'));
  });

  afterEach(async () => {
    const engine = await import('../engine');
    await engine.shutdownWorker();
    await engine.resetWorkflowEngineForTests();

    const { closeDb } = await import('@/lib/db/connection');
    closeDb({ silent: true });

    if (previousDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = previousDataDir;
    }

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('cancelled workflow stays cancelled even if runHandle.result resolves afterwards', async () => {
    const runResult = createDeferred<Record<string, unknown>>();
    const cancelWorkflowRun = jest.fn().mockResolvedValue(undefined);
    const fakeOw = {
      implementWorkflow: jest.fn(),
      newWorker: jest.fn(),
      runWorkflow: jest.fn(),
      cancelWorkflowRun,
    };
    mockGetWorkflowEngine.mockResolvedValue(fakeOw);

    const engine = await import('../engine');
    await engine.resetWorkflowEngineForTests();

    const callbacks = {
      onCompleted: jest.fn(),
      onFailed: jest.fn(),
    };
    const runHandle = {
      result: () => runResult.promise,
    };
    const workflowManifest = {
      dslVersion: 'v1' as const,
      artifactKind: 'workflow-factory-module' as const,
      exportedSymbol: 'buildWorkflow' as const,
      workflowName: 'cancel-resolve-test',
      workflowVersion: 'dsl-v1-cancel-resolve',
      stepIds: ['main'],
      stepTypes: ['agent'] as const,
      warnings: [],
    };
    engine.__testOnlyPrimeWorkflowExecution({
      workflowId: 'wf-cancel-resolve-001',
      taskId: 'task-cancel-resolve-001',
      workflowManifest,
      callbacks,
      runHandle,
    });
    const observePromise = engine.__testOnlyObserveWorkflowCompletion({
      workflowId: 'wf-cancel-resolve-001',
      taskId: 'task-cancel-resolve-001',
      runHandle,
      callbacks,
      timeoutMs: 10_000,
    });

    await waitForCondition(async () => {
      const status = await engine.getWorkflowStatus('wf-cancel-resolve-001');
      return status?.status === 'running';
    });

    const cancelled = await engine.cancelWorkflow('wf-cancel-resolve-001');
    expect(cancelled).toBe(true);
    expect(cancelWorkflowRun).toHaveBeenCalledWith('wf-cancel-resolve-001');
    expect(mockCancelWorkflowAgentExecution).toHaveBeenCalledWith({
      workflowRunId: 'wf-cancel-resolve-001',
    });

    const cancelledStatus = await engine.getWorkflowStatus('wf-cancel-resolve-001');
    expect(cancelledStatus?.status).toBe('cancelled');

    runResult.resolve({
      main: {
        success: true,
      },
    });
    await observePromise;

    const finalStatus = await engine.getWorkflowStatus('wf-cancel-resolve-001');
    expect(finalStatus?.status).toBe('cancelled');
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    expect(callbacks.onFailed).not.toHaveBeenCalled();
  });

  test('cancelled workflow stays cancelled when runHandle.result later rejects', async () => {
    const runResult = createDeferred<Record<string, unknown>>();
    const cancelWorkflowRun = jest.fn().mockResolvedValue(undefined);
    const fakeOw = {
      implementWorkflow: jest.fn(),
      newWorker: jest.fn(),
      runWorkflow: jest.fn(),
      cancelWorkflowRun,
    };
    mockGetWorkflowEngine.mockResolvedValue(fakeOw);

    const engine = await import('../engine');
    await engine.resetWorkflowEngineForTests();

    const callbacks = {
      onCompleted: jest.fn(),
      onFailed: jest.fn(),
    };
    const runHandle = {
      result: () => runResult.promise,
    };
    const workflowManifest = {
      dslVersion: 'v1' as const,
      artifactKind: 'workflow-factory-module' as const,
      exportedSymbol: 'buildWorkflow' as const,
      workflowName: 'cancel-reject-test',
      workflowVersion: 'dsl-v1-cancel-reject',
      stepIds: ['main'],
      stepTypes: ['agent'] as const,
      warnings: [],
    };
    engine.__testOnlyPrimeWorkflowExecution({
      workflowId: 'wf-cancel-reject-001',
      taskId: 'task-cancel-reject-001',
      workflowManifest,
      callbacks,
      runHandle,
    });
    const observePromise = engine.__testOnlyObserveWorkflowCompletion({
      workflowId: 'wf-cancel-reject-001',
      taskId: 'task-cancel-reject-001',
      runHandle,
      callbacks,
      timeoutMs: 10_000,
    });

    await waitForCondition(async () => {
      const status = await engine.getWorkflowStatus('wf-cancel-reject-001');
      return status?.status === 'running';
    });

    const cancelled = await engine.cancelWorkflow('wf-cancel-reject-001');
    expect(cancelled).toBe(true);
    expect(mockCancelWorkflowAgentExecution).toHaveBeenCalledWith({
      workflowRunId: 'wf-cancel-reject-001',
    });

    runResult.reject(new Error('cancelled underneath'));
    await observePromise;

    const finalStatus = await engine.getWorkflowStatus('wf-cancel-reject-001');
    expect(finalStatus?.status).toBe('cancelled');
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    expect(callbacks.onFailed).not.toHaveBeenCalled();
  });

  test('workflow stays cancelled when agent abort causes runHandle.result to reject before cancel handshake completes', async () => {
    const runResult = createDeferred<Record<string, unknown>>();
    const cancelWorkflowRun = jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
      setTimeout(resolve, 30);
    }));
    const fakeOw = {
      implementWorkflow: jest.fn(),
      newWorker: jest.fn(),
      runWorkflow: jest.fn(),
      cancelWorkflowRun,
    };
    mockGetWorkflowEngine.mockResolvedValue(fakeOw);
    mockCancelWorkflowAgentExecution.mockImplementation(async () => {
      runResult.reject(new Error('agent aborted while cancelling'));
      return true;
    });

    const engine = await import('../engine');
    await engine.resetWorkflowEngineForTests();

    const callbacks = {
      onCompleted: jest.fn(),
      onFailed: jest.fn(),
    };
    const runHandle = {
      result: () => runResult.promise,
    };
    const workflowManifest = {
      dslVersion: 'v1' as const,
      artifactKind: 'workflow-factory-module' as const,
      exportedSymbol: 'buildWorkflow' as const,
      workflowName: 'cancel-race-test',
      workflowVersion: 'dsl-v1-cancel-race',
      stepIds: ['main'],
      stepTypes: ['agent'] as const,
      warnings: [],
    };
    engine.__testOnlyPrimeWorkflowExecution({
      workflowId: 'wf-cancel-race-001',
      taskId: 'task-cancel-race-001',
      workflowManifest,
      callbacks,
      runHandle,
    });
    const observePromise = engine.__testOnlyObserveWorkflowCompletion({
      workflowId: 'wf-cancel-race-001',
      taskId: 'task-cancel-race-001',
      runHandle,
      callbacks,
      timeoutMs: 10_000,
    });

    await waitForCondition(async () => {
      const status = await engine.getWorkflowStatus('wf-cancel-race-001');
      return status?.status === 'running';
    });

    const cancelled = await engine.cancelWorkflow('wf-cancel-race-001');
    expect(cancelled).toBe(true);
    expect(cancelWorkflowRun).toHaveBeenCalledWith('wf-cancel-race-001');
    expect(mockCancelWorkflowAgentExecution).toHaveBeenCalledWith({
      workflowRunId: 'wf-cancel-race-001',
    });

    await observePromise;

    const finalStatus = await engine.getWorkflowStatus('wf-cancel-race-001');
    expect(finalStatus?.status).toBe('cancelled');
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    expect(callbacks.onFailed).not.toHaveBeenCalled();
  });
});
