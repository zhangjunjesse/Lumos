// 工作流内联脚本沙箱:注入清单与结果归一化的单一真源。
//
// 生产 code 节点、run_workflow_code 工具、编辑器「运行」按钮曾各自 new Function,
// 注入清单漂了 —— 只有生产补了 fs/path,两个调试路径没有。结果 AI 照文档写出能在
// 生产跑通的脚本,一调试就 "fs is not defined",把对的代码判成坏的(#46)。
// 注入清单只允许存在于这一处;新增全局也只改这里。

import type { StepResult } from './types';
import type { CodeHandlerContext } from './code-handler-types';

/** 沙箱注入的全局名单(顺序即 runInlineScript 传参顺序)。 */
export const CODE_SANDBOX_GLOBALS = [
  'ctx', 'fetch', 'console', 'fs', 'path', 'os', 'child_process',
] as const;

/**
 * 给 LLM 看的能力说明。提示词/工具描述引用这个常量,不要各自手写清单,
 * 否则文档又会和实现漂开。
 */
export const CODE_SANDBOX_CAPABILITY_HINT =
  '脚本可用全局:ctx、fetch、console、fs、path、os、child_process(生产与调试完全一致)。'
  + '执行本地命令/python 用 child_process,例:'
  + 'child_process.execFileSync("python", [script, "--arg", v], { encoding: "utf8" })。'
  + '注意没有 require —— 上面这些模块已是全局,直接用,不要写 require("child_process")。';

/** 执行内联脚本(async function body)。返回脚本原始返回值,不做归一化。 */
export async function runInlineScript(
  script: string,
  ctx: CodeHandlerContext,
  scriptConsole: unknown,
): Promise<unknown> {
  const [nodeFs, nodePath, nodeOs, nodeChildProcess] = await Promise.all([
    import('fs'),
    import('path'),
    import('os'),
    import('child_process'),
  ]);
  const fn = new Function(
    ...[...CODE_SANDBOX_GLOBALS],
    `return (async () => { ${script} })()`,
  ) as (...args: unknown[]) => Promise<unknown>;
  return await fn(
    ctx, globalThis.fetch, scriptConsole, nodeFs, nodePath, nodeOs, nodeChildProcess,
  );
}

/** 脚本返回值归一化成 StepResult:没按约定返回就把返回值当 summary。 */
export function normalizeScriptResult(result: unknown): StepResult {
  if (result && typeof result === 'object' && typeof (result as StepResult).success === 'boolean') {
    return result as StepResult;
  }
  return { success: true, output: { summary: String(result ?? '') } };
}
