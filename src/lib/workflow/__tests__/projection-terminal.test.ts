import fs from 'fs';
import os from 'os';
import path from 'path';

describe('workflow projection terminal state handling', () => {
  let tempDir: string;
  let previousDataDir: string | undefined;
  let previousNodeEnv: string | undefined;

  beforeEach(() => {
    jest.resetModules();

    previousDataDir = process.env.LUMOS_DATA_DIR;
    previousNodeEnv = process.env.NODE_ENV;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-projection-terminal-test-'));
    process.env.LUMOS_DATA_DIR = tempDir;
    process.env.NODE_ENV = 'test';
    fs.closeSync(fs.openSync(path.join(tempDir, 'lumos.db'), 'w'));
  });

  afterEach(async () => {
    const { clearWorkflowProjectionTables } = await import('../projection');
    clearWorkflowProjectionTables();

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

  test('late step lifecycle updates do not revive a cancelled projection', async () => {
    const {
      cancelWorkflowProjection,
      getWorkflowProjection,
      initializeWorkflowProjection,
      markWorkflowRunning,
      markWorkflowStepCompleted,
      markWorkflowStepSkipped,
      markWorkflowStepStarted,
    } = await import('../projection');
    const workflowId = 'wf-cancel-projection-001';
    initializeWorkflowProjection(workflowId, 'task-cancel-projection-001', {
      dslVersion: 'v1',
      artifactKind: 'workflow-factory-module',
      exportedSymbol: 'buildWorkflow',
      workflowName: 'cancel-projection-test',
      workflowVersion: 'dsl-v1-cancel-projection',
      stepIds: ['draft'],
      stepTypes: ['agent'],
      warnings: [],
    });

    markWorkflowRunning(workflowId);
    markWorkflowStepStarted(workflowId, 'draft');
    cancelWorkflowProjection(workflowId);

    const lateCompleted = markWorkflowStepCompleted(workflowId, 'draft');
    const lateSkipped = markWorkflowStepSkipped(workflowId, 'draft');
    const projection = getWorkflowProjection(workflowId);

    expect(lateCompleted?.status).toBe('cancelled');
    expect(lateSkipped?.status).toBe('cancelled');
    expect(projection?.status).toBe('cancelled');
    expect(projection?.completedSteps).toEqual([]);
    expect(projection?.runningSteps).toEqual([]);
    expect(projection?.currentStep).toBeUndefined();
  });
});
