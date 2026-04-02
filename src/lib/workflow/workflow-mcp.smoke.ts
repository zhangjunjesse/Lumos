import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GenerateWorkflowResult } from './types';

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
  const previousApiBase = process.env.LUMOS_API_BASE;
  const previousDisableStdio = process.env.LUMOS_WORKFLOW_MCP_NO_STDIN;
  const previousNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-workflow-mcp-'));

  process.env.LUMOS_DATA_DIR = tempDir;
  process.env.LUMOS_API_BASE = 'http://localhost:3000';
  process.env.LUMOS_WORKFLOW_MCP_NO_STDIN = '1';
  process.env.NODE_ENV = 'test';
  fs.closeSync(fs.openSync(path.join(tempDir, 'lumos.db'), 'w'));

  const { handleGenerateWorkflowTool } = await import('./mcp-tool');
  const {
    getWorkflowStatus,
    resetWorkflowEngineForTests,
    shutdownWorker,
    submitWorkflow,
  } = await import('./engine');

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/workflow/generate')) {
      try {
        const bodyText = typeof init?.body === 'string' ? init.body : '';
        const payload = handleGenerateWorkflowTool(JSON.parse(bodyText));
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    }

    if (!originalFetch) {
      throw new Error(`Unhandled fetch in workflow MCP smoke: ${url}`);
    }

    return originalFetch(input as any, init);
  };

  try {
    await resetWorkflowEngineForTests();
    const { handleRequest } = await import('../../../resources/mcp-servers/workflow/workflow_mcp.mjs');

    const initializeResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {},
    });

    if (!('result' in initializeResponse)) {
      throw new Error('Workflow MCP initialize failed');
    }

    const listToolsResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 'list-1',
      method: 'tools/list',
      params: {},
    });

    if (
      !('result' in listToolsResponse)
      || !Array.isArray(listToolsResponse.result.tools)
      || !listToolsResponse.result.tools.some((tool) => tool.name === 'generate_workflow')
    ) {
      throw new Error('Workflow MCP tools/list did not expose generate_workflow');
    }

    const invalidToolCallResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 'call-invalid',
      method: 'tools/call',
      params: {
        name: 'generate_workflow',
        arguments: {
          spec: {
            version: 'v1',
            name: 'invalid-agent',
            steps: [
              {
                id: 'bad',
                type: 'agent',
                input: {},
              },
            ],
          },
        },
      },
    });

    if (!('result' in invalidToolCallResponse)) {
      throw new Error(`Workflow MCP invalid tool call failed unexpectedly: ${JSON.stringify(invalidToolCallResponse)}`);
    }

    const invalidContent = invalidToolCallResponse.result.content?.[0]?.text;
    if (typeof invalidContent !== 'string') {
      throw new Error('Workflow MCP invalid call returned empty content');
    }

    const invalidArtifact = JSON.parse(invalidContent) as GenerateWorkflowResult;
    if (invalidArtifact.validation.valid) {
      throw new Error('Workflow MCP invalid spec unexpectedly passed validation');
    }

    const toolCallResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'generate_workflow',
        arguments: {
          spec: {
            version: 'v1',
            name: 'agent-mcp-smoke',
            steps: [
              {
                id: 'draft',
                type: 'agent',
                input: {
                  prompt: 'Write a smoke-test reply via MCP',
                  role: 'coder',
                },
              },
            ],
          },
        },
      },
    });

    if (!('result' in toolCallResponse)) {
      throw new Error(`Workflow MCP tool call failed: ${JSON.stringify(toolCallResponse)}`);
    }

    const content = toolCallResponse.result.content?.[0]?.text;
    if (typeof content !== 'string') {
      throw new Error('Workflow MCP returned empty content');
    }

    const artifact = JSON.parse(content) as GenerateWorkflowResult;
    if (!artifact.validation.valid) {
      throw new Error(`Workflow MCP validation failed: ${artifact.validation.errors.join('; ')}`);
    }

    const submitResult = await submitWorkflow({
      taskId: 'task-mcp-smoke-001',
      workflowCode: artifact.code,
      workflowManifest: artifact.manifest,
      inputs: {},
    });

    if (submitResult.status !== 'accepted') {
      throw new Error(`Workflow submission failed: ${(submitResult.errors ?? []).join('; ')}`);
    }

    const status = await waitForWorkflowCompletion(submitResult.workflowId, getWorkflowStatus);
    console.log(JSON.stringify({
      initializeResponse,
      listToolsResponse,
      invalidArtifact,
      artifact,
      workflowId: submitResult.workflowId,
      status,
    }, null, 2));

    if (status?.status !== 'completed') {
      throw new Error(`Workflow finished with unexpected status: ${status?.status}`);
    }

    if (artifact.manifest.stepIds.join(',') !== 'draft') {
      throw new Error(`Workflow MCP manifest is missing stable stepIds: ${JSON.stringify(artifact.manifest)}`);
    }

    if (status.completedSteps.join(',') !== 'draft') {
      throw new Error(`Workflow MCP status is missing completedSteps: ${JSON.stringify(status)}`);
    }

    const result = status.result as Record<string, {
      success?: boolean;
      metadata?: Record<string, unknown>;
    } | null> | undefined;
    const draftResult = result?.draft;
    if (!draftResult?.success) {
      throw new Error(`Workflow MCP agent step did not succeed: ${JSON.stringify(status.result)}`);
    }

    if (draftResult.metadata?.stepId !== 'draft') {
      throw new Error(`Workflow MCP agent step lost stable stepId metadata: ${JSON.stringify(draftResult)}`);
    }

    if (draftResult.metadata?.workflowRunId !== submitResult.workflowId) {
      throw new Error(`Workflow MCP agent step metadata is missing workflowRunId: ${JSON.stringify(draftResult)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await shutdownWorker();
    await resetWorkflowEngineForTests();

    if (previousDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = previousDataDir;
    }

    if (previousApiBase === undefined) {
      delete process.env.LUMOS_API_BASE;
    } else {
      process.env.LUMOS_API_BASE = previousApiBase;
    }

    if (previousDisableStdio === undefined) {
      delete process.env.LUMOS_WORKFLOW_MCP_NO_STDIN;
    } else {
      process.env.LUMOS_WORKFLOW_MCP_NO_STDIN = previousDisableStdio;
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
