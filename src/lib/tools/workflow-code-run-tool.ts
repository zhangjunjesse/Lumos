import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { createBrowserBridgeApi } from '@/lib/workflow/code-browser-bridge';
import type { CodeHandlerContext } from '@/lib/workflow/code-handler-types';
import type { StepResult } from '@/lib/workflow/types';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const MAX_EXECUTION_MS = 60_000;
const MAX_LOG_LINES = 200;

const inputSchema = {
  script: z.string().describe(
    'JavaScript async function body to execute. '
    + 'Available: ctx.browser (browser bridge), ctx.params, ctx.upstreamOutputs, fetch, console. '
    + 'Must return { success: boolean, output: { summary: string } }.',
  ),
  params: z.record(z.string(), z.unknown()).optional().describe(
    'Parameters passed as ctx.params.',
  ),
  upstreamOutputs: z.record(z.string(), z.unknown()).optional().describe(
    'Simulated upstream step outputs passed as ctx.upstreamOutputs.',
  ),
  timeoutMs: z.number().optional().describe(
    'Execution timeout in milliseconds (default 30000, max 60000).',
  ),
};

export function createWorkflowCodeRunTool() {
  return tool(
    'run_workflow_code',
    'Execute a JavaScript code snippet in the workflow code runtime. '
    + 'Use this to test, debug, or verify workflow step code. '
    + 'The script runs with the same ctx.browser, fetch, and console as production. '
    + 'Returns execution result, console output, and duration.',
    inputSchema,
    async (args): Promise<CallToolResult> => {
      const timeoutMs = Math.min(args.timeoutMs ?? 30_000, MAX_EXECUTION_MS);

      const logs: string[] = [];
      const push = (prefix: string, items: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) logs.push(`${prefix}${items.map(String).join(' ')}`);
      };
      const captureConsole = {
        log: (...a: unknown[]) => push('', a),
        warn: (...a: unknown[]) => push('[warn] ', a),
        error: (...a: unknown[]) => push('[error] ', a),
        info: (...a: unknown[]) => push('[info] ', a),
        debug: (...a: unknown[]) => push('[debug] ', a),
      };

      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutMs);

      const ctx: CodeHandlerContext = {
        params: args.params ?? {},
        stepId: '__debug__',
        workflowRunId: '__debug__',
        upstreamOutputs: args.upstreamOutputs ?? {},
        runtimeContext: { workflowRunId: '__debug__', stepId: '__debug__', stepType: 'agent' },
        signal: abortController.signal,
        browser: createBrowserBridgeApi(),
      };

      const startMs = Date.now();

      try {
        const fn = new Function('ctx', 'fetch', 'console', `return (async () => { ${args.script} })()`) as
          (ctx: CodeHandlerContext, fetch: typeof globalThis.fetch, console: typeof captureConsole) => Promise<StepResult>;
        const result = await fn(ctx, globalThis.fetch, captureConsole);
        const durationMs = Date.now() - startMs;

        const normalized: StepResult = (result && typeof result === 'object' && typeof result.success === 'boolean')
          ? result
          : { success: true, output: { summary: String(result ?? '') } };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: normalized.success,
              output: normalized.output,
              error: normalized.error,
              logs,
              durationMs,
            }, null, 2),
          }],
        };
      } catch (error) {
        const durationMs = Date.now() - startMs;
        const isTimeout = abortController.signal.aborted;
        const message = isTimeout
          ? `执行超时 (${timeoutMs}ms)`
          : (error instanceof Error ? error.message : String(error));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: message,
              stack: error instanceof Error ? error.stack : undefined,
              logs,
              durationMs,
            }, null, 2),
          }],
          isError: true,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  );
}
