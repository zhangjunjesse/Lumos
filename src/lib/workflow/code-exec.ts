// code 节点执行外部命令的官方入口(#54)。
//
// 提示词以前教的是 `child_process.execFileSync(...)`,还专门写着「长任务用 spawnSync」
// —— 而长任务恰恰是必然超过 30 秒执行租约的那一类。脚本现在跑在独立 worker 线程里,
// 同步调用不会再冻住心跳,但它依然有两个改不掉的毛病:
//   1. 取消按不动 —— worker.terminate() 掐不断卡在 waitpid 里的原生调用;
//   2. 命令进程会变孤儿 —— 工作流都停了,python / ImageMagick 还在跑。
// ctx.exec 用异步 execFile + AbortSignal,两个毛病一起解决,写法也比手搓 Promise 短。

import { execFile } from 'child_process';

export interface CodeExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** 超时(毫秒)。到点先 SIGTERM。 */
  timeoutMs?: number;
  /** stdout/stderr 上限,默认 16MB —— 够装下 python 脚本的正常输出。 */
  maxBuffer?: number;
  encoding?: BufferEncoding;
}

export interface CodeExecResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * 异步执行外部命令。
 *
 * 命令以非 0 退出时抛错(和以前 execFileSync 的行为一致),但错误对象上挂了
 * stdout / stderr,不用再去猜失败原因。
 */
export function runExternalCommand(
  command: string,
  args: readonly string[] = [],
  options: CodeExecOptions = {},
  signal?: AbortSignal,
): Promise<CodeExecResult> {
  return new Promise<CodeExecResult>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        encoding: options.encoding ?? 'utf8',
        // 取消时 Node 会把信号发给子进程 —— 这正是 execFileSync 做不到的那件事。
        signal,
      },
      (error, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : String(stdout ?? '');
        const err = typeof stderr === 'string' ? stderr : String(stderr ?? '');

        if (error) {
          // Node 的 execFile 已经把 stderr 拼进 message 了,别再拼一遍(会重复两段)。
          // 这里只补上结构化字段,方便脚本按需取用。
          const failure = error as Error & { stdout?: string; stderr?: string };
          failure.stdout = out;
          failure.stderr = err;
          reject(failure);
          return;
        }

        resolve({ stdout: out, stderr: err });
      },
    );
  });
}
