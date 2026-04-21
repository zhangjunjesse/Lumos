/**
 * Approval request DAO — 所有直接触 SQLite 的读写都集中在这里。
 *
 * 状态机、权限校验、共识判断等业务逻辑在 `approval-requests.ts`。
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db/connection';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  ApproversConfig,
  CreateApprovalInput,
  DecisionVote,
  TimeoutConfig,
} from './approval-requests-types';

// ── Row types (仅本模块内使用) ─────────────────────────────────────────────

interface ApprovalRow {
  id: string;
  workflow_run_id: string;
  step_id: string;
  prompt: string;
  approvers_json: string;
  form_schema_json: string;
  timeout_config_json: string;
  timeout_at: string | null;
  status: ApprovalStatus;
  final_note: string;
  final_payload_json: string;
  created_at: string;
  decided_at: string | null;
}

interface DecisionRow {
  id: string;
  approval_id: string;
  decided_by: string;
  decision: DecisionVote;
  note: string;
  payload_json: string;
  decided_at: string;
}

// ── Create / read ──────────────────────────────────────────────────────────

export function insertApprovalRow(input: CreateApprovalInput): string {
  const db = getDb();
  const id = randomUUID();
  const timeoutAt = input.timeoutConfig ? computeTimeoutAt(input.timeoutConfig.duration) : null;
  db.prepare(
    `INSERT INTO workflow_approval_requests
       (id, workflow_run_id, step_id, prompt, approvers_json, form_schema_json, timeout_config_json, timeout_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workflowRunId,
    input.stepId,
    input.prompt,
    JSON.stringify(input.approvers),
    input.formSchema ? JSON.stringify(input.formSchema) : '',
    input.timeoutConfig ? JSON.stringify(input.timeoutConfig) : '',
    timeoutAt,
  );
  return id;
}

export function fetchApprovalById(id: string): ApprovalRequest | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM workflow_approval_requests WHERE id = ?',
  ).get(id) as ApprovalRow | undefined;
  return row ? hydrate(row, loadDecisionRows(id)) : null;
}

export function fetchActiveApproval(workflowRunId: string, stepId: string): ApprovalRequest | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM workflow_approval_requests WHERE workflow_run_id = ? AND step_id = ?',
  ).get(workflowRunId, stepId) as ApprovalRow | undefined;
  return row ? hydrate(row, loadDecisionRows(row.id)) : null;
}

export function fetchApprovalList(filter?: {
  status?: ApprovalStatus; workflowRunId?: string;
}): ApprovalRequest[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.status) { clauses.push('status = ?'); params.push(filter.status); }
  if (filter?.workflowRunId) { clauses.push('workflow_run_id = ?'); params.push(filter.workflowRunId); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM workflow_approval_requests ${where} ORDER BY created_at DESC`,
  ).all(...params) as ApprovalRow[];
  return rows.map((r) => hydrate(r, loadDecisionRows(r.id)));
}

export function fetchPendingTimedOut(now: Date): ApprovalRequest[] {
  const db = getDb();
  const nowIso = now.toISOString().replace('T', ' ').replace(/\..+$/, '');
  const rows = db.prepare(
    `SELECT * FROM workflow_approval_requests
       WHERE status = 'pending' AND timeout_at IS NOT NULL AND timeout_at <= ?`,
  ).all(nowIso) as ApprovalRow[];
  return rows.map((r) => hydrate(r, loadDecisionRows(r.id)));
}

// ── Decision writes ────────────────────────────────────────────────────────

export function insertDecisionRow(input: {
  approvalId: string; decidedBy: string; decision: DecisionVote; note: string; payload: unknown;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO workflow_approval_decisions (id, approval_id, decided_by, decision, note, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.approvalId,
    input.decidedBy,
    input.decision,
    input.note,
    input.payload === undefined ? '' : JSON.stringify(input.payload),
  );
}

export function markApprovalFinal(input: {
  id: string; status: ApprovalStatus; note: string; payload: unknown;
}): void {
  const db = getDb();
  db.prepare(
    `UPDATE workflow_approval_requests
       SET status = ?, final_note = ?, final_payload_json = ?, decided_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
  ).run(
    input.status,
    input.note,
    input.payload === null || input.payload === undefined ? '' : JSON.stringify(input.payload),
    input.id,
  );
}

// ── Row → domain ───────────────────────────────────────────────────────────

function hydrate(row: ApprovalRow, decisions: ApprovalDecision[]): ApprovalRequest {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    stepId: row.step_id,
    prompt: row.prompt,
    approvers: JSON.parse(row.approvers_json || '{}') as ApproversConfig,
    formSchema: row.form_schema_json ? JSON.parse(row.form_schema_json) : null,
    timeoutConfig: row.timeout_config_json
      ? (JSON.parse(row.timeout_config_json) as TimeoutConfig)
      : null,
    timeoutAt: row.timeout_at,
    status: row.status,
    finalNote: row.final_note,
    finalPayload: row.final_payload_json ? JSON.parse(row.final_payload_json) : null,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decisions,
  };
}

function loadDecisionRows(approvalId: string): ApprovalDecision[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM workflow_approval_decisions WHERE approval_id = ? ORDER BY decided_at ASC`,
  ).all(approvalId) as DecisionRow[];
  return rows.map((r) => ({
    id: r.id,
    approvalId: r.approval_id,
    decidedBy: r.decided_by,
    decision: r.decision,
    note: r.note,
    payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    decidedAt: r.decided_at,
  }));
}

// ── Duration / timeout helpers (纯函数, 放这里便于 create 逻辑内联复用) ────

/** Parse a subset of ISO 8601 durations (PT1H, PT30M, P1D, P1DT2H, ...) to ms. */
export function parseIsoDurationMs(duration: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration.trim());
  if (!match) return 0;
  const [, d, h, m, s] = match;
  const days = Number(d ?? 0);
  const hours = Number(h ?? 0);
  const minutes = Number(m ?? 0);
  const seconds = Number(s ?? 0);
  return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
}

function computeTimeoutAt(duration: string): string {
  const ms = parseIsoDurationMs(duration);
  if (ms <= 0) return '';
  const at = new Date(Date.now() + ms);
  return at.toISOString().replace('T', ' ').replace(/\..+$/, '');
}
