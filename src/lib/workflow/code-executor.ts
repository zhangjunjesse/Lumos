import type { AgentStepInput, StepResult, WorkflowStepRuntimeContext } from './types';
import type {
  AgentStepCodeConfig,
  CodeExecutionOutcome,
  CodeHandlerContext,
} from './code-handler-types';
import { getCodeHandler } from './code-handler-registry';

/**
 * 判断是否应该走代码执行路径
 */
export function shouldExecuteCode(code: AgentStepCodeConfig | undefined): boolean {
  if (!code) return false;
  if ((code.strategy ?? 'code-first') === 'agent-only') return false;
  return Boolean(code.script?.trim() || code.handler);
}

/**
 * 判断代码失败后是否应该回退到 agent
 */
export function shouldFallbackToAgent(code: AgentStepCodeConfig | undefined): boolean {
  if (!code) return false;
  return (code.strategy ?? 'code-first') === 'code-first';
}

function buildHandlerContext(
  input: AgentStepInput,
  runtimeContext: WorkflowStepRuntimeContext,
  code: AgentStepCodeConfig,
  signal?: AbortSignal,
): CodeHandlerContext {
  return {
    params: code.params ?? {},
    stepId: runtimeContext.stepId,
    workflowRunId: runtimeContext.workflowRunId,
    workingDirectory: runtimeContext.workingDirectory,
    upstreamOutputs: (input.context as Record<string, unknown>) ?? {},
    runtimeContext,
    signal,
  };
}

/**
 * 执行内联脚本
 * 脚本是一段 async function body，可以使用 ctx 变量，返回 StepResult
 */
async function executeInlineScript(
  script: string,
  ctx: CodeHandlerContext,
): Promise<StepResult> {
  const fn = new Function('ctx', 'fetch', 'console', `return (async () => { ${script} })()`) as
    (ctx: CodeHandlerContext, fetch: typeof globalThis.fetch, console: Console) => Promise<StepResult>;
  const result = await fn(ctx, globalThis.fetch, console);
  if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
    return { success: true, output: { summary: String(result ?? '') } };
  }
  return result;
}

/**
 * 执行代码处理器（内联脚本或注册的 handler）
 * 返回 null 表示应该继续走 agent 路径
 */
export async function executeCodeHandler(
  input: AgentStepInput,
  runtimeContext: WorkflowStepRuntimeContext,
  signal?: AbortSignal,
): Promise<CodeExecutionOutcome | null> {
  const code = input.code;
  if (!shouldExecuteCode(code)) return null;

  const ctx = buildHandlerContext(input, runtimeContext, code!, signal);

  // 优先执行内联脚本
  if (code!.script?.trim()) {
    return await runWithFallback(code!, () => executeInlineScript(code!.script!, ctx));
  }

  // 回退到注册的 handler
  if (code!.handler) {
    const handler = getCodeHandler(code!.handler);
    if (!handler) {
      const msg = `Code handler "${code!.handler}" not found`;
      if ((code!.strategy ?? 'code-first') === 'code-only') {
        return { result: { success: false, output: null, error: msg }, executedVia: 'code', codeError: msg };
      }
      console.warn(`[code-executor] ${msg}, falling back to agent`);
      return null;
    }
    return await runWithFallback(code!, () => handler.execute(ctx));
  }

  return null;
}

async function runWithFallback(
  code: AgentStepCodeConfig,
  execute: () => Promise<StepResult>,
): Promise<CodeExecutionOutcome | null> {
  try {
    const result = await execute();
    if (result.success) {
      return { result, executedVia: 'code' };
    }
    if (!shouldFallbackToAgent(code)) {
      return { result, executedVia: 'code', codeError: result.error };
    }
    console.warn(`[code-executor] Code failed: ${result.error}, falling back to agent`);
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if ((code.strategy ?? 'code-first') === 'code-only') {
      return { result: { success: false, output: null, error: errorMsg }, executedVia: 'code', codeError: errorMsg };
    }
    console.warn(`[code-executor] Code threw: ${errorMsg}, falling back to agent`);
    return null;
  }
}
