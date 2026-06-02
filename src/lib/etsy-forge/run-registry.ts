// 采集任务运行态登记(进程内内存)。run-now 开跑时登记、跑完注销;stop 接口翻「要停」旗;
// collector 每翻一页轮询 isAbortRequested 决定收手。只管「列表采集这一次跑」的生命周期,不碰 DB。
// 进程重启会清空(内存态),此时若 DB 里 last_status 仍 running 属残留,由 stop 接口/recoverStaleRunningTasks 兜底。

interface RunHandle {
  abort: boolean;
  startedAt: number;
}

const running = new Map<string, RunHandle>();

export function registerRun(taskId: string): void {
  running.set(taskId, { abort: false, startedAt: Date.now() });
}

export function unregisterRun(taskId: string): void {
  running.delete(taskId);
}

/** 请求停止某任务。返回是否命中一个正在跑的 run(false = 此进程内没有它的活动 run)。 */
export function requestAbort(taskId: string): boolean {
  const h = running.get(taskId);
  if (!h) return false;
  h.abort = true;
  return true;
}

/** collector 轮询用:该任务是否被请求停止。 */
export function isAbortRequested(taskId: string): boolean {
  return running.get(taskId)?.abort ?? false;
}

/** 该任务此刻是否有进程内活动 run。 */
export function isRunActive(taskId: string): boolean {
  return running.has(taskId);
}
