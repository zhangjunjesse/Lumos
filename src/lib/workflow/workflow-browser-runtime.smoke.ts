import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveBrowserBridgeRuntimeConfig } from './browser-bridge-client';

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
  timeoutMs = 20_000,
) {
  const startedAt = Date.now();
  let lastStatus: {
    status: string;
    completedSteps: string[];
    progress: number;
    currentStep?: string;
    result?: unknown;
    error?: unknown;
  } | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getWorkflowStatus(workflowId);
    lastStatus = status;
    if (status && ['completed', 'failed', 'cancelled'].includes(status.status)) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for workflow ${workflowId} after ${timeoutMs}ms; last status: ${JSON.stringify(lastStatus)}`,
  );
}

function resolveSmokeTimeoutMs(env: Record<string, string | undefined>): number {
  const rawValue = env.LUMOS_WORKFLOW_BROWSER_SMOKE_TIMEOUT_MS?.trim();
  if (!rawValue) {
    return 90_000;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return 90_000;
  }

  return parsed;
}

async function ensureBrowserBridgeReady(): Promise<{
  ready: boolean;
  reason?: string;
  config?: ReturnType<typeof resolveBrowserBridgeRuntimeConfig>;
}> {
  const config = resolveBrowserBridgeRuntimeConfig();
  if (!config) {
    return {
      ready: false,
      reason: 'browser bridge runtime config is missing',
    };
  }

  try {
    const response = await fetch(`${config.baseUrl}/health`);
    const payload = await response.json().catch(() => null) as { ready?: boolean } | null;
    if (!response.ok || !payload?.ready) {
      return {
        ready: false,
        reason: `browser bridge health is not ready (${response.status})`,
        config,
      };
    }

    return {
      ready: true,
      config,
    };
  } catch (error) {
    return {
      ready: false,
      reason: error instanceof Error ? error.message : String(error),
      config,
    };
  }
}

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const targetUrl = env.LUMOS_BROWSER_SMOKE_TARGET_URL?.trim() || 'https://example.com';
  const smokeTimeoutMs = resolveSmokeTimeoutMs(env);
  const bridgeStatus = await ensureBrowserBridgeReady();
  if (!bridgeStatus.ready) {
    console.log(JSON.stringify({
      skipped: true,
      reason: bridgeStatus.reason,
      bridgeConfig: bridgeStatus.config ? {
        baseUrl: bridgeStatus.config.baseUrl,
        source: bridgeStatus.config.source,
      } : null,
    }, null, 2));
    return;
  }

  const previousDataDir = env.LUMOS_DATA_DIR;
  const previousExecutionMode = env.LUMOS_WORKFLOW_AGENT_STEP_MODE;
  const previousBrowserBridgeUrl = env.LUMOS_BROWSER_BRIDGE_URL;
  const previousBrowserBridgeToken = env.LUMOS_BROWSER_BRIDGE_TOKEN;
  const previousNodeEnv = env.NODE_ENV;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-workflow-browser-runtime-'));
  env.LUMOS_DATA_DIR = tempDir;
  env.LUMOS_WORKFLOW_AGENT_STEP_MODE = 'synthetic';
  env.NODE_ENV = 'test';
  if (bridgeStatus.config) {
    env.LUMOS_BROWSER_BRIDGE_URL = bridgeStatus.config.baseUrl;
    env.LUMOS_BROWSER_BRIDGE_TOKEN = bridgeStatus.config.token;
  }
  fs.closeSync(fs.openSync(path.join(tempDir, 'lumos.db'), 'w'));

  const { createSession, getMessages } = await import('@/lib/db/sessions');
  const { generateWorkflow } = await import('./compiler.js');
  const {
    getWorkflowStatus,
    resetWorkflowEngineForTests,
    shutdownWorker,
    submitWorkflow,
  } = await import('./engine.js');

  try {
    await resetWorkflowEngineForTests();
    const session = createSession('Workflow Browser Runtime Smoke');

    const artifact = generateWorkflow({
      spec: {
        version: 'v1',
        name: 'browser-runtime-smoke',
        steps: [
          {
            id: 'draft',
            type: 'agent',
            input: {
              prompt: 'Draft a browser smoke-test plan',
              role: 'worker',
            },
          },
          {
            id: 'browse',
            type: 'browser',
            dependsOn: ['draft'],
            input: {
              action: 'navigate',
              url: targetUrl,
            },
          },
          {
            id: 'capture',
            type: 'browser',
            dependsOn: ['browse'],
            input: {
              action: 'screenshot',
            },
          },
          {
            id: 'notify',
            type: 'notification',
            dependsOn: ['capture'],
            input: {
              message: 'Workflow browser runtime smoke complete',
              level: 'info',
              channel: 'system',
              sessionId: session.id,
            },
          },
        ],
      },
    });

    if (!artifact.validation.valid) {
      throw new Error(`Workflow generation failed: ${artifact.validation.errors.join('; ')}`);
    }

    const submitResult = await submitWorkflow({
      taskId: 'task-browser-runtime-smoke-001',
      workflowCode: artifact.code,
      workflowManifest: artifact.manifest,
      inputs: {},
    });

    if (submitResult.status !== 'accepted') {
      throw new Error(`Workflow submission failed: ${(submitResult.errors ?? []).join('; ')}`);
    }

    const status = await waitForWorkflowCompletion(
      submitResult.workflowId,
      getWorkflowStatus,
      smokeTimeoutMs,
    );
    if (status?.status !== 'completed') {
      throw new Error(`Workflow finished with unexpected status: ${status?.status}`);
    }

    const result = status.result as Record<string, {
      success?: boolean;
      output?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } | null> | undefined;

    if (!result?.browse?.success || !result?.capture?.success || !result?.notify?.success) {
      throw new Error(`Browser runtime outputs are incomplete: ${JSON.stringify(status.result)}`);
    }

    if (result.browse.metadata?.executionMode !== 'browser-bridge') {
      throw new Error(`Browser navigate did not use browser bridge: ${JSON.stringify(result.browse)}`);
    }

    if (result.capture.metadata?.executionMode !== 'browser-bridge') {
      throw new Error(`Browser screenshot did not use browser bridge: ${JSON.stringify(result.capture)}`);
    }

    const screenshotPath = result.capture.output?.screenshotPath;
    if (typeof screenshotPath !== 'string' || !fs.existsSync(screenshotPath)) {
      throw new Error(`Browser screenshot artifact is missing: ${JSON.stringify(result.capture)}`);
    }

    const screenshotBase64 = result.capture.output?.screenshotBase64;
    if (typeof screenshotBase64 !== 'string' || screenshotBase64.length < 32) {
      throw new Error(`Browser screenshot base64 is missing: ${JSON.stringify(result.capture)}`);
    }

    if (result.notify.metadata?.deliveryMode !== 'session-message') {
      throw new Error(`Notification step did not write session message: ${JSON.stringify(result.notify)}`);
    }

    const messages = getMessages(session.id).messages;
    if (!messages.some((message) => message.content.includes('Workflow browser runtime smoke complete'))) {
      throw new Error(`Notification message was not written to session: ${JSON.stringify(messages)}`);
    }

    console.log(JSON.stringify({
      skipped: false,
      bridgeConfig: {
        baseUrl: bridgeStatus.config?.baseUrl,
        source: bridgeStatus.config?.source,
      },
      targetUrl,
      smokeTimeoutMs,
      manifest: artifact.manifest,
      workflowId: submitResult.workflowId,
      status,
      sessionId: session.id,
      messageCount: messages.length,
      screenshotPath,
    }, null, 2));
  } finally {
    await shutdownWorker();
    await resetWorkflowEngineForTests();

    if (previousDataDir === undefined) delete env.LUMOS_DATA_DIR;
    else env.LUMOS_DATA_DIR = previousDataDir;

    if (previousExecutionMode === undefined) delete env.LUMOS_WORKFLOW_AGENT_STEP_MODE;
    else env.LUMOS_WORKFLOW_AGENT_STEP_MODE = previousExecutionMode;

    if (previousBrowserBridgeUrl === undefined) delete env.LUMOS_BROWSER_BRIDGE_URL;
    else env.LUMOS_BROWSER_BRIDGE_URL = previousBrowserBridgeUrl;

    if (previousBrowserBridgeToken === undefined) delete env.LUMOS_BROWSER_BRIDGE_TOKEN;
    else env.LUMOS_BROWSER_BRIDGE_TOKEN = previousBrowserBridgeToken;

    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;

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
