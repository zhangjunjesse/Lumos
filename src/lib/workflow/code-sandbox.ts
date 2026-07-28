// 工作流内联脚本沙箱:注入清单与结果归一化的单一真源。
//
// 生产 code 节点、run_workflow_code 工具、编辑器「运行」按钮曾各自 new Function,
// 注入清单漂了 —— 只有生产补了 fs/path,两个调试路径没有。结果 AI 照文档写出能在
// 生产跑通的脚本,一调试就 "fs is not defined",把对的代码判成坏的(#46)。
// 注入清单只允许存在于这一处;新增全局也只改这里。

import type { StepResult } from './types';
import type { CodeHandlerContext } from './code-handler-types';
import { runScriptInWorker } from './code-worker-host';

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
  + '执行本地命令/python 一律用 ctx.exec,例:'
  + 'const { stdout } = await ctx.exec("python", [script, "--arg", v]);'
  + '命令失败会抛异常(错误里带 stderr),要 try/catch 并把原因写进 error。'
  + '不要用 child_process.execFileSync / spawnSync / execSync —— 取消工作流时它们杀不掉,'
  + '命令进程会变成孤儿继续跑。'
  + '注意没有 require —— 上面这些模块已是全局,直接用,不要写 require("child_process")。';

/**
 * 执行内联脚本(async function body)。返回脚本原始返回值,不做归一化。
 *
 * 脚本跑在独立 worker 线程里(#54)。它原先和 openworkflow 的续租心跳共用主线程
 * 事件循环,一个 execFileSync 就能把心跳冻死 → 丢租约 → 写回被 worker_id 校验挡下
 * → 步骤永远 running → 无限重放(实测 515 次,每次都真跑一遍有副作用的脚本)。
 * 注入清单和 new Function 的用法没变,变的只是它跑在哪条事件循环上。
 */
export async function runInlineScript(
  script: string,
  ctx: CodeHandlerContext,
  scriptConsole: unknown,
): Promise<unknown> {
  return runScriptInWorker(
    script,
    ctx,
    scriptConsole as Parameters<typeof runScriptInWorker>[2],
    CODE_SANDBOX_GLOBALS,
  );
}

/** 脚本返回值归一化成 StepResult:没按约定返回就把返回值当 summary。 */
export function normalizeScriptResult(result: unknown): StepResult {
  if (result && typeof result === 'object' && typeof (result as StepResult).success === 'boolean') {
    return result as StepResult;
  }
  return { success: true, output: { summary: String(result ?? '') } };
}
