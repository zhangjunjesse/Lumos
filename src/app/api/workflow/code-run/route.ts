import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { mkdirSync } from 'fs';
import { copyFile, mkdir, writeFile } from 'fs/promises';
import { createBrowserBridgeApi } from '@/lib/workflow/code-browser-bridge';
import { normalizeScriptResult, runInlineScript } from '@/lib/workflow/code-sandbox';
import { runExternalCommand } from '@/lib/workflow/code-exec';
import type { CodeHandlerContext } from '@/lib/workflow/code-handler-types';

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

    const debugOutputDir = path.join(os.tmpdir(), 'lumos-code-debug', `run-${Date.now()}`);
    try { mkdirSync(debugOutputDir, { recursive: true }); } catch { /* ignore */ }

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
      // 生产、本路由、run_workflow_code 三条路径的 ctx 必须一致 —— 差一个字段,
      // AI 照提示词写的脚本就会「生产能跑、一调试就报 undefined」(#46 的老坑)。
      exec: (command, execArgs, options) => runExternalCommand(
        command,
        execArgs,
        options,
        abortController.signal,
      ),
      outputDir: debugOutputDir,
      saveArtifact: async (source, name) => {
        const relName = name ?? (typeof source === 'string' ? path.basename(source) : undefined);
        if (!relName) throw new Error('saveArtifact: name is required when source is a Buffer');
        if (path.isAbsolute(relName) || relName.split(/[\\/]+/).includes('..')) {
          throw new Error(`saveArtifact: name must be a relative path: ${relName}`);
        }
        const target = path.join(debugOutputDir, relName);
        await mkdir(path.dirname(target), { recursive: true });
        if (typeof source === 'string') {
          await copyFile(source, target);
        } else {
          await writeFile(target, source);
        }
        return target;
      },
    };

    const startMs = Date.now();

    try {
      // 与生产 code 节点共用同一份注入清单(含 fs/path);曾各自 new Function 导致漂移(#46)
      const result = await runInlineScript(input.script, ctx, captureConsole);
      const durationMs = Date.now() - startMs;

      const normalized = normalizeScriptResult(result);

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
