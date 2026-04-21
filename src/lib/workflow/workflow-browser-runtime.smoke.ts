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

  const { generateWorkflowFromDsl } = await import('./compiler');
  const {
    getWorkflowStatus,
    resetWorkflowEngineForTests,
    shutdownWorker,
    submitWorkflow,
  } = await import('./engine');

  try {
    await resetWorkflowEngineForTests();
    const artifact = generateWorkflowFromDsl({
      version: 'v3',
      name: 'browser-runtime-smoke',
      nodes: [
        {
          id: 'browse',
          type: 'agent',
          input: {
            prompt: `Open ${targetUrl} with ctx.browser, capture page details and save a screenshot artifact.`,
            code: {
              strategy: 'code-only',
              params: {
                targetUrl,
              },
              script: `
                const targetUrl = String(ctx.params.targetUrl || '');
                if (!targetUrl) {
                  return { success: false, output: null, error: 'targetUrl is required' };
                }

                await ctx.browser.navigate(targetUrl);
                const current = await ctx.browser.currentPage();
                const snapshot = await ctx.browser.snapshot();
                const screenshotSource = await ctx.browser.screenshot();
                const savedScreenshotPath = await ctx.saveArtifact(screenshotSource, 'browser-smoke/browser-smoke.png');

                return {
                  success: true,
                  output: {
                    summary: \`Visited \${targetUrl}\`,
                    pageTitle: snapshot.title || current.title || '',
                    pageUrl: snapshot.url || current.url || '',
                    snapshotHasContent: typeof snapshot.content === 'string' && snapshot.content.trim().length > 0,
                    screenshotPath: savedScreenshotPath,
                  },
                };
              `,
            },
          },
        },
      ],
      edges: [],
    });

    if (!artifact.validation.valid) {
      throw new Error(`Workflow generation failed: ${artifact.validation.errors.join('; ')}`);
    }

    if (artifact.manifest.stepIds.join(',') !== 'browse') {
      throw new Error(`Workflow browser smoke manifest is unexpected: ${JSON.stringify(artifact.manifest.stepIds)}`);
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

    if (status.completedSteps.join(',') !== 'browse') {
      throw new Error(`Workflow browser smoke completedSteps are unexpected: ${JSON.stringify(status.completedSteps)}`);
    }

    const result = status.result as Record<string, {
      success?: boolean;
      output?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } | null> | undefined;

    if (!result?.browse?.success) {
      throw new Error(`Workflow runtime outputs are incomplete: ${JSON.stringify(status.result)}`);
    }

    if (result.browse.metadata?.executedVia !== 'code') {
      throw new Error(`Workflow browser step did not execute via code path: ${JSON.stringify(result.browse)}`);
    }

    const debugLogPath = result.browse.metadata?.debugLogPath;
    if (typeof debugLogPath !== 'string' || !fs.existsSync(debugLogPath)) {
      throw new Error(`Workflow browser step debug log is missing: ${JSON.stringify(result.browse)}`);
    }

    const debugLog = fs.readFileSync(debugLogPath, 'utf-8');
    if (!debugLog.includes('browser:navigate') || !debugLog.includes('browser:snapshot') || !debugLog.includes('browser:screenshot')) {
      throw new Error(`Workflow browser step debug log is missing bridge actions: ${debugLog}`);
    }

    const pageTitle = result.browse.output?.pageTitle;
    if (typeof pageTitle !== 'string' || pageTitle.trim().length === 0) {
      throw new Error(`Workflow browser step pageTitle is missing: ${JSON.stringify(result.browse)}`);
    }

    const pageUrl = result.browse.output?.pageUrl;
    if (typeof pageUrl !== 'string' || pageUrl.trim().length === 0) {
      throw new Error(`Workflow browser step pageUrl is missing: ${JSON.stringify(result.browse)}`);
    }

    const snapshotHasContent = result.browse.output?.snapshotHasContent;
    if (snapshotHasContent !== true) {
      throw new Error(`Workflow browser step snapshot content is empty: ${JSON.stringify(result.browse)}`);
    }

    const screenshotPath = result.browse.output?.screenshotPath;
    if (typeof screenshotPath !== 'string' || !fs.existsSync(screenshotPath)) {
      throw new Error(`Workflow browser screenshot artifact is missing: ${JSON.stringify(result.browse)}`);
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
      debugLogPath,
      pageTitle,
      pageUrl,
      screenshotPath,
      bridgeReady: true,
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
