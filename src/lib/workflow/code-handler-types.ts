import type { StepResult, WorkflowStepRuntimeContext } from './types';

/**
 * 代码处理器执行上下文
 * 提供给 handler 函数的运行时信息
 */
export interface CodeHandlerContext {
  /** handler 定义的参数 */
  params: Record<string, unknown>;
  /** 当前步骤 ID */
  stepId: string;
  /** 工作流运行 ID */
  workflowRunId: string;
  /** 工作目录 */
  workingDirectory?: string;
  /** 上游步骤输出（通过 context 传入） */
  upstreamOutputs: Record<string, unknown>;
  /** 运行时上下文（完整） */
  runtimeContext: WorkflowStepRuntimeContext;
  /** AbortSignal（支持取消） */
  signal?: AbortSignal;
}

/**
 * 代码处理器定义
 */
export interface CodeHandler {
  /** 唯一标识，如 "cross-border/download-report" */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 执行函数 */
  execute: (ctx: CodeHandlerContext) => Promise<StepResult>;
}

/**
 * Agent 步骤的代码模式配置
 */
export type CodeExecutionStrategy = 'code-only' | 'code-first' | 'agent-only';

export interface AgentStepCodeConfig {
  /** 注册的代码处理器 ID（文件注册方式） */
  handler?: string;
  /** 内联脚本（由 Codify Agent 生成或用户编写） */
  script?: string;
  /** 传给处理器的参数 */
  params?: Record<string, unknown>;
  /** 执行策略，默认 code-first */
  strategy?: CodeExecutionStrategy;
}

/**
 * 代码执行结果（包含 fallback 信息）
 */
export interface CodeExecutionOutcome {
  /** 最终结果 */
  result: StepResult;
  /** 实际使用的执行路径 */
  executedVia: 'code' | 'agent';
  /** code-first 失败时的错误信息 */
  codeError?: string;
}
