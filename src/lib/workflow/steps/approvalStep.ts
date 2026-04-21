import {
  createApprovalRequest,
  findActiveApproval,
  type ApproversConfig,
  type TimeoutConfig,
} from '../approval-requests';
import { waitForApprovalResolution } from '../approval-waiter';
import type { StepResult, WorkflowStepRuntimeCarrier } from '../types';

// ── approval runtime binding ───────────────────────────────────────────────
//
// 步骤级语义：
//   1. 查 (workflow_run_id, step_id) 是否已有 approval_request
//      - 没有 → 创建 pending row
//      - 已终态 → 直接转换成 StepResult 返回（幂等重入）
//      - 仍 pending → 复用
//   2. 注册 waiter，await resolution（approved / rejected / timeout / cancelled）
//   3. 按终态转换为 StepResult

export interface ApprovalStepInput extends WorkflowStepRuntimeCarrier {
  prompt: string;
  approvers: ApproversConfig;
  formSchema?: Record<string, unknown>;
  timeout?: TimeoutConfig;
}

export async function approvalStep(input: ApprovalStepInput): Promise<StepResult> {
  const runtime = input.__runtime;
  if (!runtime) {
    return {
      success: false,
      output: null,
      error: 'approvalStep missing runtime context',
    };
  }

  const approvers = normalizeApprovers(input.approvers);
  if (!approvers) {
    return {
      success: false,
      output: null,
      error: 'approvalStep requires approvers.users[] with at least one entry',
    };
  }

  const existing = findActiveApproval(runtime.workflowRunId, runtime.stepId);
  const approval = existing ?? createApprovalRequest({
    workflowRunId: runtime.workflowRunId,
    stepId: runtime.stepId,
    prompt: input.prompt ?? '',
    approvers,
    formSchema: input.formSchema,
    timeoutConfig: input.timeout,
  });

  const resolved = approval.status !== 'pending'
    ? approval
    : await waitForApprovalResolution(approval.id);

  return toStepResult(resolved);
}

function normalizeApprovers(input: unknown): ApproversConfig | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<ApproversConfig>;
  if (!Array.isArray(raw.users) || raw.users.length === 0) return null;
  const mode = raw.mode === 'all' || raw.mode === 'quorum' ? raw.mode : 'any';
  return {
    mode,
    users: raw.users.map(String),
    ...(typeof raw.quorum === 'number' ? { quorum: raw.quorum } : {}),
  };
}

function toStepResult(approval: { id: string; status: string; finalNote: string; finalPayload: unknown; decisions: unknown[] }): StepResult {
  const base = {
    approvalId: approval.id,
    status: approval.status,
    note: approval.finalNote,
    payload: approval.finalPayload,
    decisions: approval.decisions,
  };
  if (approval.status === 'approved') {
    return { success: true, output: base };
  }
  if (approval.status === 'rejected') {
    return {
      success: false,
      output: base,
      error: approval.finalNote ? `Approval rejected: ${approval.finalNote}` : 'Approval rejected',
    };
  }
  if (approval.status === 'cancelled') {
    return {
      success: false,
      output: base,
      error: 'Approval cancelled',
    };
  }
  // timeout → goto or reject; goto semantics handled by node-level onError.goto on the DSL side.
  return {
    success: false,
    output: base,
    error: 'Approval timed out',
  };
}
