// 主线程侧的 worker 宿主(#54)。
//
// 病史:内联脚本原先直接在主线程 new Function 跑。脚本一用 execFileSync 这类同步
// 子进程 API,整条事件循环冻住,openworkflow 的续租心跳(setInterval)跟着停跳;
// 30 秒租约过期后 run 被重新 claim、worker_id 改写,脚本跑完再去写回时被
// completeStepAttempt 的 worker_id 校验挡下(更新 0 行并抛错),步骤永远停在
// running,调度器无限重放 —— 实测单个 run 重放 515 次,每次都真跑一遍有副作用的
// python + ImageMagick。
//
// 根治点只有一个:脚本不能和心跳共用事件循环。openworkflow 的租约是 30s 硬编码
// (WorkerOptions 只有 backend/workflows/concurrency,改不了),所以把脚本挪到
// worker 线程 —— 它爱怎么阻塞怎么阻塞,冻的是自己那条线。
//
// 附带修好的:同步冻结时 AbortSignal 形同虚设,取消按不动;worker 可以 terminate。

import { Worker } from 'node:worker_threads';
import type { CodeHandlerContext } from './code-handler-types';
import {
  CODE_WORKER_RPC_METHODS,
  CODE_WORKER_SOURCE,
  type CodeWorkerInbound,
  type CodeWorkerOutbound,
} from './code-worker-source';

const BROWSER_PREFIX = 'browser.';

const BROWSER_METHODS = CODE_WORKER_RPC_METHODS
  .filter((method) => method.startsWith(BROWSER_PREFIX))
  .map((method) => method.slice(BROWSER_PREFIX.length));

const RPC_ALLOWLIST = new Set<string>(CODE_WORKER_RPC_METHODS);

/** 脚本里能直接读到的 ctx 字段:纯数据,structuredClone 得过去。 */
function pickSerializableCtx(ctx: CodeHandlerContext): Record<string, unknown> {
  return {
    params: ctx.params ?? {},
    stepId: ctx.stepId,
    workflowRunId: ctx.workflowRunId,
    workingDirectory: ctx.workingDirectory,
    upstreamOutputs: ctx.upstreamOutputs ?? {},
    runtimeContext: ctx.runtimeContext,
    outputDir: ctx.outputDir,
  };
}

/** structuredClone 把 Buffer 降成 Uint8Array;saveArtifact 的契约要的是 Buffer。 */
function reviveBinary(value: unknown): unknown {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  return value;
}

async function dispatchRpc(
  ctx: CodeHandlerContext,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (!RPC_ALLOWLIST.has(method)) {
    throw new Error(`Unsupported workflow code host call: ${method}`);
  }

  if (method === 'saveArtifact') {
    const [source, name] = args;
    return ctx.saveArtifact(reviveBinary(source) as Buffer | string, name as string | undefined);
  }

  if (method === 'exec') {
    const [command, execArgs, options] = args as Parameters<CodeHandlerContext['exec']>;
    return ctx.exec(command, execArgs, options);
  }

  const browserMethod = method.slice(BROWSER_PREFIX.length) as keyof CodeHandlerContext['browser'];
  const target = ctx.browser?.[browserMethod];
  if (typeof target !== 'function') {
    throw new Error(`Browser bridge method unavailable: ${method}`);
  }
  return (target as (...callArgs: unknown[]) => Promise<unknown>).apply(ctx.browser, args);
}

interface ScriptConsole {
  log?(...args: unknown[]): void;
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}

function emitConsole(
  scriptConsole: ScriptConsole,
  level: 'info' | 'warn' | 'error',
  args: unknown[],
): void {
  // 脚本里的 log/info/debug 都归 info —— 和改造前 createInlineScriptConsole 的分级一致。
  const sink = level === 'info' ? scriptConsole.log ?? scriptConsole.info : scriptConsole[level];
  sink?.call(scriptConsole, ...args);
}

function toError(payload: { name: string; message: string; stack?: string }): Error {
  const error = new Error(payload.message);
  error.name = payload.name;
  if (payload.stack) {
    error.stack = payload.stack;
  }
  return error;
}

/**
 * 在独立 worker 线程里执行内联脚本。
 *
 * @param script 用户脚本(async function body)
 * @param ctx 执行上下文;browser / saveArtifact 通过 RPC 回主线程执行
 * @param scriptConsole 脚本内 console 的接收端
 * @param globals 注入清单(顺序即 worker 内 new Function 的传参顺序)
 * @returns 脚本原始返回值
 */
export function runScriptInWorker(
  script: string,
  ctx: CodeHandlerContext,
  scriptConsole: ScriptConsole,
  globals: readonly string[],
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(CODE_WORKER_SOURCE, {
      eval: true,
      workerData: {
        script,
        globals: [...globals],
        ctxData: pickSerializableCtx(ctx),
        browserMethods: BROWSER_METHODS,
        browserConnected: Boolean(ctx.browser?.connected),
      },
      // 脚本里的 process.stdout 直接落到宿主日志,和改造前行为一致。
      stdout: false,
      stderr: false,
    });

    let settled = false;
    const post = (message: CodeWorkerInbound) => worker.postMessage(message);

    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      ctx.signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      run();
    };

    function onAbort() {
      // 先给异步脚本一个响应 abort 的机会;真被同步代码冻住时 terminate 才是唯一出路。
      //
      // terminate 的生效程度分两种,别高估:纯 JS 忙等会被 V8 TerminateExecution 立刻
      // 掐断;卡在原生同步调用里(execFileSync 的 waitpid)则要等系统调用自己返回,
      // 已经 spawn 出去的 python/ImageMagick 也不会被连带杀掉。这里能保证的是
      // 「工作流立即不再等它」—— 主线程不被拖住,run 能正常走终态。
      post({ kind: 'abort' });
      finish(() => reject(new Error('Workflow code execution aborted')));
    }

    if (ctx.signal?.aborted) {
      finish(() => reject(new Error('Workflow code execution aborted')));
      return;
    }
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    worker.on('message', (message: CodeWorkerOutbound) => {
      if (message.kind === 'console') {
        emitConsole(scriptConsole, message.level, message.args);
        return;
      }

      if (message.kind === 'rpc') {
        dispatchRpc(ctx, message.method, message.args)
          .then((value) => post({ kind: 'rpc-result', id: message.id, ok: true, value }))
          .catch((error: unknown) => {
            const err = error instanceof Error ? error : new Error(String(error));
            post({
              kind: 'rpc-result',
              id: message.id,
              ok: false,
              error: { name: err.name, message: err.message },
            });
          });
        return;
      }

      if (message.kind === 'done') {
        finish(() => (message.ok ? resolve(message.value) : reject(toError(message.error))));
      }
    });

    worker.on('error', (error: Error) => {
      finish(() => reject(error));
    });

    worker.on('exit', (code: number) => {
      // 正常路径上 done 已经 settle 过了;走到这里说明 worker 是被外力干掉的。
      finish(() => reject(new Error(`Workflow code worker exited unexpectedly (code ${code})`)));
    });
  });
}
