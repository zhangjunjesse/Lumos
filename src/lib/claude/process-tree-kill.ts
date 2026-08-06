/**
 * 进程树回收(#59)。
 *
 * 症结:工作流步骤超时/取消时,我们只 abort 了 SDK 的 query。SDK 对 CLI 进程做的是
 * `child.kill()` —— 只杀被点名的那一个进程,不碰它的子孙。于是这条链路留下孤儿:
 *
 *   Lumos ──abort──▶ claude CLI(被杀) ──▶ MCP server(存活) ──▶ gallery-dl(存活,继续写文件)
 *
 * 实测:步骤 21:46:49 判 cancelled,下载目录到 21:48 还在写入。步骤已经"失败"了,
 * 副作用却还在发生 —— 这类"取消不干净"是数据损坏的温床。
 *
 * 做法:接管 SDK 的 spawn 拿到 CLI 的 pid,在取消时按平台杀整棵树:
 *   Windows: taskkill /PID <pid> /T /F  ——  /T 才连子孙一起(child.kill 只等于 /F)
 *   POSIX:   spawn 时 detached:true 建进程组,kill(-pid) 一次干掉整组
 *
 * 兜底原则:杀不掉不抛错(进程可能已自己退出),记日志即可 —— 回收失败不该
 * 把一次本来就在收尾的取消变成一个新异常。
 */

import { spawn, type ChildProcess } from 'child_process';

const isWindows = process.platform === 'win32';

/**
 * 杀掉以 pid 为根的整棵进程树。best-effort:进程不存在/已退出都算成功。
 * @returns 是否发出了终止指令(不代表进程一定已消失)
 */
export function killProcessTree(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    if (isWindows) {
      // /T = 连同子进程树,/F = 强制。缺 /T 就是当前 SDK 的行为(只杀根,留孤儿)。
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return true;
    }
    // POSIX:进程组 id = 组长 pid(spawn 时 detached:true 建的组),负号发给整组
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // 没建成组(或组已空)时退回单进程,总比不杀强
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch {
    // ESRCH 等:进程早没了,正常
    return false;
  }
}

/**
 * SDK 的 spawnClaudeCodeProcess 定制实现:行为与默认一致,只多两件事——
 * POSIX 下建独立进程组(让上面的 kill(-pid) 能一次清干净),并把 pid 交给调用方。
 *
 * 注意 signal 是 SDK 转发过的(stdin-EOF + ~2s 优雅期之后才 abort),
 * 照常传给 spawn 即可,不会抢在优雅关闭之前。
 */
export function createTrackedSpawn(onSpawned: (child: ChildProcess) => void) {
  return (options: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string | undefined>;
    signal: AbortSignal;
  }) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      // POSIX:独立进程组,才有"整组回收"这条路;Windows 靠 taskkill /T,不需要
      ...(isWindows ? { windowsHide: true } : { detached: true }),
    });
    onSpawned(child);
    // stdio:['pipe','pipe','pipe'] 保证三个流都在,SDK 的 SpawnedProcess 要求非空
    return child as ChildProcess & {
      stdin: NonNullable<ChildProcess['stdin']>;
      stdout: NonNullable<ChildProcess['stdout']>;
      stderr: NonNullable<ChildProcess['stderr']>;
    };
  };
}
