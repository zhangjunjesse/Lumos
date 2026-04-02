import type { AgentStepInput, WorkflowStepRuntimeContext } from './types';
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
  return (code.strategy ?? 'code-first') !== 'agent-only';
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
 * 执行代码处理器
 * 返回 null 表示应该继续走 agent 路径
 */
export async function executeCodeHandler(
  input: AgentStepInput,
  runtimeContext: WorkflowStepRuntimeContext,
  signal?: AbortSignal,
): Promise<CodeExecutionOutcome | null> {
  const code = input.code;
  if (!shouldExecuteCode(code)) return null;

  const handler = getCodeHandler(code!.handler);
  if (!handler) {
    const msg = `Code handler "${code!.handler}" not found`;
    if ((code!.strategy ?? 'code-first') === 'code-only') {
      return {
        result: { success: false, output: null, error: msg },
        executedVia: 'code',
        codeError: msg,
      };
    }
    console.warn(`[code-executor] ${msg}, falling back to agent`);
    return null;
  }

  const ctx = buildHandlerContext(input, runtimeContext, code!, signal);

  try {
    const result = await handler.execute(ctx);
    if (result.success) {
      return { result, executedVia: 'code' };
    }

    // 代码执行返回失败
    if (!shouldFallbackToAgent(code)) {
      return { result, executedVia: 'code', codeError: result.error };
    }

    console.warn(
      `[code-executor] Handler "${code!.handler}" failed: ${result.error}, falling back to agent`,
    );
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if ((code!.strategy ?? 'code-first') === 'code-only') {
      return {
        result: { success: false, output: null, error: errorMsg },
        executedVia: 'code',
        codeError: errorMsg,
      };
    }

    console.warn(
      `[code-executor] Handler "${code!.handler}" threw: ${errorMsg}, falling back to agent`,
    );
    return null;
  }
}
