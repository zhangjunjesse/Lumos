/* eslint-disable @typescript-eslint/no-require-imports -- jest.resetModules() requires sync require() to reload modules between tests */
import Database from 'better-sqlite3';

const APPROVAL_SCHEMA = `
  CREATE TABLE workflow_approval_requests (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    approvers_json TEXT NOT NULL DEFAULT '{}',
    form_schema_json TEXT NOT NULL DEFAULT '',
    timeout_config_json TEXT NOT NULL DEFAULT '',
    timeout_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected','timeout','cancelled')),
    final_note TEXT NOT NULL DEFAULT '',
    final_payload_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT,
    UNIQUE(workflow_run_id, step_id)
  );
  CREATE TABLE workflow_approval_decisions (
    id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
    note TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '',
    decided_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(approval_id, decided_by),
    FOREIGN KEY (approval_id) REFERENCES workflow_approval_requests(id) ON DELETE CASCADE
  );
`;

let mockDb: Database.Database;

jest.mock('@/lib/db/connection', () => ({
  getDb: () => mockDb,
  closeDb: () => {},
  dataDir: '/tmp',
  DB_PATH: '/tmp/test.db',
}));

describe('approvalStep binding', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.exec(APPROVAL_SCHEMA);
    jest.resetModules();
  });

  afterEach(() => {
    const { __clearApprovalWaiters } = require('../approval-waiter') as typeof import('../approval-waiter');
    __clearApprovalWaiters();
    mockDb.close();
  });

  function load() {
    return {
      approvalStep: (require('../steps/approvalStep') as typeof import('../steps/approvalStep')).approvalStep,
      requests: require('../approval-requests') as typeof import('../approval-requests'),
      waiter: require('../approval-waiter') as typeof import('../approval-waiter'),
    };
  }

  const runtime = (workflowRunId: string, stepId: string) => ({
    __runtime: {
      workflowRunId,
      stepId,
      stepType: 'approval' as const,
    },
  });

  test('returns success with approved output when approval is resolved', async () => {
    const { approvalStep, requests, waiter } = load();
    const promise = approvalStep({
      ...runtime('wf-1', 'ap'),
      prompt: 'ok?',
      approvers: { mode: 'any', users: ['alice'] },
    });

    await new Promise((r) => setImmediate(r));
    const active = requests.findActiveApproval('wf-1', 'ap')!;
    const { approval } = requests.submitDecision({
      approvalId: active.id,
      decidedBy: 'alice',
      decision: 'approved',
      note: 'lgtm',
    });
    waiter.notifyApprovalResolved(approval);

    const result = await promise;
    expect(result.success).toBe(true);
    expect((result.output as { status: string }).status).toBe('approved');
    expect((result.output as { note: string }).note).toBe('lgtm');
  });

  test('returns failure with reject reason when rejected', async () => {
    const { approvalStep, requests, waiter } = load();
    const promise = approvalStep({
      ...runtime('wf-2', 'ap'),
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    await new Promise((r) => setImmediate(r));
    const active = requests.findActiveApproval('wf-2', 'ap')!;
    const { approval } = requests.submitDecision({
      approvalId: active.id,
      decidedBy: 'alice',
      decision: 'rejected',
      note: 'wrong direction',
    });
    waiter.notifyApprovalResolved(approval);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('wrong direction');
  });

  test('is idempotent: re-invoking after resolution returns the final outcome directly', async () => {
    const { approvalStep, requests, waiter } = load();
    const p1 = approvalStep({
      ...runtime('wf-3', 'ap'),
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    await new Promise((r) => setImmediate(r));
    const active = requests.findActiveApproval('wf-3', 'ap')!;
    const { approval } = requests.submitDecision({
      approvalId: active.id,
      decidedBy: 'alice',
      decision: 'approved',
    });
    waiter.notifyApprovalResolved(approval);
    const r1 = await p1;

    const r2 = await approvalStep({
      ...runtime('wf-3', 'ap'),
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect((r2.output as { approvalId: string }).approvalId).toBe(active.id);
  });

  test('fails fast when approvers.users[] is empty', async () => {
    const { approvalStep } = load();
    const result = await approvalStep({
      ...runtime('wf-4', 'ap'),
      prompt: '',
      approvers: { mode: 'any', users: [] },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/users/);
  });

  test('fails fast when runtime context missing', async () => {
    const { approvalStep } = load();
    const result = await approvalStep({
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/runtime/);
  });
});
