/**
 * Approval request 公共类型。
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'cancelled';
export type DecisionVote = 'approved' | 'rejected';

export interface ApproversConfig {
  mode: 'any' | 'all' | 'quorum';
  users: string[];
  quorum?: number;
}

export interface TimeoutConfig {
  duration: string;
  onTimeout: 'approve' | 'reject' | 'goto';
  target?: string;
}

export interface ApprovalDecision {
  id: string;
  approvalId: string;
  decidedBy: string;
  decision: DecisionVote;
  note: string;
  payload: unknown;
  decidedAt: string;
}

export interface ApprovalRequest {
  id: string;
  workflowRunId: string;
  stepId: string;
  prompt: string;
  approvers: ApproversConfig;
  formSchema: Record<string, unknown> | null;
  timeoutConfig: TimeoutConfig | null;
  timeoutAt: string | null;
  status: ApprovalStatus;
  finalNote: string;
  finalPayload: unknown;
  createdAt: string;
  decidedAt: string | null;
  decisions: ApprovalDecision[];
}

export interface CreateApprovalInput {
  workflowRunId: string;
  stepId: string;
  prompt: string;
  approvers: ApproversConfig;
  formSchema?: Record<string, unknown>;
  timeoutConfig?: TimeoutConfig;
}

export interface SubmitDecisionInput {
  approvalId: string;
  decidedBy: string;
  decision: DecisionVote;
  note?: string;
  payload?: unknown;
}

export interface FinalizeResult {
  approval: ApprovalRequest;
  resolved: boolean;
}
