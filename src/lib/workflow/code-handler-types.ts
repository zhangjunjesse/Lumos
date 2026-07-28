import type { StepResult, WorkflowStepRuntimeContext } from './types';
import type { CodeExecOptions, CodeExecResult } from './code-exec';

/**
 * 浏览器 Bridge 操作接口
 * 封装 Bridge Server HTTP API，代码脚本通过 ctx.browser 使用
 *
 * 注意：click/fill 使用 uid（通过 snapshot 获取），不是 CSS selector
 * waitFor 等待页面中出现指定文本，不是 CSS selector
 */
export interface BrowserBridgeApi {
  /** 导航到指定 URL */
  navigate(url: string): Promise<void>;
  /** 点击元素（优先使用 uid；兼容历史 text 目标会先从 snapshot 解析 uid） */
  click(target: string | { text: string }): Promise<void>;
  /** 填充输入框（uid 来自 snapshot） */
  fill(uid: string, value: string): Promise<void>;
  /** 键盘输入文本，可选 submitKey 如 "Enter" */
  type(text: string, submitKey?: string): Promise<void>;
  /** 按键（如 "Enter"、"Tab"） */
  press(key: string): Promise<void>;
  /** 等待页面中出现指定文本（不是 CSS selector） */
  waitFor(texts: string | string[], options?: { timeout?: number }): Promise<void>;
  /** 在页面中执行 JS 并返回结果 */
  evaluate<T = unknown>(script: string): Promise<T>;
  /** 获取页面结构快照（包含元素 uid，用于 click/fill） */
  snapshot(): Promise<{ title: string; content: string; url?: string }>;
  /** 截图（返回本地文件路径） */
  screenshot(): Promise<string>;
  /** 列出所有页签 */
  pages(): Promise<Array<{ id: string; url: string; title: string }>>;
  /** 当前页签信息 */
  currentPage(): Promise<{ id: string; url: string; title: string }>;
  /** 打开新页签 */
  newPage(url?: string): Promise<{ id: string }>;
  /** 切换到指定页签 */
  selectPage(id: string): Promise<void>;
  /** 关闭页签 */
  closePage(id: string): Promise<void>;
  /** 释放当前浏览器上下文运行态占用租约 */
  release(): Promise<void>;
  /** 是否已连接到 Bridge Server */
  readonly connected: boolean;
}

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
  /** 浏览器操作（通过 Bridge Server 共享同一个浏览器实例） */
  browser: BrowserBridgeApi;
  /**
   * 本步骤的产出目录（已自动创建）。往这里写入的文件会自动被"本步产出"收录并支持预览/下载。
   * 例：`path.join(ctx.outputDir, 'main', 'img_01.jpg')`。
   * 禁止写 `/tmp` 或任何此目录之外的绝对路径。
   */
  outputDir: string;
  /**
   * 便捷写入产出:接受 Buffer 或源文件路径,返回最终落盘的绝对路径。
   * - source 是 Buffer:必须提供 name(含扩展名)。
   * - source 是字符串:视为源文件路径,name 缺省时用 basename。
   * - name 可带子目录,如 `main/img_01.jpg`,子目录会自动创建。
   */
  saveArtifact(source: Buffer | string, name?: string): Promise<string>;
  /**
   * 执行外部命令(python / ffmpeg / ImageMagick 等),异步。
   * 例:`const { stdout } = await ctx.exec('python', [script, '--arg', v])`
   *
   * 优先用它而不是 `child_process.execFileSync` —— 取消工作流时它能真的把命令进程
   * 杀掉,同步版本做不到,进程会变孤儿继续跑(#54)。
   * 命令非 0 退出时抛错,错误对象上带 stdout / stderr。
   */
  exec(
    command: string,
    args?: readonly string[],
    options?: CodeExecOptions,
  ): Promise<CodeExecResult>;
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
