import { listPendingTimedOut, timeoutApproval } from './approval-requests';
import { notifyApprovalResolved } from './approval-waiter';

// ── Periodic sweep: finalize pending approvals past their timeout_at ───────
//
// In-process setTimeout per-request is fragile (lost on restart). A cheap
// interval that scans pending rows gives us deterministic recovery across
// process lifecycle.

const SWEEP_INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startApprovalTimeoutSweeper(): void {
  if (timer) return;
  timer = setInterval(() => { void sweepOnce(); }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopApprovalTimeoutSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export async function sweepOnce(): Promise<number> {
  let finalized = 0;
  for (const expired of listPendingTimedOut()) {
    const updated = timeoutApproval(expired.id);
    if (updated && updated.status !== 'pending') {
      notifyApprovalResolved(updated);
      finalized++;
    }
  }
  return finalized;
}
