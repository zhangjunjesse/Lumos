import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createBrowserBridgeApi } from '@/lib/workflow/code-browser-bridge';
import type { CodeHandlerContext } from '@/lib/workflow/code-handler-types';
import type { StepResult } from '@/lib/workflow/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_EXECUTION_MS = 60_000;
const MAX_LOG_LINES = 200;

const requestSchema = z.object({
  script: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  upstreamOutputs: z.record(z.string(), z.unknown()).optional().default({}),
  timeoutMs: z.number().int().min(1000).max(MAX_EXECUTION_MS).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);
    const timeoutMs = input.timeoutMs ?? 30_000;

    const logs: string[] = [];
    const captureConsole = {
      log: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) logs.push(args.map(String).join(' '));
      },
      warn: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) logs.push(`[warn] ${args.map(String).join(' ')}`);
      },
      error: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) logs.push(`[error] ${args.map(String).join(' ')}`);
      },
      info: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) logs.push(`[info] ${args.map(String).join(' ')}`);
      },
      debug: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) logs.push(`[debug] ${args.map(String).join(' ')}`);
      },
    };

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    const ctx: CodeHandlerContext = {
      params: input.params,
      stepId: '__debug__',
      workflowRunId: '__debug__',
      upstreamOutputs: input.upstreamOutputs,
      runtimeContext: {
        workflowRunId: '__debug__',
        stepId: '__debug__',
        stepType: 'agent',
      },
      signal: abortController.signal,
      browser: createBrowserBridgeApi(),
    };

    const startMs = Date.now();

    try {
      const fn = new Function('ctx', 'fetch', 'console', `return (async () => { ${input.script} })()`) as
        (ctx: CodeHandlerContext, fetch: typeof globalThis.fetch, console: typeof captureConsole) => Promise<StepResult>;
      const result = await fn(ctx, globalThis.fetch, captureConsole);
      const durationMs = Date.now() - startMs;

      const normalized: StepResult = (result && typeof result === 'object' && typeof result.success === 'boolean')
        ? result
        : { success: true, output: { summary: String(result ?? '') } };

      return NextResponse.json({
        success: normalized.success,
        output: normalized.output,
        error: normalized.error,
        logs,
        durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const isTimeout = abortController.signal.aborted;
      const message = isTimeout
        ? `执行超时 (${timeoutMs}ms)`
        : (error instanceof Error ? error.message : String(error));
      const stack = error instanceof Error ? error.stack : undefined;

      return NextResponse.json({
        success: false,
        output: null,
        error: message,
        stack,
        logs,
        durationMs,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '参数解析失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
