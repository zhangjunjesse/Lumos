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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-workflow-runtime-'));
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
        name: 'runtime-smoke',
        steps: [
          {
            id: 'draft',
            type: 'agent',
            input: {
              prompt: 'Draft a smoke-test plan',
              role: 'coder',
            },
          },
          {
            id: 'browse',
            type: 'browser',
            dependsOn: ['draft'],
            input: {
              action: 'navigate',
              url: 'https://example.com',
            },
          },
          {
            id: 'notify',
            type: 'notification',
            dependsOn: ['browse'],
            input: {
              message: 'Workflow runtime smoke complete',
              level: 'info',
              channel: 'system',
            },
          },
        ],
      },
    });

    if (!artifact.validation.valid) {
      throw new Error(`Workflow generation failed: ${artifact.validation.errors.join('; ')}`);
    }

    if (artifact.manifest.stepIds.join(',') !== 'draft,browse,notify') {
      throw new Error(`Manifest stepIds are not stable: ${JSON.stringify(artifact.manifest.stepIds)}`);
    }

    const submitResult = await submitWorkflow({
      taskId: 'task-runtime-smoke-001',
      workflowCode: artifact.code,
      workflowManifest: artifact.manifest,
      inputs: {},
    });

    if (submitResult.status !== 'accepted') {
      throw new Error(`Workflow submission failed: ${(submitResult.errors ?? []).join('; ')}`);
    }

    const status = await waitForWorkflowCompletion(submitResult.workflowId, getWorkflowStatus);
    console.log(JSON.stringify({
      manifest: artifact.manifest,
      workflowId: submitResult.workflowId,
      status,
    }, null, 2));

    if (status?.status !== 'completed') {
      throw new Error(`Workflow finished with unexpected status: ${status?.status}`);
    }

    if (status.completedSteps.join(',') !== 'draft,browse,notify') {
      throw new Error(`Workflow completedSteps are unexpected: ${JSON.stringify(status.completedSteps)}`);
    }

    const result = status.result as Record<string, {
      success?: boolean;
      output?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } | null> | undefined;
    if (!result?.browse?.success || !result?.notify?.success) {
      throw new Error(`Runtime outputs are missing browser/notification results: ${JSON.stringify(status.result)}`);
    }

    if (!result?.draft?.success) {
      throw new Error(`Runtime outputs are missing agent result: ${JSON.stringify(status.result)}`);
    }

    if (result.draft.metadata?.stepId !== 'draft') {
      throw new Error(`Agent runtime metadata lost stable stepId: ${JSON.stringify(result.draft)}`);
    }

    if (result.draft.metadata?.workflowRunId !== submitResult.workflowId) {
      throw new Error(`Agent runtime metadata is missing workflowRunId: ${JSON.stringify(result.draft)}`);
    }

    if (result.draft.output?.role !== 'coder') {
      throw new Error(`Agent runtime output lost role mapping: ${JSON.stringify(result.draft)}`);
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
