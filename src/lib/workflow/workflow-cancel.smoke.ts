import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function waitForWorkflowStatus(
  workflowId: string,
  getWorkflowStatus: (workflowId: string) => Promise<{
    status: string;
    completedSteps: string[];
    progress: number;
    currentStep?: string;
    result?: unknown;
    error?: unknown;
  } | null>,
  predicate: (status: {
    status: string;
    completedSteps: string[];
    progress: number;
    currentStep?: string;
    result?: unknown;
    error?: unknown;
  }) => boolean,
  timeoutMs = 10_000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getWorkflowStatus(workflowId);
    if (status && predicate(status)) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for workflow ${workflowId}`);
}

async function main() {
  const syntheticDelayMs = 2_000;
  const previousDataDir = process.env.LUMOS_DATA_DIR;
  const previousExecutionMode = process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE;
  const previousSyntheticDelay = process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS;
  const previousNodeEnv = process.env.NODE_ENV;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-workflow-cancel-'));

  process.env.LUMOS_DATA_DIR = tempDir;
  process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE = 'synthetic';
  process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS = String(syntheticDelayMs);
  process.env.NODE_ENV = 'test';
  fs.closeSync(fs.openSync(path.join(tempDir, 'lumos.db'), 'w'));

  const { generateWorkflow } = await import('./compiler.js');
  const {
    cancelWorkflow,
    getWorkflowStatus,
    resetWorkflowEngineForTests,
    shutdownWorker,
    submitWorkflow,
  } = await import('./engine.js');

  try {
    await resetWorkflowEngineForTests();

    const artifact = generateWorkflow({
      spec: {
        version: 'v1',
        name: 'cancel-smoke',
        steps: [
          {
            id: 'draft',
            type: 'agent',
            input: {
              prompt: 'Write a delayed smoke-test reply',
              role: 'worker',
            },
          },
        ],
      },
    });

    if (!artifact.validation.valid) {
      throw new Error(`Workflow generation failed: ${artifact.validation.errors.join('; ')}`);
    }

    const submitResult = await submitWorkflow({
      taskId: 'task-cancel-smoke-001',
      workflowCode: artifact.code,
      workflowManifest: artifact.manifest,
      inputs: {},
    });

    if (submitResult.status !== 'accepted') {
      throw new Error(`Workflow submission failed: ${(submitResult.errors ?? []).join('; ')}`);
    }

    const runningStatus = await waitForWorkflowStatus(
      submitResult.workflowId,
      getWorkflowStatus,
      (status) => status.status === 'running',
    );

    const cancelled = await cancelWorkflow(submitResult.workflowId);
    if (!cancelled) {
      throw new Error(`Workflow cancel request was rejected: ${submitResult.workflowId}`);
    }

    const cancelledStatus = await waitForWorkflowStatus(
      submitResult.workflowId,
      getWorkflowStatus,
      (status) => status.status === 'cancelled',
    );

    await new Promise((resolve) => setTimeout(resolve, syntheticDelayMs + 500));
    const settledStatus = await getWorkflowStatus(submitResult.workflowId);

    console.log(JSON.stringify({
      manifest: artifact.manifest,
      workflowId: submitResult.workflowId,
      runningStatus,
      cancelledStatus,
      settledStatus,
    }, null, 2));

    if (settledStatus?.status !== 'cancelled') {
      throw new Error(`Workflow cancel state was overwritten after settle: ${JSON.stringify(settledStatus)}`);
    }

    if ((settledStatus.completedSteps ?? []).length !== 0) {
      throw new Error(`Cancelled workflow should not record late completed steps: ${JSON.stringify(settledStatus)}`);
    }

    if (settledStatus.currentStep !== undefined) {
      throw new Error(`Cancelled workflow should not keep currentStep: ${JSON.stringify(settledStatus)}`);
    }

    if (settledStatus.result !== undefined) {
      throw new Error(`Cancelled workflow should not publish final result: ${JSON.stringify(settledStatus)}`);
    }
  } finally {
    await shutdownWorker();
    await resetWorkflowEngineForTests();

    if (previousDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = previousDataDir;
    }

    if (previousExecutionMode === undefined) {
      delete process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE;
    } else {
      process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE = previousExecutionMode;
    }

    if (previousSyntheticDelay === undefined) {
      delete process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS;
    } else {
      process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS = previousSyntheticDelay;
    }

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
