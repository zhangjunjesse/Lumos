import { EventEmitter } from 'node:events';
import type { ApprovalRequest } from './approval-requests';

// ── In-process signaling bus for approval decisions ────────────────────────
//
// approvalStep 挂起在 waitForApprovalResolution 返回的 Promise 上。
// API 路由决策后调用 notifyApprovalResolved，Promise 解除，步骤继续。
//
// 进程重启 = 丢失 listener。approvalStep 依赖 step.run 的幂等重入 + DAO 里
// UNIQUE(workflow_run_id, step_id) 保证不重复创建 request；重入时若 request
// 已是终态直接返回，否则重新注册 listener。

const bus = new EventEmitter();
bus.setMaxListeners(0);

function eventKey(approvalId: string): string {
  return `approval:${approvalId}`;
}

export function waitForApprovalResolution(approvalId: string): Promise<ApprovalRequest> {
  return new Promise<ApprovalRequest>((resolve) => {
    bus.once(eventKey(approvalId), resolve);
  });
}

export function notifyApprovalResolved(approval: ApprovalRequest): void {
  bus.emit(eventKey(approval.id), approval);
}

/** test-only: remove dangling listeners so Jest can exit cleanly. */
export function __clearApprovalWaiters(): void {
  bus.removeAllListeners();
}
