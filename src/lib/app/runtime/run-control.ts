/**
 * Cross-app cooperative cancellation registry.
 *
 * 解决的问题: 每个 builtin app(douyin-collector / etsy-erank / pinterest-radar /
 * x-radar 等)的 long-running worker 都不响应 cancel —— cancel API 只能标 db
 * status='cancelled', worker 内的 for/while 循环继续跑, 浏览器 tab 继续开,
 * ASR/HTTP fetch 继续烧。CLAUDE.md「任务生命周期规则」要求 abort signal 必须
 * 传播到 worker, 但抽完整的 AbortController 链路成本高。
 *
 * 折中方案: 进程内共享 Set<string>, key 是 `${appId}:${runId}`。
 *   - cancel API 调 markRunCancelled(appId, runId)
 *   - worker 在循环顶部 + 每次 await 后 check isRunCancelled, true 就 break
 *   - 任意 fetch/spawn 的 timeout 也短一点(<=10s), 避免单次 await 卡太久阻塞响应
 *   - run 终态(success/failed)后调 clearRunCancellation 清理, 防 Set 无界膨胀
 *
 * 不是真正的 AbortController:
 *   - 不能 abort 已经发出去的 fetch socket / 已经 spawn 的 ffmpeg 进程
 *   - 是"协作式": worker 必须主动 check 才有效
 *   - 进程重启后状态丢失(可接受: 重启时 worker 也死了)
 *
 * 用法:
 *   // worker:
 *   for (const id of awemeIds) {
 *     if (isRunCancelled(APP_ID, jobId)) break;
 *     await processOne(id);
 *   }
 *   // cancel route:
 *   markRunCancelled(APP_ID, jobId);
 *   markJobStatus(jobId, { status: 'cancelled' });
 */

const cancelled = new Set<string>();
const MAX_TRACKED = 5_000; // 防 Set 无界膨胀, 旧的自动淘汰

function key(appId: string, runId: string): string {
  return `${appId}:${runId}`;
}

export function markRunCancelled(appId: string, runId: string): void {
  if (!appId || !runId) return;
  if (cancelled.size >= MAX_TRACKED) {
    // Set 在 v8 中保留插入顺序, 第一个 key 是最早进的
    const oldest = cancelled.values().next().value;
    if (oldest) cancelled.delete(oldest);
  }
  cancelled.add(key(appId, runId));
}

export function isRunCancelled(appId: string, runId: string): boolean {
  if (!appId || !runId) return false;
  return cancelled.has(key(appId, runId));
}

export function clearRunCancellation(appId: string, runId: string): void {
  if (!appId || !runId) return;
  cancelled.delete(key(appId, runId));
}

/** Test-only: reset registry between jest suites. */
export function _resetRunControlForTests(): void {
  cancelled.clear();
}
