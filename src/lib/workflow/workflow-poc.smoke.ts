import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function waitForWorkflowCompletion(
  workflowId: string,
  getWorkflowStatus: (workflowId: string) => Promise<{
    status: string;
    completedSteps: string[];
    progress: number;
    currentStep?: string;
    result?: unknown;
    error?: unknown;
  } | null>,
  timeoutMs = 10_000
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getWorkflowStatus(workflowId);
    if (status && ['completed', 'failed', 'cancelled'].includes(status.status)) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for workflow ${workflowId}`);
}

async function main() {
  const previousDataDir = process.env.LUMOS_DATA_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-workflow-poc-'));
  process.env.LUMOS_DATA_DIR = tempDir;
  process.env.NODE_ENV = 'test';
  fs.closeSync(fs.openSync(path.join(tempDir, 'lumos.db'), 'w'));

  const { generateWorkflow } = await import('./compiler');
  const {
    getWorkflowStatus,
    resetWorkflowEngineForTests,
    shutdownWorker,
    submitWorkflow,
  } = await import('./engine');

  try {
    await resetWorkflowEngineForTests();

    const artifact = generateWorkflow({
      spec: {
        version: 'v1',
        name: 'agent-smoke',
        steps: [
          {
            id: 'draft',
            type: 'agent',
            input: {
              prompt: 'Write a smoke-test reply',
              role: 'coder',
            },
          },
        ],
      },
    });

    if (!artifact.validation.valid) {
      throw new Error(`Workflow generation failed: ${artifact.validation.errors.join('; ')}`);
    }

    const submitResult = await submitWorkflow({
      taskId: 'task-smoke-001',
      workflowCode: artifact.code,
      workflowManifest: artifact.manifest,
      inputs: {},
    });

    if (submitResult.status !== 'accepted') {
      throw new Error(`Workflow submission failed: ${(submitResult.errors ?? []).join('; ')}`);
    }

    const status = await waitForWorkflowCompletion(submitResult.workflowId, getWorkflowStatus);
    console.log(JSON.stringify({
      validation: artifact.validation,
      manifest: artifact.manifest,
      workflowId: submitResult.workflowId,
      status,
    }, null, 2));

    if (status?.status !== 'completed') {
      throw new Error(`Workflow finished with unexpected status: ${status?.status}`);
    }

    if (artifact.manifest.stepIds.join(',') !== 'draft') {
      throw new Error(`Workflow manifest is missing stable stepIds: ${JSON.stringify(artifact.manifest)}`);
    }

    if (status.completedSteps.join(',') !== 'draft') {
      throw new Error(`Workflow status is missing completedSteps: ${JSON.stringify(status)}`);
    }

    const result = status.result as Record<string, {
      success?: boolean;
      metadata?: Record<string, unknown>;
    } | null> | undefined;
    const draftResult = result?.draft;
    if (!draftResult?.success) {
      throw new Error(`Workflow agent step did not succeed: ${JSON.stringify(status.result)}`);
    }

    if (draftResult.metadata?.stepId !== 'draft') {
      throw new Error(`Workflow agent step lost stable stepId metadata: ${JSON.stringify(draftResult)}`);
    }

    if (draftResult.metadata?.workflowRunId !== submitResult.workflowId) {
      throw new Error(`Workflow agent step metadata is missing workflowRunId: ${JSON.stringify(draftResult)}`);
    }
  } finally {
    await shutdownWorker();
    await resetWorkflowEngineForTests();

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
