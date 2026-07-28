// worker 线程里跑的代码(#54)。以字符串形式交给 `new Worker(src, { eval: true })`,
// 所以它必须自包含:只能用 Node 内置模块,不能 import 任何 Lumos 模块
// —— 生产是 webpack bundle,worker 里没有可解析的模块路径。
//
// 需要宿主能力的字段(ctx.browser.*、ctx.saveArtifact)在这里只是 RPC 桩,
// 调用被转回主线程执行。宿主侧实现见 code-worker-host.ts。

/** ctx 里走 RPC 的方法(host 侧按同一张表派发,不接受表外方法)。 */
export const CODE_WORKER_RPC_METHODS = [
  'browser.navigate', 'browser.click', 'browser.fill', 'browser.type', 'browser.press',
  'browser.waitFor', 'browser.evaluate', 'browser.snapshot', 'browser.screenshot',
  'browser.pages', 'browser.currentPage', 'browser.newPage', 'browser.selectPage',
  'browser.closePage', 'browser.release',
  'saveArtifact',
  'exec',
] as const;

export type CodeWorkerRpcMethod = typeof CODE_WORKER_RPC_METHODS[number];

/** worker → host */
export type CodeWorkerOutbound =
  | { kind: 'rpc'; id: number; method: string; args: unknown[] }
  | { kind: 'console'; level: 'info' | 'warn' | 'error'; args: unknown[] }
  | { kind: 'done'; ok: true; value: unknown }
  | { kind: 'done'; ok: false; error: { name: string; message: string; stack?: string } };

/** host → worker */
export type CodeWorkerInbound =
  | { kind: 'rpc-result'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-result'; id: number; ok: false; error: { name: string; message: string } }
  | { kind: 'abort' };

/**
 * worker 源码。
 *
 * 用户脚本仍然走 `new Function`,和改造前一模一样 —— 作用域里看不到 require,
 * 注入清单和顺序也不变(code-sandbox 的 CODE_SANDBOX_GLOBALS 是唯一真源)。
 * 变的只是它跑在哪条事件循环上。
 */
export const CODE_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const nodeFs = require('node:fs');
const nodePath = require('node:path');
const nodeOs = require('node:os');
const nodeChildProcess = require('node:child_process');

const port = parentPort;
const pending = new Map();
let rpcSeq = 0;

const abortController = new AbortController();

/** postMessage 走 structuredClone,不可克隆的值(函数/Symbol/循环引用)先降级成字符串。 */
function toTransferable(value) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'undefined') return value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return String(value);
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  try {
    structuredClone(value);
    return value;
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
}

function callHost(method, args) {
  const id = (rpcSeq += 1);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    port.postMessage({ kind: 'rpc', id, method, args: args.map(toTransferable) });
  });
}

port.on('message', (msg) => {
  if (!msg) return;
  if (msg.kind === 'abort') {
    abortController.abort(new Error('Workflow code execution aborted'));
    return;
  }
  if (msg.kind !== 'rpc-result') return;
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  if (msg.ok) {
    entry.resolve(msg.value);
  } else {
    const err = new Error(msg.error?.message ?? 'Workflow code host call failed');
    err.name = msg.error?.name ?? 'Error';
    entry.reject(err);
  }
});

function bindConsole(level) {
  return (...args) => {
    port.postMessage({ kind: 'console', level, args: args.map(toTransferable) });
  };
}

const scriptConsole = {
  log: bindConsole('info'),
  info: bindConsole('info'),
  debug: bindConsole('info'),
  warn: bindConsole('warn'),
  error: bindConsole('error'),
};

function buildBrowser(connected) {
  const api = { connected };
  for (const name of workerData.browserMethods) {
    api[name] = (...args) => callHost('browser.' + name, args);
  }
  return api;
}

const ctx = {
  ...workerData.ctxData,
  signal: abortController.signal,
  browser: buildBrowser(workerData.browserConnected),
  saveArtifact: (source, name) => callHost('saveArtifact', [source, name]),
  // 在宿主线程跑,好让取消能真的把命令进程杀掉(worker 的 terminate 掐不断 waitpid)。
  exec: (command, args, options) => callHost('exec', [command, args, options]),
};

// worker 的 eval 模式把 CJS wrapper 变量(require/module/exports/__dirname/__filename)
// 挂上了全局作用域,new Function 能看见 —— 主线程的 webpack bundle 里它们是不存在的。
// 脚本作用域必须和改造前逐字一致(提示词明说「没有 require」,AI 照此写代码),
// 所以在这里把它们遮蔽成 undefined。process 改造前就是全局,保留。
const SHADOWED = ['require', 'module', 'exports', '__dirname', '__filename'];

// 除遮蔽项外和改造前一模一样:同一份 new Function,同一个注入顺序。
const fn = new Function(
  ...workerData.globals,
  ...SHADOWED,
  'return (async () => { ' + workerData.script + ' })()',
);

(async () => {
  try {
    const value = await fn(
      ctx, globalThis.fetch, scriptConsole, nodeFs, nodePath, nodeOs, nodeChildProcess,
      ...SHADOWED.map(() => undefined),
    );
    port.postMessage({ kind: 'done', ok: true, value: toTransferable(value) });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    port.postMessage({
      kind: 'done',
      ok: false,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  }
})();
`;
