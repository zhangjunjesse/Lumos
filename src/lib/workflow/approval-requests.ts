/**
 * Approval request — 公共 API 与状态机。
 *
 * DAO 层(所有直接触 SQL 的读写)在 `approval-requests-dao.ts`;
 * 类型声明在 `approval-requests-types.ts`。
 */
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  ApproversConfig,
  CreateApprovalInput,
  FinalizeResult,
  SubmitDecisionInput,
} from './approval-requests-types';
import {
  fetchActiveApproval,
  fetchApprovalById,
  fetchApprovalList,
  fetchPendingTimedOut,
  insertApprovalRow,
  insertDecisionRow,
  markApprovalFinal,
} from './approval-requests-dao';

export type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  ApproversConfig,
  CreateApprovalInput,
  DecisionVote,
  FinalizeResult,
  SubmitDecisionInput,
  TimeoutConfig,
} from './approval-requests-types';

export { parseIsoDurationMs } from './approval-requests-dao';

// ── Create / read ──────────────────────────────────────────────────────────

export function createApprovalRequest(input: CreateApprovalInput): ApprovalRequest {
  const id = insertApprovalRow(input);
  return fetchApprovalById(id)!;
}

export function getApprovalRequest(id: string): ApprovalRequest | null {
  return fetchApprovalById(id);
}

export function findActiveApproval(workflowRunId: string, stepId: string): ApprovalRequest | null {
  return fetchActiveApproval(workflowRunId, stepId);
}

export function listApprovals(filter?: {
  status?: ApprovalStatus; workflowRunId?: string;
}): ApprovalRequest[] {
  return fetchApprovalList(filter);
}

export function listPendingTimedOut(now: Date = new Date()): ApprovalRequest[] {
  return fetchPendingTimedOut(now);
}

// ── State transitions ─────────────────────────────────────────────────────

export function submitDecision(input: SubmitDecisionInput): FinalizeResult {
  const current = fetchApprovalById(input.approvalId);
  if (!current) throw new Error(`Approval ${input.approvalId} not found`);
  if (current.status !== 'pending') {
    return { approval: current, resolved: false };
  }
  if (!isAuthorizedApprover(current.approvers, input.decidedBy)) {
    throw new Error(`User ${input.decidedBy} is not authorized to decide approval ${input.approvalId}`);
  }

  try {
    insertDecisionRow({
      approvalId: input.approvalId,
      decidedBy: input.decidedBy,
      decision: input.decision,
      note: input.note ?? '',
      payload: input.payload,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      throw new Error(`User ${input.decidedBy} has already decided this approval`);
    }
    throw err;
  }

  const updated = fetchApprovalById(input.approvalId)!;
  const consensus = computeConsensus(updated.approvers, updated.decisions);
  if (consensus === 'pending') {
    return { approval: updated, resolved: false };
  }

  const lastDecision = updated.decisions[updated.decisions.length - 1];
  markApprovalFinal({
    id: input.approvalId,
    status: consensus,
    note: lastDecision?.note ?? '',
    payload: lastDecision?.payload ?? null,
  });
  return { approval: fetchApprovalById(input.approvalId)!, resolved: true };
}

export function cancelApproval(approvalId: string, reason = ''): ApprovalRequest | null {
  const current = fetchApprovalById(approvalId);
  if (!current || current.status !== 'pending') return current;
  markApprovalFinal({ id: approvalId, status: 'cancelled', note: reason, payload: null });
  return fetchApprovalById(approvalId);
}

export function timeoutApproval(approvalId: string): ApprovalRequest | null {
  const current = fetchApprovalById(approvalId);
  if (!current || current.status !== 'pending') return current;
  const onTimeout = current.timeoutConfig?.onTimeout;
  const resolvedStatus: ApprovalStatus =
    onTimeout === 'approve' ? 'approved'
    : onTimeout === 'goto' ? 'timeout'
    : 'rejected';
  markApprovalFinal({
    id: approvalId,
    status: resolvedStatus,
    note: `timed out at ${new Date().toISOString()}`,
    payload: null,
  });
  return fetchApprovalById(approvalId);
}

// ── Pure consensus / auth ─────────────────────────────────────────────────

export function computeConsensus(
  approvers: ApproversConfig,
  decisions: ApprovalDecision[],
): 'pending' | 'approved' | 'rejected' {
  const approved = decisions.filter((d) => d.decision === 'approved').length;
  const rejected = decisions.filter((d) => d.decision === 'rejected').length;
  const total = Math.max(1, approvers.users.length);

  switch (approvers.mode) {
    case 'any':
      if (approved > 0) return 'approved';
      if (rejected >= total) return 'rejected';
      return 'pending';
    case 'all':
      if (rejected > 0) return 'rejected';
      if (approved >= total) return 'approved';
      return 'pending';
    case 'quorum': {
      const q = Math.max(1, Math.min(total, approvers.quorum ?? total));
      if (approved >= q) return 'approved';
      if (rejected > total - q) return 'rejected';
      return 'pending';
    }
  }
}

export function isAuthorizedApprover(approvers: ApproversConfig, userId: string): boolean {
  if (approvers.users.length === 0) return true;
  return approvers.users.includes(userId);
}
